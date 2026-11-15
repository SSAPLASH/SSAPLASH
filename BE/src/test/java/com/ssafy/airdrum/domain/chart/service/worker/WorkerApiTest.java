package com.ssafy.airdrum.domain.chart.service.worker;

import com.ssafy.airdrum.domain.chart.scheduler.WorkerCleanup;
import com.ssafy.airdrum.domain.chart.storage.worker.S3WorkerStore;
import com.ssafy.airdrum.domain.chart.storage.worker.WorkerStore;
import com.ssafy.airdrum.global.worker.WorkerError;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import com.ssafy.airdrum.global.error.BusinessException;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.util.ReflectionTestUtils;
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
    @Autowired com.ssafy.airdrum.domain.auth.service.token.AccessTokenService tokens;
    @Autowired com.ssafy.airdrum.domain.chart.service.query.ChartQueryService charts;
    @MockitoSpyBean WorkerQueue queue;
    @Autowired WorkerResults results;
    @Autowired org.springframework.transaction.PlatformTransactionManager transactionManager;
    @Autowired com.ssafy.airdrum.domain.withdrawal.service.WithdrawalService withdrawals;
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
        db.update("UPDATE songs SET song_level=NULL,level_chart_version_id=NULL,level_rule_version=NULL,level_duration_ms=NULL WHERE id=?",song);
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
    @Test void claimSkipsLockedSong() throws Exception { assertClaimSkipsLockedCandidate("songs", false); }
    @Test void claimSkipsLockedUser() throws Exception { assertClaimSkipsLockedCandidate("users", false); }
    @Test void recoverySkipsLockedExpiredCandidate() throws Exception { assertClaimSkipsLockedCandidate("songs", true); }

    private void assertClaimSkipsLockedCandidate(String table, boolean expired) throws Exception {
        long otherUser=db.queryForObject("INSERT INTO users(nickname) VALUES ('other worker') RETURNING id",Long.class);
        long otherSong=db.queryForObject("INSERT INTO songs(owner_id,title,source,status,duration_ms) VALUES(?,'other','AUDIO','PROCESSING',60000) RETURNING id",Long.class,otherUser);
        String otherKey="source-audio/"+UUID.randomUUID();
        long otherJob=db.queryForObject("INSERT INTO chart_jobs(song_id,user_id,source_key,idempotency_key,request_hash) VALUES(?,?,?,?,?) RETURNING id",Long.class,otherSong,otherUser,otherKey,UUID.randomUUID().toString(),HASH);
        db.update("INSERT INTO audio_uploads(id,user_id,job_id,object_key,content_type,size_bytes,sha256,duration_ms,status,expires_at) VALUES(?,?,?,?,'audio/wav',100,?,60000,'ACCEPTED',now()+interval '1 hour')",UUID.randomUUID(),otherUser,otherJob,otherKey,HASH);
        if(expired) db.update("UPDATE chart_jobs SET queued_at=now()-interval '31 minutes' WHERE id=?",job);
        var acquired=new CountDownLatch(1); var release=new CountDownLatch(1);
        try(var pool=Executors.newFixedThreadPool(2)) {
            var locker=pool.submit(()->{
                var tx=new org.springframework.transaction.support.TransactionTemplate(transactionManager);
                tx.executeWithoutResult(x->{
                    db.queryForObject("SELECT id FROM "+table+" WHERE id=? FOR UPDATE",Long.class,table.equals("users")?user:song);
                    acquired.countDown();
                    try { if(!release.await(20,TimeUnit.SECONDS)) throw new IllegalStateException("잠금 해제 시간 초과"); }
                    catch(InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
                });
            });
            try {
                assertThat(acquired.await(10,TimeUnit.SECONDS)).isTrue();
                var claim=pool.submit(()->queue.claim("worker1",UUID.randomUUID()));
                assertThat(claim.get(3,TimeUnit.SECONDS).jobId()).isEqualTo(otherJob);
            } finally { release.countDown(); locker.get(10,TimeUnit.SECONDS); }
            if(expired) {
                queue.recover();
                assertThat(db.queryForObject("SELECT status FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo("FAILED");
            } else {
                assertThat(queue.claim("worker2",UUID.randomUUID()).jobId()).isEqualTo(job);
            }
        } finally {
            db.update("DELETE FROM audio_uploads WHERE user_id=?",otherUser);
            db.update("UPDATE chart_jobs SET status='FAILED',finished_at=coalesce(finished_at,now()),current_attempt_id=NULL WHERE id=?",otherJob);
            db.update("DELETE FROM chart_job_attempts WHERE job_id=?",otherJob);
            db.update("DELETE FROM chart_jobs WHERE id=?",otherJob);
            db.update("DELETE FROM songs WHERE id=?",otherSong); db.update("DELETE FROM users WHERE id=?",otherUser);
        }
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(ints={0,600001})
    void invalidQueuedDurationFailsAndNextValidJobIsClaimed(Integer duration) throws Exception {
        db.update("UPDATE songs SET duration_ms=? WHERE id=?",duration,song);
        long otherUser=db.queryForObject("INSERT INTO users(nickname) VALUES ('next worker') RETURNING id",Long.class);
        long otherSong=db.queryForObject("INSERT INTO songs(owner_id,title,source,status,duration_ms) VALUES(?,'next','AUDIO','PROCESSING',600000) RETURNING id",Long.class,otherUser);
        String key="source-audio/"+UUID.randomUUID();
        long otherJob=db.queryForObject("INSERT INTO chart_jobs(song_id,user_id,source_key,idempotency_key,request_hash) VALUES(?,?,?,?,?) RETURNING id",Long.class,otherSong,otherUser,key,UUID.randomUUID().toString(),HASH);
        db.update("INSERT INTO audio_uploads(id,user_id,job_id,object_key,content_type,size_bytes,sha256,duration_ms,status,expires_at) VALUES(?,?,?,?,'audio/wav',100,?,60000,'ACCEPTED',now()+interval '1 hour')",UUID.randomUUID(),otherUser,otherJob,key,HASH);
        try {
            var next=claim("worker1",T1,UUID.randomUUID(),200);
            assertThat(next.path("jobId").asLong()).isEqualTo(otherJob);
            assertThat(next.path("input").path("durationMs").asInt()).isEqualTo(600000);
            assertThat(db.queryForObject("SELECT error_code FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo("INPUT_INVALID");
            assertThat(db.queryForObject("SELECT status FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo("FAILED");
            assertThat(db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE job_id=?",Integer.class,job)).isEqualTo(1);
            assertThat(db.queryForObject("SELECT status FROM audio_uploads WHERE id=?",String.class,source)).isEqualTo("RETIRED");
        } finally {
            db.update("DELETE FROM audio_uploads WHERE user_id=?",otherUser);
            db.update("UPDATE chart_jobs SET status='FAILED',finished_at=coalesce(finished_at,now()),current_attempt_id=NULL WHERE id=?",otherJob);
            db.update("DELETE FROM chart_job_attempts WHERE job_id=?",otherJob);
            db.update("DELETE FROM chart_jobs WHERE id=?",otherJob);
            db.update("DELETE FROM songs WHERE id=?",otherSong);
            db.update("DELETE FROM users WHERE id=?",otherUser);
        }
    }
    @ParameterizedTest
    @NullSource
    @ValueSource(ints={0,600001})
    void invalidCheckpointDurationIsRejectedOnReplayAndRetry(Integer duration) throws Exception {
        UUID request=UUID.randomUUID();
        UUID id=attempt(claim("worker1",T1,request,200));
        var files=outputs(id);
        raw(path("/results/separation"),T1,envelope(id,UUID.randomUUID(),separation(files.get(0),files.get(1))),200);
        db.update("UPDATE songs SET duration_ms=? WHERE id=?",duration,song);
        claim("worker1",T1,request,409);
        raw(path("/failure"),T1,Map.of("attemptId",id,"eventSeq",1,"stage","TRANSCRIBING","code","MODEL_FAILED","retryable",true,"summary","OOM"),200);
        db.update("UPDATE chart_jobs SET next_attempt_at=now() WHERE id=?",job);
        claim("worker2",T2,UUID.randomUUID(),204);
        assertThat(db.queryForObject("SELECT status FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo("FAILED");
        assertThat(db.queryForObject("SELECT error_code FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo("INPUT_INVALID");
        assertThat(db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE job_id=? AND file_role='DRUM_STEM'",Integer.class,job)).isEqualTo(1);
        claim("worker1",T1,request,409);
    }
    @Test void transientStorageOutageThenSameResultReachesDone() throws Exception {
        UUID id=attempt(claim("worker1",T1,UUID.randomUUID(),200));
        var files=outputs(id);
        var result=envelope(id,UUID.randomUUID(),separation(files.get(0),files.get(1)));
        when(store.inspectFlac(anyString(),anyLong(),anyString(),anyInt()))
            .thenThrow(new BusinessException(WorkerError.UNAVAILABLE))
            .thenAnswer(i->new WorkerStore.Verified(Files.createTempFile("worker-probe-",".flac"),i.getArgument(1),i.getArgument(2),i.getArgument(3)));
        raw(path("/results/separation"),T1,result,503);
        assertThat(db.queryForObject("SELECT status FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo("SEPARATING");
        assertThat(db.queryForObject("SELECT count(*) FROM chart_job_results WHERE job_id=?",Integer.class,job)).isZero();
        raw(path("/results/separation"),T1,result,200);
        String done=raw(path("/results/transcription"),T1,envelope(id,UUID.randomUUID(),transcription()),200);
        assertThat(json.readTree(done).path("jobStatus").asString()).isEqualTo("DONE");
        assertThat(db.queryForObject("SELECT status FROM songs WHERE id=?",String.class,song)).isEqualTo("READY");
    }
    @Test void retryKeepsAccompanimentAndFinalFailureDeletesItsFile(@TempDir Path bucket) throws Exception {
        UUID first = prepareTranscription();
        String key = db.queryForObject("SELECT accompaniment_key FROM songs WHERE id=?", String.class, song);
        Path backing = bucket.resolve(key);
        Files.createDirectories(backing.getParent());
        try (var flac = getClass().getResourceAsStream("/worker/one-second.flac")) {
            Files.copy(Objects.requireNonNull(flac), backing);
        }
        when(store.exists(WorkerStore.Bucket.ACCOMPANIMENT, key)).thenAnswer(call -> Files.exists(backing));
        doAnswer(call -> {
            Files.delete(backing);
            return null;
        }).when(store).delete(WorkerStore.Bucket.ACCOMPANIMENT, key);

        assertThat(db.update("""
                UPDATE file_cleanup_tasks SET next_attempt_at=now()
                WHERE job_id=? AND object_key=? AND file_role='ACCOMPANIMENT'
                """, job, key)).isOne();
        raw(path("/failure"), T1, Map.of("attemptId", first, "eventSeq", 1, "stage", "TRANSCRIBING",
                "code", "MODEL_FAILED", "retryable", true, "summary", "retry"), 200);
        ReflectionTestUtils.invokeMethod(cleanup, "runOnce");
        assertThat(db.queryForObject("SELECT accompaniment_key FROM songs WHERE id=?", String.class, song)).isEqualTo(key);
        assertThat(backing).isRegularFile();

        db.update("UPDATE chart_jobs SET next_attempt_at=now() WHERE id=?", job);
        var next = claim("worker2", T2, UUID.randomUUID(), 200);
        assertThat(next.path("resumeStage").asString()).isEqualTo("TRANSCRIBING");
        raw(path("/failure"), T2, Map.of("attemptId", attempt(next), "eventSeq", 1, "stage", "TRANSCRIBING",
                "code", "INPUT_INVALID", "retryable", false, "summary", "failed", "reason", "NOT_TRANSCRIBABLE"), 200);
        assertThat(db.queryForObject("SELECT status FROM songs WHERE id=?", String.class, song)).isEqualTo("FAILED");
        assertThat(db.queryForObject("SELECT accompaniment_key FROM songs WHERE id=?", String.class, song)).isNull();
        assertThat(backing).isRegularFile();
        ReflectionTestUtils.invokeMethod(cleanup, "runOnce");
        assertThat(backing).doesNotExist();
        assertThat(db.queryForObject("SELECT status FROM file_cleanup_tasks WHERE object_key=?", String.class, key))
                .isEqualTo("DELETED");
    }

    @Test void retryAfterFailureReachesDoneAndRejectsStaleCallback() throws Exception {
        UUID old=prepareTranscription();
        var stale=envelope(old,UUID.randomUUID(),transcription());
        raw(path("/failure"),T1,Map.of("attemptId",old,"eventSeq",1,"stage","TRANSCRIBING","code","MODEL_FAILED","retryable",true,"summary","OOM","reason","GPU_OUT_OF_MEMORY"),200);
        assertThat(db.queryForObject("SELECT error_reason FROM chart_jobs WHERE id=?",String.class,job)).isNull();
        assertThat(db.queryForObject("SELECT status FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo("QUEUED");
        db.update("UPDATE chart_jobs SET next_attempt_at=now() WHERE id=?",job);
        var next=claim("worker2",T2,UUID.randomUUID(),200);
        assertThat(next.path("resumeStage").asString()).isEqualTo("TRANSCRIBING");
        raw(path("/results/transcription"),T1,stale,409);
        UUID current=attempt(next);
        String done=raw(path("/results/transcription"),T2,envelope(current,UUID.randomUUID(),transcription()),200);
        assertThat(json.readTree(done).path("jobStatus").asString()).isEqualTo("DONE");
        assertThat(db.queryForObject("SELECT status FROM songs WHERE id=?",String.class,song)).isEqualTo("READY");
        assertThat(db.queryForObject("SELECT error_reason FROM chart_jobs WHERE id=?",String.class,job)).isNull();
    }
    @ParameterizedTest
    @ValueSource(strings={"SOURCE_INVALID", "NOT_TRANSCRIBABLE", "GPU_OUT_OF_MEMORY", "INTERNAL_ERROR"})
    void finalWorkerReasonIsVisibleOnlyToOwnerAcrossQueries(String reason) throws Exception {
        com.ssafy.airdrum.support.SignupConsentFixtures.complete(db,user);
        long other=db.queryForObject("INSERT INTO users(nickname) VALUES ('other') RETURNING id",Long.class);
        com.ssafy.airdrum.support.SignupConsentFixtures.complete(db,other);
        try {
            String ownerToken=tokens.issue(new com.ssafy.airdrum.domain.user.model.AuthUser(user,com.ssafy.airdrum.domain.user.model.UserRole.USER),Instant.now()).token();
            String otherToken=tokens.issue(new com.ssafy.airdrum.domain.user.model.AuthUser(other,com.ssafy.airdrum.domain.user.model.UserRole.USER),Instant.now()).token();
            UUID id=attempt(claim("worker1",T1,UUID.randomUUID(),200));
            String code=reason.equals("SOURCE_INVALID") || reason.equals("NOT_TRANSCRIBABLE") ? "INPUT_INVALID" : "MODEL_FAILED";
            raw(path("/failure"),T1,Map.of("attemptId",id,"eventSeq",1,"stage","SEPARATING","code",code,"retryable",false,"summary","secret/path","reason",reason),200);
            assertThat(db.queryForObject("SELECT error_reason FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo(reason);
            for(String url:List.of("/api/v1/jobs/"+job,"/api/v1/songs/"+song)) {
                String response=mvc.perform(get(url).header("Authorization","Bearer "+ownerToken)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
                JsonNode error=json.readTree(response).path(url.contains("/jobs/") ? "error" : "chartFailure");
                assertThat(error.path("reason").asString()).isEqualTo(reason);
                assertThat(error.path("code").asString()).isEqualTo(code);
                assertThat(error.path("message").asString()).isEqualTo(code.equals("INPUT_INVALID") ? "입력 파일을 처리할 수 없습니다." : "채보 생성에 실패했습니다.");
                assertThat(response).doesNotContain("secret/path");
                mvc.perform(get(url).header("Authorization","Bearer "+otherToken)).andExpect(status().isNotFound());
            }
            for(String url:List.of("/api/v1/jobs", "/api/v1/songs?source=MINE")) {
                String response=mvc.perform(get(url).header("Authorization","Bearer "+ownerToken)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
                JsonNode error=json.readTree(response).path("items").get(0).path(url.contains("/jobs") ? "error" : "chartFailure");
                assertThat(error.path("reason").asString()).isEqualTo(reason);
                assertThat(response).doesNotContain("secret/path");
            }
        } finally { db.update("DELETE FROM users WHERE id=?",other); }
    }
    @Test void invalidAndStaleReasonsCannotChangeStateAndOnlyLastFailurePersists() throws Exception {
        UUID first=attempt(claim("worker1",T1,UUID.randomUUID(),200));
        var failure=new HashMap<String,Object>(Map.of("attemptId",first,"eventSeq",1,"stage","SEPARATING","code","MODEL_FAILED","retryable",true,"summary","secret/path","reason","UNKNOWN"));
        raw(path("/failure"),T1,failure,400);
        assertThat(db.queryForObject("SELECT status FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo("SEPARATING");
        assertThat(db.queryForObject("SELECT heartbeat_seq FROM chart_job_attempts WHERE id=?",Long.class,first)).isZero();
        failure.put("reason","GPU_OUT_OF_MEMORY"); raw(path("/failure"),T1,failure,200);
        assertThat(db.queryForObject("SELECT error_reason FROM chart_jobs WHERE id=?",String.class,job)).isNull();
        db.update("UPDATE chart_jobs SET next_attempt_at=now() WHERE id=?",job);
        UUID second=attempt(claim("worker2",T2,UUID.randomUUID(),200));
        failure.put("eventSeq",2); raw(path("/failure"),T1,failure,409);
        assertThat(db.queryForObject("SELECT status FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo("SEPARATING");
        failure.put("attemptId",second); failure.put("eventSeq",1); failure.put("reason","INTERNAL_ERROR");
        raw(path("/failure"),T2,failure,200);
        assertThat(db.queryForObject("SELECT error_reason FROM chart_jobs WHERE id=?",String.class,job)).isNull();
        db.update("UPDATE chart_jobs SET next_attempt_at=now() WHERE id=?",job);
        UUID third=attempt(claim("worker1",T1,UUID.randomUUID(),200));
        failure.put("attemptId",third); failure.put("reason","INTERNAL_ERROR");
        raw(path("/failure"),T1,failure,200);
        assertThat(db.queryForObject("SELECT error_reason FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo("INTERNAL_ERROR");
    }
    @Test void expiredAttemptCannotWriteFailureReason() throws Exception {
        UUID id=attempt(claim("worker1",T1,UUID.randomUUID(),200));
        db.update("UPDATE chart_job_attempts SET lease_expires_at=created_at+interval '1 microsecond' WHERE id=?",id);
        raw(path("/failure"),T1,Map.of("attemptId",id,"eventSeq",1,"stage","SEPARATING","code","INPUT_INVALID","retryable",false,"summary","x","reason","SOURCE_INVALID"),409);
        assertThat(db.queryForObject("SELECT status FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo("SEPARATING");
        assertThat(db.queryForObject("SELECT heartbeat_seq FROM chart_job_attempts WHERE id=?",Long.class,id)).isZero();
        assertThat(db.queryForObject("SELECT error_reason FROM chart_jobs WHERE id=?",String.class,job)).isNull();
    }
    @ParameterizedTest
    @ValueSource(booleans={true,false})
    void omittedAndNullReasonRemainCompatible(boolean explicitNull) throws Exception {
        UUID id=attempt(claim("worker1",T1,UUID.randomUUID(),200));
        var failure=new HashMap<String,Object>(Map.of("attemptId",id,"eventSeq",1,"stage","SEPARATING","code","INPUT_INVALID","retryable",false,"summary","x"));
        if (explicitNull) failure.put("reason",null);
        raw(path("/failure"),T1,failure,200);
        assertThat(db.queryForObject("SELECT error_reason FROM chart_jobs WHERE id=?",String.class,job)).isNull();
        assertThat(com.ssafy.airdrum.domain.chart.exception.JobErrors.safe("INPUT_INVALID", null).reason()).isNull();
    }
    @Test void minimumPositiveDurationIsClaimed() throws Exception {
        db.update("UPDATE songs SET duration_ms=1 WHERE id=?",song);
        assertThat(claim("worker1",T1,UUID.randomUUID(),200).path("input").path("durationMs").asInt()).isEqualTo(1);
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
        assertThat(db.queryForObject("SELECT count(*) FROM chart_versions v JOIN charts c ON c.id=v.chart_id WHERE c.song_id=?",Integer.class,song)).isEqualTo(3);
        assertThat(db.queryForObject("SELECT progress FROM chart_jobs WHERE id=?",Integer.class,job)).isEqualTo(100);
        assertThat(db.queryForObject("SELECT metrics->'transcription'->>'durationMs' FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo("2");
    }
    UUID prepareTranscription() throws Exception {
        UUID id=attempt(claim("worker1",T1,UUID.randomUUID(),200));
        var files=outputs(id);
        raw(path("/results/separation"),T1,envelope(id,UUID.randomUUID(),separation(files.get(0),files.get(1))),200);
        return id;
    }
    Map<String,Object> chartResult(String status, boolean ticks, String version) {
        var notes=new ArrayList<Map<String,Object>>();
        for (int i=0;i<4;i++) {
            var note=new LinkedHashMap<String,Object>();
            note.put("noteId","note"+i); note.put("timeMs",100+i*250); note.put("pad",i==1 ? "HIHAT" : "SNARE");
            note.put("extra",Map.of("source",i));
            if (i==2) note.put("velocityHint",20);
            if (ticks) note.put("notation",Map.of("tick",i*240,"durationTicks",120,"voice",1));
            notes.add(note);
        }
        var timing=new LinkedHashMap<String,Object>();
        timing.put("bpm",120); timing.put("offsetMs",100); timing.put("timeSignature","4/4");
        if(ticks) { timing.put("ppq",480); timing.put("tempoMap",List.of(Map.of("tick",0,"bpm",120))); timing.put("timeSignatureMap",List.of(Map.of("tick",0,"numerator",4,"denominator",4))); }
        return Map.of("schemaVersion",1,"generator","ADT_MODEL","generatorVersion",version,"metrics",Map.of(),
                "charts",List.of(Map.of("difficulty","NORMAL","notationStatus",status,"notes",notes,"timing",timing)));
    }
    @Test void malformedDifficultyFailsValidAttempt() throws Exception {
        UUID id=prepareTranscription();
        var result=new HashMap<>(transcription());
        var chart=new HashMap<>((Map<String,Object>) ((List<?>) result.get("charts")).getFirst());
        chart.put("difficulty",Map.of()); result.put("charts",List.of(chart));
        raw(path("/results/transcription"),T1,envelope(id,UUID.randomUUID(),result),422);
        assertThat(db.queryForObject("SELECT error_code FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo("OUTPUT_INVALID");
    }
    static java.util.stream.Stream<org.junit.jupiter.params.provider.Arguments> invalidResultTypes() {
        var args=new ArrayList<org.junit.jupiter.params.provider.Arguments>();
        for (String field:List.of("audioTimeOrigin","model.name","generator","difficulty","notationStatus","pad"))
            for (Object value:List.of(Map.of(),List.of(),123)) args.add(org.junit.jupiter.params.provider.Arguments.of(field,value));
        for (String field:List.of("model","chart","note"))
            for (Object value:List.of(List.of(),123)) args.add(org.junit.jupiter.params.provider.Arguments.of(field,value));
        args.add(org.junit.jupiter.params.provider.Arguments.of("notationStatus",null));
        args.add(org.junit.jupiter.params.provider.Arguments.of("padMissing",123));
        for (Object value:List.of("true",1,Map.of(),List.of()))
            args.add(org.junit.jupiter.params.provider.Arguments.of("hihatOpen",value));
        return args.stream();
    }
    @ParameterizedTest(name="{0} 잘못된 타입 {1}")
    @org.junit.jupiter.params.provider.MethodSource("invalidResultTypes")
    @SuppressWarnings("unchecked")
    void invalidResultTypesFailAndScheduleCleanup(String field,Object value) throws Exception {
        boolean separating=field.equals("audioTimeOrigin") || field.startsWith("model");
        UUID id; Map<String,Object> result;
        if(separating) {
            id=attempt(claim("worker1",T1,UUID.randomUUID(),200)); var files=outputs(id);
            result=new HashMap<>(separation(files.get(0),files.get(1)));
            if(field.equals("model.name")) {var model=new HashMap<>((Map<String,Object>)result.get("model")); model.put("name",value); result.put("model",model);}
            else result.put(field,value);
        } else {
            id=prepareTranscription(); result=new HashMap<>(transcription());
            var chart=new HashMap<>((Map<String,Object>)((List<?>)result.get("charts")).getFirst());
            if(field.equals("generator")) result.put(field,value);
            else if(field.equals("chart")) result.put("charts",Collections.singletonList(value));
            else {
                if(field.equals("note")) chart.put("notes",Collections.singletonList(value));
                else if(field.equals("pad") || field.equals("padMissing") || field.equals("hihatOpen")) {var note=new HashMap<>((Map<String,Object>)((List<?>)chart.get("notes")).getFirst()); if(field.equals("padMissing")) note.remove("pad"); else note.put(field,value); chart.put("notes",List.of(note));}
                else chart.put(field,value);
                result.put("charts",List.of(chart));
            }
        }
        String inputKey=db.queryForObject("SELECT "+(separating?"source_key":"drum_stem_key")+" FROM chart_jobs WHERE id=?",String.class,job);
        raw(path(separating?"/results/separation":"/results/transcription"),T1,envelope(id,UUID.randomUUID(),result),422);
        assertThat(db.queryForMap("SELECT status,error_code,source_key,drum_stem_key FROM chart_jobs WHERE id=?",job))
            .containsEntry("status","FAILED").containsEntry("error_code","OUTPUT_INVALID").containsEntry("source_key",null).containsEntry("drum_stem_key",null);
        assertThat(db.queryForObject("SELECT status FROM songs WHERE id=?",String.class,song)).isEqualTo("FAILED");
        assertThat(db.queryForObject("SELECT finished_at IS NOT NULL FROM chart_job_attempts WHERE id=?",Boolean.class,id)).isTrue();
        assertThat(db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE job_id=?",Integer.class,job)).isGreaterThanOrEqualTo(3);
        assertThat(db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE job_id=? AND object_key=? AND file_role=?",Integer.class,job,inputKey,separating?"SOURCE":"DRUM_STEM")).isEqualTo(1);
        assertThat(db.queryForObject("SELECT count(*) FROM chart_job_results WHERE job_id=? AND stage=?",Integer.class,job,separating?"SEPARATING":"TRANSCRIBING")).isZero();
        assertThat(db.queryForObject("SELECT count(*) FROM charts WHERE song_id=?",Integer.class,song)).isZero();
    }
    @Test void malformedEnvelopeAndStaleAttemptKeepTheirContracts() throws Exception {
        UUID id=attempt(claim("worker1",T1,UUID.randomUUID(),200)); var files=outputs(id);
        var malformedEnvelope=new HashMap<>(envelope(id,UUID.randomUUID(),separation(files.get(0),files.get(1))));
        malformedEnvelope.put("result",List.of()); raw(path("/results/separation"),T1,malformedEnvelope,400);
        var malformedResult=new HashMap<>(separation(files.get(0),files.get(1))); malformedResult.put("audioTimeOrigin",Map.of());
        db.update("UPDATE chart_job_attempts SET lease_expires_at=created_at+interval '1 microsecond' WHERE id=?",id);
        raw(path("/results/separation"),T1,envelope(id,UUID.randomUUID(),malformedResult),409);
        assertThat(db.queryForObject("SELECT status FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo("SEPARATING");
    }
    @Test void transcriptionAcceptsPedalAndPreservesThreeDifficultyVersions() throws Exception {
        UUID id=prepareTranscription();
        var pedal=Map.of("noteId","pedal","timeMs",0,"pad","HIHAT_PEDAL","velocityHint",100);
        var snare=Map.of("noteId","snare","timeMs",500,"pad","SNARE","velocityHint",100);
        var input=Map.of("schemaVersion",1,"generator","ADT_MODEL","generatorVersion","v1","metrics",Map.of(),"charts",List.of(
                Map.of("difficulty","NORMAL","notationStatus","UNAVAILABLE","notes",List.of(pedal,snare),
                        "timing",Map.of("bpm",120,"offsetMs",0,"timeSignature","4/4"))));
        var receipt=json.readTree(raw(path("/results/transcription"),T1,envelope(id,UUID.randomUUID(),input),200));
        assertThat(receipt.path("chartVersionIds").size()).isEqualTo(3);
        var returned=new HashMap<String,com.ssafy.airdrum.domain.chart.dto.ChartResponses.ChartDetail>();
        for (var version:receipt.path("chartVersionIds")) {
            var detail=charts.version(user,version.asLong());
            returned.put(detail.difficulty(),detail);
        }
        assertThat(returned.keySet()).containsExactlyInAnyOrder("HARD","NORMAL","EASY");
        assertThat(returned.get("HARD").notes()).extracting("pad").containsExactly("HIHAT_PEDAL","SNARE");
        assertThat(returned.get("HARD").notes()).extracting("noteId").containsExactly("pedal","snare");
        assertThat(returned.get("NORMAL").notes()).extracting("pad").containsExactly("HIHAT_PEDAL","SNARE");
        assertThat(returned.get("EASY").notes()).extracting("pad").containsExactly("SNARE");
    }
    @Test void transcriptionAcceptsMissingNullAndBooleanHihatOpen() throws Exception {
        UUID id=prepareTranscription();
        var missing=Map.of("noteId","missing","timeMs",0,"pad","HIHAT");
        var explicitNull=new HashMap<String,Object>(Map.of("noteId","null","timeMs",500,"pad","HIHAT"));
        explicitNull.put("hihatOpen",null);
        var closed=Map.of("noteId","closed","timeMs",1000,"pad","HIHAT","hihatOpen",false);
        var open=Map.of("noteId","open","timeMs",1500,"pad","HIHAT","hihatOpen",true);
        var input=Map.of("schemaVersion",1,"generator","ADT_MODEL","generatorVersion","v1","metrics",Map.of(),"charts",List.of(
                Map.of("difficulty","NORMAL","notationStatus","UNAVAILABLE","notes",List.of(missing,explicitNull,closed,open),
                        "timing",Map.of("bpm",120,"offsetMs",0,"timeSignature","4/4"))));
        var receipt=json.readTree(raw(path("/results/transcription"),T1,envelope(id,UUID.randomUUID(),input),200));
        var rows=db.queryForList("SELECT v.id,v.notes::text AS notes FROM charts c JOIN chart_versions v ON v.chart_id=c.id WHERE c.song_id=? AND c.difficulty='HARD'",song);
        assertThat(rows).hasSize(1);
        assertThat(json.readTree((String)rows.getFirst().get("notes"))).isEqualTo(json.valueToTree(List.of(missing,explicitNull,closed,open)));
        var detail=charts.version(user,((Number)rows.getFirst().get("id")).longValue());
        assertThat(detail.notes()).extracting(com.ssafy.airdrum.domain.chart.dto.ChartResponses.Note::hihatOpen).containsExactly(null,null,false,true);
        assertThat(receipt.path("chartVersionIds").size()).isEqualTo(3);
    }
    @Test void transcriptionPreservesHihatOpenThroughStorageAndDifficultySelection() throws Exception {
        UUID id=prepareTranscription();
        var open=Map.of("noteId","open","timeMs",0,"pad","HIHAT","velocityHint",100,"hihatOpen",true);
        var pedal=Map.of("noteId","pedal","timeMs",500,"pad","HIHAT_PEDAL","velocityHint",100);
        var input=Map.of("schemaVersion",1,"generator","ADT_MODEL","generatorVersion","v1","metrics",Map.of(),"charts",List.of(
                Map.of("difficulty","NORMAL","notationStatus","UNAVAILABLE","notes",List.of(open,pedal),
                        "timing",Map.of("bpm",120,"offsetMs",0,"timeSignature","4/4"))));
        var receipt=json.readTree(raw(path("/results/transcription"),T1,envelope(id,UUID.randomUUID(),input),200));
        var rows=db.queryForList("SELECT c.difficulty,v.notes::text AS notes FROM charts c JOIN chart_versions v ON v.chart_id=c.id WHERE c.song_id=?",song);
        assertThat(rows).hasSize(3);
        for (var row:rows) {
            var stored=json.readTree((String)row.get("notes"));
            assertThat(stored.get(0)).isEqualTo(json.valueToTree(open));
        }
        assertThat(receipt.path("chartVersionIds").size()).isEqualTo(3);
        for (var version:receipt.path("chartVersionIds")) {
            var detail=charts.version(user,version.asLong());
            assertThat(detail.notes().getFirst().noteId()).isEqualTo("open");
            assertThat(detail.notes().getFirst().hihatOpen()).isTrue();
        }
    }
    @Test void transcriptionPreservesOriginalNotesAndMakesThreeDifficulties() throws Exception {
        UUID id=prepareTranscription();
        var input=chartResult("READY",true,"x".repeat(50));
        var envelope=envelope(id,UUID.randomUUID(),input);
        String receipt=raw(path("/results/transcription"),T1,envelope,200);
        assertThat(json.readTree(receipt).path("chartVersionIds").size()).isEqualTo(3);
		assertThat(db.queryForObject("SELECT song_level FROM songs WHERE id=?",String.class,song)).isNotBlank();
		assertThat(db.queryForObject("SELECT level_chart_version_id FROM songs WHERE id=?",Long.class,song))
				.isEqualTo(db.queryForObject("SELECT v.id FROM charts c JOIN chart_versions v ON v.chart_id=c.id WHERE c.song_id=? AND c.difficulty='HARD'",Long.class,song));
        assertThat(raw(path("/results/transcription"),T1,envelope,200)).isEqualTo(receipt);
        var rows=db.queryForList("SELECT c.difficulty,v.notes::text AS notes,v.note_count,v.generator_version,v.notation_status FROM charts c JOIN chart_versions v ON v.chart_id=c.id WHERE c.song_id=?",song);
        assertThat(rows).hasSize(3);
        var byDifficulty=new HashMap<String,Map<String,Object>>();
        rows.forEach(row->byDifficulty.put((String)row.get("difficulty"),row));
        var hard=byDifficulty.get("HARD"); var normal=byDifficulty.get("NORMAL"); var easy=byDifficulty.get("EASY");
        JsonNode original=json.valueToTree(input).path("charts").get(0).path("notes");
        assertThat(json.readTree((String)hard.get("notes"))).isEqualTo(original);
        assertThat((Integer)hard.get("note_count")).isGreaterThanOrEqualTo((Integer)normal.get("note_count"));
        assertThat((Integer)normal.get("note_count")).isGreaterThanOrEqualTo((Integer)easy.get("note_count"));
        for (var row:List.of(normal,easy)) {
            var notes=json.readTree((String)row.get("notes")); int previous=-1;
            for(var note:notes) { int index=Integer.parseInt(note.path("noteId").asString().substring(4)); assertThat(index).isGreaterThan(previous); assertThat(note).isEqualTo(original.get(index)); previous=index; }
            assertThat((String)row.get("generator_version")).hasSize(50).endsWith("+midi-rule-2.0");
            assertThat(row.get("notation_status")).isEqualTo("READY");
        }
        assertThat(hard.get("generator_version")).isEqualTo("x".repeat(50));
    }
    @Test void unavailableUsesVirtualTicksAndDefaultVelocity() throws Exception {
        UUID id=prepareTranscription(); var input=chartResult("UNAVAILABLE",false,"v1");
        raw(path("/results/transcription"),T1,envelope(id,UUID.randomUUID(),input),200);
        var rows=db.queryForList("SELECT c.difficulty,v.notes::text AS notes,v.notation_status FROM charts c JOIN chart_versions v ON v.chart_id=c.id WHERE c.song_id=?",song);
        var easy=rows.stream().filter(r->r.get("difficulty").equals("EASY")).findFirst().orElseThrow();
        var notes=json.readTree((String)easy.get("notes"));
        // 120bpm 8분(250ms) 4개는 연타 구간: 4분 박 칸마다 하나(note0, note2). EASY는 세기로 거르지 않는다(midi-rule-2.0)
        assertThat(notes.valueStream().map(n->n.path("noteId").asString()).toList()).containsExactly("note0","note2");
        assertThat(easy.get("notation_status")).isEqualTo("UNAVAILABLE");
        // velocityHint 20 스네어(note2)는 NORMAL에서 고스트로 빠지고, 힌트가 없는 노트는 100으로 본다
        var normal=rows.stream().filter(r->r.get("difficulty").equals("NORMAL")).findFirst().orElseThrow();
        assertThat(json.readTree((String)normal.get("notes")).valueStream().map(n->n.path("noteId").asString()).toList())
                .containsExactly("note0","note1","note3");
    }
    @Test void unavailableWithTempoMapThinsBySegmentTicksAndReusesReceipt() throws Exception {
        // offsetMs 100, 0~1920틱 120bpm(박 500ms), 1920틱(2100ms)부터 60bpm(박 1000ms). 노트에는 notation이 없다
        UUID id=prepareTranscription();
        int[] times={2100,2600,3100,3350}; String[] pads={"SNARE","SNARE","SNARE","HIHAT"};
        long[] segmentTicks={1920,2160,2400,2520}; // 구간 bpm으로 센 tick
        long[] singleBpmTicks={1920,2400,2880,3120}; // 예전처럼 120bpm 하나로 센 tick
        var notes=new ArrayList<Map<String,Object>>();
        for(int i=0;i<times.length;i++) notes.add(Map.of("noteId","tm"+i,"timeMs",times[i],"pad",pads[i],"velocityHint",100));
        var timing=new LinkedHashMap<String,Object>();
        timing.put("bpm",120); timing.put("offsetMs",100); timing.put("timeSignature","4/4"); timing.put("ppq",480);
        timing.put("tempoMap",List.of(Map.of("tick",0,"bpm",120),Map.of("tick",1920,"bpm",60)));
        timing.put("timeSignatureMap",List.of(Map.of("tick",0,"numerator",4,"denominator",4)));
        var input=Map.of("schemaVersion",1,"generator","ADT_MODEL","generatorVersion","v1","metrics",Map.of(),"charts",List.of(
                Map.of("difficulty","NORMAL","notationStatus","UNAVAILABLE","notes",notes,"timing",timing)));
        var envelope=envelope(id,UUID.randomUUID(),input);
        String receipt=raw(path("/results/transcription"),T1,envelope,200);
        assertThat(raw(path("/results/transcription"),T1,envelope,200)).isEqualTo(receipt);
        // 기대값: 구간 tick으로 솎은 noteId. 한 bpm으로 셌다면 결과가 달라야 이 테스트가 의미가 있다
        var expected=keptIds(segmentTicks,pads,List.of(tempo(0,120),tempo(1920,60))); var singleBpm=keptIds(singleBpmTicks,pads,List.of(tempo(0,120)));
        assertThat(expected.get(com.ssafy.airdrum.domain.chart.model.DifficultyThinner.Difficulty.EASY)).containsExactly("tm0","tm1","tm2");
        assertThat(expected.get(com.ssafy.airdrum.domain.chart.model.DifficultyThinner.Difficulty.NORMAL)).containsExactly("tm0","tm1","tm2");
        assertThat(singleBpm).isNotEqualTo(expected);
        var rows=db.queryForList("SELECT c.difficulty,v.notes::text AS notes,v.notation_status FROM charts c JOIN chart_versions v ON v.chart_id=c.id WHERE c.song_id=?",song);
        assertThat(rows).hasSize(3);
        JsonNode original=json.valueToTree(notes);
        for(var row:rows) {
            var stored=json.readTree((String)row.get("notes"));
            var difficulty=(String)row.get("difficulty");
            if(difficulty.equals("HARD")) { assertThat(stored).isEqualTo(original); continue; }
            var ids=new ArrayList<String>();
            for(var note:stored) {
                ids.add(note.path("noteId").asString());
                // 남은 노트는 원본 객체 그대로(timeMs 보존)
                assertThat(note).isEqualTo(original.get(Integer.parseInt(note.path("noteId").asString().substring(2))));
            }
            assertThat(ids).containsExactlyElementsOf(expected.get(com.ssafy.airdrum.domain.chart.model.DifficultyThinner.Difficulty.valueOf(difficulty)));
            assertThat(row.get("notation_status")).isEqualTo("UNAVAILABLE");
        }
    }
    private static com.ssafy.airdrum.domain.chart.model.DifficultyThinner.Tempo tempo(long tick,int bpm) {
        return new com.ssafy.airdrum.domain.chart.model.DifficultyThinner.Tempo(tick,(int)Math.round(60_000_000.0/bpm));
    }
    private static Map<com.ssafy.airdrum.domain.chart.model.DifficultyThinner.Difficulty,List<String>> keptIds(long[] ticks,String[] pads,
            List<com.ssafy.airdrum.domain.chart.model.DifficultyThinner.Tempo> tempos) {
        var byNote=new IdentityHashMap<com.ssafy.airdrum.domain.chart.model.DrumNote,String>();
        var list=new ArrayList<com.ssafy.airdrum.domain.chart.model.DrumNote>();
        for(int i=0;i<ticks.length;i++) {
            var n=new com.ssafy.airdrum.domain.chart.model.DrumNote(ticks[i],com.ssafy.airdrum.domain.chart.model.DrumPad.valueOf(pads[i]),100,0);
            list.add(n); byNote.put(n,"tm"+i);
        }
        var result=new EnumMap<com.ssafy.airdrum.domain.chart.model.DifficultyThinner.Difficulty,List<String>>(com.ssafy.airdrum.domain.chart.model.DifficultyThinner.Difficulty.class);
        com.ssafy.airdrum.domain.chart.model.DifficultyThinner.thin(list, 480, tempos).forEach((d,kept)->result.put(d,kept.stream().map(byNote::get).toList()));
        return result;
    }
    @Test void pendingTicksFallbackPreservesOriginalDuplicates() throws Exception {
        UUID id=prepareTranscription();
        var timing=Map.of("bpm",120,"offsetMs",0,"timeSignature","4/4","ppq",480);
        var weak=Map.of("noteId","weak","timeMs",0,"pad","SNARE","velocityHint",10,"notation",Map.of("tick",0,"durationTicks",120,"voice",1));
        var stronger=Map.of("noteId","stronger","timeMs",1,"pad","SNARE","velocityHint",20,"notation",Map.of("tick",0,"durationTicks",120,"voice",1));
        var input=Map.of("schemaVersion",1,"generator","ADT_MODEL","generatorVersion","v1","metrics",Map.of(),"charts",List.of(
                Map.of("difficulty","NORMAL","notationStatus","PENDING","timing",timing,"notes",List.of(weak,stronger))));
        raw(path("/results/transcription"),T1,envelope(id,UUID.randomUUID(),input),200);
        var rows=db.queryForList("SELECT c.difficulty,v.notes::text AS notes FROM charts c JOIN chart_versions v ON v.chart_id=c.id WHERE c.song_id=?",song);
        assertThat(rows).hasSize(3);
        for(var row:rows) {
            var notes=json.readTree((String)row.get("notes"));
            // NORMAL은 스네어 고스트를 빼서 비고 HARD로 폴백한다: 병합 전 원본 둘을 그대로 둔다.
            // EASY는 세기로 거르지 않아(midi-rule-2.0) 병합된 쪽(세기가 큰 stronger)만 남는다
            if(row.get("difficulty").equals("EASY")) assertThat(notes).isEqualTo(json.valueToTree(List.of(stronger)));
            else assertThat(notes).isEqualTo(json.valueToTree(List.of(weak,stronger)));
        }
    }
    @Test void duplicateTickAndPadSelectsTheCorrectOriginal() throws Exception {
        UUID id=prepareTranscription();
        var timing=Map.of("bpm",120,"offsetMs",0,"timeSignature","4/4","ppq",480);
        var weak=Map.of("noteId","weak","timeMs",0,"pad","SNARE","velocityHint",60,"notation",Map.of("tick",0,"durationTicks",120,"voice",1));
        var stronger=Map.of("noteId","stronger","timeMs",1,"pad","SNARE","velocityHint",100,"notation",Map.of("tick",0,"durationTicks",120,"voice",1));
        var input=Map.of("schemaVersion",1,"generator","ADT_MODEL","generatorVersion","v1","metrics",Map.of(),"charts",List.of(
                Map.of("difficulty","NORMAL","notationStatus","PENDING","timing",timing,"notes",List.of(weak,stronger))));
        raw(path("/results/transcription"),T1,envelope(id,UUID.randomUUID(),input),200);
        var rows=db.queryForList("SELECT c.difficulty,v.notes::text AS notes FROM charts c JOIN chart_versions v ON v.chart_id=c.id WHERE c.song_id=?",song);
        for(var row:rows) if(!row.get("difficulty").equals("HARD")) {
            var notes=json.readTree((String)row.get("notes")); assertThat(notes.size()).isEqualTo(1);
            assertThat(notes.get(0)).isEqualTo(json.valueToTree(stronger));
        }
    }
    @Test void laterInsertFailuresRollBackAllResults() throws Exception {
        UUID id=prepareTranscription();
        try {
            db.execute("CREATE OR REPLACE FUNCTION worker_test_fail_chart() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.difficulty = current_setting('worker_test.fail_difficulty', true) THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$");
            db.execute("CREATE TRIGGER worker_test_fail_chart BEFORE INSERT ON charts FOR EACH ROW EXECUTE FUNCTION worker_test_fail_chart()");
            for (String difficulty:List.of("NORMAL","EASY")) {
                // DB 연결마다 적용되는 테스트 설정 대신 트리거 함수를 대상 난이도로 바꾼다.
                db.execute("CREATE OR REPLACE FUNCTION worker_test_fail_chart() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.difficulty = '"+difficulty+"' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$");
                raw(path("/results/transcription"),T1,envelope(id,UUID.randomUUID(),transcription()),500);
                assertThat(db.queryForObject("SELECT count(*) FROM charts WHERE song_id=?",Integer.class,song)).isZero();
                assertThat(db.queryForObject("SELECT count(*) FROM chart_job_results WHERE job_id=? AND stage='TRANSCRIBING'",Integer.class,job)).isZero();
                assertThat(db.queryForObject("SELECT status FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo("TRANSCRIBING");
            }
        } finally { db.execute("DROP TRIGGER IF EXISTS worker_test_fail_chart ON charts"); db.execute("DROP FUNCTION IF EXISTS worker_test_fail_chart()"); }
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
