package com.ssafy.airdrum.domain.withdrawal.controller;

import java.time.Instant;

import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.airdrum.domain.auth.service.token.AccessTokenService;
import com.ssafy.airdrum.domain.auth.service.token.RefreshTokenService;
import com.ssafy.airdrum.domain.user.model.AuthUser;
import com.ssafy.airdrum.domain.user.entity.SocialAccount;
import com.ssafy.airdrum.domain.user.repository.SocialAccountRepository;
import com.ssafy.airdrum.domain.user.service.social.SocialLoginService;
import com.ssafy.airdrum.domain.user.model.SocialProfile;
import com.ssafy.airdrum.domain.user.model.SocialProvider;
import com.ssafy.airdrum.domain.user.entity.User;
import com.ssafy.airdrum.domain.user.repository.UserRepository;
import com.ssafy.airdrum.domain.user.model.UserStatus;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 탈퇴 설계 3-1·4장 D, 인수 조건 1·2·5·7: 탈퇴 API 응답과 탈퇴 뒤 토큰·재로그인. */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class WithdrawalControllerTest {

	private static final String ME = "/api/users/me";

	@Autowired
	private MockMvc mvc;

	@Autowired
	private AccessTokenService accessTokens;

	@Autowired
	private RefreshTokenService refreshTokens;

	@Autowired
	private UserRepository users;

	@Autowired
	private SocialAccountRepository socialAccounts;

	@Autowired
	private SocialLoginService socialLogin;

	@Test
	void withdrawReturnsNoContentAndClearsRefreshCookie() throws Exception {
		var user = member("g-api");

		var result = mvc.perform(delete(ME).header(HttpHeaders.AUTHORIZATION, bearer(user)))
				.andExpect(status().isNoContent())
				.andReturn();

		assertCleared(result);
		assertThat(result.getResponse().getContentAsString()).isEmpty();
		assertThat(users.findById(user.getId()).orElseThrow().getStatus()).isEqualTo(UserStatus.WITHDRAWN);
	}

	@Test
	void sameAccessTokenIsRejectedAfterWithdrawal() throws Exception {
		var user = member("g-access");
		var bearer = bearer(user);
		mvc.perform(delete(ME).header(HttpHeaders.AUTHORIZATION, bearer)).andExpect(status().isNoContent());

		for (var path : new String[] { ME, "/api/presets" }) {
			mvc.perform(get(path).header(HttpHeaders.AUTHORIZATION, bearer))
					.andExpect(status().isUnauthorized())
					.andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
		}
		// 두 번째 탈퇴 요청도 필터에서 401
		mvc.perform(delete(ME).header(HttpHeaders.AUTHORIZATION, bearer))
				.andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
	}

	/** 탈퇴가 토큰을 폐기했으므로 재발급은 UNKNOWN으로 401이다. 쿠키는 탈퇴 응답이 이미 지웠다(설계 4장 D). */
	@Test
	void sameRefreshCookieIsRejectedAfterWithdrawal() throws Exception {
		var user = member("g-refresh");
		var token = refreshTokens.issue(new AuthUser(user.getId(), user.getRole()));
		mvc.perform(delete(ME).header(HttpHeaders.AUTHORIZATION, bearer(user))).andExpect(status().isNoContent());

		mvc.perform(post("/api/auth/refresh").cookie(new Cookie("refresh_token", token)))
				.andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
	}

	@Test
	void withdrawRequiresToken() throws Exception {
		mvc.perform(delete(ME))
				.andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
	}

	@Test
	void sameSocialAccountSignsUpAsNewMemberAfterWithdrawal() throws Exception {
		var user = member("g-again");
		mvc.perform(delete(ME).header(HttpHeaders.AUTHORIZATION, bearer(user))).andExpect(status().isNoContent());

		var again = socialLogin.login(new SocialProfile(SocialProvider.GOOGLE, "g-again", null, false, "다시온회원", null));

		assertThat(again.getId()).isNotEqualTo(user.getId());
		assertThat(again.getStatus()).isEqualTo(UserStatus.ACTIVE);
		assertThat(users.findById(user.getId()).orElseThrow().getStatus()).isEqualTo(UserStatus.WITHDRAWN);
	}

	private User member(String providerUserId) {
		var user = users.saveAndFlush(User.create("드러머", "drummer@example.com", null));
		socialAccounts.saveAndFlush(SocialAccount.connect(user, SocialProvider.GOOGLE, providerUserId, null));
		return user;
	}

	private String bearer(User user) {
		return "Bearer " + accessTokens.issue(new AuthUser(user.getId(), user.getRole()), Instant.now()).token();
	}

	private static void assertCleared(MvcResult result) {
		assertThat(result.getResponse().getHeaders(HttpHeaders.SET_COOKIE))
				.anySatisfy(cookie -> assertThat(cookie).startsWith("refresh_token=;").contains("Max-Age=0")
						.contains("Path=/api/auth"));
	}

}
