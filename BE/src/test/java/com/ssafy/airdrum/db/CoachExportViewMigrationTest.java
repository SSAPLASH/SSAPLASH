package com.ssafy.airdrum.db;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import javax.sql.DataSource;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import com.zaxxer.hikari.HikariDataSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V20(hits 패드 3컬럼 varchar(16))와 V21(약점 분석 보정용 비식별 뷰·읽기 전용 그룹 역할)을 격리 스키마에서 검사한다.
 * 소금(app.export_salt)·SET ROLE은 세션 상태를 바꾸므로 풀 연결이 아니라 전용 JDBC 연결에서만 쓴다.
 */
@SpringBootTest
class CoachExportViewMigrationTest {

	private static final String HASH = "a".repeat(64);
	private static final String CONTEXT = "{\"timingWindows\":{\"perfectMs\":25,\"goodMs\":60}}";
	private static final List<String> ALLOWED_COLUMNS = List.of(
			"session_key", "mode", "input_source", "song_ref", "song_origin", "perfect_ms", "good_ms",
			"difficulty", "played_date", "payload_schema_version",
			"seq", "t_ms", "stick_id", "pad", "velocity", "peak_accel", "judgement", "matched_note_id", "delta_ms");

	@Autowired
	private DataSource dataSource;
	private final List<String> schemas = new ArrayList<>();
	private String schema;

	@BeforeEach
	void prepare() {
		schema = newSchema();
	}

	@AfterEach
	void clean() throws Exception {
		try (var c = dataSource.getConnection(); var s = c.createStatement()) {
			for (var name : schemas) {
				if (!name.matches("ce_[a-f0-9]{32}")) throw new IllegalArgumentException("테스트 전용 스키마만 삭제합니다");
				s.execute("DROP SCHEMA IF EXISTS " + name + " CASCADE");
			}
		}
	}

	@Test
	void v20WidensHitsPadColumnsWithoutLosingRows() throws Exception {
		assertThat(flyway(schema, "19").migrate().migrationsExecuted).isEqualTo(18);
		try (var c = open(schema)) {
			execute(c, "INSERT INTO users(nickname) VALUES('기존 회원')");
			long user = scalarLong(c, "SELECT id FROM users");
			insertSession(c, id(1), user, "FREE", true, 0, null, null, null);
			execute(c, "INSERT INTO hits(play_session_id,seq,t_ms,pad,baseline_pad,predicted_pad,velocity) "
					+ "VALUES('" + id(1) + "',0,1,'SNARE','SNARE','SNARE',80)");
		}

		var v20 = flyway(schema, "20");
		assertThat(v20.migrate().migrationsExecuted).isEqualTo(1);

		try (var c = open(schema)) {
			assertThat(scalar(c, "SELECT pad||':'||baseline_pad||':'||predicted_pad FROM hits")).isEqualTo("SNARE:SNARE:SNARE");
			for (var column : List.of("pad", "baseline_pad", "predicted_pad")) {
				assertThat(scalar(c, "SELECT character_maximum_length FROM information_schema.columns "
						+ "WHERE table_schema=current_schema() AND table_name='hits' AND column_name='" + column + "'")).isEqualTo("16");
			}
			execute(c, "INSERT INTO hits(play_session_id,seq,t_ms,pad,baseline_pad,predicted_pad,velocity) "
					+ "VALUES('" + id(1) + "',1,2,'HIHAT_PEDAL','HIHAT_PEDAL','HIHAT_PEDAL',80)");
			assertThat(scalar(c, "SELECT pad FROM hits WHERE seq=1")).isEqualTo("HIHAT_PEDAL");
		}
	}

