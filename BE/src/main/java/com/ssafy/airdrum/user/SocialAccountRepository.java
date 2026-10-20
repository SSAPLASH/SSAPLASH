package com.ssafy.airdrum.user;

import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

/** 소셜 연동 저장소. */
public interface SocialAccountRepository extends JpaRepository<SocialAccount, Long> {

	/** 로그인 시 제공자 식별자로 연동을 찾는다. 유일 제약과 같은 조합이다. */
	Optional<SocialAccount> findByProviderAndProviderUserId(SocialProvider provider, String providerUserId);

}
