package com.ssafy.airdrum.song.admin;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;

import javax.sound.midi.MidiEvent;
import javax.sound.midi.MidiSystem;
import javax.sound.midi.Sequence;
import javax.sound.midi.ShortMessage;

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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.AbstractMockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.auth.AccessTokenService;
import com.ssafy.airdrum.support.SignupConsentFixtures;
import com.ssafy.airdrum.user.AuthUser;
import com.ssafy.airdrum.user.UserRole;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;

/** 156번 설계 6절 인수 조건. 실제 JWT·임베디드 PG·MVC로 관리자 등록 → 일반 조회 왕복을 검사한다. */
@SpringBootTest
@AutoConfigureMockMvc
class AdminSongApiTest {

	static final String BASE = "/api/v1/admin/songs";
	static final String TITLE = "관리 테스트 곡";

	@Autowired MockMvc mvc;
	@Autowired JdbcTemplate db;
	@Autowired AccessTokenService tokens;
	final JsonMapper json = new JsonMapper();
	long admin, user;

	@BeforeEach
	void seed() {
		admin = db.queryForObject("INSERT INTO users(nickname,role) VALUES('곡 관리자','ADMIN') RETURNING id", Long.class);
		user = db.queryForObject("INSERT INTO users(nickname) VALUES('일반 회원') RETURNING id", Long.class);
		SignupConsentFixtures.complete(db, user);
	}

