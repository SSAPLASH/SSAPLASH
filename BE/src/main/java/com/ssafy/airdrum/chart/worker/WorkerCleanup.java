package com.ssafy.airdrum.chart.worker;

import java.sql.Timestamp;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 유효한 시도와 참조 중인 정식 파일을 보호하며 뒤늦은 PUT도 재검색한다. */
@Component
class WorkerCleanup {
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final WorkerStore store;
    private final boolean enabled;
    WorkerCleanup(JdbcTemplate db,PlatformTransactionManager manager,WorkerStore store,
            @Value("${audio.storage.enabled:false}") boolean audioEnabled,
            @Value("${chart.assets.enabled:false}") boolean chartEnabled) {
        this.db=db; this.tx=new TransactionTemplate(manager); this.tx.setTimeout(10); this.store=store; this.enabled=audioEnabled || chartEnabled;
    }
    record Claim(long id,String key,String role,int retry,Timestamp token) {}
    @Scheduled(fixedDelayString="${chart.worker.cleanup-interval-ms:60000}",initialDelayString="${chart.worker.cleanup-interval-ms:60000}")
    void scheduled() {
        if(!enabled) return;
        try { runOnce(); } catch(RuntimeException e) { LoggerFactory.getLogger(WorkerCleanup.class).warn("워커 파일 정리가 지연되었습니다."); }
    }
    void runOnce() {
        for(int i=0;i<100;i++) {
            Claim c=claim(); if(c==null) break;
            try {
                var bucket=switch(c.role()) { case "ACCOMPANIMENT" -> WorkerStore.Bucket.ACCOMPANIMENT; case "SHEET_PAGE", "COVER" -> WorkerStore.Bucket.SHEET; default -> WorkerStore.Bucket.AUDIO; };
                if(store.exists(bucket,c.key())) store.delete(bucket,c.key());
                finish(c,true);
            } catch(RuntimeException x) { finish(c,false); }
        }
    }
    Claim claim() {
        return tx.execute(s -> {
            var rows=db.query("""
                SELECT t.id,t.object_key,t.file_role,t.retry_count FROM file_cleanup_tasks t
                WHERE t.file_role IN ('STAGING','DRUM_STEM','ACCOMPANIMENT','SHEET_PAGE','COVER') AND t.next_attempt_at<=clock_timestamp()
                  AND (t.status<>'DELETED' OR t.created_at+interval '1 day'>clock_timestamp())
                  AND NOT EXISTS(SELECT 1 FROM chart_jobs j JOIN chart_job_attempts a ON a.id=j.current_attempt_id
                    WHERE j.id=t.job_id AND a.id=t.attempt_id AND j.status IN ('SEPARATING','TRANSCRIBING')
                      AND a.finished_at IS NULL AND a.lease_expires_at>clock_timestamp() AND j.stage_deadline_at>clock_timestamp())
                  AND NOT EXISTS(SELECT 1 FROM chart_jobs j WHERE j.drum_stem_key=t.object_key)
                  AND NOT EXISTS(SELECT 1 FROM songs s LEFT JOIN users u ON u.id=s.owner_id WHERE s.cover_key=t.object_key AND s.deleted_at IS NULL AND (s.source='BUILTIN' OR u.status='ACTIVE'))
                  AND NOT EXISTS(SELECT 1 FROM songs s LEFT JOIN users u ON u.id=s.owner_id WHERE s.accompaniment_key=t.object_key AND s.deleted_at IS NULL AND (s.source='BUILTIN' OR u.status='ACTIVE'))
                AND NOT EXISTS(SELECT 1 FROM chart_versions v JOIN charts c ON c.id=v.chart_id JOIN songs s ON s.id=c.song_id
                    LEFT JOIN users u ON u.id=s.owner_id CROSS JOIN LATERAL jsonb_array_elements(coalesce(v.sheet_pages,'[]'::jsonb)) p
                    WHERE p->>'imageKey'=t.object_key AND s.deleted_at IS NULL AND (s.source='BUILTIN' OR u.status='ACTIVE'))
                ORDER BY t.next_attempt_at,t.id LIMIT 1 FOR UPDATE OF t SKIP LOCKED
                """,(r,n)->new Claim(r.getLong(1),r.getString(2),r.getString(3),r.getInt(4),null));
            if(rows.isEmpty()) return null;
            var c=rows.getFirst();
            var token=db.queryForObject("UPDATE file_cleanup_tasks SET status='DELETING',deleted_at=NULL,next_attempt_at=clock_timestamp()+interval '3 minutes',updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') WHERE id=? RETURNING updated_at",Timestamp.class,c.id());
            return new Claim(c.id(),c.key(),c.role(),c.retry(),token);
        });
    }
    void finish(Claim c,boolean success) {
        long seconds=success?300:Math.min(86400,60L*(1L<<Math.min(c.retry(),11)));
        db.update("""
            UPDATE file_cleanup_tasks SET status=?,deleted_at=CASE WHEN ? THEN clock_timestamp() ELSE NULL END,
              retry_count=CASE WHEN ? THEN retry_count ELSE least(retry_count+1,30) END,
              next_attempt_at=clock_timestamp()+?*interval '1 second',last_error=?,
              updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
            WHERE id=? AND status='DELETING' AND updated_at=?
            """,success?"DELETED":"FAILED",success,success,seconds,success?null:"워커 파일 정리 실패",c.id(),c.token());
    }
}
