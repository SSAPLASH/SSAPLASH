package com.ssafy.airdrum.recording;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.ssafy.airdrum.recording.RecordingResponses.RecordingSong;
import com.ssafy.airdrum.recording.RecordingResponses.RecordingSummary;

/** recordings SQL. 권한 판단은 user_id 조건으로만 한다(남의 녹음은 없는 것과 같다). */
@Repository
class RecordingRepository {
	/**
	 * 요약 컬럼. 곡 정보는 녹음이 기억한 채보 버전(V28)에서 읽어 플레이가 지워져도 남는다. 곡은 소프트 삭제라 지워도 제목이 보인다.
	 * songs·charts에도 title·deleted_at·created_at이 있으므로 조건·정렬은 항상 r. 을 붙인다.
	 */
	private static final String COLUMNS = """
			SELECT r.id,r.client_key,r.title,r.mode,r.input_source,r.play_session_id,r.hit_count,r.duration_ms,r.started_at,r.created_at,
			  r.updated_at,r.payload_hash,c.song_id,s.title,c.difficulty
			""";
	private static final String FROM = """
			 FROM recordings r
			LEFT JOIN chart_versions v ON v.id=r.chart_version_id
			LEFT JOIN charts c ON c.id=v.chart_id
			LEFT JOIN songs s ON s.id=c.song_id
			""";

	record Row(RecordingSummary summary, String hash) {
	}

	/** 상세용 행. 채보 버전이 없으면 songId·chartVersionId·timingJson은 null. */
	record DetailRow(RecordingSummary summary, String hitsJson, Long songId, Long chartVersionId, String timingJson) {
	}

	/** 연결할 수 있는 플레이. 자유·박자 플레이는 채보 버전이 없어 null이다. */
	record PlayLink(Long chartVersionId) {
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
		return db.query(COLUMNS + FROM + " WHERE r.user_id=? AND r.client_key=? AND r.deleted_at IS NULL", this::row, user, clientKey).stream().findFirst();
	}

	/**
	 * 본인 플레이이고 아직 어떤 녹음(지운 녹음 포함)과도 연결되지 않았을 때 그 플레이의 채보 버전을 돌려준다.
	 * play_session_id는 전체에서 유일하다.
	 */
	Optional<PlayLink> linkablePlay(long user, UUID play) {
		return db.query("SELECT p.chart_version_id FROM play_sessions p WHERE p.id=? AND p.user_id=? "
				+ "AND NOT EXISTS (SELECT 1 FROM recordings r WHERE r.play_session_id=p.id) FOR SHARE OF p",
				(r, n) -> new PlayLink(r.getObject(1, Long.class)), play, user).stream().findFirst();
	}

	long liveCount(long user) {
		return db.queryForObject("SELECT count(*) FROM recordings WHERE user_id=? AND deleted_at IS NULL", Long.class, user);
	}

	long insert(long user, RecordingRequest r, Long chartVersionId, String hitsJson, String hash) {
		return db.queryForObject("""
				INSERT INTO recordings(user_id,client_key,title,mode,input_source,play_session_id,chart_version_id,schema_version,started_at,
				  duration_ms,hit_count,hits,payload_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?::jsonb,?) RETURNING id
				""", Long.class, user, r.clientKey(), r.title(), r.mode().name(), r.inputSource().name(), r.playId(), chartVersionId,
				r.schemaVersion(), Timestamp.from(r.startedAt()), r.durationMs(), r.hits().size(), hitsJson, hash);
	}

	private static final String LIST_FILTER = " WHERE r.user_id=? AND r.deleted_at IS NULL AND r.title ILIKE ? ESCAPE '!' AND (?::text IS NULL OR r.mode=?)";

	/**
	 * 본인의 살아 있는 녹음을 제목 패턴(이미 escape된 ILIKE, escape 문자 !)과 모드(null이면 전체)로 거른다.
	 * 정렬은 녹음 시작 시각, 같으면 id(같은 방향). 정렬 방향은 사용자 입력이 아니라 boolean으로만 정한다.
	 */
	List<RecordingSummary> page(long user, String pattern, String mode, boolean newest, int size, long offset) {
		String order = newest ? " ORDER BY r.started_at DESC, r.id DESC" : " ORDER BY r.started_at ASC, r.id ASC";
		return db.query(COLUMNS + FROM + LIST_FILTER + order + " LIMIT ? OFFSET ?",
				(r, n) -> row(r, n).summary(), user, pattern, mode, mode, size, offset);
	}

	long count(long user, String pattern, String mode) {
		return db.queryForObject("SELECT count(*) FROM recordings r" + LIST_FILTER, Long.class, user, pattern, mode, mode);
	}

	/** 시퀀스와, 녹음이 기억한 채보 버전의 timing을 함께 읽는다. 곡의 현재 BPM은 쓰지 않는다. */
	Optional<DetailRow> findDetail(long user, long id) {
		return db.query(COLUMNS + ",r.hits::text,v.id,v.timing::text" + FROM + " WHERE r.id=? AND r.user_id=? AND r.deleted_at IS NULL",
				(r, n) -> new DetailRow(row(r, n).summary(), r.getString(16), r.getObject(13, Long.class), r.getObject(17, Long.class),
						r.getString(18)), id, user).stream().findFirst();
	}

	/** 본인의 살아 있는 녹음을 잠근다. 없거나 남의 것·지운 것이면 false. */
	boolean lockOwn(long user, long id) {
		return !db.queryForList("SELECT id FROM recordings WHERE id=? AND user_id=? AND deleted_at IS NULL FOR UPDATE", Long.class, id, user).isEmpty();
	}

	void rename(long id, String title) {
		db.update("UPDATE recordings SET title=?,updated_at=clock_timestamp() WHERE id=?", title, id);
	}

	/**
	 * 소프트 삭제. 플레이 연결도 비운다: play_session_id는 지운 녹음까지 전체에서 유일해서, 비우지 않으면 지운 녹음이
	 * 플레이를 붙들어 같은 플레이의 새 녹음이 404가 된다(256 검증 D6).
	 */
	void softDelete(long id) {
		db.update("UPDATE recordings SET deleted_at=clock_timestamp(),updated_at=clock_timestamp(),play_session_id=NULL WHERE id=?", id);
	}

	Optional<Row> find(long user, long id) {
		return db.query(COLUMNS + FROM + " WHERE r.id=? AND r.user_id=? AND r.deleted_at IS NULL", this::row, id, user).stream().findFirst();
	}

	private Row row(ResultSet r, int n) throws SQLException {
		Long songId = r.getObject(13, Long.class);
		var song = songId == null ? null : new RecordingSong(songId, r.getString(14), r.getString(15));
		return new Row(new RecordingSummary(r.getLong(1), r.getObject(2, UUID.class), r.getString(3), r.getString(4), r.getString(5),
				r.getObject(6, UUID.class), song, r.getInt(7), r.getInt(8), r.getTimestamp(9).toInstant(), r.getTimestamp(10).toInstant(),
				r.getTimestamp(11).toInstant()), r.getString(12));
	}
}
