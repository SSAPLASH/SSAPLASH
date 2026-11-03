package com.ssafy.airdrum.db;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 전용 스크립트가 만든 일회용 DB에서 실행한다. Spring 임베디드 DB 초기화기를 사용하지 않는다. */
class TimescaleMigrationTest {

	@Test
	void upgradesPopulatedV7AndPreservesDataIndexesChecksAndHistory() throws Exception {
		var v7 = flyway("7");
		assertThat(v7.migrate().migrationsExecuted).isEqualTo(7);
		try (var connection = connect()) {
			execute(connection, """
					INSERT INTO users(nickname) VALUES ('전환 전 회원');
					INSERT INTO telemetry_events(time,session_id,user_id,kind,t_recv,tags)
					VALUES ('2026-10-01T12:00:00Z','00000000-0000-0000-0000-000000000001',1,'HIT',12.5,'{"origin":"v7"}'),
					       ('2026-10-03T12:00:00Z','00000000-0000-0000-0000-000000000001',1,'STATUS',20.25,'{}');
					""");
			var throughV9 = flyway("9");
			assertThat(throughV9.migrate().migrationsExecuted).isEqualTo(2);
			execute(connection, """
					INSERT INTO play_raw_uploads(id,original_play_id,object_key,payload_hash,payload_bytes,status,expires_at)
					VALUES('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000011',
					       'play-raw/legacy.log','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',123,'UPLOADING',now()+interval '1 day')
					""");
			String existingSong = scalar(connection, "INSERT INTO songs(title,source,status,bpm,offset_ms,time_signature,duration_ms,license) VALUES ('기본 8비트','BUILTIN','READY',77,11,'3/4',1234,'기존 권리 메타') RETURNING id");
			String existingChart = scalar(connection, "INSERT INTO charts(song_id,difficulty) VALUES (" + existingSong + ",'EASY') RETURNING id");
			String existingVersion = scalar(connection, "INSERT INTO chart_versions(chart_id,version,notes,timing,notation_status,note_count,generator,generator_version) VALUES (" + existingChart + ",1,'[{\"noteId\":\"legacy-1\",\"timeMs\":77,\"pad\":\"SNARE\",\"velocityHint\":88}]'::jsonb,'{\"bpm\":77,\"offsetMs\":11,\"timeSignature\":\"3/4\"}'::jsonb,'UNAVAILABLE',1,'MANUAL','legacy') RETURNING id");
			String existingPlay = "00000000-0000-0000-0000-000000000021";
			execute(connection, """
					INSERT INTO play_sessions(id,user_id,song_id,chart_version_id,mode,input_source,judgement_context,
						payload_schema_version,payload_hash,started_at,ended_at)
					VALUES ('%s',1,%s,%s,'RHYTHM','KEYBOARD','{}',1,
						'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',now(),now());
					INSERT INTO reports(play_session_id,timing_histogram,pad_stats,weak_segments,recommended_drills,generator_version)
					VALUES ('%s','{"legacy":true}','[]','[{"description":"legacy"}]','[]','legacy-report-v1');
					""".formatted(existingPlay, existingSong, existingVersion, existingPlay));
			String history = scalar(connection, "SELECT string_agg(version||':'||checksum,',' ORDER BY installed_rank) FROM flyway_schema_history");
			var latest = flyway(null);
			assertThat(latest.migrate().migrationsExecuted).isEqualTo(18);
			assertThat(scalar(connection, "SELECT string_agg(version||':'||checksum,',' ORDER BY installed_rank) FROM flyway_schema_history WHERE version NOT IN ('10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27')"))
					.isEqualTo(history);
			assertThat(scalar(connection, "SELECT count(*) FROM telemetry_events")).isEqualTo("2");
			assertThat(scalar(connection, "SELECT t_recv FROM telemetry_events WHERE tags->>'origin'='v7'")).isEqualTo("12.5");
			assertThat(scalar(connection, "SELECT nickname FROM users")).isEqualTo("전환 전 회원");
			assertThat(scalar(connection, "SELECT count(*) FROM songs WHERE source='BUILTIN' AND owner_id IS NULL AND status='READY'")).isEqualTo("4");
			assertThat(scalar(connection, "SELECT count(*) FROM songs WHERE title='기본 8비트'")).isEqualTo("2");
			assertThat(scalar(connection, "SELECT count(*) FROM charts")).isEqualTo("4");
			assertThat(scalar(connection, "SELECT count(*) FROM chart_versions")).isEqualTo("4");
			assertThat(scalar(connection, "SELECT id FROM songs WHERE id=" + existingSong)).isEqualTo(existingSong);
			assertThat(scalar(connection, "SELECT license FROM songs WHERE id=" + existingSong)).isEqualTo("기존 권리 메타");
			assertThat(scalar(connection, "SELECT id FROM charts WHERE id=" + existingChart)).isEqualTo(existingChart);
			assertThat(scalar(connection, "SELECT notes->0->>'noteId' FROM chart_versions WHERE id=" + existingVersion)).isEqualTo("legacy-1");
			assertThat(scalar(connection, "SELECT timing->>'offsetMs' FROM chart_versions WHERE id=" + existingVersion)).isEqualTo("11");
			assertThat(scalar(connection, "SELECT analysis_status FROM reports WHERE play_session_id='" + existingPlay + "'")).isEqualTo("NOT_REQUESTED");
			assertThat(scalar(connection, "SELECT timing_histogram->>'legacy' FROM reports WHERE play_session_id='" + existingPlay + "'")).isEqualTo("true");
			assertThat(scalar(connection, "SELECT weak_segments->0->>'description' FROM reports WHERE play_session_id='" + existingPlay + "'")).isEqualTo("legacy");
			assertThat(scalar(connection, "SELECT jsonb_typeof(recommended_drills) FROM reports WHERE play_session_id='" + existingPlay + "'")).isEqualTo("array");
			assertThatThrownBy(() -> execute(connection, "UPDATE reports SET analysis_status=NULL WHERE play_session_id='" + existingPlay + "'"))
					.isInstanceOfSatisfying(SQLException.class, error -> assertThat(error.getSQLState()).isEqualTo("23502"));
			assertThatThrownBy(() -> execute(connection, "UPDATE reports SET analysis_status='UNKNOWN' WHERE play_session_id='" + existingPlay + "'"))
					.isInstanceOfSatisfying(SQLException.class, error -> assertThat(error.getSQLState()).isEqualTo("23514"));
			String seededSongIds = scalar(connection, "SELECT string_agg(id::text,',' ORDER BY id) FROM songs WHERE source='BUILTIN' AND id <> " + existingSong);
			assertThat(scalar(connection, "SELECT count(*) FROM play_raw_uploads")).isEqualTo("1");
			verifyHypertable(connection);
			assertThat(scalar(connection, "SELECT count(*) FROM timescaledb_information.chunks WHERE hypertable_name='telemetry_events'"))
					.isEqualTo("2");
			assertThat(scalar(connection, "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='telemetry_events' AND indexname IN ('telemetry_events_time_idx','telemetry_events_session_time_idx')"))
					.isEqualTo("2");
			execute(connection, """
					INSERT INTO telemetry_events(time,session_id,kind)
					VALUES('2026-10-05T12:00:00Z','00000000-0000-0000-0000-000000000002','STATUS')
					""");
			assertThat(scalar(connection, "SELECT count(*) FROM timescaledb_information.chunks WHERE hypertable_name='telemetry_events'"))
					.isEqualTo("3");
			assertThatThrownBy(() -> execute(connection, """
					INSERT INTO telemetry_events(time,session_id,kind,battery_pct)
					VALUES(now(),'00000000-0000-0000-0000-000000000003','STATUS',101)
					""")).isInstanceOfSatisfying(SQLException.class,
							error -> assertThat(error.getSQLState()).isEqualTo("23514"));
			// V17: hypertable에서도 패드 varchar(16)·clock_offset_ms double precision이 적용된다.
			execute(connection, """
					INSERT INTO telemetry_events(time,session_id,kind,pad,baseline_pad,predicted_pad,clock_offset_ms)
					VALUES('2026-10-05T13:00:00Z','00000000-0000-0000-0000-000000000002','HIT','HIHAT_PEDAL','HIHAT_PEDAL','HIHAT_PEDAL',1234567.891)
					""");
			assertThat(scalar(connection, "SELECT clock_offset_ms FROM telemetry_events WHERE pad='HIHAT_PEDAL'")).isEqualTo("1234567.891");
			assertThatThrownBy(() -> execute(connection, """
					INSERT INTO telemetry_events(time,session_id,kind,clock_offset_ms)
					VALUES('2026-10-05T14:00:00Z','00000000-0000-0000-0000-000000000003','STATUS','Infinity')
					""")).isInstanceOfSatisfying(SQLException.class,
							error -> assertThat(error.getSQLState()).isEqualTo("23514"));
			latest.validate();
			assertThat(latest.migrate().migrationsExecuted).isZero();
			assertThat(scalar(connection, "SELECT count(*) FROM telemetry_events")).isEqualTo("4");
			assertThat(scalar(connection, "SELECT count(*) FROM chart_versions")).isEqualTo("4");
			assertThat(scalar(connection, "SELECT count(*) FROM songs WHERE title='기본 8비트'")).isEqualTo("2");
			assertThat(scalar(connection, "SELECT string_agg(id::text,',' ORDER BY id) FROM songs WHERE source='BUILTIN' AND id <> " + existingSong)).isEqualTo(seededSongIds);
			assertThat(scalar(connection, "SELECT count(*) FROM chart_versions WHERE version=1")).isEqualTo("4");
			assertThat(scalar(connection, "SELECT object_key FROM play_raw_uploads")).isEqualTo("play-raw/legacy.log");
		}
	}

