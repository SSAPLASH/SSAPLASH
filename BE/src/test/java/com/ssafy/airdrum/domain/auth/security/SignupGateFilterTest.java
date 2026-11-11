package com.ssafy.airdrum.domain.auth.security;

import java.time.Instant;

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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.airdrum.domain.auth.service.token.AccessTokenService;
import com.ssafy.airdrum.support.SignupConsentFixtures;
import com.ssafy.airdrum.domain.user.model.AuthUser;
import com.ssafy.airdrum.domain.user.entity.SocialAccount;
import com.ssafy.airdrum.domain.user.repository.SocialAccountRepository;
import com.ssafy.airdrum.domain.user.model.SocialProvider;
import com.ssafy.airdrum.domain.user.entity.User;
import com.ssafy.airdrum.domain.user.repository.UserRepository;
import com.ssafy.airdrum.domain.user.model.UserRole;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 가입 동의 설계 3-4·4-2, 인수 조건 2~6: 가입을 마치지 않은 USER는 허용 목록 밖 API에서 403 {@code SIGNUP_INCOMPLETE}를
 * 받는다. ADMIN은 면제이고, 토큰이 없거나 무효면 401이 먼저다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
@ExtendWith(OutputCaptureExtension.class)
class SignupGateFilterTest {

	private static final String PROBE = SecurityConfigTest.ME;

	private static final String SIGNUP_CONSENT = "/api/users/me/signup-consent";

	private static final String VALID_CONSENT = "{\"termsVersion\":\"t1\",\"privacyVersion\":\"p1\","
			+ "\"dataConsent\":{\"agreed\":true,\"version\":\"d1\"}}";

	@Autowired
	private MockMvc mvc;

	@Autowired
	private AccessTokenService tokens;

	@Autowired
	private UserRepository users;

	@Autowired
	private SocialAccountRepository socialAccounts;

	@Test
	void incompleteUserIsForbiddenOutsideAllowList(CapturedOutput output) throws Exception {
		var user = member("미동의", false);

		for (var path : new String[] { PROBE, "/api/presets", "/api/v1/songs" }) {
			mvc.perform(get(path).header(HttpHeaders.AUTHORIZATION, bearer(user)))
					.andExpect(status().isForbidden())
					.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
					.andExpect(jsonPath("$.code").value("SIGNUP_INCOMPLETE"))
					.andExpect(jsonPath("$.status").value(403))
					.andExpect(jsonPath("$.title").value("가입 미완료"))
					.andExpect(jsonPath("$.detail").value("가입 동의가 필요합니다."))
					.andExpect(jsonPath("$.instance").value(path));
		}
		assertThat(output).contains("GET /api/presets -> 403 SIGNUP_INCOMPLETE: 가입 동의가 필요합니다.");
	}

	/** 같은 경로라도 허용 목록의 메서드가 아니면 막는다. */
	@Test
	void allowListMatchesMethodAndPath() throws Exception {
		var user = member("메서드", false);

		mvc.perform(post("/api/users/me").header(HttpHeaders.AUTHORIZATION, bearer(user)))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.code").value("SIGNUP_INCOMPLETE"));
		mvc.perform(get(SIGNUP_CONSENT).header(HttpHeaders.AUTHORIZATION, bearer(user)))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.code").value("SIGNUP_INCOMPLETE"));
	}

