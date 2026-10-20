package com.ssafy.airdrum.auth;

import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.restclient.test.autoconfigure.AutoConfigureMockRestServiceServer;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.client.ExpectedCount;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.util.UriComponentsBuilder;

import com.ssafy.airdrum.user.SocialAccountRepository;
import com.ssafy.airdrum.user.SocialProvider;
import com.ssafy.airdrum.user.User;
import com.ssafy.airdrum.user.UserRepository;
import com.ssafy.airdrum.user.UserRole;
import com.ssafy.airdrum.user.UserStatus;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 설계 문서 3-3·4-A~C, 인수 조건 1~4·6·7: 로그인 시작과 콜백을 실제 컨텍스트에서 확인한다.
 * 제공자는 MockRestServiceServer가 대신하고, 결과가 로컬 BE/.env에 흔들리지 않도록 환경변수를 모두 지정한다.
 */
@SpringBootTest(properties = {
		"GOOGLE_CLIENT_ID=google-id", "GOOGLE_CLIENT_SECRET=google-secret",
		"SSAFY_CLIENT_ID=ssafy-id", "SSAFY_CLIENT_SECRET=ssafy-secret",
		"FRONTEND_BASE_URL=http://localhost:5173", "OAUTH_REDIRECT_BASE_URL=http://localhost:8080",
		"COOKIE_SECURE=true", "ADMIN_EMAILS=admin@example.com" })
@AutoConfigureMockMvc
@AutoConfigureMockRestServiceServer
@Transactional
class AuthControllerTest {

	static final String GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
	static final String GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";
	static final String SSAFY_TOKEN = "https://project.ssafy.com/ssafy/oauth2/token";
	static final String SSAFY_USERINFO = "https://project.ssafy.com/ssafy/resources/userInfo";
	static final String SUCCESS_URL = "http://localhost:5173/auth/callback";
	static final String FAILURE_URL = "http://localhost:5173/login?error=";

	@Autowired
	private MockMvc mvc;

	@Autowired
	private MockRestServiceServer server;

	@Autowired
	private UserRepository users;

	@Autowired
	private SocialAccountRepository socialAccounts;

	@MockitoBean
	private LoginSessionIssuer sessionIssuer;

	@Test
	void googleLoginRedirectsToAuthorizationEndpointWithStateCookie() throws Exception {
		var result = mvc.perform(get("/api/auth/google/login")).andExpect(status().isFound()).andReturn();

		var location = UriComponentsBuilder.fromUriString(result.getResponse().getHeader(HttpHeaders.LOCATION)).build();
		assertThat(location.getScheme() + "://" + location.getHost() + location.getPath())
				.isEqualTo("https://accounts.google.com/o/oauth2/v2/auth");
		var query = location.getQueryParams();
		assertThat(query.getFirst("response_type")).isEqualTo("code");
		assertThat(query.getFirst("client_id")).isEqualTo("google-id");
		assertThat(decode(query.getFirst("redirect_uri"))).isEqualTo("http://localhost:8080/api/auth/google/callback");
		assertThat(decode(query.getFirst("scope"))).isEqualTo("openid email profile");
		assertThat(query.getFirst("state")).isEqualTo(stateCookie(result).getValue());
		assertThat(result.getResponse().getHeader(HttpHeaders.SET_COOKIE))
				.contains("HttpOnly").contains("SameSite=Lax").contains("Path=/api/auth").contains("Max-Age=300");
	}

	@Test
	void ssafyLoginRedirectsToPortalWithoutScope() throws Exception {
		var result = mvc.perform(get("/api/auth/ssafy/login")).andExpect(status().isFound()).andReturn();

		var location = UriComponentsBuilder.fromUriString(result.getResponse().getHeader(HttpHeaders.LOCATION)).build();
		assertThat(location.getHost() + location.getPath()).isEqualTo("project.ssafy.com/oauth/sso-check");
		assertThat(location.getQueryParams()).containsKeys("response_type", "client_id", "redirect_uri", "state")
				.doesNotContainKey("scope");
	}

