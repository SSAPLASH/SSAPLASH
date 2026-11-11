package com.ssafy.airdrum.domain.withdrawal.scheduler;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.airdrum.domain.auth.service.token.RefreshTokenService;
import com.ssafy.airdrum.domain.auth.service.token.RefreshTokenService.Rotation.Outcome;
import com.ssafy.airdrum.support.SignupConsentFixtures;
import com.ssafy.airdrum.domain.user.model.AuthUser;
import com.ssafy.airdrum.domain.user.model.UserRole;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 가입 동의 설계 4-6, 인수 조건 14: 동의 없이 7일 지난 신규 계정(기준 시각 뒤 생성)만 지우고 refresh 토큰을 폐기한다.
 *
 * <p>운영처럼 회원마다 따로 커밋되는지(한 회원의 FK 실패가 나머지를 막지 않는지) 보려고 테스트 트랜잭션 없이 실행하고, 만든 행은
 * 끝날 때 지운다. 다른 테스트의 회원을 건드리지 않도록 기준 시각을 먼 미래로 정하고 그 뒤 시각으로 회원을 넣는다.
 * V26 적용 시각을 기준으로 쓰는지는 롤백되는 테스트 하나로 따로 확인한다.
 *
 * <p>트랜잭션 없이 풀의 아무 연결이나 쓰므로 공용 컨텍스트를 쓰지 않는다. 격리 스키마로 마이그레이션을 검사하는 다른 테스트가
 * 공용 풀 연결의 search_path를 바꿔 둘 수 있기 때문이다. 속성 하나를 달리 주어 이 클래스만의 컨텍스트(새 연결 풀)를 쓰며,
 * 예약 실행은 시작 시 한 번 뒤 하루 간격이라 테스트 도중 끼어들지 않는다.
 */
@SpringBootTest(properties = "user.signup.cleanup-interval-ms=86400000")
@ExtendWith(OutputCaptureExtension.class)
class PendingSignupCleanupTest {

	@Autowired
	private PendingSignupCleanup cleanup;

	@Autowired
	private RefreshTokenService refreshTokens;

	@Autowired
	private JdbcTemplate db;

	private final List<Long> created = new ArrayList<>();

	private Instant since;

	private Instant now;

	@BeforeEach
	void setUp() {
		since = Instant.now().plus(Duration.ofDays(3650));
		now = since.plus(Duration.ofDays(30));
	}

	@AfterEach
	void tearDown() {
		for (long id : created) {
			db.update("DELETE FROM songs WHERE owner_id = ?", id);
			db.update("DELETE FROM users WHERE id = ?", id);
		}
	}

	@Test
	void deletesPendingMemberOlderThanTtlAndRevokesRefreshTokens() {
		long pending = insertUser("떠난 신규", since.plus(Duration.ofDays(1)), "ACTIVE");
		db.update("INSERT INTO social_accounts (user_id, provider, provider_user_id) VALUES (?, 'GOOGLE', ?)",
				pending, "g-pending-" + pending);
		var token = refreshTokens.issue(new AuthUser(pending, UserRole.USER, false));

		assertThat(cleanup.runOnce(now, since)).isEqualTo(1);

		assertThat(exists(pending)).isFalse();
		assertThat(db.queryForObject("SELECT count(*) FROM social_accounts WHERE user_id = ?", Long.class, pending))
				.isZero();
		// 폐기된 토큰은 저장소에 없다(폐기 안 됐으면 회원이 없어 INACTIVE가 된다)
		assertThat(refreshTokens.rotate(token).outcome()).isEqualTo(Outcome.UNKNOWN);
	}

	@Test
	void keepsExistingConsentedRecentAndWithdrawnMembers() {
		long existing = insertUser("기존 회원", since.minus(Duration.ofDays(1)), "ACTIVE");
		long consented = insertUser("동의 회원", since.plus(Duration.ofDays(1)), "ACTIVE");
		SignupConsentFixtures.complete(db, consented);
		long recent = insertUser("7일 미만", now.minus(Duration.ofDays(6)), "ACTIVE");
		long withdrawn = insertUser("탈퇴 회원", since.plus(Duration.ofDays(1)), "WITHDRAWN");
		long target = insertUser("대상", since.plus(Duration.ofDays(1)), "ACTIVE");

		assertThat(cleanup.runOnce(now, since)).isEqualTo(1);

		assertThat(exists(existing)).isTrue();
		assertThat(exists(consented)).isTrue();
		assertThat(exists(recent)).isTrue();
		assertThat(exists(withdrawn)).isTrue();
		assertThat(exists(target)).isFalse();
	}

