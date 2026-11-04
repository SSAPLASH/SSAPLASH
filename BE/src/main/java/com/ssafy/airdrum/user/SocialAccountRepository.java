package com.ssafy.airdrum.user;

import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** 소셜 연동 저장소. */
public interface SocialAccountRepository extends JpaRepository<SocialAccount, Long> {

	/** 로그인 시 제공자 식별자로 연동을 찾는다. 유일 제약과 같은 조합이다. */
	Optional<SocialAccount> findByProviderAndProviderUserId(SocialProvider provider, String providerUserId);

	/** 회원의 소셜 연동. 지금은 하나지만 계정 연결이 생기면 처음 연결한 것이 앞에 온다. */
	List<SocialAccount> findByUserIdOrderByConnectedAtAsc(Long userId);

	/** 탈퇴 작업이 호출한다. 연동이 사라지므로 같은 소셜 계정의 다음 로그인은 새 회원 가입이 된다. */
	@Modifying(flushAutomatically = true, clearAutomatically = true)
	@Query("delete from SocialAccount s where s.user.id = :userId")
	int deleteAllByUserId(@Param("userId") Long userId);

}
