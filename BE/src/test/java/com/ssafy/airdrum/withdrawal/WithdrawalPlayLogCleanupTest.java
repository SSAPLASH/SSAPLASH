package com.ssafy.airdrum.withdrawal;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import com.ssafy.airdrum.play.raw.PlayRawStore;
import com.ssafy.airdrum.storage.cleanup.RawLogCleanupWorker;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;

/**
 * 탈퇴 설계 3-5·4장 A 6단계, 인수 조건 11·12·13(153). 비동의 세션은 탈퇴 트랜잭션에서 지우고, 고아가 된 원본은 기존
 * {@link RawLogCleanupWorker}가 회수한다. 동의 세션은 그대로 남는다. 실제 커밋이 필요해 테스트 트랜잭션을 쓰지 않는다.
 */
@SpringBootTest
class WithdrawalPlayLogCleanupTest {

	private static final Logger log = LoggerFactory.getLogger(WithdrawalPlayLogCleanupTest.class);

	private static final String HASH = "a".repeat(64);

	@Autowired
	private WithdrawalService withdrawals;

	@Autowired
	private RawLogCleanupWorker worker;

	@Autowired
	private JdbcTemplate db;

	/** 저장소 대역: 객체 키를 메모리 집합으로 흉내 낸다. */
	@MockitoBean
	private PlayRawStore store;

	private final Set<String> objects = ConcurrentHashMap.newKeySet();

	private final List<Long> users = new ArrayList<>();

	@BeforeEach
	void storeDouble() {
		when(store.exists(anyString())).thenAnswer(i -> objects.contains(i.getArgument(0)));
		doAnswer(i -> {
			objects.remove(i.getArgument(0));
			return null;
		}).when(store).delete(anyString());
	}

	@AfterEach
	void cleanUp() {
		for (var user : users) {
			var keys = "play-raw/%/u" + user + "-%";
			db.update("DELETE FROM file_cleanup_tasks WHERE object_key LIKE ?", keys);
			db.update("DELETE FROM play_raw_uploads WHERE object_key LIKE ?", keys);
			db.update("DELETE FROM play_sessions WHERE user_id = ?", user);
			db.update("DELETE FROM users WHERE id = ?", user);
		}
	}

	@Test
	void nonConsentedSessionIsDeletedAndItsRawObjectIsReclaimed() {
		var user = member();
		var play = session(user, false, 3, true);
		var key = rawKey(user, play);

		withdrawals.withdraw(user);

		assertThat(count("SELECT count(*) FROM play_sessions WHERE id = ?", play)).isZero();
		assertThat(count("SELECT count(*) FROM hits WHERE play_session_id = ?", play)).isZero();
		assertThat(count("SELECT count(*) FROM reports WHERE play_session_id = ?", play)).isZero();
		// 접수 기록은 고아 정리 근거로 남고 세션 참조만 NULL이다
		assertThat(db.queryForObject("SELECT status FROM play_raw_uploads WHERE object_key = ?", String.class, key))
				.isEqualTo("ACCEPTED");
		assertThat(objects).contains(key);

		worker.runOnce();

		assertThat(db.queryForObject("SELECT status FROM play_raw_uploads WHERE object_key = ?", String.class, key))
				.isEqualTo("RETIRED");
		assertThat(db.queryForObject("SELECT status FROM file_cleanup_tasks WHERE object_key = ?", String.class, key))
				.isEqualTo("DELETED");
		assertThat(objects).doesNotContain(key);
	}

	@Test
	void consentedSessionIsKeptWithHitsReportAndRawObject() {
		var user = member();
		var kept = session(user, true, 3, true);
		var dropped = session(user, false, 2, false);
		var key = rawKey(user, kept);

		withdrawals.withdraw(user);
		worker.runOnce();

		assertThat(db.queryForObject("SELECT user_id FROM play_sessions WHERE id = ?", Long.class, kept)).isEqualTo(user);
		assertThat(count("SELECT count(*) FROM hits WHERE play_session_id = ?", kept)).isEqualTo(3);
		assertThat(count("SELECT count(*) FROM reports WHERE play_session_id = ?", kept)).isEqualTo(1);
		assertThat(db.queryForObject("SELECT status FROM play_raw_uploads WHERE object_key = ?", String.class, key))
				.isEqualTo("ACCEPTED");
		assertThat(objects).contains(key);
		assertThat(count("SELECT count(*) FROM play_sessions WHERE id = ?", dropped)).isZero();
	}

