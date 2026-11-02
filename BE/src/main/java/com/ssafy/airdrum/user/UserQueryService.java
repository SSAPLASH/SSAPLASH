package com.ssafy.airdrum.user;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 회원 조회. ACTIVE 확인은 인증이 이미 했으므로 다시 하지 않는다. */
@Service
public class UserQueryService {

	private final UserRepository users;
	private final SocialAccountRepository socialAccounts;

	public UserQueryService(UserRepository users, SocialAccountRepository socialAccounts) {
		this.users = users;
		this.socialAccounts = socialAccounts;
	}

	/**
	 * @throws IllegalStateException 인증된 회원의 행이나 소셜 연동이 없을 때(데이터 불변식 위반, 500)
	 */
	@Transactional(readOnly = true)
	public UserMeResponse me(long userId) {
		var user = users.findById(userId)
				.orElseThrow(() -> new IllegalStateException("인증된 회원 " + userId + "의 행이 없습니다."));
		var provider = socialAccounts.findByUserIdOrderByConnectedAtAsc(userId).stream()
				.findFirst()
				.map(SocialAccount::getProvider)
				.orElseThrow(() -> new IllegalStateException("회원 " + userId + "의 소셜 연동이 없습니다."));
		return new UserMeResponse(user.getId(), provider, user.getNickname(), user.getProfileImageUrl(),
				user.getRole(), user.getCreatedAt(), user.getUpdatedAt(),
				new DataConsentResponse(user.getDataConsent(), user.getDataConsentAt()));
	}

}
