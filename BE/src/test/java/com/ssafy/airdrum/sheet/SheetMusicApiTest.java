package com.ssafy.airdrum.sheet;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;

import javax.imageio.ImageIO;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.AbstractMockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.auth.AccessTokenService;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.user.AuthUser;
import com.ssafy.airdrum.user.UserRole;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;

/** 155번 설계 3·4·6절: 내 악보 등록·목록·상세·제목 수정·삭제. 저장소는 대체하고 파일 검사는 실제로 한다. */
@SpringBootTest
@AutoConfigureMockMvc
class SheetMusicApiTest {

	@Autowired MockMvc mvc;
	@Autowired JdbcTemplate db;
	@Autowired AccessTokenService tokens;
	@MockitoBean SheetStorage storage;
	final JsonMapper json = new JsonMapper();
	long user, other;

	@BeforeEach
	void seed() {
		user = db.queryForObject("INSERT INTO users(nickname) VALUES('악보 회원') RETURNING id", Long.class);
		other = db.queryForObject("INSERT INTO users(nickname) VALUES('악보 다른 회원') RETURNING id", Long.class);
		when(storage.sign(anyString())).thenAnswer(i -> "https://objects.test/" + i.getArgument(0));
	}

	@AfterEach
	void clean() {
		db.update("DELETE FROM file_cleanup_tasks WHERE user_id IN (?,?)", user, other);
		db.update("DELETE FROM sheet_music WHERE owner_id IN (?,?)", user, other);
		db.update("DELETE FROM users WHERE id IN (?,?)", user, other);
	}

	@Test
	void 이미지_여러_장으로_등록하면_201과_페이지별_URL을_준다() throws Exception {
		var r = upload(user, "드럼 연습곡 1", null, file("a.png", png(800, 1200)), file("b.jpg", jpg(640, 480)), file("c.png", png(10, 10)));
		assertThat(r.getResponse().getStatus()).as(text(r)).isEqualTo(201);
		var body = body(r);
		long id = body.path("id").asLong();
		assertThat(r.getResponse().getHeader("Location")).isEqualTo("/api/v1/sheets/" + id);
		assertThat(r.getResponse().getHeader("Cache-Control")).isEqualTo("private, no-store");
		assertThat(body.path("title").asString()).isEqualTo("드럼 연습곡 1");
		assertThat(body.path("source").asString()).isEqualTo("UPLOADED");
		assertThat(body.path("kind").asString()).isEqualTo("IMAGE");
		assertThat(body.path("pageCount").asInt()).isEqualTo(3);
		var pages = body.path("pages");
		assertThat(pages.size()).isEqualTo(3);
		assertThat(pages.get(0).path("pageNo").asInt()).isEqualTo(1);
		assertThat(pages.get(0).path("contentType").asString()).isEqualTo("image/png");
		assertThat(pages.get(0).path("width").asInt()).isEqualTo(800);
		assertThat(pages.get(1).path("contentType").asString()).isEqualTo("image/jpeg");
		String key = db.queryForObject("SELECT object_key FROM sheet_music_pages WHERE sheet_id=? AND page_no=1", String.class, id);
		assertThat(key).matches("sheet-music/" + user + "/" + id + "/[0-9a-f-]{36}\\.png");
		assertThat(pages.get(0).path("url").asString()).isEqualTo("https://objects.test/" + key);
		assertThat(body.path("expiresAt").isMissingNode()).isFalse();
		verify(storage, times(3)).put(anyString(), any(), anyLong(), anyString());
		verify(storage).put(eq(key), any(), anyLong(), eq("image/png"));
		assertThat(db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE user_id=? AND file_role='SHEET_MUSIC'", Integer.class, user)).isEqualTo(3);
		assertThat(db.queryForObject("SELECT total_bytes FROM sheet_music WHERE id=?", Long.class, id))
				.isEqualTo(db.queryForObject("SELECT sum(bytes) FROM sheet_music_pages WHERE sheet_id=?", Long.class, id));
	}

	@Test
	void PDF_하나와_RENDERED_출처로_등록할_수_있다() throws Exception {
		var r = upload(user, "렌더링 악보", "RENDERED", file("s.pdf", pdf()));
		assertThat(r.getResponse().getStatus()).as(text(r)).isEqualTo(201);
		var body = body(r);
		assertThat(body.path("kind").asString()).isEqualTo("PDF");
		assertThat(body.path("source").asString()).isEqualTo("RENDERED");
		assertThat(body.path("pages").get(0).path("contentType").asString()).isEqualTo("application/pdf");
		assertThat(body.path("pages").get(0).path("width").isNull()).isTrue();
		assertThat(body.path("thumbnailUrl").isNull()).isTrue();
	}

	@Test
	void 목록은_본인_것만_최신순으로_검색과_페이지가_된다() throws Exception {
		long first = body(upload(user, "첫 악보", null, file("a.png", png(2, 2)))).path("id").asLong();
		long second = body(upload(user, "두번째 50%_악보", null, file("a.png", png(2, 2)))).path("id").asLong();
		upload(other, "남의 악보", null, file("a.png", png(2, 2)));

		var list = body(send(get("/api/v1/sheets"), user));
		assertThat(list.path("items").size()).isEqualTo(2);
		assertThat(list.path("items").get(0).path("id").asLong()).isEqualTo(second);
		assertThat(list.path("items").get(1).path("id").asLong()).isEqualTo(first);
		assertThat(list.path("items").get(0).path("thumbnailUrl").asString()).startsWith("https://objects.test/sheet-music/" + user + "/" + second + "/");
		assertThat(list.path("items").get(0).has("pages")).isFalse();
		assertThat(list.path("totalElements").asLong()).isEqualTo(2);

		var searched = body(send(get("/api/v1/sheets").param("q", "50%_"), user));
		assertThat(searched.path("items").size()).isEqualTo(1);
		assertThat(searched.path("items").get(0).path("id").asLong()).isEqualTo(second);
		var paged = body(send(get("/api/v1/sheets").param("page", "1").param("size", "1"), user));
		assertThat(paged.path("items").get(0).path("id").asLong()).isEqualTo(first);
		assertThat(send(get("/api/v1/sheets").param("size", "101"), user).getResponse().getStatus()).isEqualTo(400);
	}

	@Test
	void 상세_제목수정_삭제와_남의_것은_404() throws Exception {
		long id = body(upload(user, "원래 제목", null, file("a.png", png(2, 2)), file("b.png", png(2, 2)))).path("id").asLong();
		var detail = body(send(get("/api/v1/sheets/" + id), user));
		assertThat(detail.path("pages").size()).isEqualTo(2);

		var patched = send(patch("/api/v1/sheets/" + id).contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"  바뀐 제목 \"}"), user);
		assertThat(patched.getResponse().getStatus()).as(text(patched)).isEqualTo(200);
		assertThat(body(patched).path("title").asString()).isEqualTo("바뀐 제목");
		for (String bad : new String[] {"{}", "{\"title\":\"\"}", "{\"title\":1}", "{\"title\":\"x\",\"kind\":\"PDF\"}", "{\"title\":\"" + "가".repeat(101) + "\"}", "[]", "{\"title\":\"a\"}{}"})
			problem(send(patch("/api/v1/sheets/" + id).contentType(MediaType.APPLICATION_JSON).content(bad), user), 400, "SHEET_INVALID");

		problem(send(get("/api/v1/sheets/" + id), other), 404, "SHEET_NOT_FOUND");
		problem(send(patch("/api/v1/sheets/" + id).contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"남\"}"), other), 404, "SHEET_NOT_FOUND");
		problem(send(delete("/api/v1/sheets/" + id), other), 404, "SHEET_NOT_FOUND");
		problem(send(get("/api/v1/sheets/999999999"), user), 404, "SHEET_NOT_FOUND");
		assertThat(mvc.perform(get("/api/v1/sheets")).andReturn().getResponse().getStatus()).isEqualTo(401);

