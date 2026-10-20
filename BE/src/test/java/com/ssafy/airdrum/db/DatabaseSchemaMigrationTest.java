package com.ssafy.airdrum.db;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.UUID;
import javax.sql.DataSource;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 공통 임베디드 PostgreSQL에서 매 검사마다 격리된 실제 Flyway 스키마를 사용한다. */
@SpringBootTest
class DatabaseSchemaMigrationTest {

	private static final String PLAY = "00000000-0000-0000-0000-000000000001";
	private static final String ATTEMPT = "00000000-0000-0000-0000-000000000002";
	private static final String HASH = "a".repeat(64);

	@Autowired
	private DataSource dataSource;
	private String schema;
	private Connection connection;

	@BeforeEach
	void prepare() throws Exception {
		schema = "db97_" + UUID.randomUUID().toString().replace("-", "");
	}

	@AfterEach
	void clean() throws Exception {
		if (connection != null) {
			connection.close();
		}
		if (!schema.matches("db97_[a-f0-9]{32}")) {
			throw new IllegalArgumentException("테스트 전용 스키마만 삭제합니다");
		}
		try (var c = dataSource.getConnection(); var s = c.createStatement()) {
			s.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
		}
	}

	@Test
	void upgradesV2WithoutChangingExistingRowsOrHistoryAndCanRunAgain() throws Exception {
		assertThat(flyway("2").migrate().migrationsExecuted).isEqualTo(2);
		connect();
		seedV2();
		String history = scalar("SELECT string_agg(version || ':' || checksum, ',' ORDER BY installed_rank) FROM flyway_schema_history");
		var migration = flyway("7");
		assertThat(migration.migrate().migrationsExecuted).isEqualTo(5);
		assertThat(scalar("SELECT string_agg(version || ':' || checksum, ',' ORDER BY installed_rank) FROM flyway_schema_history WHERE version IN ('1','2')"))
				.isEqualTo(history);
		assertThat(scalar("SELECT nickname FROM users WHERE id=1")).isEqualTo("기존 회원");
		assertThat(scalar("SELECT provider_user_id FROM social_accounts")).isEqualTo("existing-sub");
		assertThat(scalar("SELECT notes->0->>'noteId' FROM chart_versions")).isEqualTo("n1");
		assertThat(scalar("SELECT title FROM songs WHERE id=1")).isEqualTo("기존 곡");
		seedNewTables();
		migration.validate();
		assertThat(migration.migrate().migrationsExecuted).isZero();
		assertThat(scalar("SELECT count(*) FROM hits")).isEqualTo("2");
		assertThat(scalar("SELECT receipt->>'accepted' FROM chart_job_results")).isEqualTo("true");
		assertThat(scalar("SELECT count(*) FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE'"))
				.isEqualTo("16"); // 도메인 15개 + Flyway 이력
	}