	@Test
	void viewColumnsAreExactlyTheAllowList() throws Exception {
		migrateLatest(schema);
		try (var c = open(schema)) {
			var columns = new ArrayList<String>();
			try (var st = c.createStatement(); var rows = st.executeQuery(
					"SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() "
							+ "AND table_name='coach_export_v' ORDER BY ordinal_position")) {
				while (rows.next()) columns.add(rows.getString(1));
			}
			assertThat(columns).containsExactlyElementsOf(ALLOWED_COLUMNS);
			assertThat(scalar(c, "SELECT character_maximum_length FROM information_schema.columns "
					+ "WHERE table_schema=current_schema() AND table_name='coach_export_v' AND column_name='pad'")).isEqualTo("16");
		}
	}

	@Test
	void exportsOnlyConsentedAnalysisSessionsOfNonAdminUsersLatestTenEach() throws Exception {
		migrateLatest(schema);
		var seed = seed(schema);
		try (var c = open(schema)) {
			execute(c, "SET app.export_salt = 's1'");
			var expected = new HashSet<String>();
			for (int i = 2; i <= 11; i++) expected.add(key(id(i), "s1"));
			expected.add(key(seed.privateSession(), "s1"));
			expected.add(key(seed.withdrawnSession(), "s1"));
			// 가장 오래된 동의 세션(1번), 비동의(20), FREE(21), ADMIN(30)은 나오지 않는다.
			assertThat(keys(c)).isEqualTo(expected);
			assertThat(scalarLong(c, "SELECT count(DISTINCT session_key) FROM coach_export_v")).isEqualTo(12);
			assertThat(scalarLong(c, "SELECT count(*) FROM coach_export_v")).isEqualTo(14);
		}
	}

	/** V41: 탈퇴 회원의 세션이 삭제되기 전에도 뷰에 나오지 않고, 열과 권한은 그대로다. */
	@Test
	void v41ExcludesWithdrawnMembersAndKeepsColumns() throws Exception {
		migrateLatest(schema);
		var seed = seed(schema);
		flyway(schema, "41").migrate();
		try (var c = open(schema)) {
			execute(c, "SET app.export_salt = 's1'");
			execute(c, "SET ROLE coach_export_reader");
			assertThat(keys(c)).doesNotContain(key(seed.withdrawnSession(), "s1")).contains(key(seed.privateSession(), "s1"));
			assertThat(scalarLong(c, "SELECT count(DISTINCT session_key) FROM coach_export_v")).isEqualTo(11);
			execute(c, "RESET ROLE");
			var columns = new java.util.ArrayList<String>();
			try (var st = c.createStatement(); var rows = st.executeQuery("SELECT column_name FROM information_schema.columns "
					+ "WHERE table_schema=current_schema() AND table_name='coach_export_v' ORDER BY ordinal_position")) {
				while (rows.next()) columns.add(rows.getString(1));
			}
			assertThat(columns).containsExactlyElementsOf(ALLOWED_COLUMNS);
		}
	}

	@Test
	void privateSongHidesSongRefButKeepsDifficultyAndHitShapes() throws Exception {
		migrateLatest(schema);
		var seed = seed(schema);
		try (var c = open(schema)) {
			execute(c, "SET app.export_salt = 's1'");
			String privateKey = key(seed.privateSession(), "s1");
			String where = " FROM coach_export_v WHERE session_key='" + privateKey + "'";
			assertThat(scalar(c, "SELECT DISTINCT coalesce(song_ref::text,'NULL')||':'||song_origin||':'||difficulty||':'||input_source||':'||mode" + where))
					.isEqualTo("NULL:PRIVATE:HARD:STICK:SHEET");
			assertThat(scalar(c, "SELECT concat_ws(':',judgement,matched_note_id,stick_id,velocity,peak_accel,delta_ms,pad)" + where + " AND seq=1"))
					.isEqualTo("MISS:n2:KICK");
			assertThat(scalar(c, "SELECT coalesce(judgement,'NULL')||':'||coalesce(matched_note_id,'NULL')||':'||coalesce(delta_ms::text,'NULL')||':'||velocity||':'||pad" + where + " AND seq=2"))
					.isEqualTo("NULL:NULL:NULL:70:HIHAT_PEDAL");

			String publicKey = key(id(11), "s1");
			assertThat(scalar(c, "SELECT song_ref||':'||song_origin||':'||difficulty||':'||perfect_ms||':'||good_ms||':'||payload_schema_version"
					+ " FROM coach_export_v WHERE session_key='" + publicKey + "'"))
					.isEqualTo(seed.publicSong() + ":PUBLIC:NORMAL:25:60:1");
			assertThat(scalar(c, "SELECT concat_ws(':',seq,t_ms,stick_id,pad,velocity,peak_accel,judgement,matched_note_id,delta_ms)"
					+ " FROM coach_export_v WHERE session_key='" + publicKey + "'"))
					.isEqualTo("0:100:0:SNARE:80:1.5:PERFECT:n1:2.5");
		}
	}