	@Test
	void unsupportedProviderIsNotFoundProblem() throws Exception {
		for (var path : new String[] { "/api/auth/kakao/login", "/api/auth/kakao/callback?code=c&state=s" }) {
			mvc.perform(get(path))
					.andExpect(status().isNotFound())
					.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
					.andExpect(jsonPath("$.code").value("AUTH_PROVIDER_NOT_SUPPORTED"));
		}
	}

	@Test
	void googleCallbackCreatesUserIssuesSessionAndRedirectsToFrontend() throws Exception {
		var state = startLogin("google");
		server.expect(requestTo(GOOGLE_TOKEN)).andExpect(method(HttpMethod.POST))
				.andRespond(withSuccess("{\"access_token\":\"google-at\",\"token_type\":\"Bearer\",\"expires_in\":3599}",
						MediaType.APPLICATION_JSON));
		server.expect(requestTo(GOOGLE_USERINFO)).andExpect(header(HttpHeaders.AUTHORIZATION, "Bearer google-at"))
				.andRespond(withSuccess("{\"sub\":\"g-100\",\"email\":\"Admin@Example.com\",\"email_verified\":true,"
						+ "\"name\":\"관리자\",\"picture\":\"https://img.example.com/p.png\"}", MediaType.APPLICATION_JSON));

		var result = callback("google", "auth-code", state, state);

		assertThat(result.getResponse().getStatus()).isEqualTo(HttpStatus.FOUND.value());
		assertThat(result.getResponse().getHeader(HttpHeaders.LOCATION)).isEqualTo(SUCCESS_URL);
		assertStateCookieDeleted(result);
		server.verify();

		var account = socialAccounts.findByProviderAndProviderUserId(SocialProvider.GOOGLE, "g-100").orElseThrow();
		var user = users.findById(account.getUser().getId()).orElseThrow();
		assertThat(user.getNickname()).isEqualTo("관리자");
		assertThat(user.getEmail()).isEqualTo("Admin@Example.com");
		assertThat(user.getProfileImageUrl()).isEqualTo("https://img.example.com/p.png");
		assertThat(user.getRole()).isEqualTo(UserRole.ADMIN);
		assertThat(user.getStatus()).isEqualTo(UserStatus.ACTIVE);
		verify(sessionIssuer).issue(any(User.class), any());
	}

	@Test
	void ssafyCallbackCreatesUserWithoutImage() throws Exception {
		var state = startLogin("ssafy");
		server.expect(requestTo(SSAFY_TOKEN))
				.andRespond(withSuccess("{\"token_type\":\"bearer\",\"access_token\":\"ssafy-at\",\"expires_in\":\"43199\"}",
						MediaType.APPLICATION_JSON));
		server.expect(requestTo(SSAFY_USERINFO)).andExpect(header(HttpHeaders.AUTHORIZATION, "Bearer ssafy-at"))
				.andRespond(withSuccess("{\"userId\":\"s-200\",\"email\":\"me@ssafy.com\",\"name\":\"김싸피\"}",
						MediaType.APPLICATION_JSON));

		var result = callback("ssafy", "ssafy-code", state, state);

		assertThat(result.getResponse().getHeader(HttpHeaders.LOCATION)).isEqualTo(SUCCESS_URL);
		var user = socialAccounts.findByProviderAndProviderUserId(SocialProvider.SSAFY, "s-200").orElseThrow().getUser();
		assertThat(user.getNickname()).isEqualTo("김싸피");
		assertThat(user.getProfileImageUrl()).isNull();
		assertThat(user.getRole()).isEqualTo(UserRole.USER);
	}

