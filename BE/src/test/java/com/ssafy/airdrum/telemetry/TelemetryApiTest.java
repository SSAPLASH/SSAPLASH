package com.ssafy.airdrum.telemetry;

import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.auth.AccessTokenService;
import com.ssafy.airdrum.user.AuthUser;
import com.ssafy.airdrum.user.UserRole;

import static com.ssafy.airdrum.telemetry.TelemetryBatchValidatorTest.KEYBOARD_HIT;
import static com.ssafy.airdrum.telemetry.TelemetryBatchValidatorTest.SENSOR_HIT;
import static com.ssafy.airdrum.telemetry.TelemetryBatchValidatorTest.STATUS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 실제 JWT·임베디드 PG·MVC로 수신·조회를 검사한다. 저장 실패 롤백을 확인하려고 테스트 트랜잭션을 쓰지 않고 직접 지운다.
 */
@SpringBootTest
@AutoConfigureMockMvc
class TelemetryApiTest {

	static final String BATCHES = "/api/telemetry/batches";

	@Autowired
	MockMvc mvc;
	@Autowired
	JdbcTemplate db;
	@Autowired
	AccessTokenService tokens;
	@MockitoSpyBean
	TelemetryEventRepository events;

	final JsonMapper json = new JsonMapper();
	long admin;
	long otherAdmin;
	long user;
	UUID session;

	@BeforeEach
	void seed() {
		admin = db.queryForObject("INSERT INTO users(nickname,role) VALUES('텔레메트리 관리자','ADMIN') RETURNING id", Long.class);
		otherAdmin = db.queryForObject("INSERT INTO users(nickname,role) VALUES('다른 관리자','ADMIN') RETURNING id", Long.class);
		user = db.queryForObject("INSERT INTO users(nickname) VALUES('일반 회원') RETURNING id", Long.class);
		session = UUID.randomUUID();
	}

	@AfterEach
	void cleanup() {
		db.update("DELETE FROM telemetry_events WHERE user_id IN (?,?,?)", admin, otherAdmin, user);
		db.update("DELETE FROM users WHERE id IN (?,?,?)", admin, otherAdmin, user);
	}

	/** 조회 기본 기간(최근 7일) 안에 들도록 픽스처의 시각을 지금 기준 1시간 전 분 단위로 옮긴다. */
	final Instant base = Instant.now().minus(Duration.ofHours(1)).truncatedTo(ChronoUnit.MINUTES);

	String batch(String... events) {
		return batchAt(session, base, events);
	}

	static String batchAt(UUID session, Instant minute, String... events) {
		return TelemetryBatchValidatorTest.batch(events).replace("32fb1264-7ca0-4e8a-9d7f-f69616683fe1", session.toString())
				.replace("2026-10-28T01:00", minute.toString().substring(0, 16));
	}

	String token(long id) {
		return "Bearer " + tokens.issue(new AuthUser(id, UserRole.USER), Instant.now()).token();
	}

	MvcResult send(MockHttpServletRequestBuilder request, Long as) throws Exception {
		if (as != null) request.header(HttpHeaders.AUTHORIZATION, token(as));
		return mvc.perform(request).andReturn();
	}

	MvcResult postBatch(String body, Long as) throws Exception {
		return send(post(BATCHES).contentType(MediaType.APPLICATION_JSON).content(body), as);
	}

	JsonNode body(MvcResult r) throws Exception {
		return json.readTree(r.getResponse().getContentAsString());
	}

	void problem(MvcResult r, int status, String code) throws Exception {
		assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(status);
		assertThat(r.getResponse().getContentType()).startsWith("application/problem+json");
		assertThat(body(r).path("code").asString()).isEqualTo(code);
	}

	int stored() {
		return db.queryForObject("SELECT count(*) FROM telemetry_events WHERE session_id=?", Integer.class, session);
	}

	// --- 수신 ---

