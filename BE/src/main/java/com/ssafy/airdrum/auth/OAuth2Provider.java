package com.ssafy.airdrum.auth;

import com.ssafy.airdrum.auth.AuthProperties.Attributes;
import com.ssafy.airdrum.auth.AuthProperties.ClientAuthenticationMethod;
import com.ssafy.airdrum.user.SocialProvider;

/**
 * 활성화된 제공자 하나. 설정({@link AuthProperties.Provider})에서 만들며 콜백 URI까지 확정된 불변 값이다.
 *
 * @param key 경로 값(소문자). {@code /api/auth/{key}/login}
 * @param redirectUri 인가·토큰 요청에 같은 값으로 보내는 콜백 URI
 */
public record OAuth2Provider(
		String key,
		SocialProvider socialProvider,
		String clientId,
		String clientSecret,
		String authorizationUri,
		String tokenUri,
		String userInfoUri,
		String scope,
		ClientAuthenticationMethod clientAuthenticationMethod,
		Attributes attributes,
		boolean assumeEmailVerified,
		String redirectUri) {

	/** 시크릿이 로그·예외 메시지에 찍히지 않게 한다. */
	@Override
	public String toString() {
		return "OAuth2Provider[" + key + "]";
	}

}
