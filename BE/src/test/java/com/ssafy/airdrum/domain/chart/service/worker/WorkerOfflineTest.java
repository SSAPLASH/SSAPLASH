package com.ssafy.airdrum.domain.chart.service.worker;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import com.ssafy.airdrum.domain.auth.service.token.AccessTokenService;
import com.ssafy.airdrum.domain.chart.storage.worker.S3WorkerStore;
import com.ssafy.airdrum.domain.user.model.AuthUser;
import com.ssafy.airdrum.domain.user.model.UserRole;
import com.ssafy.airdrum.support.SignupConsentFixtures;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** 채보 워커가 꺼져 있을 때 대기 작업을 바로 실패 처리하는지 확인. 이 클래스만 워커 생존 검사를 켬 */
@SpringBootTest(properties={"chart.worker.credentials=worker1=01234567890123456789012345678901",
    "chart.worker.recovery-interval-ms=86400000","chart.worker.offline-after-ms=60000"})
@AutoConfigureMockMvc
class WorkerOfflineTest {
    static final String T1="01234567890123456789012345678901";
    static final String HASH="a".repeat(64);
    @Autowired JdbcTemplate db;
    @Autowired MockMvc mvc;
    @Autowired JsonMapper json;
    @Autowired WorkerQueue queue;
    @Autowired AccessTokenService tokens;
    @MockitoBean S3WorkerStore store;
    long user,song,job;

    @BeforeEach void setup() {
        db.update("DELETE FROM chart_worker_presence");
        user=db.queryForObject("INSERT INTO users(nickname) VALUES ('offline test') RETURNING id",Long.class);
        song=db.queryForObject("INSERT INTO songs(owner_id,title,source,status,duration_ms) VALUES(?,'song','AUDIO','PROCESSING',60000) RETURNING id",Long.class,user);
        String key="source-audio/test-"+UUID.randomUUID();
        job=db.queryForObject("INSERT INTO chart_jobs(song_id,user_id,source_key,idempotency_key,request_hash) VALUES(?,?,?,?,?) RETURNING id",Long.class,song,user,key,UUID.randomUUID().toString(),HASH);
        db.update("INSERT INTO audio_uploads(id,user_id,job_id,object_key,content_type,size_bytes,sha256,duration_ms,status,expires_at) VALUES(?,?,?,?,'audio/wav',100,?,60000,'ACCEPTED',now()+interval '1 hour')",UUID.randomUUID(),user,job,key,HASH);
        when(store.exists(any(),anyString())).thenReturn(true);
    }
    @AfterEach void clean() {
        db.update("DELETE FROM chart_worker_presence");
        db.update("DELETE FROM file_cleanup_tasks WHERE job_id=? OR user_id=?",job,user);
        db.update("DELETE FROM audio_uploads WHERE user_id=?",user);
        db.update("UPDATE chart_jobs SET status='FAILED',finished_at=coalesce(finished_at,now()),current_attempt_id=NULL WHERE id=?",job);
        db.update("DELETE FROM chart_job_attempts WHERE job_id=?",job);
        db.update("DELETE FROM chart_jobs WHERE id=?",job);
        db.update("DELETE FROM songs WHERE id=?",song);
        db.update("DELETE FROM users WHERE id=?",user);
    }

