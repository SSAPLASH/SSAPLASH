package com.ssafy.airdrum.auth;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.restclient.test.autoconfigure.RestClientTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;

import com.ssafy.airdrum.auth.AuthProperties.Attributes;
import com.ssafy.airdrum.auth.AuthProperties.ClientAuthenticationMethod;
import com.ssafy.airdrum.auth.OAuth2FlowException.Reason;
import com.ssafy.airdrum.user.SocialProvider;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.headerDoesNotExist;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/** 설계 문서 3-5: 제공자별 토큰 요청 형식과 사용자 정보 매핑, 실패는 OAuth2FlowException. */
@RestClientTest(OAuth2Client.class)
class OAuth2ClientTest {

	static final OAuth2Provider GOOGLE = new OAuth2Provider("google", SocialProvider.GOOGLE, "google-id", "google-secret",
			"https://accounts.google.test/auth", "https://oauth2.google.test/token", "https://openid.google.test/userinfo",
			"openid email profile", ClientAuthenticationMethod.BASIC,
			new Attributes("sub", "email", "email_verified", "name", "picture"), false,
			"http://localhost:8080/api/auth/google/callback");

	static final OAuth2Provider SSAFY = new OAuth2Provider("ssafy", SocialProvider.SSAFY, "ssafy-id", "ssafy-secret",
			"https://project.ssafy.test/oauth/sso-check", "https://project.ssafy.test/ssafy/oauth2/token",
			"https://project.ssafy.test/ssafy/resources/userInfo", null, ClientAuthenticationMethod.POST,
			new Attributes("userId", "email", null, "name", null), true,
			"http://localhost:8080/api/auth/ssafy/callback");

	@Autowired
	private OAuth2Client client;

	@Autowired
	private MockRestServiceServer server;

