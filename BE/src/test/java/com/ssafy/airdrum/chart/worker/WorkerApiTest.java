package com.ssafy.airdrum.chart.worker;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.nio.file.Files;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import com.ssafy.airdrum.common.error.BusinessException;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(properties={"auth.jwt.secret=test-only-jwt-secret-0123456789ab","auth.refresh-token.store=memory",
    "chart.worker.credentials=worker1=01234567890123456789012345678901,worker2=abcdefghijklmnopqrstuvwxyzABCDEF",
    "chart.worker.recovery-interval-ms=86400000"})
@AutoConfigureMockMvc
class WorkerApiTest {
    static final String T1="01234567890123456789012345678901", T2="abcdefghijklmnopqrstuvwxyzABCDEF";
    static final String HASH="a".repeat(64);
    @Autowired JdbcTemplate db;
    @Autowired MockMvc mvc;
    @Autowired JsonMapper json;
    @Autowired WorkerPayload payload;
    @MockitoSpyBean WorkerQueue queue;
    @Autowired WorkerResults results;
    @Autowired com.ssafy.airdrum.withdrawal.WithdrawalService withdrawals;
    @Autowired WorkerCleanup cleanup;
    @MockitoBean S3WorkerStore store;
    long user,song,job;
    UUID source;
    @BeforeEach void setup() throws Exception {
        user=db.queryForObject("INSERT INTO users(nickname) VALUES ('worker test') RETURNING id",Long.class);
        song=db.queryForObject("INSERT INTO songs(owner_id,title,source,status,duration_ms) VALUES(?,'song','AUDIO','PROCESSING',60000) RETURNING id",Long.class,user);
        job=db.queryForObject("INSERT INTO chart_jobs(song_id,user_id,source_key,idempotency_key,request_hash) VALUES(?,?,'source-audio/test-"+UUID.randomUUID()+"',?,?) RETURNING id",Long.class,song,user,UUID.randomUUID().toString(),HASH);
        source=UUID.randomUUID();
        String key=db.queryForObject("SELECT source_key FROM chart_jobs WHERE id=?",String.class,job);
        db.update("INSERT INTO audio_uploads(id,user_id,job_id,object_key,content_type,size_bytes,sha256,duration_ms,status,expires_at) VALUES(?,?,?,?,'audio/wav',100,?,60000,'ACCEPTED',now()+interval '1 hour')",source,user,job,key,HASH);
        when(store.exists(any(),anyString())).thenReturn(true);
        when(store.signGet(any(),anyString())).thenReturn(new WorkerStore.Signed("https://store.test/get",Instant.now().plusSeconds(600)));
        when(store.signPut(anyString(),anyLong())).thenReturn(new WorkerStore.Signed("https://store.test/put",Instant.now().plusSeconds(600)));
        when(store.inspectFlac(anyString(),anyLong(),anyString(),anyInt())).thenAnswer(i->new WorkerStore.Verified(Files.createTempFile("worker-test-",".flac"),i.getArgument(1),i.getArgument(2),i.getArgument(3)));
    }
    @AfterEach void clean() {
        db.update("DELETE FROM chart_job_results WHERE job_id=?",job);
        db.update("DELETE FROM file_cleanup_tasks WHERE job_id=? OR user_id=?",job,user);
        db.update("DELETE FROM chart_worker_files WHERE job_id=?",job);
        db.update("DELETE FROM audio_uploads WHERE user_id=?",user);
        db.update("UPDATE chart_jobs SET status='FAILED',finished_at=coalesce(finished_at,now()),current_attempt_id=NULL WHERE id=?",job);
        db.update("DELETE FROM chart_job_attempts WHERE job_id=?",job);
        db.update("DELETE FROM chart_jobs WHERE id=?",job);
        db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT id FROM charts WHERE song_id=?)",song);
        db.update("DELETE FROM charts WHERE song_id=?",song);
        db.update("DELETE FROM songs WHERE id=?",song);
        db.update("DELETE FROM users WHERE id=?",user);
    }
    String raw(String path,String token,Object body,int status) throws Exception {
        return mvc.perform(post("/internal/v1/chart-jobs"+path).header("Authorization","Bearer "+token)
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body)))
                .andExpect(status().is(status)).andReturn().getResponse().getContentAsString();
    }
    JsonNode claim(String worker,String token,UUID request,int status) throws Exception {
        String response=raw("/claim",token,Map.of("workerId",worker,"claimRequestId",request),status);
        return response.isEmpty()?null:json.readTree(response);
    }
    UUID attempt(JsonNode assignment) { return UUID.fromString(assignment.path("attemptId").asString()); }
    String path(String endpoint) { return "/"+job+endpoint; }
    Map<String,Object> event(UUID attempt,long seq,int progress) { return Map.of("attemptId",attempt,"eventSeq",seq,"progress",progress); }
    Map<String,Object> envelope(UUID attempt,UUID id,Object result) {
        JsonNode tree=json.valueToTree(result);
        return Map.of("contractVersion",1,"jobId",job,"attemptId",attempt,"resultId",id,"payloadHash",payload.hash(tree),"result",result);
    }
    Map<String,Object> manifest(UUID file) { return Map.of("fileId",file,"contentType","audio/flac","sizeBytes",100,"sha256",HASH); }
    Map<String,Object> separation(UUID drum,UUID backing) {
        Map<String,Object> m=new HashMap<>(); m.put("loadMs",1); m.put("separateMs",2); m.put("peakVramMb",null); m.put("peakRamMb",5.5);
        return Map.of("drumStem",manifest(drum),"accompaniment",manifest(backing),"durationMs",60000,"audioTimeOrigin","SOURCE_START",
                "model",Map.of("name","bs_roformer_sw","version","BS-Rofo-SW-Fixed.ckpt@44e34c8199f9"),"metrics",m);
    }
    List<UUID> outputs(UUID attempt) throws Exception {
        var req=Map.of("attemptId",attempt,"files",List.of(Map.of("role","DRUM_STEM","sizeBytes",100),Map.of("role","ACCOMPANIMENT","sizeBytes",100)));
        var result=json.readTree(raw(path("/file-access"),T1,req,200));
        return List.of(UUID.fromString(result.path("files").get(0).path("fileId").asString()),UUID.fromString(result.path("files").get(1).path("fileId").asString()));
    }
    Map<String,Object> transcription() {
        return Map.of("schemaVersion",1,"generator","ADT_MODEL","generatorVersion","test-v1","metrics",Map.of("durationMs",2),
            "charts",List.of(Map.of("difficulty","NORMAL","notationStatus","UNAVAILABLE",
                "notes",List.of(Map.of("noteId","n1","timeMs",100,"pad","SNARE")),
                "timing",Map.of("bpm",120,"offsetMs",0,"timeSignature","4/4"))));
    }
    @Test void authAndConcurrentClaimReplayAndFencing() throws Exception {
        mvc.perform(post("/internal/v1/chart-jobs/claim").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isUnauthorized()).andExpect(content().contentTypeCompatibleWith("application/problem+json"))
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED")).andExpect(jsonPath("$.instance").value("/internal/v1/chart-jobs/claim"));
        var request=UUID.randomUUID();
        var gate=new CountDownLatch(1);
        try(var pool=Executors.newFixedThreadPool(2)) {
            var a=pool.submit(()->{gate.await();return queue.claim("worker1",request);});
            var b=pool.submit(()->{gate.await();return queue.claim("worker1",request);}); gate.countDown();
            assertThat(a.get(20,TimeUnit.SECONDS).attemptId()).isEqualTo(b.get(20,TimeUnit.SECONDS).attemptId());
        }
        var first=claim("worker1",T1,request,200); UUID id=attempt(first);
        assertThat(first.path("input").path("durationMs").isIntegralNumber()).isTrue();
        assertThat(first.path("input").path("durationMs").asInt()).isEqualTo(60000);
        raw(path("/heartbeat"),T2,event(id,1,10),409);
        raw(path("/heartbeat"),T1,event(id,2,20),200);
        var expiry=db.queryForObject("SELECT lease_expires_at FROM chart_job_attempts WHERE id=?",java.sql.Timestamp.class,id);
        raw(path("/heartbeat"),T1,event(id,1,1),200);
        assertThat(db.queryForObject("SELECT lease_expires_at FROM chart_job_attempts WHERE id=?",java.sql.Timestamp.class,id)).isEqualTo(expiry);
        db.update("UPDATE chart_job_attempts SET lease_expires_at=created_at+interval '1 microsecond' WHERE id=?",id);
        queue.recover(); db.update("UPDATE chart_jobs SET next_attempt_at=now() WHERE id=?",job);
        var second=claim("worker2",T2,UUID.randomUUID(),200);
        assertThat(attempt(second)).isNotEqualTo(id);
        assertThat(second.path("input").path("durationMs").asInt()).isEqualTo(60000);
        raw(path("/heartbeat"),T1,event(id,3,21),409);
        claim("worker1",T1,request,409);
    }
    @Test void resultsAreAtomicAndReplayAfterLeaseExpiry() throws Exception {
        UUID id=attempt(claim("worker1",T1,UUID.randomUUID(),200));
        var files=outputs(id); var sep=envelope(id,UUID.randomUUID(),separation(files.get(0),files.get(1)));
        var receipt=raw(path("/results/separation"),T1,sep,200);
        assertThat(json.readTree(receipt).path("jobStatus").asString()).isEqualTo("TRANSCRIBING");
        var result=envelope(id,UUID.randomUUID(),transcription());
        String completed=raw(path("/results/transcription"),T1,result,200);
        assertThat(json.readTree(completed).path("jobStatus").asString()).isEqualTo("DONE");
        assertThat(raw(path("/results/transcription"),T1,result,200)).isEqualTo(completed);
        var altered=new HashMap<>(result); altered.put("result",Map.of("different",true));
        raw(path("/results/transcription"),T1,altered,409);
        assertThat(db.queryForObject("SELECT count(*) FROM chart_versions v JOIN charts c ON c.id=v.chart_id WHERE c.song_id=?",Integer.class,song)).isEqualTo(1);
        assertThat(db.queryForObject("SELECT progress FROM chart_jobs WHERE id=?",Integer.class,job)).isEqualTo(100);
        assertThat(db.queryForObject("SELECT metrics->'transcription'->>'durationMs' FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo("2");
    }
    @Test void invalidResultCommitsFailureAndStorageOutageDoesNot() throws Exception {
        UUID id=attempt(claim("worker1",T1,UUID.randomUUID(),200)); var files=outputs(id);
        var good=envelope(id,UUID.randomUUID(),separation(files.get(0),files.get(1)));
        when(store.inspectFlac(anyString(),anyLong(),anyString(),anyInt())).thenThrow(new BusinessException(WorkerError.UNAVAILABLE));
        raw(path("/results/separation"),T1,good,503);
        assertThat(db.queryForObject("SELECT status FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo("SEPARATING");
        var invalid=separation(files.get(0),files.get(1)); var bad=new HashMap<>(invalid); bad.put("durationMs",1);
        raw(path("/results/separation"),T1,envelope(id,UUID.randomUUID(),bad),422);
        assertThat(db.queryForObject("SELECT status FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo("FAILED");
        assertThat(db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE job_id=?",Integer.class,job)).isGreaterThanOrEqualTo(3);
    }
    @Test void invalidActualFlacCommitsFailureAndCleanup() throws Exception {
        UUID id=attempt(claim("worker1",T1,UUID.randomUUID(),200)); var files=outputs(id);
        var result=envelope(id,UUID.randomUUID(),separation(files.get(0),files.get(1)));
        when(store.inspectFlac(anyString(),anyLong(),anyString(),anyInt())).thenThrow(new BusinessException(WorkerError.RESULT_INVALID));
        raw(path("/results/separation"),T1,result,422);
        assertThat(db.queryForObject("SELECT status FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo("FAILED");
        assertThat(db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE job_id=?",Integer.class,job)).isGreaterThanOrEqualTo(3);
        assertThat(db.queryForObject("SELECT count(*) FROM chart_job_results WHERE job_id=?",Integer.class,job)).isZero();
    }
    @Test void checkpointRetryUsesDrumAndRejectsDeletedSong() throws Exception {
        UUID request=UUID.randomUUID();
        var initial=claim("worker1",T1,request,200);
        assertThat(initial.path("input").path("role").asString()).isEqualTo("SOURCE_AUDIO");
        assertThat(initial.path("input").path("durationMs").asInt()).isEqualTo(60000);
        UUID id=attempt(initial); var files=outputs(id);
        raw(path("/results/separation"),T1,envelope(id,UUID.randomUUID(),separation(files.get(0),files.get(1))),200);
        var replay=claim("worker1",T1,request,200);
        assertThat(replay.path("input").path("role").asString()).isEqualTo("DRUM_STEM");
        assertThat(replay.path("input").path("durationMs").asInt()).isEqualTo(60000);
        raw(path("/failure"),T1,Map.of("attemptId",id,"eventSeq",1,"stage","TRANSCRIBING","code","MODEL_FAILED","retryable",true,"summary","OOM"),200);
        db.update("UPDATE chart_jobs SET next_attempt_at=now() WHERE id=?",job);
        var next=claim("worker2",T2,UUID.randomUUID(),200);
        assertThat(next.path("resumeStage").asString()).isEqualTo("TRANSCRIBING");
        assertThat(next.path("input").path("role").asString()).isEqualTo("DRUM_STEM");
        assertThat(next.path("input").path("durationMs").asInt()).isEqualTo(60000);
        db.update("UPDATE songs SET deleted_at=now() WHERE id=?",song);
        raw(path("/heartbeat"),T2,event(attempt(next),1,55),409);
        queue.recover();
        assertThat(db.queryForObject("SELECT status FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo("FAILED");
    }

    @Test void differentWorkersRacingClaimCannotBothOwnJob() throws Exception {
        var gate=new CountDownLatch(1);
        try(var pool=Executors.newFixedThreadPool(2)) {
            var a=pool.submit(()->{gate.await();return queue.claim("worker1",UUID.randomUUID());});
            var b=pool.submit(()->{gate.await();return queue.claim("worker2",UUID.randomUUID());});
            gate.countDown(); var one=a.get(20,TimeUnit.SECONDS); var two=b.get(20,TimeUnit.SECONDS);
            assertThat((one==null?0:1)+(two==null?0:1)).isEqualTo(1);
        }
        assertThat(db.queryForObject("SELECT count(*) FROM chart_job_attempts WHERE job_id=? AND finished_at IS NULL",Integer.class,job)).isEqualTo(1);
    }
    @Test void expiredAttemptCannotAccessFilesOrSubmitResult() throws Exception {
        UUID old=attempt(claim("worker1",T1,UUID.randomUUID(),200)); var files=outputs(old);
        var stale=envelope(old,UUID.randomUUID(),separation(files.get(0),files.get(1)));
        db.update("UPDATE chart_job_attempts SET lease_expires_at=created_at+interval '1 microsecond' WHERE id=?",old);
        queue.recover(); db.update("UPDATE chart_jobs SET next_attempt_at=now() WHERE id=?",job);
        claim("worker2",T2,UUID.randomUUID(),200);
        raw(path("/file-access"),T1,Map.of("attemptId",old,"files",List.of(Map.of("role","SOURCE_AUDIO","fileId",source))),409);
        raw(path("/results/separation"),T1,stale,409);
        assertThat(db.queryForObject("SELECT count(*) FROM chart_job_results WHERE job_id=?",Integer.class,job)).isZero();
    }
    @Test void heartbeatNeverExtendsStageDeadline() throws Exception {
        UUID id=attempt(claim("worker1",T1,UUID.randomUUID(),200));
        var deadline=db.queryForObject("SELECT stage_deadline_at FROM chart_jobs WHERE id=?",java.sql.Timestamp.class,job);
        raw(path("/heartbeat"),T1,event(id,1,40),200);
        assertThat(db.queryForObject("SELECT stage_deadline_at FROM chart_jobs WHERE id=?",java.sql.Timestamp.class,job)).isEqualTo(deadline);
        db.update("UPDATE chart_jobs SET stage_deadline_at=now()-interval '1 second' WHERE id=?",job);
        raw(path("/heartbeat"),T1,event(id,2,41),409);
        queue.recover();
        assertThat(db.queryForObject("SELECT status FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo("FAILED");
    }
    @Test void withdrawalDuringPromotionDoesNotCommitResult() throws Exception {
        UUID id=attempt(claim("worker1",T1,UUID.randomUUID(),200)); var files=outputs(id);
        doAnswer(i->{ db.update("UPDATE users SET status='WITHDRAWN',withdrawn_at=now() WHERE id=?",user); return null; })
            .when(store).promote(any(),eq(WorkerStore.Bucket.AUDIO),anyString());
        raw(path("/results/separation"),T1,envelope(id,UUID.randomUUID(),separation(files.get(0),files.get(1))),409);
        assertThat(db.queryForObject("SELECT count(*) FROM chart_job_results WHERE job_id=?",Integer.class,job)).isZero();
        assertThat(db.queryForObject("SELECT accompaniment_key FROM songs WHERE id=?",String.class,song)).isNull();
        queue.recover();
        assertThat(db.queryForObject("SELECT status FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo("FAILED");
    }
    @Test void deletionAndLeaseExpiryDuringPromotionCannotReviveSong() throws Exception {
        UUID id=attempt(claim("worker1",T1,UUID.randomUUID(),200)); var files=outputs(id);
        doAnswer(i->{ db.update("UPDATE songs SET deleted_at=now() WHERE id=?",song); db.update("UPDATE chart_job_attempts SET lease_expires_at=created_at+interval '1 microsecond' WHERE id=?",id); return null; })
            .when(store).promote(any(),eq(WorkerStore.Bucket.AUDIO),anyString());
        raw(path("/results/separation"),T1,envelope(id,UUID.randomUUID(),separation(files.get(0),files.get(1))),409);
        assertThat(db.queryForObject("SELECT count(*) FROM chart_job_results WHERE job_id=?",Integer.class,job)).isZero();
        assertThat(db.queryForObject("SELECT accompaniment_key FROM songs WHERE id=?",String.class,song)).isNull();
        queue.recover();
        assertThat(db.queryForObject("SELECT status FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo("FAILED");
    }

    @Test void realWithdrawalAfterCommitRegistersCleanup() throws Exception {
        UUID id=attempt(claim("worker1",T1,UUID.randomUUID(),200)); outputs(id);
        withdrawals.withdraw(user);
        assertThat(db.queryForObject("SELECT status FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo("FAILED");
        assertThat(db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE job_id=?",Integer.class,job)).isGreaterThanOrEqualTo(3);
        raw(path("/heartbeat"),T1,event(id,1,1),409);
    }

    @Test void simultaneousIdenticalResultReturnsReceiptEvenAfterStageAdvances() throws Exception {
        UUID id=attempt(claim("worker1",T1,UUID.randomUUID(),200)); var files=outputs(id);
        var request=json.valueToTree(envelope(id,UUID.randomUUID(),separation(files.get(0),files.get(1))));
        var calls=new java.util.concurrent.atomic.AtomicInteger(); var waiting=new CountDownLatch(1); var release=new CountDownLatch(1);
        doAnswer(i -> {
            if(calls.incrementAndGet()==2) { waiting.countDown(); if(!release.await(20,TimeUnit.SECONDS)) throw new IllegalStateException("timeout"); }
            return i.callRealMethod();
        }).when(queue).valid(eq(job),eq(id),eq("worker1"),eq("SEPARATING"));
        try(var pool=Executors.newSingleThreadExecutor()) {
            var delayed=pool.submit(()->results.separation(job,"worker1",request));
            assertThat(waiting.await(20,TimeUnit.SECONDS)).isTrue();
            try {
                var accepted=results.separation(job,"worker1",request);
                release.countDown();
                assertThat(delayed.get(20,TimeUnit.SECONDS)).isEqualTo(accepted);
            } finally { release.countDown(); }
        }
        assertThat(db.queryForObject("SELECT count(*) FROM chart_job_results WHERE job_id=?",Integer.class,job)).isEqualTo(1);
    }
}
