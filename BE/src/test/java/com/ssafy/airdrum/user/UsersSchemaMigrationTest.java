package com.ssafy.airdrum.user;

import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import javax.sql.DataSource;

import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

/**
 * 설계 문서 3-3·3-4·3-5와 인수 조건 1~4: V1이 적용되고 users·social_accounts의 컬럼·제약이 설계와 같다.
 * 각 테스트는 트랜잭션 안에서 실행되고 끝나면 롤백된다.
 */
@DataJpaTest
class UsersSchemaMigrationTest {

	@Autowired
	private JdbcTemplate jdbc;

	@Autowired
	private Environment environment;

	@Test
	void flywayAppliedVersionOneSuccessfully() {
		var rows = jdbc.queryForList(
				"SELECT version, success FROM flyway_schema_history WHERE version IS NOT NULL ORDER BY installed_rank");
		assertThat(rows).isNotEmpty();
		assertThat(rows.getFirst()).containsEntry("version", "1").containsEntry("success", true);
	}

	@Test
	void usersColumnsMatchDesign() {
		assertThat(columns("users")).containsExactly(
				column("id", "bigint", null, "NO", null, "ALWAYS"),
				column("nickname", "character varying", 30, "NO", null, null),
				column("email", "character varying", 255, "YES", null, null),
				column("profile_image_url", "character varying", 500, "YES", null, null),
				column("role", "character varying", 10, "NO", "'USER'::character varying", null),
				column("status", "character varying", 10, "NO", "'ACTIVE'::character varying", null),
				column("created_at", "timestamp with time zone", null, "NO", "now()", null),
				column("updated_at", "timestamp with time zone", null, "NO", "now()", null),
				column("withdrawn_at", "timestamp with time zone", null, "YES", null, null),
				column("data_consent", "boolean", null, "YES", null, null),
				column("data_consent_at", "timestamp with time zone", null, "YES", null, null),
				column("data_consent_version", "character varying", 50, "YES", null, null),
				column("terms_version", "character varying", 50, "YES", null, null),
				column("terms_agreed_at", "timestamp with time zone", null, "YES", null, null),
				column("privacy_version", "character varying", 50, "YES", null, null),
				column("privacy_agreed_at", "timestamp with time zone", null, "YES", null, null));
	}

	@Test
	void socialAccountsColumnsMatchDesign() {
		assertThat(columns("social_accounts")).containsExactly(
				column("id", "bigint", null, "NO", null, "ALWAYS"),
				column("user_id", "bigint", null, "NO", null, null),
				column("provider", "character varying", 20, "NO", null, null),
				column("provider_user_id", "character varying", 255, "NO", null, null),
				column("email", "character varying", 255, "YES", null, null),
				column("connected_at", "timestamp with time zone", null, "NO", "now()", null));
	}

	@Test
	void constraintsFollowNamingRule() {
		assertThat(constraints("users")).containsExactlyInAnyOrder(
				"p:pk_users", "c:ck_users_role", "c:ck_users_status", "c:ck_users_withdrawn_at", "c:ck_users_data_consent",
				"c:ck_users_terms_consent", "c:ck_users_privacy_consent");
		assertThat(constraints("social_accounts")).containsExactlyInAnyOrder(
				"p:pk_social_accounts", "f:fk_social_accounts_user_id", "u:uq_social_accounts_provider_user");
		assertThat(jdbc.queryForList(
				"SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'social_accounts'",
				String.class))
				.contains("ix_social_accounts_user_id");
	}

	@Test
	void newUserGetsDefaultRoleStatusAndTimestamps() {
		long id = insertUser("드러머");
		var row = jdbc.queryForMap("SELECT role, status, created_at, updated_at, withdrawn_at FROM users WHERE id = ?", id);
		assertThat(row).containsEntry("role", "USER").containsEntry("status", "ACTIVE").containsEntry("withdrawn_at", null);
		assertThat(row.get("created_at")).isNotNull();
		assertThat(row.get("updated_at")).isNotNull();
	}

	@Test
	void explicitUserIdIsRejectedBecauseIdentityIsAlways() {
		assertSqlState(() -> jdbc.update("INSERT INTO users (id, nickname) VALUES (999, '수동')"), "428C9");
	}

	@Test
	void roleOutsideAllowedValuesIsRejected() {
		assertSqlState(() -> jdbc.update("INSERT INTO users (nickname, role) VALUES ('a', 'OWNER')"), "23514");
	}

	@Test
	void statusOutsideAllowedValuesIsRejected() {
		assertSqlState(() -> jdbc.update("INSERT INTO users (nickname, status) VALUES ('a', 'BANNED')"), "23514");
	}

	@Test
	void withdrawnStatusRequiresWithdrawnAt() {
		assertSqlState(() -> jdbc.update("INSERT INTO users (nickname, status) VALUES ('a', 'WITHDRAWN')"), "23514");
	}

	@Test
	void activeUserCannotHaveWithdrawnAt() {
		assertSqlState(() -> jdbc.update("INSERT INTO users (nickname, withdrawn_at) VALUES ('a', now())"), "23514");
	}