	@Test
	void onlyAdminCanPostAndRoleIsReadFromDatabase() throws Exception {
		problem(postBatch(batch(SENSOR_HIT), null), 401, "UNAUTHORIZED");
		problem(postBatch(batch(SENSOR_HIT), user), 403, "FORBIDDEN");
		db.update("UPDATE users SET role='USER' WHERE id=?", admin);
		problem(postBatch(batch(SENSOR_HIT), admin), 403, "FORBIDDEN");
		db.update("UPDATE users SET status='WITHDRAWN',withdrawn_at=now() WHERE id=?", otherAdmin);
		problem(postBatch(batch(SENSOR_HIT), otherAdmin), 401, "UNAUTHORIZED");
		assertThat(stored()).isZero();
	}

	@Test
	void hitAndStatusAreStoredAsSentWithNullsKept() throws Exception {
		var r = postBatch(batch(SENSOR_HIT, KEYBOARD_HIT, STATUS), admin);
		assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(200);
		assertThat(body(r).propertyNames()).containsExactly("acceptedCount");
		assertThat(body(r).path("acceptedCount").intValue()).isEqualTo(3);

		var sensor = db.queryForMap("SELECT * FROM telemetry_events WHERE session_id=? AND kind='HIT' AND stick_id=0", session);
		assertThat(sensor.get("user_id")).isEqualTo(admin);
		assertThat(sensor.get("mode")).isEqualTo("RHYTHM");
		assertThat(sensor.get("pad")).isEqualTo("SNARE");
		assertThat(sensor.get("judgement")).isEqualTo("PERFECT");
		assertThat(sensor.get("delta_ms")).isEqualTo(8.5);
		assertThat(sensor.get("t_sensor")).isEqualTo(1000123L);
		assertThat(sensor.get("clock_offset_ms")).isEqualTo(-12.25);
		assertThat(db.queryForObject("SELECT tags->>'firmware' FROM telemetry_events WHERE session_id=? AND stick_id=0 AND kind='HIT'",
				String.class, session)).isEqualTo("0.3.1");
		assertThat(db.queryForObject("SELECT time FROM telemetry_events WHERE session_id=? AND stick_id=0 AND kind='HIT'",
				java.sql.Timestamp.class, session).toInstant()).isEqualTo(base);

		var keyboard = db.queryForMap("SELECT * FROM telemetry_events WHERE session_id=? AND pad='HIHAT_PEDAL'", session);
		for (var column : new String[] {"stick_id", "t_sensor", "clock_offset_ms", "t_audio", "judgement", "delta_ms", "packet_loss", "battery_pct"}) {
			assertThat(keyboard.get(column)).as(column).isNull();
		}
		var status = db.queryForMap("SELECT * FROM telemetry_events WHERE session_id=? AND kind='STATUS'", session);
		assertThat(((Number) status.get("battery_pct")).intValue()).isEqualTo(80);
		assertThat(status.get("velocity")).isNull();
		assertThat(status.get("t_recv")).isNull();
	}

	@Test
	void sameSessionIdFromAnotherUserIsKeptSeparateAndUnknownPlayIsAccepted() throws Exception {
		assertThat(db.queryForObject("SELECT count(*) FROM play_sessions WHERE id=?", Integer.class, session)).isZero();
		assertThat(postBatch(batch(SENSOR_HIT), admin).getResponse().getStatus()).isEqualTo(200);
		assertThat(postBatch(batch(STATUS, KEYBOARD_HIT), otherAdmin).getResponse().getStatus()).isEqualTo(200);
		assertThat(db.queryForObject("SELECT count(*) FROM telemetry_events WHERE session_id=? AND user_id=?", Integer.class, session, admin)).isEqualTo(1);
		assertThat(db.queryForObject("SELECT count(*) FROM telemetry_events WHERE session_id=? AND user_id=?", Integer.class, session, otherAdmin)).isEqualTo(2);
	}