	@Test
	void freshInstallEnforcesChecksIncludingSqlNullAndNonFiniteNumbers() throws Exception {
		fresh();
		String[] invalidUpdates = {
				"UPDATE kit_presets SET name=' '",
				"UPDATE kit_presets SET layout='[]'",
				"UPDATE kit_presets SET sounds='null'",
				"UPDATE kit_presets SET tuning='[]'",
				"UPDATE kit_presets SET schema_version=0",
				"UPDATE chart_jobs SET status='CANCELLED'",
				"UPDATE chart_jobs SET status='DONE',finished_at=now(),progress=99",
				"UPDATE chart_jobs SET progress=101",
				"UPDATE chart_jobs SET revision=-1",
				"UPDATE chart_jobs SET request_hash='bad'",
				"UPDATE chart_jobs SET resume_stage='NOTATING'",
				"UPDATE chart_jobs SET separation_retry_count=-1",
				"UPDATE chart_job_attempts SET heartbeat_seq=-1",
				"UPDATE chart_job_attempts SET assigned_files='{}'",
				"UPDATE chart_job_attempts SET lease_expires_at=created_at",
				"UPDATE chart_job_results SET receipt='null'",
				"UPDATE file_cleanup_tasks SET status='DELETED'",
				"UPDATE file_cleanup_tasks SET retry_count=-1",
				"UPDATE file_cleanup_tasks SET job_id=NULL",
				"UPDATE play_sessions SET mode='FREE'",
				"UPDATE play_sessions SET chart_version_id=NULL",
				"UPDATE play_sessions SET judgement_context='null'",
				"UPDATE play_sessions SET accuracy=100.01",
				"UPDATE play_sessions SET accuracy='NaN'",
				"UPDATE play_sessions SET ended_at=started_at-interval '1 second'",
				"UPDATE play_sessions SET raw_log_status='UPLOADED'",
				"UPDATE play_sessions SET payload_schema_version=0",
				"UPDATE hits SET t_ms='NaN'",
				"UPDATE hits SET delta_ms='Infinity' WHERE judgement='PERFECT'",
				"UPDATE hits SET pitch='-Infinity' WHERE judgement='PERFECT'",
				"UPDATE hits SET velocity=128 WHERE judgement='PERFECT'",
				"UPDATE hits SET velocity=NULL WHERE judgement='PERFECT'",
				"UPDATE hits SET velocity=1 WHERE judgement='MISS'",
				"UPDATE hits SET matched_note_id=NULL WHERE judgement='MISS'",
				"UPDATE hits SET judgement=NULL WHERE judgement='PERFECT'",
				"UPDATE reports SET pad_stats='1'",
				"UPDATE reports SET timing_histogram='null'",
				"UPDATE recordings SET duration_ms=-1",
				"UPDATE telemetry_events SET battery_pct=101",
				"UPDATE telemetry_events SET packet_loss='NaN'",
				"UPDATE telemetry_events SET tags='[]'"
		};
		for (String sql : invalidUpdates) {
			reject(sql, "23514");
		}
		// SQL NULL의 삼값 논리로 잘못된 자유 타격이 통과하지 않도록 확인한다.
		reject("INSERT INTO hits(play_session_id,seq,t_ms,pad) VALUES ('" + PLAY + "',9,0,'SNARE')", "23514");
		execute("INSERT INTO hits(play_session_id,seq,t_ms,pad,velocity) VALUES ('" + PLAY + "',3,-1.25,'SNARE',0)");
		assertThat(scalar("SELECT t_ms FROM hits WHERE seq=3")).isEqualTo("-1.25");
		execute("UPDATE play_sessions SET raw_log_status='UPLOADED',raw_log_key='raw/log.gz'");
		execute("UPDATE reports SET timing_histogram='[]',pad_stats='{}'");
	}

	@Test
	void preventsDuplicatePresetsSessionsNotesAndJobReceipts() throws Exception {
		fresh();
		reject("INSERT INTO kit_presets(user_id,name,layout,sounds) VALUES (1,'기본','{}','{}')", "23505");
		reject("INSERT INTO kit_presets(user_id,name,is_default,layout,sounds) VALUES (1,'또 다른 기본',true,'{}','{}')", "23505");
		reject("INSERT INTO chart_jobs(song_id,user_id,idempotency_key,request_hash) VALUES(1,1,'second','" + HASH + "')", "23505");
		execute("UPDATE chart_jobs SET status='DONE',progress=100,finished_at=now()");
		reject("INSERT INTO chart_jobs(song_id,user_id,idempotency_key,request_hash) VALUES(1,1,'upload-1','" + HASH + "')", "23505");
		execute("INSERT INTO chart_jobs(song_id,user_id,idempotency_key,request_hash) VALUES(1,1,'next','" + HASH + "')");
		reject("INSERT INTO chart_job_attempts(id,job_id,worker_id,claim_request_id,lease_expires_at) VALUES(gen_random_uuid(),1,'worker','00000000-0000-0000-0000-000000000003',now()+interval '1 minute')", "23505");
		reject("INSERT INTO chart_job_results(result_id,job_id,attempt_id,stage,payload_hash,receipt) VALUES(gen_random_uuid(),1,'" + ATTEMPT + "','SEPARATING','" + HASH + "','{}')", "23505");
		reject("INSERT INTO hits(play_session_id,seq,t_ms,pad,velocity) VALUES('" + PLAY + "',0,0,'SNARE',1)", "23505");
		reject("INSERT INTO hits(play_session_id,seq,t_ms,pad,judgement,matched_note_id) VALUES('" + PLAY + "',4,10,'SNARE','MISS','n1')", "23505");
		reject("INSERT INTO reports(play_session_id,timing_histogram,pad_stats,generator_version) VALUES('" + PLAY + "','{}','[]','v1')", "23505");
		reject("INSERT INTO recordings(user_id,play_session_id,title) VALUES(1,'" + PLAY + "','중복')", "23505");
		reject("INSERT INTO file_cleanup_tasks(object_key,file_role) VALUES('temp/source','SOURCE')", "23505");
	}

