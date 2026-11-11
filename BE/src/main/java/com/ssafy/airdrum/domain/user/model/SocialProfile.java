package com.ssafy.airdrum.domain.user.model;

import java.util.Objects;

/**
 * 소셜 로그인 입력. 인증 모듈이 제공자 응답을 이 형태로 바꿔 넘긴다. 회원 모듈은 제공자 통신을 모른다.
 *
 * @param providerUserId 제공자 측 사용자 식별자(Google {@code sub}, SSAFY {@code userId})
 * @param email 제공자가 준 이메일. 없으면 null
 * @param emailVerified 제공자가 이메일을 검증했는지. ADMIN 판정에 쓴다
 * @param name 제공자가 준 이름. 닉네임 기본값이 된다
 * @param profileImageUrl 제공자가 준 이미지 URL. 없으면 null
 */
public record SocialProfile(
		SocialProvider provider,
		String providerUserId,
		String email,
		boolean emailVerified,
		String name,
		String profileImageUrl) {

	public SocialProfile {
		Objects.requireNonNull(provider, "provider");
		Objects.requireNonNull(providerUserId, "providerUserId");
	}

}
