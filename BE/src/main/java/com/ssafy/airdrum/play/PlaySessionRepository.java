package com.ssafy.airdrum.play;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import com.ssafy.airdrum.common.error.BusinessException;

@Repository
public class PlaySessionRepository {
	private final JdbcTemplate db;
	private final NamedParameterJdbcTemplate named;
	private final PlayJson json;
	public PlaySessionRepository(JdbcTemplate db, PlayJson json) { this.db = db; this.named = new NamedParameterJdbcTemplate(db); this.json = json; }
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
