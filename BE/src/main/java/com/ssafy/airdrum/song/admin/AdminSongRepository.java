package com.ssafy.airdrum.song.admin;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import com.ssafy.airdrum.chart.ChartErrorCode;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.song.midi.DifficultyThinner.Difficulty;
import com.ssafy.airdrum.song.midi.MidiChartDocuments;

/** 공용 곡(owner_id NULL, source BUILTIN) 전용 SQL. 일반 조회의 가시성 조건을 쓰지 않고 삭제 곡만 뺀다. */
@Repository
class AdminSongRepository {

	private static final String COLUMNS = """
			SELECT s.id,s.title,s.artist,s.license,s.status,s.bpm,s.time_signature,s.duration_ms,
			 s.accompaniment_key,s.cover_key,s.published,s.created_at,s.updated_at FROM songs s
			""";
	private static final String BUILTIN = " s.owner_id IS NULL AND s.source='BUILTIN' AND s.deleted_at IS NULL ";
	private static final String FILTER = BUILTIN + """
			AND (CAST(:published AS boolean) IS NULL OR s.published = :published)
			AND (LOWER(s.title) LIKE LOWER(:pattern) ESCAPE '!' OR LOWER(COALESCE(s.artist,'')) LIKE LOWER(:pattern) ESCAPE '!')
			""";

	record SongRow(long id, String title, String artist, String license, String status, BigDecimal bpm,
			String timeSignature, Integer durationMs, String accompanimentKey, String coverKey, boolean published,
			Instant createdAt, Instant updatedAt) {}
	record ChartRow(long songId, long chartId, String difficulty, long versionId, int version, int noteCount,
			String notationStatus, String generator, String generatorVersion, Instant createdAt) {}
	/** 잠근 곡의 자산 키. */
	record Locked(String accompanimentKey, String coverKey) {}

	private final JdbcTemplate db;
	private final NamedParameterJdbcTemplate named;

	AdminSongRepository(JdbcTemplate db, NamedParameterJdbcTemplate named) {
		this.db = db;
		this.named = named;
	}

	long insertSong(String title, String artist, String license, boolean published, MidiChartDocuments.Song song) {
		return db.queryForObject("""
				INSERT INTO songs(owner_id,title,artist,source,status,bpm,offset_ms,time_signature,duration_ms,license,published)
				VALUES (NULL,?,?,'BUILTIN','READY',?,?,?,?,?,?) RETURNING id
				""", Long.class, title, artist, song.bpm(), song.offsetMs(), song.timeSignature(), song.durationMs(), license, published);
	}

	/** 개인 곡·없는 곡·삭제 곡은 존재를 드러내지 않고 404다. 트랜잭션 안에서 호출한다. */
	Locked lock(long id) {
		db.execute("SET LOCAL lock_timeout='3s'");
		var rows = db.query("SELECT accompaniment_key,cover_key FROM songs s WHERE s.id=? AND" + BUILTIN + "FOR UPDATE",
				(r, n) -> new Locked(r.getString(1), r.getString(2)), id);
		if (rows.isEmpty()) throw new BusinessException(ChartErrorCode.SONG_NOT_FOUND);
		return rows.getFirst();
	}

	void update(long id, String column, Object value) {
		// column은 서비스가 고정 목록에서만 넘긴다.
		db.update("UPDATE songs SET " + column + "=?,updated_at=clock_timestamp() WHERE id=?", value, id);
	}

	/** ADMIN MIDI 재업로드는 offsetMs가 0이라 카탈로그 곡의 offset이 0으로 돌아간다(260번 설계 U4, README). */
	void updateTiming(long id, MidiChartDocuments.Song song) {
		db.update("UPDATE songs SET bpm=?,offset_ms=?,time_signature=?,duration_ms=?,updated_at=clock_timestamp() WHERE id=?",
				song.bpm(), song.offsetMs(), song.timeSignature(), song.durationMs(), id);
	}

	void updateKey(long id, String column, String key) {
		db.update("UPDATE songs SET " + column + "=?,updated_at=clock_timestamp() WHERE id=?", key, id);
	}

