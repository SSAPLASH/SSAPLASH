package com.ssafy.airdrum.domain.auth.controller.token;

import jakarta.persistence.EntityManager;
import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.domain.auth.security.SecurityConfigTest;
import com.ssafy.airdrum.domain.auth.service.token.RefreshTokenService;
import com.ssafy.airdrum.support.SignupConsentFixtures;
import com.ssafy.airdrum.domain.user.model.AuthUser;
import com.ssafy.airdrum.domain.user.entity.User;
import com.ssafy.airdrum.domain.user.repository.UserRepository;
import com.ssafy.airdrum.domain.user.model.UserRole;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 설계 문서(88) 3-3·4-B·4-D, 인수 조건 4~7: 재발급·로그아웃 API. */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
@ExtendWith(OutputCaptureExtension.class)
public class TokenControllerTest {

	static final String REFRESH = "/api/auth/refresh";
	static final String LOGOUT = "/api/auth/logout";

	@Autowired
	private MockMvc mvc;

	@Autowired
	private RefreshTokenService refreshTokens;

	@Autowired
	private UserRepository users;

	@Autowired
	private EntityManager em;

	@Test
	void refreshIssuesAccessTokenAndRotatesCookie() throws Exception {
		var user = users.saveAndFlush(SignupConsentFixtures.completed(User.create("드러머", null, null)));
		var token = refreshTokens.issue(new AuthUser(user.getId(), UserRole.USER));

		var result = mvc.perform(post(REFRESH).cookie(refreshCookie(token)))
				.andExpect(status().isOk())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andExpect(jsonPath("$.tokenType").value("Bearer"))
				.andExpect(jsonPath("$.expiresIn").value(1800))
				.andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")))
				.andReturn();

		var rotated = cookieValue(result);
		assertThat(rotated).hasSize(43).isNotEqualTo(token);
		assertThat(result.getResponse().getHeader(HttpHeaders.SET_COOKIE)).contains("Max-Age=1209600")
				.contains("Path=/api/auth").contains("HttpOnly").contains("SameSite=Lax");
		var accessToken = new JsonMapper().readTree(result.getResponse().getContentAsString()).path("accessToken")
				.asString();
		mvc.perform(get(SecurityConfigTest.ME).header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.id").value(user.getId()));
	}

	@Test
	void reusedRefreshTokenIsRejectedWithoutClearingCookie(CapturedOutput output) throws Exception {
		var user = users.saveAndFlush(User.create("드러머", null, null));
		var token = refreshTokens.issue(new AuthUser(user.getId(), UserRole.USER));
		mvc.perform(post(REFRESH).cookie(refreshCookie(token))).andExpect(status().isOk());

		var result = unauthorized(mvc.perform(post(REFRESH).cookie(refreshCookie(token))).andReturn());

		// 설계 U4: 저장소에 없는 토큰은 쿠키를 지우지 않는다(동시 재발급에서 이긴 쿠키 보호).
		assertThat(result.getResponse().getHeaders(HttpHeaders.SET_COOKIE)).isEmpty();
		assertThat(output).contains("401 UNAUTHORIZED").doesNotContain(token);
	}

	@Test
	void missingOrMalformedCookieIsRejectedAndCleared() throws Exception {
		assertCleared(unauthorized(mvc.perform(post(REFRESH)).andReturn()));
		assertCleared(unauthorized(mvc.perform(post(REFRESH).cookie(refreshCookie("A".repeat(42)))).andReturn()));
		assertCleared(unauthorized(mvc.perform(post(REFRESH).cookie(refreshCookie("+".repeat(43)))).andReturn()));
	}

	@Test
	void withdrawnUserIsRejectedClearedAndTokenConsumed() throws Exception {
		var user = users.saveAndFlush(User.create("탈퇴", null, null));
		var token = refreshTokens.issue(new AuthUser(user.getId(), UserRole.USER));
		em.createNativeQuery("update users set status = 'WITHDRAWN', withdrawn_at = now() where id = :id")
				.setParameter("id", user.getId())
				.executeUpdate();
		em.clear();

		assertCleared(unauthorized(mvc.perform(post(REFRESH).cookie(refreshCookie(token))).andReturn()));
		unauthorized(mvc.perform(post(REFRESH).cookie(refreshCookie(token))).andReturn());
	}

	@Test
	void logoutRevokesTokenAndClearsCookie() throws Exception {
		var user = users.saveAndFlush(User.create("드러머", null, null));
		var token = refreshTokens.issue(new AuthUser(user.getId(), UserRole.USER));

		var result = mvc.perform(post(LOGOUT).cookie(refreshCookie(token))).andExpect(status().isNoContent())
				.andReturn();
		assertCleared(result);
		assertThat(result.getResponse().getContentAsString()).isEmpty();

		unauthorized(mvc.perform(post(REFRESH).cookie(refreshCookie(token))).andReturn());
	}

	@Test
	void logoutIsIdempotentWithOrWithoutCookie() throws Exception {
		assertCleared(mvc.perform(post(LOGOUT)).andExpect(status().isNoContent()).andReturn());
		assertCleared(mvc.perform(post(LOGOUT).cookie(refreshCookie("A".repeat(43))))
				.andExpect(status().isNoContent()).andReturn());
		assertCleared(mvc.perform(post(LOGOUT).cookie(refreshCookie("bad"))).andExpect(status().isNoContent())
				.andReturn());
	}

	public static Cookie refreshCookie(String value) {
		return new Cookie("refresh_token", value);
	}

	public static String cookieValue(MvcResult result) {
		var cookie = result.getResponse().getCookie("refresh_token");
		assertThat(cookie).isNotNull();
		return cookie.getValue();
	}

	private static MvcResult unauthorized(MvcResult result) throws Exception {
		assertThat(result.getResponse().getStatus()).isEqualTo(401);
		assertThat(result.getResponse().getContentType()).startsWith(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
		var body = new JsonMapper().readTree(result.getResponse().getContentAsString());
		assertThat(body.path("code").asString()).isEqualTo("UNAUTHORIZED");
		assertThat(body.path("detail").asString()).isEqualTo("다시 로그인해 주세요.");
		assertThat(body.path("instance").asString()).isEqualTo(REFRESH);
		return result;
	}

	private static void assertCleared(MvcResult result) {
		assertThat(result.getResponse().getHeaders(HttpHeaders.SET_COOKIE))
				.anySatisfy(cookie -> assertThat(cookie).startsWith("refresh_token=;").contains("Max-Age=0")
						.contains("Path=/api/auth"));
	}

}
