package com.ssafy.airdrum.domain.chart.service.worker;

import com.ssafy.airdrum.global.worker.WorkerError;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.ssafy.airdrum.global.error.BusinessException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** DB 잠금은 users → songs → chart_jobs → attempts 순서로 획득한다. */
@Service
public class WorkerQueue {
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final TransactionTemplate newTx;
    /** 모든 워커의 마지막 연락이 이 시간보다 오래되면 워커가 꺼졌다고 봄. 0 이하면 검사하지 않음 */
    private final long offlineAfterMs;
    WorkerQueue(JdbcTemplate db, PlatformTransactionManager manager,
            @Value("${chart.worker.offline-after-ms:60000}") long offlineAfterMs) {
        this.db = db;
        this.offlineAfterMs = offlineAfterMs;
        this.tx = new TransactionTemplate(manager);
        this.tx.setTimeout(15);
        this.newTx = new TransactionTemplate(manager);
        this.newTx.setPropagationBehavior(org.springframework.transaction.TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.newTx.setTimeout(15);
    }
    record Input(String role, UUID fileId, String contentType, long sizeBytes, String sha256, int durationMs) {}
    public record Assignment(int contractVersion, long jobId, long songId, UUID attemptId, String resumeStage,
            Input input, List<String> requestedDifficulties, List<Integer> acceptedChartSchemaVersions,
            Instant leaseExpiresAt, Instant stageDeadlineAt) {}
    public record Heartbeat(Instant leaseExpiresAt) {}
    record Lock(long userId, long songId, long jobId, String status, UUID currentAttemptId,
            Instant deadline, int durationMs, boolean active, boolean deleted) {}

    Lock lock(long jobId, boolean skip) {
        var ids = db.query("SELECT user_id,song_id FROM chart_jobs WHERE id=?", (r,n) -> new long[]{r.getLong(1),r.getLong(2)}, jobId);
        if (ids.isEmpty()) return null;
        long[] id = ids.getFirst();
        var users = db.query("SELECT status FROM users WHERE id=? FOR SHARE" + (skip ? " SKIP LOCKED" : ""), (r,n)->r.getString(1), id[0]);
        if (users.isEmpty()) return null;
        var songs = db.query("SELECT deleted_at IS NOT NULL,duration_ms FROM songs WHERE id=? FOR UPDATE" + (skip ? " SKIP LOCKED" : ""), (r,n)->new Object[]{r.getBoolean(1),r.getInt(2)}, id[1]);
        if (songs.isEmpty()) return null;
        var jobs = db.query("SELECT status,current_attempt_id,stage_deadline_at FROM chart_jobs WHERE id=? FOR UPDATE" + (skip ? " SKIP LOCKED" : ""),
                (r,n)->new Object[]{r.getString(1),r.getObject(2,UUID.class),r.getTimestamp(3)}, jobId);
        if (jobs.isEmpty()) return null;
        var j=jobs.getFirst(); var s=songs.getFirst();
        return new Lock(id[0],id[1],jobId,(String)j[0],(UUID)j[1],j[2]==null?null:((Timestamp)j[2]).toInstant(),(int)s[1],
                users.getFirst().equals("ACTIVE"),(boolean)s[0]);
    }
    static BusinessException conflict() { return new BusinessException(WorkerError.CONFLICT); }
    Lock valid(long job, UUID attempt, String worker, String stage) {
        Lock l=lock(job,false);
        if (l==null || !l.active() || l.deleted() || !stage.equals(l.status()) || !attempt.equals(l.currentAttemptId())) throw conflict();
        Boolean valid=db.queryForObject("SELECT EXISTS(SELECT 1 FROM chart_job_attempts WHERE id=? AND job_id=? AND worker_id=? AND finished_at IS NULL AND lease_expires_at>clock_timestamp()) AND ?::timestamptz>clock_timestamp()",
                Boolean.class,attempt,job,worker,Timestamp.from(l.deadline()));
        if (!Boolean.TRUE.equals(valid)) throw conflict();
        return l;
    }
    /** 워커 연락 시각 기록. 요청이 거절돼도 워커는 살아 있으므로 트랜잭션 밖에서 바로 반영 */
    void seen(String worker) {
        db.update("INSERT INTO chart_worker_presence(worker_id,last_seen_at) VALUES(?,clock_timestamp()) ON CONFLICT (worker_id) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at",worker);
    }
    /** 기록된 워커가 없거나 모든 워커의 마지막 연락이 기준 시간보다 오래되면 true */
    boolean workerOffline() {
        if (offlineAfterMs<=0) return false;
        return Boolean.TRUE.equals(db.queryForObject("SELECT coalesce(max(last_seen_at)<clock_timestamp()-?*interval '1 millisecond',true) FROM chart_worker_presence",Boolean.class,offlineAfterMs));
    }
    public Assignment claim(String worker, UUID request) {
        seen(worker);
        recover();
        return tx.execute(s -> {
            db.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", Object.class, worker+":"+request);
            var old=db.query("SELECT job_id,id FROM chart_job_attempts WHERE worker_id=? AND claim_request_id=?",
                    (r,n)->new Object[]{r.getLong(1),r.getObject(2,UUID.class)},worker,request);
            if (!old.isEmpty()) {
                var a=old.getFirst();
                Lock l=lock((long)a[0],false);
                if(l==null || l.currentAttemptId()==null || !l.currentAttemptId().equals(a[1]) || !l.active() || l.deleted()) throw conflict();
                valid(l.jobId(),(UUID)a[1],worker,l.status());
                if (!validDuration(l.durationMs())) throw conflict();
                return assignment(l.jobId(), (UUID)a[1]);
            }
            var candidates=db.queryForList("SELECT id FROM chart_jobs WHERE status='QUEUED' AND next_attempt_at<=clock_timestamp() ORDER BY next_attempt_at,id LIMIT 100",Long.class);
            for (long id:candidates) {
                Lock l=lock(id,true);
                if(l==null || !l.status().equals("QUEUED")) continue;
                if (!l.active() || l.deleted()) { finishFailure(l,"JOB_CANCELLED"); continue; }
                if (!validDuration(l.durationMs())) { finishFailure(l,"INPUT_INVALID"); continue; }
                if (l.deadline()!=null && !l.deadline().isAfter(Instant.now())) { finishFailure(l,"STAGE_TIMEOUT"); continue; }
                Boolean inputPresent=db.queryForObject("""
                    SELECT CASE WHEN j.resume_stage='SEPARATING' THEN EXISTS
                      (SELECT 1 FROM audio_uploads a WHERE a.job_id=j.id AND a.status='ACCEPTED' AND a.object_key=j.source_key)
                    ELSE EXISTS (SELECT 1 FROM chart_worker_files f WHERE f.job_id=j.id AND f.role='DRUM_STEM' AND f.object_key=j.drum_stem_key) END
                    FROM chart_jobs j WHERE j.id=?
                    """,Boolean.class,id);
                if(!Boolean.TRUE.equals(inputPresent)) { finishFailure(l,"INPUT_UNAVAILABLE"); continue; }
                var attempt=UUID.randomUUID();
                db.update("INSERT INTO chart_job_attempts(id,job_id,worker_id,claim_request_id,lease_expires_at) VALUES(?,?,?,?,clock_timestamp()+interval '60 seconds')",attempt,id,worker,request);
                db.update("UPDATE chart_jobs SET status=resume_stage,current_attempt_id=?,started_at=coalesce(started_at,clock_timestamp()),stage_deadline_at=coalesce(stage_deadline_at,clock_timestamp()+(2*?+60000)*interval '1 millisecond'),revision=revision+1 WHERE id=?",attempt,l.durationMs(),id);
                return assignment(id,attempt);
            }
            return null;
        });
    }
    private boolean validDuration(int durationMs) { return durationMs > 0 && durationMs <= 600_000; }
    Assignment assignment(long id, UUID attempt) {
        return db.queryForObject("""
            SELECT j.id,j.song_id,j.status,a.lease_expires_at,j.stage_deadline_at,
                   CASE WHEN j.status='SEPARATING' THEN 'SOURCE_AUDIO' ELSE 'DRUM_STEM' END,
                   CASE WHEN j.status='SEPARATING' THEN au.id ELSE f.id END,
                   CASE WHEN j.status='SEPARATING' THEN au.content_type ELSE f.content_type END,
                   CASE WHEN j.status='SEPARATING' THEN au.size_bytes ELSE f.size_bytes END,
                   CASE WHEN j.status='SEPARATING' THEN au.sha256 ELSE f.sha256 END,
                   so.duration_ms
            FROM chart_jobs j JOIN songs so ON so.id=j.song_id JOIN chart_job_attempts a ON a.id=? AND a.job_id=j.id
            LEFT JOIN audio_uploads au ON au.job_id=j.id AND au.status='ACCEPTED'
            LEFT JOIN chart_worker_files f ON f.job_id=j.id AND f.object_key=j.drum_stem_key AND f.role='DRUM_STEM'
            WHERE j.id=?
            """, (r,n)-> {
                UUID file=r.getObject(7,UUID.class);
                if(file==null) throw new BusinessException(WorkerError.UNAVAILABLE);
                return new Assignment(1,r.getLong(1),r.getLong(2),attempt,r.getString(3),
                        new Input(r.getString(6),file,r.getString(8),r.getLong(9),r.getString(10),r.getInt(11)),
                        List.of("NORMAL"),List.of(1),r.getTimestamp(4).toInstant(),r.getTimestamp(5).toInstant());
            },attempt,id);
    }
    public Heartbeat heartbeat(long job, String worker, UUID attempt, long seq, int progress) {
        seen(worker);
        return tx.execute(s -> {
            Lock l=lock(job,false);
            if (l==null || !(l.status().equals("SEPARATING") || l.status().equals("TRANSCRIBING"))) throw conflict();
            if (attempt==null) throw new BusinessException(WorkerError.INVALID);
            l=valid(job,attempt,worker,l.status());
            if(seq<1 || (l.status().equals("SEPARATING") ? progress<0 || progress>49 : progress<50 || progress>99))
                throw new BusinessException(WorkerError.INVALID);
            int changed=db.update("UPDATE chart_job_attempts SET heartbeat_seq=?,lease_expires_at=least(clock_timestamp()+interval '60 seconds',?) WHERE id=? AND heartbeat_seq<?",seq,Timestamp.from(l.deadline()),attempt,seq);
            if(changed==1) db.update("UPDATE chart_jobs SET progress=greatest(progress,?),revision=revision+1 WHERE id=? AND progress<?",progress,job,progress);
            return new Heartbeat(db.queryForObject("SELECT lease_expires_at FROM chart_job_attempts WHERE id=?",Timestamp.class,attempt).toInstant());
        });
    }
    public record FailureOutcome(String status, long revision) {}
    public FailureOutcome failure(long job, String worker, UUID attempt, long seq, String stage,
            String code, boolean retryable, String summary) {
        return failure(job,worker,attempt,seq,stage,code,retryable,summary,null);
    }
    public FailureOutcome failure(long job, String worker, UUID attempt, long seq, String stage,
            String code, boolean retryable, String summary, String reason) {
        if (attempt==null || seq<1 || !("SEPARATING".equals(stage) || "TRANSCRIBING".equals(stage))
                || !("INPUT_INVALID".equals(code) || "MODEL_FAILED".equals(code) || "OUTPUT_INVALID".equals(code))
                || (retryable && !"MODEL_FAILED".equals(code)) || summary==null || summary.length()>200
                || (reason!=null && !java.util.Set.of("SOURCE_INVALID", "NOT_TRANSCRIBABLE", "GPU_OUT_OF_MEMORY", "INTERNAL_ERROR").contains(reason))
                || summary.indexOf('\n')>=0 || summary.indexOf('\r')>=0)
            throw new BusinessException(WorkerError.INVALID);
        return tx.execute(s -> {
            Lock l=valid(job,attempt,worker,stage);
            Long previous=db.queryForObject("SELECT heartbeat_seq FROM chart_job_attempts WHERE id=? FOR UPDATE",Long.class,attempt);
            if (seq<=previous) throw conflict();
            db.update("UPDATE chart_job_attempts SET heartbeat_seq=? WHERE id=?",seq,attempt);
            retryOrFail(l,code,retryable,reason);
            return db.queryForObject("SELECT status,revision FROM chart_jobs WHERE id=?",(r,n)->new FailureOutcome(r.getString(1),r.getLong(2)),job);
        });
    }
    public void withdrawn(long userId) {
        var ids=newTx.execute(s -> db.queryForList("SELECT id FROM chart_jobs WHERE user_id=? AND status IN ('QUEUED','SEPARATING','TRANSCRIBING') ORDER BY id",Long.class,userId));
        for(long id:ids) newTx.executeWithoutResult(s -> {
            Lock l=lock(id,false);
            if(l!=null && !l.active() && (l.status().equals("QUEUED") || l.status().equals("SEPARATING") || l.status().equals("TRANSCRIBING")))
                finishFailure(l,"JOB_CANCELLED");
        });
    }
    @Scheduled(fixedDelayString="${chart.worker.recovery-interval-ms:10000}")
    void scheduledRecover() { recover(); }
    void recover() {
        // 워커 생존 여부는 회차마다 한 번만 조회해 그 회차의 모든 대기 작업에 같이 씀
        boolean offline=workerOffline();
        var queued=db.queryForList("SELECT j.id FROM chart_jobs j JOIN users u ON u.id=j.user_id JOIN songs so ON so.id=j.song_id WHERE j.status='QUEUED' AND (? OR j.queued_at+interval '30 minutes'<=clock_timestamp() OR j.stage_deadline_at<=clock_timestamp() OR u.status<>'ACTIVE' OR so.deleted_at IS NOT NULL) ORDER BY j.id LIMIT 100",Long.class,offline);
        for(long id:queued) tx.executeWithoutResult(s -> {
            Lock l=lock(id,true);
            if(l==null || !l.status().equals("QUEUED")) return;
            Boolean expired=db.queryForObject("SELECT queued_at+interval '30 minutes'<=clock_timestamp() OR stage_deadline_at<=clock_timestamp() FROM chart_jobs WHERE id=?",Boolean.class,id);
            if(!l.active() || l.deleted()) finishFailure(l,"JOB_CANCELLED");
            else if(Boolean.TRUE.equals(expired)) finishFailure(l,"STAGE_TIMEOUT");
            else if(offline) finishFailure(l,"WORKER_OFFLINE");
        });
        var ids=db.queryForList("SELECT j.id FROM chart_jobs j JOIN chart_job_attempts a ON a.id=j.current_attempt_id JOIN users u ON u.id=j.user_id JOIN songs so ON so.id=j.song_id WHERE j.status IN ('SEPARATING','TRANSCRIBING') AND (a.lease_expires_at<=clock_timestamp() OR j.stage_deadline_at<=clock_timestamp() OR u.status<>'ACTIVE' OR so.deleted_at IS NOT NULL) ORDER BY j.id LIMIT 100",Long.class);
        for(long id:ids) tx.executeWithoutResult(s -> {
            Lock l=lock(id,true);
            if(l==null || l.currentAttemptId()==null || !(l.status().equals("SEPARATING")||l.status().equals("TRANSCRIBING"))) return;
            Boolean expired=db.queryForObject("SELECT lease_expires_at<=clock_timestamp() OR ?::timestamptz<=clock_timestamp() FROM chart_job_attempts WHERE id=? FOR UPDATE",Boolean.class,Timestamp.from(l.deadline()),l.currentAttemptId());
            if(!l.active() || l.deleted()) { retryOrFail(l,"JOB_CANCELLED",false); return; }
            if(!Boolean.TRUE.equals(expired)) return;
            retryOrFail(l,"LEASE_EXPIRED",true);
        });
    }
    void retryOrFail(Lock l,String code,boolean retryable) {
        retryOrFail(l,code,retryable,null);
    }
    void retryOrFail(Lock l,String code,boolean retryable,String reason) {
        db.update("UPDATE chart_job_attempts SET finished_at=clock_timestamp() WHERE id=? AND finished_at IS NULL",l.currentAttemptId());
        String column=l.status().equals("SEPARATING")?"separation_retry_count":"transcription_retry_count";
        Integer count=db.queryForObject("SELECT "+column+" FROM chart_jobs WHERE id=?",Integer.class,l.jobId());
        if(retryable && l.active() && !l.deleted() && count<2 && l.deadline().isAfter(Instant.now())) {
            db.update("UPDATE chart_jobs SET status='QUEUED',current_attempt_id=NULL,resume_stage=?,"+column+"="+column+"+1,next_attempt_at=clock_timestamp()+?*interval '1 second',queued_at=clock_timestamp(),progress=?,revision=revision+1 WHERE id=?",l.status(),count==0?5:15,l.status().equals("SEPARATING")?0:50,l.jobId());
        } else finishFailure(l,code,reason);
    }
    void finishFailure(Lock l,String code) {
        finishFailure(l,code,null);
    }
    void finishFailure(Lock l,String code,String reason) {
        if(l.currentAttemptId()!=null) db.update("UPDATE chart_job_attempts SET finished_at=coalesce(finished_at,clock_timestamp()) WHERE id=?",l.currentAttemptId());
        db.update("UPDATE chart_jobs SET status='FAILED',error_code=?,error_reason=?,error_message='작업을 완료할 수 없습니다.',finished_at=clock_timestamp(),revision=revision+1 WHERE id=?",code,reason,l.jobId());
        db.update("UPDATE songs SET status='FAILED',updated_at=clock_timestamp() WHERE id=? AND deleted_at IS NULL AND status='PROCESSING'",l.songId());
        cleanupInputs(l);
    }
    void cleanupInputs(Lock l) {
        db.update("""
            INSERT INTO file_cleanup_tasks(object_key,file_role,user_id,job_id,attempt_id)
            SELECT key,role,?,?,? FROM (SELECT source_key AS key,'SOURCE' AS role FROM chart_jobs WHERE id=?
              UNION ALL SELECT drum_stem_key,'DRUM_STEM' FROM chart_jobs WHERE id=?) x WHERE key IS NOT NULL
            ON CONFLICT(object_key) DO NOTHING
            """,l.userId(),l.jobId(),l.currentAttemptId(),l.jobId(),l.jobId());
        db.update("UPDATE audio_uploads SET status='RETIRED',job_id=NULL,retired_at=clock_timestamp(),updated_at=clock_timestamp() WHERE job_id=? AND status='ACCEPTED'",l.jobId());
        db.update("UPDATE chart_jobs SET source_key=NULL,drum_stem_key=NULL WHERE id=?",l.jobId());
    }
    void inputUnavailable(long job,String worker,UUID attempt) {
        tx.executeWithoutResult(s -> {
            var state=lock(job,false);
            if(state==null || !(state.status().equals("SEPARATING") || state.status().equals("TRANSCRIBING"))) throw conflict();
            var l=valid(job,attempt,worker,state.status());
            finishFailure(l,"INPUT_UNAVAILABLE");
        });
    }
}
