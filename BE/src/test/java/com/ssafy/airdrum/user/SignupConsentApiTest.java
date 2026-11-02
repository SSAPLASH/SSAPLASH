package com.ssafy.airdrum.user;

import java.time.Instant;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.auth.AccessTokenService;
import com.ssafy.airdrum.support.SignupConsentFixtures;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** ACCT-001·ACCT-002(199 범위 확장): 가입 동의 저장 API와 {@code /me}의 가입 완료 여부(가입 동의 설계 3-1~3-3, 6장). */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class SignupConsentApiTest {

	private static final String PATH = "/api/users/me/signup-consent";

	private static final String OLD_DATA_CONSENT_PATH = "/api/users/me/data-consent";

	private static final String ISO_UTC = "\\d{4}-\\d{2}-\\d{2}T.*Z";

	private static final String VALID = body("t-2026-11", "p-2026-11", "true", "d-2026-11");

	@Autowired
	private MockMvc mvc;

	@Autowired
	private AccessTokenService tokens;

	@Autowired
	private UserRepository users;

	@Autowired
	private SocialAccountRepository socialAccounts;

	@Autowired
	private SignupConsentService service;

	@Autowired
	private JdbcTemplate jdbc;

	/** 인수 조건 1: 신규·기존 회원(동의 컬럼 null)의 /me는 가입 미완료이고, 동의 객체는 항상 있되 안의 값이 null이다. */
	@Test
	void memberWithoutConsentIsNotSignupCompleted() throws Exception {
		var user = member("미동의");

		var body = json(me(user).andExpect(status().isOk()));

		assertThat(body.path("signupCompleted").isBoolean()).isTrue();
		assertThat(body.path("signupCompleted").asBoolean()).isFalse();
		assertThat(body.path("consents").isObject()).isTrue();
		assertThat(body.path("consents").propertyNames()).containsExactlyInAnyOrder("terms", "privacy");
		assertThat(body.path("consents").path("terms").isNull()).isTrue();
		assertThat(body.path("consents").path("privacy").isNull()).isTrue();
		assertThat(body.path("dataConsent").propertyNames()).containsExactlyInAnyOrder("agreed", "version", "updatedAt");
		assertThat(body.path("dataConsent").path("agreed").isNull()).isTrue();
		assertThat(body.path("dataConsent").path("version").isNull()).isTrue();
		assertThat(body.path("dataConsent").path("updatedAt").isNull()).isTrue();
	}

	/** 인수 조건 6: 저장하면 200과 /me 본문(가입 완료, 세 동의 채움)을 돌려주고, 이후 /me도 같다. */
	@Test
	void postStoresAllConsentsAndReturnsMe() throws Exception {
		var user = member("가입");

		var saved = json(post(user, VALID).andExpect(status().isOk()));

		assertThat(saved.path("id").asLong()).isEqualTo(user.getId());
		assertThat(saved.path("signupCompleted").asBoolean()).isTrue();
		assertConsent(saved.path("consents").path("terms"), "t-2026-11");
		assertConsent(saved.path("consents").path("privacy"), "p-2026-11");
		assertThat(saved.path("consents").path("terms").propertyNames()).containsExactlyInAnyOrder("version", "agreedAt");
		assertThat(saved.path("dataConsent").path("agreed").asBoolean()).isTrue();
		assertThat(saved.path("dataConsent").path("version").asString()).isEqualTo("d-2026-11");
		assertThat(saved.path("dataConsent").path("updatedAt").asString()).matches(ISO_UTC);

		var again = json(me(user).andExpect(status().isOk()));
		assertThat(again.path("signupCompleted").asBoolean()).isTrue();
		assertThat(again.path("consents")).isEqualTo(saved.path("consents"));
		assertThat(again.path("dataConsent")).isEqualTo(saved.path("dataConsent"));
	}

	/** 인수 조건 7: 같은 판으로 다시 보내면 200이고 세 시각·회원 updatedAt이 그대로다. */
	@Test
	void samePayloadAgainKeepsAllTimestamps() throws Exception {
		var user = member("멱등");
		var first = json(post(user, VALID).andExpect(status().isOk()));
		Thread.sleep(20);

		var again = json(post(user, VALID).andExpect(status().isOk()));

		assertThat(again.path("consents")).isEqualTo(first.path("consents"));
		assertThat(again.path("dataConsent")).isEqualTo(first.path("dataConsent"));
		assertThat(again.path("updatedAt")).isEqualTo(first.path("updatedAt"));
	}

	/** 인수 조건 7: 이용약관 판만 바꾸면 이용약관 동의 시각과 회원 updatedAt만 바뀐다. */
	@Test
	void changedTermsVersionUpdatesOnlyTermsAgreedAt() throws Exception {
		var user = member("약관개정");
		var first = json(post(user, VALID).andExpect(status().isOk()));
		Thread.sleep(20);

		var changed = json(post(user, body("t-2026-12", "p-2026-11", "true", "d-2026-11")).andExpect(status().isOk()));

		assertThat(changed.path("consents").path("terms").path("version").asString()).isEqualTo("t-2026-12");
		assertThat(instant(changed.path("consents").path("terms").path("agreedAt")))
				.isAfter(instant(first.path("consents").path("terms").path("agreedAt")));
		assertThat(changed.path("consents").path("privacy")).isEqualTo(first.path("consents").path("privacy"));
		assertThat(changed.path("dataConsent")).isEqualTo(first.path("dataConsent"));
		assertThat(instant(changed.path("updatedAt"))).isAfter(instant(first.path("updatedAt")));
	}

	/** 인수 조건 7: 연주 기록 활용 판만 바꾸면 dataConsent.updatedAt만 바뀐다. */
	@Test
	void changedDataConsentVersionUpdatesOnlyDataConsentTime() throws Exception {
		var user = member("활용개정");
		var first = json(post(user, VALID).andExpect(status().isOk()));
		Thread.sleep(20);

		var changed = json(post(user, body("t-2026-11", "p-2026-11", "true", "d-2026-12")).andExpect(status().isOk()));

		assertThat(changed.path("dataConsent").path("version").asString()).isEqualTo("d-2026-12");
		assertThat(instant(changed.path("dataConsent").path("updatedAt")))
				.isAfter(instant(first.path("dataConsent").path("updatedAt")));
		assertThat(changed.path("consents")).isEqualTo(first.path("consents"));
		assertThat(instant(changed.path("updatedAt"))).isAfter(instant(first.path("updatedAt")));
	}

	/** 인수 조건 8: 연주 기록 활용은 필수다. false·null·누락은 400이고 아무것도 저장하지 않는다. */
	@ParameterizedTest
	@ValueSource(strings = {
			"{\"termsVersion\":\"t\",\"privacyVersion\":\"p\",\"dataConsent\":{\"agreed\":false,\"version\":\"d\"}}",
			"{\"termsVersion\":\"t\",\"privacyVersion\":\"p\",\"dataConsent\":{\"agreed\":null,\"version\":\"d\"}}",
			"{\"termsVersion\":\"t\",\"privacyVersion\":\"p\",\"dataConsent\":{\"version\":\"d\"}}" })
	void dataConsentMustBeAgreed(String request) throws Exception {
		var user = member("거부");

		post(user, request).andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
				.andExpect(jsonPath("$.errors[0].field").value("dataConsent.agreed"));
		assertNothingStored(user);
	}

	/** 인수 조건 9: 판 필드가 누락·null·빈 문자열·공백만·51자이면 400과 그 필드의 오류다. */
	@ParameterizedTest
	@MethodSource("invalidVersions")
	void invalidVersionIsValidationFailure(String request, String field) throws Exception {
		var user = member("판검증");

		var body = json(post(user, request).andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("VALIDATION_FAILED")));

		assertThat(body.path("errors").valueStream().map(error -> error.path("field").asString())).contains(field);
		assertNothingStored(user);
	}

	static Stream<Arguments> invalidVersions() {
		var tooLong = "v".repeat(51);
		return Stream.of(
				Arguments.of("{\"privacyVersion\":\"p\",\"dataConsent\":{\"agreed\":true,\"version\":\"d\"}}",
						"termsVersion"),
				Arguments.of(body(null, "p", "true", "d"), "termsVersion"),
				Arguments.of(body("", "p", "true", "d"), "termsVersion"),
				Arguments.of(body("   ", "p", "true", "d"), "termsVersion"),
				Arguments.of(body(tooLong, "p", "true", "d"), "termsVersion"),
				Arguments.of("{\"termsVersion\":\"t\",\"dataConsent\":{\"agreed\":true,\"version\":\"d\"}}",
						"privacyVersion"),
				Arguments.of(body("t", null, "true", "d"), "privacyVersion"),
				Arguments.of(body("t", "", "true", "d"), "privacyVersion"),
				Arguments.of(body("t", "   ", "true", "d"), "privacyVersion"),
				Arguments.of(body("t", tooLong, "true", "d"), "privacyVersion"),
				Arguments.of("{\"termsVersion\":\"t\",\"privacyVersion\":\"p\",\"dataConsent\":{\"agreed\":true}}",
						"dataConsent.version"),
				Arguments.of(body("t", "p", "true", null), "dataConsent.version"),
				Arguments.of(body("t", "p", "true", ""), "dataConsent.version"),
				Arguments.of(body("t", "p", "true", "   "), "dataConsent.version"),
				Arguments.of(body("t", "p", "true", tooLong), "dataConsent.version"),
				Arguments.of("{\"termsVersion\":\"t\",\"privacyVersion\":\"p\"}", "dataConsent"),
				Arguments.of("{\"termsVersion\":\"t\",\"privacyVersion\":\"p\",\"dataConsent\":null}", "dataConsent"));
	}

	/** 경계값: 판은 50자까지 받는다. */
	@Test
	void fiftyCharacterVersionsAreAccepted() throws Exception {
		var user = member("경계");
		var max = "v".repeat(50);

		post(user, body(max, max, "true", max)).andExpect(status().isOk())
				.andExpect(jsonPath("$.consents.terms.version").value(max))
				.andExpect(jsonPath("$.dataConsent.version").value(max));
	}

	/** 인수 조건 9: 본문이 없거나 JSON이 깨지면 검증 전에 읽기 실패라 공통 핸들러의 INVALID_INPUT이다. */
	@Test
	void missingBodyIsInvalidInput() throws Exception {
		var user = member("본문없음");

		post(user, "").andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_INPUT"));
		post(user, "{\"termsVersion\":").andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("INVALID_INPUT"));
		assertNothingStored(user);
	}

	@Test
	void postRequiresToken() throws Exception {
		mvc.perform(MockMvcRequestBuilders.post(PATH).contentType(MediaType.APPLICATION_JSON).content(VALID))
				.andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
	}

	/** 인수 조건 10: 탈퇴한 회원 행에는 써지지 않는다(인증 뒤 탈퇴와 겹친 경우, 컨트롤러는 401로 바꾼다). */
	@Test
	void withdrawnMemberRowIsNotWritten() {
		var user = users.saveAndFlush(User.create("탈퇴", null, null));
		user.withdraw(Instant.now());
		users.saveAndFlush(user);

		assertThatThrownBy(() -> service.save(user.getId(), request("t", "p", "d")))
				.isInstanceOf(UserNotActiveException.class);
		assertNothingStored(user);
	}

	@Test
	void otherMembersConsentIsUntouched() throws Exception {
		var me = member("나");
		var other = member("남");

		post(me, VALID).andExpect(status().isOk());

		assertNothingStored(other);
	}

	/** 설계 3-3: 199의 동의 PUT은 삭제되어 가입을 마친 회원이 불러도 405 또는 404이고, Swagger 문서에도 없다. */
	@Test
	void dataConsentPutNoLongerExists() throws Exception {
		var user = completedMember("기존PUT");

		int status = mvc.perform(put(OLD_DATA_CONSENT_PATH).header(HttpHeaders.AUTHORIZATION, bearer(user))
				.contentType(MediaType.APPLICATION_JSON).content("{\"agreed\":true}"))
				.andReturn().getResponse().getStatus();
		assertThat(status).isIn(404, 405);

		var docs = json(mvc.perform(get("/v3/api-docs")));
		assertThat(docs.path("paths").has(OLD_DATA_CONSENT_PATH)).isFalse();
	}

	private static void assertConsent(JsonNode consent, String version) {
		assertThat(consent.path("version").asString()).isEqualTo(version);
		assertThat(consent.path("agreedAt").asString()).matches(ISO_UTC);
	}

	private void assertNothingStored(User user) {
		var row = jdbc.queryForMap("""
				SELECT terms_version, terms_agreed_at, privacy_version, privacy_agreed_at,
				  data_consent, data_consent_at, data_consent_version
				FROM users WHERE id = ?
				""", user.getId());
		assertThat(row).hasSize(7);
		assertThat(row.values()).containsOnlyNulls();
	}

	private static Instant instant(JsonNode node) {
		return Instant.parse(node.asString());
	}

	/** JSON 본문. 판이 null이면 JSON null을 넣고, {@code agreed}는 리터럴 그대로 넣는다. */
	private static String body(String terms, String privacy, String agreed, String dataVersion) {
		return "{\"termsVersion\":" + quote(terms) + ",\"privacyVersion\":" + quote(privacy)
				+ ",\"dataConsent\":{\"agreed\":" + agreed + ",\"version\":" + quote(dataVersion) + "}}";
	}

	private static String quote(String value) {
		return value == null ? "null" : "\"" + value + "\"";
	}

	private static SignupConsentRequest request(String terms, String privacy, String dataVersion) {
		return new SignupConsentRequest(terms, privacy, new DataConsentInput(true, dataVersion));
	}

	private ResultActions me(User user) throws Exception {
		return mvc.perform(get("/api/users/me").header(HttpHeaders.AUTHORIZATION, bearer(user)));
	}

	private ResultActions post(User user, String body) throws Exception {
		MockHttpServletRequestBuilder request = MockMvcRequestBuilders.post(PATH)
				.header(HttpHeaders.AUTHORIZATION, bearer(user)).contentType(MediaType.APPLICATION_JSON);
		if (!body.isEmpty()) {
			request = request.content(body);
		}
		return mvc.perform(request);
	}

	/** 동의 전 회원(신규 가입 직후와 같은 상태). */
	private User member(String nickname) {
		var user = users.saveAndFlush(User.create(nickname, null, null));
		socialAccounts.saveAndFlush(SocialAccount.connect(user, SocialProvider.GOOGLE, "g-" + nickname, null));
		return user;
	}

	private User completedMember(String nickname) {
		var user = users.saveAndFlush(SignupConsentFixtures.completed(User.create(nickname, null, null)));
		socialAccounts.saveAndFlush(SocialAccount.connect(user, SocialProvider.GOOGLE, "g-" + nickname, null));
		return user;
	}

	private static JsonNode json(ResultActions result) throws Exception {
		return new JsonMapper().readTree(result.andReturn().getResponse().getContentAsString());
	}

	private String bearer(User user) {
		return "Bearer " + tokens.issue(new AuthUser(user.getId(), user.getRole()), Instant.now()).token();
	}

}
