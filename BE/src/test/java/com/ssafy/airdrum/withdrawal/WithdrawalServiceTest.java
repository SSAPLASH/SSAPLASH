package com.ssafy.airdrum.withdrawal;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.event.EventListener;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import com.ssafy.airdrum.auth.RefreshTokenService;
import com.ssafy.airdrum.auth.RefreshTokenService.Rotation.Outcome;
import com.ssafy.airdrum.auth.RefreshTokenStore;
import com.ssafy.airdrum.preset.KitPreset;
import com.ssafy.airdrum.preset.KitPresetRepository;
import com.ssafy.airdrum.user.AuthUser;
import com.ssafy.airdrum.user.SocialAccount;
import com.ssafy.airdrum.user.SocialAccountRepository;
import com.ssafy.airdrum.user.SocialProvider;
import com.ssafy.airdrum.user.User;
import com.ssafy.airdrum.user.UserNotActiveException;
import com.ssafy.airdrum.user.UserRepository;
import com.ssafy.airdrum.user.UserStatus;
import com.ssafy.airdrum.user.UserWithdrawnEvent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.reset;

/**
 * 탈퇴 설계 4장 흐름 A·B, 인수 조건 3·4·6·9. 이벤트가 커밋 뒤에만 리스너에 닿는지 보려면 실제로 커밋해야 하므로
 * 테스트 트랜잭션을 쓰지 않고, 만든 행은 직접 지운다.
 */
@SpringBootTest
class WithdrawalServiceTest {

	private static final String LAYOUT = "{\"SNARE\":{\"x\":0.42,\"y\":0.68,\"r\":0.095}}";
	private static final String SOUNDS = "{\"soundSetId\":\"ssaplash\"}";

	@Autowired
	private WithdrawalService withdrawals;

	@Autowired
	private UserRepository users;

	@Autowired
	private SocialAccountRepository socialAccounts;

	@Autowired
	private KitPresetRepository presets;

	@Autowired
	private RefreshTokenService refreshTokens;

	@MockitoSpyBean
	private RefreshTokenStore refreshStore;

	@Autowired
	private EventRecorder events;

	@Autowired
	private JdbcTemplate jdbc;

	private final List<Long> created = new ArrayList<>();

	/** 회원 번호가 없는 텔레메트리 행을 구분하는 세션. 탈퇴는 이 행을 지우지 않는다. */
	private static final String ANONYMOUS_SESSION = "00000000-0000-0000-0000-0000000258aa";

	@BeforeEach
	void resetRecorder() {
		events.committed.clear();
		events.failInTransaction = false;
	}

	@AfterEach
	void cleanUp() {
		reset(refreshStore);
		jdbc.update("delete from telemetry_events where session_id = ?::uuid", ANONYMOUS_SESSION);
		for (var id : created) {
			jdbc.update("delete from recordings where user_id = ?", id);
			jdbc.update("delete from telemetry_events where user_id = ?", id);
			jdbc.update("delete from telemetry_session_conditions where user_id = ?", id);
			jdbc.update("delete from kit_presets where user_id = ?", id);
			jdbc.update("delete from social_accounts where user_id = ?", id);
			jdbc.update("delete from users where id = ?", id);
		}
	}

	@Test
	void withdrawCommitsStateRemovesOwnedDataAndPublishesOnceAfterCommit() {
		var user = memberWithData("g-withdraw");
		var other = memberWithData("g-bystander");
		jdbc.update("INSERT INTO telemetry_events(time,session_id,user_id,kind) VALUES(now(),?::uuid,NULL,'STATUS')", ANONYMOUS_SESSION);
		var token = refreshTokens.issue(new AuthUser(user.getId(), user.getRole()));

		withdrawals.withdraw(user.getId());

		var found = users.findById(user.getId()).orElseThrow();
		assertThat(found.getStatus()).isEqualTo(UserStatus.WITHDRAWN);
		assertThat(found.getWithdrawnAt()).isNotNull();
		assertThat(socialAccounts.findByUserIdOrderByConnectedAtAsc(user.getId())).isEmpty();
		assertThat(presets.countByUserId(user.getId())).isZero();
		// 257 U7: 살아 있는 녹음·지운 녹음 모두 탈퇴 트랜잭션에서 지운다
		assertThat(recordings(user.getId())).isZero();
		// 258: 그 회원의 텔레메트리도 탈퇴 트랜잭션에서 지운다. 259: 측정 조건 행도 같다
		assertThat(telemetry(user.getId())).isZero();
		assertThat(conditions(user.getId())).isZero();
		assertThat(refreshTokens.rotate(token).outcome()).isEqualTo(Outcome.UNKNOWN);
		assertThat(events.committed).containsExactly(user.getId());
		// 다른 회원 데이터는 그대로
		assertThat(socialAccounts.findByUserIdOrderByConnectedAtAsc(other.getId())).hasSize(1);
		assertThat(presets.countByUserId(other.getId())).isEqualTo(1);
		assertThat(recordings(other.getId())).isEqualTo(2);
		assertThat(telemetry(other.getId())).isEqualTo(2);
		assertThat(conditions(other.getId())).isEqualTo(1);
		// 258: user_id가 NULL인 행은 탈퇴와 무관하다
		assertThat(jdbc.queryForObject("SELECT count(*) FROM telemetry_events WHERE session_id = ?::uuid AND user_id IS NULL",
				Integer.class, ANONYMOUS_SESSION)).isEqualTo(1);
	}

	@Test
	void alreadyWithdrawnIsRejectedWithoutSecondEvent() {
		var user = memberWithData("g-twice");
		withdrawals.withdraw(user.getId());

		assertThatThrownBy(() -> withdrawals.withdraw(user.getId())).isInstanceOf(UserNotActiveException.class);
		assertThat(events.committed).containsExactly(user.getId());
	}