	@Test
	void withdrawnUserWithWithdrawnAtIsAccepted() {
		int inserted = jdbc.update(
				"INSERT INTO users (nickname, status, withdrawn_at) VALUES ('탈퇴한 사용자', 'WITHDRAWN', now())");
		assertThat(inserted).isEqualTo(1);
	}

	@Test
	void newUserHasNoDataConsent() {
		long id = insertUser("드러머");
		var row = jdbc.queryForMap("SELECT data_consent, data_consent_at FROM users WHERE id = ?", id);
		assertThat(row).containsEntry("data_consent", null).containsEntry("data_consent_at", null);
	}

	@Test
	void dataConsentWithoutTimestampIsRejected() {
		assertSqlState(() -> jdbc.update("INSERT INTO users (nickname, data_consent) VALUES ('a', true)"), "23514");
	}

	@Test
	void dataConsentTimestampWithoutValueIsRejected() {
		assertSqlState(() -> jdbc.update("INSERT INTO users (nickname, data_consent_at) VALUES ('a', now())"), "23514");
	}

	@Test
	void dataConsentValueTimestampAndVersionTogetherAreAccepted() {
		assertThat(jdbc.update("INSERT INTO users (nickname, data_consent, data_consent_at, data_consent_version) "
				+ "VALUES ('a', false, now(), 'v1')")).isEqualTo(1);
		assertThat(jdbc.update("INSERT INTO users (nickname, data_consent, data_consent_at, data_consent_version) "
				+ "VALUES ('b', true, now(), 'v1')")).isEqualTo(1);
		assertThat(jdbc.update("INSERT INTO users (nickname) VALUES ('c')")).isEqualTo(1);
	}

	/** 가입 동의 설계 3-5(V26): 값·시각이 있어도 판이 없으면 거부한다. */
	@Test
	void dataConsentWithoutVersionIsRejected() {
		assertSqlState(() -> jdbc.update(
				"INSERT INTO users (nickname, data_consent, data_consent_at) VALUES ('a', true, now())"), "23514");
	}

	@Test
	void dataConsentVersionWithoutValueIsRejected() {
		assertSqlState(() -> jdbc.update(
				"INSERT INTO users (nickname, data_consent_version) VALUES ('a', 'v1')"), "23514");
	}

	@Test
	void blankDataConsentVersionIsRejected() {
		assertSqlState(() -> jdbc.update("INSERT INTO users (nickname, data_consent, data_consent_at, data_consent_version) "
				+ "VALUES ('a', true, now(), '  ')"), "23514");
	}

	@Test
	void newUserHasNoSignupConsent() {
		long id = insertUser("드러머");
		var row = jdbc.queryForMap("SELECT data_consent_version, terms_version, terms_agreed_at, privacy_version, "
				+ "privacy_agreed_at FROM users WHERE id = ?", id);
		assertThat(row.values()).containsOnlyNulls();
	}

	/**
	 * 이용약관·개인정보 동의는 판과 시각이 함께 있거나 함께 없다. 판은 빈 값·공백만일 수 없다.
	 * PostgreSQL은 실패한 문장 뒤 트랜잭션을 쓸 수 없으므로 경우마다 따로 실행한다.
	 */
	@ParameterizedTest
	@ValueSource(strings = {
			"(nickname, terms_version) VALUES ('a', 'v1')",
			"(nickname, terms_agreed_at) VALUES ('a', now())",
			"(nickname, terms_version, terms_agreed_at) VALUES ('a', '', now())",
			"(nickname, terms_version, terms_agreed_at) VALUES ('a', '   ', now())",
			"(nickname, privacy_version) VALUES ('a', 'v1')",
			"(nickname, privacy_agreed_at) VALUES ('a', now())",
			"(nickname, privacy_version, privacy_agreed_at) VALUES ('a', '', now())",
			"(nickname, privacy_version, privacy_agreed_at) VALUES ('a', '   ', now())" })
	void incompleteSignupConsentIsRejected(String columnsAndValues) {
		assertSqlState(() -> jdbc.update("INSERT INTO users " + columnsAndValues), "23514");
	}

	@Test
	void completedSignupConsentIsAccepted() {
		assertThat(jdbc.update("""
				INSERT INTO users (nickname, terms_version, terms_agreed_at, privacy_version, privacy_agreed_at,
				  data_consent, data_consent_at, data_consent_version)
				VALUES ('a', '2026-11-01', now(), '2026-11-01', now(), true, now(), '2026-11-01')
				""")).isEqualTo(1);
	}