    String jobStatus() { return db.queryForObject("SELECT status FROM chart_jobs WHERE id=?",String.class,job); }
    String errorCode() { return db.queryForObject("SELECT error_code FROM chart_jobs WHERE id=?",String.class,job); }
    void lastSeen(String worker,int secondsAgo) {
        db.update("INSERT INTO chart_worker_presence(worker_id,last_seen_at) VALUES(?,now()-?*interval '1 second')",worker,secondsAgo);
    }
    Instant lastSeenOf(String worker) {
        return db.queryForObject("SELECT last_seen_at FROM chart_worker_presence WHERE worker_id=?",java.sql.Timestamp.class,worker).toInstant();
    }
    String call(String path,Object body,int status) throws Exception {
        return mvc.perform(post("/internal/v1/chart-jobs"+path)
                .header("Authorization","Bearer "+T1).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body)))
                .andExpect(status().is(status)).andReturn().getResponse().getContentAsString();
    }

    @Test void noWorkerRecordFailsQueuedJobAsWorkerOffline() throws Exception {
        queue.recover();
        assertThat(jobStatus()).isEqualTo("FAILED");
        assertThat(errorCode()).isEqualTo("WORKER_OFFLINE");
        assertThat(db.queryForObject("SELECT error_reason FROM chart_jobs WHERE id=?",String.class,job)).isNull();
        assertThat(db.queryForObject("SELECT status FROM songs WHERE id=?",String.class,song)).isEqualTo("FAILED");
        assertThat(db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE job_id=?",Integer.class,job)).isEqualTo(1);

        SignupConsentFixtures.complete(db,user);
        String token=tokens.issue(new AuthUser(user,UserRole.USER),Instant.now()).token();
        for(String url:new String[]{"/api/v1/jobs/"+job,"/api/v1/songs/"+song}) {
            String response=mvc.perform(get(url).header("Authorization","Bearer "+token)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            JsonNode error=json.readTree(response).path(url.contains("/jobs/") ? "error" : "chartFailure");
            assertThat(error.path("code").asString()).isEqualTo("WORKER_OFFLINE");
            assertThat(error.path("message").asString()).isEqualTo("채보 서버가 잠시 멈춰 있습니다. 잠시 뒤 다시 올려 주세요.");
        }
    }
    @Test void staleWorkerFailsQueuedJob() {
        lastSeen("worker1",61);
        queue.recover();
        assertThat(errorCode()).isEqualTo("WORKER_OFFLINE");
    }
    @Test void recentWorkerKeepsJobQueued() {
        lastSeen("worker1",61);
        lastSeen("worker2",30);
        queue.recover();
        assertThat(jobStatus()).isEqualTo("QUEUED");
        assertThat(errorCode()).isNull();
    }
    @Test void claimRecordsWorkerEvenWhenNoJobIsAssigned() throws Exception {
        db.update("UPDATE chart_jobs SET next_attempt_at=now()+interval '1 hour' WHERE id=?",job);
        Instant before=Instant.now().minusSeconds(1);
        assertThat(call("/claim",Map.of("workerId","worker1","claimRequestId",UUID.randomUUID()),204)).isEmpty();
        assertThat(lastSeenOf("worker1")).isAfter(before);
        assertThat(jobStatus()).isEqualTo("QUEUED");
    }
    @Test void heartbeatRecordsWorker() throws Exception {
        JsonNode assignment=json.readTree(call("/claim",Map.of("workerId","worker1","claimRequestId",UUID.randomUUID()),200));
        db.update("UPDATE chart_worker_presence SET last_seen_at=now()-interval '10 minutes'");
        Instant before=Instant.now().minusSeconds(1);
        call("/"+job+"/heartbeat",Map.of("attemptId",assignment.path("attemptId").asString(),"eventSeq",1,"progress",10),200);
        assertThat(lastSeenOf("worker1")).isAfter(before);
    }
    @Test void cancellationAndTimeoutComeBeforeWorkerOffline() {
        db.update("UPDATE chart_jobs SET queued_at=now()-interval '31 minutes' WHERE id=?",job);
        queue.recover();
        assertThat(errorCode()).isEqualTo("STAGE_TIMEOUT");

        long otherSong=db.queryForObject("INSERT INTO songs(owner_id,title,source,status,duration_ms,deleted_at) VALUES(?,'deleted','AUDIO','PROCESSING',60000,now()) RETURNING id",Long.class,user);
        long otherJob=db.queryForObject("INSERT INTO chart_jobs(song_id,user_id,source_key,idempotency_key,request_hash) VALUES(?,?,?,?,?) RETURNING id",Long.class,otherSong,user,"source-audio/test-"+UUID.randomUUID(),UUID.randomUUID().toString(),HASH);
        try {
            queue.recover();
            assertThat(db.queryForObject("SELECT error_code FROM chart_jobs WHERE id=?",String.class,otherJob)).isEqualTo("JOB_CANCELLED");
        } finally {
            db.update("DELETE FROM file_cleanup_tasks WHERE job_id=?",otherJob);
            db.update("DELETE FROM chart_jobs WHERE id=?",otherJob);
            db.update("DELETE FROM songs WHERE id=?",otherSong);
        }
    }
    @Test void jobWhoseWorkerDiedMidwayFailsAsWorkerOffline() throws Exception {
        JsonNode assignment=json.readTree(call("/claim",Map.of("workerId","worker1","claimRequestId",UUID.randomUUID()),200));
        UUID attempt=UUID.fromString(assignment.path("attemptId").asString());
        db.update("UPDATE chart_job_attempts SET lease_expires_at=created_at+interval '1 microsecond' WHERE id=?",attempt);
        db.update("UPDATE chart_worker_presence SET last_seen_at=now()-interval '61 seconds'");
        queue.recover();
        assertThat(jobStatus()).isEqualTo("QUEUED");
        queue.recover();
        assertThat(jobStatus()).isEqualTo("FAILED");
        assertThat(errorCode()).isEqualTo("WORKER_OFFLINE");
    }
}
