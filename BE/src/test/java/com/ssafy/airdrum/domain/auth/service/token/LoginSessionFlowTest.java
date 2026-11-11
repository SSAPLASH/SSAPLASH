package com.ssafy.airdrum.domain.auth.service.token;

import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.restclient.test.autoconfigure.AutoConfigureMockRestServiceServer;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.ApplicationContext;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import com.ssafy.airdrum.domain.auth.controller.oauth.AuthControllerTest;
import com.ssafy.airdrum.domain.auth.controller.token.TokenControllerTest;

/**
 * 설계 문서(88) 4-A·4-B, 인수 조건 3·4: 소셜 로그인 콜백이 refresh 쿠키를 심고, 그 쿠키로 access 토큰을 받아 보호 API를 부른다.
 * 87번의 콜백 테스트(AuthControllerTest)는 세션 발급기를 대역으로 두므로, 실제 발급기를 쓰는 흐름은 여기서 본다.
 */
@SpringBootTest(properties = { "GOOGLE_CLIENT_ID=google-id", "GOOGLE_CLIENT_SECRET=google-secret",
		"FRONTEND_BASE_URL=http://localhost:5173", "COOKIE_SECURE=true", "ADMIN_EMAILS=" })
@AutoConfigureMockMvc
@AutoConfigureMockRestServiceServer
@Transactional
class LoginSessionFlowTest {

	@Autowired
	private MockMvc mvc;

	@Autowired
	private MockRestServiceServer server;

	@Autowired
	private ApplicationContext context;

	@Test
	void noopSessionIssuerIsGone() {
		assertThat(context.getBeansOfType(LoginSessionIssuer.class)).hasSize(1)
				.allSatisfy((name, issuer) -> assertThat(issuer).isInstanceOf(RefreshCookieLoginSessionIssuer.class));
	}

	@Test
	void callbackSetsRefreshCookieThatYieldsAccessToken() throws Exception {
		var state = mvc.perform(get("/api/auth/google/login")).andReturn().getResponse().getCookie("oauth_state")
				.getValue();
		server.expect(requestTo(AuthControllerTest.GOOGLE_TOKEN))
				.andRespond(withSuccess("{\"access_token\":\"google-at\"}", MediaType.APPLICATION_JSON));
		server.expect(requestTo(AuthControllerTest.GOOGLE_USERINFO))
				.andRespond(withSuccess("{\"sub\":\"g-flow\",\"email\":\"flow@example.com\",\"email_verified\":true,"
						+ "\"name\":\"흐름\"}", MediaType.APPLICATION_JSON));

		var callback = mvc.perform(get("/api/auth/google/callback").param("code", "c").param("state", state)
				.cookie(new Cookie("oauth_state", state))).andReturn();

		assertThat(callback.getResponse().getStatus()).isEqualTo(302);
		assertThat(callback.getResponse().getHeader(HttpHeaders.LOCATION)).isEqualTo(AuthControllerTest.SUCCESS_URL);
		assertThat(callback.getResponse().getHeaders(HttpHeaders.SET_COOKIE))
				.anySatisfy(cookie -> assertThat(cookie).matches("refresh_token=[A-Za-z0-9_-]{43};.*")
						.contains("Max-Age=1209600").contains("Path=/api/auth").contains("HttpOnly")
						.contains("Secure").contains("SameSite=Lax"));
		var refreshToken = TokenControllerTest.cookieValue(callback);

		var refreshed = mvc.perform(post("/api/auth/refresh").cookie(TokenControllerTest.refreshCookie(refreshToken)))
				.andExpect(status().isOk()).andReturn();
		var accessToken = new tools.jackson.databind.json.JsonMapper()
				.readTree(refreshed.getResponse().getContentAsString()).path("accessToken").asString();

		// 갓 가입한 회원은 가입 동의 전이라, 가입 게이트 허용 목록의 /me로 확인한다(가입 동의 설계 4-1)
		mvc.perform(get("/api/users/me").header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.role").value("USER"))
				.andExpect(jsonPath("$.signupCompleted").value(false));
	}

}