	@Test
	void playedDateIsTheKstCalendarDate() throws Exception {
		migrateLatest(schema);
		var seed = seed(schema);
		try (var c = open(schema)) {
			execute(c, "SET TimeZone = 'UTC'");
			execute(c, "SET app.export_salt = 's1'");
			// created_at 2026-10-28 15:30 UTC = 2026-10-29 00:30 KST
			assertThat(scalar(c, "SELECT DISTINCT played_date FROM coach_export_v WHERE session_key='" + key(seed.withdrawnSession(), "s1") + "'"))
					.isEqualTo("2026-10-29");
		}
	}

	@Test
	void sessionKeyDependsOnSaltAndFailsClosedWithoutIt() throws Exception {
		migrateLatest(schema);
		seed(schema);
		try (var c = open(schema)) {
			execute(c, "SET app.export_salt = 's1'");
			assertThat(keys(c)).contains(key(id(11), "s1"));
			execute(c, "SET app.export_salt = 's2'");
			assertThat(keys(c)).contains(key(id(11), "s2")).doesNotContain(key(id(11), "s1"));
		}
		try (var c = open(schema)) {
			assertThatThrownBy(() -> keys(c)).isInstanceOf(SQLException.class)
					.satisfies(e -> assertThat(((SQLException) e).getSQLState()).isEqualTo("42704"));
		}
		// session_key를 고르지 않는 조회도 소금이 없으면 실패해야 한다(쓰지 않는 열은 계산되지 않으므로 별도 검사).
		for (var sql : List.of("SELECT count(*) FROM coach_export_v", "SELECT pad FROM coach_export_v")) {
			try (var c = open(schema)) {
				assertThatThrownBy(() -> scalar(c, sql)).isInstanceOf(SQLException.class)
						.satisfies(e -> assertThat(((SQLException) e).getSQLState()).isEqualTo("42704"));
			}
		}
		// 빈 소금은 행을 내지 않는다.
		try (var c = open(schema)) {
			execute(c, "SET app.export_salt = ''");
			assertThat(scalarLong(c, "SELECT count(*) FROM coach_export_v")).isZero();
		}
	}

	@Test
	void readerRoleCanReadOnlyTheView() throws Exception {
		migrateLatest(schema);
		seed(schema);
		try (var c = open(schema)) {
			execute(c, "SET app.export_salt = 's1'");
			execute(c, "SET ROLE coach_export_reader");
			assertThat(scalarLong(c, "SELECT count(*) FROM coach_export_v")).isEqualTo(14);
			for (var table : List.of("play_sessions", "hits", "users", "songs", "charts", "chart_versions")) {
				assertThatThrownBy(() -> scalar(c, "SELECT count(*) FROM " + table)).isInstanceOf(SQLException.class)
						.satisfies(e -> assertThat(((SQLException) e).getSQLState()).isEqualTo("42501"));
			}
			assertThatThrownBy(() -> execute(c, "DELETE FROM coach_export_v")).isInstanceOf(SQLException.class);
		}
		try (var c = open(schema)) {
			assertThat(scalar(c, "SELECT rolcanlogin FROM pg_roles WHERE rolname='coach_export_reader'")).isEqualTo("f");
		}
	}