	@Test
	void incompleteUserCanUseAllowList() throws Exception {
		var user = member("허용", false);
		var token = bearer(user);

		mvc.perform(get("/api/users/me").header(HttpHeaders.AUTHORIZATION, token))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.signupCompleted").value(false));
		assertNotGated(perform(post("/api/auth/refresh").header(HttpHeaders.AUTHORIZATION, token)));
		assertNotGated(perform(post("/api/auth/logout").header(HttpHeaders.AUTHORIZATION, token)));
		assertNotGated(perform(options("/api/presets").header(HttpHeaders.AUTHORIZATION, token)
				.header(HttpHeaders.ORIGIN, "http://localhost:5173")
				.header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET")));
		mvc.perform(post(SIGNUP_CONSENT).header(HttpHeaders.AUTHORIZATION, token)
				.contentType(MediaType.APPLICATION_JSON).content(VALID_CONSENT))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.signupCompleted").value(true));
	}

	/** 동의 전 회원의 탈퇴(가입 취소)도 막지 않는다. */
	@Test
	void incompleteUserCanWithdraw() throws Exception {
		var user = member("가입취소", false);

		mvc.perform(delete("/api/users/me").header(HttpHeaders.AUTHORIZATION, bearer(user)))
				.andExpect(status().isNoContent());
	}

	/** 인수 조건 4(U5): ADMIN은 동의 전이어도 막지 않지만 /me는 사실대로 false다. */
	@Test
	void incompleteAdminIsExempt() throws Exception {
		var admin = member("관리자", false);
		admin.changeRole(UserRole.ADMIN);
		users.saveAndFlush(admin);
		var token = bearer(admin);

		mvc.perform(get(SecurityConfigTest.ADMIN).header(HttpHeaders.AUTHORIZATION, token))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.signupCompleted").value(false));
		mvc.perform(get("/api/presets").header(HttpHeaders.AUTHORIZATION, token)).andExpect(status().isOk());
		mvc.perform(get("/api/users/me").header(HttpHeaders.AUTHORIZATION, token))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.role").value("ADMIN"))
				.andExpect(jsonPath("$.signupCompleted").value(false));
	}

	/** 인수 조건 5: 토큰이 없거나 무효면 게이트가 아니라 401이다. */
	@Test
	void missingOrInvalidTokenIsUnauthorizedNotForbidden() throws Exception {
		mvc.perform(get("/api/presets"))
				.andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
		mvc.perform(get("/api/presets").header(HttpHeaders.AUTHORIZATION, "Bearer abc.def.ghi"))
				.andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
	}

	/** 인수 조건 6: 동의를 저장하면 다음 요청부터 다른 API가 된다(같은 access 토큰). */
	@Test
	void consentOpensOtherApisOnNextRequest() throws Exception {
		var user = member("동의후", false);
		var token = bearer(user);
		mvc.perform(get(PROBE).header(HttpHeaders.AUTHORIZATION, token)).andExpect(status().isForbidden());

		mvc.perform(post(SIGNUP_CONSENT).header(HttpHeaders.AUTHORIZATION, token)
				.contentType(MediaType.APPLICATION_JSON).content(VALID_CONSENT)).andExpect(status().isOk());

		mvc.perform(get(PROBE).header(HttpHeaders.AUTHORIZATION, token))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.signupCompleted").value(true));
		mvc.perform(get("/api/presets").header(HttpHeaders.AUTHORIZATION, token)).andExpect(status().isOk());
	}

	@Test
	void completedUserPassesGate() throws Exception {
		var user = member("완료", true);

		mvc.perform(get(PROBE).header(HttpHeaders.AUTHORIZATION, bearer(user)))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.id").value(user.getId()));
	}

	private MvcResult perform(MockHttpServletRequestBuilder request) throws Exception {
		return mvc.perform(request).andReturn();
	}

	private static void assertNotGated(MvcResult result) throws Exception {
		assertThat(result.getResponse().getStatus()).isNotEqualTo(403);
		assertThat(result.getResponse().getContentAsString()).doesNotContain("SIGNUP_INCOMPLETE");
	}

	private User member(String nickname, boolean signupCompleted) {
		var user = User.create(nickname, null, null);
		user = users.saveAndFlush(signupCompleted ? SignupConsentFixtures.completed(user) : user);
		socialAccounts.saveAndFlush(SocialAccount.connect(user, SocialProvider.GOOGLE, "g-gate-" + nickname, null));
		return user;
	}

	private String bearer(User user) {
		return "Bearer " + tokens.issue(new AuthUser(user.getId(), user.getRole()), Instant.now()).token();
	}

}
