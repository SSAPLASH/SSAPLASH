package com.ssafy.airdrum.user;

import java.sql.SQLException;
import java.util.List;
import java.util.Map;

import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.jdbc.core.JdbcTemplate;

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
				column("withdrawn_at", "timestamp with time zone", null, "YES", null, null));
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
				"p:pk_users", "c:ck_users_role", "c:ck_users_status", "c:ck_users_withdrawn_at");
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