	@Test
	void freshDatabaseAppliesAllVersionsAndBuiltinSeed() throws Exception {
		// 별도 DB로 전환 테스트와 확장 카탈로그·이력을 격리한다.
		try (var connection = connect()) {
			execute(connection, "CREATE DATABASE timescale_test_fresh");
		}
		// 이미지의 template1에서 상속된 확장도 제거해 V8의 CREATE EXTENSION을 실제 검증한다.
		try (var connection = DriverManager.getConnection(url() + "_fresh", "postgres", password())) {
			execute(connection, "DROP EXTENSION IF EXISTS timescaledb");
		}
		var fresh = Flyway.configure().dataSource(url() + "_fresh", "postgres", password())
				.locations("classpath:db/migration").load();
		assertThat(fresh.migrate().migrationsExecuted).isEqualTo(27);
		fresh.validate();
		assertThat(fresh.migrate().migrationsExecuted).isZero();
		try (var connection = DriverManager.getConnection(url() + "_fresh", "postgres", password())) {
			verifyHypertable(connection);
			assertThat(scalar(connection, "SELECT count(*) FROM songs WHERE source='BUILTIN' AND owner_id IS NULL AND status='READY'")).isEqualTo("3");
			assertThat(scalar(connection, "SELECT count(*) FROM charts")).isEqualTo("3");
			assertThat(scalar(connection, "SELECT count(*) FROM chart_versions")).isEqualTo("3");
		}
	}

