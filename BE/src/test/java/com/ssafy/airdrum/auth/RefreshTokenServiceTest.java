package com.ssafy.airdrum.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import com.ssafy.airdrum.auth.RefreshTokenService.Rotation.Outcome;
import com.ssafy.airdrum.user.AuthUser;
import com.ssafy.airdrum.user.UserRole;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 설계 문서(88) 3-4·3-5·4-B·4-G, 인수 조건 5·6·14: refresh 토큰 발급·회전·폐기와 동시 소비. 메모리 저장소로 확인한다. */
@ExtendWith(OutputCaptureExtension.class)
class RefreshTokenServiceTest {

	static final AuthUser ALICE = new AuthUser(1L, UserRole.USER);
	static final AuthUser BOB = new AuthUser(2L, UserRole.ADMIN);

	private final MutableClock clock = new MutableClock(Instant.parse("2026-10-21T03:00:00Z"));
	private final AuthenticationService authentication = mock(AuthenticationService.class);
	private InMemoryRefreshTokenStore store;
	private RefreshTokenService service;

	@BeforeEach
	void setUp() {
		store = new InMemoryRefreshTokenStore(clock);
		service = new RefreshTokenService(store, authentication, AuthPropertiesFixture.defaults());
		when(authentication.findActive(anyLong())).thenAnswer(invocation -> {
			long id = invocation.getArgument(0);
			return id == ALICE.id() ? Optional.of(ALICE) : id == BOB.id() ? Optional.of(BOB) : Optional.empty();
		});
	}

	@Test
	void issuedTokenIsRandomUrlSafeAndStoredOnlyAsHash() {
		var token = service.issue(ALICE);
		var other = service.issue(ALICE);

		assertThat(token).hasSize(43).matches("[A-Za-z0-9_-]{43}").isNotEqualTo(other);
		assertThat(store.consume(token)).isEmpty();
		assertThat(store.consume(sha256(token))).contains(ALICE.id());
	}

	@Test
	void rotateConsumesOnceAndIssuesNewToken() {
		var token = service.issue(ALICE);

		var rotation = service.rotate(token);

		assertThat(rotation.outcome()).isEqualTo(Outcome.ROTATED);
		assertThat(rotation.user()).isEqualTo(ALICE);
		assertThat(rotation.newToken()).hasSize(43).isNotEqualTo(token);
		assertThat(service.rotate(token).outcome()).isEqualTo(Outcome.UNKNOWN);
		assertThat(service.rotate(rotation.newToken()).outcome()).isEqualTo(Outcome.ROTATED);
	}

	@Test
	void malformedTokenIsRejectedWithoutTouchingStore() {
		var spyStore = spy(new InMemoryRefreshTokenStore(clock));
		var guarded = new RefreshTokenService(spyStore, authentication, AuthPropertiesFixture.defaults());

		for (var value : new String[] { null, "", "short", "A".repeat(42), "A".repeat(44), "+".repeat(43) }) {
			assertThat(guarded.rotate(value).outcome()).isEqualTo(Outcome.MALFORMED);
			guarded.revoke(value);
		}
		verifyNoInteractions(spyStore);
	}

	@Test
	void inactiveUserTokenIsConsumedAndRejected() {
		var stranger = service.issue(new AuthUser(99L, UserRole.USER));

		var rotation = service.rotate(stranger);

		assertThat(rotation.outcome()).isEqualTo(Outcome.INACTIVE);
		assertThat(rotation.newToken()).isNull();
		assertThat(service.rotate(stranger).outcome()).isEqualTo(Outcome.UNKNOWN);
	}

	@Test
	void revokeRemovesTokenAndIsIdempotent() {
		var token = service.issue(ALICE);

		service.revoke(token);
		service.revoke(token);

		assertThat(service.rotate(token).outcome()).isEqualTo(Outcome.UNKNOWN);
	}

	@Test
	void revokeAllOfRemovesOnlyThatUsersTokens() {
		var first = service.issue(ALICE);
		var second = service.issue(ALICE);
		var bobs = service.issue(BOB);

		assertThat(service.revokeAllOf(ALICE.id())).isEqualTo(2);

		assertThat(service.rotate(first).outcome()).isEqualTo(Outcome.UNKNOWN);
		assertThat(service.rotate(second).outcome()).isEqualTo(Outcome.UNKNOWN);
		assertThat(service.rotate(bobs).outcome()).isEqualTo(Outcome.ROTATED);
		assertThat(service.revokeAllOf(ALICE.id())).isZero();
	}

	@Test
	void tokenExpiresAfterTtl() {
		var expiring = service.issue(ALICE);
		var surviving = service.issue(ALICE);

		clock.advance(Duration.ofDays(14).minusSeconds(1));
		assertThat(service.rotate(surviving).outcome()).isEqualTo(Outcome.ROTATED);
		clock.advance(Duration.ofSeconds(2));
		assertThat(service.rotate(expiring).outcome()).isEqualTo(Outcome.UNKNOWN);
	}

	@Test
	void concurrentRotationOfSameTokenSucceedsExactlyOnce() throws Exception {
		var token = service.issue(ALICE);
		var threads = 20;
		var start = new CountDownLatch(1);
		try (var executor = Executors.newFixedThreadPool(threads)) {
			var futures = new java.util.ArrayList<Future<Outcome>>();
			for (int i = 0; i < threads; i++) {
				futures.add(executor.submit(() -> {
					start.await();
					return service.rotate(token).outcome();
				}));
			}
			start.countDown();
			var rotated = 0;
			for (var future : futures) {
				if (future.get() == Outcome.ROTATED) {
					rotated++;
				}
			}
			assertThat(rotated).isEqualTo(1);
		}
	}

	@Test
	void memoryStoreWarnsOnCreation(CapturedOutput output) {
		new InMemoryRefreshTokenStore(Clock.systemUTC());

		assertThat(output).contains("WARN").contains("메모리");
	}

	static String sha256(String value) {
		try {
			return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
					.digest(value.getBytes(StandardCharsets.US_ASCII)));
		}
		catch (java.security.NoSuchAlgorithmException ex) {
			throw new IllegalStateException(ex);
		}
	}

	static final class MutableClock extends Clock {

		private Instant now;

		MutableClock(Instant now) {
			this.now = now;
		}

		void advance(Duration duration) {
			now = now.plus(duration);
		}

		@Override
		public ZoneId getZone() {
			return ZoneOffset.UTC;
		}

		@Override
		public Clock withZone(ZoneId zone) {
			return this;
		}

		@Override
		public Instant instant() {
			return now;
		}

	}

}
