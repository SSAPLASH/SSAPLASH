package com.ssafy.airdrum.domain.song.worker.midi;

import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import com.ssafy.airdrum.domain.song.repository.midi.MidiOriginalReceipts;
import com.ssafy.airdrum.domain.chart.storage.ChartAssetKeyPolicy;

/** MIDI 합성 전용 DB 임대. 모든 접수·완료·삭제는 회원 → 곡 → 작업 순서로 잠근다. */
public class MidiSynthesisQueue {
    public record Claim(long job, long song, long user, UUID attempt, String sourceKey, int size,
	            String sha256, String timing, int durationMs, int attemptNumber, long deadlineNanos) {}
    private record Candidate(long job, long song, long user) {}
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final ChartAssetKeyPolicy keys = new ChartAssetKeyPolicy();
    public MidiSynthesisQueue(JdbcTemplate db, PlatformTransactionManager manager) {
        this.db=db; this.tx=new TransactionTemplate(manager); this.tx.setTimeout(10);
    }

    public Claim claim() {
        var candidates=db.query("""
                SELECT id,song_id,user_id FROM midi_accompaniment_jobs
                WHERE (status='QUEUED' AND next_attempt_at<=clock_timestamp())
                   OR (status='RUNNING' AND (lease_expires_at<=clock_timestamp() OR attempt_deadline_at<=clock_timestamp()))
                   OR (status='QUEUED' AND created_at+interval '24 hours'<=clock_timestamp())
                ORDER BY id LIMIT 100
                """,(r,n)->new Candidate(r.getLong(1),r.getLong(2),r.getLong(3)));
        for (var candidate : candidates) {
            Claim claim=tx.execute(s -> claim(candidate));
            if (claim!=null) return claim;
        }
        return null;
    }
    private Claim claim(Candidate c) {
        db.execute("SET LOCAL lock_timeout='3s'");
        var users=db.queryForList("SELECT status FROM users WHERE id=? FOR SHARE SKIP LOCKED",String.class,c.user());
        if (users.isEmpty()) return null;
        var songs=db.query("SELECT deleted_at FROM songs WHERE id=? AND owner_id=? FOR UPDATE SKIP LOCKED",(r,n)->r.getTimestamp(1),c.song(),c.user());
        if (songs.isEmpty()) return null;
        var jobs=db.query("""
                SELECT j.status,j.attempts,j.created_at+interval '24 hours'<=clock_timestamp(),
                       j.next_attempt_at<=clock_timestamp(),j.lease_expires_at<=clock_timestamp(),j.attempt_deadline_at<=clock_timestamp(),
                       o.id,o.object_key,o.size_bytes,o.sha256,o.status,j.timing::text,j.duration_ms
                FROM midi_accompaniment_jobs j JOIN midi_original_uploads o ON o.id=j.original_id
                WHERE j.id=? FOR UPDATE OF j SKIP LOCKED
                """,(r,n)->new Object[]{r.getString(1),r.getInt(2),r.getBoolean(3),r.getBoolean(4),r.getBoolean(5),r.getBoolean(6),
                    r.getObject(7,UUID.class),r.getString(8),r.getInt(9),r.getString(10),r.getString(11),r.getString(12),r.getInt(13)},c.job());
        if (jobs.isEmpty()) return null;
        var j=jobs.getFirst();
        if (!"QUEUED".equals(j[0]) && !"RUNNING".equals(j[0])) return null;
        boolean live=!users.isEmpty() && "ACTIVE".equals(users.getFirst()) && !songs.isEmpty() && songs.getFirst()==null;
        if (!live || !"ACCEPTED".equals(j[10])) { terminal(c.job(),"CANCELLED","SOURCE_REMOVED"); return null; }
        if ((boolean)j[2]) { terminal(c.job(),"FAILED","QUEUE_EXPIRED"); return null; }
        if ("RUNNING".equals(j[0])) {
            if (!(boolean)j[4] && !(boolean)j[5]) return null;
            if ((int)j[1]>=3) terminal(c.job(),"FAILED","ATTEMPTS_EXHAUSTED");
            else requeue(c.job(),(int)j[1]);
            return null;
        }
        if (!(boolean)j[3]) return null;
        MidiOriginalReceipts.requireKey(c.user(),c.song(),(UUID)j[6],(String)j[7]);
        UUID token=UUID.randomUUID();
        db.update("INSERT INTO midi_accompaniment_attempts(id,job_id) VALUES (?,?)",token,c.job());
        long started=System.nanoTime();
        long remaining=db.queryForObject("""
                UPDATE midi_accompaniment_jobs SET status='RUNNING',attempt_id=?,attempts=attempts+1,
                   attempt_deadline_at=least(clock_timestamp()+interval '300 seconds',created_at+interval '24 hours'),
                   lease_expires_at=least(clock_timestamp()+interval '60 seconds',created_at+interval '24 hours'),error_code=NULL
                WHERE id=? RETURNING greatest(0,floor(extract(epoch from (attempt_deadline_at-clock_timestamp()))*1000))::bigint
                """,Long.class,token,c.job());
        return new Claim(c.job(),c.song(),c.user(),token,(String)j[7],(int)j[8],(String)j[9],(String)j[11],(int)j[12],(int)j[1]+1,
                started+java.util.concurrent.TimeUnit.MILLISECONDS.toNanos(remaining));
    }
    private void terminal(long id,String state,String error) {
        db.update("UPDATE midi_accompaniment_jobs SET status=?,attempt_id=NULL,lease_expires_at=NULL,attempt_deadline_at=NULL,finished_at=clock_timestamp(),error_code=? WHERE id=?",state,error,id);
    }
    private void requeue(long id,int attempts) {
        db.update("""
                UPDATE midi_accompaniment_jobs SET status='QUEUED',attempt_id=NULL,lease_expires_at=NULL,attempt_deadline_at=NULL,
                  next_attempt_at=clock_timestamp()+?*interval '1 second',error_code='RETRYING' WHERE id=?
                """,attempts==1?5:30,id);
    }
    public boolean heartbeat(Claim c) {
        return db.update("""
                UPDATE midi_accompaniment_jobs SET lease_expires_at=least(clock_timestamp()+interval '60 seconds',attempt_deadline_at)
                WHERE id=? AND status='RUNNING' AND attempt_id=? AND lease_expires_at>clock_timestamp()
                  AND attempt_deadline_at>clock_timestamp()
                """,c.job(),c.attempt())==1;
    }
    /** 업로드보다 먼저 불변 키와 정리 대상을 기록한다. */
    public String reserveOutput(Claim c) {
        return tx.execute(s -> {
            if (!lockCurrent(c)) return null;
            String key="accompaniment/"+c.song()+"/"+c.attempt()+"/"+UUID.randomUUID()+".flac";
            keys.accompaniment(c.song(),key);
            db.update("""
                    INSERT INTO file_cleanup_tasks(object_key,file_role,user_id,midi_job_id,midi_attempt_id,next_attempt_at,midi_recheck_until)
                    SELECT ?,'ACCOMPANIMENT',?,?,?,attempt_deadline_at+interval '30 seconds',attempt_deadline_at+interval '24 hours 30 seconds'
                    FROM midi_accompaniment_jobs WHERE id=?
                    """,key,c.user(),c.job(),c.attempt(),c.job());
            return key;
        });
    }
    public boolean complete(Claim c,String key) {
        return Boolean.TRUE.equals(tx.execute(s -> {
            if (!lockCurrent(c)) return false;
            keys.accompaniment(c.song(),key);
            var task=db.queryForList("""
                    SELECT id FROM file_cleanup_tasks WHERE object_key=? AND midi_job_id=? AND midi_attempt_id=? AND status='PENDING' FOR UPDATE
                    """,Long.class,key,c.job(),c.attempt());
            if (task.isEmpty()) return false;
            String old=db.queryForObject("SELECT accompaniment_key FROM songs WHERE id=?",String.class,c.song());
            db.update("UPDATE songs SET accompaniment_key=?,updated_at=clock_timestamp() WHERE id=?",key,c.song());
            terminal(c.job(),"DONE",null);
            if (old!=null && !old.equals(key)) {
                keys.accompaniment(c.song(),old);
                db.update("""
                        INSERT INTO file_cleanup_tasks(object_key,file_role,user_id,next_attempt_at)
                        VALUES(?,'ACCOMPANIMENT',?,clock_timestamp()+interval '12 minutes')
                        ON CONFLICT(object_key) DO UPDATE SET status='PENDING',deleted_at=NULL,
                          next_attempt_at=clock_timestamp()+interval '12 minutes',
                          midi_recheck_until=CASE WHEN file_cleanup_tasks.midi_job_id IS NULL THEN file_cleanup_tasks.midi_recheck_until
                            ELSE clock_timestamp()+interval '24 hours 30 seconds' END,
                          updated_at=greatest(clock_timestamp(),file_cleanup_tasks.updated_at+interval '1 microsecond')
                        """,old,c.user());
            }
            return true;
        }));
    }
    public void fail(Claim c,boolean retryable,String error) {
        tx.executeWithoutResult(s -> {
            if (!lockCurrent(c)) return;
            if (retryable && c.attemptNumber()<3) requeue(c.job(),c.attemptNumber());
            else terminal(c.job(),"FAILED",error);
        });
    }
    private boolean lockCurrent(Claim c) {
        db.execute("SET LOCAL lock_timeout='3s'");
        var user=db.queryForList("SELECT status FROM users WHERE id=? FOR SHARE",String.class,c.user());
        var song=db.query("SELECT deleted_at FROM songs WHERE id=? AND owner_id=? FOR UPDATE",(r,n)->r.getTimestamp(1),c.song(),c.user());
        var job=db.queryForList("""
                SELECT id FROM midi_accompaniment_jobs WHERE id=? AND status='RUNNING' AND attempt_id=?
                    AND lease_expires_at>clock_timestamp() AND attempt_deadline_at>clock_timestamp() FOR UPDATE
                """,Long.class,c.job(),c.attempt());
        return !user.isEmpty() && "ACTIVE".equals(user.getFirst()) && !song.isEmpty() && song.getFirst()==null && !job.isEmpty();
    }
}
