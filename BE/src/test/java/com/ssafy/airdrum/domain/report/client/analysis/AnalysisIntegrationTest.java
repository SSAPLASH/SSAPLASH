package com.ssafy.airdrum.domain.report.client.analysis;

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
import com.ssafy.airdrum.domain.report.event.AnalysisRequested;
import com.ssafy.airdrum.domain.report.repository.AnalysisRepository;
import com.ssafy.airdrum.domain.report.service.analysis.AnalysisDispatch;
import com.ssafy.airdrum.domain.play.support.PlayFixtures;
import com.ssafy.airdrum.domain.play.model.PlayJson;
import com.ssafy.airdrum.domain.play.service.upload.PlayUploadService;
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
        assertThat(request.get("playbackRate").asDouble()).isEqualTo(1);
        db.update("UPDATE play_sessions SET judgement_context=jsonb_set(judgement_context,'{playbackRate}','0.7') WHERE id=?",play);
        assertThat(repository.request(play).get("playbackRate").asDouble()).isEqualTo(0.7);
        db.update("UPDATE play_sessions SET judgement_context=judgement_context - 'playbackRate' WHERE id=?",play);
        assertThat(repository.request(play).get("playbackRate").asDouble()).isEqualTo(1);
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
    /** AI 응답의 항목에 BE가 모르는 선택 필드(tip)가 있어도 거절·삭제 없이 저장된다(weak-rules-0.2). */
    @Test void tipFieldFromAiSurvivesClientValidationAndStorage() throws Exception {
        String tip="스틱을 미리 올려 두고, 박 소리가 들리는 순간 내려쳐 보세요. 느린 템포부터 시작하면 감이 빨리 와요.";
        String aiResponse="""
            {"analyzerVersion":"weak-rules-0.2","reason":"OK","weakSegments":[
              {"fromMs":2000.0,"toMs":14501.0,"pattern":"TIMING_LATE","description":"전체적으로 평균 22ms 늦게 치고 있어요.",
               "tip":"%s","causeTags":["LATE","OVERALL"],"pads":["HIHAT","SNARE"],
               "metrics":{"severity":0.36,"meanDeltaMs":21.7,"hitCount":22,"scope":"WHOLE"}},
              {"fromMs":7000.0,"toMs":12000.0,"pattern":"SOMETHING_NEW","description":"새 패턴이에요.",
               "causeTags":["NEW"],"pads":["SNARE"],"metrics":{"severity":0.5,"scope":"SEGMENT"}}]}
            """.formatted(tip);
        uploadScored();
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/analysis/weak-segments",exchange -> {
            exchange.getRequestBody().readAllBytes();
            byte[] bytes=aiResponse.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200,bytes.length); exchange.getResponseBody().write(bytes); exchange.close();
        });
        server.start();
        try {
            var client=new AnalysisClient("http://127.0.0.1:"+server.getAddress().getPort(),json);
            var result=client.analyze(repository.request(play));
            assertThat(result.success()).isTrue();
            assertThat(result.version()).isEqualTo("weak-rules-0.2");
            var lease=repository.claim(play); assertThat(lease).isNotNull();
            repository.done(lease,result.segments(),result.version());
        } finally { server.stop(0); }
        var stored=json.readTree(db.queryForObject("SELECT weak_segments::text FROM reports WHERE play_session_id=?",String.class,play));
        assertThat(stored.size()).isEqualTo(2);
        assertThat(stored.get(0).path("tip").asString()).isEqualTo(tip);
        assertThat(stored.get(0).path("description").asString()).isEqualTo("전체적으로 평균 22ms 늦게 치고 있어요.");
        assertThat(stored.get(1).has("tip")).isFalse();
        assertThat(db.queryForObject("SELECT generator_version FROM reports WHERE play_session_id=?",String.class,play))
            .isEqualTo("BE_REPORT_V1+weak-rules-0.2");
    }
    @Test void transportFailureAfter400HeadersDoesNotBecomeRetryable() {
        var builder=org.mockito.Mockito.mock(java.net.http.HttpClient.Builder.class);
        var http=org.mockito.Mockito.mock(java.net.http.HttpClient.class);
        var info=org.mockito.Mockito.mock(java.net.http.HttpResponse.ResponseInfo.class);
        org.mockito.Mockito.when(builder.version(org.mockito.ArgumentMatchers.any())).thenReturn(builder);
        org.mockito.Mockito.when(builder.connectTimeout(org.mockito.ArgumentMatchers.any())).thenReturn(builder);
        org.mockito.Mockito.when(builder.build()).thenReturn(http);
        org.mockito.Mockito.when(info.statusCode()).thenReturn(400);
        org.mockito.Mockito.when(http.sendAsync(org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.<java.net.http.HttpResponse.BodyHandler<byte[]>>any()))
            .thenAnswer(invocation -> {
                java.net.http.HttpResponse.BodyHandler<byte[]> handler=invocation.getArgument(1);
                handler.apply(info);
                return java.util.concurrent.CompletableFuture.failedFuture(new java.io.IOException("transport failed"));
            });
        try (var factory=org.mockito.Mockito.mockStatic(java.net.http.HttpClient.class)) {
            factory.when(java.net.http.HttpClient::newBuilder).thenReturn(builder);
            var client=new AnalysisClient("http://127.0.0.1:1",json);
            assertThat(client.analyze(json.createObjectNode()).retryable()).isFalse();
        }
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


    @Test void transientRequestFailureRetriesAndCompletes() throws Exception {
        transientFailureRetries(false);
    }
    @Test void recoverableDoneFailureRetriesAndCompletes() throws Exception {
        transientFailureRetries(true);
    }
    private void transientFailureRetries(boolean duringDone) throws Exception {
        uploadScored();
        var repo=org.mockito.Mockito.spy(new AnalysisRepository(db,json));
        var client=org.mockito.Mockito.mock(AnalysisClient.class);
        org.mockito.Mockito.when(client.analyze(org.mockito.ArgumentMatchers.any())).thenReturn(new AnalysisClient.Result(true,false,"test","[]"));
        if (duringDone) {
            org.mockito.Mockito.doThrow(new org.springframework.dao.RecoverableDataAccessException("temporary"))
                .doCallRealMethod().when(repo).done(org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.anyString(),org.mockito.ArgumentMatchers.anyString());
        } else {
            org.mockito.Mockito.doThrow(new org.springframework.dao.TransientDataAccessResourceException("temporary"))
                .doCallRealMethod().when(repo).request(play);
        }
        var dispatch=new AnalysisDispatch(repo,client);
        try {
            dispatch.afterCommit(new AnalysisRequested(play));
            awaitAnalysis("PENDING",1);
            db.update("UPDATE reports SET analysis_next_attempt_at=now()-interval '1 second' WHERE play_session_id=?",play);
            dispatch.recover();
            awaitAnalysis("DONE",2);
        } finally { dispatch.stop(); }
    }
    @Test void secondTransientFailureAndPermanentFailureAreFinal() throws Exception {
        uploadScored();
        var repo=org.mockito.Mockito.spy(new AnalysisRepository(db,json));
        var client=org.mockito.Mockito.mock(AnalysisClient.class);
        org.mockito.Mockito.doThrow(new org.springframework.dao.TransientDataAccessResourceException("temporary")).when(repo).request(play);
        var dispatch=new AnalysisDispatch(repo,client);
        try {
            dispatch.afterCommit(new AnalysisRequested(play));
            awaitAnalysis("PENDING",1);
            db.update("UPDATE reports SET analysis_next_attempt_at=now()-interval '1 second' WHERE play_session_id=?",play);
            dispatch.recover();
            awaitAnalysis("FAILED",2);
        } finally { dispatch.stop(); }
        db.update("UPDATE reports SET analysis_status='PENDING',analysis_attempt_count=0,analysis_next_attempt_at=NULL WHERE play_session_id=?",play);
        var permanentRepo=org.mockito.Mockito.spy(new AnalysisRepository(db,json));
        org.mockito.Mockito.doThrow(new IllegalStateException("permanent")).when(permanentRepo).request(play);
        var permanentDispatch=new AnalysisDispatch(permanentRepo,client);
        try {
            permanentDispatch.afterCommit(new AnalysisRequested(play));
            awaitAnalysis("FAILED",1);
        } finally { permanentDispatch.stop(); }
    }
    private void awaitAnalysis(String state,int attempts) throws Exception {
        long until=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(8);
        while(System.nanoTime()<until) {
            var row=db.queryForMap("SELECT analysis_status,analysis_attempt_count,analysis_lease_token FROM reports WHERE play_session_id=?",play);
            if(state.equals(row.get("analysis_status")) && ((Number)row.get("analysis_attempt_count")).intValue()==attempts && row.get("analysis_lease_token")==null) return;
            if ("FAILED".equals(row.get("analysis_status")) && !"FAILED".equals(state)) throw new AssertionError("Expected "+state+", got "+row);
            Thread.sleep(30);
        }
        throw new AssertionError("Expected "+state+", got "+db.queryForMap("SELECT analysis_status,analysis_attempt_count,analysis_lease_token FROM reports WHERE play_session_id=?",play));
    }
}
