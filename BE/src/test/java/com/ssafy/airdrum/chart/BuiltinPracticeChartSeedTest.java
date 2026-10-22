package com.ssafy.airdrum.chart;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.auth.AccessTokenService;
import com.ssafy.airdrum.chart.asset.ChartAssetStore;
import com.ssafy.airdrum.user.AuthUser;
import com.ssafy.airdrum.user.UserRole;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.http.HttpHeaders.AUTHORIZATION;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/** V10이 넣은 3개 공용 채보를 실제 조회 흐름과 독립 원본 결과로 검증한다. */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class BuiltinPracticeChartSeedTest {

	private static final List<Expected> EXPECTED = List.of(
			new Expected("기본 8비트", "EASY", 90, 21333, 96,
					"acfae1ca6f3f3a850f738c7aef507050dbf9d48d88bda3eccc95235e1e0c4949"),
			new Expected("8비트 + 필인", "NORMAL", 100, 19200, 104,
					"d76618df57ee8aa0a6fca5262e4b470b4544c566bb9221cc8de0bd66765c05c7"),
			new Expected("라이드 16비트", "HARD", 120, 16000, 128,
					"78c38836bb35d22af2be4548d39b6db8da0620ac6097079330d80ff747649795"));

	@Autowired MockMvc mvc;
	@Autowired JdbcTemplate db;
	@Autowired JsonMapper json;
	@Autowired AccessTokenService tokens;
	@MockitoBean ChartAssetStore store;
	String token;

	@BeforeEach
	void authenticate() {
		long user = db.queryForObject("INSERT INTO users(nickname) VALUES (?) RETURNING id", Long.class, "내장 채보 검증 회원");
		token = tokens.issue(new AuthUser(user, UserRole.USER), Instant.now()).token();
	}

	@Test
	void seedIsReachableFromListToDetailToFixedVersionAndHasNoAssets() throws Exception {
		JsonNode list = ok("/api/v1/songs");
		assertThat(list.path("totalElements").intValue()).isEqualTo(EXPECTED.size());
		assertThat(list.path("items").size()).isEqualTo(EXPECTED.size());

		for (Expected expected : EXPECTED) {
			JsonNode item = findByTitle(list.path("items"), expected.title());
			assertThat(item.path("id").isIntegralNumber()).isTrue();
			assertThat(item.path("source").asString()).isEqualTo("BUILTIN");
			assertThat(item.path("status").asString()).isEqualTo("READY");
			assertThat(item.path("bpm").intValue()).isEqualTo(expected.bpm());
			assertThat(item.path("durationMs").intValue()).isEqualTo(expected.durationMs());
			assertThat(item.path("hasAccompaniment").booleanValue()).isFalse();
			assertThat(item.path("difficulties").toString()).isEqualTo("[\"" + expected.difficulty() + "\"]");

			long songId = item.path("id").longValue();
			JsonNode detail = ok("/api/v1/songs/" + songId);
			assertThat(detail.path("id").longValue()).isEqualTo(songId);
			assertThat(detail.path("artist").isNull()).isTrue();
			assertThat(detail.path("license").asString()).contains("별도 라이선스 표기 없음", "음원 미포함");
			JsonNode summary = detail.path("charts").get(0);
			assertThat(detail.path("charts").size()).isEqualTo(1);
			assertThat(summary.path("difficulty").asString()).isEqualTo(expected.difficulty());
			assertThat(summary.path("version").intValue()).isEqualTo(1);
			assertThat(summary.path("noteCount").intValue()).isEqualTo(expected.noteCount());
			assertThat(summary.path("notationStatus").asString()).isEqualTo("UNAVAILABLE");

			long chartId = summary.path("id").longValue();
			long versionId = summary.path("chartVersionId").longValue();
			JsonNode latest = ok("/api/v1/charts/" + chartId);
			JsonNode fixed = ok("/api/v1/chart-versions/" + versionId);
			assertChartDocument(latest, fixed, expected);

			JsonNode assets = ok("/api/v1/chart-versions/" + versionId + "/assets");
			assertThat(assets.path("chartVersionId").longValue()).isEqualTo(versionId);
			assertThat(assets.path("notationStatus").asString()).isEqualTo("UNAVAILABLE");
			assertThat(assets.path("sheetPages").isEmpty()).isTrue();
			assertThat(assets.path("accompanimentUrl").isNull()).isTrue();
			assertThat(assets.path("assetsExpireAt").isNull()).isTrue();
		}
		verifyNoInteractions(store);
	}

	private void assertChartDocument(JsonNode latest, JsonNode fixed, Expected expected) {
		for (JsonNode document : List.of(latest, fixed)) {
			assertThat(document.path("source").asString()).isEqualTo("BUILTIN");
			assertThat(document.path("difficulty").asString()).isEqualTo(expected.difficulty());
			assertThat(document.path("version").intValue()).isEqualTo(1);
			assertThat(document.path("schemaVersion").intValue()).isEqualTo(1);
			assertThat(document.path("bpm").intValue()).isEqualTo(expected.bpm());
			assertThat(document.path("offsetMs").intValue()).isZero();
			assertThat(document.path("timeSignature").asString()).isEqualTo("4/4");
			assertThat(document.path("durationMs").intValue()).isEqualTo(expected.durationMs());
			assertThat(document.path("noteCount").intValue()).isEqualTo(expected.noteCount());
			assertThat(document.path("notationStatus").asString()).isEqualTo("UNAVAILABLE");
			assertThat(document.path("hasSheetImages").booleanValue()).isFalse();
			assertThat(document.path("timing").path("bpm").intValue()).isEqualTo(expected.bpm());
			assertThat(document.path("timing").path("offsetMs").intValue()).isZero();
			assertThat(document.path("timing").path("timeSignature").asString()).isEqualTo("4/4");
			assertNotes(document.path("notes"), expected);
		}
		assertThat(latest.path("chartVersionId").longValue()).isEqualTo(fixed.path("chartVersionId").longValue());
		assertThat(latest.path("notes").toString()).isEqualTo(fixed.path("notes").toString());
		assertThat(latest.path("timing").toString()).isEqualTo(fixed.path("timing").toString());
	}

	private void assertNotes(JsonNode notes, Expected expected) {
		assertThat(notes.size()).isEqualTo(expected.noteCount());
		StringBuilder canonical = new StringBuilder();
		for (int i = 0; i < notes.size(); i++) {
			JsonNode note = notes.get(i);
			assertThat(note.path("noteId").asString()).isEqualTo("n" + String.format("%04d", i + 1));
			assertThat(note.path("timeMs").isNumber()).isTrue();
			double timeMs = note.path("timeMs").doubleValue();
			assertThat(timeMs).isEqualTo((double) note.path("timeMs").longValue());
			assertThat(note.path("pad").asString()).isNotBlank();
			assertThat(note.path("velocityHint").intValue()).isBetween(0, 127);
			assertThat(note.path("notation").isNull()).isTrue();
			if (i > 0) assertThat(note.path("timeMs").longValue()).isGreaterThanOrEqualTo(notes.get(i - 1).path("timeMs").longValue());
			if (canonical.length() > 0) canonical.append('\n');
			canonical.append(note.path("timeMs").longValue()).append('|')
					.append(note.path("pad").asString()).append('|').append(note.path("velocityHint").intValue());
		}
		assertThat(sha256(canonical.toString())).isEqualTo(expected.canonicalHash());
		if (expected.title().equals("8비트 + 필인")) {
			assertNote(notes.get(48), "n0049", 8850, "HI_TOM", 90);
			assertNote(notes.get(52), "n0053", 9600, "CRASH", 115);
		}
		if (expected.title().equals("라이드 16비트")) {
			assertNote(notes.get(61), "n0062", 7625, "HI_TOM", 95);
			assertNote(notes.get(63), "n0064", 7875, "CRASH", 110);
		}
	}

	private void assertNote(JsonNode note, String id, long time, String pad, int velocity) {
		assertThat(note.path("noteId").asString()).isEqualTo(id);
		assertThat(note.path("timeMs").longValue()).isEqualTo(time);
		assertThat(note.path("pad").asString()).isEqualTo(pad);
		assertThat(note.path("velocityHint").intValue()).isEqualTo(velocity);
	}

	private JsonNode findByTitle(JsonNode items, String title) {
		for (JsonNode item : items) if (title.equals(item.path("title").asString())) return item;
		throw new AssertionError("공용 곡을 찾지 못했습니다: " + title);
	}

	private JsonNode ok(String path) throws Exception {
		MvcResult result = mvc.perform(get(path).header(AUTHORIZATION, "Bearer " + token)).andReturn();
		assertThat(result.getResponse().getStatus()).as(result.getResponse().getContentAsString()).isEqualTo(200);
		return json.readTree(result.getResponse().getContentAsString());
	}

	private static String sha256(String value) {
		try {
			return HexFormatHolder.HEX.formatHex(MessageDigest.getInstance("SHA-256")
					.digest(value.getBytes(StandardCharsets.UTF_8)));
		}
		catch (Exception ex) {
			throw new AssertionError(ex);
		}
	}

	private record Expected(String title, String difficulty, int bpm, int durationMs, int noteCount,
			String canonicalHash) {}

	private static final class HexFormatHolder {
		private static final java.util.HexFormat HEX = java.util.HexFormat.of();
	}
}
