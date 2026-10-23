package com.ssafy.airdrum.auth;

import jakarta.persistence.EntityManager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;

import com.ssafy.airdrum.auth.AccessTokenException.Reason;
import com.ssafy.airdrum.user.AuthUser;
import com.ssafy.airdrum.user.User;
import com.ssafy.airdrum.user.UserRepository;
import com.ssafy.airdrum.user.UserRole;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;

/**
 * 설계 문서(88) 3-7, 인수 조건 10·12: 서블릿 없이 토큰을 검증하고, 회원 상태·권한은 토큰이 아니라 DB에서 읽는다.
 * BE2 WS 핸들러가 이 두 메서드를 그대로 쓴다.
 */
@DataJpaTest
class AuthenticationServiceTest {

	@Autowired
	private UserRepository users;

	@Autowired
	private EntityManager em;

	private final AccessTokenService tokens = AccessTokenServiceTest.service(AccessTokenServiceTest.SECRET, null,
			java.time.Instant.now());

	private AuthenticationService service;

	@BeforeEach
	void setUp() {
		service = new AuthenticationService(tokens, users);
	}

	@Test
	void validTokenOfActiveUserAuthenticatesWithRoleFromDatabase() {
		var user = users.saveAndFlush(User.create("드러머", null, null));
		var issued = tokens.issue(new AuthUser(user.getId(), UserRole.USER), java.time.Instant.now());

		var authenticated = service.authenticate(issued.token());

		assertThat(authenticated.user()).isEqualTo(new AuthUser(user.getId(), UserRole.USER));
		assertThat(authenticated.expiresAt()).isEqualTo(issued.expiresAt());
	}

	@Test
	void roleChangeInDatabaseAppliesToExistingToken() {
		var user = users.saveAndFlush(User.create("드러머", null, null));
		var token = tokens.issue(new AuthUser(user.getId(), UserRole.USER), java.time.Instant.now()).token();
		user.changeRole(UserRole.ADMIN);
		em.flush();

		assertThat(service.authenticate(token).user().role()).isEqualTo(UserRole.ADMIN);
	}

	@Test
	void withdrawnOrMissingUserIsNotActive() {
		var user = users.saveAndFlush(User.create("탈퇴", null, null));
		var token = tokens.issue(new AuthUser(user.getId(), UserRole.USER), java.time.Instant.now()).token();
		withdraw(user.getId());
		var missing = tokens.issue(new AuthUser(Long.MAX_VALUE, UserRole.USER), java.time.Instant.now()).token();

		for (var value : new String[] { token, missing }) {
			assertThatExceptionOfType(AccessTokenException.class).isThrownBy(() -> service.authenticate(value))
					.satisfies(ex -> assertThat(ex.getReason()).isEqualTo(Reason.USER_NOT_ACTIVE));
		}
	}

	@Test
	void invalidTokenFailsBeforeDatabaseLookup() {
		assertThatExceptionOfType(AccessTokenException.class).isThrownBy(() -> service.authenticate("abc"))
				.satisfies(ex -> assertThat(ex.getReason()).isEqualTo(Reason.MALFORMED));
	}

	@Test
	void findActiveReturnsOnlyActiveUsers() {
		var active = users.saveAndFlush(User.create("활성", null, null));
		var withdrawn = users.saveAndFlush(User.create("탈퇴", null, null));
		withdraw(withdrawn.getId());

		assertThat(service.findActive(active.getId())).contains(new AuthUser(active.getId(), UserRole.USER));
		assertThat(service.findActive(withdrawn.getId())).isEmpty();
		assertThat(service.findActive(Long.MAX_VALUE)).isEmpty();
	}

	private void withdraw(Long userId) {
		em.createNativeQuery("update users set status = 'WITHDRAWN', withdrawn_at = now() where id = :id")
				.setParameter("id", userId)
				.executeUpdate();
		em.clear();
	}

}
