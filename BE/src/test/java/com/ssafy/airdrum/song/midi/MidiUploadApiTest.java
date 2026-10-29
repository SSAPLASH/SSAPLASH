package com.ssafy.airdrum.song.midi;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Arrays;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.AbstractMockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.auth.AccessTokenService;
import com.ssafy.airdrum.user.AuthUser;
import com.ssafy.airdrum.user.UserRole;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;

/**
 * 실제 JWT·임베디드 PG·MVC로 업로드 → 저장 → 조회 왕복을 검사한다(설계 6절).
 * 저장 실패 롤백을 확인하려고 테스트 트랜잭션을 쓰지 않고 직접 지운다.
 */
@SpringBootTest
@AutoConfigureMockMvc
class MidiUploadApiTest {

	static final String URL = "/api/v1/songs/midi";

	@Autowired
	MockMvc mvc;
	@Autowired
	JdbcTemplate db;
	@Autowired
	AccessTokenService tokens;
	@MockitoSpyBean
	MidiChartRepository repository;

	final JsonMapper json = new JsonMapper();
	long user;

	@BeforeEach
	void seed() {
		user = db.queryForObject("INSERT INTO users(nickname) VALUES('MIDI 회원') RETURNING id", Long.class);
	}

	@AfterEach
	void cleanup() {
		db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT c.id FROM charts c JOIN songs s ON s.id=c.song_id WHERE s.owner_id=?)", user);
		db.update("DELETE FROM charts WHERE song_id IN (SELECT id FROM songs WHERE owner_id=?)", user);
		db.update("DELETE FROM songs WHERE owner_id=?", user);
		db.update("DELETE FROM users WHERE id=?", user);
	}

	/** 100BPM 3/4, 2마디: 킥·스네어·하이햇(8분)·페달. */
	static byte[] groove() {
		var f = MidiFixtures.ppq(480).tempo(0, 100).signature(0, 3, 2);
		for (int bar = 0; bar < 2; bar++) {
			long start = bar * 1440L;
			f.drum(start, 36).drum(start + 480, 38).drum(start + 960, 38).drum(start + 960, 44);
			for (int i = 0; i < 6; i++) f.drum(start + i * 240L, 42);
		}
		return f.bytes();
	}

	MockMultipartHttpServletRequestBuilder upload(byte[] bytes) {
		return multipart(URL).file(new MockMultipartFile("file", "groove.mid", "audio/midi", bytes));
	}

	MvcResult send(AbstractMockHttpServletRequestBuilder<?> request, Long as) throws Exception {
		if (as != null) request.header(HttpHeaders.AUTHORIZATION,
				"Bearer " + tokens.issue(new AuthUser(as, UserRole.USER), Instant.now()).token());
		return mvc.perform(request).andReturn();
	}

	JsonNode body(MvcResult r) throws Exception {
		return json.readTree(r.getResponse().getContentAsString(StandardCharsets.UTF_8));
	}

	void problem(MvcResult r, int status, String code) throws Exception {
		assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString(StandardCharsets.UTF_8)).isEqualTo(status);
		assertThat(body(r).path("code").asString()).isEqualTo(code);
		assertThat(songCount()).isZero();
	}

	int songCount() {
		return db.queryForObject("SELECT count(*) FROM songs WHERE owner_id=?", Integer.class, user);
	}

	@Test
	void 업로드하면_곡과_3난이도_채보를_만들고_201로_곡_상세를_준다() throws Exception {
		var r = send(upload(groove()).param("title", "  내 그루브 ").param("artist", "  "), user);

		assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString(StandardCharsets.UTF_8)).isEqualTo(201);
		var song = body(r);
		long songId = song.path("id").asLong();
		assertThat(r.getResponse().getHeader(HttpHeaders.LOCATION)).isEqualTo("/api/v1/songs/" + songId);
		assertThat(r.getResponse().getHeader(HttpHeaders.CACHE_CONTROL)).isEqualTo("private, no-store");
		assertThat(song.path("title").asString()).isEqualTo("내 그루브");
		assertThat(song.path("artist").isNull()).isTrue();
		assertThat(song.path("source").asString()).isEqualTo("MIDI");
		assertThat(song.path("status").asString()).isEqualTo("READY");
		assertThat(song.path("bpm").decimalValue()).isEqualByComparingTo("100.00");
		assertThat(song.path("timeSignature").asString()).isEqualTo("3/4");
		assertThat(song.path("hasAccompaniment").asBoolean()).isFalse();
		// 마지막 노트(하이햇 2640 tick)에서 3/4 한 마디(1440 tick) 뒤 = 4080 tick, 100BPM이면 5100ms
		assertThat(song.path("durationMs").asInt()).isEqualTo(5100);
		var charts = song.path("charts");
		assertThat(charts).hasSize(3);
		assertThat(charts.findValuesAsString("difficulty")).containsExactly("EASY", "NORMAL", "HARD");
		for (var c : charts) assertThat(c.path("notationStatus").asString()).isEqualTo("PENDING");

		var rows = db.queryForList("SELECT v.generator,v.generator_version,v.version,v.sheet_pages IS NULL AS no_pages FROM chart_versions v "
				+ "JOIN charts c ON c.id=v.chart_id WHERE c.song_id=?", songId);
		assertThat(rows).hasSize(3).allSatisfy(row -> {
			assertThat(row.get("generator")).isEqualTo("MIDI_RULE");
			assertThat(row.get("generator_version")).isEqualTo("midi-rule-1.1");
			assertThat(row.get("version")).isEqualTo(1);
			assertThat(row.get("no_pages")).isEqualTo(true);
		});
	}

	@Test
	void 만든_곡은_내_곡_목록과_채보_조회에서_그대로_읽힌다() throws Exception {
		var song = body(send(upload(groove()).param("title", "왕복"), user));

		var list = body(send(get("/api/v1/songs?source=MINE"), user));
		assertThat(list.path("items").findValuesAsString("title")).containsExactly("왕복");

		var hard = song.path("charts").get(2);
		var chart = body(send(get("/api/v1/charts/" + hard.path("id").asLong()), user));
		assertThat(chart.path("source").asString()).isEqualTo("MIDI");
		assertThat(chart.path("chartVersionId").asLong()).isEqualTo(hard.path("chartVersionId").asLong());
		// HARD: 마디마다 킥1·스네어2·페달1·하이햇6 = 10, 2마디 20
		assertThat(chart.path("noteCount").asInt()).isEqualTo(20);
		assertThat(chart.path("notes").get(0).path("pad").asString()).isEqualTo("KICK");
		assertThat(chart.path("notes").get(0).path("notation").path("voice").asInt()).isEqualTo(2);
		assertThat(chart.path("timing").path("ppq").asInt()).isEqualTo(480);
		assertThat(chart.path("notes").findValuesAsString("pad")).contains("HIHAT_PEDAL");

		var easy = body(send(get("/api/v1/charts/" + song.path("charts").get(0).path("id").asLong()), user));
		assertThat(easy.path("notes").findValuesAsString("pad")).contains("HIHAT").doesNotContain("HIHAT_PEDAL");
	}

	@Test
	void 토큰이_없거나_탈퇴_회원이면_401() throws Exception {
		assertThat(send(upload(groove()).param("title", "곡"), null).getResponse().getStatus()).isEqualTo(401);
		db.update("UPDATE users SET status='WITHDRAWN',withdrawn_at=now() WHERE id=?", user);
		assertThat(send(upload(groove()).param("title", "곡"), user).getResponse().getStatus()).isEqualTo(401);
		assertThat(songCount()).isZero();
	}

	@Test
	void 요청_형태가_틀리면_400() throws Exception {
		problem(send(upload(groove()), user), 400, "MIDI_INVALID");
		problem(send(upload(groove()).param("title", "   "), user), 400, "MIDI_INVALID");
		problem(send(upload(groove()).param("title", "가".repeat(101)), user), 400, "MIDI_INVALID");
		problem(send(upload(groove()).param("title", "곡").param("artist", "가".repeat(101)), user), 400, "MIDI_INVALID");
		problem(send(upload(groove()).param("title", "곡").param("title", "곡2"), user), 400, "MIDI_INVALID");
		problem(send(upload(groove()).param("title", "곡").param("extra", "x"), user), 400, "MIDI_INVALID");
		problem(send(upload(groove()).file(new MockMultipartFile("file", "b.mid", "audio/midi", groove())).param("title", "곡"), user),
				400, "MIDI_INVALID");
		problem(send(multipart(URL).param("title", "곡"), user), 400, "MIDI_INVALID");
		problem(send(upload(new byte[0]).param("title", "곡"), user), 400, "MIDI_INVALID");
	}

	@Test
	void 파일이_1MiB를_넘으면_413_딱_1MiB는_내용_검사로_넘어간다() throws Exception {
		var big = Arrays.copyOf("MThd".getBytes(StandardCharsets.US_ASCII), 1024 * 1024 + 1);
		problem(send(upload(big).param("title", "큰 파일"), user), 413, "MIDI_TOO_LARGE");
		problem(send(upload(Arrays.copyOf(big, 1024 * 1024)).param("title", "경계"), user), 422, "MIDI_UNSUPPORTED");
	}

	@Test
	void MIDI가_아니면_422_UNSUPPORTED() throws Exception {
		problem(send(upload("not midi".getBytes(StandardCharsets.UTF_8)).param("title", "곡"), user), 422, "MIDI_UNSUPPORTED");
	}

	@Test
	void 드럼_채널에_패드로_바꿀_노트가_없으면_422_NO_DRUM_NOTES() throws Exception {
		var piano = MidiFixtures.ppq(480).note(0, 0, 60, 100, 480).note(0, 0, 36, 100, 480).bytes();
		problem(send(upload(piano).param("title", "피아노"), user), 422, "MIDI_NO_DRUM_NOTES");
		var cowbell = MidiFixtures.ppq(480).drum(0, 56).drum(480, 39).bytes();
		problem(send(upload(cowbell).param("title", "카우벨"), user), 422, "MIDI_NO_DRUM_NOTES");
	}

	@Test
	void 노트가_5만개를_넘으면_422() throws Exception {
		var f = MidiFixtures.ppq(480);
		for (int i = 0; i <= 50_000; i++) f.note(i * 10L, 9, 36, 100, 0);
		problem(send(upload(f.bytes()).param("title", "많음"), user), 422, "MIDI_UNSUPPORTED");
	}

	@Test
	void 채보_버전_저장이_실패하면_곡과_채보가_하나도_남지_않는다() throws Exception {
		var calls = new int[1];
		doAnswer(i -> {
			var id = i.callRealMethod();
			if (++calls[0] == 3) throw new IllegalStateException("주입한 실패");
			return id;
		}).when(repository).insertVersion(anyLong(), any());

		var r = send(upload(groove()).param("title", "롤백"), user);

		assertThat(r.getResponse().getStatus()).isEqualTo(500);
		assertThat(calls[0]).isEqualTo(3);
		assertThat(songCount()).isZero();
	}

}
