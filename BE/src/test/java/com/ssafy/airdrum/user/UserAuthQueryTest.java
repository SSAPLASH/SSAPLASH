package com.ssafy.airdrum.user;

import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;

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

		assertThat(users.findActiveAuthUser(user.getId())).contains(new AuthUser(user.getId(), UserRole.ADMIN));
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
