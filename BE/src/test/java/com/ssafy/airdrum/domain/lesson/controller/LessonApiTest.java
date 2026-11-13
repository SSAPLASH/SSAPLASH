package com.ssafy.airdrum.domain.lesson.controller;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.ssafy.airdrum.domain.lesson.event.LessonWithdrawalListener;
import com.ssafy.airdrum.domain.auth.service.token.AccessTokenService;
import com.ssafy.airdrum.support.SignupConsentFixtures;
import com.ssafy.airdrum.domain.user.model.AuthUser;
import com.ssafy.airdrum.domain.user.model.UserRole;
import com.ssafy.airdrum.domain.user.event.UserWithdrawnEvent;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/** 331번 설계 3-3·3-4·4-2절: 입문 코스 레슨 목록·진도와 알아보기 완료 저장. */
@SpringBootTest(properties = {"auth.jwt.secret=test-only-jwt-secret-0123456789ab", "spring.datasource.hikari.schema=public"})
@AutoConfigureMockMvc
class LessonApiTest {

	static final String NOTES = "[{\"noteId\":\"n0001\",\"timeMs\":0,\"pad\":\"KICK\"},{\"noteId\":\"n0002\",\"timeMs\":857,\"pad\":\"KICK\"}]";
	static final String TIMING = "{\"bpm\":70,\"offsetMs\":0,\"timeSignature\":\"4/4\"}";

	@Autowired MockMvc mvc;
	@Autowired JdbcTemplate db;
	@Autowired JsonMapper json;
	@Autowired AccessTokenService tokens;
	@Autowired LessonWithdrawalListener withdrawal;

	final List<Long> songs = new ArrayList<>();
	long user, other, read, play1, play2, plain;
	String token, otherToken;

	@BeforeEach
	void setup() {
		user = db.queryForObject("INSERT INTO users(nickname) VALUES ('레슨 본인') RETURNING id", Long.class);
		SignupConsentFixtures.complete(db, user);
		other = db.queryForObject("INSERT INTO users(nickname) VALUES ('레슨 타인') RETURNING id", Long.class);
		SignupConsentFixtures.complete(db, other);
		token = token(user);
		otherToken = token(other);
		read = song("레슨검사 킥 음표");
		play1 = song("레슨검사 킥 4분");
		play2 = song("레슨검사 8비트");
		plain = song("레슨검사 일반 곡");
		lesson(read, 1, "READ", "킥 음표를 읽어요", "[\"KICK\"]", true);
		lesson(play1, 2, "PLAY", "킥을 박자에 맞춰요", "[\"KICK\"]", true);
		lesson(play2, 3, "PLAY", "8비트", "[\"HIHAT\",\"KICK\",\"SNARE\"]", true);
	}

