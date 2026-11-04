package com.ssafy.airdrum.telemetry;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.UUID;
import javax.sql.DataSource;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** V17: 패드 3컬럼 varchar(16), clock_offset_ms double precision. 격리 스키마에서 기존 행 보존을 확인한다. */
@SpringBootTest
class TelemetrySchemaMigrationTest {

	@Autowired
	DataSource source;
	String schema;

	@AfterEach
	void drop() throws Exception {
		if (schema == null) return;
		try (var c = source.getConnection(); var s = c.createStatement()) {
			s.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
		}
	}

	@Test
	void v17WidensPadAndClockOffsetWithoutLosingRows() throws Exception {
		schema = "tm_" + UUID.randomUUID().toString().replace("-", "");
		assertThat(flyway("16").migrate().migrationsExecuted).isEqualTo(15);
		try (var c = connect()) {
			c.createStatement().execute("""
					INSERT INTO telemetry_events(time,session_id,user_id,kind,stick_id,pad,velocity,t_recv,t_judge,clock_offset_ms,tags)
					VALUES ('2026-10-28T01:00:00Z','00000000-0000-0000-0000-000000000001',1,'HIT',0,'SNARE',96,10.5,10.9,1.5,'{"source":"keyboard"}')
					""");
		}

		var latest = flyway("17");
		assertThat(latest.migrate().migrationsExecuted).isEqualTo(1);
		latest.validate();
		assertThat(latest.migrate().migrationsExecuted).isZero();

		try (var c = connect()) {
			assertThat(scalar(c, "SELECT pad||':'||clock_offset_ms||':'||(tags->>'source') FROM telemetry_events")).isEqualTo("SNARE:1.5:keyboard");
			for (var column : new String[] {"pad", "baseline_pad", "predicted_pad"}) {
				assertThat(scalar(c, "SELECT character_maximum_length FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='telemetry_events' AND column_name='" + column + "'"))
						.isEqualTo("16");
			}
			assertThat(scalar(c, "SELECT data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='telemetry_events' AND column_name='clock_offset_ms'"))
					.isEqualTo("double precision");

			c.createStatement().execute("""
					INSERT INTO telemetry_events(time,session_id,user_id,kind,pad,baseline_pad,predicted_pad,clock_offset_ms)
					VALUES ('2026-10-28T01:00:01Z','00000000-0000-0000-0000-000000000001',1,'HIT','HIHAT_PEDAL','HIHAT_PEDAL','HIHAT_PEDAL',1234567.891)
					""");
			// float4였다면 1234567.875로 잘린다.
			assertThat(scalar(c, "SELECT clock_offset_ms FROM telemetry_events WHERE pad='HIHAT_PEDAL'")).isEqualTo("1234567.891");
			assertThatThrownBy(() -> c.createStatement().execute("""
					INSERT INTO telemetry_events(time,session_id,kind,clock_offset_ms)
					VALUES ('2026-10-28T01:00:02Z','00000000-0000-0000-0000-000000000001','STATUS','Infinity')
					""")).isInstanceOf(SQLException.class).hasMessageContaining("ck_telemetry_events_clock_offset_ms");
		}
	}

	Flyway flyway(String target) {
		return Flyway.configure().dataSource(source).schemas(schema).defaultSchema(schema)
				.locations("classpath:db/test-migration").target(target).load();
	}

	Connection connect() throws SQLException {
		var c = source.getConnection();
		c.setSchema(schema);
		return c;
	}

	static String scalar(Connection c, String sql) throws SQLException {
		try (var s = c.createStatement(); var r = s.executeQuery(sql)) {
			r.next();
			return r.getString(1);
		}
	}

}