	@Test
	void rolledBackWithdrawalDoesNotReachAfterCommitListener() {
		var user = memberWithData("g-rollback");
		events.failInTransaction = true;

		assertThatThrownBy(() -> withdrawals.withdraw(user.getId())).isInstanceOf(IllegalStateException.class)
				.hasMessage("롤백 유도");

		assertThat(events.committed).isEmpty();
		assertThat(users.findById(user.getId()).orElseThrow().getStatus()).isEqualTo(UserStatus.ACTIVE);
		assertThat(socialAccounts.findByUserIdOrderByConnectedAtAsc(user.getId())).hasSize(1);
		assertThat(presets.countByUserId(user.getId())).isEqualTo(1);
		assertThat(recordings(user.getId())).isEqualTo(2);
		assertThat(telemetry(user.getId())).isEqualTo(2);
		assertThat(conditions(user.getId())).isEqualTo(1);
	}

	@Test
	void refreshStoreFailureDoesNotBlockWithdrawal() {
		var user = memberWithData("g-redis-down");
		var token = refreshTokens.issue(new AuthUser(user.getId(), user.getRole()));
		doThrow(new QueryTimeoutException("Redis command timed out")).when(refreshStore).revokeAll(anyLong());

		withdrawals.withdraw(user.getId());

		assertThat(users.findById(user.getId()).orElseThrow().getStatus()).isEqualTo(UserStatus.WITHDRAWN);
		assertThat(events.committed).containsExactly(user.getId());
		// 남은 토큰은 회원 상태 검사로 거절된다
		assertThat(refreshTokens.rotate(token).outcome()).isEqualTo(Outcome.INACTIVE);
	}

	@Test
	void concurrentWithdrawalsSucceedOnceAndPublishOnce() throws Exception {
		var user = memberWithData("g-race");
		// 먼저 잠금을 쥔 쪽이 커밋 전에 머물러 두 요청이 확실히 겹치게 한다
		doAnswer(invocation -> {
			Thread.sleep(300);
			return invocation.callRealMethod();
		}).when(refreshStore).revokeAll(anyLong());

		var start = new CountDownLatch(1);
		var errors = new CopyOnWriteArrayList<Throwable>();
		try (var pool = Executors.newFixedThreadPool(2)) {
			var futures = new ArrayList<Future<?>>();
			for (int i = 0; i < 2; i++) {
				futures.add(pool.submit(() -> {
					start.await();
					try {
						withdrawals.withdraw(user.getId());
					}
					catch (RuntimeException ex) {
						errors.add(ex);
					}
					return null;
				}));
			}
			start.countDown();
			for (var future : futures) {
				future.get(10, TimeUnit.SECONDS);
			}
		}

		assertThat(errors).singleElement().isInstanceOf(UserNotActiveException.class);
		assertThat(events.committed).containsExactly(user.getId());
	}

	private User memberWithData(String providerUserId) {
		var user = users.save(User.create("드러머", "drummer@example.com", null));
		created.add(user.getId());
		socialAccounts.save(SocialAccount.connect(user, SocialProvider.GOOGLE, providerUserId, null));
		presets.save(KitPreset.create(user.getId(), "연습용", LAYOUT, SOUNDS, 1));
		// 녹음: 살아 있는 것 하나, 지운 것 하나
		for (String deleted : new String[] {"NULL", "now()"})
			jdbc.update("INSERT INTO recordings(user_id,title,client_key,mode,input_source,schema_version,started_at,duration_ms,hit_count,hits,payload_hash,deleted_at) "
					+ "VALUES(?,'녹음',gen_random_uuid(),'FREE','KEYBOARD',1,now(),1,1,'[{\"tMs\":0,\"pad\":\"SNARE\",\"velocity\":1}]',?," + deleted + ")",
					user.getId(), "d".repeat(64));
		// 텔레메트리: 타격·상태 이벤트 하나씩(임베디드 PG에서는 hypertable이 아닌 일반 테이블)
		for (String kind : new String[] {"HIT", "STATUS"})
			jdbc.update("INSERT INTO telemetry_events(time,session_id,user_id,kind) VALUES(now(),gen_random_uuid(),?,?)", user.getId(), kind);
		// 259 측정 조건: 세션 하나
		jdbc.update("INSERT INTO telemetry_session_conditions(user_id,session_id,sensor_mount,received_at) VALUES(?,gen_random_uuid(),'GRIP_FRONT',now())",
				user.getId());
		return user;
	}

	private int telemetry(long userId) {
		return jdbc.queryForObject("SELECT count(*) FROM telemetry_events WHERE user_id = ?", Integer.class, userId);
	}

	private int conditions(long userId) {
		return jdbc.queryForObject("SELECT count(*) FROM telemetry_session_conditions WHERE user_id = ?", Integer.class, userId);
	}

	private int recordings(long userId) {
		return jdbc.queryForObject("SELECT count(*) FROM recordings WHERE user_id = ?", Integer.class, userId);
	}

	@TestConfiguration
	static class Config {

		@Bean
		EventRecorder eventRecorder() {
			return new EventRecorder();
		}

	}

	static class EventRecorder {

		final List<Long> committed = new CopyOnWriteArrayList<>();
		volatile boolean failInTransaction;

		@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
		void afterCommit(UserWithdrawnEvent event) {
			committed.add(event.userId());
		}

		/** 트랜잭션 안에서 바로 호출된다. 예외를 던지면 탈퇴 트랜잭션이 롤백된다. */
		@EventListener
		void inTransaction(UserWithdrawnEvent event) {
			if (failInTransaction) {
				throw new IllegalStateException("롤백 유도");
			}
		}

	}

}
