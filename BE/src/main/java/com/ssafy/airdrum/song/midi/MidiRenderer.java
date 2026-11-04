package com.ssafy.airdrum.song.midi;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import com.ssafy.airdrum.chart.ChartResponses.Timing;

/** 외부 프로세스를 셸 없이 실행하고 시간·작업 디스크·출력 바이트를 제한한다. */
public class MidiRenderer implements AutoCloseable {
    static final long MAX_TEMP=1024L*1024*1024, MAX_OUTPUT=384L*1024*1024;
    private static final int MAX_LOG=64*1024;
    private final String fluidsynth, soundfont, ffmpeg, ffprobe;
    private final long maxTemp, maxOutput;
    private final java.util.concurrent.atomic.AtomicReference<Process> active=new java.util.concurrent.atomic.AtomicReference<>();
    public record Result(Path path,long size,String sha256) {}
    public MidiRenderer(String fluidsynth,String soundfont,String ffmpeg,String ffprobe) {
        this(fluidsynth,soundfont,ffmpeg,ffprobe,MAX_TEMP,MAX_OUTPUT);
    }
    MidiRenderer(String fluidsynth,String soundfont,String ffmpeg,String ffprobe,long maxTemp,long maxOutput) {
        this.fluidsynth=fluidsynth; this.soundfont=soundfont; this.ffmpeg=ffmpeg; this.ffprobe=ffprobe;
        this.maxTemp=maxTemp; this.maxOutput=maxOutput;
    }
    public Result render(byte[] midi, Timing timing,int durationMs,Path dir,long deadline,BooleanSupplier live) throws Exception {
        if (durationMs<=0 || durationMs>1_800_000) throw new IllegalArgumentException("반주 길이가 올바르지 않습니다.");
        Path input=dir.resolve("input.mid"), wave=dir.resolve("render.wav"), result=dir.resolve("output.flac");
        Files.write(input,MidiAccompanimentTiming.retime(midi,timing));
        run(List.of(fluidsynth,"-ni","-r","44100","-R","0","-C","0","-F",wave.toString(),soundfont,input.toString()),dir,deadline,live);
        long samples=(long)durationMs*44100/1000;
        run(List.of(ffmpeg,"-hide_banner","-loglevel","error","-y","-i",wave.toString(),"-af","apad,atrim=end_sample="+samples,
                "-ar","44100","-ac","2","-sample_fmt","s16","-c:a","flac",result.toString()),dir,deadline,live);
        long size=Files.size(result);
        if (size<=0 || size>maxOutput) throw new IllegalArgumentException("반주 크기 제한 초과");
        String probe=run(List.of(ffprobe,"-v","error","-protocol_whitelist","file","-format_whitelist","flac",
                "-select_streams","a:0","-show_entries","stream=codec_name,sample_rate,channels,bits_per_raw_sample,duration_ts,time_base",
                "-of","default=noprint_wrappers=1",result.toString()),dir,deadline,live);
        var fields=new java.util.HashMap<String,String>();
        for (var line:probe.lines().toList()) { int i=line.indexOf('='); if (i>0) fields.put(line.substring(0,i),line.substring(i+1)); }
        if (!"flac".equals(fields.get("codec_name")) || !"44100".equals(fields.get("sample_rate"))
                || !"2".equals(fields.get("channels")) || !"16".equals(fields.get("bits_per_raw_sample"))
                || !"1/44100".equals(fields.get("time_base")) || !Long.toString(samples).equals(fields.get("duration_ts")))
            throw new IllegalArgumentException("FLAC 형식 또는 샘플 수가 올바르지 않습니다.");
        var digest=MessageDigest.getInstance("SHA-256");
        try (var in=Files.newInputStream(result)) {
            byte[] buffer=new byte[65536]; int n;
            while ((n=in.read(buffer))!=-1) { check(deadline,live,dir); digest.update(buffer,0,n); }
        }
        return new Result(result,size,HexFormat.of().formatHex(digest.digest()));
    }
    String run(List<String> command,Path dir,long deadline,BooleanSupplier live) throws Exception {
        check(deadline,live,dir);
        Process process=new ProcessBuilder(command).start();
        active.set(process);
        var out=new LimitedOutput(process.getInputStream());
        var err=new LimitedOutput(process.getErrorStream());
        Thread stdout=Thread.ofVirtual().start(out), stderr=Thread.ofVirtual().start(err);
        try {
            while (!process.waitFor(250,TimeUnit.MILLISECONDS)) check(deadline,live,dir);
            check(deadline,live,dir);
            stdout.join(2000); stderr.join(2000);
            if (process.exitValue()!=0) throw new IllegalArgumentException("합성 프로세스가 입력 또는 설정을 처리하지 못했습니다.");
            return out.text();
        } finally {
            terminate(process);
            active.compareAndSet(process,null);
            try { process.getInputStream().close(); } catch (Exception ignored) {}
            try { process.getErrorStream().close(); } catch (Exception ignored) {}
            try { process.getOutputStream().close(); } catch (Exception ignored) {}
        }
    }
    private static void terminate(Process process) {
        var children=process.descendants().toList();
        children.forEach(ProcessHandle::destroy);
        if (process.isAlive()) process.destroy();
        try { process.waitFor(2,TimeUnit.SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        children.stream().filter(ProcessHandle::isAlive).forEach(ProcessHandle::destroyForcibly);
        if (process.isAlive()) process.destroyForcibly();
        for (var child:children) if (child.isAlive()) try { child.onExit().get(2,TimeUnit.SECONDS); } catch (Exception ignored) {}
    }
    public void close() { var process=active.get(); if (process!=null) terminate(process); }
    private void check(long deadline,BooleanSupplier live,Path dir) throws Exception {
        if (Thread.currentThread().isInterrupted() || System.nanoTime()>=deadline || !live.getAsBoolean())
            throw new IllegalStateException("MIDI 작업 임대 또는 실행 시간이 만료되었습니다.");
        long total=0;
        try (var files=Files.walk(dir)) {
            for (Path path:files.filter(Files::isRegularFile).toList()) {
                long size=Files.size(path); total+=size;
                if (path.getFileName().toString().equals("output.flac") && size>maxOutput) throw new IllegalArgumentException("반주 크기 제한 초과");
                if (total>maxTemp) throw new IllegalArgumentException("임시 공간 제한 초과");
            }
        }
    }
    private static final class LimitedOutput implements Runnable {
        private final InputStream in; private final ByteArrayOutputStream captured=new ByteArrayOutputStream();
        LimitedOutput(InputStream in) { this.in=in; }
        public void run() {
            try (in) {
                byte[] bytes=new byte[4096]; int n;
                while ((n=in.read(bytes))!=-1) { int keep=Math.min(n,MAX_LOG-captured.size()); if (keep>0) captured.write(bytes,0,keep); }
            } catch (Exception ignored) {}
        }
        String text() { return captured.toString(java.nio.charset.StandardCharsets.UTF_8); }
    }
}
