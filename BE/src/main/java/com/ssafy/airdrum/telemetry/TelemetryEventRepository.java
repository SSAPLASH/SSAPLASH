package com.ssafy.airdrum.telemetry;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.telemetry.TelemetryBatchRequest.Conditions;
import com.ssafy.airdrum.telemetry.TelemetryBatchRequest.Firmware;
import com.ssafy.airdrum.telemetry.TelemetryBatchRequest.Kind;
import com.ssafy.airdrum.telemetry.TelemetryBatchRequest.SensorMount;
import com.ssafy.airdrum.telemetry.TelemetryResponses.EventItem;
import com.ssafy.airdrum.telemetry.TelemetryResponses.SessionSummary;

/** {@code telemetry_events}(hypertable)는 엔티티 없이 SQL로만 다룬다. 트랜잭션 경계는 서비스가 정한다. */
@Repository
public class TelemetryEventRepository {

	private final JdbcTemplate db;
	private final JsonMapper json;

	public TelemetryEventRepository(JdbcTemplate db, JsonMapper json) {
		this.db = db;
		this.json = json;
	}

	/** 검증된 배치를 한 번에 넣는다. 회원 ID는 인증 주체이며 본문 값을 쓰지 않는다. */
	public void insert(long userId, TelemetryBatchRequest batch) {
		var mode = batch.mode() == null ? null : batch.mode().name();
		db.batchUpdate("""
				INSERT INTO telemetry_events(time,session_id,user_id,mode,kind,stick_id,pad,baseline_pad,predicted_pad,
					judgement,delta_ms,velocity,t_sensor,t_recv,t_judge,t_audio,clock_offset_ms,packet_loss,battery_pct,tags)
				VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb)
				""", batch.events(), batch.events().size(), (s, e) -> {
			s.setObject(1, e.time().atOffset(ZoneOffset.UTC));
			s.setObject(2, batch.sessionId());
			s.setLong(3, userId);
			s.setString(4, mode);
			s.setString(5, e.kind().name());
			s.setObject(6, e.stickId(), java.sql.Types.SMALLINT);
			s.setString(7, name(e.pad()));
			s.setString(8, name(e.baselinePad()));
			s.setString(9, name(e.predictedPad()));
			s.setString(10, name(e.judgement()));
			s.setObject(11, e.deltaMs(), java.sql.Types.DOUBLE);
			s.setObject(12, e.velocity(), java.sql.Types.SMALLINT);
			s.setObject(13, e.tSensor(), java.sql.Types.BIGINT);
			s.setObject(14, e.tRecv(), java.sql.Types.DOUBLE);
			s.setObject(15, e.tJudge(), java.sql.Types.DOUBLE);
			s.setObject(16, e.tAudio(), java.sql.Types.DOUBLE);
			s.setObject(17, e.clockOffsetMs(), java.sql.Types.DOUBLE);
			s.setObject(18, e.packetLoss(), java.sql.Types.REAL);
			s.setObject(19, e.batteryPct(), java.sql.Types.SMALLINT);
			s.setString(20, e.tags().toString());
		});
	}

	/** 기간은 이벤트 {@code time} 기준 양끝 포함. 마지막 이벤트가 최근인 순서. 259 조건 행은 집계 뒤 LEFT JOIN으로 붙인다. */
	public List<SessionSummary> sessions(Instant from, Instant to, Long userId, int offset, int limit) {
		var where = new SessionWhere(userId);
		return db.query("""
				SELECT s.*,c.user_id IS NOT NULL AS has_conditions,c.firmware_0,c.firmware_1,c.dongle_firmware,c.link_mask,c.haptic_enable,
					c.sensor_mount,c.app_build,c.note
				FROM (SELECT user_id,session_id,(array_agg(mode ORDER BY time DESC))[1] AS mode,min(time) AS first_time,max(time) AS last_time,
						count(*) AS events,count(*) FILTER (WHERE kind='HIT') AS hits,count(*) FILTER (WHERE kind='STATUS') AS statuses
					FROM telemetry_events WHERE %s GROUP BY user_id,session_id) s
				LEFT JOIN telemetry_session_conditions c ON c.user_id=s.user_id AND c.session_id=s.session_id
				ORDER BY s.last_time DESC,s.user_id,s.session_id LIMIT ? OFFSET ?
				""".formatted(where.sql()), (r, n) -> new SessionSummary(r.getObject("user_id", Long.class),
				r.getObject("session_id", UUID.class), r.getString("mode"), r.getTimestamp("first_time").toInstant(),
				r.getTimestamp("last_time").toInstant(), r.getLong("events"), r.getLong("hits"), r.getLong("statuses"), conditions(r)),
				where.args(from, to, limit, offset));
	}

