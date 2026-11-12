package com.ssafy.airdrum.domain.recording.controller;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
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

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.domain.auth.service.token.AccessTokenService;
import com.ssafy.airdrum.support.SignupConsentFixtures;
import com.ssafy.airdrum.domain.user.model.AuthUser;
import com.ssafy.airdrum.domain.user.model.UserRole;

import static com.ssafy.airdrum.domain.recording.controller.RecordingFixtures.free;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/** 257번 설계 3-4·4-2절: 녹음 보관함 목록·상세. */
@SpringBootTest
@AutoConfigureMockMvc
class RecordingLibraryApiTest {

	private static final String HASH = "c".repeat(64);

	@Autowired MockMvc mvc;
	@Autowired JdbcTemplate db;
	@Autowired AccessTokenService tokens;
	final JsonMapper json = new JsonMapper();
	long user, other;

	@BeforeEach
	void seed() {
		user = db.queryForObject("INSERT INTO users(nickname) VALUES('보관함 회원') RETURNING id", Long.class);
		SignupConsentFixtures.complete(db, user);
		other = db.queryForObject("INSERT INTO users(nickname) VALUES('보관함 다른 회원') RETURNING id", Long.class);
		SignupConsentFixtures.complete(db, other);
	}

	@AfterEach
	void clean() {
		db.update("DELETE FROM recordings WHERE user_id IN (?,?)", user, other);
		db.update("DELETE FROM play_sessions WHERE user_id IN (?,?)", user, other);
		db.update("DELETE FROM users WHERE id IN (?,?)", user, other);
	}

	@Test
	void 목록은_본인의_살아있는_녹음만_최신순이고_시퀀스는_없다() throws Exception {
		long first = saved(user, "첫 녹음");
		long second = saved(user, "두번째 녹음");
		long third = saved(user, "세번째 녹음");
		saved(other, "남의 녹음");
		db.update("UPDATE recordings SET deleted_at=now() WHERE id=?", second);

		var list = body(send(get("/api/v1/recordings"), user));
		assertThat(list.path("items").size()).isEqualTo(2);
		assertThat(list.path("items").get(0).path("id").asLong()).isEqualTo(third);
		assertThat(list.path("items").get(1).path("id").asLong()).isEqualTo(first);
		assertThat(list.path("totalElements").asLong()).isEqualTo(2);
		var item = list.path("items").get(0);
		assertThat(item.path("title").asString()).isEqualTo("세번째 녹음");
		assertThat(item.path("hitCount").asInt()).isEqualTo(3);
		assertThat(item.has("hits")).isFalse();
		assertThat(item.has("timing")).isFalse();

		var paged = body(send(get("/api/v1/recordings").param("page", "1").param("size", "1"), user));
		assertThat(paged.path("items").get(0).path("id").asLong()).isEqualTo(first);
		assertThat(paged.path("hasNext").asBoolean()).isFalse();
		var response = send(get("/api/v1/recordings"), user);
		assertThat(response.getResponse().getHeader("Cache-Control")).isEqualTo("private, no-store");
	}

	@Test
	void 제목_부분_검색은_특수문자를_글자_그대로_찾는다() throws Exception {
		long plain = saved(user, "즉흥 50점");
		long special = saved(user, "즉흥 50%_연습");
		var all = body(send(get("/api/v1/recordings").param("q", "  즉흥 "), user));
		assertThat(all.path("totalElements").asLong()).isEqualTo(2);
		var escaped = body(send(get("/api/v1/recordings").param("q", "50%_"), user));
		assertThat(escaped.path("items").size()).isEqualTo(1);
		assertThat(escaped.path("items").get(0).path("id").asLong()).isEqualTo(special);
		assertThat(body(send(get("/api/v1/recordings").param("q", "없는 제목"), user)).path("items").size()).isZero();
		assertThat(plain).isNotEqualTo(special);
	}

