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
			String history = scalar(connection, "SELECT string_agg(version||':'||checksum,',' ORDER BY installed_rank) FROM flyway_schema_history");
			var latest = flyway(null);
			assertThat(latest.migrate().migrationsExecuted).isEqualTo(2);
			assertThat(scalar(connection, "SELECT string_agg(version||':'||checksum,',' ORDER BY installed_rank) FROM flyway_schema_history WHERE version NOT IN ('8','9')"))
					.isEqualTo(history);
			assertThat(scalar(connection, "SELECT count(*) FROM telemetry_events")).isEqualTo("2");
			assertThat(scalar(connection, "SELECT t_recv FROM telemetry_events WHERE tags->>'origin'='v7'")).isEqualTo("12.5");
			assertThat(scalar(connection, "SELECT nickname FROM users")).isEqualTo("전환 전 회원");
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
			latest.validate();
			assertThat(latest.migrate().migrationsExecuted).isZero();
			assertThat(scalar(connection, "SELECT count(*) FROM telemetry_events")).isEqualTo("3");
		}
	}

	@Test
	void freshDatabaseAppliesAllNineVersions() throws Exception {
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
		assertThat(fresh.migrate().migrationsExecuted).isEqualTo(9);
		fresh.validate();
		assertThat(fresh.migrate().migrationsExecuted).isZero();
		try (var connection = DriverManager.getConnection(url() + "_fresh", "postgres", password())) {
			verifyHypertable(connection);
		}
	}

	private void verifyHypertable(Connection connection) throws SQLException {
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
