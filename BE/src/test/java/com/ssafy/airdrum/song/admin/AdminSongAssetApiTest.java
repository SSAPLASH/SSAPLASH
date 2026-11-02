package com.ssafy.airdrum.song.admin;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Instant;

import javax.imageio.ImageIO;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.AbstractMockHttpServletRequestBuilder;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.auth.AccessTokenService;
import com.ssafy.airdrum.chart.asset.ChartAssetStore;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.song.AccompanimentStorage;
import com.ssafy.airdrum.song.CoverStorage;
import com.ssafy.airdrum.song.audio.AudioErrorCode;
import com.ssafy.airdrum.song.audio.AudioProbe;
import com.ssafy.airdrum.support.SignupConsentFixtures;
import com.ssafy.airdrum.user.AuthUser;
import com.ssafy.airdrum.user.UserRole;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;

/** 156번 설계 4-4·4-5·4-6절: 공용 곡 커버·반주 등록·교체·삭제와 일반 조회 노출. 저장소와 ffprobe는 대체한다. */
@SpringBootTest
@AutoConfigureMockMvc
class AdminSongAssetApiTest {

	@Autowired MockMvc mvc;
	@Autowired JdbcTemplate db;
	@Autowired AccessTokenService tokens;
	@MockitoBean CoverStorage covers;
	@MockitoBean AccompanimentStorage backings;
	@MockitoBean AudioProbe probe;
	@MockitoBean ChartAssetStore assets;
	final JsonMapper json = new JsonMapper();
	long admin, user, song, version;