	@Test
	void rejectsCrossJobAttemptReferencesAndRetainsCleanupEvidence() throws Exception {
		fresh();
		execute("INSERT INTO users(nickname) VALUES('다른 회원')");
		execute("INSERT INTO chart_jobs(song_id,user_id,idempotency_key,request_hash) VALUES(1,2,'other','" + HASH + "')");
		reject("UPDATE chart_jobs SET current_attempt_id='" + ATTEMPT + "' WHERE id=2", "23503");
		reject("INSERT INTO chart_job_results(result_id,job_id,attempt_id,stage,payload_hash,receipt) VALUES(gen_random_uuid(),2,'" + ATTEMPT + "','TRANSCRIBING','" + HASH + "','{}')", "23503");
		reject("UPDATE file_cleanup_tasks SET job_id=2", "23503");
		reject("DELETE FROM chart_job_attempts", "23503");
		execute("UPDATE file_cleanup_tasks SET status='FAILED',retry_count=1,last_error='timeout'");
		assertThat(scalar("SELECT object_key FROM file_cleanup_tasks")).isEqualTo("temp/source");
		execute("UPDATE file_cleanup_tasks SET status='DELETED',deleted_at=now()");
		assertThat(scalar("SELECT object_key FROM file_cleanup_tasks")).isEqualTo("temp/source");
		// DB 접수에 실패한 업로드의 객체도 정리 큐에 남길 수 있다.
		execute("INSERT INTO file_cleanup_tasks(object_key,file_role) VALUES('orphan/key','STAGING')");
	}

	@Test
	void deletionPreservesSnapshotsAndRecordingsButCascadesSessionChildren() throws Exception {
		fresh();
		reject("DELETE FROM users WHERE id=1", "23503");
		reject("DELETE FROM songs WHERE id=1", "23503");
		reject("DELETE FROM chart_versions WHERE id=1", "23503");
		execute("DELETE FROM kit_presets");
		assertThat(scalar("SELECT kit_preset_id IS NULL FROM play_sessions")).isEqualTo("t");
		assertThat(scalar("SELECT kit_preset_snapshot->>'name' FROM play_sessions")).isEqualTo("기본");
		execute("DELETE FROM play_sessions");
		assertThat(scalar("SELECT count(*) FROM hits")).isEqualTo("0");
		assertThat(scalar("SELECT count(*) FROM reports")).isEqualTo("0");
		assertThat(scalar("SELECT play_session_id IS NULL FROM recordings")).isEqualTo("t");
		assertThat(scalar("SELECT count(*) FROM telemetry_events")).isEqualTo("1");
		// 회원의 물리 삭제가 가능한 경우에만 프리셋·녹음 CASCADE가 작동한다.
		execute("INSERT INTO users(nickname) VALUES('삭제 회원')");
		execute("INSERT INTO kit_presets(user_id,name,layout,sounds) VALUES(2,'개인','{}','{}')");
		execute("INSERT INTO recordings(user_id,title) VALUES(2,'개인 녹음')");
		execute("DELETE FROM users WHERE id=2");
		assertThat(scalar("SELECT count(*) FROM kit_presets")).isEqualTo("0");
		assertThat(scalar("SELECT count(*) FROM recordings WHERE user_id=2")).isEqualTo("0");
	}

	private void fresh() throws Exception {
		assertThat(flyway("7").migrate().migrationsExecuted).isEqualTo(7);
		connect();
		seedV2();
		seedNewTables();
	}