	@Test
	void googleTokenRequestUsesBasicAuthenticationAndForm() {
		var basic = Base64.getEncoder().encodeToString("google-id:google-secret".getBytes(StandardCharsets.UTF_8));
		server.expect(requestTo(GOOGLE.tokenUri()))
				.andExpect(method(HttpMethod.POST))
				.andExpect(header(HttpHeaders.AUTHORIZATION, "Basic " + basic))
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_FORM_URLENCODED))
				.andExpect(content().formDataContains(java.util.Map.of(
						"grant_type", "authorization_code",
						"code", "auth-code",
						"redirect_uri", "http://localhost:8080/api/auth/google/callback")))
				.andRespond(withSuccess("{\"access_token\":\"google-at\",\"token_type\":\"Bearer\",\"expires_in\":3599,"
						+ "\"id_token\":\"ignored\"}", MediaType.APPLICATION_JSON));

		assertThat(client.exchangeCode(GOOGLE, "auth-code")).isEqualTo("google-at");
		server.verify();
	}

	@Test
	void ssafyTokenRequestSendsClientCredentialsInBodyAndAcceptsStringExpiresIn() {
		server.expect(requestTo(SSAFY.tokenUri()))
				.andExpect(method(HttpMethod.POST))
				.andExpect(headerDoesNotExist(HttpHeaders.AUTHORIZATION))
				.andExpect(content().formDataContains(java.util.Map.of(
						"grant_type", "authorization_code",
						"code", "ssafy-code",
						"client_id", "ssafy-id",
						"client_secret", "ssafy-secret",
						"redirect_uri", "http://localhost:8080/api/auth/ssafy/callback")))
				.andRespond(withSuccess("{\"token_type\":\"bearer\",\"access_token\":\"ssafy-at\",\"scope\":\"email name\","
						+ "\"expires_in\":\"43199\",\"refresh_token\":\"ignored\",\"refresh_token_expires_in\":5183999}",
						MediaType.APPLICATION_JSON));

		assertThat(client.exchangeCode(SSAFY, "ssafy-code")).isEqualTo("ssafy-at");
		server.verify();
	}

	@Test
	void tokenErrorResponseOrMissingAccessTokenFails() {
		server.expect(requestTo(GOOGLE.tokenUri()))
				.andRespond(withStatus(HttpStatus.BAD_REQUEST).contentType(MediaType.APPLICATION_JSON)
						.body("{\"error\":\"invalid_grant\"}"));
		assertFailure(() -> client.exchangeCode(GOOGLE, "bad"), Reason.TOKEN_EXCHANGE_FAILED);

		server.reset();
		server.expect(requestTo(GOOGLE.tokenUri()))
				.andRespond(withSuccess("{\"token_type\":\"Bearer\"}", MediaType.APPLICATION_JSON));
		assertFailure(() -> client.exchangeCode(GOOGLE, "code"), Reason.TOKEN_EXCHANGE_FAILED);
	}

	@Test
	void googleUserInfoIsMappedFromOpenIdClaims() {
		server.expect(requestTo(GOOGLE.userInfoUri()))
				.andExpect(method(HttpMethod.GET))
				.andExpect(header(HttpHeaders.AUTHORIZATION, "Bearer google-at"))
				.andRespond(withSuccess("{\"sub\":\"1234567890\",\"email\":\"drummer@gmail.com\",\"email_verified\":true,"
						+ "\"name\":\"드러머\",\"picture\":\"https://lh3.googleusercontent.com/a/x\"}", MediaType.APPLICATION_JSON));

		var info = client.fetchUserInfo(GOOGLE, "google-at");

		assertThat(info).isEqualTo(new ProviderUserInfo(SocialProvider.GOOGLE, "1234567890", "drummer@gmail.com", true,
				"드러머", "https://lh3.googleusercontent.com/a/x"));
	}

	@Test
	void ssafyUserInfoIsMappedAndEmailIsAssumedVerified() {
		server.expect(requestTo(SSAFY.userInfoUri()))
				.andExpect(header(HttpHeaders.AUTHORIZATION, "Bearer ssafy-at"))
				.andRespond(withSuccess("{\"userId\":\"a1b2c3\",\"email\":\"me@ssafy.com\",\"name\":\"김싸피\"}",
						MediaType.APPLICATION_JSON));

		var info = client.fetchUserInfo(SSAFY, "ssafy-at");

		assertThat(info).isEqualTo(new ProviderUserInfo(SocialProvider.SSAFY, "a1b2c3", "me@ssafy.com", true, "김싸피", null));
		assertThat(info.toSocialProfile().profileImageUrl()).isNull();
	}

	@Test
	void numericIdStringVerifiedFlagAndMissingOptionalFieldsAreHandled() {
		server.expect(requestTo(GOOGLE.userInfoUri()))
				.andRespond(withSuccess("{\"sub\":42,\"email_verified\":\"true\"}", MediaType.APPLICATION_JSON));

		var info = client.fetchUserInfo(GOOGLE, "at");

		assertThat(info).isEqualTo(new ProviderUserInfo(SocialProvider.GOOGLE, "42", null, true, null, null));
	}

	@Test
	void missingVerifiedFlagMeansUnverified() {
		server.expect(requestTo(GOOGLE.userInfoUri()))
				.andRespond(withSuccess("{\"sub\":\"s\",\"email\":\"x@gmail.com\"}", MediaType.APPLICATION_JSON));

		assertThat(client.fetchUserInfo(GOOGLE, "at").emailVerified()).isFalse();
	}

	@Test
	void userInfoErrorOrMissingIdFails() {
		server.expect(requestTo(GOOGLE.userInfoUri())).andRespond(withStatus(HttpStatus.UNAUTHORIZED));
		assertFailure(() -> client.fetchUserInfo(GOOGLE, "expired"), Reason.USER_INFO_FAILED);

		server.reset();
		server.expect(requestTo(GOOGLE.userInfoUri()))
				.andRespond(withSuccess("{\"email\":\"x@gmail.com\"}", MediaType.APPLICATION_JSON));
		assertFailure(() -> client.fetchUserInfo(GOOGLE, "at"), Reason.USER_INFO_FAILED);
	}

	private static void assertFailure(Runnable call, Reason reason) {
		assertThatExceptionOfType(OAuth2FlowException.class)
				.isThrownBy(call::run)
				.satisfies(ex -> assertThat(ex.getReason()).isEqualTo(reason));
	}

}