	@BeforeEach
	void seed() {
		admin = db.queryForObject("INSERT INTO users(nickname,role) VALUES('자산 관리자','ADMIN') RETURNING id", Long.class);
		user = db.queryForObject("INSERT INTO users(nickname) VALUES('자산 회원') RETURNING id", Long.class);
		SignupConsentFixtures.complete(db, user);
		song = db.queryForObject("INSERT INTO songs(title,source,status,license,bpm,time_signature) VALUES('관리 테스트 자산','BUILTIN','READY','x',120,'4/4') RETURNING id", Long.class);
		long chart = db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,'EASY') RETURNING id", Long.class, song);
		version = db.queryForObject("""
				INSERT INTO chart_versions(chart_id,version,notes,timing,notation_status,note_count,generator)
				VALUES(?,1,'[{"noteId":"n0001","timeMs":0,"pad":"KICK"}]'::jsonb,'{"bpm":120,"offsetMs":0,"timeSignature":"4/4"}'::jsonb,'UNAVAILABLE',1,'BUILTIN') RETURNING id
				""", Long.class, chart);
		when(covers.sign(anyString())).thenAnswer(i -> "https://objects.test/" + i.getArgument(0));
		when(assets.sign(any(), anyString())).thenAnswer(i -> new ChartAssetStore.SignedAsset("https://objects.test/" + i.getArgument(1), Instant.parse("2026-10-30T00:10:00Z")));
		when(probe.inspect(any())).thenReturn(new AudioProbe.Info("audio/wav", 30_000));
	}

	@AfterEach
	void cleanup() {
		db.update("DELETE FROM file_cleanup_tasks WHERE object_key LIKE ? OR object_key LIKE ?", "cover/builtin/" + song + "/%", "accompaniment/" + song + "/%");
		db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT id FROM charts WHERE song_id=?)", song);
		db.update("DELETE FROM charts WHERE song_id=?", song);
		db.update("DELETE FROM songs WHERE id=?", song);
		db.update("DELETE FROM users WHERE id IN (?,?)", admin, user);
	}

	MvcResult send(AbstractMockHttpServletRequestBuilder<?> request, long as) throws Exception {
		var role = as == admin ? UserRole.ADMIN : UserRole.USER;
		request.header(HttpHeaders.AUTHORIZATION, "Bearer " + tokens.issue(new AuthUser(as, role), Instant.now()).token());
		return mvc.perform(request).andReturn();
	}

	MvcResult put(String path, byte[] bytes, String filename) throws Exception {
		return send(multipart(path).file(new MockMultipartFile("file", filename, "application/octet-stream", bytes))
				.with(r -> { r.setMethod("PUT"); return r; }), admin);
	}

	JsonNode body(MvcResult r) throws Exception {
		return json.readTree(r.getResponse().getContentAsString(StandardCharsets.UTF_8));
	}

	void problem(MvcResult r, int status, String code) throws Exception {
		assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString(StandardCharsets.UTF_8)).isEqualTo(status);
		assertThat(body(r).path("code").asString()).isEqualTo(code);
	}

	static byte[] image(String format) throws Exception {
		var out = new ByteArrayOutputStream();
		ImageIO.write(new BufferedImage(4, 4, BufferedImage.TYPE_INT_RGB), format, out);
		return out.toByteArray();
	}

	String column(String name) {
		return db.queryForObject("SELECT " + name + " FROM songs WHERE id=?", String.class, song);
	}

	boolean cleanupDue(String key) {
		return db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE object_key=? AND user_id IS NULL AND next_attempt_at<=clock_timestamp()",
				Integer.class, key) == 1;
	}

	String cover() { return "/api/v1/admin/songs/" + song + "/cover"; }
	String backing() { return "/api/v1/admin/songs/" + song + "/accompaniment"; }

	@Test
	void 공용_곡_커버를_올리면_일반_목록과_상세에_보이고_교체_삭제하면_이전_객체를_정리한다() throws Exception {
		var r = put(cover(), image("png"), "cover.txt");
		assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString(StandardCharsets.UTF_8)).isEqualTo(200);
		String first = column("cover_key");
		assertThat(first).matches("cover/builtin/" + song + "/[0-9a-f-]{36}\\.png");
		assertThat(body(r).path("coverUrl").asString()).isEqualTo("https://objects.test/" + first);
		verify(covers).put(eq(first), any(), eq("image/png"));
		assertThat(db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE object_key=? AND file_role='COVER' AND user_id IS NULL", Integer.class, first)).isOne();

		var list = body(send(get("/api/v1/songs").param("source", "BUILTIN").param("q", "관리 테스트 자산"), user));
		assertThat(list.path("items").get(0).path("coverUrl").asString()).isEqualTo("https://objects.test/" + first);
		assertThat(body(send(get("/api/v1/songs/" + song), user)).path("coverUrl").asString()).isEqualTo("https://objects.test/" + first);
		var detail = body(send(get("/api/v1/admin/songs/" + song), admin));
		assertThat(detail.path("hasCover").asBoolean()).isTrue();
		assertThat(detail.path("coverUrl").asString()).isEqualTo("https://objects.test/" + first);

		assertThat(put(cover(), image("jpg"), "x").getResponse().getStatus()).isEqualTo(200);
		assertThat(column("cover_key")).endsWith(".jpg").isNotEqualTo(first);
		assertThat(cleanupDue(first)).isTrue();

		String second = column("cover_key");
		assertThat(send(delete(cover()), admin).getResponse().getStatus()).isEqualTo(204);
		assertThat(column("cover_key")).isNull();
		assertThat(cleanupDue(second)).isTrue();
		assertThat(send(delete(cover()), admin).getResponse().getStatus()).isEqualTo(204);
		assertThat(body(send(get("/api/v1/songs/" + song), user)).path("coverUrl").isNull()).isTrue();
	}

	@Test
	void 커버_입력_오류() throws Exception {
		problem(put(cover(), "not image".getBytes(StandardCharsets.UTF_8), "x"), 400, "COVER_INVALID");
		problem(put(cover(), new byte[0], "x"), 400, "COVER_INVALID");
		problem(put(cover(), image("gif"), "x"), 415, "COVER_UNSUPPORTED");
		problem(send(multipart(cover()).with(r -> { r.setMethod("PUT"); return r; }), admin), 400, "COVER_INVALID");
		problem(send(multipart(cover()).with(r -> { r.setMethod("PUT"); return r; }), user), 403, "FORBIDDEN");
		assertThat(column("cover_key")).isNull();
		verify(covers, never()).put(anyString(), any(), anyString());
	}

	@Test
	void 공용_곡_반주를_올리면_assets에_URL이_오고_교체_삭제하면_이전_객체를_정리한다() throws Exception {
		var r = put(backing(), "RIFF....WAVE".getBytes(StandardCharsets.US_ASCII), "x.mp3");
		assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString(StandardCharsets.UTF_8)).isEqualTo(200);
		String first = column("accompaniment_key");
		assertThat(first).matches("accompaniment/" + song + "/[0-9a-f-]{36}\\.wav");
		assertThat(body(r).path("accompanimentUrl").asString()).isEqualTo("https://objects.test/" + first);
		assertThat(body(r).path("expiresAt").asString()).isEqualTo("2026-10-30T00:10:00Z");
		verify(backings).put(eq(first), any(Path.class), eq(12L), eq("audio/wav"));
		assertThat(db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE object_key=? AND file_role='ACCOMPANIMENT' AND user_id IS NULL", Integer.class, first)).isOne();

		var assetsBody = body(send(get("/api/v1/chart-versions/" + version + "/assets"), user));
		assertThat(assetsBody.path("accompanimentUrl").asString()).isEqualTo("https://objects.test/" + first);
		assertThat(body(send(get("/api/v1/admin/songs/" + song), admin)).path("hasAccompaniment").asBoolean()).isTrue();

		when(probe.inspect(any())).thenReturn(new AudioProbe.Info("audio/mpeg", 60_000));
		assertThat(put(backing(), new byte[] {1, 2, 3}, "x").getResponse().getStatus()).isEqualTo(200);
		assertThat(column("accompaniment_key")).endsWith(".mp3");
		assertThat(cleanupDue(first)).isTrue();

		String second = column("accompaniment_key");
		assertThat(send(delete(backing()), admin).getResponse().getStatus()).isEqualTo(204);
		assertThat(column("accompaniment_key")).isNull();
		assertThat(cleanupDue(second)).isTrue();
		assertThat(send(delete(backing()), admin).getResponse().getStatus()).isEqualTo(204);
	}

	@Test
	void 반주_입력_오류와_저장소_장애() throws Exception {
		problem(put(backing(), new byte[0], "x"), 400, "ACCOMPANIMENT_INVALID");
		problem(send(multipart(backing()).with(r -> { r.setMethod("PUT"); return r; }), admin), 400, "ACCOMPANIMENT_INVALID");

		doThrow(new BusinessException(AudioErrorCode.UNSUPPORTED)).when(probe).inspect(any());
		problem(put(backing(), new byte[] {1}, "x"), 422, "ACCOMPANIMENT_UNSUPPORTED");
		doReturn(new AudioProbe.Info("audio/wav", 600_001)).when(probe).inspect(any());
		problem(put(backing(), new byte[] {1}, "x"), 422, "ACCOMPANIMENT_UNSUPPORTED");
		doThrow(new BusinessException(AudioErrorCode.UNAVAILABLE)).when(probe).inspect(any());
		problem(put(backing(), new byte[] {1}, "x"), 503, "ACCOMPANIMENT_UNAVAILABLE");

		doReturn(new AudioProbe.Info("audio/wav", 1_000)).when(probe).inspect(any());
		doThrow(new IllegalStateException("down")).when(backings).put(anyString(), any(), anyLong(), anyString());
		problem(put(backing(), new byte[] {1}, "x"), 503, "ACCOMPANIMENT_UNAVAILABLE");
		assertThat(column("accompaniment_key")).isNull();
	}

	@Test
	void 곡을_삭제하면_커버와_반주를_정리_큐에_넣는다() throws Exception {
		put(cover(), image("png"), "x");
		put(backing(), new byte[] {1}, "x");
		String coverKey = column("cover_key"), backingKey = column("accompaniment_key");

		assertThat(send(delete("/api/v1/admin/songs/" + song), admin).getResponse().getStatus()).isEqualTo(204);

		assertThat(cleanupDue(coverKey)).isTrue();
		assertThat(cleanupDue(backingKey)).isTrue();
		problem(send(get("/api/v1/songs/" + song), user), 404, "SONG_NOT_FOUND");
		problem(put(cover(), image("png"), "x"), 404, "SONG_NOT_FOUND");
		problem(put(backing(), new byte[] {1}, "x"), 404, "SONG_NOT_FOUND");
	}
}