		var keys = db.queryForList("SELECT object_key FROM sheet_music_pages WHERE sheet_id=?", String.class, id);
		assertThat(send(delete("/api/v1/sheets/" + id), user).getResponse().getStatus()).isEqualTo(204);
		problem(send(get("/api/v1/sheets/" + id), user), 404, "SHEET_NOT_FOUND");
		assertThat(body(send(get("/api/v1/sheets"), user)).path("items").size()).isZero();
		for (String key : keys)
			assertThat(db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE object_key=? AND next_attempt_at<=clock_timestamp()", Integer.class, key)).isOne();
		problem(send(delete("/api/v1/sheets/" + id), user), 404, "SHEET_NOT_FOUND");
	}

	@Test
	void 잘못된_등록은_4xx이고_저장소와_DB에_남기지_않는다() throws Exception {
		problem(upload(user, "악보", null), 400, "SHEET_INVALID");
		problem(upload(user, " ", null, file("a.png", png(2, 2))), 400, "SHEET_INVALID");
		problem(upload(user, null, null, file("a.png", png(2, 2))), 400, "SHEET_INVALID");
		problem(upload(user, "가".repeat(101), null, file("a.png", png(2, 2))), 400, "SHEET_INVALID");
		problem(upload(user, "악보", "SCANNED", file("a.png", png(2, 2))), 400, "SHEET_INVALID");
		problem(upload(user, "악보", null, file("a.png", png(2, 2)), file("b.pdf", pdf())), 400, "SHEET_INVALID");
		problem(upload(user, "악보", null, file("a.pdf", pdf()), file("b.pdf", pdf())), 400, "SHEET_INVALID");
		problem(upload(user, "악보", null, file("a.png", new byte[0])), 400, "SHEET_INVALID");
		problem(upload(user, "악보", null, file("a.png", "가짜".getBytes(StandardCharsets.UTF_8))), 415, "SHEET_UNSUPPORTED");
		problem(upload(user, "악보", null, file("a.gif", gif())), 415, "SHEET_UNSUPPORTED");
		var many = new MockMultipartFile[21];
		byte[] tiny = png(2, 2);
		for (int i = 0; i < many.length; i++) many[i] = file("p" + i + ".png", tiny);
		problem(upload(user, "악보", null, many), 400, "SHEET_INVALID");
		var wrongPart = multipart("/api/v1/sheets").file(new MockMultipartFile("file", "a.png", "image/png", tiny)).param("title", "악보");
		problem(send(wrongPart, user), 400, "SHEET_INVALID");
		var extraField = multipart("/api/v1/sheets").file(file("a.png", tiny)).param("title", "악보").param("songId", "1");
		problem(send(extraField, user), 400, "SHEET_INVALID");

		verify(storage, never()).put(anyString(), any(), anyLong(), anyString());
		assertThat(db.queryForObject("SELECT count(*) FROM sheet_music WHERE owner_id=?", Integer.class, user)).isZero();
		assertThat(db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE user_id=?", Integer.class, user)).isZero();
	}

	@Test
	void 회원당_개수와_용량_상한을_넘으면_413() throws Exception {
		for (int i = 0; i < 100; i++)
			db.update("INSERT INTO sheet_music(owner_id,title,source,kind,page_count,total_bytes) VALUES(?,'채움','UPLOADED','IMAGE',1,1)", user);
		problem(upload(user, "101번째", null, file("a.png", png(2, 2))), 413, "SHEET_QUOTA_EXCEEDED");
		db.update("UPDATE sheet_music SET deleted_at=now() WHERE owner_id=?", user);
		db.update("INSERT INTO sheet_music(owner_id,title,source,kind,page_count,total_bytes) VALUES(?,'큰 악보','UPLOADED','PDF',1,?)", user, 500L * 1024 * 1024 - 10);
		problem(upload(user, "용량 초과", null, file("a.png", png(2, 2))), 413, "SHEET_QUOTA_EXCEEDED");
		verify(storage, never()).put(anyString(), any(), anyLong(), anyString());
	}

	@Test
	void 저장소_장애는_503이고_악보가_남지_않으며_올린_파일은_정리된다() throws Exception {
		doThrow(new BusinessException(SheetError.SHEET_UNAVAILABLE)).doNothing()
				.when(storage).put(anyString(), any(), anyLong(), anyString());
		problem(upload(user, "장애 악보", null, file("a.png", png(2, 2)), file("b.png", png(2, 2))), 503, "SHEET_UNAVAILABLE");
		assertThat(body(send(get("/api/v1/sheets"), user)).path("items").size()).isZero();
		assertThat(db.queryForObject("SELECT count(*) FROM sheet_music WHERE owner_id=? AND deleted_at IS NULL", Integer.class, user)).isZero();
		assertThat(db.queryForObject("SELECT count(*) FROM sheet_music_pages p JOIN sheet_music m ON m.id=p.sheet_id WHERE m.owner_id=?", Integer.class, user)).isZero();
		assertThat(db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE user_id=? AND file_role='SHEET_MUSIC'", Integer.class, user)).isGreaterThanOrEqualTo(1);
	}

	MvcResult upload(long as, String title, String source, MockMultipartFile... files) throws Exception {
		MockMultipartHttpServletRequestBuilder request = multipart("/api/v1/sheets");
		for (var f : files) request.file(f);
		if (title != null) request.param("title", title);
		if (source != null) request.param("source", source);
		return send(request, as);
	}

	MvcResult send(AbstractMockHttpServletRequestBuilder<?> request, long as) throws Exception {
		request.header(HttpHeaders.AUTHORIZATION, "Bearer " + tokens.issue(new AuthUser(as, UserRole.USER), Instant.now()).token());
		return mvc.perform(request).andReturn();
	}

	static MockMultipartFile file(String name, byte[] bytes) {
		return new MockMultipartFile("files", name, "application/octet-stream", bytes);
	}

	JsonNode body(MvcResult r) throws Exception {
		return json.readTree(text(r));
	}

	static String text(MvcResult r) throws Exception {
		return r.getResponse().getContentAsString(StandardCharsets.UTF_8);
	}

	void problem(MvcResult r, int status, String code) throws Exception {
		assertThat(r.getResponse().getStatus()).as(text(r)).isEqualTo(status);
		assertThat(body(r).path("code").asString()).isEqualTo(code);
	}

	static byte[] png(int w, int h) throws Exception { return image("png", w, h); }
	static byte[] jpg(int w, int h) throws Exception { return image("jpg", w, h); }
	static byte[] gif() throws Exception { return image("gif", 2, 2); }

	static byte[] image(String format, int w, int h) throws Exception {
		var out = new ByteArrayOutputStream();
		ImageIO.write(new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB), format, out);
		return out.toByteArray();
	}

	static byte[] pdf() {
		return "%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n".getBytes(StandardCharsets.US_ASCII);
	}
}
