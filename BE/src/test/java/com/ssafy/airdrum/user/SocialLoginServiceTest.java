package com.ssafy.airdrum.user;

import java.util.List;

import jakarta.persistence.EntityManager;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;
import static org.assertj.core.api.Assertions.assertThatNullPointerException;

/**
 * 설계 문서 3-7·4-D와 인수 조건 4·5·8·9·10: 소셜 프로필로 회원을 찾거나 만들고, 로그인마다 역할을 다시 정한다.
 * 동시 가입 경합은 {@link SocialLoginServiceRaceTest}가 따로 본다(테스트 트랜잭션 밖에서 돌아야 한다).
 */
@DataJpaTest
@Import({ SocialLoginService.class, SocialLoginServiceTest.Whitelist.class })
class SocialLoginServiceTest {

	static final String ADMIN_EMAIL = "admin@example.com";

	@TestConfiguration
	static class Whitelist {

		@Bean
		AdminEmailWhitelist adminEmailWhitelist() {
			return new AdminEmailWhitelist(List.of(ADMIN_EMAIL));
		}

	}

	@Autowired
	private SocialLoginService service;

	@Autowired
	private UserRepository users;

	@Autowired
	private SocialAccountRepository socialAccounts;

	@Autowired
	private EntityManager em;

	@Test
	void firstLoginCreatesUserAndSocialAccountFromProfile() {
		var user = service.login(google("sub-1", "drummer@gmail.com", true, "드러머", "https://img.example.com/a.png"));
		em.flush();
		em.clear();

		var saved = users.findById(user.getId()).orElseThrow();
		assertThat(saved.getNickname()).isEqualTo("드러머");
		assertThat(saved.getEmail()).isEqualTo("drummer@gmail.com");
		assertThat(saved.getProfileImageUrl()).isEqualTo("https://img.example.com/a.png");
		assertThat(saved.getRole()).isEqualTo(UserRole.USER);
		assertThat(saved.getStatus()).isEqualTo(UserStatus.ACTIVE);

		var account = socialAccounts.findByProviderAndProviderUserId(SocialProvider.GOOGLE, "sub-1").orElseThrow();
		assertThat(account.getUser().getId()).isEqualTo(user.getId());
		assertThat(account.getEmail()).isEqualTo("drummer@gmail.com");
	}

	@Test
	void ssafyLoginWithoutPictureCreatesUserWithoutImage() {
		var user = service.login(new SocialProfile(SocialProvider.SSAFY, "ssafy-user-1", "me@ssafy.com", true, "김싸피", null));

		assertThat(user.getNickname()).isEqualTo("김싸피");
		assertThat(user.getProfileImageUrl()).isNull();
		assertThat(socialAccounts.findByProviderAndProviderUserId(SocialProvider.SSAFY, "ssafy-user-1")).isPresent();
	}

	@Test
	void sameProviderUserIdOnDifferentProvidersAreDifferentUsers() {
		var google = service.login(google("same-id", null, false, "구글", null));
		var ssafy = service.login(new SocialProfile(SocialProvider.SSAFY, "same-id", null, true, "싸피", null));

		assertThat(ssafy.getId()).isNotEqualTo(google.getId());
	}

	@Test
	void reLoginReturnsSameUserWithoutOverwritingProfile() {
		var first = service.login(google("sub-2", "old@gmail.com", true, "처음이름", "https://img.example.com/old.png"));
		em.flush();
		var countBefore = users.count();

		var again = service.login(google("sub-2", "new@gmail.com", true, "바뀐이름", "https://img.example.com/new.png"));
		em.flush();
		em.clear();

		assertThat(again.getId()).isEqualTo(first.getId());
		assertThat(users.count()).isEqualTo(countBefore);
		var saved = users.findById(first.getId()).orElseThrow();
		assertThat(saved.getNickname()).isEqualTo("처음이름");
		assertThat(saved.getEmail()).isEqualTo("old@gmail.com");
		assertThat(saved.getProfileImageUrl()).isEqualTo("https://img.example.com/old.png");
	}

