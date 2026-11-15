package com.ssafy.airdrum.domain.play.repository.session;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import com.ssafy.airdrum.domain.play.dto.BestRecordsResponse;
import com.ssafy.airdrum.domain.play.dto.PlaySummaryResponse;
import com.ssafy.airdrum.domain.play.dto.PlayUploadRequest;
import com.ssafy.airdrum.domain.play.exception.PlayErrorCode;
import com.ssafy.airdrum.domain.play.model.PlayJson;
import com.ssafy.airdrum.domain.play.model.PlayListFilters;
import com.ssafy.airdrum.global.error.BusinessException;

@Repository
public class PlaySessionRepository {
	private final JdbcTemplate db;
	private final NamedParameterJdbcTemplate named;
	private final PlayJson json;
	public PlaySessionRepository(JdbcTemplate db, PlayJson json) { this.db = db; this.named = new NamedParameterJdbcTemplate(db); this.json = json; }
    private static final String LIST_FROM = """
        FROM play_sessions p LEFT JOIN songs s ON s.id=p.song_id AND
        """ + com.ssafy.airdrum.domain.song.repository.SongRepository.VISIBLE;
    private String conditions(PlayListFilters filters) {
        return (filters.pattern() == null ? "" : " AND s.title ILIKE :pattern ESCAPE '!' ")
            + (filters.from() == null ? "" : " AND p.ended_at >= :from ")
            + (filters.until() == null ? "" : " AND p.ended_at < :until ")
            + (filters.mode() == null ? "" : " AND p.mode = :mode ");
    }
    private MapSqlParameterSource listArgs(long userId, PlayListFilters filters) {
        var args = new MapSqlParameterSource().addValue("userId", userId);
        if (filters.pattern() != null) args.addValue("pattern", filters.pattern());
        if (filters.from() != null) args.addValue("from", Timestamp.from(filters.from()));
        if (filters.until() != null) args.addValue("until", Timestamp.from(filters.until()));
        if (filters.mode() != null) args.addValue("mode", filters.mode());
        return args;
    }
    public long countForUser(long userId, PlayListFilters filters) {
        return named.queryForObject("SELECT count(*) " + LIST_FROM + " WHERE p.user_id=:userId " + conditions(filters), listArgs(userId, filters), Long.class);
    }
    public List<PlaySummaryResponse> pageForUser(long userId, int size, long offset, PlayListFilters filters) {
        var args = listArgs(userId, filters).addValue("size", size).addValue("offset", offset);
        String direction = filters.sort().equals("OLDEST") ? "ASC" : "DESC";
        return named.query("""
            SELECT p.id,p.started_at,p.ended_at,p.mode,p.input_source,p.song_id,s.title,p.chart_version_id,
                   c.id AS chart_id,c.difficulty,p.client_meta->>'endReason' AS end_reason,(s.id IS NOT NULL) AS accessible,p.score,p.accuracy,p.max_combo,
                   (p.mode IN ('RHYTHM','SHEET') AND r.id IS NOT NULL) AS has_report,
                   COALESCE((p.judgement_context->>'playbackRate')::numeric, 1) AS playback_rate
            """ + LIST_FROM + """
            LEFT JOIN chart_versions v ON v.id=p.chart_version_id
            LEFT JOIN charts c ON c.id=v.chart_id AND c.song_id=p.song_id
            LEFT JOIN reports r ON r.play_session_id=p.id
            WHERE p.user_id=:userId
            """ + conditions(filters) + " ORDER BY p.ended_at " + direction + ",p.id " + direction + " LIMIT :size OFFSET :offset",
            args, (r,n) -> new PlaySummaryResponse(r.getObject("id", UUID.class),
                r.getTimestamp("started_at").toInstant(),r.getTimestamp("ended_at").toInstant(),
                r.getString("mode"),r.getString("input_source"),r.getObject("song_id", Long.class),
                r.getString("title"),r.getObject("chart_version_id", Long.class),r.getObject("chart_id", Long.class),r.getString("difficulty"),r.getString("end_reason"),
                r.getBoolean("accessible"),r.getObject("score", Integer.class),r.getBigDecimal("accuracy"),
                r.getObject("max_combo", Integer.class),r.getBoolean("has_report"),r.getDouble("playback_rate")));
    }
	public List<BestRecordsResponse.Item> bestForUser(long userId, List<Long> songIds) {
		var args = new MapSqlParameterSource().addValue("userId", userId).addValue("songIds", songIds);
		return named.query("""
			SELECT p.song_id,c.id AS chart_id,c.difficulty,p.mode,MAX(p.score) AS best_score,MAX(p.accuracy) AS best_accuracy
			FROM play_sessions p
			JOIN songs s ON s.id=p.song_id AND
			""" + com.ssafy.airdrum.domain.song.repository.SongRepository.VISIBLE + """
			JOIN chart_versions v ON v.id=p.chart_version_id
			JOIN charts c ON c.id=v.chart_id AND c.song_id=p.song_id
			WHERE p.user_id=:userId AND p.song_id IN (:songIds) AND p.mode IN ('RHYTHM','SHEET')
			  AND p.client_meta->>'endReason'='COMPLETED'
			  AND COALESCE((p.judgement_context->>'playbackRate')::numeric, 1) = 1
			GROUP BY p.song_id,c.id,c.difficulty,p.mode ORDER BY p.song_id,c.id,p.mode
			""", args, (r,n) -> new BestRecordsResponse.Item(r.getLong("song_id"),r.getLong("chart_id"),
				r.getString("difficulty"),r.getString("mode"),r.getObject("best_score", Integer.class),r.getBigDecimal("best_accuracy")));
	}
	public record Session(UUID id, long userId, String hash, String rawStatus, String rawKey, String inputSource) {}
	public record ChartData(String notes, int noteCount, int schemaVersion, String versionToken, String chartToken) {}
	public Optional<Session> find(UUID id, boolean lock) {
		return db.query("SELECT id,user_id,payload_hash,raw_log_status,raw_log_key,input_source FROM play_sessions WHERE id=?" + (lock ? " FOR UPDATE" : ""),
				(r,n) -> new Session(r.getObject(1, UUID.class), r.getLong(2), r.getString(3), r.getString(4), r.getString(5), r.getString(6)), id).stream().findFirst();
	}
	public Session own(UUID id, long user, boolean lock) {
		var row = find(id, lock).orElseThrow(() -> new BusinessException(PlayErrorCode.PLAY_NOT_FOUND));
		if (row.userId() != user) throw new BusinessException(PlayErrorCode.PLAY_NOT_FOUND);
		return row;
	}
	public ChartData chart(long user, long song, long version) {
		return db.query("""
			SELECT v.notes::text,v.note_count,v.schema_version,v.xmin::text,c.xmin::text
			FROM chart_versions v JOIN charts c ON c.id=v.chart_id JOIN songs s ON s.id=c.song_id
			WHERE v.id=? AND s.id=? AND s.deleted_at IS NULL AND s.status='READY' AND (s.owner_id IS NULL OR s.owner_id=?)
			""", (r,n) -> new ChartData(r.getString(1), r.getInt(2), r.getInt(3), r.getString(4), r.getString(5)), version, song, user)
				.stream().findFirst().orElseThrow(() -> new BusinessException(PlayErrorCode.PLAY_NOT_FOUND));
	}
	public void checkReferences(long user, PlayUploadRequest p, ChartData checked) {
		if (p.scored()) {
			var songs = db.queryForList("SELECT id FROM songs WHERE id=? AND deleted_at IS NULL AND status='READY' AND (owner_id IS NULL OR owner_id=?) FOR SHARE", Long.class, p.songId(), user);
			if (songs.isEmpty()) throw new BusinessException(PlayErrorCode.PLAY_NOT_FOUND);
			// 버전은 UPDATE 금지 제약이 없으므로 JSON 대신 MVCC 토큰만 잠금 안에서 재검사한다.
			var tokens = db.query("SELECT v.xmin::text,c.xmin::text FROM chart_versions v JOIN charts c ON c.id=v.chart_id WHERE v.id=? AND c.song_id=? FOR SHARE OF c,v",
					(r,n) -> List.of(r.getString(1), r.getString(2)), p.chartVersionId(), p.songId());
			if (tokens.isEmpty()) throw new BusinessException(PlayErrorCode.PLAY_NOT_FOUND);
			if (!tokens.getFirst().equals(List.of(checked.versionToken(), checked.chartToken()))) throw new BusinessException(PlayErrorCode.PLAY_STATE_CHANGED);
		}
		if (p.kitPresetId() != null && db.queryForList("SELECT id FROM kit_presets WHERE id=? AND user_id=? FOR SHARE", Long.class, p.kitPresetId(), user).isEmpty())
			throw new BusinessException(PlayErrorCode.PLAY_NOT_FOUND);
	}
	public boolean insert(long user, PlayUploadRequest p, String hash) {
		var s = p.summary();
		var args = new MapSqlParameterSource().addValue("id", p.playId()).addValue("user", user)
				.addValue("song", p.songId()).addValue("version", p.chartVersionId()).addValue("mode", p.mode().name())
				.addValue("source", p.inputSource().name()).addValue("preset", p.kitPresetId())
				.addValue("snapshot", json.write(p.kitPresetSnapshot())).addValue("calibration", json.write(p.calibration()))
				.addValue("score", s == null ? null : s.score()).addValue("accuracy", s == null ? null : s.accuracy())
				.addValue("combo", s == null ? null : s.maxCombo()).addValue("counts", s == null ? null : json.write(s.judgementCounts()))
				.addValue("context", json.write(p.judgementContext())).addValue("coach", json.write(p.liveCoachEvents()))
				.addValue("consent", p.consent()).addValue("meta", json.write(p.clientMeta())).addValue("schema", p.schemaVersion())
				.addValue("hash", hash).addValue("started", Timestamp.from(p.startedAt())).addValue("ended", Timestamp.from(p.endedAt()));
		return named.update("""
			INSERT INTO play_sessions(id,user_id,song_id,chart_version_id,mode,input_source,kit_preset_id,
			kit_preset_snapshot,calibration,score,accuracy,max_combo,judgement_counts,judgement_context,
			live_coach_events,consent,client_meta,payload_schema_version,payload_hash,started_at,ended_at)
			VALUES(:id,:user,:song,:version,:mode,:source,:preset,CAST(:snapshot AS jsonb),CAST(:calibration AS jsonb),
			:score,:accuracy,:combo,CAST(:counts AS jsonb),CAST(:context AS jsonb),CAST(:coach AS jsonb),:consent,
			CAST(:meta AS jsonb),:schema,:hash,:started,:ended) ON CONFLICT (id) DO NOTHING
			""", args) == 1;
	}
	public record SensorHit(int stickId,double tMs) {}
	public record RawSnapshot(String hash,Map<Integer,SensorHit> hits) {
		public RawSnapshot { hits=Map.copyOf(hits); }
	}
	public RawSnapshot rawSnapshot(UUID play,long user) {
		// 하나의 MVCC 스냅샷에서 읽어 세션 삭제·재생성 사이의 다른 hits를 조합하지 않는다.
		return db.query("""
			SELECT s.payload_hash,h.seq,h.stick_id,h.t_ms
			FROM play_sessions s LEFT JOIN hits h ON h.play_session_id=s.id AND h.stick_id IS NOT NULL
			WHERE s.id=? AND s.user_id=?
			""", r -> {
			if(!r.next()) throw new BusinessException(PlayErrorCode.PLAY_NOT_FOUND);
			String hash=r.getString(1);
			var hits=new java.util.HashMap<Integer,SensorHit>();
			do {
				Integer seq=r.getObject(2,Integer.class);
				if(seq!=null) hits.put(seq,new SensorHit(r.getInt(3),r.getDouble(4)));
			} while(r.next());
			return new RawSnapshot(hash,hits);
		},play,user);
	}
}
