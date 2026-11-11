package com.ssafy.airdrum.domain.user.controller;

import java.time.Instant;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.airdrum.domain.user.entity.SocialAccount;
import com.ssafy.airdrum.domain.user.entity.User;
import com.ssafy.airdrum.domain.user.model.SocialProvider;
import com.ssafy.airdrum.domain.user.repository.SocialAccountRepository;
import com.ssafy.airdrum.domain.user.repository.UserRepository;
import com.ssafy.airdrum.domain.auth.service.token.AccessTokenService;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 허용 판이 설정된 서버에서 가입 동의 API는 화면 없이 직접 불러도 허용되지 않은 판은 저장하지 않는다.
 * (허용 판이 비어 있으면 기존 동작이라 {@link SignupConsentApiTest}가 그대로 통과한다.)
 */
@SpringBootTest(properties = { "SIGNUP_CONSENT_TERMS_VERSIONS=t-old, t-2026-11", "SIGNUP_CONSENT_PRIVACY_VERSIONS=p-2026-11",
		"SIGNUP_CONSENT_DATA_VERSIONS=d-2026-11" })
@AutoConfigureMockMvc
@Transactional
class SignupConsentVersionApiTest {

	private static final String PATH = "/api/users/me/signup-consent";

	@Autowired
	private MockMvc mvc;

	@Autowired
	private AccessTokenService tokens;

	@Autowired
	private UserRepository users;

	@Autowired
	private SocialAccountRepository socialAccounts;

	@Test
	void allowedVersionsAreSaved() throws Exception {
		var user = member("허용판");

		post(user, body("t-2026-11", "p-2026-11", "d-2026-11")).andExpect(status().isOk())
				.andExpect(jsonPath("$.signupCompleted").value(true));
	}

	@Test
	void anotherAllowedTermsVersionIsAlsoSaved() throws Exception {
		var user = member("옛판허용");

		post(user, body("t-old", "p-2026-11", "d-2026-11")).andExpect(status().isOk());
	}

	@Test
	void unknownVersionIsRejectedWith422AndNothingIsSaved() throws Exception {
		var user = member("미허용판");

		post(user, body("t-9999", "p-2026-11", "d-2026-11")).andExpect(status().isUnprocessableEntity())
				.andExpect(jsonPath("$.code").value("SIGNUP_CONSENT_VERSION_INVALID"))
				.andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("termsVersion")));
		post(user, body("t-2026-11", "임의 문자열", "d-2026-11")).andExpect(status().isUnprocessableEntity());
		post(user, body("t-2026-11", "p-2026-11", "d-9999")).andExpect(status().isUnprocessableEntity());

		// 거절된 요청은 아무것도 기록하지 않아 여전히 가입 미완료다
		mvc.perform(get("/api/users/me").header(HttpHeaders.AUTHORIZATION, bearer(user))).andExpect(status().isOk())
				.andExpect(jsonPath("$.signupCompleted").value(false));
	}

	@Test
	void theErrorResponseDoesNotEchoTheSentVersion() throws Exception {
		var user = member("에코금지");

		var response = post(user, body("비밀스러운-판-값", "p-2026-11", "d-2026-11")).andExpect(status().isUnprocessableEntity())
				.andReturn().getResponse().getContentAsString();

		assertThat(response).doesNotContain("비밀스러운-판-값");
	}

	private static String body(String terms, String privacy, String dataVersion) {
		return "{\"termsVersion\":\"" + terms + "\",\"privacyVersion\":\"" + privacy
				+ "\",\"dataConsent\":{\"agreed\":true,\"version\":\"" + dataVersion + "\"}}";
	}

	private ResultActions post(User user, String body) throws Exception {
		return mvc.perform(MockMvcRequestBuilders.post(PATH).header(HttpHeaders.AUTHORIZATION, bearer(user))
				.contentType(MediaType.APPLICATION_JSON).content(body));
	}

	private User member(String nickname) {
		var user = users.saveAndFlush(User.create(nickname, null, null));
		socialAccounts.saveAndFlush(SocialAccount.connect(user, SocialProvider.GOOGLE, "g-" + nickname, null));
		return user;
	}

	private String bearer(User user) {
		return "Bearer " + tokens.issue(new com.ssafy.airdrum.domain.user.model.AuthUser(user.getId(), user.getRole()), Instant.now()).token();
	}

}
