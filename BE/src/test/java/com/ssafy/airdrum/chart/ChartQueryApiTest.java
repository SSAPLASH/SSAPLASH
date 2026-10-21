package com.ssafy.airdrum.chart;

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
import com.ssafy.airdrum.chart.asset.ChartAssetStore;
import com.ssafy.airdrum.chart.web.ChartQueryUserResolver;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.common.error.CommonErrorCode;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/** 실제 PostgreSQL과 MVC를 함께 검증한다. 신원·스토리지만 대역이며 JWT 통합 증거는 아니다. */
@SpringBootTest(properties = "spring.jpa.properties.hibernate.session_factory.statement_inspector=com.ssafy.airdrum.chart.QuerySqlCapture")
@AutoConfigureMockMvc
@Transactional
class ChartQueryApiTest {
	@Autowired MockMvc mvc;
	@Autowired JdbcTemplate db;
	@Autowired JsonMapper json;
	@MockitoBean ChartQueryUserResolver identity;
	@MockitoBean ChartAssetStore store;
	long owner, other, builtin, ownSong, hiddenSong, chart, version;
	static final String TIMING = """
		{"bpm":120,"offsetMs":250,"timeSignature":"4/4","ppq":480,
		 "tempoMap":[{"tick":0,"bpm":120},{"tick":480,"bpm":60}],
		 "timeSignatureMap":[{"tick":0,"numerator":4,"denominator":4}],
		 "internalKey":"never-expose"}
		""";
	static final String NOTES = """
		[{"noteId":"n0001","timeMs":250,"pad":"SNARE","velocityHint":80,
		"notation":{"tick":0,"durationTicks":480,"voice":1},"internalKey":"never-expose"}]
		""";
	@BeforeEach void seed() {
		owner = user("조회 소유자"); other = user("다른 회원");
		builtin = song(null, "기본", "BUILTIN", "READY");
		ownSong = song(owner, "내 곡", "AUDIO", "READY");
		hiddenSong = song(other, "타인 곡", "AUDIO", "READY");
		chart = chart(ownSong, "NORMAL");
		version = version(chart, 1, NOTES, TIMING, "PENDING");
		doReturn(owner).when(identity).requireUserId(any());
		QuerySqlCapture.clear();
	}
	@Test void scopesSearchAndCountsNeverExposeOtherSongs() throws Exception {
		var built = ok("/api/v1/songs");
		assertThat(built.path("totalElements").longValue()).isEqualTo(1);
		assertThat(built.path("items").get(0).path("id").longValue()).isEqualTo(builtin);
		assertThat(built.path("items").get(0).has("notes")).isFalse();
		var mine = ok("/api/v1/songs?source=MINE");
		assertThat(mine.path("totalElements").longValue()).isEqualTo(1);
		assertThat(mine.path("items").get(0).path("difficulties").get(0).asString()).isEqualTo("NORMAL");
		assertThat(ok("/api/v1/songs?source=MINE&q=타인").path("totalElements").longValue()).isZero();
		assertThat(ok("/api/v1/songs?source=MINE&page=9").path("items").size()).isZero();
		assertThat(ok("/api/v1/songs?source=MINE&page=9").path("totalElements").longValue()).isEqualTo(1);
	}
	@Test void searchTreatsWildcardAndEscapeAsLiteralAndTrimsBeforeValidation() throws Exception {
		song(owner, "100%_! Beat", "MIDI", "READY");
		var r = mvc.perform(get("/api/v1/songs").param("source", "MINE").param("q", "%_!")).andReturn();
		assertThat(r.getResponse().getStatus()).isEqualTo(200);
		assertThat(body(r).path("totalElements").longValue()).isEqualTo(1);
		var spaces = mvc.perform(get("/api/v1/songs").param("q", " ".repeat(110) + "기본" + " ".repeat(110))).andReturn();
		assertThat(spaces.getResponse().getStatus()).isEqualTo(200);
		assertThat(body(spaces).path("totalElements").longValue()).isEqualTo(1);
	}
	@Test void privateDeletedAndMissingResourcesAreIndistinguishableIncludingAdmin() throws Exception {
		long foreignChart = chart(hiddenSong, "EASY");
		long foreignVersion = version(foreignChart, 1, NOTES, TIMING, "READY");
		db.update("UPDATE users SET role='ADMIN' WHERE id=?", owner);
		for (var path : List.of("/api/v1/songs/" + hiddenSong, "/api/v1/songs/9223372036854775807"))
			problem(path, 404, "SONG_NOT_FOUND");
		problem("/api/v1/charts/" + foreignChart, 404, "CHART_NOT_FOUND");
		problem("/api/v1/chart-versions/" + foreignVersion, 404, "CHART_VERSION_NOT_FOUND");
		problem("/api/v1/chart-versions/" + foreignVersion + "/assets", 404, "CHART_VERSION_NOT_FOUND");
		db.update("UPDATE songs SET deleted_at=now() WHERE id=?", ownSong);
		problem("/api/v1/songs/" + ownSong, 404, "SONG_NOT_FOUND");
		problem("/api/v1/charts/" + chart, 404, "CHART_NOT_FOUND");
		problem("/api/v1/chart-versions/" + version, 404, "CHART_VERSION_NOT_FOUND");
		problem("/api/v1/chart-versions/" + version + "/assets", 404, "CHART_VERSION_NOT_FOUND");
		verifyNoInteractions(store);
	}
	@Test void authenticationPrecedesValidationAndInactiveUserCannotReadBuiltin() throws Exception {
		when(identity.requireUserId(any())).thenThrow(new BusinessException(CommonErrorCode.UNAUTHORIZED));
		problem("/api/v1/songs/not-a-number?size=-1", 401, "UNAUTHORIZED");
		doReturn(owner).when(identity).requireUserId(any());
		db.update("UPDATE users SET status='WITHDRAWN', withdrawn_at=now() WHERE id=?", owner);
		problem("/api/v1/songs", 401, "UNAUTHORIZED");
		problem("/api/v1/chart-versions/" + version + "/assets", 401, "UNAUTHORIZED");
	}
	@Test void inputConstraintsUseCommonProblemFormat() throws Exception {
		for (var query : List.of("?page=-1", "?page=100001", "?size=0", "?size=101"))
			problem("/api/v1/songs" + query, 400, "VALIDATION_FAILED");
		problem("/api/v1/songs?source=AUDIO", 400, "INVALID_INPUT");
		problem("/api/v1/songs/0", 400, "VALIDATION_FAILED");
		problem("/api/v1/charts/-1", 400, "VALIDATION_FAILED");
		problem("/api/v1/chart-versions/9223372036854775808", 400, "INVALID_INPUT");
		var r = mvc.perform(get("/api/v1/songs").param("q", "x".repeat(101))).andReturn();
		assertThat(r.getResponse().getStatus()).isEqualTo(400);
	}
	@Test void nonReadyPrivateSongsKeepMetadataButNotPlayableCharts() throws Exception {
		for (String state : List.of("PROCESSING", "FAILED")) {
			db.update("UPDATE songs SET status=? WHERE id=?", state, ownSong);
			var song = ok("/api/v1/songs/" + ownSong);
			assertThat(song.path("status").asString()).isEqualTo(state);
			assertThat(song.path("charts").isEmpty()).isTrue();
			assertThat(song.path("difficulties").isEmpty()).isTrue();
			problem("/api/v1/charts/" + chart, 409, "SONG_NOT_READY");
			problem("/api/v1/chart-versions/" + version + "/assets", 409, "SONG_NOT_READY");
		}
		db.update("UPDATE songs SET status='FAILED' WHERE id=?", builtin);
		assertThat(ok("/api/v1/songs").path("items").size()).isZero();
		problem("/api/v1/songs/" + builtin, 404, "SONG_NOT_FOUND");
	}
	@Test void latestUsesVersionNumberAndOldTimingSurvivesSongChanges() throws Exception {
		long v3 = version(chart, 3, NOTES.replace("250", "750"), TIMING.replace("250", "750"), "UNAVAILABLE");
		version(chart, 2, NOTES.replace("250", "500"), TIMING.replace("250", "500"), "READY");
		db.update("UPDATE songs SET bpm=90, offset_ms=999, time_signature='3/4' WHERE id=?", ownSong);
		var latest = ok("/api/v1/charts/" + chart);
		assertThat(latest.path("chartVersionId").longValue()).isEqualTo(v3);
		var fixed = ok("/api/v1/chart-versions/" + version);
		assertThat(fixed.path("bpm").doubleValue()).isEqualTo(120);
		assertThat(fixed.path("offsetMs").intValue()).isEqualTo(250);
		assertThat(fixed.path("notes").get(0).path("timeMs").doubleValue()).isEqualTo(250);
		assertThat(fixed.path("notes").get(0).path("noteId").asString()).isEqualTo("n0001");
		assertThat(fixed.path("beatsPerBar").intValue()).isEqualTo(4);
		assertThat(fixed.toString()).doesNotContain("internalKey", "never-expose", "imageKey", "ownerId", "accompanimentKey");
		assertThat(fixed.path("hasSheetImages").booleanValue()).isFalse();
		assertThat(fixed.path("title").asString()).isEqualTo("내 곡");
		var summary = ok("/api/v1/songs/" + ownSong).path("charts").get(0);
		assertThat(summary.path("chartVersionId").longValue()).isEqualTo(v3);
	}
	@Test void emptyChartAndUnknownVersionAre404AndUnsupportedSchema409() throws Exception {
		long empty = chart(ownSong, "HARD");
		problem("/api/v1/charts/" + empty, 404, "CHART_NOT_FOUND");
		problem("/api/v1/chart-versions/9223372036854775807", 404, "CHART_VERSION_NOT_FOUND");
		db.update("UPDATE chart_versions SET schema_version=2 WHERE id=?", version);
		problem("/api/v1/chart-versions/" + version, 409, "CHART_SCHEMA_UNSUPPORTED");
		problem("/api/v1/chart-versions/" + version + "/assets", 409, "CHART_SCHEMA_UNSUPPORTED");
	}
	@Test void corruptStoredJsonIsSafe500WithoutFallingBackToSongDefaults() throws Exception {
		db.update("UPDATE chart_versions SET timing='{}'::jsonb WHERE id=?", version);
		var r = problem("/api/v1/chart-versions/" + version, 500, "INTERNAL_ERROR");
		assertThat(r.toString()).doesNotContain("SELECT", "jsonb", "internalKey", "저장된");
	}
	@Test void listIsBoundedQueriesAndDoesNotSelectLargeJson() throws Exception {
		QuerySqlCapture.clear();
		ok("/api/v1/songs?source=MINE&size=1");
		int first = QuerySqlCapture.statements().size();
		for (int i = 0; i < 5; i++) {
			long s = song(owner, "추가" + i, "MIDI", "READY");
			version(chart(s, "EASY"), 1, NOTES, TIMING, "READY");
		}
		QuerySqlCapture.clear();
		var page = ok("/api/v1/songs?source=MINE&size=100");
		var sql = QuerySqlCapture.statements();
		assertThat(page.path("items").size()).isEqualTo(6);
		assertThat(sql).hasSize(first);
		assertThat(first).isLessThanOrEqualTo(5);
		assertThat(String.join("\n", sql).toLowerCase()).doesNotContain("v.notes", "v.timing", "sheet_pages", "select *");
	}
	@Test void stableOrderAndDifficultyOrderHaveNoDuplicates() throws Exception {
		long s2 = song(owner, "둘", "MIDI", "READY");
		db.update("UPDATE songs SET created_at='2026-01-01T00:00:00Z' WHERE owner_id=?", owner);
		version(chart(ownSong, "HARD"), 1, NOTES, TIMING, "READY");
		version(chart(ownSong, "EASY"), 1, NOTES, TIMING, "READY");
		var items = ok("/api/v1/songs?source=MINE").path("items");
		assertThat(items.get(0).path("id").longValue()).isEqualTo(s2);
		var charts = ok("/api/v1/songs/" + ownSong).path("charts");
		assertThat(charts.get(0).path("difficulty").asString()).isEqualTo("EASY");
		assertThat(charts.get(1).path("difficulty").asString()).isEqualTo("NORMAL");
		assertThat(charts.get(2).path("difficulty").asString()).isEqualTo("HARD");
	}
	@Test void absentAssetsAreExplicitNullAndDoNotCallStorage() throws Exception {
		db.update("UPDATE chart_versions SET notation_status='READY' WHERE id=?", version);
		var assets = ok("/api/v1/chart-versions/" + version + "/assets");
		assertThat(assets.path("sheetPages").isEmpty()).isTrue();
		assertThat(assets.has("assetsExpireAt")).isTrue();
		assertThat(assets.path("assetsExpireAt").isNull()).isTrue();
		assertThat(assets.path("accompanimentUrl").isNull()).isTrue();
		verifyNoInteractions(store);
	}
	@Test void assetsConvertTempoMapKeepVersionAndUseEarliestExpiry() throws Exception {
		image();
		db.update("UPDATE songs SET accompaniment_key=? WHERE id=?", "accompaniment/" + ownSong + ".wav", ownSong);
		Instant imageExpiry = Instant.now().plusSeconds(600), audioExpiry = imageExpiry.minusSeconds(60);
		when(store.sign(eq(ChartAssetStore.Kind.SHEET), anyString())).thenReturn(new ChartAssetStore.SignedAsset("https://asset.test/page", imageExpiry));
		when(store.sign(eq(ChartAssetStore.Kind.ACCOMPANIMENT), anyString())).thenReturn(new ChartAssetStore.SignedAsset("https://asset.test/audio", audioExpiry));
		var assets = ok("/api/v1/chart-versions/" + version + "/assets");
		assertThat(assets.path("chartVersionId").longValue()).isEqualTo(version);
		assertThat(assets.path("assetsExpireAt").asString()).isEqualTo(audioExpiry.toString());
		assertThat(assets.path("sheetPages").get(0).path("fromMs").doubleValue()).isEqualTo(250);
		assertThat(assets.path("sheetPages").get(0).path("toMs").doubleValue()).isEqualTo(1750);
		assertThat(assets.toString()).doesNotContain("imageKey", "notes", "sheet/" + version);
		QuerySqlCapture.clear();
		ok("/api/v1/chart-versions/" + version + "/assets");
		assertThat(String.join("\n", QuerySqlCapture.statements())).doesNotContain("v.notes");
	}
	@Test void missingSheetTimingIs409ButNotesRemainReadable() throws Exception {
		image();
		db.update("UPDATE chart_versions SET timing=timing-'ppq' WHERE id=?", version);
		problem("/api/v1/chart-versions/" + version + "/assets", 409, "CHART_SHEET_TIMING_UNAVAILABLE");
		ok("/api/v1/chart-versions/" + version);
		verifyNoInteractions(store);
	}
	@Test void foreignOrTemporaryFileKeysAreNeverSigned() throws Exception {
		for (String key : List.of("sheet/999999/1.png", "tmp/job/1/drums.wav", "sheet/" + version + "/../1.png")) {
			setImageKey(key);
			problem("/api/v1/chart-versions/" + version + "/assets", 500, "INTERNAL_ERROR");
		}
		verifyNoInteractions(store);
	}
	@Test void storageFailuresDoNotBecomeEmptyAssetsOrExposeDetails() throws Exception {
		image();
		when(store.sign(any(), anyString())).thenThrow(new BusinessException(ChartErrorCode.CHART_ASSET_NOT_FOUND));
		problem("/api/v1/chart-versions/" + version + "/assets", 404, "CHART_ASSET_NOT_FOUND");
		doThrow(new BusinessException(ChartErrorCode.CHART_ASSET_UNAVAILABLE)).when(store).sign(any(), anyString());
		problem("/api/v1/chart-versions/" + version + "/assets", 503, "CHART_ASSET_UNAVAILABLE");
		ok("/api/v1/chart-versions/" + version);
	}
	@Test void withdrawalDuringSigningPreventsResponse() throws Exception {
		image();
		when(store.sign(any(), anyString())).thenAnswer(call -> {
			db.update("UPDATE users SET status='WITHDRAWN', withdrawn_at=now() WHERE id=?", owner);
			return new ChartAssetStore.SignedAsset("https://asset.test/secret", Instant.now().plusSeconds(600));
		});
		var r = problem("/api/v1/chart-versions/" + version + "/assets", 401, "UNAUTHORIZED");
		assertThat(r.toString()).doesNotContain("https://asset.test");
	}
	@Test void deletionDuringSigningPreventsResponse() throws Exception {
		image();
		when(store.sign(any(), anyString())).thenAnswer(call -> {
			db.update("UPDATE songs SET deleted_at=now() WHERE id=?", ownSong);
			return new ChartAssetStore.SignedAsset("https://asset.test/secret", Instant.now().plusSeconds(600));
		});
		problem("/api/v1/chart-versions/" + version + "/assets", 404, "CHART_VERSION_NOT_FOUND");
	}
	@Test void openApiDocumentsAllFivePathsSecurityAndNoIdentityParameter() throws Exception {
		var api = body(mvc.perform(get("/v3/api-docs")).andReturn());
		for (String path : List.of("/api/v1/songs", "/api/v1/songs/{songId}", "/api/v1/charts/{chartId}",
				"/api/v1/chart-versions/{chartVersionId}", "/api/v1/chart-versions/{chartVersionId}/assets")) {
			var operation = api.path("paths").path(path).path("get");
			assertThat(operation.path("security").get(0).has("bearerAuth")).isTrue();
			assertThat(operation.path("responses").has("401")).isTrue();
			assertThat(operation.path("parameters").toString()).doesNotContain("userId");
		}
	}
	private long user(String name) { return db.queryForObject("INSERT INTO users(nickname) VALUES (?) RETURNING id", Long.class, name); }
	private long song(Long user, String title, String source, String status) {
		return db.queryForObject("INSERT INTO songs(owner_id,title,source,status,bpm,time_signature,duration_ms,license) VALUES (?,?,?,?,120,'4/4',3000,?) RETURNING id",
				Long.class, user, title, source, status, user == null ? "CC0" : null);
	}
	private long chart(long song, String difficulty) {
		return db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES (?,?) RETURNING id", Long.class, song, difficulty);
	}
	private long version(long chart, int number, String notes, String timing, String notation) {
		return db.queryForObject("INSERT INTO chart_versions(chart_id,version,notes,timing,note_count,generator,notation_status) VALUES (?,?,CAST(? AS jsonb),CAST(? AS jsonb),1,'MANUAL',?) RETURNING id",
				Long.class, chart, number, notes, timing, notation);
	}
	private void image() { setImageKey("sheet/" + version + "/1.png"); }
	private void setImageKey(String key) {
		db.update("UPDATE chart_versions SET sheet_pages=CAST(? AS jsonb) WHERE id=?",
				"[{\"page\":1,\"imageKey\":\"" + key + "\",\"fromTick\":0,\"toTick\":960}]", version);
	}
	private JsonNode ok(String path) throws Exception {
		var r = mvc.perform(get(path)).andReturn();
		assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(200);
		assertThat(r.getResponse().getHeader("Cache-Control")).isEqualTo("private, no-store");
		return body(r);
	}
	private JsonNode problem(String path, int status, String code) throws Exception {
		var r = mvc.perform(get(path)).andReturn();
		assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(status);
		assertThat(r.getResponse().getContentType()).startsWith("application/problem+json");
		assertThat(r.getResponse().getHeader("Cache-Control")).isEqualTo("private, no-store");
		var body = body(r);
		assertThat(body.path("code").asString()).isEqualTo(code);
		assertThat(body.path("instance").asString()).doesNotContain("?");
		return body;
	}
	private JsonNode body(MvcResult result) throws Exception { return json.readTree(result.getResponse().getContentAsString()); }
}
