package com.ssafy.airdrum.user;

import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;

import com.ssafy.airdrum.support.SignupConsentFixtures;
import com.ssafy.airdrum.support.SqlCapture;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 설계 문서(88) 3-7, 인수 조건 10·13: 인증이 매 요청 쓰는 ACTIVE 조회와, BE2 결과 저장이 탈퇴와 겨룰 때 쓰는 공유 잠금 조회.
 */
@DataJpaTest(properties = "spring.jpa.properties.hibernate.session_factory.statement_inspector="
		+ "com.ssafy.airdrum.support.SqlCapture")
class UserAuthQueryTest {

	@Autowired
	private UserRepository users;

	@Autowired
	private EntityManager em;

	@BeforeEach
	void clearCapturedSql() {
		SqlCapture.clear();
	}

	@Test
	void activeAuthUserCarriesIdAndCurrentRole() {
		var user = users.saveAndFlush(User.create("드러머", null, null));
		user.changeRole(UserRole.ADMIN);
		em.flush();
		em.clear();

		assertThat(users.findActiveAuthUser(user.getId())).contains(new AuthUser(user.getId(), UserRole.ADMIN, false));
	}

	/** 가입 동의 설계 3-6: 이용약관·개인정보 동의 시각이 둘 다 있어야 가입 완료다. 하나만 있으면 미완료다. */
	@Test
	void activeAuthUserCarriesSignupCompletion() {
		var completed = users.saveAndFlush(SignupConsentFixtures.completed(User.create("완료", null, null)));
		var termsOnly = users.saveAndFlush(User.create("약관만", null, null));
		em.createNativeQuery("update users set terms_version = 't', terms_agreed_at = now() where id = :id")
				.setParameter("id", termsOnly.getId())
				.executeUpdate();
		em.clear();

		assertThat(users.findActiveAuthUser(completed.getId()))
				.contains(new AuthUser(completed.getId(), UserRole.USER, true));
		assertThat(users.findActiveAuthUser(termsOnly.getId()))
				.contains(new AuthUser(termsOnly.getId(), UserRole.USER, false));
	}

	/** 기존 호출(2인자)은 가입 완료로 본다. */
	@Test
	void twoArgumentAuthUserIsSignupCompleted() {
		assertThat(new AuthUser(1L, UserRole.USER).signupCompleted()).isTrue();
	}

	@Test
	void withdrawnOrMissingUserHasNoActiveAuthUser() {
		var user = users.saveAndFlush(User.create("탈퇴", null, null));
		em.createNativeQuery("update users set status = 'WITHDRAWN', withdrawn_at = now() where id = :id")
				.setParameter("id", user.getId())
				.executeUpdate();
		em.clear();

		assertThat(users.findActiveAuthUser(user.getId())).isEmpty();
		assertThat(users.findActiveAuthUser(Long.MAX_VALUE)).isEmpty();
	}

	@Test
	void findByIdForShareTakesSharedRowLock() {
		var user = users.saveAndFlush(User.create("드러머", null, null));
		em.clear();
		SqlCapture.clear();

		var locked = users.findByIdForShare(user.getId()).orElseThrow();

		assertThat(em.getLockMode(locked)).isEqualTo(LockModeType.PESSIMISTIC_READ);
		assertThat(SqlCapture.statements()).anySatisfy(sql -> assertThat(sql.toLowerCase()).contains("for share"));
		assertThat(SqlCapture.statements()).noneSatisfy(sql -> assertThat(sql.toLowerCase()).contains("key share"));
	}

	@Test
	void findByIdForShareOfMissingUserIsEmpty() {
		assertThat(users.findByIdForShare(Long.MAX_VALUE)).isEmpty();
	}

	@Test
	void authUserRequiresIdAndRole() {
		org.assertj.core.api.Assertions.assertThatNullPointerException().isThrownBy(() -> new AuthUser(null, UserRole.USER));
		org.assertj.core.api.Assertions.assertThatNullPointerException().isThrownBy(() -> new AuthUser(1L, null));
	}

}
