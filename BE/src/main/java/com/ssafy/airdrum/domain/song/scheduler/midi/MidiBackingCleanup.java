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
import com.ssafy.airdrum.domain.song.storage.midi.MidiBackingStore;
import com.ssafy.airdrum.domain.chart.storage.ChartAssetKeyPolicy;

/** MIDI 결과 키는 MIDI 시도의 임대와 현재 곡 참조를 함께 확인한 후에만 삭제한다. */
@Component
class MidiBackingCleanup {
    record Candidate(long task,long user,long song,long job,UUID attempt) {}
    record Claim(long task,String key,int retry,Timestamp token) {}
    private final JdbcTemplate db; private final TransactionTemplate tx; private final MidiBackingStore store;
    private final boolean enabled; private final ChartAssetKeyPolicy keys=new ChartAssetKeyPolicy();
    MidiBackingCleanup(JdbcTemplate db,PlatformTransactionManager manager,MidiBackingStore store,
            @Value("${chart.assets.enabled:false}") boolean enabled) {
        this.db=db; this.tx=new TransactionTemplate(manager); this.tx.setTimeout(10); this.store=store; this.enabled=enabled;
    }
    @Scheduled(fixedDelayString="${midi.cleanup-interval-ms:60000}",initialDelayString="${midi.cleanup-interval-ms:60000}")
    void scheduled() {
        if (!enabled) return;
        try { runOnce(); } catch (RuntimeException e) { LoggerFactory.getLogger(getClass()).warn("MIDI 반주 정리가 지연되었습니다."); }
    }
    void runOnce() {
        var candidates=db.query("""
                SELECT t.id,j.user_id,j.song_id,j.id,t.midi_attempt_id FROM file_cleanup_tasks t
                JOIN midi_accompaniment_jobs j ON j.id=t.midi_job_id
                WHERE t.file_role='ACCOMPANIMENT' AND t.next_attempt_at<=clock_timestamp()
                  AND (t.status<>'DELETED' OR t.midi_recheck_until>clock_timestamp())
                ORDER BY t.next_attempt_at,t.id LIMIT 100
                """,(r,n)->new Candidate(r.getLong(1),r.getLong(2),r.getLong(3),r.getLong(4),r.getObject(5,UUID.class)));
        for (var candidate:candidates) {
            Claim c=claim(candidate); if (c==null) continue;
            try { if (store.exists(c.key())) store.delete(c.key()); finish(c,true); }
            catch (RuntimeException e) { finish(c,false); }
        }
    }
    Claim claim(Candidate c) {
        return tx.execute(s->{
            db.execute("SET LOCAL lock_timeout='3s'");
            var user=db.queryForList("SELECT status FROM users WHERE id=? FOR SHARE",String.class,c.user());
            var song=db.query("SELECT deleted_at,accompaniment_key FROM songs WHERE id=? AND owner_id=? FOR UPDATE",
                    (r,n)->new Object[]{r.getTimestamp(1),r.getString(2)},c.song(),c.user());
            var job=db.query("""
                    SELECT status,attempt_id,lease_expires_at>clock_timestamp(),attempt_deadline_at>clock_timestamp()
                    FROM midi_accompaniment_jobs WHERE id=? FOR UPDATE
                    """,(r,n)->new Object[]{r.getString(1),r.getObject(2,UUID.class),r.getBoolean(3),r.getBoolean(4)},c.job());
            var rows=db.query("""
                    SELECT object_key,status,retry_count,next_attempt_at<=clock_timestamp(),midi_recheck_until>clock_timestamp()
                    FROM file_cleanup_tasks WHERE id=? AND midi_job_id=? AND midi_attempt_id=? FOR UPDATE
                    """,(r,n)->new Object[]{r.getString(1),r.getString(2),r.getInt(3),r.getBoolean(4),r.getBoolean(5)},c.task(),c.job(),c.attempt());
            if (rows.isEmpty()) return null;
            var row=rows.getFirst(); keys.accompaniment(c.song(),(String)row[0]);
            if (!(boolean)row[3] || ("DELETED".equals(row[1]) && !(boolean)row[4])) return null;
            boolean live=!user.isEmpty() && "ACTIVE".equals(user.getFirst()) && !song.isEmpty() && song.getFirst()[0]==null;
            if (live && row[0].equals(song.getFirst()[1])) {
                db.update("UPDATE file_cleanup_tasks SET next_attempt_at=clock_timestamp()+interval '1 hour' WHERE id=?",c.task());
                return null;
            }
            if (!job.isEmpty()) {
                var j=job.getFirst();
                if ("RUNNING".equals(j[0]) && c.attempt().equals(j[1]) && (boolean)j[2] && (boolean)j[3]) return null;
            }
            var token=db.queryForObject("""
                    UPDATE file_cleanup_tasks SET status='DELETING',deleted_at=NULL,next_attempt_at=clock_timestamp()+interval '3 minutes',
                      updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') WHERE id=? RETURNING updated_at
                    """,Timestamp.class,c.task());
            return new Claim(c.task(),(String)row[0],(int)row[2],token);
        });
    }
    void finish(Claim c,boolean success) {
        long seconds=success?300:Math.min(3600,60L*(1L<<Math.min(c.retry(),6)));
        db.update("""
                UPDATE file_cleanup_tasks SET status=?,deleted_at=CASE WHEN ? THEN clock_timestamp() ELSE NULL END,
                  retry_count=CASE WHEN ? THEN retry_count ELSE least(retry_count+1,30) END,
                  next_attempt_at=clock_timestamp()+?*interval '1 second',last_error=?,
                  updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
                WHERE id=? AND status='DELETING' AND updated_at=?
                """,success?"DELETED":"FAILED",success,success,seconds,success?null:"MIDI 반주 정리 실패",c.task(),c.token());
    }
}
