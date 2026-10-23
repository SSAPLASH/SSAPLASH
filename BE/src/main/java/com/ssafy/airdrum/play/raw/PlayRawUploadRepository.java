package com.ssafy.airdrum.play.raw;

import java.sql.Timestamp;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.play.PlayErrorCode;
import com.ssafy.airdrum.play.PlaySessionRepository;
import com.ssafy.airdrum.play.PlayUploadTransaction;

/** 모든 외부 I/O는 호출자가 트랜잭션 밖에서 수행한다. 실패 결과는 퇴역 커밋 후 전달한다. */
@Repository
public class PlayRawUploadRepository {
	private final JdbcTemplate db;
	private final PlaySessionRepository sessions;
	private final PlayUploadTransaction users;
	private final TransactionTemplate tx;
	public PlayRawUploadRepository(JdbcTemplate db,PlaySessionRepository sessions,PlayUploadTransaction users,PlatformTransactionManager manager) {
		this.db=db; this.sessions=sessions; this.users=users;
		tx=new TransactionTemplate(manager); tx.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED); tx.setTimeout(15);
	}
	public record Attempt(UUID id,UUID livePlay,String key,String hash,long bytes,String status,boolean expired) {}
	public Attempt begin(long user,UUID play,String expectedSummaryHash,PlayRawValidator.Validated payload) {
		return tx.execute(status -> {
			limits(); users.active(user); var s=sessions.own(play,user,true);
			// 검증 중 UUID가 다른 요약에 재사용되면 이전 hits 기준 원본을 접수하지 않는다.
			if(!s.hash().equals(expectedSummaryHash)) throw new BusinessException(PlayErrorCode.PLAY_STATE_CHANGED);
			var accepted=accepted(play);
			if(accepted!=null) { same(accepted,payload); return null; }
			if(!s.rawStatus().equals("PENDING")) throw new BusinessException(PlayErrorCode.PLAY_STATE_CHANGED);
			UUID id=UUID.randomUUID(); String key="play-raw/"+play+"/"+id+".json.gz";
			db.update("""
				INSERT INTO play_raw_uploads(id,original_play_id,play_session_id,object_key,payload_hash,payload_bytes,status,expires_at)
				VALUES(?,?,?,?,?,?,'UPLOADING',now()+interval '5 minutes')
				""",id,play,play,key,payload.hash(),payload.bytes());
			return new Attempt(id,play,key,payload.hash(),payload.bytes(),"UPLOADING",false);
		});
	}
	public PlayErrorCode accept(long user,UUID play,UUID id) {
		return tx.execute(status -> {
			limits(); users.active(user); var session=sessions.own(play,user,true);
			Attempt a=attempt(id,true);
			if(a==null) return PlayErrorCode.PLAY_STATE_CHANGED;
			if(!play.equals(a.livePlay()) || !a.status().equals("UPLOADING") || a.expired()) {
				if(a.status().equals("ACCEPTED") && play.equals(a.livePlay()) && a.key().equals(session.rawKey())) return null;
				retire(a); return PlayErrorCode.PLAY_STATE_CHANGED;
			}
			var winner=accepted(play);
			if(winner!=null) {
				retire(a);
				return winner.hash().equals(a.hash()) && winner.bytes()==a.bytes() ? null : PlayErrorCode.PLAY_RAW_PAYLOAD_CONFLICT;
			}
			db.update("UPDATE play_sessions SET raw_log_key=?,raw_log_status='UPLOADED' WHERE id=?",a.key(),play);
			db.update("UPDATE play_raw_uploads SET status='ACCEPTED',updated_at=clock_timestamp() WHERE id=? AND status='UPLOADING'",id);
			return null;
		});
	}
	/** 커밋 응답이 유실되어도 ACCEPTED 객체는 지우지 않는다. */
	public void settle(UUID id) {
		tx.executeWithoutResult(status -> { limits(); var a=attempt(id,true); if(a!=null && !a.status().equals("ACCEPTED")) retire(a); });
	}
	public boolean isAccepted(UUID id) { var a=attempt(id,false); return a!=null && a.status().equals("ACCEPTED") && a.livePlay()!=null; }
	public int recover() {
		List<UUID> candidates=db.queryForList("""
			SELECT id FROM play_raw_uploads WHERE (status='UPLOADING' AND expires_at<=now())
			OR (play_session_id IS NULL AND status<>'RETIRED') ORDER BY expires_at,id LIMIT 100
			""",UUID.class);
		int retired=0;
		for(UUID id:candidates) {
			Boolean changed=tx.execute(status -> {
				limits(); var a=attempt(id,true);
				if(a!=null && !a.status().equals("RETIRED") && (a.livePlay()==null || a.status().equals("UPLOADING") && a.expired())) { retire(a); return true; }
				return false;
			});
			if(Boolean.TRUE.equals(changed)) retired++;
		}
		return retired;
	}
	private Attempt attempt(UUID id,boolean lock) {
		return db.query("SELECT id,play_session_id,object_key,payload_hash,payload_bytes,status,expires_at<=now() FROM play_raw_uploads WHERE id=?"+(lock?" FOR UPDATE":""),
				(r,n)->new Attempt(r.getObject(1,UUID.class),r.getObject(2,UUID.class),r.getString(3),r.getString(4),r.getLong(5),r.getString(6),r.getBoolean(7)),id).stream().findFirst().orElse(null);
	}
	private Attempt accepted(UUID play) {
		return db.query("SELECT id FROM play_raw_uploads WHERE play_session_id=? AND status='ACCEPTED'",(r,n)->r.getObject(1,UUID.class),play)
				.stream().findFirst().map(id->attempt(id,false)).orElse(null);
	}
	private void retire(Attempt a) {
		if(a.status().equals("ACCEPTED") && a.livePlay()!=null) return;
		db.update("UPDATE play_raw_uploads SET status='RETIRED',retired_at=coalesce(retired_at,clock_timestamp()),updated_at=clock_timestamp() WHERE id=?",a.id());
		db.update("""
			INSERT INTO file_cleanup_tasks(object_key,file_role) VALUES(?,'RAW_LOG')
			ON CONFLICT(object_key) DO UPDATE SET status='PENDING',deleted_at=NULL,retry_count=0,
			next_attempt_at=clock_timestamp(),last_error=NULL,
			updated_at=GREATEST(clock_timestamp(),file_cleanup_tasks.updated_at+interval '1 microsecond')
			WHERE file_cleanup_tasks.file_role='RAW_LOG'
			""",a.key());
	}
	private static void same(Attempt a,PlayRawValidator.Validated payload) {
		if(!a.hash().equals(payload.hash()) || a.bytes()!=payload.bytes()) throw new BusinessException(PlayErrorCode.PLAY_RAW_PAYLOAD_CONFLICT);
	}
	private void limits() { db.execute("SET LOCAL lock_timeout='3s'"); db.execute("SET LOCAL statement_timeout='10s'"); }
}
