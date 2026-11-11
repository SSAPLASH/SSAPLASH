package com.ssafy.airdrum.domain.song.worker.midi;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import com.ssafy.airdrum.domain.song.storage.midi.MidiBackingStorageConfiguration;
import com.ssafy.airdrum.domain.song.storage.midi.MidiBackingStore;
import com.ssafy.airdrum.domain.song.storage.midi.MidiOriginalStorageConfiguration;
import com.ssafy.airdrum.domain.song.storage.midi.MidiOriginalStore;
import com.ssafy.airdrum.domain.chart.model.ChartDocumentReader;
import tools.jackson.databind.json.JsonMapper;

/** API Spring 컨텍스트와 스케줄러를 띄우지 않는 독립 CPU 워커 진입점. */
public final class MidiWorkerMain {
    private MidiWorkerMain() {}
    public static void main(String[] args) throws Exception {
        var dataSource=new DriverManagerDataSource(required("DB_URL"),required("DB_USERNAME"),required("DB_PASSWORD"));
        var db=new JdbcTemplate(dataSource);
        var queue=new MidiSynthesisQueue(db,new DataSourceTransactionManager(dataSource));
        boolean originals=Boolean.parseBoolean(env("MIDI_STORAGE_ENABLED","false"));
        boolean privateBucket=Boolean.parseBoolean(env("MIDI_STORAGE_PRIVATE_BUCKET_CONFIRMED","false"));
        boolean backings=Boolean.parseBoolean(env("CHART_ASSET_ENABLED","false"));
        if (!originals || !privateBucket || !backings) throw new IllegalStateException("MIDI 워커의 비공개 저장소 설정이 필요합니다.");
        try (var source=new MidiOriginalStorageConfiguration().midiOriginalStore(true,required("MIDI_STORAGE_ENDPOINT"),
                    env("MIDI_STORAGE_REGION","us-east-1"),required("MIDI_STORAGE_BUCKET"),required("MIDI_STORAGE_ACCESS_KEY"),
                    required("MIDI_STORAGE_SECRET_KEY"),true);
             var backing=new MidiBackingStorageConfiguration().midiBackingStore(true,required("CHART_ASSET_ENDPOINT"),
                    env("CHART_ASSET_REGION","us-east-1"),required("CHART_ASSET_ACCOMPANIMENT_BUCKET"),
                    required("WORKER_STORAGE_ACCOMPANIMENT_WRITE_ACCESS_KEY"),required("WORKER_STORAGE_ACCOMPANIMENT_WRITE_SECRET_KEY"))) {
            if (args.length>0 && "--resynthesize".equals(args[0])) {
                int result=new MidiResynthesis(db,new DataSourceTransactionManager(dataSource),source)
                        .run(java.util.Arrays.copyOfRange(args,1,args.length),System.out);
                if (result!=0) System.exit(result);
                return;
            }
            if (args.length!=0) throw new IllegalArgumentException("알 수 없는 MIDI 워커 실행 옵션입니다.");
            String font=required("MIDI_SOUNDFONT_PATH");
            if (!Files.isRegularFile(Path.of(font)) || !Files.isReadable(Path.of(font))) throw new IllegalStateException("SoundFont 파일을 읽을 수 없습니다.");
            var digest=java.security.MessageDigest.getInstance("SHA-256");
            try (var input=Files.newInputStream(Path.of(font))) {
                byte[] buffer=new byte[65536]; int n; while ((n=input.read(buffer))!=-1) digest.update(buffer,0,n);
            }
            if (!java.util.HexFormat.of().formatHex(digest.digest()).equals("74594e8f4250680adf590507a306655a299935343583256f3b722c48a1bc1cb0"))
                throw new IllegalStateException("SoundFont 체크섬이 올바르지 않습니다.");
            var renderer=new MidiRenderer(executable(env("MIDI_FLUIDSYNTH_PATH","fluidsynth")),font,
                    executable(env("MIDI_FFMPEG_PATH","ffmpeg")),executable(env("MIDI_FFPROBE_PATH","ffprobe")));
            var reader=new ChartDocumentReader(new JsonMapper());
            Path base=Path.of(env("MIDI_TEMP_DIR",System.getProperty("java.io.tmpdir"))).toAbsolutePath();
            Files.createDirectories(base);
            Thread worker=Thread.currentThread();
            Thread shutdown=new Thread(()->{ worker.interrupt(); renderer.close(); source.close(); backing.close(); },"midi-shutdown");
            Runtime.getRuntime().addShutdownHook(shutdown);
            try {
                while (!Thread.currentThread().isInterrupted()) {
                    try {
                        var claim=queue.claim();
                        if (claim==null) { Thread.sleep(2000); continue; }
                        execute(claim,queue,source,backing,renderer,reader,base);
                    } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                    catch (Exception e) { System.err.println("MIDI 작업 조회 또는 실행에 실패했습니다: "+e.getClass().getSimpleName()); Thread.sleep(2000); }
                }
            } finally { renderer.close(); try { Runtime.getRuntime().removeShutdownHook(shutdown); } catch (IllegalStateException ignored) {} }
        }
    }
    static void execute(MidiSynthesisQueue.Claim c,MidiSynthesisQueue queue,MidiOriginalStore source,MidiBackingStore backing,
            MidiRenderer renderer,ChartDocumentReader reader,Path base) throws InterruptedException {
        long deadline=c.deadlineNanos();
        AtomicBoolean live=new AtomicBoolean(true);
        var heartbeat=Executors.newSingleThreadScheduledExecutor(r->{ var t=new Thread(r,"midi-heartbeat"); t.setDaemon(true); return t; });
        heartbeat.scheduleAtFixedRate(()->{
            try { if (System.nanoTime()>=deadline || !queue.heartbeat(c)) live.set(false); }
            catch (RuntimeException e) { live.set(false); }
        },10,10,TimeUnit.SECONDS);
        Path dir=null;
        try {
            dir=Files.createTempDirectory(base,"midi-job-");
            byte[] midi=source.get(c.sourceKey(),c.size(),c.sha256(),deadline);
            if (!live.get() || System.nanoTime()>=deadline) throw new IllegalStateException("임대 만료");
            com.ssafy.airdrum.domain.chart.dto.ChartResponses.Timing timing;
            try { timing=reader.timing(c.timing()); }
            catch (IllegalStateException e) { throw new IllegalArgumentException("저장된 MIDI 시간 정보가 올바르지 않습니다.",e); }
            var result=renderer.render(midi,timing,c.durationMs(),dir,deadline,live::get);
            String key=queue.reserveOutput(c);
            if (key==null || !live.get() || System.nanoTime()>=deadline) throw new IllegalStateException("임대 만료");
            backing.put(key,result.path(),result.size(),result.sha256(),deadline);
            if (live.get() && System.nanoTime()<deadline) queue.complete(c,key);
        } catch (Exception e) {
            if (e instanceof InterruptedException) { Thread.currentThread().interrupt(); throw (InterruptedException)e; }
            boolean retryable=!(e instanceof IllegalArgumentException || e instanceof javax.sound.midi.InvalidMidiDataException);
            try { queue.fail(c,retryable,retryable?"SYNTHESIS_UNAVAILABLE":"SYNTHESIS_INVALID"); }
            catch (RuntimeException ignored) { /* 임대 만료 복구가 재시도한다. */ }
            System.err.println("MIDI 합성 실패 job="+c.job()+" errorType="+e.getClass().getSimpleName());
        } finally {
            live.set(false); heartbeat.shutdownNow();
            if (dir!=null) try (var files=Files.walk(dir)) {
                for (var path:files.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(path);
            } catch (Exception ignored) { System.err.println("MIDI 임시 파일 정리에 실패했습니다."); }
        }
    }
    private static String env(String name,String fallback) { String v=System.getenv(name); return v==null || v.isBlank()?fallback:v; }
    private static String required(String name) { String value=env(name,""); if (value.isBlank()) throw new IllegalStateException(name+" 설정이 필요합니다."); return value; }
    private static String executable(String name) {
        Path path=Path.of(name);
        if (path.isAbsolute() || name.contains("/") || name.contains("\\")) {
            if (Files.isRegularFile(path) && Files.isExecutable(path)) return path.toAbsolutePath().toString();
        } else {
            String extension=System.getProperty("os.name").toLowerCase(java.util.Locale.ROOT).contains("win") && !name.endsWith(".exe") ? ".exe" : "";
            for (String dir:env("PATH","").split(java.util.regex.Pattern.quote(java.io.File.pathSeparator))) {
                Path candidate=Path.of(dir,name+extension);
                if (Files.isRegularFile(candidate) && Files.isExecutable(candidate)) return candidate.toAbsolutePath().toString();
            }
        }
        throw new IllegalStateException("합성 실행 파일을 찾을 수 없습니다.");
    }
}
