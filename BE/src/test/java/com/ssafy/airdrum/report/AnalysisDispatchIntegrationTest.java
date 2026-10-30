package com.ssafy.airdrum.report;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.support.TransactionTemplate;
import com.ssafy.airdrum.play.PlayFixtures;
import com.ssafy.airdrum.play.PlayJson;
import com.ssafy.airdrum.play.PlayUploadService;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(properties={"report.analysis.dispatch-enabled=true","report.analysis.recovery-interval-ms=600000"})
class AnalysisDispatchIntegrationTest {
    static final AtomicInteger calls=new AtomicInteger();
    static final AtomicInteger responseMode=new AtomicInteger();
    static final HttpServer server=start();
    static HttpServer start() {
        try {
            var s=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
            s.createContext("/analysis/weak-segments",exchange -> {
                int count=calls.incrementAndGet(); exchange.getRequestBody().readAllBytes();
                int status=responseMode.get()==400 ? 400 : responseMode.get()==500 && count==1 ? 500 : 200;
                if(status!=200) { byte[] error="{}".getBytes(StandardCharsets.UTF_8); exchange.sendResponseHeaders(status,error.length); exchange.getResponseBody().write(error); exchange.close(); return; }
                byte[] bytes="{\"analyzerVersion\":\"weak-rules-0.1\",\"reason\":\"NO_WEAKNESS\",\"weakSegments\":[]}".getBytes(StandardCharsets.UTF_8);
                if(responseMode.get()==500) bytes="{\"analyzerVersion\":\"future-1\",\"reason\":\"OK\",\"weakSegments\":[{\"fromMs\":1,\"toMs\":2,\"pattern\":\"FUTURE_PATTERN\",\"description\":\"테스트\",\"causeTags\":[],\"pads\":[],\"metrics\":{\"custom\":7}}]}".getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(200,bytes.length); exchange.getResponseBody().write(bytes); exchange.close();
            }); s.start(); return s;
        } catch(java.io.IOException e) { throw new IllegalStateException(e); }
    }
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        registry.add("AI_ANALYSIS_BASE_URL",() -> System.getenv().getOrDefault("TEST_REAL_AI_URL", "http://127.0.0.1:"+server.getAddress().getPort()));
    }
    @AfterAll static void stopServer() { server.stop(0); }
    @Autowired JdbcTemplate db;
    @Autowired PlayUploadService upload;
    @Autowired PlayJson json;
    @Autowired ReportRepository reports;
    @Autowired TransactionTemplate transaction;
    @Autowired AnalysisDispatch dispatch;
    @Autowired AnalysisClient client;
    @Autowired tools.jackson.databind.json.JsonMapper mapper;
    long user,song,chart,version; UUID play;
    @BeforeEach void seed() {
        calls.set(0); responseMode.set(0); play=UUID.randomUUID();
        // 테스트 서버와 HTTP 클라이언트의 첫 기동 비용을 실제 타임아웃 시험과 분리한다.
        if(System.getenv("TEST_REAL_AI_URL")==null) { client.analyze(mapper.createObjectNode()); calls.set(0); }
        user=db.queryForObject("INSERT INTO users(nickname) VALUES('분석 이벤트') RETURNING id",Long.class);
        song=db.queryForObject("INSERT INTO songs(owner_id,title,source) VALUES(?,'곡','MIDI') RETURNING id",Long.class,user);
        chart=db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,'NORMAL') RETURNING id",Long.class,song);
        version=db.queryForObject("""
            INSERT INTO chart_versions(chart_id,version,notes,timing,notation_status,note_count,generator)
            VALUES(?,1,'[{"noteId":"n1","timeMs":100,"pad":"SNARE"},{"noteId":"n2","timeMs":200,"pad":"KICK"}]',
            '{}','PENDING',2,'MANUAL') RETURNING id
            """,Long.class,chart);
    }
    @AfterEach void cleanup() {
        db.update("DELETE FROM play_sessions WHERE user_id=?",user); db.update("DELETE FROM chart_versions WHERE id=?",version);
        db.update("DELETE FROM charts WHERE id=?",chart); db.update("DELETE FROM songs WHERE id=?",song); db.update("DELETE FROM users WHERE id=?",user);
    }
    com.ssafy.airdrum.play.PlayUploadRequest parse(String body) throws Exception {
        return json.read(new java.io.ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
    }
    @Test void committedUploadDispatchesOnceAndReportReturnsResult() throws Exception {
        var request=parse(PlayFixtures.scored(play,song,version));
        assertThat(upload.upload(user,request).created()).isTrue();
        assertThat(upload.upload(user,request).created()).isFalse();
        long deadline=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(10);
        while(System.nanoTime()<deadline && !"DONE".equals(db.queryForObject("SELECT analysis_status FROM reports WHERE play_session_id=?",String.class,play))) Thread.sleep(50);
        var report=reports.find(user,play);
        assertThat(report.analysisStatus()).withFailMessage("status=%s calls=%s row=%s",report.analysisStatus(),calls.get(),db.queryForMap("SELECT analysis_status,analysis_attempt_count,analysis_lease_token FROM reports WHERE play_session_id=?",play)).isEqualTo(ReportResponse.AnalysisStatus.DONE);
        assertThat(report.weakSegments().isArray()).isTrue(); assertThat(report.weakSegments().size()).isZero();
        if(System.getenv("TEST_REAL_AI_URL")==null) assertThat(calls.get()).isEqualTo(1);
    }
    @Test void rolledBackUploadAndFreeModeNeverCallAi() throws Exception {
        org.junit.jupiter.api.Assumptions.assumeTrue(System.getenv("TEST_REAL_AI_URL")==null);
        var request=parse(PlayFixtures.scored(play,song,version));
        transaction.executeWithoutResult(status -> { upload.upload(user,request); status.setRollbackOnly(); });
        assertThat(db.queryForObject("SELECT count(*) FROM reports WHERE play_session_id=?",Integer.class,play)).isZero();
        upload.upload(user,parse(PlayFixtures.free(UUID.randomUUID())));
        Thread.sleep(500);
        assertThat(calls.get()).isZero();
    }
    @Test void retryAndPermanentFailureUseTheCommittedDispatchFlow() throws Exception {
        org.junit.jupiter.api.Assumptions.assumeTrue(System.getenv("TEST_REAL_AI_URL")==null);
        responseMode.set(500);
        upload.upload(user,parse(PlayFixtures.scored(play,song,version)));
        await("PENDING",1);
        db.update("UPDATE reports SET analysis_next_attempt_at=now()-interval '1 second' WHERE play_session_id=?",play);
        dispatch.recover(); await("DONE",2);
        var result=reports.find(user,play);
        assertThat(result.weakSegments().get(0).path("pattern").asString()).isEqualTo("FUTURE_PATTERN");
        assertThat(result.weakSegments().get(0).path("metrics").path("custom").asInt()).isEqualTo(7);
        assertThat(calls.get()).isEqualTo(2);
        play=UUID.randomUUID(); responseMode.set(400); calls.set(0);
        upload.upload(user,parse(PlayFixtures.scored(play,song,version))); await("FAILED",1);
        dispatch.recover(); Thread.sleep(300); assertThat(calls.get()).isEqualTo(1);
        assertThat(reports.find(user,play).weakSegments()).isNull();
    }
    private void await(String state,int count) throws Exception {
        long until=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(10);
        while(System.nanoTime()<until) {
            var row=db.queryForMap("SELECT analysis_status,analysis_attempt_count,analysis_lease_token FROM reports WHERE play_session_id=?",play);
            if(state.equals(row.get("analysis_status")) && ((Number)row.get("analysis_attempt_count")).intValue()==count && row.get("analysis_lease_token")==null) return;
            Thread.sleep(50);
        }
        throw new AssertionError("분석 상태 전환 시간 초과: "+state+" calls="+calls.get()+" row="+db.queryForMap("SELECT analysis_status,analysis_attempt_count,analysis_lease_token FROM reports WHERE play_session_id=?",play));
    }

    @Test void actualAiSamplesPersistThroughUploadAndReport() throws Exception {
        org.junit.jupiter.api.Assumptions.assumeTrue(System.getenv("TEST_REAL_AI_URL")!=null);
        var samples=mapper.readTree(java.nio.file.Files.readAllBytes(java.nio.file.Path.of(System.getenv("TEST_AI_SAMPLES"))));
        for(String sample:java.util.List.of("A","B","C")) {
            play=UUID.randomUUID();
            var request=samples.path(sample).path("request"); var notes=mapper.createArrayNode();
            int perfect=0,good=0,miss=0,combo=0,maxCombo=0;
            for(var hit:request.path("hits")) {
                String judgement=hit.path("judgement").asString();
                if(hit.path("judgement").isNull() || hit.path("judgement").isMissingNode()) continue;
                var note=mapper.createObjectNode(); note.put("noteId",hit.path("matchedNoteId").asString());
                note.put("pad",hit.path("pad").asString());
                note.put("timeMs",hit.path("tMs").asDouble()-("MISS".equals(judgement)?0:hit.path("deltaMs").asDouble())); notes.add(note);
                if("MISS".equals(judgement)) { miss++; combo=0; }
                else { if("GOOD".equals(judgement)) good++; else perfect++; maxCombo=Math.max(maxCombo,++combo); }
            }
            db.update("UPDATE chart_versions SET notes=?::jsonb,note_count=? WHERE id=?",mapper.writeValueAsString(notes),notes.size(),version);
            var body=mapper.createObjectNode(); body.put("schemaVersion",1); body.put("playId",play.toString());
            body.put("mode","RHYTHM"); body.put("inputSource","STICK"); body.put("songId",song); body.put("chartVersionId",version);
            body.put("startedAt","2026-10-21T00:00:00Z"); body.put("endedAt","2026-10-21T00:01:00Z"); body.put("consent",false);
            var context=body.putObject("judgementContext"); context.put("schemaVersion",1); context.put("judgementVersion","SCORE_V1");
            context.set("timingWindows",request.path("timingWindows")); context.put("playbackRate",1); context.putObject("padMapping");
            int score=100*perfect+60*good; var summary=body.putObject("summary"); summary.put("score",score);
            summary.put("accuracy",java.math.BigDecimal.valueOf(score).divide(java.math.BigDecimal.valueOf(notes.size()),2,java.math.RoundingMode.HALF_UP));
            summary.put("maxCombo",maxCombo); var counts=summary.putObject("judgementCounts"); counts.put("perfect",perfect); counts.put("good",good); counts.put("miss",miss);
            body.set("hits",request.path("hits")); upload.upload(user,parse(mapper.writeValueAsString(body)));
            long until=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(20);
            while(System.nanoTime()<until && !"DONE".equals(db.queryForObject("SELECT analysis_status FROM reports WHERE play_session_id=?",String.class,play))) {
                dispatch.recover(); Thread.sleep(100);
            }
            var result=reports.find(user,play);
            assertThat(result.analysisStatus()).isEqualTo(ReportResponse.AnalysisStatus.DONE);
            assertThat(result.weakSegments()).isEqualTo(samples.path(sample).path("response").path("weakSegments"));
            assertThat(result.generatorVersion()).isEqualTo("BE_REPORT_V1+weak-rules-0.1");
        }
    }

}
