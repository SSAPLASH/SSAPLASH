package com.ssafy.airdrum.domain.user.service.social;

import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.AdditionalAnswers.delegatesTo;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import com.ssafy.airdrum.domain.user.entity.SocialAccount;
import com.ssafy.airdrum.domain.user.entity.User;
import com.ssafy.airdrum.domain.user.model.AdminEmailWhitelist;
import com.ssafy.airdrum.domain.user.model.SocialProfile;
import com.ssafy.airdrum.domain.user.model.SocialProvider;
import com.ssafy.airdrum.domain.user.repository.SocialAccountRepository;
import com.ssafy.airdrum.domain.user.repository.UserRepository;

/**
 * 설계 위험 6: 같은 계정의 최초 로그인 두 건이 겹치면 늦은 쪽은 유일 제약에 걸린다.
 * 그때 새 트랜잭션에서 다시 조회해 먼저 만들어진 회원으로 로그인해야 한다(PostgreSQL은 제약 위반 뒤 같은 트랜잭션을 쓸 수 없다).
 *
 * <p>경합은 "첫 조회만 비어 있다"로 재현한다. 나머지 호출은 실제 리포지토리로 넘긴다.
 * 서비스가 직접 트랜잭션을 나눠야 하므로 테스트 트랜잭션을 끄고, 만든 행은 직접 지운다.
 */
@DataJpaTest
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class SocialLoginServiceRaceTest {

	@Autowired
	private UserRepository users;

	@Autowired
	private SocialAccountRepository socialAccounts;

	@Autowired
	private PlatformTransactionManager transactionManager;

	private Long existingUserId;

	@AfterEach
	void cleanUp() {
		socialAccounts.findByProviderAndProviderUserId(SocialProvider.GOOGLE, "race-sub")
				.ifPresent(socialAccounts::delete);
		if (existingUserId != null) {
			users.deleteById(existingUserId);
		}
	}

	@Test
	void concurrentFirstLoginFallsBackToAccountCreatedByOtherRequest() {
		// 다른 요청이 먼저 가입을 끝낸 상태
		var existing = users.save(User.create("먼저온회원", null, null));
		existingUserId = existing.getId();
		socialAccounts.save(SocialAccount.connect(existing, SocialProvider.GOOGLE, "race-sub", null));
		var countBefore = users.count();

		// 이 요청의 첫 조회는 그보다 앞서 실행돼 아무것도 못 찾았다
		var racing = mock(SocialAccountRepository.class, delegatesTo(socialAccounts));
		doReturn(Optional.empty()).doAnswer(delegatesTo(socialAccounts))
				.when(racing).findByProviderAndProviderUserId(any(SocialProvider.class), anyString());
		var service = new SocialLoginService(users, racing, new AdminEmailWhitelist(List.of()), transactionManager);

		var user = service.login(new SocialProfile(SocialProvider.GOOGLE, "race-sub", null, false, "늦게온요청", null));

		assertThat(user.getId()).isEqualTo(existingUserId);
		assertThat(user.getNickname()).isEqualTo("먼저온회원");
		// 실패한 가입 시도의 users 행은 롤백돼 남지 않는다
		assertThat(users.count()).isEqualTo(countBefore);
	}

}
