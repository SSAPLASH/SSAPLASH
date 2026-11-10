package com.ssafy.airdrum.song.musicxml;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder;

import com.sun.net.httpserver.HttpServer;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.auth.AccessTokenService;
import com.ssafy.airdrum.support.SignupConsentFixtures;
import com.ssafy.airdrum.user.AuthUser;
import com.ssafy.airdrum.user.UserRole;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;

/**
 * 293 설계 6장 인수 조건. 실제 JWT·임베디드 PG·MockMvc에 가짜 AI 서버(JDK HttpServer)를 붙여 `POST /api/v1/songs/musicxml`을 검사한다.
 * AI 응답은 테스트마다 바꾼다. 저장 실패 롤백을 보려고 테스트 트랜잭션을 쓰지 않고 직접 지운다.
 */
@SpringBootTest
@AutoConfigureMockMvc
class MusicXmlUploadApiTest {

	static final String UPLOAD = "/api/v1/songs/musicxml";
	static final HttpServer AI;
	static volatile int aiStatus = 200;
	static volatile byte[] aiBody;
	static final AtomicReference<String> aiUri = new AtomicReference<>();
	static final AtomicReference<String> aiContentType = new AtomicReference<>();
	static final AtomicReference<byte[]> aiRequestBody = new AtomicReference<>();
	static final AtomicInteger aiCalls = new AtomicInteger();

	static final String CHART = """
			{"schemaVersion":1,"generator":"ADT_MODEL","generatorVersion":"sheet-musicxml-3","metrics":{"convertMs":5},
			 "charts":[{"difficulty":"NORMAL","notationStatus":"UNAVAILABLE","notes":[
			   {"noteId":"n0001","timeMs":250,"pad":"KICK"},{"noteId":"n0002","timeMs":250,"pad":"HIHAT","hihatOpen":true},
			   {"noteId":"n0003","timeMs":375,"pad":"HIHAT"},{"noteId":"n0004","timeMs":500,"pad":"HIHAT"},
			   {"noteId":"n0005","timeMs":625,"pad":"HIHAT"},{"noteId":"n0006","timeMs":750,"pad":"SNARE","velocityHint":110}],
			   "timing":{"bpm":120,"offsetMs":250,"timeSignature":"3/4"}}]}""";
	static final String OK = "{\"chart\":" + CHART + ",\"sheet\":{\"duration_ms\":4250,\"n_notes\":6,\"measures_played\":2,\"generator_version\":\"sheet-musicxml-3\"}}";
	static final byte[] XML = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><score-partwise version=\"4.0\"><part-list/><part id=\"P1\"/></score-partwise>"
			.getBytes(StandardCharsets.UTF_8);

	static {
		try {
			AI = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
			AI.createContext("/chart/sheet", exchange -> {
				aiCalls.incrementAndGet();
				aiUri.set(exchange.getRequestURI().toString());
				aiContentType.set(exchange.getRequestHeaders().getFirst("Content-Type"));
				aiRequestBody.set(exchange.getRequestBody().readAllBytes());
				byte[] body = aiBody;
				exchange.getResponseHeaders().add("Content-Type", "application/json");
				exchange.sendResponseHeaders(aiStatus, body.length);
				exchange.getResponseBody().write(body);
				exchange.close();
			});
			AI.start();
		} catch (IOException ex) {
			throw new IllegalStateException(ex);
		}
	}

	@DynamicPropertySource
	static void aiServer(DynamicPropertyRegistry registry) {
		registry.add("AI_ANALYSIS_BASE_URL", () -> "http://127.0.0.1:" + AI.getAddress().getPort());
	}

	@AfterAll
	static void stopAi() {
		AI.stop(0);
	}

	@Autowired MockMvc mvc;
	@Autowired JdbcTemplate db;
	@Autowired AccessTokenService tokens;
	@MockitoSpyBean MusicXmlChartRepository repository;
	final JsonMapper json = new JsonMapper();
	long user;