	@Test
	void otherMembersSessionsAreUntouched() {
		var user = member();
		var other = member();
		var otherPlay = session(other, false, 2, true);

		withdrawals.withdraw(user);
		worker.runOnce();

		assertThat(count("SELECT count(*) FROM play_sessions WHERE id = ?", otherPlay)).isEqualTo(1);
		assertThat(count("SELECT count(*) FROM hits WHERE play_session_id = ?", otherPlay)).isEqualTo(2);
		assertThat(objects).contains(rawKey(other, otherPlay));
	}

	/** 위험 1·인수 조건 13: 세션 50개·hits 5,000행 삭제가 15초 트랜잭션 제한 안에 끝난다(넘으면 타임아웃 예외). */
	@Test
	void fiftySessionsWithFiveThousandHitsFinishWithinTransactionTimeout() {
		var user = member();
		for (int i = 0; i < 50; i++) {
			session(user, false, 100, false);
		}
		assertThat(count("SELECT count(*) FROM hits h JOIN play_sessions s ON s.id = h.play_session_id WHERE s.user_id = ?",
				user)).isEqualTo(5_000);

		long started = System.nanoTime();
		withdrawals.withdraw(user);
		long elapsedMs = (System.nanoTime() - started) / 1_000_000;
		log.info("세션 50개·hits 5,000행 탈퇴 소요 {}ms", elapsedMs);

		assertThat(elapsedMs).isLessThan(15_000);
		assertThat(count("SELECT count(*) FROM play_sessions WHERE user_id = ?", user)).isZero();
	}

	private long member() {
		var id = db.queryForObject("INSERT INTO users(nickname, email) VALUES('플레이 탈퇴', 'p@example.com') RETURNING id",
				Long.class);
		users.add(id);
		return id;
	}

	/** FREE 세션 하나와 hits·리포트, 원하면 ACCEPTED 원본 접수와 저장소 객체까지 심는다. */
	private UUID session(long user, boolean consent, int hits, boolean withRaw) {
		var play = UUID.randomUUID();
		var key = withRaw ? rawKey(user, play) : null;
		db.update("""
				INSERT INTO play_sessions(id, user_id, mode, input_source, consent, raw_log_key, raw_log_status,
				  payload_schema_version, payload_hash, started_at, ended_at)
				VALUES (?, ?, 'FREE', 'STICK', ?, ?, ?, 1, ?, now() - interval '1 minute', now())
				""", play, user, consent, key, withRaw ? "UPLOADED" : "PENDING", HASH);
		db.batchUpdate("INSERT INTO hits(play_session_id, seq, t_ms, pad, velocity) VALUES (?, ?, ?, 'SNARE', 80)",
				java.util.stream.IntStream.range(0, hits).mapToObj(seq -> new Object[] { play, seq, seq * 10.0 }).toList());
		db.update("""
				INSERT INTO reports(play_session_id, timing_histogram, pad_stats, generator_version)
				VALUES (?, '[]', '[]', 'TEST')
				""", play);
		if (withRaw) {
			db.update("""
					INSERT INTO play_raw_uploads(id, original_play_id, play_session_id, object_key, payload_hash,
					  payload_bytes, status, expires_at)
					VALUES (?, ?, ?, ?, ?, 100, 'ACCEPTED', now() + interval '5 minutes')
					""", UUID.randomUUID(), play, play, key, HASH);
			objects.add(key);
		}
		return play;
	}

	private static String rawKey(long user, UUID play) {
		return "play-raw/" + play + "/u" + user + "-raw.json.gz";
	}

	private int count(String sql, Object... args) {
		return db.queryForObject(sql, Integer.class, args);
	}

}
