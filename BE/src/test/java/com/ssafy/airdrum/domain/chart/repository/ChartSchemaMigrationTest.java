package com.ssafy.airdrum.domain.chart.repository;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

import javax.sql.DataSource;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 실제 회원 V1과 채보 V2를 격리 스키마에 적용한다. 공통 임베디드 PostgreSQL을 재사용한다. */
@SpringBootTest
class ChartSchemaMigrationTest {

	@Autowired
	private DataSource dataSource;

	@Test
	void upgradesExistingUsersToV2AndRepeatedMigrationPreservesData() throws Exception {
		String schema = newSchema();
		try {
			assertThat(flyway(schema, "1").migrate().migrationsExecuted).isEqualTo(1);
			try (var connection = dataSource.getConnection()) {
				connection.setSchema(schema);
				try (var statement = connection.createStatement()) {
					statement.execute("INSERT INTO users (nickname) VALUES ('기존 회원')");
					statement.execute("INSERT INTO social_accounts (user_id, provider, provider_user_id) VALUES (1, 'GOOGLE', 'existing-sub')");
				}
			}

			var migration = flyway(schema, "2");
			assertThat(migration.migrate().migrationsExecuted).isEqualTo(1);
			try (var connection = dataSource.getConnection()) {
				connection.setSchema(schema);
				try (var statement = connection.createStatement()) {
					statement.execute("INSERT INTO songs (owner_id, title, source) VALUES (1, '기존 회원 곡', 'AUDIO')");
				}
			}
			migration.validate();
			assertThat(migration.migrate().migrationsExecuted).isZero();
			assertThat(migration.info().current().getVersion().getVersion()).isEqualTo("2");
			try (var connection = dataSource.getConnection()) {
				connection.setSchema(schema);
				try (var statement = connection.createStatement(); var rows = statement.executeQuery("""
						SELECT u.nickname, a.provider_user_id, s.title
						FROM users u JOIN social_accounts a ON a.user_id = u.id
						JOIN songs s ON s.owner_id = u.id
						""")) {
					assertThat(rows.next()).isTrue();
					assertThat(rows.getString(1)).isEqualTo("기존 회원");
					assertThat(rows.getString(2)).isEqualTo("existing-sub");
					assertThat(rows.getString(3)).isEqualTo("기존 회원 곡");
					assertThat(rows.next()).isFalse();
				}
			}
		}
		finally {
			dropSchema(schema);
		}
	}

	@Test
	void freshMigrationEnforcesChartConstraintsAndPreservesVersionHistory() throws Exception {
		String schema = newSchema();
		try {
			var migration = flyway(schema, "2");
			assertThat(migration.migrate().migrationsExecuted).isEqualTo(2);
			var sql = new ClassPathResource("db/chart-schema-test.sql").getContentAsString(StandardCharsets.UTF_8);
			try (var connection = dataSource.getConnection()) {
				connection.setSchema(schema);
				try (var statement = connection.createStatement()) {
					// DO 블록을 세미콜론으로 나누지 않고 PostgreSQL 드라이버에 그대로 전달한다.
					statement.execute(sql);
					try (var rows = statement.executeQuery("SELECT count(*) FROM chart_versions")) {
						assertThat(rows.next()).isTrue();
						assertThat(rows.getLong(1)).isEqualTo(5);
					}
				}
			}
			migration.validate();
		}
		finally {
			dropSchema(schema);
		}
	}

	@Test
	void v12AllowsBuiltinBackingWhilePreservingAudioOwnershipAndOtherChecks() throws Exception {
		String schema = newSchema();
		try {
			var before = flyway(schema, "11", "classpath:db/test-migration");
			assertThat(before.migrate().migrationsExecuted).isEqualTo(10);
			long ownerId;
			long builtinId;
			try (var connection = dataSource.getConnection()) {
				connection.setSchema(schema);
				try (var statement = connection.createStatement()) {
					try (var rows = statement.executeQuery("INSERT INTO users(nickname) VALUES ('반주 소유자') RETURNING id")) {
						assertThat(rows.next()).isTrue();
						ownerId = rows.getLong(1);
					}
					try (var rows = statement.executeQuery("SELECT id FROM songs WHERE title='기본 8비트'")) {
						assertThat(rows.next()).isTrue();
						builtinId = rows.getLong(1);
					}
					statement.executeUpdate("INSERT INTO songs(owner_id,title,source) VALUES (" + ownerId + ", '개인 AUDIO', 'AUDIO')");
				}
			}

			var after = flyway(schema, "12", "classpath:db/test-migration");
			assertThat(after.migrate().migrationsExecuted).isEqualTo(1);
			try (var connection = dataSource.getConnection()) {
				connection.setSchema(schema);
				try (var statement = connection.createStatement()) {
					statement.executeUpdate("UPDATE songs SET accompaniment_key='accompaniment/" + builtinId + ".wav' WHERE id=" + builtinId);
					statement.executeUpdate("UPDATE songs SET accompaniment_key='accompaniment/' || id || '.wav' WHERE owner_id=" + ownerId);
					assertThatThrownBy(() -> statement.executeUpdate("INSERT INTO songs(owner_id,title,source,accompaniment_key) VALUES (" +
							ownerId + ", '개인 MIDI', 'MIDI', 'accompaniment/999.wav')"))
							.isInstanceOf(java.sql.SQLException.class);
					assertThatThrownBy(() -> statement.executeUpdate("INSERT INTO songs(owner_id,title,source,license,accompaniment_key) VALUES (" +
							ownerId + ", '잘못된 BUILTIN', 'BUILTIN', '출처', 'accompaniment/999.wav')"))
							.isInstanceOf(java.sql.SQLException.class);
				}
			}
			after.validate();
			assertThat(after.migrate().migrationsExecuted).isZero();
			try (var connection = dataSource.getConnection()) {
				connection.setSchema(schema);
				try (var statement = connection.createStatement(); var rows = statement.executeQuery("""
						SELECT s.accompaniment_key, s.license FROM songs s WHERE s.id = """ + builtinId)) {
					assertThat(rows.next()).isTrue();
					assertThat(rows.getString(1)).isEqualTo("accompaniment/" + builtinId + ".wav");
					assertThat(rows.getString(2)).contains("음원 미포함");
				}
			}
		}
		finally {
			dropSchema(schema);
		}
	}

	private Flyway flyway(String schema, String target) {
		return flyway(schema, target, "classpath:db/migration");
	}

	private Flyway flyway(String schema, String target, String location) {
		return Flyway.configure().dataSource(dataSource).locations(location)
				.schemas(schema).defaultSchema(schema).target(target).load();
	}

	private static String newSchema() {
		return "chart94_" + UUID.randomUUID().toString().replace("-", "");
	}

	private void dropSchema(String schema) throws Exception {
		if (!schema.matches("chart94_[a-f0-9]{32}")) {
			throw new IllegalArgumentException("이 테스트가 만든 스키마만 정리할 수 있습니다");
		}
		try (var connection = dataSource.getConnection(); var statement = connection.createStatement()) {
			statement.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
		}
	}
}