	@Test
	void 잘못된_목록_파라미터는_400() throws Exception {
		for (String[] bad : new String[][] {{"size", "101"}, {"size", "0"}, {"page", "-1"}, {"page", "100001"}, {"q", "가".repeat(101)}})
			assertThat(send(get("/api/v1/recordings").param(bad[0], bad[1]), user).getResponse().getStatus()).as(bad[0]).isEqualTo(400);
		assertThat(mvc.perform(get("/api/v1/recordings")).andReturn().getResponse().getStatus()).isEqualTo(401);
	}

	@Test
	void 상세는_저장된_시퀀스를_그대로_주고_자유_녹음의_timing은_null() throws Exception {
		long id = saved(user, "즉흥 연주 1");
		var r = send(get("/api/v1/recordings/" + id), user);
		assertThat(r.getResponse().getStatus()).as(text(r)).isEqualTo(200);
		assertThat(r.getResponse().getHeader("Cache-Control")).isEqualTo("private, no-store");
		var d = body(r);
		assertThat(d.path("id").asLong()).isEqualTo(id);
		assertThat(d.path("title").asString()).isEqualTo("즉흥 연주 1");
		assertThat(d.path("hitCount").asInt()).isEqualTo(3);
		assertThat(d.has("timing")).isTrue();
		assertThat(d.path("timing").isNull()).isTrue();
		var hits = d.path("hits");
		assertThat(hits.size()).isEqualTo(3);
		assertThat(hits.get(0).path("tMs").asDouble()).isEqualTo(0.0);
		assertThat(hits.get(0).path("pad").asString()).isEqualTo("SNARE");
		assertThat(hits.get(0).path("velocity").asInt()).isEqualTo(90);
		assertThat(hits.get(0).path("stickId").asInt()).isEqualTo(1);
		assertThat(hits.get(1).path("tMs").asDouble()).isEqualTo(250.5);
		assertThat(hits.get(1).path("pad").asString()).isEqualTo("SMALL_TOM");
		assertThat(hits.get(1).path("stickId").asInt()).isZero();
		assertThat(hits.get(2).path("pad").asString()).isEqualTo("KICK");
		assertThat(hits.get(2).has("stickId")).isFalse();
	}

	@Test
	void 남의_것_지운_것_없는_것은_404() throws Exception {
		long mine = saved(user, "내 녹음");
		problem(send(get("/api/v1/recordings/" + mine), other), 404, "RECORDING_NOT_FOUND");
		problem(send(get("/api/v1/recordings/999999999"), user), 404, "RECORDING_NOT_FOUND");
		db.update("UPDATE recordings SET deleted_at=now() WHERE id=?", mine);
		problem(send(get("/api/v1/recordings/" + mine), user), 404, "RECORDING_NOT_FOUND");
	}

	@Test
	void 리듬_녹음의_timing은_플레이가_고정한_채보_버전_값이고_곡_BPM이_바뀌어도_그대로다() throws Exception {
		var chart = db.queryForMap("SELECT v.id AS version, c.song_id AS song, (v.timing->>'bpm')::float8 AS bpm, (v.timing->>'offsetMs')::int AS offset "
				+ "FROM chart_versions v JOIN charts c ON c.id=v.chart_id JOIN songs s ON s.id=c.song_id WHERE s.owner_id IS NULL ORDER BY v.id LIMIT 1");
		long version = ((Number) chart.get("version")).longValue(), song = ((Number) chart.get("song")).longValue();
		UUID play = UUID.randomUUID();
		db.update("INSERT INTO play_sessions(id,user_id,song_id,chart_version_id,mode,input_source,judgement_context,payload_schema_version,payload_hash,started_at,ended_at) "
				+ "VALUES(?,?,?,?,'RHYTHM','KEYBOARD','{}',1,?,now(),now())", play, user, song, version, HASH);
		String body = free(UUID.randomUUID()).replace("\"playId\":null", "\"playId\":\"" + play + "\"").replace("\"mode\":\"FREE\"", "\"mode\":\"RHYTHM\"");
		var created = send(post("/api/v1/recordings").contentType(MediaType.APPLICATION_JSON).content(body.getBytes(StandardCharsets.UTF_8)), user);
		assertThat(created.getResponse().getStatus()).as(text(created)).isEqualTo(201);
		long id = body(created).path("id").asLong();

		double songBpm = db.queryForObject("SELECT bpm::float8 FROM songs WHERE id=?", Double.class, song);
		db.update("UPDATE songs SET bpm=bpm+10 WHERE id=?", song);
		try {
			var timing = body(send(get("/api/v1/recordings/" + id), user)).path("timing");
			assertThat(timing.path("songId").asLong()).isEqualTo(song);
			assertThat(timing.path("chartVersionId").asLong()).isEqualTo(version);
			assertThat(timing.path("bpm").asDouble()).isEqualTo(((Number) chart.get("bpm")).doubleValue());
			assertThat(timing.path("offsetMs").asInt()).isEqualTo(((Number) chart.get("offset")).intValue());
			assertThat(timing.has("timeSignature")).isTrue();
			assertThat(timing.has("tempoMap") && timing.has("timeSignatureMap") && timing.has("ppq")).isTrue();
			// 목록에는 timing이 없다.
			assertThat(body(send(get("/api/v1/recordings"), user)).path("items").get(0).has("timing")).isFalse();
		} finally {
			db.update("UPDATE songs SET bpm=? WHERE id=?", songBpm, song);
		}
	}

