package com.ssafy.airdrum.user;

import java.time.Instant;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.auth.AccessTokenService;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 설계 문서(88) 3-3, 인수 조건 1·8: 내 정보 조회의 필드 계약(FE 회신 2절). */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class UserControllerTest {

	@Autowired
	private MockMvc mvc;

	@Autowired
	private AccessTokenService tokens;

	@Autowired
	private UserRepository users;

	@Autowired
	private SocialAccountRepository socialAccounts;

	@Test
	void meReturnsExactlyContractFields() throws Exception {
		var user = users.saveAndFlush(User.create("드러머", "secret@example.com", "https://img.example.com/a.png"));
		socialAccounts.saveAndFlush(SocialAccount.connect(user, SocialProvider.GOOGLE, "g-me", "secret@example.com"));

		var result = mvc.perform(get("/api/users/me").header(HttpHeaders.AUTHORIZATION, bearer(user)))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.id").value(user.getId()))
				.andExpect(jsonPath("$.provider").value("GOOGLE"))
				.andExpect(jsonPath("$.nickname").value("드러머"))
				.andExpect(jsonPath("$.profileImageUrl").value("https://img.example.com/a.png"))
				.andExpect(jsonPath("$.role").value("USER"))
				.andReturn();

		var body = new JsonMapper().readTree(result.getResponse().getContentAsString());
		assertThat(body.propertyNames()).containsExactlyInAnyOrder("id", "provider", "nickname", "profileImageUrl",
				"role", "createdAt", "updatedAt", "signupCompleted", "consents", "dataConsent");
		assertThat(body.path("createdAt").asString()).matches("\\d{4}-\\d{2}-\\d{2}T.*Z");
		assertThat(result.getResponse().getContentAsString()).doesNotContain("secret@example.com")
				.doesNotContain("ACTIVE");
	}

	@Test
	void nullProfileImageIsPresentAsNull() throws Exception {
		var user = users.saveAndFlush(User.create("싸피", null, null));
		socialAccounts.saveAndFlush(SocialAccount.connect(user, SocialProvider.SSAFY, "s-me", null));

		var result = mvc.perform(get("/api/users/me").header(HttpHeaders.AUTHORIZATION, bearer(user)))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.provider").value("SSAFY"))
				.andReturn();

		var body = new JsonMapper().readTree(result.getResponse().getContentAsString());
		assertThat(body.has("profileImageUrl")).isTrue();
		assertThat(body.path("profileImageUrl").isNull()).isTrue();
	}

	@Test
	void meRequiresToken() throws Exception {
		mvc.perform(get("/api/users/me"))
				.andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
	}

	private String bearer(User user) {
		return "Bearer " + tokens.issue(new AuthUser(user.getId(), user.getRole()), Instant.now()).token();
	}

}