	@Test
	void nicknameFallsBackAndIsTruncatedTo30CodePoints() {
		var blank = service.login(google("sub-3", null, false, "   ", null));
		var missing = service.login(google("sub-4", null, false, null, null));
		var trimmed = service.login(google("sub-5", null, false, "  드러머  ", null));
		var longName = "가".repeat(29) + "😀" + "나";
		var truncated = service.login(google("sub-6", null, false, longName, null));

		assertThat(blank.getNickname()).isEqualTo("사용자");
		assertThat(missing.getNickname()).isEqualTo("사용자");
		assertThat(trimmed.getNickname()).isEqualTo("드러머");
		assertThat(truncated.getNickname()).isEqualTo("가".repeat(29) + "😀");
		em.flush();
	}

	@Test
	void profileImageOver500CharsOrBlankIsDropped() {
		var url500 = "https://img.example.com/" + "a".repeat(500 - 24);
		var tooLong = service.login(google("sub-7", null, false, "a", url500 + "b"));
		var exact = service.login(google("sub-8", null, false, "b", url500));
		var blank = service.login(google("sub-9", null, false, "c", " "));
		em.flush();

		assertThat(tooLong.getProfileImageUrl()).isNull();
		assertThat(exact.getProfileImageUrl()).hasSize(500);
		assertThat(blank.getProfileImageUrl()).isNull();
	}

	@Test
	void verifiedWhitelistedEmailBecomesAdminAndIsDemotedWhenNoLongerListed() {
		var admin = service.login(google("sub-10", "ADMIN@example.com", true, "관리자", null));
		assertThat(admin.getRole()).isEqualTo(UserRole.ADMIN);
		em.flush();

		// 같은 계정이 화이트리스트에 없는 이메일로 돌아오면(목록에서 빠진 것과 같음) USER로 내린다.
		var demoted = service.login(google("sub-10", "renamed@example.com", true, "관리자", null));
		em.flush();
		em.clear();

		assertThat(demoted.getId()).isEqualTo(admin.getId());
		assertThat(users.findById(admin.getId()).orElseThrow().getRole()).isEqualTo(UserRole.USER);
	}

	@Test
	void existingUserIsPromotedWhenEmailIsWhitelisted() {
		var user = service.login(google("sub-11", "other@example.com", true, "회원", null));
		assertThat(user.getRole()).isEqualTo(UserRole.USER);
		em.flush();

		var promoted = service.login(google("sub-11", ADMIN_EMAIL, true, "회원", null));
		em.flush();
		em.clear();

		assertThat(users.findById(promoted.getId()).orElseThrow().getRole()).isEqualTo(UserRole.ADMIN);
	}

	@Test
	void unverifiedWhitelistedEmailStaysUser() {
		var user = service.login(google("sub-12", ADMIN_EMAIL, false, "미검증", null));

		assertThat(user.getRole()).isEqualTo(UserRole.USER);
	}

	@Test
	void withdrawnUserCannotLoginAndIsNotChanged() {
		var user = service.login(google("sub-13", "w@example.com", true, "탈퇴예정", null));
		em.flush();
		em.createNativeQuery("update users set status = 'WITHDRAWN', withdrawn_at = now() where id = :id")
				.setParameter("id", user.getId())
				.executeUpdate();
		em.clear();
		var countBefore = users.count();

		assertThatExceptionOfType(UserNotActiveException.class)
				.isThrownBy(() -> service.login(google("sub-13", ADMIN_EMAIL, true, "탈퇴예정", null)));
		em.flush();
		em.clear();

		var saved = users.findById(user.getId()).orElseThrow();
		assertThat(saved.getStatus()).isEqualTo(UserStatus.WITHDRAWN);
		assertThat(saved.getRole()).isEqualTo(UserRole.USER);
		assertThat(users.count()).isEqualTo(countBefore);
	}

	@Test
	void profileRequiresProviderAndProviderUserId() {
		assertThatNullPointerException().isThrownBy(() -> new SocialProfile(null, "id", null, false, null, null));
		assertThatNullPointerException().isThrownBy(() -> new SocialProfile(SocialProvider.GOOGLE, null, null, false, null, null));
	}

	private static SocialProfile google(String sub, String email, boolean verified, String name, String picture) {
		return new SocialProfile(SocialProvider.GOOGLE, sub, email, verified, name, picture);
	}

}