	private void seedV2() throws Exception {
		execute("""
				INSERT INTO users(nickname) VALUES('기존 회원');
				INSERT INTO social_accounts(user_id,provider,provider_user_id) VALUES(1,'GOOGLE','existing-sub');
				INSERT INTO songs(owner_id,title,source) VALUES(1,'기존 곡','AUDIO');
				INSERT INTO charts(song_id,difficulty) VALUES(1,'NORMAL');
				INSERT INTO chart_versions(chart_id,version,notes,timing,notation_status,note_count,generator)
				  VALUES(1,1,'[{"noteId":"n1","timeMs":1}]','{}','UNAVAILABLE',1,'ADT_MODEL');
				""");
	}

	private void seedNewTables() throws Exception {
		execute("""
				INSERT INTO kit_presets(user_id,name,is_default,layout,sounds) VALUES(1,'기본',true,'{}','{}');
				INSERT INTO chart_jobs(song_id,user_id,idempotency_key,request_hash) VALUES(1,1,'upload-1','%s');
				INSERT INTO chart_job_attempts(id,job_id,worker_id,claim_request_id,lease_expires_at)
				  VALUES('%s',1,'worker','00000000-0000-0000-0000-000000000003',now()+interval '1 minute');
				UPDATE chart_jobs SET current_attempt_id='%s',status='SEPARATING';
				INSERT INTO chart_job_results(result_id,job_id,attempt_id,stage,payload_hash,receipt)
				  VALUES('00000000-0000-0000-0000-000000000004',1,'%s','SEPARATING','%s','{"accepted":true}');
				INSERT INTO file_cleanup_tasks(object_key,file_role,user_id,job_id,attempt_id)
				  VALUES('temp/source','SOURCE',1,1,'%s');
				INSERT INTO play_sessions(id,user_id,song_id,chart_version_id,mode,input_source,kit_preset_id,
				  kit_preset_snapshot,judgement_context,payload_schema_version,payload_hash,started_at,ended_at)
				  VALUES('%s',1,1,1,'RHYTHM','KEYBOARD',1,'{"name":"기본"}','{}',1,'%s',now(),now());
				INSERT INTO hits(play_session_id,seq,t_ms,pad,velocity,judgement,matched_note_id,delta_ms)
				  VALUES('%s',0,1.25,'SNARE',100,'PERFECT','n1',0.25);
				INSERT INTO hits(play_session_id,seq,t_ms,pad,judgement,matched_note_id)
				  VALUES('%s',1,3,'SNARE','MISS','n2');
				INSERT INTO reports(play_session_id,timing_histogram,pad_stats,generator_version)
				  VALUES('%s','{}','[]','v1');
				INSERT INTO recordings(user_id,play_session_id,title) VALUES(1,'%s','녹음');
				INSERT INTO telemetry_events(time,session_id,user_id,kind) VALUES(now(),gen_random_uuid(),999,'STATUS');
				""".formatted(HASH, ATTEMPT, ATTEMPT, ATTEMPT, HASH, ATTEMPT, PLAY, HASH, PLAY, PLAY, PLAY, PLAY));
	}

	private Flyway flyway(String target) {
		return Flyway.configure().dataSource(dataSource).locations("classpath:db/migration")
				.schemas(schema).defaultSchema(schema).target(target).load();
	}

	private void connect() throws Exception {
		connection = dataSource.getConnection();
		connection.setSchema(schema);
	}

	private void execute(String sql) throws SQLException {
		try (var statement = connection.createStatement()) {
			statement.execute(sql);
		}
	}

	private String scalar(String sql) throws SQLException {
		try (var statement = connection.createStatement(); var rows = statement.executeQuery(sql)) {
			assertThat(rows.next()).isTrue();
			return rows.getString(1);
		}
	}

	private void reject(String sql, String state) {
		assertThatThrownBy(() -> execute(sql)).as(sql).isInstanceOfSatisfying(SQLException.class,
				error -> assertThat(error.getSQLState()).isEqualTo(state));
	}
}
