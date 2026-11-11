package com.ssafy.airdrum.domain.auth.dto.oauth;

import com.ssafy.airdrum.domain.user.model.SocialProfile;
import com.ssafy.airdrum.domain.user.model.SocialProvider;

/** 제공자 사용자 정보 응답을 제공자와 무관한 형태로 담는다(설계 문서 3-5). */
public record ProviderUserInfo(
		SocialProvider provider,
		String providerUserId,
		String email,
		boolean emailVerified,
		String name,
		String pictureUrl) {

	public SocialProfile toSocialProfile() {
		return new SocialProfile(provider, providerUserId, email, emailVerified, name, pictureUrl);
	}

	/** 이메일·이름은 개인정보라 로그에 찍히지 않게 한다. */
	@Override
	public String toString() {
		return "ProviderUserInfo[" + provider + "]";
	}

}