	@Test
	void anyInvalidEventRejectsTheWholeBatch() throws Exception {
		var r = postBatch(batch(SENSOR_HIT, KEYBOARD_HIT, STATUS.replace("\"batteryPct\":80", "\"batteryPct\":101")), admin);
		problem(r, 400, "TELEMETRY_EVENT_INVALID");
		assertThat(body(r).path("detail").asString()).contains("events[2].batteryPct");
		problem(postBatch(batch(SENSOR_HIT.replace("\"SNARE\"", "\"SMALL_TOM\"")), admin), 400, "INVALID_INPUT");
		problem(postBatch(batch(SENSOR_HIT).replace("\"schemaVersion\":1", "\"schemaVersion\":2"), admin), 400, "TELEMETRY_SCHEMA_UNSUPPORTED");
		problem(postBatch("{", admin), 400, "INVALID_INPUT");
		problem(send(post(BATCHES).contentType(MediaType.TEXT_PLAIN).content(batch(SENSOR_HIT)), admin), 415, "UNSUPPORTED_MEDIA_TYPE");
		assertThat(stored()).isZero();
	}

	@Test
	void oversizedBatchesAreRejectedWith413() throws Exception {
		problem(postBatch(batch(Collections.nCopies(101, KEYBOARD_HIT).toArray(String[]::new)), admin), 413, "TELEMETRY_BATCH_TOO_LARGE");
		problem(postBatch(batch(SENSOR_HIT) + " ".repeat(TelemetryJson.MAX_BYTES), admin), 413, "TELEMETRY_BATCH_TOO_LARGE");
		assertThat(stored()).isZero();
		var r = postBatch(batch(Collections.nCopies(100, KEYBOARD_HIT).toArray(String[]::new)), admin);
		assertThat(body(r).path("acceptedCount").intValue()).isEqualTo(100);
		assertThat(stored()).isEqualTo(100);
	}

	@Test
	void databaseFailureRollsBackRowsAlreadyWritten() throws Exception {
		doAnswer(call -> {
			call.callRealMethod();
			throw new DataIntegrityViolationException("주입한 저장 실패");
		}).when(events).insert(anyLong(), any());
		problem(postBatch(batch(SENSOR_HIT, KEYBOARD_HIT, STATUS), admin), 500, "INTERNAL_ERROR");
		assertThat(stored()).isZero();
	}

	// --- ADMIN 조회 ---

	static final String SESSIONS = "/api/telemetry/sessions";

	UUID later;

	/** admin: session(3건, base) · later(1건, base+2분), otherAdmin: 같은 session UUID(1건, base) */
	void seedQueries() throws Exception {
		later = UUID.randomUUID();
		assertThat(postBatch(batch(SENSOR_HIT, KEYBOARD_HIT, STATUS), admin).getResponse().getStatus()).isEqualTo(200);
		assertThat(postBatch(batchAt(later, base.plus(Duration.ofMinutes(2)), STATUS).replace("\"mode\":\"RHYTHM\"", "\"mode\":null"), admin)
				.getResponse().getStatus()).isEqualTo(200);
		assertThat(postBatch(batch(KEYBOARD_HIT), otherAdmin).getResponse().getStatus()).isEqualTo(200);
	}

	JsonNode ok(MockHttpServletRequestBuilder request) throws Exception {
		var r = send(request, admin);
		assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(200);
		return body(r);
	}

	List<JsonNode> items(JsonNode page) {
		var list = new java.util.ArrayList<JsonNode>();
		page.path("items").forEach(list::add);
		return list;
	}

