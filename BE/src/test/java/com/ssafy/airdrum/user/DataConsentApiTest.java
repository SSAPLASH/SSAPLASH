package com.ssafy.airdrum.user;

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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.auth.AccessTokenService;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** ACCT-002(199): 계정 단위 데이터 활용 동의 조회·저장 API(설계 3-1·3-2·4-4, 인수 조건). */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class DataConsentApiTest {

	private static final String PATH = "/api/users/me/data-consent";

	@Autowired
	private MockMvc mvc;

	@Autowired
	private AccessTokenService tokens;

	@Autowired
	private UserRepository users;

	@Autowired
	private SocialAccountRepository socialAccounts;

	@Autowired
	private DataConsentService service;

	@Autowired
	private JdbcTemplate jdbc;

	@Test
	void unsetConsentIsNullObjectInMe() throws Exception {
		var user = member("미응답");

		mvc.perform(get("/api/users/me").header(HttpHeaders.AUTHORIZATION, bearer(user)))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.dataConsent").isMap())
				.andExpect(jsonPath("$.dataConsent.agreed").value((Object) null))
				.andExpect(jsonPath("$.dataConsent.updatedAt").value((Object) null));

		var body = json(me(user));
		assertThat(body.path("dataConsent").propertyNames()).containsExactlyInAnyOrder("agreed", "updatedAt");
	}

	@Test
	void putTrueIsReflectedInMeWithTimestamp() throws Exception {
		var user = member("동의");

		var saved = json(putConsent(user, "{\"agreed\":true}").andExpect(status().isOk())
				.andExpect(jsonPath("$.agreed").value(true)));
		assertThat(saved.propertyNames()).containsExactlyInAnyOrder("agreed", "updatedAt");
		assertThat(saved.path("updatedAt").asString()).matches("\\d{4}-\\d{2}-\\d{2}T.*Z");

		me(user).andExpect(jsonPath("$.dataConsent.agreed").value(true))
				.andExpect(jsonPath("$.dataConsent.updatedAt").value(saved.path("updatedAt").asString()));
	}

	@Test
	void putFalseIsStoredAsRefusalNotAsUnset() throws Exception {
		var user = member("거부");

		putConsent(user, "{\"agreed\":false}").andExpect(status().isOk())
				.andExpect(jsonPath("$.agreed").value(false))
				.andExpect(jsonPath("$.updatedAt").isString());
		me(user).andExpect(jsonPath("$.dataConsent.agreed").value(false));
	}

	@Test
	void sameValueAgainKeepsTimestampsAndDifferentValueChangesThem() throws Exception {
		var user = member("멱등");
		var first = json(putConsent(user, "{\"agreed\":true}").andExpect(status().isOk()));
		var meFirst = json(me(user));
		Thread.sleep(20);

		var again = json(putConsent(user, "{\"agreed\":true}").andExpect(status().isOk()));
		var meAgain = json(me(user));
		assertThat(again.path("updatedAt").asString()).isEqualTo(first.path("updatedAt").asString());
		// 같은 값이면 회원 수정 시각도 바뀌지 않는다(설계 v0.2)
		assertThat(meAgain.path("updatedAt").asString()).isEqualTo(meFirst.path("updatedAt").asString());

		var changed = json(putConsent(user, "{\"agreed\":false}").andExpect(status().isOk())
				.andExpect(jsonPath("$.agreed").value(false)));
		assertThat(Instant.parse(changed.path("updatedAt").asString()))
				.isAfter(Instant.parse(first.path("updatedAt").asString()));
		var meChanged = json(me(user));
		assertThat(Instant.parse(meChanged.path("updatedAt").asString()))
				.isAfter(Instant.parse(meFirst.path("updatedAt").asString()));
	}

	@Test
	void missingBodyOrNullAgreedIsValidationFailure() throws Exception {
		var user = member("검증");

		for (var body : new String[] { "{}", "{\"agreed\":null}" }) {
			putConsent(user, body).andExpect(status().isBadRequest())
					.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
					.andExpect(jsonPath("$.errors[0].field").value("agreed"));
		}
		// 본문 자체가 없으면 검증 이전에 읽기 실패라, 전역 핸들러가 INVALID_INPUT(400)으로 답한다(기존 동작)
		putConsent(user, "").andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("INVALID_INPUT"));
		assertStored(user.getId(), null);
	}

	/**
	 * 설계 3-2는 문자열 {@code "true"}·숫자를 400으로 정했지만, Jackson 기본 설정이 이를 boolean으로 강제 변환하는지는
	 * 실제로 확인해야 한다. 이 테스트는 현재 동작을 고정하며 값은 사용자 결정 사항이다(전역 설정 변경은 이 작업 범위 밖).
	 */
	@Test
	void stringAndNumberAgreedCurrentBehavior() throws Exception {
		var user = member("형식");
		var statuses = new java.util.LinkedHashMap<String, Integer>();
		for (var body : new String[] { "{\"agreed\":\"true\"}", "{\"agreed\":1}" }) {
			statuses.put(body, putConsent(user, body).andReturn().getResponse().getStatus());
		}
		assertThat(statuses).containsEntry("{\"agreed\":\"true\"}", 200).containsEntry("{\"agreed\":1}", 200);
	}

	@Test
	void putRequiresToken() throws Exception {
		mvc.perform(put(PATH).contentType(MediaType.APPLICATION_JSON).content("{\"agreed\":true}"))
				.andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
	}

	@Test
	void withdrawnMemberRowIsNotWritten() {
		var user = users.saveAndFlush(User.create("탈퇴", null, null));
		user.withdraw(Instant.now());
		users.saveAndFlush(user);

		assertThatThrownBy(() -> service.save(user.getId(), true)).isInstanceOf(UserNotActiveException.class);
		assertStored(user.getId(), null);
		assertThat(jdbc.queryForObject("SELECT data_consent_at FROM users WHERE id = ?", Object.class, user.getId()))
				.isNull();
	}

	@Test
	void otherMembersValueIsUntouched() throws Exception {
		var me = member("나");
		var other = member("남");
		putConsent(other, "{\"agreed\":true}").andExpect(status().isOk());
		var otherAt = jdbc.queryForObject("SELECT data_consent_at FROM users WHERE id = ?", Object.class,
				other.getId());

		putConsent(me, "{\"agreed\":false}").andExpect(status().isOk());

		assertStored(other.getId(), true);
		assertThat(jdbc.queryForObject("SELECT data_consent_at FROM users WHERE id = ?", Object.class, other.getId()))
				.isEqualTo(otherAt);
		assertStored(me.getId(), false);
	}

	private void assertStored(long userId, Boolean expected) {
		assertThat(jdbc.queryForObject("SELECT data_consent FROM users WHERE id = ?", Boolean.class, userId))
				.isEqualTo(expected);
	}

	private ResultActions me(User user) throws Exception {
		return mvc.perform(get("/api/users/me").header(HttpHeaders.AUTHORIZATION, bearer(user)));
	}

	private ResultActions putConsent(User user, String body) throws Exception {
		MockHttpServletRequestBuilder request = put(PATH).header(HttpHeaders.AUTHORIZATION, bearer(user))
				.contentType(MediaType.APPLICATION_JSON);
		if (!body.isEmpty()) {
			request = request.content(body);
		}
		return mvc.perform(request);
	}

	private User member(String nickname) {
		var user = users.saveAndFlush(User.create(nickname, null, null));
		socialAccounts.saveAndFlush(SocialAccount.connect(user, SocialProvider.GOOGLE, "g-" + nickname, null));
		return user;
	}

	private JsonNode json(ResultActions result) throws Exception {
		return new JsonMapper().readTree(result.andReturn().getResponse().getContentAsString());
	}

	private String bearer(User user) {
		return "Bearer " + tokens.issue(new AuthUser(user.getId(), user.getRole()), Instant.now()).token();
	}

}