	@Test
	void 제목_변경은_저장과_같은_규칙이고_updatedAt이_바뀐다() throws Exception {
		long id = saved(user, "원래 제목");
		db.update("UPDATE recordings SET updated_at=now()-interval '1 hour' WHERE id=?", id);
		Instant before = db.queryForObject("SELECT updated_at FROM recordings WHERE id=?", java.sql.Timestamp.class, id).toInstant();

		var r = send(patch("/api/v1/recordings/" + id).contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"  바뀐 제목 \"}"), user);
		assertThat(r.getResponse().getStatus()).as(text(r)).isEqualTo(200);
		assertThat(body(r).path("title").asString()).isEqualTo("바뀐 제목");
		assertThat(body(r).has("hits")).isFalse();
		assertThat(Instant.parse(body(r).path("updatedAt").asString())).isAfter(before);
		assertThat(body(send(get("/api/v1/recordings/" + id), user)).path("title").asString()).isEqualTo("바뀐 제목");

		String drum = "🥁";
		assertThat(send(patch("/api/v1/recordings/" + id).contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"" + drum.repeat(100) + "\"}"), user)
				.getResponse().getStatus()).isEqualTo(200);
		for (String bad : new String[] {"{}", "{\"title\":\"\"}", "{\"title\":\"   \"}", "{\"title\":1}", "{\"title\":null}",
				"{\"title\":\"x\",\"mode\":\"FREE\"}", "{\"title\":\"" + "가".repeat(101) + "\"}", "{\"title\":\"" + drum.repeat(101) + "\"}",
				"[]", "\"제목\"", "{\"title\":\"a\"}{}", "{\"title\":\"a\",\"title\":\"b\"}", "{\"title\":\"a\\u0000b\"}", "",
				"{\"title\":\"" + "a".repeat(4100) + "\"}"})
			problem(send(patch("/api/v1/recordings/" + id).contentType(MediaType.APPLICATION_JSON).content(bad), user), 400, "RECORDING_INVALID");
		assertThat(db.queryForObject("SELECT title FROM recordings WHERE id=?", String.class, id)).isEqualTo(drum.repeat(100));
	}

	@Test
	void 남의_녹음과_지운_녹음은_수정_삭제도_404() throws Exception {
		long mine = saved(user, "내 녹음");
		problem(send(patch("/api/v1/recordings/" + mine).contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"남\"}"), other), 404, "RECORDING_NOT_FOUND");
		problem(send(delete("/api/v1/recordings/" + mine), other), 404, "RECORDING_NOT_FOUND");
		problem(send(delete("/api/v1/recordings/999999999"), user), 404, "RECORDING_NOT_FOUND");
		assertThat(db.queryForObject("SELECT title FROM recordings WHERE id=? AND deleted_at IS NULL", String.class, mine)).isEqualTo("내 녹음");
		assertThat(mvc.perform(delete("/api/v1/recordings/" + mine)).andReturn().getResponse().getStatus()).isEqualTo(401);
	}

	@Test
	void 삭제하면_어디서도_안_보이고_플레이_연결이_풀려_같은_키와_플레이로_다시_저장된다() throws Exception {
		UUID play = UUID.randomUUID(), key = UUID.randomUUID();
		db.update("INSERT INTO play_sessions(id,user_id,mode,input_source,payload_schema_version,payload_hash,started_at,ended_at) VALUES(?,?,'FREE','STICK',1,?,now(),now())",
				play, user, HASH);
		String linked = free(key).replace("\"playId\":null", "\"playId\":\"" + play + "\"");
		var first = send(post("/api/v1/recordings").contentType(MediaType.APPLICATION_JSON).content(linked.getBytes(StandardCharsets.UTF_8)), user);
		assertThat(first.getResponse().getStatus()).as(text(first)).isEqualTo(201);
		long id = body(first).path("id").asLong();

		var deleted = send(delete("/api/v1/recordings/" + id), user);
		assertThat(deleted.getResponse().getStatus()).as(text(deleted)).isEqualTo(204);
		assertThat(db.queryForObject("SELECT deleted_at IS NOT NULL AND play_session_id IS NULL FROM recordings WHERE id=?", Boolean.class, id)).isTrue();
		assertThat(body(send(get("/api/v1/recordings"), user)).path("items").size()).isZero();
		problem(send(get("/api/v1/recordings/" + id), user), 404, "RECORDING_NOT_FOUND");
		problem(send(patch("/api/v1/recordings/" + id).contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"x\"}"), user), 404, "RECORDING_NOT_FOUND");
		problem(send(delete("/api/v1/recordings/" + id), user), 404, "RECORDING_NOT_FOUND");

		// 256 검증 D6: 지운 녹음이 플레이를 붙들지 않아 같은 키·같은 플레이로 새 녹음이 된다.
		var again = send(post("/api/v1/recordings").contentType(MediaType.APPLICATION_JSON).content(linked.getBytes(StandardCharsets.UTF_8)), user);
		assertThat(again.getResponse().getStatus()).as(text(again)).isEqualTo(201);
		assertThat(body(again).path("id").asLong()).isNotEqualTo(id);
		assertThat(body(again).path("playId").asString()).isEqualTo(play.toString());
	}

	@Test
	void 상한은_살아있는_녹음만_세서_하나_지우면_다시_저장된다() throws Exception {
		db.update("INSERT INTO recordings(user_id,title,client_key,mode,input_source,schema_version,started_at,duration_ms,hit_count,hits,payload_hash) "
				+ "SELECT ?,'채우기',gen_random_uuid(),'FREE','KEYBOARD',1,now(),1,1,'[{\"tMs\":0,\"pad\":\"SNARE\",\"velocity\":1}]',? FROM generate_series(1,200)", user, HASH);
		String body = free(UUID.randomUUID());
		problem(send(post("/api/v1/recordings").contentType(MediaType.APPLICATION_JSON).content(body.getBytes(StandardCharsets.UTF_8)), user), 413, "RECORDING_QUOTA_EXCEEDED");
		long any = db.queryForObject("SELECT min(id) FROM recordings WHERE user_id=?", Long.class, user);
		assertThat(send(delete("/api/v1/recordings/" + any), user).getResponse().getStatus()).isEqualTo(204);
		assertThat(send(post("/api/v1/recordings").contentType(MediaType.APPLICATION_JSON).content(body.getBytes(StandardCharsets.UTF_8)), user)
				.getResponse().getStatus()).isEqualTo(201);
	}

	/** v0.7 FE 회신: sort는 startedAt 기준 NEWEST(기본)·OLDEST, mode는 한 모드만. 잘못된 값은 400. */
	@Test
	void 정렬은_녹음_시작_시각_기준이고_모드로_거른다() throws Exception {
		long nov1 = savedWith(user, "첫날 자유", "FREE", "2026-11-01T01:00:00Z");
		long nov3 = savedWith(user, "셋째날 리듬", "RHYTHM", "2026-11-03T01:00:00Z");
		long nov2 = savedWith(user, "둘째날 자유", "FREE", "2026-11-02T01:00:00Z");

		assertThat(ids(body(send(get("/api/v1/recordings"), user)))).containsExactly(nov3, nov2, nov1);
		assertThat(ids(body(send(get("/api/v1/recordings").param("sort", "NEWEST"), user)))).containsExactly(nov3, nov2, nov1);
		assertThat(ids(body(send(get("/api/v1/recordings").param("sort", "OLDEST"), user)))).containsExactly(nov1, nov2, nov3);

		var free = body(send(get("/api/v1/recordings").param("mode", "FREE"), user));
		assertThat(ids(free)).containsExactly(nov2, nov1);
		assertThat(free.path("totalElements").asLong()).isEqualTo(2);
		assertThat(ids(body(send(get("/api/v1/recordings").param("mode", "RHYTHM"), user)))).containsExactly(nov3);
		assertThat(ids(body(send(get("/api/v1/recordings").param("mode", "SHEET"), user)))).isEmpty();
		assertThat(ids(body(send(get("/api/v1/recordings").param("mode", "FREE").param("sort", "OLDEST").param("q", "둘째"), user)))).containsExactly(nov2);

		for (String[] bad : new String[][] {{"sort", "LATEST"}, {"sort", "newest"}, {"mode", "LIVE"}, {"mode", "free"}, {"mode", ""}})
			assertThat(send(get("/api/v1/recordings").param(bad[0], bad[1]), user).getResponse().getStatus()).as(bad[0] + "=" + bad[1]).isEqualTo(400);
	}

	private long savedWith(long owner, String title, String mode, String startedAt) throws Exception {
		String body = free(UUID.randomUUID()).replace("  즉흥 연주 1 ", title).replace("\"mode\":\"FREE\"", "\"mode\":\"" + mode + "\"")
				.replace("2026-11-03T01:00:00Z", startedAt);
		var r = send(post("/api/v1/recordings").contentType(MediaType.APPLICATION_JSON).content(body.getBytes(StandardCharsets.UTF_8)), owner);
		assertThat(r.getResponse().getStatus()).as(text(r)).isEqualTo(201);
		return body(r).path("id").asLong();
	}

	private static java.util.List<Long> ids(JsonNode page) {
		var ids = new java.util.ArrayList<Long>();
		for (var item : page.path("items")) ids.add(item.path("id").asLong());
		return ids;
	}

	/** v0.7 FE 회신: 요약의 song, 플레이가 지워져도 song·timing 유지, 곡 이름 변경·삭제 뒤 제목. */
	@Test
	void 리듬_녹음의_song은_곡_난이도이고_플레이가_지워져도_남는다() throws Exception {
		var chart = db.queryForMap("SELECT v.id AS version, c.song_id AS song, c.difficulty AS difficulty, s.title AS title "
				+ "FROM chart_versions v JOIN charts c ON c.id=v.chart_id JOIN songs s ON s.id=c.song_id WHERE s.owner_id IS NULL ORDER BY v.id LIMIT 1");
		long version = ((Number) chart.get("version")).longValue(), song = ((Number) chart.get("song")).longValue();
		String title = (String) chart.get("title"), difficulty = (String) chart.get("difficulty");
		UUID play = UUID.randomUUID();
		db.update("INSERT INTO play_sessions(id,user_id,song_id,chart_version_id,mode,input_source,judgement_context,payload_schema_version,payload_hash,started_at,ended_at) "
				+ "VALUES(?,?,?,?,'RHYTHM','KEYBOARD','{}',1,?,now(),now())", play, user, song, version, HASH);
		String body = free(UUID.randomUUID()).replace("\"playId\":null", "\"playId\":\"" + play + "\"").replace("\"mode\":\"FREE\"", "\"mode\":\"RHYTHM\"");
		var created = send(post("/api/v1/recordings").contentType(MediaType.APPLICATION_JSON).content(body.getBytes(StandardCharsets.UTF_8)), user);
		assertThat(created.getResponse().getStatus()).as(text(created)).isEqualTo(201);
		var saved = body(created).path("song");
		assertThat(saved.path("songId").asLong()).isEqualTo(song);
		assertThat(saved.path("title").asString()).isEqualTo(title);
		assertThat(saved.path("difficulty").asString()).isEqualTo(difficulty);
		long id = body(created).path("id").asLong();
		assertThat(db.queryForObject("SELECT chart_version_id FROM recordings WHERE id=?", Long.class, id)).isEqualTo(version);
		assertThat(body(send(get("/api/v1/recordings"), user)).path("items").get(0).path("song").path("songId").asLong()).isEqualTo(song);

		long free = saved(user, "자유 녹음");
		var freeItem = body(send(get("/api/v1/recordings/" + free), user));
		assertThat(freeItem.has("song") && freeItem.path("song").isNull()).isTrue();

		// 플레이가 지워져도 녹음이 기억한 채보 버전에서 song·timing이 나온다.
		db.update("DELETE FROM play_sessions WHERE id=?", play);
		var detail = body(send(get("/api/v1/recordings/" + id), user));
		assertThat(detail.path("playId").isNull()).isTrue();
		assertThat(detail.path("song").path("songId").asLong()).isEqualTo(song);
		assertThat(detail.path("timing").path("chartVersionId").asLong()).isEqualTo(version);

		// 곡 이름을 바꾸면 새 이름, 곡을 지워도(소프트 삭제) 제목은 보인다.
		try {
			db.update("UPDATE songs SET title='바뀐 곡 이름', deleted_at=now() WHERE id=?", song);
			var renamed = body(send(get("/api/v1/recordings/" + id), user)).path("song");
			assertThat(renamed.path("title").asString()).isEqualTo("바뀐 곡 이름");
			assertThat(renamed.path("difficulty").asString()).isEqualTo(difficulty);
		} finally {
			db.update("UPDATE songs SET title=?, deleted_at=NULL WHERE id=?", title, song);
		}
	}

	/** 검증 D7: 아주 작은 tMs로 저장한 녹음도 상세가 500이 되지 않는다. */
	@Test
	void 아주_작은_tMs도_상세에서_그대로_읽힌다() throws Exception {
		String body = free(UUID.randomUUID()).replace("\"tMs\":250.5", "\"tMs\":1e-70");
		var created = send(post("/api/v1/recordings").contentType(MediaType.APPLICATION_JSON).content(body.getBytes(StandardCharsets.UTF_8)), user);
		assertThat(created.getResponse().getStatus()).as(text(created)).isEqualTo(201);
		var r = send(get("/api/v1/recordings/" + body(created).path("id").asLong()), user);
		assertThat(r.getResponse().getStatus()).as(text(r)).isEqualTo(200);
		assertThat(body(r).path("hits").get(1).path("tMs").asDouble()).isEqualTo(1e-70);
	}

	/** 검증 D8: 짝 없는 서로게이트 제목은 ?로 저장되지 않고 400이다. */
	@Test
	void 제목_변경에_짝_없는_서로게이트는_400() throws Exception {
		long id = saved(user, "원래 제목");
		problem(send(patch("/api/v1/recordings/" + id).contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"\\ud83e\"}"), user), 400, "RECORDING_INVALID");
		assertThat(db.queryForObject("SELECT title FROM recordings WHERE id=?", String.class, id)).isEqualTo("원래 제목");
	}

	private long saved(long owner, String title) throws Exception {
		String body = free(UUID.randomUUID()).replace("  즉흥 연주 1 ", title);
		var r = send(post("/api/v1/recordings").contentType(MediaType.APPLICATION_JSON).content(body.getBytes(StandardCharsets.UTF_8)), owner);
		assertThat(r.getResponse().getStatus()).as(text(r)).isEqualTo(201);
		return body(r).path("id").asLong();
	}

	MvcResult send(MockHttpServletRequestBuilder request, long as) throws Exception {
		request.header(HttpHeaders.AUTHORIZATION, "Bearer " + tokens.issue(new AuthUser(as, UserRole.USER), Instant.now()).token());
		return mvc.perform(request).andReturn();
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
}