	@Test
	void sessionListGroupsByUserAndSessionNewestFirst() throws Exception {
		seedQueries();
		var page = ok(get(SESSIONS).param("userId", String.valueOf(admin)));
		assertThat(page.propertyNames()).containsExactlyInAnyOrder("items", "page", "size", "totalElements", "totalPages", "hasNext");
		assertThat(page.path("size").intValue()).isEqualTo(20);
		var rows = items(page);
		assertThat(rows).hasSize(2);
		assertThat(rows.get(0).path("sessionId").asString()).isEqualTo(later.toString());
		assertThat(rows.get(0).path("mode").isNull()).isTrue();
		var first = rows.get(1);
		assertThat(first.propertyNames()).containsExactlyInAnyOrder("userId", "sessionId", "mode", "firstEventTime", "lastEventTime",
				"eventCount", "hitCount", "statusCount");
		assertThat(first.path("userId").longValue()).isEqualTo(admin);
		assertThat(first.path("mode").asString()).isEqualTo("RHYTHM");
		assertThat(Instant.parse(first.path("firstEventTime").asString())).isEqualTo(base);
		assertThat(Instant.parse(first.path("lastEventTime").asString())).isEqualTo(base.plusSeconds(1));
		assertThat(first.path("eventCount").intValue()).isEqualTo(3);
		assertThat(first.path("hitCount").intValue()).isEqualTo(2);
		assertThat(first.path("statusCount").intValue()).isEqualTo(1);

		var all = items(ok(get(SESSIONS).param("size", "100"))).stream()
				.filter(row -> row.path("sessionId").asString().equals(session.toString())).toList();
		assertThat(all).extracting(row -> row.path("userId").longValue()).containsExactlyInAnyOrder(admin, otherAdmin);

		var paged = ok(get(SESSIONS).param("userId", String.valueOf(admin)).param("size", "1").param("page", "1"));
		assertThat(paged.path("totalElements").longValue()).isEqualTo(2);
		assertThat(paged.path("hasNext").booleanValue()).isFalse();
		assertThat(items(paged).getFirst().path("sessionId").asString()).isEqualTo(session.toString());
	}

	@Test
	void sessionListFiltersByEventTimeAndLimitsTheRange() throws Exception {
		seedQueries();
		var before = ok(get(SESSIONS).param("userId", String.valueOf(admin))
				.param("from", base.minus(Duration.ofDays(3)).toString()).param("to", base.minusSeconds(1).toString()));
		assertThat(before.path("totalElements").longValue()).isZero();
		var exact = ok(get(SESSIONS).param("userId", String.valueOf(admin))
				.param("from", base.toString()).param("to", base.toString()));
		assertThat(items(exact)).singleElement().satisfies(row -> assertThat(row.path("eventCount").intValue()).isEqualTo(1));
		ok(get(SESSIONS).param("from", base.minus(Duration.ofDays(31)).toString()).param("to", base.toString()));

		problem(send(get(SESSIONS).param("from", base.toString()).param("to", base.minusSeconds(1).toString()), admin), 400, "VALIDATION_FAILED");
		problem(send(get(SESSIONS).param("from", base.minus(Duration.ofDays(31)).minusSeconds(1).toString()).param("to", base.toString()), admin),
				400, "VALIDATION_FAILED");
		problem(send(get(SESSIONS).param("from", "어제"), admin), 400, "INVALID_INPUT");
		problem(send(get(SESSIONS).param("size", "101"), admin), 400, "VALIDATION_FAILED");
		problem(send(get(SESSIONS).param("size", "0"), admin), 400, "VALIDATION_FAILED");
		problem(send(get(SESSIONS).param("page", "-1"), admin), 400, "VALIDATION_FAILED");
		problem(send(get(SESSIONS).param("userId", "0"), admin), 400, "VALIDATION_FAILED");
		problem(send(get(SESSIONS), user), 403, "FORBIDDEN");
		problem(send(get(SESSIONS), null), 401, "UNAUTHORIZED");
	}

