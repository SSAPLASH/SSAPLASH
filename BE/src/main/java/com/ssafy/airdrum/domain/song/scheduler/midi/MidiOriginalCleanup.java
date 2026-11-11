package com.ssafy.airdrum.domain.song.scheduler.midi;

import java.sql.Timestamp;
import java.util.UUID;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import com.ssafy.airdrum.domain.song.repository.midi.MidiOriginalReceipts;
import com.ssafy.airdrum.domain.song.storage.midi.MidiOriginalStore;

/** 접수 만료와 삭제된 원본을 회수하고 늦게 도착한 PUT을 반복 확인한다. */
@Component
class MidiOriginalCleanup {
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final MidiOriginalStore store;
    private final boolean enabled;
    MidiOriginalCleanup(JdbcTemplate db, PlatformTransactionManager manager, MidiOriginalStore store,
            @Value("${midi.storage.enabled:false}") boolean enabled) {
        this.db=db; this.tx=new TransactionTemplate(manager); this.tx.setTimeout(10); this.store=store; this.enabled=enabled;
    }
    record Candidate(long task, UUID receipt, long user, long song) {}
    record Claim(long task, String key, int retry, Timestamp token) {}
    @Scheduled(fixedDelayString="${midi.cleanup-interval-ms:60000}", initialDelayString="${midi.cleanup-interval-ms:60000}")
    void scheduled() {
        if (!enabled) return;
        try { runOnce(); }
        catch (RuntimeException e) { LoggerFactory.getLogger(getClass()).warn("MIDI 원본 정리가 지연되었습니다."); }
    }
    void runOnce() {
        var candidates=db.query("""
                SELECT t.id,o.id,o.user_id,o.reserved_song_id FROM file_cleanup_tasks t
                JOIN midi_original_uploads o ON o.id=t.midi_original_id
                WHERE t.file_role='MIDI_ORIGINAL' AND t.next_attempt_at<=clock_timestamp()
                  AND (t.status<>'DELETED' OR t.midi_recheck_until>clock_timestamp())
                ORDER BY t.next_attempt_at,t.id LIMIT 100
                """,(r,n)->new Candidate(r.getLong(1),r.getObject(2,UUID.class),r.getLong(3),r.getLong(4)));
        for (var candidate : candidates) {
            var claim=claim(candidate);
            if (claim==null) continue;
            try { if (store.exists(claim.key())) store.delete(claim.key()); finish(claim,true); }
            catch (RuntimeException e) { finish(claim,false); }
        }
    }
    Claim claim(Candidate c) {
        return tx.execute(s -> {
            db.execute("SET LOCAL lock_timeout='3s'");
            var user=db.queryForList("SELECT status FROM users WHERE id=? FOR SHARE",String.class,c.user());
            var song=db.query("SELECT deleted_at FROM songs WHERE id=? AND owner_id=? FOR UPDATE",
                    (r,n)->r.getTimestamp(1),c.song(),c.user());
            var original=db.query("SELECT object_key,status,expires_at<=clock_timestamp() FROM midi_original_uploads WHERE id=? FOR UPDATE",
                    (r,n)->new Object[]{r.getString(1),r.getString(2),r.getBoolean(3)},c.receipt());
            if (original.isEmpty()) return null;
            var row=original.getFirst();
            MidiOriginalReceipts.requireKey(c.user(),c.song(),c.receipt(),(String)row[0]);
            // SELECT 시점에 아직 보이지 않던 곡이 receipt 잠금을 기다리는 동안 커밋됐을 수 있다.
            // 잠금 순서를 뒤집어 재조회하지 않고 다음 순회에서 곡부터 다시 잠근다.
            if ("ACCEPTED".equals(row[1]) && song.isEmpty()) return null;
            var tasks=db.query("SELECT status,retry_count,next_attempt_at<=clock_timestamp(),midi_recheck_until>clock_timestamp() FROM file_cleanup_tasks WHERE id=? AND midi_original_id=? FOR UPDATE",
                    (r,n)->new Object[]{r.getString(1),r.getInt(2),r.getBoolean(3),r.getBoolean(4)},c.task(),c.receipt());
            if (tasks.isEmpty()) return null;
            var task=tasks.getFirst();
            if (!(boolean)task[2] || ("DELETED".equals(task[0]) && !(boolean)task[3])) return null;
            boolean live=!user.isEmpty() && "ACTIVE".equals(user.getFirst()) && !song.isEmpty() && song.getFirst()==null;
            if ("ACCEPTED".equals(row[1]) && live) {
                db.update("UPDATE file_cleanup_tasks SET next_attempt_at=clock_timestamp()+interval '1 hour' WHERE id=?",c.task());
                return null;
            }
            if ("RECEIVING".equals(row[1]) && !(boolean)row[2]) return null;
            if (!"RETIRED".equals(row[1])) {
                db.update("UPDATE midi_original_uploads SET status='RETIRED',song_id=NULL,retired_at=clock_timestamp() WHERE id=?",c.receipt());
                db.update("UPDATE file_cleanup_tasks SET midi_recheck_until=clock_timestamp()+interval '24 hours 30 seconds' WHERE id=?",c.task());
            }
            var token=db.queryForObject("""
                    UPDATE file_cleanup_tasks SET status='DELETING',deleted_at=NULL,next_attempt_at=clock_timestamp()+interval '3 minutes',
                    updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') WHERE id=? RETURNING updated_at
                    """,Timestamp.class,c.task());
            return new Claim(c.task(),(String)row[0],(int)task[1],token);
        });
    }
    void finish(Claim c, boolean success) {
        long seconds=success ? 300 : Math.min(3600,60L*(1L<<Math.min(c.retry(),6)));
        db.update("""
                UPDATE file_cleanup_tasks SET status=?,deleted_at=CASE WHEN ? THEN clock_timestamp() ELSE NULL END,
                  retry_count=CASE WHEN ? THEN retry_count ELSE least(retry_count+1,30) END,
                  next_attempt_at=clock_timestamp()+?*interval '1 second',last_error=?,
                  updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
                WHERE id=? AND status='DELETING' AND updated_at=?
                """,success?"DELETED":"FAILED",success,success,seconds,success?null:"MIDI 원본 정리 실패",c.task(),c.token());
    }
}
