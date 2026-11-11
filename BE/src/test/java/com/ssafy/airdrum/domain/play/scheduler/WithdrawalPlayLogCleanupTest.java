package com.ssafy.airdrum.domain.play.scheduler;

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
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.transaction.PlatformTransactionManager;

import com.ssafy.airdrum.domain.withdrawal.service.WithdrawalService;
import com.ssafy.airdrum.domain.play.storage.PlayRawStore;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 탈퇴 회원의 세션은 동의 여부와 관계없이 {@link WithdrawnPlayCleanup}이 지우고, 고아가 된 원본 객체는
 * {@link RawLogCleanupWorker}가 회수한다(229). 실제 커밋이 필요해 테스트 트랜잭션을 쓰지 않는다.
 */
@SpringBootTest
class WithdrawalPlayLogCleanupTest {

	private static final Logger log = LoggerFactory.getLogger(WithdrawalPlayLogCleanupTest.class);

	private static final String HASH = "a".repeat(64);

	@Autowired
	private WithdrawalService withdrawals;

	@Autowired
	private WithdrawnPlayCleanup cleanup;

	@Autowired
	private PlatformTransactionManager manager;

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
	void withdrawalKeepsSessionsUntilCleanupRuns() {
		var user = member();
		var play = session(user, true, 3, false);

		withdrawals.withdraw(user);

		assertThat(count("SELECT count(*) FROM play_sessions WHERE id = ?", play)).isEqualTo(1);
	}

	@Test
	void sessionsAreDeletedWhetherConsentedOrNotAndRawObjectsAreReclaimed() {
		var user = member();
		var consented = session(user, true, 3, true);
		var nonConsented = session(user, false, 2, true);
		var keys = List.of(rawKey(user, consented), rawKey(user, nonConsented));

		withdrawals.withdraw(user);
		assertThat(cleanup.runOnce()).isEqualTo(2);

		for (var play : List.of(consented, nonConsented)) {
			assertThat(count("SELECT count(*) FROM play_sessions WHERE id = ?", play)).isZero();
			assertThat(count("SELECT count(*) FROM hits WHERE play_session_id = ?", play)).isZero();
			assertThat(count("SELECT count(*) FROM reports WHERE play_session_id = ?", play)).isZero();
		}
		// 접수 기록은 고아 정리 근거로 남고 세션 참조만 NULL이다
		for (var key : keys) {
			assertThat(db.queryForObject("SELECT status FROM play_raw_uploads WHERE object_key = ?", String.class, key))
					.isEqualTo("ACCEPTED");
		}
		assertThat(objects).containsAll(keys);

		worker.runOnce();

		for (var key : keys) {
			assertThat(db.queryForObject("SELECT status FROM play_raw_uploads WHERE object_key = ?", String.class, key))
					.isEqualTo("RETIRED");
			assertThat(db.queryForObject("SELECT status FROM file_cleanup_tasks WHERE object_key = ?", String.class, key))
					.isEqualTo("DELETED");
		}
		assertThat(objects).doesNotContainAnyElementsOf(keys);
	}

	@Test
	void activeMembersSessionsAreUntouched() {
		var user = member();
		var other = member();
		var otherPlay = session(other, true, 2, true);

		withdrawals.withdraw(user);
		cleanup.runOnce();
		worker.runOnce();

		assertThat(count("SELECT count(*) FROM play_sessions WHERE id = ?", otherPlay)).isEqualTo(1);
		assertThat(count("SELECT count(*) FROM hits WHERE play_session_id = ?", otherPlay)).isEqualTo(2);
		assertThat(objects).contains(rawKey(other, otherPlay));
	}

	@Test
	void sessionArrivingAfterWithdrawalIsDeletedToo() {
		var user = member();
		withdrawals.withdraw(user);
		var late = session(user, true, 1, false);

		cleanup.runOnce();

		assertThat(count("SELECT count(*) FROM play_sessions WHERE id = ?", late)).isZero();
	}

	/** 세션이 많아도 탈퇴는 세션을 지우지 않아 빨리 끝나고, 삭제는 여러 묶음에 걸쳐 끝까지 간다. */
	@Test
	void manySessionsAreDeletedAcrossBatchesWithoutSlowingWithdrawal() {
		var user = member();
		for (int i = 0; i < 50; i++) {
			session(user, true, 100, false);
		}

		long started = System.nanoTime();
		withdrawals.withdraw(user);
		long elapsedMs = (System.nanoTime() - started) / 1_000_000;
		log.info("세션 50개·hits 5,000행 회원 탈퇴 소요 {}ms", elapsedMs);
		assertThat(elapsedMs).isLessThan(15_000);

		var smallBatches = new WithdrawnPlayCleanup(db, manager, true, 7);
		assertThat(smallBatches.runOnce()).isEqualTo(50);
		assertThat(count("SELECT count(*) FROM play_sessions WHERE user_id = ?", user)).isZero();
	}

	@Test
	void disabledCleanupDeletesNothing() {
		var user = member();
		var play = session(user, true, 1, false);
		withdrawals.withdraw(user);

		new WithdrawnPlayCleanup(db, manager, false, 20).scheduled();

		assertThat(count("SELECT count(*) FROM play_sessions WHERE id = ?", play)).isEqualTo(1);
	}

	/** 실패는 다음 주기로 넘기고 예외를 밖으로 내지 않는다. */
	@Test
	void failureIsSwallowedAndRetriedOnNextRun() {
		var user = member();
		var play = session(user, true, 1, false);
		withdrawals.withdraw(user);
		var broken = mock(PlatformTransactionManager.class);
		when(broken.getTransaction(any())).thenThrow(new CannotCreateTransactionException("시험"));

		assertThatCode(new WithdrawnPlayCleanup(db, broken, true, 20)::scheduled).doesNotThrowAnyException();
		assertThat(count("SELECT count(*) FROM play_sessions WHERE id = ?", play)).isEqualTo(1);

		new WithdrawnPlayCleanup(db, manager, true, 20).scheduled();
		assertThat(count("SELECT count(*) FROM play_sessions WHERE id = ?", play)).isZero();
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