	@Test
	void sessionEventsReturnStoredValuesInTimeOrderPerUser() throws Exception {
		seedQueries();
		var path = SESSIONS + "/" + session + "/events";
		var page = ok(get(path).param("userId", String.valueOf(admin)));
		assertThat(page.path("size").intValue()).isEqualTo(500);
		var rows = items(page);
		assertThat(rows).extracting(row -> row.path("kind").asString()).containsExactly("HIT", "HIT", "STATUS");
		var sensor = rows.get(0);
		assertThat(sensor.propertyNames()).containsExactlyInAnyOrder("time", "kind", "stickId", "pad", "baselinePad", "predictedPad",
				"judgement", "deltaMs", "velocity", "tSensor", "tRecv", "tJudge", "tAudio", "clockOffsetMs", "packetLoss", "batteryPct", "tags");
		assertThat(Instant.parse(sensor.path("time").asString())).isEqualTo(base);
		assertThat(sensor.path("stickId").intValue()).isZero();
		assertThat(sensor.path("pad").asString()).isEqualTo("SNARE");
		assertThat(sensor.path("deltaMs").doubleValue()).isEqualTo(8.5);
		assertThat(sensor.path("tSensor").longValue()).isEqualTo(1000123L);
		assertThat(sensor.path("tJudge").doubleValue()).isEqualTo(1000.4);
		assertThat(sensor.path("clockOffsetMs").doubleValue()).isEqualTo(-12.25);
		assertThat(sensor.path("tags").path("firmware").asString()).isEqualTo("0.3.1");
		var keyboard = rows.get(1);
		assertThat(keyboard.path("pad").asString()).isEqualTo("HIHAT_PEDAL");
		for (var field : List.of("stickId", "tSensor", "clockOffsetMs", "tAudio", "judgement", "deltaMs")) {
			assertThat(keyboard.has(field)).as(field).isTrue();
			assertThat(keyboard.path(field).isNull()).as(field).isTrue();
		}
		assertThat(rows.get(2).path("batteryPct").intValue()).isEqualTo(80);
		assertThat(rows.get(2).path("packetLoss").doubleValue()).isCloseTo(0.02, org.assertj.core.data.Offset.offset(1e-6));

		assertThat(items(ok(get(path).param("userId", String.valueOf(otherAdmin))))).singleElement()
				.satisfies(row -> assertThat(row.path("pad").asString()).isEqualTo("HIHAT_PEDAL"));
		assertThat(items(ok(get(path).param("userId", String.valueOf(admin)).param("kind", "STATUS")))).hasSize(1);
		var paged = ok(get(path).param("userId", String.valueOf(admin)).param("size", "2"));
		assertThat(items(paged)).hasSize(2);
		assertThat(paged.path("totalElements").longValue()).isEqualTo(3);
		assertThat(paged.path("hasNext").booleanValue()).isTrue();
		assertThat(items(ok(get(path).param("userId", String.valueOf(admin)).param("size", "2").param("page", "1"))))
				.singleElement().satisfies(row -> assertThat(row.path("kind").asString()).isEqualTo("STATUS"));
		var unknown = ok(get(SESSIONS + "/" + UUID.randomUUID() + "/events").param("userId", String.valueOf(admin)));
		assertThat(unknown.path("totalElements").longValue()).isZero();
		assertThat(items(unknown)).isEmpty();
	}

	@Test
	void sessionEventsValidateParameters() throws Exception {
		var path = SESSIONS + "/" + session + "/events";
		problem(send(get(path), admin), 400, "INVALID_INPUT");
		problem(send(get(path).param("userId", "0"), admin), 400, "VALIDATION_FAILED");
		problem(send(get(path).param("userId", "1").param("size", "1001"), admin), 400, "VALIDATION_FAILED");
		problem(send(get(path).param("userId", "1").param("kind", "BOTH"), admin), 400, "INVALID_INPUT");
		problem(send(get(SESSIONS + "/not-a-uuid/events").param("userId", "1"), admin), 400, "INVALID_INPUT");
		problem(send(get(path).param("userId", "1"), user), 403, "FORBIDDEN");
	}

}
