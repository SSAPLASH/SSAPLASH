package com.ssafy.airdrum.song;

import java.nio.charset.StandardCharsets;
import java.time.Instant;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.auth.AccessTokenService;
import com.ssafy.airdrum.user.AuthUser;
import com.ssafy.airdrum.user.UserRole;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/** 156번 설계 3-4·3-5절: V22 published 컬럼과 일반 조회의 비공개 공용 곡 404. */
@SpringBootTest
@AutoConfigureMockMvc
class SongPublishedVisibilityTest {

	@Autowired MockMvc mvc;
	@Autowired JdbcTemplate db;
	@Autowired AccessTokenService tokens;
	final JsonMapper json = new JsonMapper();
	long user, song, chart, version;

	@BeforeEach
	void seed() {
		user = db.queryForObject("INSERT INTO users(nickname) VALUES('공개 확인 회원') RETURNING id", Long.class);
		song = db.queryForObject("INSERT INTO songs(title,source,status,license,bpm,time_signature) VALUES('공개 확인 곡','BUILTIN','READY','test',120,'4/4') RETURNING id", Long.class);
		chart = db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,'EASY') RETURNING id", Long.class, song);
		version = db.queryForObject("""
				INSERT INTO chart_versions(chart_id,version,notes,timing,notation_status,note_count,generator)
				VALUES(?,1,'[{"noteId":"n0001","timeMs":0,"pad":"KICK"}]'::jsonb,'{"bpm":120,"offsetMs":0,"timeSignature":"4/4"}'::jsonb,'UNAVAILABLE',1,'BUILTIN') RETURNING id
				""", Long.class, chart);
	}

	@AfterEach
	void cleanup() {
		db.update("DELETE FROM chart_versions WHERE chart_id=?", chart);
		db.update("DELETE FROM charts WHERE id=?", chart);
		db.update("DELETE FROM songs WHERE id=? OR owner_id=?", song, user);
		db.update("DELETE FROM users WHERE id=?", user);
	}

	MvcResult call(String path) throws Exception {
		return mvc.perform(get(path).header(HttpHeaders.AUTHORIZATION,
				"Bearer " + tokens.issue(new AuthUser(user, UserRole.USER), Instant.now()).token())).andReturn();
	}

	boolean listed() throws Exception {
		var body = json.readTree(call("/api/v1/songs?source=BUILTIN&size=100&q=" + "공개 확인 곡").getResponse()
				.getContentAsString(StandardCharsets.UTF_8));
		return body.path("items").findValues("id").stream().anyMatch(id -> id.asLong() == song);
	}

	@Test
	void 기존_행과_새_행은_공개이고_개인_곡은_비공개가_될_수_없다() {
		assertThat(db.queryForObject("SELECT published FROM songs WHERE id=?", Boolean.class, song)).isTrue();
		assertThat(db.queryForObject("SELECT count(*) FROM songs WHERE NOT published", Integer.class)).isZero();
		assertThatThrownBy(() -> db.update("INSERT INTO songs(owner_id,title,source,status,published) VALUES(?,'개인','MIDI','READY',false)", user))
				.isInstanceOf(DataIntegrityViolationException.class);
	}

	@Test
	void 비공개_공용_곡은_일반_조회에서_없는_곡이고_다시_공개하면_보인다() throws Exception {
		assertThat(listed()).isTrue();

		db.update("UPDATE songs SET published=false WHERE id=?", song);
		assertThat(listed()).isFalse();
		for (var path : new String[] {"/api/v1/songs/" + song, "/api/v1/charts/" + chart,
				"/api/v1/chart-versions/" + version, "/api/v1/chart-versions/" + version + "/assets"})
			assertThat(call(path).getResponse().getStatus()).as(path).isEqualTo(404);

		db.update("UPDATE songs SET published=true WHERE id=?", song);
		assertThat(listed()).isTrue();
		assertThat(call("/api/v1/songs/" + song).getResponse().getStatus()).isEqualTo(200);
		assertThat(call("/api/v1/chart-versions/" + version).getResponse().getStatus()).isEqualTo(200);
	}
}
