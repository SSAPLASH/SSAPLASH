package com.ssafy.airdrum.recording;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.ssafy.airdrum.recording.RecordingResponses.RecordingSummary;

/** recordings SQL. 권한 판단은 user_id 조건으로만 한다(남의 녹음은 없는 것과 같다). */
@Repository
class RecordingRepository {
	private static final String COLUMNS = "SELECT id,client_key,title,mode,input_source,play_session_id,hit_count,duration_ms,started_at,created_at,updated_at,payload_hash FROM recordings";

	record Row(RecordingSummary summary, String hash) {
	}

	private final JdbcTemplate db;

	RecordingRepository(JdbcTemplate db) {
		this.db = db;
	}

	/** 플레이 로그 업로드와 같은 잠금·문장 제한. 넘기면 503으로 바꾼다. */
	void limitWaits() {
		db.execute("SET LOCAL lock_timeout = '3s'");
		db.execute("SET LOCAL statement_timeout = '10s'");
	}

	/**
	 * ACTIVE 회원 행을 잠근다. 같은 회원의 저장을 한 줄로 세워 같은 키 동시 요청·상한 계산이 겹치지 않게 하고,
	 * 탈퇴 트랜잭션(같은 행 FOR UPDATE)과도 순서를 맞춘다.
	 */
	boolean lockActiveUser(long user) {
		return !db.queryForList("SELECT id FROM users WHERE id=? AND status='ACTIVE' FOR UPDATE", Long.class, user).isEmpty();
	}

	Optional<Row> findLive(long user, UUID clientKey) {
		return db.query(COLUMNS + " WHERE user_id=? AND client_key=? AND deleted_at IS NULL", this::row, user, clientKey).stream().findFirst();
	}

	/** 본인 플레이이고 아직 어떤 녹음(지운 녹음 포함)과도 연결되지 않았을 때만 true. play_session_id는 전체에서 유일하다. */
	boolean playAvailable(long user, UUID play) {
		return !db.queryForList("SELECT p.id FROM play_sessions p WHERE p.id=? AND p.user_id=? "
				+ "AND NOT EXISTS (SELECT 1 FROM recordings r WHERE r.play_session_id=p.id) FOR SHARE OF p", UUID.class, play, user).isEmpty();
	}

	long liveCount(long user) {
		return db.queryForObject("SELECT count(*) FROM recordings WHERE user_id=? AND deleted_at IS NULL", Long.class, user);
	}

	long insert(long user, RecordingRequest r, String hitsJson, String hash) {
		return db.queryForObject("""
				INSERT INTO recordings(user_id,client_key,title,mode,input_source,play_session_id,schema_version,started_at,
				  duration_ms,hit_count,hits,payload_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?::jsonb,?) RETURNING id
				""", Long.class, user, r.clientKey(), r.title(), r.mode().name(), r.inputSource().name(), r.playId(),
				r.schemaVersion(), Timestamp.from(r.startedAt()), r.durationMs(), r.hits().size(), hitsJson, hash);
	}

	Optional<Row> find(long user, long id) {
		return db.query(COLUMNS + " WHERE id=? AND user_id=? AND deleted_at IS NULL", this::row, id, user).stream().findFirst();
	}

	private Row row(ResultSet r, int n) throws SQLException {
		return new Row(new RecordingSummary(r.getLong(1), r.getObject(2, UUID.class), r.getString(3), r.getString(4), r.getString(5),
				r.getObject(6, UUID.class), r.getInt(7), r.getInt(8), r.getTimestamp(9).toInstant(), r.getTimestamp(10).toInstant(),
				r.getTimestamp(11).toInstant()), r.getString(12));
	}
}