	/** 저장소 쓰기 전에 임시 정리 작업을 등록한다. 연결에 실패하면 5분 뒤 정리 큐가 객체를 치운다(187번 커버와 같은 방식). */
	void registerTemporary(String key, String role) {
		db.update("INSERT INTO file_cleanup_tasks(object_key,file_role,next_attempt_at) VALUES(?,?,clock_timestamp()+interval '5 minutes')", key, role);
	}

	/** 임시 정리 작업이 아직 실행 전이면 잠그고 true. 이미 정리가 시작됐으면 연결하지 않는다. */
	boolean temporaryAlive(String key, String role) {
		return !db.queryForList("SELECT id FROM file_cleanup_tasks WHERE object_key=? AND file_role=? AND status='PENDING' AND next_attempt_at>clock_timestamp() FOR UPDATE",
				Long.class, key, role).isEmpty();
	}

	void softDelete(long id) {
		db.update("UPDATE songs SET deleted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=?", id);
	}

	/** 난이도의 채보 행을 잠그고 다음 버전 번호를 돌려준다. 행이 없으면 null. */
	Map.Entry<Long, Integer> nextVersion(long songId, Difficulty difficulty) {
		var charts = db.queryForList("SELECT id FROM charts WHERE song_id=? AND difficulty=? FOR UPDATE", Long.class,
				songId, difficulty.name());
		if (charts.isEmpty()) return null;
		long chartId = charts.getFirst();
		int next = db.queryForObject("SELECT coalesce(max(version),0)+1 FROM chart_versions WHERE chart_id=?", Integer.class, chartId);
		db.update("UPDATE charts SET updated_at=clock_timestamp() WHERE id=?", chartId);
		return Map.entry(chartId, next);
	}

	Optional<SongRow> find(long id) {
		return db.query(COLUMNS + " WHERE s.id=? AND" + BUILTIN, this::song, id).stream().findFirst();
	}

	List<SongRow> page(Boolean published, String pattern, int size, long offset) {
		return named.query(COLUMNS + " WHERE " + FILTER + " ORDER BY s.created_at DESC, s.id DESC LIMIT :size OFFSET :offset",
				filter(published, pattern).addValue("size", size).addValue("offset", offset), this::song);
	}

	long count(Boolean published, String pattern) {
		return named.queryForObject("SELECT count(*) FROM songs s WHERE " + FILTER,
				filter(published, pattern), Long.class);
	}

	private static MapSqlParameterSource filter(Boolean published, String pattern) {
		return new MapSqlParameterSource().addValue("published", published, Types.BOOLEAN).addValue("pattern", pattern);
	}

	List<ChartRow> latestCharts(Collection<Long> songIds) {
		if (songIds.isEmpty()) return List.of();
		return named.query("""
				SELECT c.song_id,c.id,c.difficulty,v.id,v.version,v.note_count,v.notation_status,v.generator,v.generator_version,v.created_at
				FROM charts c JOIN chart_versions v ON v.chart_id=c.id
				WHERE c.song_id IN (:ids) AND v.version=(SELECT max(v2.version) FROM chart_versions v2 WHERE v2.chart_id=c.id)
				ORDER BY c.song_id, CASE c.difficulty WHEN 'EASY' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END
				""", Map.of("ids", songIds), (r, n) -> new ChartRow(r.getLong(1), r.getLong(2), r.getString(3), r.getLong(4),
				r.getInt(5), r.getInt(6), r.getString(7), r.getString(8), r.getString(9), r.getTimestamp(10).toInstant()));
	}

	private SongRow song(ResultSet r, int n) throws SQLException {
		return new SongRow(r.getLong(1), r.getString(2), r.getString(3), r.getString(4), r.getString(5), r.getBigDecimal(6),
				r.getString(7), r.getObject(8, Integer.class), r.getString(9), r.getString(10), r.getBoolean(11),
				r.getTimestamp(12).toInstant(), r.getTimestamp(13).toInstant());
	}

}
