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

	@BeforeEach
	void resetRecorder() {
		events.committed.clear();
		events.failInTransaction = false;
	}

	@AfterEach
	void cleanUp() {
		reset(refreshStore);
		for (var id : created) {
			jdbc.update("delete from kit_presets where user_id = ?", id);
			jdbc.update("delete from social_accounts where user_id = ?", id);
			jdbc.update("delete from users where id = ?", id);
		}
	}

	@Test
	void withdrawCommitsStateRemovesOwnedDataAndPublishesOnceAfterCommit() {
		var user = memberWithData("g-withdraw");
		var other = memberWithData("g-bystander");
		var token = refreshTokens.issue(new AuthUser(user.getId(), user.getRole()));

		withdrawals.withdraw(user.getId());

		var found = users.findById(user.getId()).orElseThrow();
		assertThat(found.getStatus()).isEqualTo(UserStatus.WITHDRAWN);
		assertThat(found.getWithdrawnAt()).isNotNull();
		assertThat(socialAccounts.findByUserIdOrderByConnectedAtAsc(user.getId())).isEmpty();
		assertThat(presets.countByUserId(user.getId())).isZero();
		assertThat(refreshTokens.rotate(token).outcome()).isEqualTo(Outcome.UNKNOWN);
		assertThat(events.committed).containsExactly(user.getId());
		// 다른 회원 데이터는 그대로
		assertThat(socialAccounts.findByUserIdOrderByConnectedAtAsc(other.getId())).hasSize(1);
		assertThat(presets.countByUserId(other.getId())).isEqualTo(1);
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
		return user;
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
