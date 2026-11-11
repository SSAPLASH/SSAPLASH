package com.ssafy.airdrum.domain.user.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.airdrum.domain.user.entity.SocialAccount;
import com.ssafy.airdrum.domain.user.entity.User;
import com.ssafy.airdrum.domain.user.model.AuthUser;
import com.ssafy.airdrum.domain.user.model.SocialProvider;
import com.ssafy.airdrum.domain.user.repository.SocialAccountRepository;
import com.ssafy.airdrum.domain.user.repository.UserRepository;
import com.ssafy.airdrum.domain.auth.service.token.AccessTokenService;

/** 추천 학습 동의 API: FE가 부르는 경로, 입력 검증, 허용 판, 가입 본문의 선택 항목, 철회 시 후보 삭제. */
@SpringBootTest(properties = "SIGNUP_CONSENT_RECOMMENDATION_VERSIONS=r-1, r-2")
@AutoConfigureMockMvc
@Transactional
class RecommendationConsentApiTest {

	private static final String PATH = "/api/users/me/recommendation-consent";
	private static final String SIGNUP = "/api/users/me/signup-consent";
	private static final String BASE = "\"termsVersion\":\"t\",\"privacyVersion\":\"p\",\"dataConsent\":{\"agreed\":true,\"version\":\"d\"}";

	@Autowired private MockMvc mvc;
	@Autowired private AccessTokenService tokens;
	@Autowired private UserRepository users;
	@Autowired private SocialAccountRepository socialAccounts;
	@Autowired private JdbcTemplate db;

	@Test
	void needsAToken() throws Exception {
		mvc.perform(get(PATH)).andExpect(status().isUnauthorized());
		mvc.perform(put(PATH).contentType(MediaType.APPLICATION_JSON).content(body(true, "r-1"))).andExpect(status().isUnauthorized());
	}

	@Test
	void isBlockedUntilSignupIsCompleted() throws Exception {
		mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(member("미가입")))).andExpect(status().isForbidden());
	}

	@Test
	void signupWithoutTheOptionalItemMeansNotAgreed() throws Exception {
		var user = signedUp("미응답", "");

		read(user).andExpect(status().isOk()).andExpect(jsonPath("$.agreed").value(false))
				.andExpect(jsonPath("$.version").doesNotExist()).andExpect(jsonPath("$.updatedAt").doesNotExist());
	}

	@Test
	void signupCanAgreeAndGetReturnsIt() throws Exception {
		var user = signedUp("가입동의", ",\"recommendationConsent\":" + body(true, "r-1"));

		read(user).andExpect(jsonPath("$.agreed").value(true)).andExpect(jsonPath("$.version").value("r-1"))
				.andExpect(jsonPath("$.updatedAt").exists());
	}

	@Test
	void signupRejectsAMalformedOptionalItem() throws Exception {
		var user = member("가입오류");

		signup(user, ",\"recommendationConsent\":{\"version\":\"r-1\"}").andExpect(status().isBadRequest());
		signup(user, ",\"recommendationConsent\":" + body(true, "r-9")).andExpect(status().isUnprocessableEntity());
	}

	@Test
	void putTurnsItOnAndOff() throws Exception {
		var user = signedUp("켜고끄기", "");

		write(user, body(true, "r-2")).andExpect(status().isOk()).andExpect(jsonPath("$.agreed").value(true));
		read(user).andExpect(jsonPath("$.agreed").value(true));
		write(user, body(false, "r-2")).andExpect(status().isOk()).andExpect(jsonPath("$.agreed").value(false));
		read(user).andExpect(jsonPath("$.agreed").value(false)).andExpect(jsonPath("$.version").value("r-2"));
	}

	@Test
	void turningItOffDeletesCandidates() throws Exception {
		var user = signedUp("철회", ",\"recommendationConsent\":" + body(true, "r-1"));
		long song = db.queryForObject("SELECT id FROM songs ORDER BY id LIMIT 1", Long.class);
		db.update("INSERT INTO recommendation_candidates(user_id,rank,song_id,model_version,batch_id,generated_at) VALUES(?,1,?,'m','b',now())", user.getId(), song);

		write(user, body(false, "r-1")).andExpect(status().isOk());

		assertThat(db.queryForObject("SELECT count(*) FROM recommendation_candidates WHERE user_id=?", Integer.class, user.getId())).isZero();
	}

	@Test
	void invalidBodiesAreRejectedAndNothingIsSaved() throws Exception {
		var user = signedUp("입력오류", "");

		write(user, "{\"version\":\"r-1\"}").andExpect(status().isBadRequest());
		write(user, "{\"agreed\":true}").andExpect(status().isBadRequest());
		write(user, "{\"agreed\":true,\"version\":\"   \"}").andExpect(status().isBadRequest());
		write(user, "{\"agreed\":true,\"version\":\"" + "r".repeat(51) + "\"}").andExpect(status().isBadRequest());
		write(user, body(true, "r-9")).andExpect(status().isUnprocessableEntity())
				.andExpect(jsonPath("$.code").value("SIGNUP_CONSENT_VERSION_INVALID"));

		read(user).andExpect(jsonPath("$.agreed").value(false));
	}

	private static String body(boolean agreed, String version) {
		return "{\"agreed\":" + agreed + ",\"version\":\"" + version + "\"}";
	}

	private User member(String nickname) {
		var user = users.saveAndFlush(User.create(nickname, null, null));
		socialAccounts.saveAndFlush(SocialAccount.connect(user, SocialProvider.GOOGLE, "r3-" + nickname, null));
		return user;
	}

	private User signedUp(String nickname, String extra) throws Exception {
		var user = member(nickname);
		signup(user, extra).andExpect(status().isOk());
		return user;
	}

	private ResultActions signup(User user, String extra) throws Exception {
		return mvc.perform(post(SIGNUP).header(HttpHeaders.AUTHORIZATION, bearer(user)).contentType(MediaType.APPLICATION_JSON)
				.content("{" + BASE + extra + "}"));
	}

	private ResultActions read(User user) throws Exception {
		return mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(user)));
	}

	private ResultActions write(User user, String json) throws Exception {
		return mvc.perform(put(PATH).header(HttpHeaders.AUTHORIZATION, bearer(user)).contentType(MediaType.APPLICATION_JSON).content(json));
	}

	private String bearer(User user) {
		return "Bearer " + tokens.issue(new AuthUser(user.getId(), user.getRole()), Instant.now()).token();
	}

}
