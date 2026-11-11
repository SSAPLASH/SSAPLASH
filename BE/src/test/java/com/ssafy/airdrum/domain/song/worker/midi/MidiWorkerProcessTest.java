package com.ssafy.airdrum.domain.song.worker.midi;

import static org.assertj.core.api.Assertions.assertThat;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import com.ssafy.airdrum.domain.song.service.midi.MidiFixtures;
import com.ssafy.airdrum.domain.song.storage.midi.MidiOriginalStorageConfiguration;

/** 별도 JAR 프로세스가 PG 큐·HTTP 저장소·실제 합성 도구를 거치는 전체 경로다. */
@SpringBootTest(properties={"midi.test.isolated=true","spring.datasource.hikari.schema=public"})
@EnabledIfEnvironmentVariable(named="MIDI_TEST_WORKER_JAR",matches=".+")
class MidiWorkerProcessTest {
    @Autowired JdbcTemplate db;
    @Autowired Environment env;
    @TempDir Path temp;
    long user;
    @AfterEach void cleanup() {
        if (user==0) return;
        db.update("DELETE FROM file_cleanup_tasks WHERE user_id=?",user);
        db.update("DELETE FROM midi_accompaniment_attempts WHERE job_id IN (SELECT id FROM midi_accompaniment_jobs WHERE user_id=?)",user);
        db.update("DELETE FROM midi_accompaniment_jobs WHERE user_id=?",user);
        db.update("DELETE FROM midi_original_uploads WHERE user_id=?",user);
        db.update("DELETE FROM songs WHERE owner_id=?",user);
        db.update("DELETE FROM users WHERE id=?",user);
    }
    @Test void separateWorkerClaimsRendersAndPublishes() throws Exception {
        user=db.queryForObject("INSERT INTO users(nickname) VALUES('worker process') RETURNING id",Long.class);
        long song=db.queryForObject("INSERT INTO songs(owner_id,title,source,duration_ms) VALUES(?,'worker','MIDI',3000) RETURNING id",Long.class,user);
        var original=UUID.randomUUID(); String key="midi-original/"+user+"/"+song+"/"+original+".mid";
        byte[] midi=MidiFixtures.ppq(480).format0().tempo(0,120).drum(0,36).note(480,0,60,100,120).bytes();
        String sha=MidiOriginalStorageConfiguration.MidiS3Store.hash(midi);
        db.update("""
                INSERT INTO midi_original_uploads(id,user_id,reserved_song_id,song_id,object_key,size_bytes,sha256,status,expires_at)
                VALUES(?,?,?,?,?,?,?,'ACCEPTED',clock_timestamp()+interval '30 seconds')
                """,original,user,song,song,key,midi.length,sha);
        long job=db.queryForObject("""
                INSERT INTO midi_accompaniment_jobs(song_id,user_id,original_id,timing,duration_ms,status)
                VALUES(?,?,?,'{"bpm":120,"offsetMs":0,"timeSignature":"4/4","ppq":480,"tempoMap":[{"tick":0,"bpm":120}]}'::jsonb,3000,'QUEUED') RETURNING id
                """,Long.class,song,user,original);
        var objects=new ConcurrentHashMap<String,byte[]>(); objects.put("/originals/"+key,midi);
        var hashes=new ConcurrentHashMap<String,String>();
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0); var pool=Executors.newCachedThreadPool(); server.setExecutor(pool);
        server.createContext("/",exchange->{
            try {
                String path=exchange.getRequestURI().getPath(); String method=exchange.getRequestMethod();
                if (exchange.getRequestURI().getRawQuery()!=null && exchange.getRequestURI().getRawQuery().contains("versioning")) {
                    byte[] xml="<VersioningConfiguration xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\"/>".getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(200,xml.length); exchange.getResponseBody().write(xml);
                } else if (method.equals("PUT")) {
                    objects.put(path,exchange.getRequestBody().readAllBytes());
                    hashes.put(path,exchange.getRequestHeaders().getFirst("x-amz-meta-sha256"));
                    exchange.sendResponseHeaders(200,-1);
                } else if (objects.containsKey(path) && method.equals("GET")) {
                    byte[] bytes=objects.get(path); exchange.sendResponseHeaders(200,bytes.length); exchange.getResponseBody().write(bytes);
                } else if (objects.containsKey(path) && method.equals("HEAD")) {
                    exchange.getResponseHeaders().add("Content-Length",Long.toString(objects.get(path).length));
                    if (hashes.containsKey(path)) exchange.getResponseHeaders().add("x-amz-meta-sha256",hashes.get(path));
                    exchange.sendResponseHeaders(200,-1);
                } else exchange.sendResponseHeaders(404,-1);
            } catch (Exception ignored) {} finally { exchange.close(); }
        });
        server.start(); Path log=temp.resolve("worker.log"); Process child=null;
        try {
            var builder=new ProcessBuilder(Path.of(System.getProperty("java.home"),"bin","java").toString(),"-jar",System.getenv("MIDI_TEST_WORKER_JAR"))
                    .redirectErrorStream(true).redirectOutput(log.toFile());
            var e=builder.environment();
            e.put("DB_URL",env.getProperty("spring.datasource.url")); e.put("DB_USERNAME",env.getProperty("spring.datasource.username"));
            e.put("DB_PASSWORD",env.getProperty("spring.datasource.password"));
            String endpoint="http://127.0.0.1:"+server.getAddress().getPort();
            e.put("MIDI_STORAGE_ENABLED","true"); e.put("MIDI_STORAGE_PRIVATE_BUCKET_CONFIRMED","true");
            e.put("MIDI_STORAGE_ENDPOINT",endpoint); e.put("MIDI_STORAGE_BUCKET","originals");
            e.put("MIDI_STORAGE_ACCESS_KEY","test"); e.put("MIDI_STORAGE_SECRET_KEY","test");
            e.put("CHART_ASSET_ENABLED","true"); e.put("CHART_ASSET_ENDPOINT",endpoint); e.put("CHART_ASSET_ACCOMPANIMENT_BUCKET","backings");
            e.put("WORKER_STORAGE_ACCOMPANIMENT_WRITE_ACCESS_KEY","test"); e.put("WORKER_STORAGE_ACCOMPANIMENT_WRITE_SECRET_KEY","test");
            e.put("MIDI_FLUIDSYNTH_PATH",System.getenv("MIDI_TEST_FLUIDSYNTH")); e.put("MIDI_SOUNDFONT_PATH",System.getenv("MIDI_TEST_SOUNDFONT"));
            e.put("MIDI_FFMPEG_PATH",System.getenv("MIDI_TEST_FFMPEG")); e.put("MIDI_FFPROBE_PATH",System.getenv("MIDI_TEST_FFPROBE"));
            e.put("MIDI_TEMP_DIR",temp.toString());
            child=builder.start(); long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(45); String state="";
            while (System.nanoTime()<end && child.isAlive()) {
                state=db.queryForObject("SELECT status FROM midi_accompaniment_jobs WHERE id=?",String.class,job);
                if (state.equals("DONE") || state.equals("FAILED")) break;
                Thread.sleep(200);
            }
            assertThat(state).as("worker log: %s",Files.readString(log)).isEqualTo("DONE");
            String backing=db.queryForObject("SELECT accompaniment_key FROM songs WHERE id=?",String.class,song);
            assertThat(objects).containsKey("/backings/"+backing);
        } finally {
            if (child!=null && child.isAlive()) { child.destroy(); if (!child.waitFor(5,TimeUnit.SECONDS)) child.destroyForcibly(); }
            server.stop(0); pool.shutdownNow();
        }
    }
}