	@Test
	void reapplyingOnAnotherSchemaInTheSameClusterIsIdempotent() throws Exception {
		migrateLatest(schema);
		String second = newSchema();
		var latest = flyway(second, "21");
		assertThat(latest.migrate().migrationsExecuted).isEqualTo(20);
		latest.validate();
		assertThat(latest.migrate().migrationsExecuted).isZero();
		try (var c = open(second)) {
			execute(c, "SET app.export_salt = 's1'");
			execute(c, "SET ROLE coach_export_reader");
			assertThat(scalarLong(c, "SELECT count(*) FROM coach_export_v")).isZero();
		}
	}

	// ---- 시드 ----

	private record Seed(long publicSong, String privateSession, String withdrawnSession) {}

	/** 사용자 A(USER) 동의 RHYTHM 11개·비동의 1개·FREE 1개, B(USER) 개인 곡 SHEET 1개, C(ADMIN) 1개, D(WITHDRAWN) 1개. */
	private Seed seed(String target) throws Exception {
		try (var c = open(target)) {
			long a = insertUser(c, "A", "USER", false);
			long b = insertUser(c, "B", "USER", false);
			long admin = insertUser(c, "C", "ADMIN", false);
			long withdrawn = insertUser(c, "탈퇴한 사용자", "USER", true);
			long s1 = scalarLong(c, "INSERT INTO songs(title,source,license) VALUES('공용곡','BUILTIN','CC0') RETURNING id");
			long s2 = scalarLong(c, "INSERT INTO songs(owner_id,title,source) VALUES(" + b + ",'개인곡','MIDI') RETURNING id");
			long v1 = version(c, s1, "NORMAL", "BUILTIN");
			long v2 = version(c, s2, "HARD", "MIDI_RULE");

			for (int i = 1; i <= 11; i++) {
				insertSession(c, id(i), a, "RHYTHM", true, i, s1, v1, null);
				perfect(c, id(i));
			}
			insertSession(c, id(20), a, "RHYTHM", false, 20, s1, v1, null);
			perfect(c, id(20));
			insertSession(c, id(21), a, "FREE", true, 21, null, null, null);
			execute(c, "INSERT INTO hits(play_session_id,seq,t_ms,pad,velocity) VALUES('" + id(21) + "',0,1,'SNARE',80)");
			insertSession(c, id(30), admin, "RHYTHM", true, 1, s1, v1, null);
			perfect(c, id(30));

			String privateSession = id(40);
			insertSession(c, privateSession, b, "SHEET", true, 1, s2, v2, null);
			execute(c, "UPDATE play_sessions SET input_source='STICK' WHERE id='" + privateSession + "'");
			perfect(c, privateSession);
			execute(c, "INSERT INTO hits(play_session_id,seq,t_ms,pad,judgement,matched_note_id) VALUES('" + privateSession + "',1,200,'KICK','MISS','n2')");
			execute(c, "INSERT INTO hits(play_session_id,seq,t_ms,stick_id,pad,velocity) VALUES('" + privateSession + "',2,300,1,'HIHAT_PEDAL',70)");

			String withdrawnSession = id(50);
			insertSession(c, withdrawnSession, withdrawn, "RHYTHM", true, 1, s1, v1, "2026-10-28T15:30:00Z");
			perfect(c, withdrawnSession);
			return new Seed(s1, privateSession, withdrawnSession);
		}
	}

	private long insertUser(Connection c, String nickname, String role, boolean withdrawn) throws SQLException {
		return scalarLong(c, "INSERT INTO users(nickname,role,status,withdrawn_at) VALUES('" + nickname + "','" + role + "','"
				+ (withdrawn ? "WITHDRAWN" : "ACTIVE") + "'," + (withdrawn ? "now()" : "NULL") + ") RETURNING id");
	}