	/** 조건 행이 없으면 null. 있으면 모든 값이 null이어도 객체이며 firmware도 "0"·"1"이 null인 객체다(설계 3-3). */
	private static Conditions conditions(ResultSet r) throws SQLException {
		if (!r.getBoolean("has_conditions")) return null;
		var mount = r.getString("sensor_mount");
		return new Conditions(new Firmware(r.getString("firmware_0"), r.getString("firmware_1")), r.getString("dongle_firmware"),
				r.getObject("link_mask", Integer.class), r.getObject("haptic_enable", Boolean.class),
				mount == null ? null : SensorMount.valueOf(mount), r.getString("app_build"), r.getString("note"));
	}

	public long countSessions(Instant from, Instant to, Long userId) {
		var where = new SessionWhere(userId);
		return db.queryForObject("SELECT count(*) FROM (SELECT 1 FROM telemetry_events WHERE %s GROUP BY user_id,session_id) s"
				.formatted(where.sql()), Long.class, where.args(from, to));
	}

	/** 같은 시각은 스틱 0·1·null 순서. 테이블에 순번이 없어 offset 페이지를 쓴다(설계 U5). */
	public List<EventItem> events(long userId, UUID sessionId, Kind kind, int offset, int limit) {
		var args = new ArrayList<Object>(List.of(userId, sessionId));
		if (kind != null) args.add(kind.name());
		args.add(limit);
		args.add(offset);
		return db.query("""
				SELECT time,kind,stick_id,pad,baseline_pad,predicted_pad,judgement,delta_ms,velocity,t_sensor,t_recv,t_judge,t_audio,
					clock_offset_ms,packet_loss,battery_pct,tags::text AS tags
				FROM telemetry_events WHERE user_id=? AND session_id=? %s
				ORDER BY time,stick_id NULLS LAST LIMIT ? OFFSET ?
				""".formatted(kind == null ? "" : "AND kind=?"), (r, n) -> new EventItem(r.getTimestamp("time").toInstant(),
				r.getString("kind"), r.getObject("stick_id", Integer.class), pad(r.getString("pad")), pad(r.getString("baseline_pad")),
				pad(r.getString("predicted_pad")), r.getString("judgement"), r.getObject("delta_ms", Double.class),
				r.getObject("velocity", Integer.class), r.getObject("t_sensor", Long.class), r.getObject("t_recv", Double.class),
				r.getObject("t_judge", Double.class), r.getObject("t_audio", Double.class), r.getObject("clock_offset_ms", Double.class),
				packetLoss(r.getObject("packet_loss", Float.class)), r.getObject("battery_pct", Integer.class),
				r.getString("tags") == null ? null : json.readTree(r.getString("tags"))), args.toArray());
	}

	public long countEvents(long userId, UUID sessionId, Kind kind) {
		return kind == null
				? db.queryForObject("SELECT count(*) FROM telemetry_events WHERE user_id=? AND session_id=?", Long.class, userId, sessionId)
				: db.queryForObject("SELECT count(*) FROM telemetry_events WHERE user_id=? AND session_id=? AND kind=?", Long.class,
						userId, sessionId, kind.name());
	}

	/** packet_loss는 real이다. 0.02f를 double로 넓히면 0.019999…가 되므로 float의 10진 표현으로 옮긴다. */
	private static Double packetLoss(Float value) {
		return value == null ? null : Double.valueOf(value.toString());
	}

	/** 세션 목록·건수의 공통 조건. 회원 필터가 있을 때만 user_id 조건을 붙인다. */
	private record SessionWhere(Long userId) {

		String sql() {
			return userId == null ? "time>=? AND time<=?" : "time>=? AND time<=? AND user_id=?";
		}

		Object[] args(Instant from, Instant to, Object... rest) {
			var args = new ArrayList<Object>(List.of(from.atOffset(ZoneOffset.UTC), to.atOffset(ZoneOffset.UTC)));
			if (userId != null) args.add(userId);
			args.addAll(List.of(rest));
			return args.toArray();
		}

	}

	private static String name(Enum<?> value) {
		return value == null ? null : value.name();
	}

	private static String pad(String value) {
		return "HI_TOM".equals(value) ? "SMALL_TOM" : value;
	}

}