	/** 경계값: 기준 시각에 생성된 회원은 대상이고, 정확히 7일 된 회원은 아직 남는다(created_at < now - 7일만 대상). */
	@Test
	void boundariesAreInclusiveSinceAndExclusiveTtl() {
		long atSince = insertUser("기준 시각", since, "ACTIVE");
		long exactlyTtl = insertUser("정확히 7일", now.minus(Duration.ofDays(7)), "ACTIVE");

		cleanup.runOnce(now, since);

		assertThat(exists(atSince)).isFalse();
		assertThat(exists(exactlyTtl)).isTrue();
	}

	/** 이용약관이나 개인정보 중 하나라도 동의했으면 대상이 아니다(설계 4-6 조건은 둘 다 null). */
	@Test
	void partiallyConsentedMemberIsKept() {
		long termsOnly = insertUser("약관만", since.plus(Duration.ofDays(1)), "ACTIVE");
		db.update("UPDATE users SET terms_version = 't', terms_agreed_at = now() WHERE id = ?", termsOnly);

		cleanup.runOnce(now, since);

		assertThat(exists(termsOnly)).isTrue();
	}

	/** 한 회원의 삭제가 실패해도(곡 FK 등) 경고만 남기고 다음 회원을 계속 처리한다. 실패한 회원의 토큰은 그대로다. */
	@Test
	void failureOnOneMemberDoesNotStopOthers(CapturedOutput output) {
		long blocked = insertUser("곡 있는 회원", since.plus(Duration.ofDays(1)), "ACTIVE");
		db.update("INSERT INTO songs (owner_id, title, source) VALUES (?, '남은 곡', 'MIDI')", blocked);
		var blockedToken = refreshTokens.issue(new AuthUser(blocked, UserRole.USER, false));
		long next = insertUser("다음 회원", since.plus(Duration.ofDays(2)), "ACTIVE");

		assertThat(cleanup.runOnce(now, since)).isEqualTo(1);

		assertThat(exists(blocked)).isTrue();
		assertThat(exists(next)).isFalse();
		assertThat(output).contains("가입 미완료 계정 삭제 실패 userId=" + blocked);
		assertThat(refreshTokens.rotate(blockedToken).outcome()).isEqualTo(Outcome.ROTATED);
	}

	/**
	 * 운영 경로는 V26 적용 시각을 기준으로 쓴다. 대상 구간을 적용 직후 1초로 좁혀 다른 테스트의 회원이 들어오지 않게 하고,
	 * 롤백되는 트랜잭션에서 본다.
	 */
	@Test
	@Transactional
	void defaultBaselineIsV26InstalledOn() {
		var installedOn = db.queryForObject("SELECT installed_on FROM flyway_schema_history WHERE version = '26'",
				Timestamp.class).toInstant();
		var later = installedOn.plus(Duration.ofDays(7)).plusSeconds(1);
		long before = insertUser("V26 이전", installedOn.minus(Duration.ofDays(1)), "ACTIVE");
		long after = insertUser("V26 이후", installedOn.plusMillis(500), "ACTIVE");

		cleanup.runOnce(later);

		assertThat(exists(before)).isTrue();
		assertThat(exists(after)).isFalse();
	}

	private long insertUser(String nickname, Instant createdAt, String status) {
		var at = Timestamp.from(createdAt);
		long id = db.queryForObject("""
				INSERT INTO users (nickname, status, withdrawn_at, created_at, updated_at)
				VALUES (?, ?, CASE WHEN ? = 'WITHDRAWN' THEN now() END, ?, ?) RETURNING id
				""", Long.class, nickname, status, status, at, at);
		created.add(id);
		return id;
	}

	private boolean exists(long userId) {
		return db.queryForObject("SELECT count(*) FROM users WHERE id = ?", Long.class, userId) == 1;
	}

}