	private long version(Connection c, long song, String difficulty, String generator) throws SQLException {
		long chart = scalarLong(c, "INSERT INTO charts(song_id,difficulty) VALUES(" + song + ",'" + difficulty + "') RETURNING id");
		return scalarLong(c, "INSERT INTO chart_versions(chart_id,version,notes,timing,notation_status,note_count,generator) "
				+ "VALUES(" + chart + ",1,'[]','{}','PENDING',0,'" + generator + "') RETURNING id");
	}

	/** endedMinute가 클수록 최근이다. FREE면 곡·버전·판정 조건 없이 넣는다. */
	private void insertSession(Connection c, String id, long user, String mode, boolean consent, int endedMinute,
			Long song, Long version, String createdAt) throws SQLException {
		boolean free = "FREE".equals(mode) || "TEMPO".equals(mode);
		String ended = "timestamptz '2026-10-29T00:00:00Z' + interval '" + endedMinute + " minutes'";
		execute(c, "INSERT INTO play_sessions(id,user_id,song_id,chart_version_id,mode,input_source,judgement_context,consent,"
				+ "payload_schema_version,payload_hash,started_at,ended_at,created_at) VALUES('" + id + "'," + user + ","
				+ (free ? "NULL,NULL" : song + "," + version) + ",'" + mode + "','KEYBOARD',"
				+ (free ? "NULL" : "'" + CONTEXT + "'") + "," + consent + ",1,'" + HASH + "'," + ended + "," + ended + ","
				+ (createdAt == null ? "now()" : "'" + createdAt + "'") + ")");
	}

	private void perfect(Connection c, String session) throws SQLException {
		execute(c, "INSERT INTO hits(play_session_id,seq,t_ms,stick_id,pad,velocity,peak_accel,judgement,matched_note_id,delta_ms) "
				+ "VALUES('" + session + "',0,100,0,'SNARE',80,1.5,'PERFECT','n1',2.5)");
	}

	// ---- 도우미 ----

	private static String id(int n) {
		return String.format("00000000-0000-0000-0000-%012d", n);
	}

	private static String key(String sessionId, String salt) throws Exception {
		var digest = MessageDigest.getInstance("SHA-256").digest((sessionId + salt).getBytes(StandardCharsets.UTF_8));
		return HexFormat.of().formatHex(digest);
	}

	private Set<String> keys(Connection c) throws SQLException {
		var keys = new HashSet<String>();
		try (var st = c.createStatement(); var rows = st.executeQuery("SELECT DISTINCT session_key FROM coach_export_v")) {
			while (rows.next()) keys.add(rows.getString(1));
		}
		return keys;
	}

	private String newSchema() {
		String name = "ce_" + UUID.randomUUID().toString().replace("-", "");
		schemas.add(name);
		return name;
	}

	private void migrateLatest(String target) {
		flyway(target, "21").migrate();
	}

	private Flyway flyway(String target, String version) {
		return Flyway.configure().dataSource(dataSource).locations("classpath:db/test-migration")
				.schemas(target).defaultSchema(target).target(version).load();
	}

	/** 풀과 세션 상태를 공유하지 않는 전용 연결. */
	private Connection open(String target) throws SQLException {
		var pool = (HikariDataSource) dataSource;
		var c = DriverManager.getConnection(pool.getJdbcUrl(), pool.getUsername(), pool.getPassword());
		c.setSchema(target);
		return c;
	}

	private static void execute(Connection c, String sql) throws SQLException {
		try (var st = c.createStatement()) {
			st.execute(sql);
		}
	}

	private static String scalar(Connection c, String sql) throws SQLException {
		try (var st = c.createStatement(); var rows = st.executeQuery(sql)) {
			assertThat(rows.next()).isTrue();
			return rows.getString(1);
		}
	}

	private static long scalarLong(Connection c, String sql) throws SQLException {
		return Long.parseLong(scalar(c, sql));
	}
}