	@AfterEach
	void cleanup() {
		String songs = "SELECT id FROM songs WHERE (owner_id IS NULL AND title LIKE '관리 테스트%') OR owner_id=" + user;
		db.update("UPDATE songs SET song_level=NULL,level_chart_version_id=NULL,level_rule_version=NULL,level_duration_ms=NULL WHERE id IN (" + songs + ")");
		db.update("DELETE FROM file_cleanup_tasks WHERE object_key LIKE 'cover/builtin/%' OR object_key LIKE 'accompaniment/%/%'");
		db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT id FROM charts WHERE song_id IN (" + songs + "))");
		db.update("DELETE FROM charts WHERE song_id IN (" + songs + ")");
		db.update("DELETE FROM songs WHERE id IN (" + songs + ")");
		db.update("DELETE FROM users WHERE id IN (?,?)", admin, user);
	}

	/** 120BPM 4/4 한 마디: 킥·스네어·하이햇 8분. extraKick이면 마지막 16분에 킥을 하나 더 넣는다. */
	static byte[] midi(boolean extraKick) throws Exception {
		var sequence = new Sequence(Sequence.PPQ, 480);
		var track = sequence.createTrack();
		var notes = new java.util.ArrayList<long[]>();
		notes.add(new long[] {0, 36});
		notes.add(new long[] {960, 38});
		for (int i = 0; i < 8; i++) notes.add(new long[] {i * 240L, 42});
		if (extraKick) notes.add(new long[] {1680, 36});
		for (var n : notes) {
			track.add(new MidiEvent(new ShortMessage(ShortMessage.NOTE_ON, 9, (int) n[1], 100), n[0]));
			track.add(new MidiEvent(new ShortMessage(ShortMessage.NOTE_OFF, 9, (int) n[1], 0), n[0] + 60));
		}
		var out = new ByteArrayOutputStream();
		MidiSystem.write(sequence, 0, out);
		return out.toByteArray();
	}

	MockMultipartHttpServletRequestBuilder register(byte[] bytes) {
		return multipart(BASE + "/midi").file(new MockMultipartFile("file", "song.mid", "audio/midi", bytes));
	}

	MvcResult send(AbstractMockHttpServletRequestBuilder<?> request, Long as) throws Exception {
		if (as != null) {
			var role = as == admin ? UserRole.ADMIN : UserRole.USER;
			request.header(HttpHeaders.AUTHORIZATION, "Bearer " + tokens.issue(new AuthUser(as, role), Instant.now()).token());
		}
		return mvc.perform(request).andReturn();
	}

	JsonNode body(MvcResult r) throws Exception {
		return json.readTree(r.getResponse().getContentAsString(StandardCharsets.UTF_8));
	}

	void status(MvcResult r, int expected) throws Exception {
		assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString(StandardCharsets.UTF_8)).isEqualTo(expected);
	}

	void problem(MvcResult r, int expected, String code) throws Exception {
		status(r, expected);
		assertThat(body(r).path("code").asString()).isEqualTo(code);
	}

	long registered(boolean published) throws Exception {
		var r = send(register(midi(false)).param("title", TITLE).param("license", "자작곡 CC0")
				.param("published", Boolean.toString(published)), admin);
		status(r, 201);
		return body(r).path("id").asLong();
	}

	MvcResult patchJson(long id, String value, Long as) throws Exception {
		return send(patch(BASE + "/" + id).contentType(MediaType.APPLICATION_JSON).content(value), as);
	}

	boolean listedForUser(long id) throws Exception {
		var r = send(get("/api/v1/songs").param("source", "BUILTIN").param("size", "100").param("q", "관리 테스트"), user);
		status(r, 200);
		return body(r).path("items").findValues("id").stream().anyMatch(v -> v.asLong() == id);
	}

	@Test
	void 관리자가_MIDI로_등록하면_공용_곡_목록에_3난이도로_노출된다() throws Exception {
		var r = send(register(midi(false)).param("title", "  " + TITLE + " ").param("artist", "  ").param("license", " 자작곡 CC0 "), admin);

		status(r, 201);
		var song = body(r);
		long id = song.path("id").asLong();
		assertThat(r.getResponse().getHeader(HttpHeaders.LOCATION)).isEqualTo(BASE + "/" + id);
		assertThat(r.getResponse().getHeader(HttpHeaders.CACHE_CONTROL)).isEqualTo("private, no-store");
		assertThat(song.path("title").asString()).isEqualTo(TITLE);
		assertThat(song.path("artist").isNull()).isTrue();
		assertThat(song.path("license").asString()).isEqualTo("자작곡 CC0");
		assertThat(song.path("published").asBoolean()).isTrue();
		assertThat(song.path("hasCover").asBoolean()).isFalse();
		assertThat(song.path("coverUrl").isNull()).isTrue();
		assertThat(song.path("difficulties").valueStream().map(JsonNode::asString).toList()).containsExactly("EASY", "NORMAL", "HARD");
		assertThat(song.path("charts")).hasSize(3).allSatisfy(c -> {
			assertThat(c.path("version").asInt()).isEqualTo(1);
			assertThat(c.path("generator").asString()).isEqualTo("MIDI_RULE");
			assertThat(c.path("generatorVersion").asString()).isEqualTo("midi-rule-1.1");
			assertThat(c.path("notationStatus").asString()).isEqualTo("PENDING");
		});
		var row = db.queryForMap("SELECT owner_id,source,status,published FROM songs WHERE id=?", id);
		assertThat(row.get("owner_id")).isNull();
		assertThat(row.get("source")).isEqualTo("BUILTIN");
		assertThat(row.get("status")).isEqualTo("READY");
		var levelRow=db.queryForMap("SELECT song_level,level_chart_version_id,level_duration_ms,duration_ms FROM songs WHERE id=?",id);
		assertThat(levelRow.get("song_level")).isNotNull();
		assertThat(levelRow.get("level_duration_ms")).isEqualTo(levelRow.get("duration_ms"));
		assertThat(levelRow.get("level_chart_version_id")).isEqualTo(db.queryForObject("SELECT v.id FROM charts c JOIN chart_versions v ON v.chart_id=c.id WHERE c.song_id=? AND c.difficulty='HARD' AND v.version=1",Long.class,id));

		assertThat(listedForUser(id)).isTrue();
		var detail = send(get("/api/v1/songs/" + id), user);
		status(detail, 200);
		// 260번: 이 MIDI는 NORMAL과 HARD의 노트가 같아(10개) 회원 응답에서는 HARD가 빠진다. ADMIN 응답(위)은 3난이도 그대로다.
		assertThat(body(detail).path("charts").valueStream().map(c -> c.path("difficulty").asString()).toList()).containsExactly("EASY", "NORMAL");
		long chartId = body(detail).path("charts").get(0).path("id").asLong();
		status(send(get("/api/v1/charts/" + chartId), user), 200);
		// 숨긴 HARD도 채보 id로는 그대로 조회된다(과거 플레이 기록에서 다시 열기).
		long hardId = song.path("charts").valueStream().filter(c -> "HARD".equals(c.path("difficulty").asString())).findFirst().orElseThrow().path("id").asLong();
		status(send(get("/api/v1/charts/" + hardId), user), 200);
	}

	@Test
	void 일반_회원은_403이고_미인증은_401이다() throws Exception {
		long id = registered(true);
		problem(send(register(midi(false)).param("title", TITLE).param("license", "x"), user), 403, "FORBIDDEN");
		problem(send(get(BASE), user), 403, "FORBIDDEN");
		problem(send(get(BASE + "/" + id), user), 403, "FORBIDDEN");
		problem(patchJson(id, "{\"published\":false}", user), 403, "FORBIDDEN");
		problem(send(delete(BASE + "/" + id), user), 403, "FORBIDDEN");
		status(send(get(BASE), null), 401);
		assertThat(db.queryForObject("SELECT published FROM songs WHERE id=?", Boolean.class, id)).isTrue();
	}

	@Test
	void 등록_입력이_틀리면_400이고_곡을_만들지_않는다() throws Exception {
		problem(send(register(midi(false)).param("title", TITLE), admin), 400, "SONG_INVALID");
		problem(send(register(midi(false)).param("title", TITLE).param("license", "   "), admin), 400, "SONG_INVALID");
		problem(send(register(midi(false)).param("title", TITLE).param("license", "x".repeat(201)), admin), 400, "SONG_INVALID");
		problem(send(register(midi(false)).param("title", TITLE).param("license", "x").param("published", "yes"), admin), 400, "SONG_INVALID");
		problem(send(register(midi(false)).param("title", TITLE).param("license", "x").param("extra", "1"), admin), 400, "SONG_INVALID");
		problem(send(register(midi(false)).param("license", "x"), admin), 400, "SONG_INVALID");
		problem(send(multipart(BASE + "/midi").param("title", TITLE).param("license", "x"), admin), 400, "MIDI_INVALID");
		problem(send(register(new byte[] {1, 2, 3}).param("title", TITLE).param("license", "x"), admin), 422, "MIDI_UNSUPPORTED");
		assertThat(db.queryForObject("SELECT count(*) FROM songs WHERE owner_id IS NULL AND title LIKE '관리 테스트%'", Integer.class)).isZero();
	}

	@Test
	void 비공개로_등록하거나_전환하면_일반_조회에서_빠지고_관리자에게는_보인다() throws Exception {
		long hidden = registered(false);
		long open = registered(true);
		assertThat(listedForUser(hidden)).isFalse();
		problem(send(get("/api/v1/songs/" + hidden), user), 404, "SONG_NOT_FOUND");

		var all = body(send(get(BASE).param("q", "관리 테스트"), admin));
		assertThat(all.path("items").findValues("id").stream().map(JsonNode::asLong).toList()).contains(hidden, open);
		var onlyHidden = body(send(get(BASE).param("q", "관리 테스트").param("published", "false"), admin));
		assertThat(onlyHidden.path("items").findValues("id").stream().map(JsonNode::asLong).toList()).contains(hidden).doesNotContain(open);
		assertThat(body(send(get(BASE + "/" + hidden), admin)).path("published").asBoolean()).isFalse();

		var opened = patchJson(hidden, "{\"published\":true}", admin);
		status(opened, 200);
		assertThat(body(opened).path("published").asBoolean()).isTrue();
		assertThat(listedForUser(hidden)).isTrue();

		status(patchJson(open, "{\"published\":false}", admin), 200);
		assertThat(listedForUser(open)).isFalse();
	}

	@Test
	void 정보_수정은_보낸_필드만_바꾸고_규칙_위반은_400이다() throws Exception {
		long id = registered(true);
		var r = patchJson(id, "{\"title\":\"  관리 테스트 새 제목 \",\"artist\":\"작곡가\",\"license\":\"퍼블릭 도메인\"}", admin);
		status(r, 200);
		assertThat(body(r).path("title").asString()).isEqualTo("관리 테스트 새 제목");
		assertThat(body(r).path("artist").asString()).isEqualTo("작곡가");
		assertThat(body(r).path("license").asString()).isEqualTo("퍼블릭 도메인");
		assertThat(body(r).path("published").asBoolean()).isTrue();

		status(patchJson(id, "{\"artist\":\" \"}", admin), 200);
		assertThat(db.queryForObject("SELECT artist FROM songs WHERE id=?", String.class, id)).isNull();

		for (var bad : List.of("{}", "null", "[]", "{\"title\":null}", "{\"title\":\" \"}", "{\"license\":\"\"}", "{\"license\":null}",
				"{\"published\":\"false\"}", "{\"published\":null}", "{\"bad\":1}", "{\"title\":\"a\",\"title\":\"b\"}", "{\"title\":\"a\"} {}"))
			problem(patchJson(id, bad, admin), 400, "SONG_INVALID");
		assertThat(db.queryForObject("SELECT title FROM songs WHERE id=?", String.class, id)).isEqualTo("관리 테스트 새 제목");
	}

	@Test
	void 개인_곡과_없는_곡과_삭제된_곡은_404다() throws Exception {
		long mine = db.queryForObject("INSERT INTO songs(owner_id,title,source,status) VALUES(?,'관리 테스트 개인','MIDI','READY') RETURNING id", Long.class, user);
		for (long id : new long[] {mine, Long.MAX_VALUE}) {
			problem(send(get(BASE + "/" + id), admin), 404, "SONG_NOT_FOUND");
			problem(patchJson(id, "{\"title\":\"x\"}", admin), 404, "SONG_NOT_FOUND");
			problem(send(multipart(BASE + "/" + id + "/charts/midi").file(new MockMultipartFile("file", "a.mid", "audio/midi", midi(false)))
					.with(r -> { r.setMethod("PUT"); return r; }), admin), 404, "SONG_NOT_FOUND");
			problem(send(delete(BASE + "/" + id), admin), 404, "SONG_NOT_FOUND");
		}
		assertThat(db.queryForObject("SELECT title FROM songs WHERE id=?", String.class, mine)).isEqualTo("관리 테스트 개인");

		long gone = registered(true);
		status(send(delete(BASE + "/" + gone), admin), 204);
		problem(send(get(BASE + "/" + gone), admin), 404, "SONG_NOT_FOUND");
		problem(send(delete(BASE + "/" + gone), admin), 404, "SONG_NOT_FOUND");
	}

	@Test
	void MIDI를_다시_올리면_난이도별_새_버전이_생기고_기존_버전은_남는다() throws Exception {
		long id = registered(true);
		var before = db.queryForList("SELECT v.id FROM chart_versions v JOIN charts c ON c.id=v.chart_id WHERE c.song_id=?", Long.class, id);
		db.update("UPDATE songs SET duration_ms=60000 WHERE id=?",id);

		var r = send(multipart(BASE + "/" + id + "/charts/midi").file(new MockMultipartFile("file", "fixed.mid", "audio/midi", midi(true)))
				.with(req -> { req.setMethod("PUT"); return req; }), admin);

		status(r, 200);
		assertThat(body(r).path("charts")).hasSize(3).allSatisfy(c -> assertThat(c.path("version").asInt()).isEqualTo(2));
		assertThat(db.queryForObject("SELECT count(*) FROM chart_versions v JOIN charts c ON c.id=v.chart_id WHERE c.song_id=?", Integer.class, id)).isEqualTo(6);
		assertThat(db.queryForObject("SELECT count(*) FROM charts WHERE song_id=?", Integer.class, id)).isEqualTo(3);
		var level = db.queryForMap("SELECT song_level,level_chart_version_id,level_duration_ms,duration_ms FROM songs WHERE id=?",id);
		assertThat(level.get("song_level")).isNotNull();
		assertThat(level.get("level_duration_ms")).isEqualTo(level.get("duration_ms")).isNotEqualTo(60000);
		assertThat(level.get("level_chart_version_id")).isEqualTo(db.queryForObject("SELECT v.id FROM charts c JOIN chart_versions v ON v.chart_id=c.id WHERE c.song_id=? AND c.difficulty='HARD' AND v.version=2",Long.class,id));

		long chartId = body(r).path("charts").get(2).path("id").asLong();
		var latest = send(get("/api/v1/charts/" + chartId), user);
		status(latest, 200);
		assertThat(body(latest).path("version").asInt()).isEqualTo(2);
		for (long old : before) status(send(get("/api/v1/chart-versions/" + old), user), 200);

		problem(send(multipart(BASE + "/" + id + "/charts/midi").file(new MockMultipartFile("file", "x.mid", "audio/midi", new byte[0]))
				.with(req -> { req.setMethod("PUT"); return req; }), admin), 400, "MIDI_INVALID");
		assertThat(db.queryForObject("SELECT count(*) FROM chart_versions v JOIN charts c ON c.id=v.chart_id WHERE c.song_id=?", Integer.class, id)).isEqualTo(6);
	}

	@Test
	void 빠진_난이도가_있는_공용_곡은_재업로드로_채워진다() throws Exception {
		long id = db.queryForObject("INSERT INTO songs(title,source,status,license,bpm,time_signature) VALUES('관리 테스트 시드형','BUILTIN','READY','x',90,'4/4') RETURNING id", Long.class);
		long chart = db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,'EASY') RETURNING id", Long.class, id);
		db.update("""
				INSERT INTO chart_versions(chart_id,version,notes,timing,notation_status,note_count,generator)
				VALUES(?,1,'[{"noteId":"n0001","timeMs":0,"pad":"KICK"}]'::jsonb,'{"bpm":90,"offsetMs":0,"timeSignature":"4/4"}'::jsonb,'UNAVAILABLE',1,'BUILTIN')
				""", chart);

		var r = send(multipart(BASE + "/" + id + "/charts/midi").file(new MockMultipartFile("file", "a.mid", "audio/midi", midi(false)))
				.with(req -> { req.setMethod("PUT"); return req; }), admin);

		status(r, 200);
		var versions = body(r).path("charts").valueStream().map(c -> c.path("difficulty").asString() + ":" + c.path("version").asInt()).toList();
		assertThat(versions).containsExactly("EASY:2", "NORMAL:1", "HARD:1");
		assertThat(db.queryForObject("SELECT bpm FROM songs WHERE id=?", java.math.BigDecimal.class, id)).isEqualByComparingTo("120");
	}
}