	@AfterEach
	void cleanup() {
		db.update("DELETE FROM play_sessions WHERE user_id IN (?,?)", user, other);
		for (long song : songs) {
			db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT id FROM charts WHERE song_id=?)", song);
			db.update("DELETE FROM charts WHERE song_id=?", song);
			db.update("DELETE FROM songs WHERE id=?", song);
		}
		db.update("DELETE FROM users WHERE id IN (?,?)", user, other);
	}

	String token(long id) {
		return tokens.issue(new AuthUser(id, UserRole.USER), Instant.now()).token();
	}

	/** 공개 공용 곡과 HARD·NORMAL 채보(노트 2개). */
	long song(String title) {
		long id = db.queryForObject("INSERT INTO songs(title,source,status,license,bpm,duration_ms) VALUES(?,'BUILTIN','READY','자작',70,4000) RETURNING id",
				Long.class, title);
		songs.add(id);
		for (String difficulty : List.of("HARD", "NORMAL")) {
			long chart = db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,?) RETURNING id", Long.class, id, difficulty);
			db.update("INSERT INTO chart_versions(chart_id,version,notes,timing,notation_status,note_count,generator) VALUES(?,1,?::jsonb,?::jsonb,'UNAVAILABLE',2,'MANUAL')",
					chart, NOTES, TIMING);
		}
		return id;
	}

	void lesson(long song, int position, String kind, String summary, String pads, boolean guide) {
		db.update("INSERT INTO lessons(song_id,position,kind,summary,pads,guide) VALUES(?,?,?,?,?::jsonb,?)", song, position, kind, summary, pads, guide);
	}

	void lesson(long song, String course, int position, String kind, String summary, String pads) {
		db.update("INSERT INTO lessons(song_id,course,position,kind,summary,pads) VALUES(?,?,?,?,?,?::jsonb)", song, course, position, kind, summary, pads);
	}

	long chart(long song, String difficulty) {
		return db.queryForObject("SELECT id FROM charts WHERE song_id=? AND difficulty=?", Long.class, song, difficulty);
	}

	long version(long song) {
		return db.queryForObject("SELECT v.id FROM charts c JOIN chart_versions v ON v.chart_id=c.id WHERE c.song_id=? AND c.difficulty='NORMAL'", Long.class, song);
	}

	void play(long userId, long song, String mode, String accuracy, String endReason) {
		db.update("""
				INSERT INTO play_sessions(id,user_id,song_id,chart_version_id,mode,input_source,score,accuracy,max_combo,judgement_context,payload_schema_version,
				  payload_hash,started_at,ended_at,client_meta)
				VALUES(?,?,?,?,?,'KEYBOARD',100,?,1,'{}'::jsonb,1,?,?,?,jsonb_build_object('endReason',?::text))
				""", UUID.randomUUID(), userId, song, version(song), mode, new BigDecimal(accuracy), "a".repeat(64),
				Timestamp.from(Instant.now().minusSeconds(60)), Timestamp.from(Instant.now()), endReason);
	}

	MvcResult send(MockHttpServletRequestBuilder request, String auth) throws Exception {
		if (auth != null) request.header("Authorization", "Bearer " + auth);
		return mvc.perform(request).andReturn();
	}

	JsonNode lessons(String auth) throws Exception {
		var r = send(get("/api/v1/lessons"), auth);
		assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(200);
		assertThat(r.getResponse().getHeader("Cache-Control")).isEqualTo("private, no-store");
		return json.readTree(r.getResponse().getContentAsString());
	}

	/** 이 테스트가 넣은 레슨만(다른 테스트·시드가 남긴 행은 보지 않는다). */
	List<JsonNode> mine(JsonNode body) {
		var items = new ArrayList<JsonNode>();
		body.path("items").forEach(i -> {
			if (songs.contains(i.path("songId").asLong())) items.add(i);
		});
		return items;
	}

	int complete(long song, String auth) throws Exception {
		return send(post("/api/v1/lessons/" + song + "/completion"), auth).getResponse().getStatus();
	}

	@Test
	void 로그인하지_않았거나_탈퇴했으면_401이다() throws Exception {
		assertThat(send(get("/api/v1/lessons"), null).getResponse().getStatus()).isEqualTo(401);
		assertThat(complete(read, null)).isEqualTo(401);
		db.update("UPDATE users SET status='WITHDRAWN',withdrawn_at=now() WHERE id=?", user);
		assertThat(send(get("/api/v1/lessons"), token).getResponse().getStatus()).isEqualTo(401);
		assertThat(complete(read, token)).isEqualTo(401);
	}

	@Test
	void 처음에는_순서대로_주고_1번만_열려_있다() throws Exception {
		var body = lessons(token);
		assertThat(body.path("passAccuracy").asInt()).isEqualTo(70);
		var items = mine(body);
		assertThat(items).extracting(i -> i.path("order").asInt()).containsExactly(1, 2, 3);
		var first = items.get(0);
		assertThat(first.path("kind").asString()).isEqualTo("READ");
		assertThat(first.path("songId").asLong()).isEqualTo(read);
		assertThat(first.path("chartId").asLong()).isEqualTo(chart(read, "NORMAL"));
		assertThat(first.path("title").asString()).isEqualTo("레슨검사 킥 음표");
		assertThat(first.path("summary").asString()).isEqualTo("킥 음표를 읽어요");
		assertThat(first.path("pads").valueStream().map(JsonNode::asString).toList()).containsExactly("KICK");
		assertThat(first.path("guide").asBoolean()).isTrue();
		assertThat(first.path("bpm").decimalValue()).isEqualByComparingTo("70");
		assertThat(first.path("durationMs").asInt()).isEqualTo(4000);
		assertThat(first.path("noteCount").asInt()).isEqualTo(2);
		assertThat(first.path("bestAccuracy").isNull()).isTrue();
		assertThat(items).extracting(i -> i.path("passed").asBoolean()).containsExactly(false, false, false);
		assertThat(items).extracting(i -> i.path("locked").asBoolean()).containsExactly(false, true, true);
		assertThat(items.get(2).path("pads").valueStream().map(JsonNode::asString).toList()).containsExactly("HIHAT", "KICK", "SNARE");
	}

	/** 학습 코스 설계 3-3절: 항목마다 코스가 있고, 입문 → 중급 순서이며 순서 번호는 코스 안에서 1부터다. */
	@Test
	void 항목마다_코스가_있고_입문_뒤에_중급이_코스_안_순서로_온다() throws Exception {
		long crash = song("레슨검사 중급 크래시");
		long ride = song("레슨검사 중급 라이드");
		lesson(ride, "INTERMEDIATE", 2, "PLAY", "라이드 8비트", "[\"RIDE\",\"SNARE\",\"KICK\"]");
		lesson(crash, "INTERMEDIATE", 1, "READ", "크래시 음표", "[\"CRASH\"]");
		var items = mine(lessons(token));
		assertThat(items).extracting(i -> i.path("songId").asLong()).containsExactly(read, play1, play2, crash, ride);
		assertThat(items).extracting(i -> i.path("course").asString()).containsExactly("BEGINNER", "BEGINNER", "BEGINNER", "INTERMEDIATE", "INTERMEDIATE");
		assertThat(items).extracting(i -> i.path("order").asInt()).containsExactly(1, 2, 3, 1, 2);
	}

	/** 학습 코스 설계 1절: 중급은 입문을 다 통과해야 열린다(목록이 한 줄이라 잠금 계산은 그대로). */
	@Test
	void 입문을_다_통과해야_중급_1번이_열린다() throws Exception {
		long crash = song("레슨검사 중급 크래시");
		long ride = song("레슨검사 중급 라이드");
		lesson(crash, "INTERMEDIATE", 1, "READ", "크래시 음표", "[\"CRASH\"]");
		lesson(ride, "INTERMEDIATE", 2, "PLAY", "라이드 8비트", "[\"RIDE\",\"SNARE\",\"KICK\"]");
		complete(read, token);
		play(user, play1, "SHEET", "80.00", "COMPLETED");
		var before = mine(lessons(token));
		assertThat(before).extracting(i -> i.path("locked").asBoolean()).containsExactly(false, false, false, true, true);

		play(user, play2, "SHEET", "75.00", "COMPLETED");
		var after = mine(lessons(token));
		assertThat(after).extracting(i -> i.path("passed").asBoolean()).containsExactly(true, true, true, false, false);
		assertThat(after).extracting(i -> i.path("locked").asBoolean()).containsExactly(false, false, false, false, true);
		// 중급 알아보기도 완료를 저장할 수 있다
		assertThat(complete(crash, token)).isEqualTo(204);
		assertThat(mine(lessons(token)).get(4).path("locked").asBoolean()).isFalse();
	}

	@Test
	void 알아보기_레슨은_완료를_저장하면_통과고_다시_보내도_처음_시각을_유지한다() throws Exception {
		assertThat(complete(read, token)).isEqualTo(204);
		var first = db.queryForObject("SELECT completed_at FROM lesson_completions WHERE user_id=? AND song_id=?", Timestamp.class, user, read);
		assertThat(complete(read, token)).isEqualTo(204);
		assertThat(db.queryForObject("SELECT completed_at FROM lesson_completions WHERE user_id=? AND song_id=?", Timestamp.class, user, read)).isEqualTo(first);
		assertThat(db.queryForObject("SELECT count(*) FROM lesson_completions WHERE user_id=?", Integer.class, user)).isEqualTo(1);

		var items = mine(lessons(token));
		assertThat(items).extracting(i -> i.path("passed").asBoolean()).containsExactly(true, false, false);
		assertThat(items).extracting(i -> i.path("locked").asBoolean()).containsExactly(false, false, true);
		assertThat(items.get(0).path("bestAccuracy").isNull()).isTrue();
		// 남의 완료는 내 진도가 아니다
		assertThat(mine(lessons(otherToken))).extracting(i -> i.path("passed").asBoolean()).containsExactly(false, false, false);
	}

	@Test
	void 연주_레슨은_악보_연습을_70퍼센트_이상으로_끝낸_기록만_통과다() throws Exception {
		complete(read, token);
		play(user, play1, "SHEET", "69.99", "COMPLETED");
		play(user, play1, "RHYTHM", "95.00", "COMPLETED");
		play(user, play1, "SHEET", "92.00", "QUIT");
		play(other, play1, "SHEET", "95.00", "COMPLETED");
		var before = mine(lessons(token));
		assertThat(before.get(1).path("passed").asBoolean()).isFalse();
		assertThat(before.get(1).path("bestAccuracy").decimalValue()).isEqualByComparingTo("69.99");
		assertThat(before.get(2).path("locked").asBoolean()).isTrue();

		play(user, play1, "SHEET", "70.00", "COMPLETED");
		var after = mine(lessons(token));
		assertThat(after.get(1).path("passed").asBoolean()).isTrue();
		assertThat(after.get(1).path("bestAccuracy").decimalValue()).isEqualByComparingTo("70.00");
		assertThat(after.get(2).path("locked").asBoolean()).isFalse();
	}

	@Test
	void 앞_레슨을_통과하지_못하면_뒤_레슨을_통과해도_그다음은_잠겨_있다() throws Exception {
		// 잠금은 화면 안내라 서버는 주소로 친 기록을 막지 않는다. 대신 앞 레슨이 통과 전이면 뒤는 계속 잠김이다
		play(user, play1, "SHEET", "90.00", "COMPLETED");
		var items = mine(lessons(token));
		assertThat(items).extracting(i -> i.path("passed").asBoolean()).containsExactly(false, true, false);
		assertThat(items).extracting(i -> i.path("locked").asBoolean()).containsExactly(false, true, true);
	}

	@Test
	void 완료_저장은_알아보기_레슨에만_된다() throws Exception {
		var r = send(post("/api/v1/lessons/" + play1 + "/completion"), token);
		assertThat(r.getResponse().getStatus()).isEqualTo(400);
		assertThat(json.readTree(r.getResponse().getContentAsString()).path("code").asString()).isEqualTo("VALIDATION_FAILED");
		var notLesson = send(post("/api/v1/lessons/" + plain + "/completion"), token);
		assertThat(notLesson.getResponse().getStatus()).isEqualTo(404);
		assertThat(json.readTree(notLesson.getResponse().getContentAsString()).path("code").asString()).isEqualTo("SONG_NOT_FOUND");
		assertThat(complete(Long.MAX_VALUE, token)).isEqualTo(404);
		db.update("UPDATE songs SET published=false WHERE id=?", read);
		assertThat(complete(read, token)).isEqualTo(404);
		assertThat(db.queryForObject("SELECT count(*) FROM lesson_completions WHERE user_id=?", Integer.class, user)).isZero();
	}

	@Test
	void 삭제되거나_비공개인_곡의_레슨은_목록에서_빠진다() throws Exception {
		db.update("UPDATE songs SET deleted_at=now() WHERE id=?", play1);
		db.update("UPDATE songs SET published=false WHERE id=?", play2);
		assertThat(mine(lessons(token))).extracting(i -> i.path("songId").asLong()).containsExactly(read);
	}

	@Test
	void 레슨_곡은_곡_목록에_나오지_않지만_곡_상세와_채보는_열린다() throws Exception {
		var r = send(get("/api/v1/songs").param("source", "BUILTIN").param("size", "100").param("q", "레슨검사"), token);
		assertThat(r.getResponse().getStatus()).isEqualTo(200);
		var ids = new ArrayList<Long>();
		json.readTree(r.getResponse().getContentAsString()).path("items").forEach(i -> ids.add(i.path("id").asLong()));
		assertThat(ids).contains(plain).doesNotContain(read, play1, play2);
		assertThat(send(get("/api/v1/songs/" + play1), token).getResponse().getStatus()).isEqualTo(200);
		assertThat(send(get("/api/v1/charts/" + chart(play1, "NORMAL")), token).getResponse().getStatus()).isEqualTo(200);
	}

	@Test
	void 탈퇴하면_알아보기_완료_기록을_지운다() throws Exception {
		complete(read, token);
		complete(read, otherToken);
		withdrawal.withdrawn(new UserWithdrawnEvent(user));
		assertThat(db.queryForObject("SELECT count(*) FROM lesson_completions WHERE user_id=?", Integer.class, user)).isZero();
		assertThat(db.queryForObject("SELECT count(*) FROM lesson_completions WHERE user_id=?", Integer.class, other)).isEqualTo(1);
	}
}
