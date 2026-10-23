package com.ssafy.airdrum.storage.cleanup;

import java.sql.Timestamp;
import java.util.concurrent.atomic.AtomicLong;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import io.micrometer.core.instrument.MeterRegistry;
import com.ssafy.airdrum.play.raw.PlayRawProperties;
import com.ssafy.airdrum.play.raw.PlayRawStore;
import com.ssafy.airdrum.play.raw.PlayRawUploadRepository;

/** RAW_LOG만 소유한다. 삭제 성공 후에도 RETIRED 키의 늦은 PUT을 주기적으로 회수한다. */
@Component
public class RawLogCleanupWorker {
	private static final Logger log=LoggerFactory.getLogger(RawLogCleanupWorker.class);
	private final JdbcTemplate db;
	private final TransactionTemplate tx;
	private final PlayRawStore store;
	private final PlayRawUploadRepository receipts;
	private final PlayRawProperties properties;
	private final MeterRegistry meters;
	private final AtomicLong failed=new AtomicLong(), oldest=new AtomicLong();
	public RawLogCleanupWorker(JdbcTemplate db,PlatformTransactionManager manager,PlayRawStore store,PlayRawUploadRepository receipts,PlayRawProperties properties,MeterRegistry meters) {
		this.db=db; this.tx=new TransactionTemplate(manager); tx.setTimeout(10);
		this.store=store; this.receipts=receipts; this.properties=properties; this.meters=meters;
		meters.gauge("play.raw.cleanup.failed",failed); meters.gauge("play.raw.cleanup.oldest.seconds",oldest);
	}
	@Scheduled(fixedDelayString="${play.raw.cleanup-interval-ms:60000}",initialDelayString="${play.raw.cleanup-interval-ms:60000}")
	public void scheduled() {
		if(!properties.enabled()) return;
		try { runOnce(); } catch(RuntimeException ex) { log.warn("플레이 원본 복구 작업 실패. 다음 주기에 재시도합니다."); }
	}
	public void runOnce() {
		receipts.recover(); store.checkAvailable();
		for(int i=0;i<100;i++) {
			var c=claim(); if(c==null) break;
			try {
				if(store.exists(c.key())) { if(c.recheck()) meters.counter("play.raw.cleanup.recreated").increment(); store.delete(c.key()); }
				finish(c,true);
			} catch(RuntimeException ex) { finish(c,false); }
		}
		failed.set(db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE file_role='RAW_LOG' AND status='FAILED'",Long.class));
		oldest.set(db.queryForObject("SELECT coalesce(extract(epoch FROM now()-min(created_at))::bigint,0) FROM file_cleanup_tasks WHERE file_role='RAW_LOG' AND status<>'DELETED'",Long.class));
	}
	public record Claim(long id,String key,Timestamp token,int attempts,boolean recheck) {}
	public Claim claim() {
		return tx.execute(status -> {
			var rows=db.query("""
				SELECT t.id,t.object_key,t.retry_count,t.status FROM file_cleanup_tasks t
				WHERE t.file_role='RAW_LOG' AND t.next_attempt_at<=now()
				AND EXISTS(SELECT 1 FROM play_raw_uploads r WHERE r.object_key=t.object_key AND r.status='RETIRED')
				AND NOT EXISTS(SELECT 1 FROM play_sessions s WHERE s.raw_log_key=t.object_key)
				ORDER BY t.next_attempt_at,t.id LIMIT 1 FOR UPDATE OF t SKIP LOCKED
				""",(r,n)->new Claim(r.getLong(1),r.getString(2),null,r.getInt(3),r.getString(4).equals("DELETED")));
			if(rows.isEmpty()) return null; var c=rows.getFirst();
			Timestamp token=db.queryForObject("""
				UPDATE file_cleanup_tasks SET status='DELETING',deleted_at=NULL,next_attempt_at=now()+interval '3 minutes',
				updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond') WHERE id=? RETURNING updated_at
				""",Timestamp.class,c.id());
			return new Claim(c.id(),c.key(),token,c.attempts(),c.recheck());
		});
	}
	public void finish(Claim c,boolean success) {
		long seconds=Math.min(86400,60L*(1L<<Math.min(c.attempts(),11)));
		db.update("""
			UPDATE file_cleanup_tasks SET status=?,deleted_at=CASE WHEN ? THEN clock_timestamp() ELSE NULL END,
			retry_count=least(retry_count+1,30),next_attempt_at=clock_timestamp()+?*interval '1 second',last_error=?,
			updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond')
			WHERE id=? AND status='DELETING' AND updated_at=?
			""",success?"DELETED":"FAILED",success,seconds,success?null:"원본 객체 정리 실패",c.id(),c.token());
	}
}
