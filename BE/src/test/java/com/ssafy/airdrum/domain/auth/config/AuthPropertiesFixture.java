package com.ssafy.airdrum.domain.auth.config;

import java.time.Duration;
import java.util.List;
import java.util.Map;

/** 단위 테스트용 {@link AuthProperties}. 제공자 없이 토큰 설정만 바꿔 만든다. */
public final class AuthPropertiesFixture {

	private AuthPropertiesFixture() {
	}

	public static AuthProperties withJwt(AuthProperties.Jwt jwt) {
		return new AuthProperties(null, null, null, null, true, Duration.ofMinutes(5),
				new AuthProperties.Admin(List.of()), Map.of(), jwt, null, null);
	}

	public static AuthProperties defaults() {
		return withJwt(new AuthProperties.Jwt(AuthTokenPropertiesTest.SECRET_32, null));
	}

}
