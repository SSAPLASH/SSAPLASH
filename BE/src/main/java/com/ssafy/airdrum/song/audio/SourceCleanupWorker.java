package com.ssafy.airdrum.song.audio;

import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Timestamp;

@Component
public class SourceCleanupWorker {
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final AudioUploadRepository receipts;
    private final AudioStore store;
    private final boolean enabled;

    public SourceCleanupWorker(
            JdbcTemplate db,
            PlatformTransactionManager manager,
            AudioUploadRepository receipts,
            AudioStore store,
            @Value("${audio.storage.enabled:false}") boolean enabled) {
        this.enabled = enabled;
        this.db = db;
        this.tx = new TransactionTemplate(manager);
        this.tx.setTimeout(10);
        this.receipts = receipts;
        this.store = store;
    }

    @Scheduled(
            fixedDelayString = "${audio.cleanup-interval-ms:60000}",
            initialDelayString = "${audio.cleanup-interval-ms:60000}")
    public void scheduled() {
        if (!enabled) return;
        try {
            runOnce();
        } catch (RuntimeException e) {
            LoggerFactory.getLogger(SourceCleanupWorker.class).warn("음원 원본 정리가 지연되었습니다.");
        }
    }

    public void runOnce() {
        receipts.recover();
        store.checkAvailable();
        for (int i = 0; i < 100; i++) {
            var c = claim();
            if (c == null) break;
            try {
                if (store.exists(c.key())) store.delete(c.key());
                finish(c, true);
            } catch (RuntimeException e) {
                finish(c, false);
            }
        }
    }

    record Claim(long id, String key, int attempts, Timestamp token) {}

    Claim claim() {
        return tx.execute(
                s -> {
                    var rows =
                            db.query(
                                    """
                                    SELECT t.id,t.object_key,t.retry_count FROM file_cleanup_tasks t
                                    WHERE t.file_role='SOURCE' AND t.next_attempt_at<=now()
                                    AND EXISTS(SELECT 1 FROM audio_uploads a WHERE a.object_key=t.object_key AND a.status='RETIRED')
                                    AND NOT EXISTS(SELECT 1 FROM chart_jobs j WHERE j.source_key=t.object_key)
                                    ORDER BY t.next_attempt_at,t.id LIMIT 1 FOR UPDATE OF t SKIP LOCKED
                                    """,
                                    (r, n) ->
                                            new Claim(
                                                    r.getLong(1),
                                                    r.getString(2),
                                                    r.getInt(3),
                                                    null));
                    if (rows.isEmpty()) return null;
                    var c = rows.getFirst();
                    var token =
                            db.queryForObject(
                                    "UPDATE file_cleanup_tasks SET"
                                        + " status='DELETING',deleted_at=NULL,next_attempt_at=now()+interval"
                                        + " '3 minutes',updated_at=GREATEST(clock_timestamp(),updated_at+interval"
                                        + " '1 microsecond') WHERE id=? RETURNING updated_at",
                                    Timestamp.class,
                                    c.id());
                    return new Claim(c.id(), c.key(), c.attempts(), token);
                });
    }

    void finish(Claim c, boolean ok) {
        long seconds = Math.min(86400, 60L * (1L << Math.min(c.attempts(), 11)));
        db.update(
                """
                UPDATE file_cleanup_tasks SET status=?,deleted_at=CASE WHEN ? THEN clock_timestamp() ELSE NULL END,
                retry_count=least(retry_count+1,30),next_attempt_at=clock_timestamp()+?*interval '1 second',last_error=?,
                updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond') WHERE id=? AND status='DELETING' AND updated_at=?
                """,
                ok ? "DELETED" : "FAILED",
                ok,
                seconds,
                ok ? null : "음원 원본 정리 실패",
                c.id(),
                c.token());
    }
}
