package com.ssafy.airdrum.report;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import com.ssafy.airdrum.play.PlayFixtures;
import com.ssafy.airdrum.play.PlayJson;
import com.ssafy.airdrum.play.PlayUploadService;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(properties="report.analysis.test-context=integration")
class AnalysisIntegrationTest {
    @Autowired JdbcTemplate db;
    @Autowired AnalysisRepository repository;
    @Autowired PlayUploadService upload;
    @Autowired PlayJson playJson;
    @Autowired JsonMapper json;
    long user,song,chart,version; UUID play;
    @BeforeEach void seed() {
        user=db.queryForObject("INSERT INTO users(nickname) VALUES('분석 테스트') RETURNING id",Long.class);
        song=db.queryForObject("INSERT INTO songs(owner_id,title,source) VALUES(?,'곡','MIDI') RETURNING id",Long.class,user);
        chart=db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,'NORMAL') RETURNING id",Long.class,song);
        version=db.queryForObject("""
            INSERT INTO chart_versions(chart_id,version,notes,timing,notation_status,note_count,generator)
            VALUES(?,1,'[{"noteId":"n1","timeMs":100,"pad":"SNARE"},{"noteId":"n2","timeMs":200,"pad":"KICK"}]',
            '{}','PENDING',2,'MANUAL') RETURNING id
            """,Long.class,chart);
        play=UUID.randomUUID();
    }
    @AfterEach void cleanup() {
        db.update("DELETE FROM play_sessions WHERE user_id=?",user);
        db.update("DELETE FROM chart_versions WHERE id=?",version);
        db.update("DELETE FROM charts WHERE id=?",chart);
        db.update("DELETE FROM songs WHERE id=?",song);
        db.update("DELETE FROM users WHERE id=?",user);
    }
    private void uploadScored() throws Exception {
        String body=PlayFixtures.scored(play,song,version).replace("]}",",{\"seq\":2,\"tMs\":210,\"pad\":\"KICK\",\"velocity\":90}]}");
        var request=playJson.read(new java.io.ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
        assertThat(upload.upload(user,request).created()).isTrue();
        assertThat(upload.upload(user,request).created()).isFalse();
    }
    @Test void storedHitsAndWindowsAreSentAndEmptyResultPreservesBaseReport() throws Exception {
        uploadScored();
        var request=repository.request(play);
        assertThat(request.path("timingWindows").path("goodMs").asInt()).isEqualTo(60);
        assertThat(request.path("hits").size()).isEqualTo(3);
        assertThat(request.path("hits").get(1).path("judgement").asString()).isEqualTo("MISS");
        assertThat(request.path("hits").get(2).path("judgement").isNull()).isTrue();
        var lease=repository.claim(play); assertThat(lease).isNotNull();
        assertThat(repository.claim(play)).isNull();
        repository.done(lease,"[]","weak-rules-0.1");
        var report=db.queryForMap("SELECT analysis_status,weak_segments::text,generator_version FROM reports WHERE play_session_id=?",play);
        assertThat(report.get("analysis_status")).isEqualTo("DONE");
        assertThat(report.get("weak_segments")).isEqualTo("[]");
        assertThat(report.get("generator_version")).isEqualTo("BE_REPORT_V1+weak-rules-0.1");
    }
    @Test void expiredLeasesRespectBudgetAndIgnoreLateResultsAndDeletion() throws Exception {
        uploadScored(); var first=repository.claim(play);
        db.update("UPDATE reports SET analysis_lease_until=now()-interval '1 second' WHERE play_session_id=?",play);
        var second=repository.claim(play); assertThat(second.attempts()).isEqualTo(2);
        repository.done(first,"[]","old");
        assertThat(db.queryForObject("SELECT analysis_status FROM reports WHERE play_session_id=?",String.class,play)).isEqualTo("PENDING");
        db.update("UPDATE reports SET analysis_lease_until=now()-interval '1 second' WHERE play_session_id=?",play);
        repository.recoverable(); repository.done(second,"[]","late");
        assertThat(db.queryForObject("SELECT analysis_status FROM reports WHERE play_session_id=?",String.class,play)).isEqualTo("FAILED");
        db.update("DELETE FROM play_sessions WHERE id=?",play);
        repository.done(second,"[]","late");
        assertThat(db.queryForObject("SELECT count(*) FROM reports WHERE play_session_id=?",Integer.class,play)).isZero();
    }
    @Test void httpClassifiesAndValidatesResponses() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        AtomicInteger status=new AtomicInteger(500);
        server.createContext("/analysis/weak-segments",exchange -> {
            exchange.getRequestBody().readAllBytes();
            String body=status.get()==200 ? "{\"analyzerVersion\":\"weak-rules-0.1\",\"reason\":\"NO_WEAKNESS\",\"weakSegments\":[]}" : "{}";
            byte[] bytes=body.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status.get(),bytes.length); exchange.getResponseBody().write(bytes); exchange.close();
        });
        server.start();
        try {
            var client=new AnalysisClient("http://127.0.0.1:"+server.getAddress().getPort(),json);
            assertThat(client.analyze(json.createObjectNode()).retryable()).isTrue();
            status.set(400); assertThat(client.analyze(json.createObjectNode()).retryable()).isFalse();
            status.set(200); var result=client.analyze(json.createObjectNode());
            assertThat(result.success()).isTrue(); assertThat(result.segments()).isEqualTo("[]");
        } finally { server.stop(0); }
    }
    @Test void broken400BodyDoesNotBecomeRetryable() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/analysis/weak-segments",exchange -> {
            exchange.getRequestBody().readAllBytes();
            exchange.sendResponseHeaders(400,100); exchange.getResponseBody().write(1); exchange.close();
        });
        server.start();
        try {
            var client=new AnalysisClient("http://127.0.0.1:"+server.getAddress().getPort(),json);
            assertThat(client.analyze(json.createObjectNode()).retryable()).isFalse();
        } finally { server.stop(0); }
    }

    @Test void stalledBodyKeepsStatusBasedRetryPolicy() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        var pool=java.util.concurrent.Executors.newCachedThreadPool();
        server.setExecutor(pool);
        var status=new AtomicInteger(400);
        server.createContext("/analysis/weak-segments",exchange -> {
            exchange.getRequestBody().readAllBytes(); exchange.sendResponseHeaders(status.get(),100);
            try { Thread.sleep(4000); } catch(InterruptedException ex) { Thread.currentThread().interrupt(); }
            exchange.close();
        });
        server.start();
        try {
            var client=new AnalysisClient("http://127.0.0.1:"+server.getAddress().getPort(),json);
            assertThat(client.analyze(json.createObjectNode()).retryable()).isFalse();
            status.set(200); assertThat(client.analyze(json.createObjectNode()).retryable()).isTrue();
        } finally { server.stop(0); pool.shutdownNow(); }
    }

}
