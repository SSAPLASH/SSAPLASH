package com.ssafy.airdrum.auth;

import java.time.Duration;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import com.ssafy.airdrum.auth.AuthProperties.ClientAuthenticationMethod;
import com.ssafy.airdrum.user.SocialProvider;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 설계 문서 3-2: application.yaml의 제공자 블록과 환경변수 연결.
 * 로컬 BE/.env 내용에 결과가 흔들리지 않도록 이 테스트가 쓰는 환경변수는 모두 여기서 지정한다.
 * FRONTEND_BASE_URL·COOKIE_SECURE를 빈 값으로 주는 것은 ".env의 빈 줄"을 흉내 낸 것이다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE, properties = {
		"GOOGLE_CLIENT_ID=google-id", "GOOGLE_CLIENT_SECRET=google-secret",
		"SSAFY_CLIENT_ID=ssafy-id", "SSAFY_CLIENT_SECRET=ssafy-secret",
		"FRONTEND_BASE_URL=", "OAUTH_REDIRECT_BASE_URL=", "COOKIE_SECURE=", "ADMIN_EMAILS=" })
class AuthPropertiesTest {

	@Autowired
	private AuthProperties properties;

	@Autowired
	private OAuth2ProviderRegistry registry;

	@Test
	void blankEnvironmentValuesFallBackToLocalDefaults() {
		assertThat(properties.frontendBaseUrl()).isEqualTo("http://localhost:5173");
		assertThat(properties.redirectBaseUrl()).isEqualTo("http://localhost:8080");
		assertThat(properties.cookieSecure()).isTrue();
		assertThat(properties.loginSuccessPath()).isEqualTo("/auth/callback");
		assertThat(properties.loginFailurePath()).isEqualTo("/login");
		assertThat(properties.stateCookieMaxAge()).isEqualTo(Duration.ofSeconds(300));
		assertThat(properties.admin().emails()).isEmpty();
	}

	@Test
	void googleUsesOpenIdEndpointsWithBasicClientAuthentication() {
		var google = registry.find("google").orElseThrow();
		assertThat(google.socialProvider()).isEqualTo(SocialProvider.GOOGLE);
		assertThat(google.clientId()).isEqualTo("google-id");
		assertThat(google.authorizationUri()).isEqualTo("https://accounts.google.com/o/oauth2/v2/auth");
		assertThat(google.tokenUri()).isEqualTo("https://oauth2.googleapis.com/token");
		assertThat(google.userInfoUri()).isEqualTo("https://openidconnect.googleapis.com/v1/userinfo");
		assertThat(google.scope()).isEqualTo("openid email profile");
		assertThat(google.clientAuthenticationMethod()).isEqualTo(ClientAuthenticationMethod.BASIC);
		assertThat(google.attributes().id()).isEqualTo("sub");
		assertThat(google.attributes().emailVerified()).isEqualTo("email_verified");
		assertThat(google.attributes().picture()).isEqualTo("picture");
		assertThat(google.assumeEmailVerified()).isFalse();
		assertThat(google.redirectUri()).isEqualTo("http://localhost:8080/api/auth/google/callback");
	}

	@Test
	void ssafyUsesPortalEndpointsWithPostClientAuthenticationAndNoScope() {
		var ssafy = registry.find("ssafy").orElseThrow();
		assertThat(ssafy.socialProvider()).isEqualTo(SocialProvider.SSAFY);
		assertThat(ssafy.authorizationUri()).isEqualTo("https://project.ssafy.com/oauth/sso-check");
		assertThat(ssafy.tokenUri()).isEqualTo("https://project.ssafy.com/ssafy/oauth2/token");
		assertThat(ssafy.userInfoUri()).isEqualTo("https://project.ssafy.com/ssafy/resources/userInfo");
		assertThat(ssafy.scope()).isNull();
		assertThat(ssafy.clientAuthenticationMethod()).isEqualTo(ClientAuthenticationMethod.POST);
		assertThat(ssafy.attributes().id()).isEqualTo("userId");
		assertThat(ssafy.attributes().emailVerified()).isNull();
		assertThat(ssafy.attributes().picture()).isNull();
		assertThat(ssafy.assumeEmailVerified()).isTrue();
		assertThat(ssafy.redirectUri()).isEqualTo("http://localhost:8080/api/auth/ssafy/callback");
	}

}