	/**
	 * V26은 판 없이 연주 기록 활용 값만 있는 기존 행을 세 값 모두 null로 되돌린 뒤 CHECK를 건다. 미설정 행은 그대로다.
	 * 격리 스키마에 V25까지 적용하고 행을 넣은 뒤 V26을 적용한다. 공용 연결 풀의 search_path를 바꾸지 않도록
	 * 풀 없는 DataSource를 따로 쓴다.
	 */
	@Test
	@Transactional(propagation = Propagation.NOT_SUPPORTED)
	void v26ClearsDataConsentWithoutVersion() throws Exception {
		DataSource dataSource = new DriverManagerDataSource(environment.getRequiredProperty("spring.datasource.url"),
				environment.getRequiredProperty("spring.datasource.username"),
				environment.getRequiredProperty("spring.datasource.password"));
		String schema = "users199_" + UUID.randomUUID().toString().replace("-", "");
		try {
			assertThat(flyway(dataSource, schema, "25").migrate().migrationsExecuted).isPositive();
			try (var connection = dataSource.getConnection(); var statement = connection.createStatement()) {
				connection.setSchema(schema);
				statement.execute("INSERT INTO users (nickname, data_consent, data_consent_at) VALUES ('동의', true, now())");
				statement.execute("INSERT INTO users (nickname, data_consent, data_consent_at) VALUES ('거부', false, now())");
				statement.execute("INSERT INTO users (nickname) VALUES ('미응답')");
			}

			assertThat(flyway(dataSource, schema, "26").migrate().migrationsExecuted).isEqualTo(1);

			try (var connection = dataSource.getConnection(); var statement = connection.createStatement()) {
				connection.setSchema(schema);
				try (var rows = statement.executeQuery("SELECT count(*) FROM users WHERE data_consent IS NULL "
						+ "AND data_consent_at IS NULL AND data_consent_version IS NULL")) {
					assertThat(rows.next()).isTrue();
					assertThat(rows.getLong(1)).isEqualTo(3);
				}
			}
		}
		finally {
			try (var connection = dataSource.getConnection(); var statement = connection.createStatement()) {
				statement.execute("DROP SCHEMA " + schema + " CASCADE");
			}
		}
	}

	private static Flyway flyway(DataSource dataSource, String schema, String target) {
		return Flyway.configure().dataSource(dataSource).locations("classpath:db/test-migration")
				.schemas(schema).defaultSchema(schema).target(target).load();
	}

	@Test
	void sameProviderAccountCannotBeLinkedTwice() {
		long first = insertUser("a");
		long second = insertUser("b");
		insertSocialAccount(first, "GOOGLE", "sub-1");
		assertSqlState(() -> insertSocialAccount(second, "GOOGLE", "sub-1"), "23505");
	}

	@Test
	void sameProviderUserIdOnAnotherProviderIsAllowed() {
		long user = insertUser("a");
		insertSocialAccount(user, "GOOGLE", "sub-1");
		insertSocialAccount(user, "KAKAO", "sub-1");
		assertThat(jdbc.queryForObject("SELECT count(*) FROM social_accounts WHERE user_id = ?", Long.class, user))
				.isEqualTo(2);
	}

	@Test
	void socialAccountMustReferenceExistingUser() {
		assertSqlState(() -> insertSocialAccount(-1, "GOOGLE", "sub-x"), "23503");
	}

	@Test
	void deletingUserCascadesToSocialAccounts() {
		long user = insertUser("a");
		insertSocialAccount(user, "GOOGLE", "sub-1");
		jdbc.update("DELETE FROM users WHERE id = ?", user);
		assertThat(jdbc.queryForObject("SELECT count(*) FROM social_accounts WHERE user_id = ?", Long.class, user))
				.isZero();
	}

	private long insertUser(String nickname) {
		return jdbc.queryForObject("INSERT INTO users (nickname) VALUES (?) RETURNING id", Long.class, nickname);
	}

	private void insertSocialAccount(long userId, String provider, String providerUserId) {
		jdbc.update("INSERT INTO social_accounts (user_id, provider, provider_user_id) VALUES (?, ?, ?)",
				userId, provider, providerUserId);
	}

	private List<Map<String, Object>> columns(String table) {
		return jdbc.queryForList("""
				SELECT column_name, data_type, character_maximum_length, is_nullable, column_default, identity_generation
				FROM information_schema.columns
				WHERE table_schema = current_schema() AND table_name = ?
				ORDER BY ordinal_position
				""", table);
	}

	private static Map<String, Object> column(String name, String type, Integer length, String nullable,
			String defaultValue, String identity) {
		var map = new java.util.LinkedHashMap<String, Object>();
		map.put("column_name", name);
		map.put("data_type", type);
		map.put("character_maximum_length", length);
		map.put("is_nullable", nullable);
		map.put("column_default", defaultValue);
		map.put("identity_generation", identity);
		return map;
	}

	private List<String> constraints(String table) {
		return jdbc.queryForList("""
				SELECT c.contype::text || ':' || c.conname
				FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
				JOIN pg_namespace n ON n.oid = t.relnamespace
				WHERE t.relname = ? AND n.nspname = current_schema() AND c.contype <> 'n'
				""", String.class, table);
	}

	private static void assertSqlState(ThrowingCallable call, String expectedSqlState) {
		Throwable thrown = catchThrowable(call);
		assertThat(thrown).as("SQLSTATE %s 위반이 나야 한다", expectedSqlState).isNotNull();
		Throwable cause = thrown;
		while (cause != null && !(cause instanceof SQLException)) {
			cause = cause.getCause();
		}
		assertThat(cause).isInstanceOf(SQLException.class);
		assertThat(((SQLException) cause).getSQLState()).isEqualTo(expectedSqlState);
	}

}