	private void verifyHypertable(Connection connection) throws SQLException {
		assertThat(scalar(connection, "SELECT count(*) FROM information_schema.columns WHERE table_name='songs' AND column_name='cover_key' AND is_nullable='YES'")).isEqualTo("1");
			assertThat(scalar(connection, "SELECT extversion FROM pg_extension WHERE extname='timescaledb'")).isEqualTo("2.30.2");
		assertThat(scalar(connection, "SELECT count(*) FROM timescaledb_information.hypertables WHERE hypertable_schema='public' AND hypertable_name='telemetry_events'"))
				.isEqualTo("1");
		assertThat(scalar(connection, "SELECT extract(epoch FROM time_interval)::bigint FROM timescaledb_information.dimensions WHERE hypertable_name='telemetry_events' AND column_name='time'"))
				.isEqualTo("86400");
		assertThat(scalar(connection, "SELECT count(*) FROM timescaledb_information.jobs WHERE hypertable_name='telemetry_events'"))
				.isEqualTo("0");
	}

	private Flyway flyway(String target) {
		var configuration = Flyway.configure().dataSource(url(), "postgres", password())
				.locations("classpath:db/migration");
		if (target != null) {
			configuration.target(target);
		}
		return configuration.load();
	}

	private static String url() {
		return System.getenv("TIMESCALE_TEST_URL");
	}

	private static String password() {
		return System.getenv("TIMESCALE_TEST_PASSWORD");
	}

	private Connection connect() throws SQLException {
		return DriverManager.getConnection(url(), "postgres", password());
	}

	private void execute(Connection connection, String sql) throws SQLException {
		try (var statement = connection.createStatement()) {
			statement.execute(sql);
		}
	}

	private String scalar(Connection connection, String sql) throws SQLException {
		try (var statement = connection.createStatement(); var rows = statement.executeQuery(sql)) {
			assertThat(rows.next()).isTrue();
			return rows.getString(1);
		}
	}
}