	@Test
	void stateProblemsRedirectWithOauthFailedWithoutCallingProvider() throws Exception {
		server.expect(ExpectedCount.never(), requestTo(GOOGLE_TOKEN));
		var countBefore = users.count();

		assertFailure(callback("google", "code", "state-a", "state-b"), "oauth_failed");
		assertFailure(callback("google", "code", null, "state-a"), "oauth_failed");
		assertFailure(callback("google", "code", "state-a", null), "oauth_failed");
		assertFailure(callback("google", null, "state-a", "state-a"), "oauth_failed");

		server.verify();
		assertThat(users.count()).isEqualTo(countBefore);
		verify(sessionIssuer, never()).issue(any(), any());
	}

	@Test
	void providerErrorsMapToAccessDeniedOrOauthFailed() throws Exception {
		var denied = mvc.perform(get("/api/auth/google/callback").param("error", "access_denied").param("state", "s")
				.cookie(new Cookie("oauth_state", "s"))).andReturn();
		assertFailure(denied, "access_denied");

		var other = mvc.perform(get("/api/auth/google/callback").param("error", "server_error").param("state", "s")
				.cookie(new Cookie("oauth_state", "s"))).andReturn();
		assertFailure(other, "oauth_failed");
	}

	@Test
	void tokenOrUserInfoFailureRedirectsWithOauthFailed() throws Exception {
		server.expect(requestTo(GOOGLE_TOKEN)).andRespond(withStatus(HttpStatus.BAD_REQUEST));
		assertFailure(callback("google", "bad-code", "s1", "s1"), "oauth_failed");

		server.reset();
		server.expect(requestTo(GOOGLE_TOKEN))
				.andRespond(withSuccess("{\"access_token\":\"at\"}", MediaType.APPLICATION_JSON));
		server.expect(requestTo(GOOGLE_USERINFO))
				.andRespond(withSuccess("{\"email\":\"no-sub@example.com\"}", MediaType.APPLICATION_JSON));
		assertFailure(callback("google", "code", "s2", "s2"), "oauth_failed");
		verify(sessionIssuer, never()).issue(any(), any());
	}

	@Test
	void sessionIssuerFailureRedirectsWithOauthFailed() throws Exception {
		doThrow(new IllegalStateException("발급 실패")).when(sessionIssuer).issue(any(), any());
		server.expect(requestTo(GOOGLE_TOKEN))
				.andRespond(withSuccess("{\"access_token\":\"at\"}", MediaType.APPLICATION_JSON));
		server.expect(requestTo(GOOGLE_USERINFO))
				.andRespond(withSuccess("{\"sub\":\"g-300\"}", MediaType.APPLICATION_JSON));

		assertFailure(callback("google", "code", "s", "s"), "oauth_failed");
	}

	private String startLogin(String provider) throws Exception {
		var result = mvc.perform(get("/api/auth/" + provider + "/login")).andReturn();
		return stateCookie(result).getValue();
	}

	private MvcResult callback(String provider, String code, String state, String cookie) throws Exception {
		var request = get("/api/auth/" + provider + "/callback");
		if (code != null) {
			request.param("code", code);
		}
		if (state != null) {
			request.param("state", state);
		}
		if (cookie != null) {
			request.cookie(new Cookie("oauth_state", cookie));
		}
		return mvc.perform(request).andReturn();
	}

	private static void assertFailure(MvcResult result, String error) {
		assertThat(result.getResponse().getStatus()).isEqualTo(HttpStatus.FOUND.value());
		assertThat(result.getResponse().getHeader(HttpHeaders.LOCATION)).isEqualTo(FAILURE_URL + error);
		assertStateCookieDeleted(result);
	}

	private static void assertStateCookieDeleted(MvcResult result) {
		assertThat(result.getResponse().getHeaders(HttpHeaders.SET_COOKIE))
				.anySatisfy(cookie -> assertThat(cookie).startsWith("oauth_state=;").contains("Max-Age=0"));
	}

	private static Cookie stateCookie(MvcResult result) {
		var cookie = result.getResponse().getCookie("oauth_state");
		assertThat(cookie).isNotNull();
		return cookie;
	}

	private static String decode(String value) {
		return java.net.URLDecoder.decode(value, java.nio.charset.StandardCharsets.UTF_8);
	}

}
