package com.ssafy.airdrum.telemetry;

import java.sql.Types;
import java.time.Clock;
import java.time.ZoneOffset;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.ssafy.airdrum.telemetry.TelemetryBatchRequest.Conditions;

/**
 * 259 측정 세션 실험 조건 {@code telemetry_session_conditions}. {@code (user_id, session_id)}당 한 행이며 SQL로만 다룬다.
 * 조회는 세션 목록 쿼리({@link TelemetryEventRepository#sessions})가 JOIN으로 읽고, 탈퇴 삭제는 {@code withdrawal}이 SQL로 한다.
 * 트랜잭션 경계는 {@link TelemetryBatchService}가 정한다.
 */
@Repository
public class TelemetrySessionConditionsRepository {

	private final JdbcTemplate db;
	private final Clock clock;

	public TelemetrySessionConditionsRepository(JdbcTemplate db, Clock clock) {
		this.db = db;
		this.clock = clock;
	}

	/** 행이 없으면 만들고 있으면 모든 값 열을 이번 값으로 바꾼다(설계 U2: 행 전체 교체). {@code received_at}은 서버 시각이다. */
	public void upsert(long userId, UUID sessionId, Conditions c) {
		var firmware = c.firmware();
		db.update("""
				INSERT INTO telemetry_session_conditions(user_id,session_id,firmware_0,firmware_1,dongle_firmware,link_mask,haptic_enable,
					sensor_mount,app_build,note,received_at)
				VALUES (?,?,?,?,?,?,?,?,?,?,?)
				ON CONFLICT (user_id,session_id) DO UPDATE SET firmware_0=EXCLUDED.firmware_0,firmware_1=EXCLUDED.firmware_1,
					dongle_firmware=EXCLUDED.dongle_firmware,link_mask=EXCLUDED.link_mask,haptic_enable=EXCLUDED.haptic_enable,
					sensor_mount=EXCLUDED.sensor_mount,app_build=EXCLUDED.app_build,note=EXCLUDED.note,received_at=EXCLUDED.received_at
				""", s -> {
			s.setLong(1, userId);
			s.setObject(2, sessionId);
			s.setString(3, firmware == null ? null : firmware.stick0());
			s.setString(4, firmware == null ? null : firmware.stick1());
			s.setString(5, c.dongleFirmware());
			s.setObject(6, c.linkMask(), Types.SMALLINT);
			s.setObject(7, c.hapticEnable(), Types.BOOLEAN);
			s.setString(8, c.sensorMount() == null ? null : c.sensorMount().name());
			s.setString(9, c.appBuild());
			s.setString(10, c.note());
			s.setObject(11, clock.instant().atOffset(ZoneOffset.UTC));
		});
	}

}
