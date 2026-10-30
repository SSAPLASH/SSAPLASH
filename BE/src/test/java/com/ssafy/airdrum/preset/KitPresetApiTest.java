package com.ssafy.airdrum.preset;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.auth.AccessTokenService;
import com.ssafy.airdrum.user.AuthUser;
import com.ssafy.airdrum.user.User;
import com.ssafy.airdrum.user.UserRepository;
import com.ssafy.airdrum.user.UserRole;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

/**
 * 설계 문서(90) 3-1~3-4·4장, 인수 조건 1~11·10-1·15: 실제 PostgreSQL·Security 체인·access 토큰으로 프리셋 API를 검증한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class KitPresetApiTest {

	private static final String LAYOUT = """
			{"SNARE":{"x":0.42,"y":0.68,"r":0.095},"KICK":{"x":0.58,"y":0.9,"r":0.065}}""";
	private static final String SOUNDS = """
			{"soundSetId":"ssaplash"}""";
	/** 옛 FE 빌드·요청서 표가 보내던 캘리브레이션 본문. 이제 서버는 이 필드를 모르고 무시해야 한다(128). */
	private static final String LEGACY_CALIBRATION = """
			{"id":"cal-1","name":"내 스틱","source":"ble","anchors":{"SNARE":{"pad":"SNARE","pitch":-12.25,"yaw":3.5,
			"radius":8.1,"samples":12,"spread":1.2}},"maxRadiusDeg":22,"audioOffsetMs":-15,"메모":{"깊이":[1,2.5,"셋"]}}""";

	@Autowired
	private MockMvc mvc;

	@Autowired
	private AccessTokenService tokens;

	@Autowired
	private UserRepository users;

	@Autowired
	private JdbcTemplate db;

	private final JsonMapper json = new JsonMapper();

	private long owner;
	private long other;
	private String ownerToken;
	private String otherToken;

	@BeforeEach
	void seed() {
		owner = users.saveAndFlush(User.create("프리셋 주인", null, null)).getId();
		other = users.saveAndFlush(User.create("다른 회원", null, null)).getId();
		ownerToken = token(owner, UserRole.USER);
		otherToken = token(other, UserRole.USER);
	}

	// --- 인수 조건 1·11: CRUD와 응답 계약 ---

	@Test
	void createReturns201WithLocationAndExactContractFields() throws Exception {
		var result = mvc.perform(post("/api/presets").header(HttpHeaders.AUTHORIZATION, ownerToken)
				.contentType(MediaType.APPLICATION_JSON).content(body("  연습용  ", LAYOUT, SOUNDS, null)))
				.andReturn();

		assertThat(result.getResponse().getStatus()).isEqualTo(201);
		var created = read(result);
		long id = created.path("id").longValue();
		assertThat(result.getResponse().getHeader(HttpHeaders.LOCATION)).endsWith("/api/presets/" + id);
		assertThat(created.propertyNames()).containsExactlyInAnyOrder("id", "name", "isDefault", "layout", "sounds",
				"schemaVersion", "createdAt", "updatedAt");
		assertThat(created.path("id").isIntegralNumber()).isTrue();
		assertThat(created.path("name").asString()).isEqualTo("연습용");
		assertThat(created.path("isDefault").booleanValue()).isFalse();
		assertThat(created.path("schemaVersion").intValue()).isEqualTo(1);
		assertThat(created.path("createdAt").asString()).matches("\\d{4}-\\d{2}-\\d{2}T.*Z");
		assertThat(db.queryForObject("SELECT user_id FROM kit_presets WHERE id=?", Long.class, id)).isEqualTo(owner);
	}

	@Test
	void fullCrudFlow() throws Exception {
		long id = create("처음", LAYOUT, SOUNDS);

		var fetched = ok(get("/api/presets/" + id));
		assertThat(fetched.path("name").asString()).isEqualTo("처음");

		var replaced = ok(put("/api/presets/" + id).contentType(MediaType.APPLICATION_JSON)
				.content(body("바꾼 이름", "{\"CRASH\":{\"x\":0.2,\"y\":0.2,\"r\":0.1}}", "{\"soundSetId\":\"synth\"}",
						2)));
		assertThat(replaced.path("id").longValue()).isEqualTo(id);
		assertThat(replaced.path("name").asString()).isEqualTo("바꾼 이름");
		assertThat(replaced.path("sounds").path("soundSetId").asString()).isEqualTo("synth");
		assertThat(replaced.path("schemaVersion").intValue()).isEqualTo(2);

		var list = ok(get("/api/presets"));
		assertThat(list.isArray()).isTrue();
		assertThat(list).hasSize(1);

		mvc.perform(delete("/api/presets/" + id).header(HttpHeaders.AUTHORIZATION, ownerToken))
				.andExpect(r -> assertThat(r.getResponse().getStatus()).isEqualTo(204))
				.andExpect(r -> assertThat(r.getResponse().getContentAsString()).isEmpty());
		problem(get("/api/presets/" + id), ownerToken, 404, "PRESET_NOT_FOUND");
		assertThat(ok(get("/api/presets"))).isEmpty();
	}

	// --- 인수 조건 8: JSON 왕복 · 128: 옛 calibration 필드 무시 ---

	@Test
	void legacyCalibrationFieldIsIgnoredOnCreateAndUpdate() throws Exception {
		for (String value : List.of(LEGACY_CALIBRATION, "null", "[]")) {
			String legacy = "{\"name\":" + json.writeValueAsString("옛 빌드 " + value.length()) + ",\"layout\":" + LAYOUT
					+ ",\"sounds\":" + SOUNDS + ",\"calibration\":" + value + "}";
			var created = mvc.perform(post("/api/presets").header(HttpHeaders.AUTHORIZATION, ownerToken)
					.contentType(MediaType.APPLICATION_JSON).content(legacy)).andReturn();
			assertThat(created.getResponse().getStatus()).as(value + " " + created.getResponse().getContentAsString())
					.isEqualTo(201);
			var preset = read(created);
			assertThat(preset.has("calibration")).as(value).isFalse();

			long id = preset.path("id").longValue();
			var updated = ok(put("/api/presets/" + id).contentType(MediaType.APPLICATION_JSON).content(legacy));
			assertThat(updated.has("calibration")).as(value).isFalse();
			assertThat(ok(get("/api/presets/" + id)).has("calibration")).as(value).isFalse();
		}
	}

	@Test
	void jsonContentRoundTripsSemantically() throws Exception {
		long id = create("왕복", LAYOUT, SOUNDS);
		var preset = ok(get("/api/presets/" + id));
		assertThat(preset.path("layout")).isEqualTo(json.readTree(LAYOUT));
		assertThat(preset.path("sounds")).isEqualTo(json.readTree(SOUNDS));
	}

	// --- 인수 조건 2·3·10-1: 기본 프리셋 ---

	@Test
	void listPutsDefaultFirstAndOnlyOneDefault() throws Exception {
		long a = create("가", LAYOUT, SOUNDS);
		long b = create("나", LAYOUT, SOUNDS);
		long c = create("다", LAYOUT, SOUNDS);

		var none = ok(get("/api/presets"));
		assertThat(ids(none)).containsExactly(c, b, a);
		assertThat(none.get(0).path("isDefault").booleanValue()).isFalse();

		assertThat(ok(put("/api/presets/" + a + "/default")).path("isDefault").booleanValue()).isTrue();
		var afterA = ok(get("/api/presets"));
		assertThat(ids(afterA)).containsExactly(a, c, b);
		assertThat(defaultCount(afterA)).isEqualTo(1);

		ok(put("/api/presets/" + b + "/default"));
		var afterB = ok(get("/api/presets"));
		assertThat(ids(afterB)).containsExactly(b, c, a);
		assertThat(defaultCount(afterB)).isEqualTo(1);

		assertThat(ok(put("/api/presets/" + b + "/default")).path("isDefault").booleanValue()).isTrue();
		assertThat(defaultCount(ok(get("/api/presets")))).isEqualTo(1);
	}

	@Test
	void updateKeepsDefaultFlag() throws Exception {
		long a = create("가", LAYOUT, SOUNDS);
		ok(put("/api/presets/" + a + "/default"));
		var replaced = ok(put("/api/presets/" + a).contentType(MediaType.APPLICATION_JSON)
				.content(body("가2", LAYOUT, SOUNDS, null)));
		assertThat(replaced.path("isDefault").booleanValue()).isTrue();
	}

	@Test
	void deletingDefaultPromotesNewestRemaining() throws Exception {
		long oldest = create("오래된", LAYOUT, SOUNDS);
		long middle = create("중간", LAYOUT, SOUNDS);
		long newest = create("최신", LAYOUT, SOUNDS);
		ok(put("/api/presets/" + middle + "/default"));

		deleteOk(middle);
		var list = ok(get("/api/presets"));
		assertThat(ids(list)).containsExactly(newest, oldest);
		assertThat(list.get(0).path("isDefault").booleanValue()).isTrue();
		assertThat(defaultCount(list)).isEqualTo(1);
	}

	@Test
	void deletingNonDefaultKeepsDefaultAndDeletingLastLeavesEmpty() throws Exception {
		long a = create("가", LAYOUT, SOUNDS);
		long b = create("나", LAYOUT, SOUNDS);
		ok(put("/api/presets/" + a + "/default"));

		deleteOk(b);
		var list = ok(get("/api/presets"));
		assertThat(ids(list)).containsExactly(a);
		assertThat(list.get(0).path("isDefault").booleanValue()).isTrue();

		deleteOk(a);
		assertThat(ok(get("/api/presets"))).isEmpty();
	}

	@Test
	void succession_ignoresOtherOwnersPresets() throws Exception {
		long mine = create("내 기본", LAYOUT, SOUNDS);
		ok(put("/api/presets/" + mine + "/default"));
		mvc.perform(post("/api/presets").header(HttpHeaders.AUTHORIZATION, otherToken)
				.contentType(MediaType.APPLICATION_JSON).content(body("남의 최신", LAYOUT, SOUNDS, null)));

		deleteOk(mine);
		assertThat(ok(get("/api/presets"))).isEmpty();
		assertThat(db.queryForObject("SELECT count(*) FROM kit_presets WHERE user_id=? AND is_default", Long.class, other))
				.isZero();
	}

	// --- 인수 조건 4·5: 소유자·인증 ---

	@Test
	void otherOwnersPresetLooksMissingEvenForAdmin() throws Exception {
		long foreign = createAs(otherToken, "남의 것");
		String admin = token(owner, UserRole.ADMIN);
		db.update("UPDATE users SET role='ADMIN' WHERE id=?", owner);
		for (var token : List.of(ownerToken, admin)) {
			for (long id : List.of(foreign, Long.MAX_VALUE)) {
				problem(get("/api/presets/" + id), token, 404, "PRESET_NOT_FOUND");
				problem(put("/api/presets/" + id).contentType(MediaType.APPLICATION_JSON)
						.content(body("가로채기", LAYOUT, SOUNDS, null)), token, 404, "PRESET_NOT_FOUND");
				problem(put("/api/presets/" + id + "/default"), token, 404, "PRESET_NOT_FOUND");
				problem(delete("/api/presets/" + id), token, 404, "PRESET_NOT_FOUND");
			}
		}
		assertThat(db.queryForObject("SELECT name FROM kit_presets WHERE id=?", String.class, foreign)).isEqualTo("남의 것");
		assertThat(ok(get("/api/presets"))).isEmpty();
	}

	@Test
	void everyEndpointRequiresToken() throws Exception {
		var requests = List.<MockHttpServletRequestBuilder>of(get("/api/presets"), get("/api/presets/1"),
				post("/api/presets").contentType(MediaType.APPLICATION_JSON).content(body("가", LAYOUT, SOUNDS, null)),
				put("/api/presets/1").contentType(MediaType.APPLICATION_JSON).content(body("가", LAYOUT, SOUNDS, null)),
				put("/api/presets/1/default"), delete("/api/presets/1"));
		for (var request : requests) {
			var r = mvc.perform(request).andReturn();
			assertThat(r.getResponse().getStatus()).isEqualTo(401);
			assertThat(read(r).path("code").asString()).isEqualTo("UNAUTHORIZED");
		}
	}

	// --- 인수 조건 6: 검증 ---

	@Test
	void invalidBodiesAreRejectedWithFieldErrors() throws Exception {
		String big = "{\"blob\":\"" + "가".repeat(6000) + "\"}";
		record Case(String body, String field) {}
		var cases = List.of(
				new Case(body("   ", LAYOUT, SOUNDS, null), "name"),
				new Case(body("가".repeat(51), LAYOUT, SOUNDS, null), "name"),
				new Case("{\"layout\":" + LAYOUT + ",\"sounds\":" + SOUNDS + "}", "name"),
				new Case(body("가", "[1,2]", SOUNDS, null), "layout"),
				new Case(body("가", "\"문자열\"", SOUNDS, null), "layout"),
				new Case("{\"name\":\"가\",\"sounds\":" + SOUNDS + "}", "layout"),
				new Case("{\"name\":\"가\",\"layout\":null,\"sounds\":" + SOUNDS + "}", "layout"),
				new Case("{\"name\":\"가\",\"layout\":" + LAYOUT + "}", "sounds"),
				new Case(body("가", LAYOUT, SOUNDS, 0), "schemaVersion"),
				new Case(body("가", big, SOUNDS, null), "layout"));
		for (var c : cases) {
			var r = mvc.perform(post("/api/presets").header(HttpHeaders.AUTHORIZATION, ownerToken)
					.contentType(MediaType.APPLICATION_JSON).content(c.body())).andReturn();
			assertThat(r.getResponse().getStatus()).as(c.body()).isEqualTo(400);
			var problem = read(r);
			assertThat(problem.path("code").asString()).as(c.body()).isEqualTo("VALIDATION_FAILED");
			var fields = new ArrayList<String>();
			problem.path("errors").forEach(e -> fields.add(e.path("field").asString()));
			assertThat(fields).as(c.body()).contains(c.field());
		}
		assertThat(db.queryForObject("SELECT count(*) FROM kit_presets WHERE user_id=?", Long.class, owner)).isZero();
	}

	@Test
	void sameValidationAppliesToUpdateAndPathIdMustBePositive() throws Exception {
		long id = create("가", LAYOUT, SOUNDS);
		problem(put("/api/presets/" + id).contentType(MediaType.APPLICATION_JSON)
				.content(body("가", "[]", SOUNDS, null)), ownerToken, 400, "VALIDATION_FAILED");
		problem(get("/api/presets/0"), ownerToken, 400, "VALIDATION_FAILED");
		problem(delete("/api/presets/-1"), ownerToken, 400, "VALIDATION_FAILED");
	}

	// --- 인수 조건 9·10: 이름 중복·상한 ---

	@Test
	void duplicateNamesAreRejectedPerOwner() throws Exception {
		long a = create("같은 이름", LAYOUT, SOUNDS);
		long b = create("다른 이름", LAYOUT, SOUNDS);

		problem(post("/api/presets").contentType(MediaType.APPLICATION_JSON)
				.content(body(" 같은 이름 ", LAYOUT, SOUNDS, null)), ownerToken, 409, "PRESET_NAME_DUPLICATE");
		problem(put("/api/presets/" + b).contentType(MediaType.APPLICATION_JSON)
				.content(body("같은 이름", LAYOUT, SOUNDS, null)), ownerToken, 409, "PRESET_NAME_DUPLICATE");
		ok(put("/api/presets/" + a).contentType(MediaType.APPLICATION_JSON)
				.content(body("같은 이름", LAYOUT, "{\"soundSetId\":\"synth\"}", null)));
		assertThat(createAs(otherToken, "같은 이름")).isPositive();
	}

	@Test
	void eleventhPresetIsRejectedUntilOneIsDeleted() throws Exception {
		long first = 0;
		for (int i = 1; i <= 10; i++) {
			long id = create("프리셋 " + i, LAYOUT, SOUNDS);
			if (i == 1) {
				first = id;
			}
		}
		problem(post("/api/presets").contentType(MediaType.APPLICATION_JSON)
				.content(body("열한 번째", LAYOUT, SOUNDS, null)), ownerToken, 409, "PRESET_LIMIT_EXCEEDED");
		assertThat(createAs(otherToken, "남은 별개")).isPositive();

		deleteOk(first);
		assertThat(create("열한 번째", LAYOUT, SOUNDS)).isPositive();
	}

	// --- 인수 조건 15: 문서 ---

	@Test
	void openApiListsPresetOperationsWithBearerAuth() throws Exception {
		var docs = read(mvc.perform(get("/v3/api-docs")).andReturn());
		var paths = docs.path("paths");
		assertThat(paths.path("/api/presets").has("get")).isTrue();
		assertThat(paths.path("/api/presets").has("post")).isTrue();
		assertThat(paths.path("/api/presets/{id}").has("get")).isTrue();
		assertThat(paths.path("/api/presets/{id}").has("put")).isTrue();
		assertThat(paths.path("/api/presets/{id}").has("delete")).isTrue();
		assertThat(paths.path("/api/presets/{id}/default").has("put")).isTrue();
		var create = paths.path("/api/presets").path("post");
		assertThat(create.path("tags").get(0).asString()).isEqualTo("Presets");
		assertThat(create.path("security").get(0).has("bearerAuth")).isTrue();
		assertThat(create.path("parameters").toString()).doesNotContain("AuthUser");

		var schemas = docs.path("components").path("schemas");
		assertThat(schemas.path("PresetRequest").path("properties").propertyNames())
				.containsExactlyInAnyOrder("name", "layout", "sounds", "schemaVersion");
		assertThat(schemas.path("PresetResponse").path("properties").propertyNames())
				.containsExactlyInAnyOrder("id", "name", "isDefault", "layout", "sounds", "schemaVersion", "createdAt",
						"updatedAt");
		assertThat(paths.path("/api/presets/{id}").path("put").path("description").asString())
				.doesNotContain("캘리브레이션");
		assertThat(docs.path("tags").toString()).doesNotContain("캘리브레이션");
	}

	// --- 도우미 ---

	private long create(String name, String layout, String sounds) throws Exception {
		var r = mvc.perform(post("/api/presets").header(HttpHeaders.AUTHORIZATION, ownerToken)
				.contentType(MediaType.APPLICATION_JSON).content(body(name, layout, sounds, null))).andReturn();
		assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(201);
		return read(r).path("id").longValue();
	}

	private long createAs(String token, String name) throws Exception {
		var r = mvc.perform(post("/api/presets").header(HttpHeaders.AUTHORIZATION, token)
				.contentType(MediaType.APPLICATION_JSON).content(body(name, LAYOUT, SOUNDS, null))).andReturn();
		assertThat(r.getResponse().getStatus()).isEqualTo(201);
		return read(r).path("id").longValue();
	}

	private void deleteOk(long id) throws Exception {
		var r = mvc.perform(delete("/api/presets/" + id).header(HttpHeaders.AUTHORIZATION, ownerToken)).andReturn();
		assertThat(r.getResponse().getStatus()).isEqualTo(204);
	}

	private JsonNode ok(MockHttpServletRequestBuilder request) throws Exception {
		var r = mvc.perform(request.header(HttpHeaders.AUTHORIZATION, ownerToken)).andReturn();
		assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(200);
		return read(r);
	}

	private void problem(MockHttpServletRequestBuilder request, String token, int status, String code) throws Exception {
		var r = mvc.perform(request.header(HttpHeaders.AUTHORIZATION, token)).andReturn();
		assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(status);
		assertThat(r.getResponse().getContentType()).startsWith("application/problem+json");
		assertThat(read(r).path("code").asString()).isEqualTo(code);
	}

	private JsonNode read(MvcResult r) throws Exception {
		return json.readTree(r.getResponse().getContentAsString());
	}

	private static List<Long> ids(JsonNode list) {
		var ids = new ArrayList<Long>();
		list.forEach(p -> ids.add(p.path("id").longValue()));
		return ids;
	}

	private static long defaultCount(JsonNode list) {
		long n = 0;
		for (var p : list) {
			if (p.path("isDefault").booleanValue()) {
				n++;
			}
		}
		return n;
	}

	private String body(String name, String layout, String sounds, Integer schemaVersion) {
		var sb = new StringBuilder("{\"name\":").append(json.writeValueAsString(name))
				.append(",\"layout\":").append(layout).append(",\"sounds\":").append(sounds);
		if (schemaVersion != null) {
			sb.append(",\"schemaVersion\":").append(schemaVersion);
		}
		return sb.append('}').toString();
	}

	private String token(long userId, UserRole role) {
		return "Bearer " + tokens.issue(new AuthUser(userId, role), Instant.now()).token();
	}

}
