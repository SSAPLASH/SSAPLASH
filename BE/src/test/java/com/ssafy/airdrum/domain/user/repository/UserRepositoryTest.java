package com.ssafy.airdrum.domain.user.repository;

import jakarta.persistence.EntityManager;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNullPointerException;
import com.ssafy.airdrum.domain.user.entity.SocialAccount;
import com.ssafy.airdrum.domain.user.entity.User;
import com.ssafy.airdrum.domain.user.model.SocialProvider;
import com.ssafy.airdrum.domain.user.model.UserRole;
import com.ssafy.airdrum.domain.user.model.UserStatus;
import com.ssafy.airdrum.domain.user.service.profile.UserQueryService;

/**
 * 설계 문서 3-6과 인수 조건 5: 엔티티가 V1 스키마와 맞고(컨텍스트 기동 시 Hibernate validate),
 * 새 회원은 기본 role·status와 시각을 갖고, 소셜 연동을 제공자 식별자로 찾는다.
 */
@DataJpaTest
class UserRepositoryTest {

	@Autowired
	private UserRepository users;

	@Autowired
	private SocialAccountRepository socialAccounts;

	@Autowired
	private EntityManager em;

	@Test
	void newUserIsSavedWithDefaultRoleStatusAndTimestamps() {
		var saved = users.save(User.create("드러머", "drummer@example.com", "https://img.example.com/a.png"));
		em.flush();
		em.clear();

		var found = users.findById(saved.getId()).orElseThrow();
		assertThat(found.getNickname()).isEqualTo("드러머");
		assertThat(found.getEmail()).isEqualTo("drummer@example.com");
		assertThat(found.getProfileImageUrl()).isEqualTo("https://img.example.com/a.png");
		assertThat(found.getRole()).isEqualTo(UserRole.USER);
		assertThat(found.getStatus()).isEqualTo(UserStatus.ACTIVE);
		assertThat(found.getCreatedAt()).isNotNull();
		assertThat(found.getUpdatedAt()).isEqualTo(found.getCreatedAt());
		assertThat(found.getWithdrawnAt()).isNull();
	}

	@Test
	void activeStatusIsReadFromDatabase() {
		var saved = users.saveAndFlush(User.create("상태 조회", null, null));
		var query = new UserQueryService(users, socialAccounts);
		assertThat(query.isActive(saved.getId())).isTrue();
		assertThat(query.isActive(0)).isFalse();
		assertThat(query.isActive(-1)).isFalse();
		assertThat(query.isActive(Long.MAX_VALUE)).isFalse();
		em.createNativeQuery("UPDATE users SET status='WITHDRAWN', withdrawn_at=now() WHERE id=:id")
				.setParameter("id", saved.getId()).executeUpdate();
		assertThat(query.isActive(saved.getId())).isFalse();
	}

	@Test
	void userWithoutEmailAndProfileImageIsAllowed() {
		var saved = users.saveAndFlush(User.create("드러머", null, null));
		assertThat(saved.getId()).isNotNull();
	}

	@Test
	void socialAccountIsFoundByProviderAndProviderUserId() {
		var user = users.save(User.create("드러머", null, null));
		socialAccounts.save(SocialAccount.connect(user, SocialProvider.GOOGLE, "google-sub-1", "drummer@gmail.com"));
		em.flush();
		em.clear();

		var found = socialAccounts.findByProviderAndProviderUserId(SocialProvider.GOOGLE, "google-sub-1").orElseThrow();
		assertThat(found.getUser().getId()).isEqualTo(user.getId());
		assertThat(found.getProvider()).isEqualTo(SocialProvider.GOOGLE);
		assertThat(found.getProviderUserId()).isEqualTo("google-sub-1");
		assertThat(found.getEmail()).isEqualTo("drummer@gmail.com");
		assertThat(found.getConnectedAt()).isNotNull();
	}

	@Test
	void unknownProviderUserIdIsNotFound() {
		assertThat(socialAccounts.findByProviderAndProviderUserId(SocialProvider.GOOGLE, "nobody")).isEmpty();
	}

	@Test
	void userRequiresNickname() {
		assertThatNullPointerException().isThrownBy(() -> User.create(null, null, null));
	}

	@Test
	void socialAccountRequiresUserProviderAndProviderUserId() {
		var user = User.create("드러머", null, null);
		assertThatNullPointerException().isThrownBy(() -> SocialAccount.connect(null, SocialProvider.GOOGLE, "s", null));
		assertThatNullPointerException().isThrownBy(() -> SocialAccount.connect(user, null, "s", null));
		assertThatNullPointerException().isThrownBy(() -> SocialAccount.connect(user, SocialProvider.GOOGLE, null, null));
	}

}