	@BeforeEach
	void seed() {
		user = db.queryForObject("INSERT INTO users(nickname) VALUES('MusicXML 회원') RETURNING id", Long.class);
		SignupConsentFixtures.complete(db, user);
		aiStatus = 200;
		aiBody = OK.getBytes(StandardCharsets.UTF_8);
		aiCalls.set(0);
	}

	@AfterEach
	void cleanup() {
		db.update("UPDATE songs SET song_level=NULL,level_chart_version_id=NULL,level_rule_version=NULL,level_duration_ms=NULL WHERE owner_id=?", user);
		db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT c.id FROM charts c JOIN songs s ON s.id=c.song_id WHERE s.owner_id=?)", user);
		db.update("DELETE FROM charts WHERE song_id IN (SELECT id FROM songs WHERE owner_id=?)", user);
		db.update("DELETE FROM songs WHERE owner_id=?", user);
		db.update("DELETE FROM users WHERE id=?", user);
	}

	MvcResult upload(Long as, String title, String artist, MockMultipartFile... files) throws Exception {
		MockMultipartHttpServletRequestBuilder request = multipart(UPLOAD);
		for (var f : files) request.file(f);
		if (title != null) request.param("title", title);
		if (artist != null) request.param("artist", artist);
		if (as != null) request.header(HttpHeaders.AUTHORIZATION, "Bearer " + tokens.issue(new AuthUser(as, UserRole.USER), Instant.now()).token());
		return mvc.perform(request).andReturn();
	}

	static MockMultipartFile file(String name, byte[] bytes) {
		return new MockMultipartFile("file", name, "application/octet-stream", bytes);
	}

	JsonNode body(MvcResult r) throws Exception {
		return json.readTree(r.getResponse().getContentAsString(StandardCharsets.UTF_8));
	}

	void problem(MvcResult r, int status, String code) throws Exception {
		assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString(StandardCharsets.UTF_8)).isEqualTo(status);
		assertThat(body(r).path("code").asString()).isEqualTo(code);
	}

	int songs() {
		return db.queryForObject("SELECT count(*) FROM songs WHERE owner_id=?", Integer.class, user);
	}

	@Test
	void MusicXML을_올리면_AI_채보로_3난이도_곡이_생기고_곡_상세를_돌려준다() throws Exception {
		var r = upload(user, "  내 악보 곡  ", "드러머", file("score.musicxml", XML));
		assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString(StandardCharsets.UTF_8)).isEqualTo(201);
		var song = body(r);
		long id = song.path("id").asLong();
		assertThat(r.getResponse().getHeader("Location")).isEqualTo("/api/v1/songs/" + id);
		assertThat(r.getResponse().getHeader("Cache-Control")).isEqualTo("private, no-store");
		assertThat(song.path("title").asString()).isEqualTo("내 악보 곡");
		assertThat(song.path("artist").asString()).isEqualTo("드러머");
		assertThat(song.path("source").asString()).isEqualTo("MUSICXML");
		assertThat(song.path("status").asString()).isEqualTo("READY");
		assertThat(song.path("hasAccompaniment").booleanValue()).isFalse();
		assertThat(song.path("accompanimentStatus").asString()).isEqualTo("NONE");
		assertThat(song.path("bpm").decimalValue()).isEqualByComparingTo("120.00");
		assertThat(song.path("timeSignature").asString()).isEqualTo("3/4");
		assertThat(song.path("durationMs").asInt()).isEqualTo(4250);
		var difficulties = new java.util.ArrayList<String>();
		song.path("charts").forEach(c -> difficulties.add(c.path("difficulty").asString()));
		assertThat(difficulties).containsExactlyInAnyOrder("EASY", "NORMAL", "HARD");
		// AI에는 파일 바이트를 그대로, 이름은 종류로 정한 값
		assertThat(aiCalls.get()).isEqualTo(1);
		assertThat(aiUri.get()).isEqualTo("/chart/sheet?name=score.musicxml");
		assertThat(aiContentType.get()).isEqualTo("application/octet-stream");
		assertThat(aiRequestBody.get()).isEqualTo(XML);
		// 저장: 곡은 AI timing·sheet.duration_ms, 채보 3개는 MUSICXML_RULE, HARD 원본·파생 버전
		var row = db.queryForMap("SELECT source,status,bpm,offset_ms,time_signature,duration_ms FROM songs WHERE id=?", id);
		assertThat(row.get("source")).isEqualTo("MUSICXML");
		assertThat(((Number) row.get("offset_ms")).intValue()).isEqualTo(250);
		assertThat(row.get("time_signature")).isEqualTo("3/4");
		var versions = db.queryForList("""
				SELECT c.difficulty,v.generator,v.generator_version,v.notation_status,v.note_count,v.notes::text AS notes
				FROM chart_versions v JOIN charts c ON c.id=v.chart_id WHERE c.song_id=? ORDER BY c.difficulty
				""", id);
		assertThat(versions).hasSize(3);
		for (var v : versions) {
			assertThat(v.get("generator")).isEqualTo("MUSICXML_RULE");
			assertThat(v.get("notation_status")).isEqualTo("UNAVAILABLE");
		}
		var hard = versions.stream().filter(v -> v.get("difficulty").equals("HARD")).findFirst().orElseThrow();
		assertThat(hard.get("generator_version")).isEqualTo("sheet-musicxml-3");
		assertThat(((Number) hard.get("note_count")).intValue()).isEqualTo(6);
		assertThat((String) hard.get("notes")).contains("\"hihatOpen\": true").contains("n0006");
		var normal = versions.stream().filter(v -> v.get("difficulty").equals("NORMAL")).findFirst().orElseThrow();
		assertThat(normal.get("generator_version")).isEqualTo("sheet-musicxml-3+midi-rule-2.0");
		assertThat(((Number) normal.get("note_count")).intValue()).isLessThan(6);
		var easy = versions.stream().filter(v -> v.get("difficulty").equals("EASY")).findFirst().orElseThrow();
		assertThat(((Number) easy.get("note_count")).intValue()).isLessThanOrEqualTo(((Number) normal.get("note_count")).intValue());
	}

	@Test
	void mxl은_같은_흐름이고_이름만_다르다() throws Exception {
		byte[] mxl = MusicXmlSnifferTest.mxl("score.xml", new String(XML, StandardCharsets.UTF_8));
		var r = upload(user, "압축 악보", null, file("score.mxl", mxl));
		assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString(StandardCharsets.UTF_8)).isEqualTo(201);
		assertThat(body(r).path("artist").isNull()).isTrue();
		assertThat(aiUri.get()).isEqualTo("/chart/sheet?name=score.mxl");
		assertThat(aiRequestBody.get()).isEqualTo(mxl);
	}

	@Test
	void 요청_형태와_제목_규칙_위반은_400이고_AI를_부르지_않는다() throws Exception {
		problem(upload(user, null, null, file("s.musicxml", XML)), 400, "MUSICXML_INVALID");
		problem(upload(user, "   ", null, file("s.musicxml", XML)), 400, "MUSICXML_INVALID");
		problem(upload(user, "x".repeat(101), null, file("s.musicxml", XML)), 400, "MUSICXML_INVALID");
		problem(upload(user, "제목", "a".repeat(101), file("s.musicxml", XML)), 400, "MUSICXML_INVALID");
		problem(upload(user, "제목", null), 400, "MUSICXML_INVALID");
		problem(upload(user, "제목", null, file("a.musicxml", XML), file("b.musicxml", XML)), 400, "MUSICXML_INVALID");
		problem(upload(user, "제목", null, new MockMultipartFile("files", "a.musicxml", "application/octet-stream", XML)), 400, "MUSICXML_INVALID");
		problem(mvc.perform(multipart(UPLOAD).file(file("s.musicxml", XML)).param("title", "제목").param("note", "x")
				.header(HttpHeaders.AUTHORIZATION, "Bearer " + tokens.issue(new AuthUser(user, UserRole.USER), Instant.now()).token())).andReturn(), 400, "MUSICXML_INVALID");
		problem(upload(user, "제목", null, file("s.musicxml", new byte[0])), 400, "MUSICXML_INVALID");
		problem(upload(null, "제목", null, file("s.musicxml", XML)), 401, "UNAUTHORIZED");
		assertThat(aiCalls.get()).isZero();
		assertThat(songs()).isZero();
	}

	@Test
	void 크기_초과와_MusicXML_아님은_AI를_부르지_않고_거절한다() throws Exception {
		problem(upload(user, "큰 악보", null, file("s.musicxml", new byte[5 * 1024 * 1024 + 1])), 413, "MUSICXML_TOO_LARGE");
		problem(upload(user, "PDF", null, file("s.pdf", "%PDF-1.7".getBytes(StandardCharsets.UTF_8))), 422, "MUSICXML_UNSUPPORTED");
		problem(upload(user, "MIDI", null, file("s.mid", "MThd".getBytes(StandardCharsets.UTF_8))), 422, "MUSICXML_UNSUPPORTED");
		assertThat(aiCalls.get()).isZero();
		assertThat(songs()).isZero();
	}

	@Test
	void AI가_거절하거나_장애면_곡을_만들지_않는다() throws Exception {
		aiStatus = 400;
		aiBody = "{\"error\":\"INPUT_INVALID\",\"message\":\"score-timewise 형식은 받지 않음\"}".getBytes(StandardCharsets.UTF_8);
		var r = upload(user, "timewise", null, file("s.xml", XML));
		problem(r, 422, "MUSICXML_UNSUPPORTED");
		assertThat(body(r).path("detail").asString()).contains("timewise");
		aiStatus = 422;
		aiBody = "{\"error\":\"NO_DRUM_NOTES\",\"message\":\"드럼 파트가 없음\"}".getBytes(StandardCharsets.UTF_8);
		problem(upload(user, "드럼 없음", null, file("s.xml", XML)), 422, "MUSICXML_NO_DRUM_NOTES");
		aiStatus = 500;
		aiBody = "{\"error\":\"INTERNAL_ERROR\"}".getBytes(StandardCharsets.UTF_8);
		problem(upload(user, "장애", null, file("s.xml", XML)), 503, "MUSICXML_UNAVAILABLE");
		aiStatus = 200;
		aiBody = OK.replace("\"ADT_MODEL\"", "\"SOMETHING_ELSE\"").getBytes(StandardCharsets.UTF_8);
		problem(upload(user, "계약 밖", null, file("s.xml", XML)), 503, "MUSICXML_UNAVAILABLE");
		aiBody = OK.replace("\"duration_ms\":4250", "\"duration_ms\":100").getBytes(StandardCharsets.UTF_8);
		problem(upload(user, "길이 모순", null, file("s.xml", XML)), 503, "MUSICXML_UNAVAILABLE");
		assertThat(aiCalls.get()).isEqualTo(5);
		assertThat(songs()).isZero();
	}

	@Test
	void 저장_실패는_500이고_곡_채보_행을_남기지_않는다() throws Exception {
		doAnswer(call -> {
			call.callRealMethod();
			throw new DataIntegrityViolationException("주입한 저장 실패");
		}).when(repository).insertVersion(anyLong(), any(), any());
		problem(upload(user, "롤백", null, file("s.musicxml", XML)), 500, "INTERNAL_ERROR");
		assertThat(songs()).isZero();
		assertThat(db.queryForObject("SELECT count(*) FROM charts c JOIN songs s ON s.id=c.song_id WHERE s.owner_id=?", Integer.class, user)).isZero();
	}

	static List<String> none() {
		return List.of();
	}
}
