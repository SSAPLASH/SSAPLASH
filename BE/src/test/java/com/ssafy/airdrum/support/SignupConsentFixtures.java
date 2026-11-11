package com.ssafy.airdrum.support;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import com.ssafy.airdrum.domain.user.entity.User;

/**
 * 테스트 회원을 「가입 완료」(이용약관·개인정보·연주 기록 활용 동의를 마친 상태)로 만든다.
 *
 * <p>동의 전 회원은 가입 게이트({@code SignupGateFilter})가 대부분의 API를 403으로 막는다. 게이트 자체를 검증하지 않는
 * 테스트는 회원을 만들 때 이 클래스로 가입을 마친 상태로 둔다. 운영 코드에는 동의 값을 바꾸는 세터가 없으므로,
 * 엔티티는 저장 전에 필드를 직접 채우고 SQL로 넣은 행은 UPDATE로 채운다.
 */
public final class SignupConsentFixtures {

	/** 테스트가 쓰는 동의 판. 서버는 판을 해석하지 않는다. */
	public static final String VERSION = "test-2026-11-01";

	private SignupConsentFixtures() {
	}

	/**
	 * 아직 저장하지 않은 엔티티에 동의 값을 채워 돌려준다. {@code users.save(completed(User.create(...)))}처럼 쓴다.
	 * 이미 저장된 엔티티에 쓰면 다음 flush가 같은 값으로 UPDATE한다.
	 */
	public static User completed(User user) {
		var now = Instant.now().truncatedTo(ChronoUnit.MICROS);
		ReflectionTestUtils.setField(user, "termsVersion", VERSION);
		ReflectionTestUtils.setField(user, "termsAgreedAt", now);
		ReflectionTestUtils.setField(user, "privacyVersion", VERSION);
		ReflectionTestUtils.setField(user, "privacyAgreedAt", now);
		ReflectionTestUtils.setField(user, "dataConsent", Boolean.TRUE);
		ReflectionTestUtils.setField(user, "dataConsentAt", now);
		ReflectionTestUtils.setField(user, "dataConsentVersion", VERSION);
		return user;
	}

	/**
	 * SQL로 넣은 회원 행을 가입 완료로 바꾼다. JPA로 만든 회원이면 먼저 flush해야 하고, 영속성 컨텍스트의 엔티티는
	 * 이 값을 모르므로 그 엔티티를 다시 flush하면 동의 값이 null로 덮인다(그럴 때는 {@link #completed(User)}를 쓴다).
	 */
	public static void complete(JdbcTemplate jdbc, long userId) {
		int updated = jdbc.update("""
				UPDATE users SET terms_version = ?, terms_agreed_at = now(), privacy_version = ?, privacy_agreed_at = now(),
				  data_consent = true, data_consent_at = now(), data_consent_version = ?
				WHERE id = ?
				""", VERSION, VERSION, VERSION, userId);
		if (updated != 1) {
			throw new IllegalStateException("회원 " + userId + "의 행이 없습니다.");
		}
	}

}
