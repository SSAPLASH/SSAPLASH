package com.ssafy.airdrum.recording;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

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

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.auth.AccessTokenService;
import com.ssafy.airdrum.support.SignupConsentFixtures;
import com.ssafy.airdrum.user.AuthUser;
import com.ssafy.airdrum.user.UserRole;

import static com.ssafy.airdrum.recording.RecordingFixtures.free;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/** 256번 설계 3·4·6절: 녹음 저장 API를 실제 PostgreSQL·인증 경로로 검사한다. */
@SpringBootTest
@AutoConfigureMockMvc
class RecordingApiTest {

	private static final String HASH = "b".repeat(64);

	@Autowired MockMvc mvc;
	@Autowired JdbcTemplate db;
	@Autowired AccessTokenService tokens;
	@Autowired javax.sql.DataSource dataSource;
	final JsonMapper json = new JsonMapper();
	long user, other;
	UUID key;

	@BeforeEach
	void seed() {
		user = db.queryForObject("INSERT INTO users(nickname) VALUES('녹음 회원') RETURNING id", Long.class);
		SignupConsentFixtures.complete(db, user);
		other = db.queryForObject("INSERT INTO users(nickname) VALUES('녹음 다른 회원') RETURNING id", Long.class);
		SignupConsentFixtures.complete(db, other);
		key = UUID.randomUUID();
	}

	@AfterEach
	void clean() {
		db.update("DELETE FROM recordings WHERE user_id IN (?,?)", user, other);
		db.update("DELETE FROM play_sessions WHERE user_id IN (?,?)", user, other);
		db.update("DELETE FROM users WHERE id IN (?,?)", user, other);
	}

	@Test
	void 최초_저장은_201이고_정렬_정규화된_시퀀스를_저장한다() throws Exception {
		String reversed = free(key).replace(
				"[{\"tMs\":0,\"pad\":\"SNARE\",\"velocity\":90,\"stickId\":1},{\"tMs\":250.5,\"pad\":\"HI_TOM\",\"velocity\":64,\"stickId\":0},{\"tMs\":1000,\"pad\":\"KICK\",\"velocity\":110}]",
				"[{\"tMs\":1000,\"pad\":\"KICK\",\"velocity\":110},{\"tMs\":250.5,\"pad\":\"HI_TOM\",\"velocity\":64,\"stickId\":0},{\"tMs\":0,\"pad\":\"SNARE\",\"velocity\":90,\"stickId\":1}]");
		var r = save(reversed, user);
		assertThat(r.getResponse().getStatus()).as(text(r)).isEqualTo(201);
		var body = body(r);
		long id = body.path("id").asLong();
		assertThat(r.getResponse().getHeader("Location")).isEqualTo("/api/v1/recordings/" + id);
		assertThat(r.getResponse().getHeader("Cache-Control")).isEqualTo("private, no-store");
		assertThat(body.path("clientKey").asString()).isEqualTo(key.toString());
		assertThat(body.path("title").asString()).isEqualTo("즉흥 연주 1");
		assertThat(body.path("mode").asString()).isEqualTo("FREE");
		assertThat(body.path("inputSource").asString()).isEqualTo("STICK");
		assertThat(body.path("playId").isNull()).isTrue();
		assertThat(body.path("hitCount").asInt()).isEqualTo(3);
		assertThat(body.path("durationMs").asInt()).isEqualTo(1500);
		assertThat(Instant.parse(body.path("startedAt").asString())).isEqualTo(Instant.parse("2026-11-03T01:00:00Z"));
		assertThat(body.has("hits")).isFalse();
		assertThat(body.has("createdAt") && body.has("updatedAt")).isTrue();

		var stored = db.queryForMap("SELECT user_id,hit_count,payload_hash,hits->0->>'pad' AS first,hits->1->>'pad' AS second,hits->2->>'tMs' AS last,"
				+ "jsonb_exists(hits->2,'stickId') AS kick_has_stick FROM recordings WHERE id=?", id);
		assertThat(stored).containsEntry("user_id", user).containsEntry("hit_count", 3).containsEntry("first", "SNARE")
				.containsEntry("second", "SMALL_TOM").containsEntry("last", "1000.0").containsEntry("kick_has_stick", false);
		assertThat((String) stored.get("payload_hash")).matches("[0-9a-f]{64}");
	}

	@Test
	void 같은_키_같은_내용은_200이고_다른_내용은_409() throws Exception {
		long id = body(save(free(key), user)).path("id").asLong();
		var replay = save(free(key).replace("\"pad\":\"HI_TOM\"", "\"pad\":\"SMALL_TOM\""), user);
		assertThat(replay.getResponse().getStatus()).as(text(replay)).isEqualTo(200);
		assertThat(body(replay).path("id").asLong()).isEqualTo(id);
		assertThat(replay.getResponse().getHeader("Location")).isNull();
		problem(save(free(key).replace("\"velocity\":90", "\"velocity\":91"), user), 409, "RECORDING_CONFLICT");
		assertThat(count(user)).isEqualTo(1);

		// 다른 회원은 같은 키로 따로 저장한다.
		assertThat(save(free(key), other).getResponse().getStatus()).isEqualTo(201);
		// 지운 녹음의 키로 다시 보내면 새 녹음이다.
		db.update("UPDATE recordings SET deleted_at=now() WHERE id=?", id);
		var again = save(free(key), user);
		assertThat(again.getResponse().getStatus()).isEqualTo(201);
		assertThat(body(again).path("id").asLong()).isNotEqualTo(id);
	}

	@Test
	void 본인_플레이에만_하나씩_연결된다() throws Exception {
		UUID mine = play(user), theirs = play(other);
		var linked = save(free(key).replace("\"playId\":null", "\"playId\":\"" + mine + "\""), user);
		assertThat(linked.getResponse().getStatus()).as(text(linked)).isEqualTo(201);
		assertThat(body(linked).path("playId").asString()).isEqualTo(mine.toString());
		problem(save(free(UUID.randomUUID()).replace("\"playId\":null", "\"playId\":\"" + mine + "\""), user), 404, "RECORDING_PLAY_NOT_FOUND");
		problem(save(free(UUID.randomUUID()).replace("\"playId\":null", "\"playId\":\"" + theirs + "\""), user), 404, "RECORDING_PLAY_NOT_FOUND");
		problem(save(free(UUID.randomUUID()).replace("\"playId\":null", "\"playId\":\"" + UUID.randomUUID() + "\""), user), 404, "RECORDING_PLAY_NOT_FOUND");
		assertThat(count(user)).isEqualTo(1);

		// 플레이가 지워져도 녹음은 남는다.
		db.update("DELETE FROM play_sessions WHERE id=?", mine);
		assertThat(db.queryForObject("SELECT play_session_id IS NULL AND hit_count=3 FROM recordings WHERE user_id=?", Boolean.class, user)).isTrue();
	}

	@Test
	void 인증_탈퇴_가입미완료() throws Exception {
		var anonymous = mvc.perform(post("/api/v1/recordings").contentType(MediaType.APPLICATION_JSON).content(free(key))).andReturn();
		assertThat(anonymous.getResponse().getStatus()).isEqualTo(401);
		db.update("UPDATE users SET terms_agreed_at=NULL,terms_version=NULL WHERE id=?", other);
		problem(save(free(key), other), 403, "SIGNUP_INCOMPLETE");
		db.update("UPDATE users SET status='WITHDRAWN',withdrawn_at=now() WHERE id=?", user);
		assertThat(save(free(key), user).getResponse().getStatus()).isEqualTo(401);
		assertThat(db.queryForObject("SELECT count(*) FROM recordings WHERE user_id IN (?,?)", Integer.class, user, other)).isZero();
	}

	@Test
	void 살아있는_녹음이_200개면_413() throws Exception {
		db.update("INSERT INTO recordings(user_id,title,client_key,mode,input_source,schema_version,started_at,duration_ms,hit_count,hits,payload_hash) "
				+ "SELECT ?,'채우기',gen_random_uuid(),'FREE','KEYBOARD',1,now(),1,1,'[{\"tMs\":0,\"pad\":\"SNARE\",\"velocity\":1}]',? FROM generate_series(1,200)", user, HASH);
		problem(save(free(key), user), 413, "RECORDING_QUOTA_EXCEEDED");
		db.update("UPDATE recordings SET deleted_at=now() WHERE id=(SELECT min(id) FROM recordings WHERE user_id=?)", user);
		assertThat(save(free(key), user).getResponse().getStatus()).isEqualTo(201);
	}

	@Test
	void 잘못된_본문은_4xx이고_저장하지_않는다() throws Exception {
		problem(save(free(key).replace("\"velocity\":90", "\"velocity\":128"), user), 400, "RECORDING_INVALID");
		problem(save(free(key).replace("\"schemaVersion\":1", "\"schemaVersion\":2"), user), 409, "RECORDING_SCHEMA_UNSUPPORTED");
		problem(save(RecordingFixtures.many(key, 50_001), user), 413, "RECORDING_TOO_LARGE");
		byte[] big = new byte[RecordingJson.MAX_BYTES + 1];
		java.util.Arrays.fill(big, (byte) ' ');
		problem(send(post("/api/v1/recordings").contentType(MediaType.APPLICATION_JSON).content(big), user), 413, "RECORDING_TOO_LARGE");
		var gzip = send(post("/api/v1/recordings").contentType(MediaType.APPLICATION_JSON).header(HttpHeaders.CONTENT_ENCODING, "gzip").content(free(key)), user);
		problem(gzip, 400, "RECORDING_INVALID");
		assertThat(count(user)).isZero();
	}

	@Test
	void 같은_키를_동시에_보내면_하나만_만든다() throws Exception {
		var gate = new CountDownLatch(1);
		try (var pool = Executors.newFixedThreadPool(4)) {
			var tasks = new ArrayList<Future<Integer>>();
			for (int i = 0; i < 4; i++)
				tasks.add(pool.submit(() -> {
					gate.await();
					return save(free(key), user).getResponse().getStatus();
				}));
			gate.countDown();
			var statuses = new ArrayList<Integer>();
			for (var task : tasks) statuses.add(task.get(20, TimeUnit.SECONDS));
			assertThat(statuses).containsOnly(200, 201).containsOnlyOnce(201);
		}
		assertThat(count(user)).isEqualTo(1);
	}

	/** 검증 D1: 회원 행 잠금을 3초 넘게 기다리면 500이 아니라 재시도 가능한 503이다. */
	@Test
	void 잠금_대기를_넘기면_503_RECORDING_BUSY() throws Exception {
		try (var holder = dataSource.getConnection()) {
			holder.setAutoCommit(false);
			try (var lock = holder.prepareStatement("SELECT id FROM users WHERE id=? FOR UPDATE")) {
				lock.setLong(1, user);
				lock.executeQuery().close();
			}
			try {
				problem(save(free(key), user), 503, "RECORDING_BUSY");
			} finally {
				holder.rollback();
			}
		}
		assertThat(count(user)).isZero();
		assertThat(save(free(key), user).getResponse().getStatus()).isEqualTo(201);
	}

	private UUID play(long owner) {
		UUID id = UUID.randomUUID();
		db.update("INSERT INTO play_sessions(id,user_id,mode,input_source,payload_schema_version,payload_hash,started_at,ended_at) VALUES(?,?,'FREE','STICK',1,?,now(),now())",
				id, owner, HASH);
		return id;
	}

	private int count(long owner) {
		return db.queryForObject("SELECT count(*) FROM recordings WHERE user_id=?", Integer.class, owner);
	}

	MvcResult save(String body, long as) throws Exception {
		return send(post("/api/v1/recordings").contentType(MediaType.APPLICATION_JSON).content(body.getBytes(StandardCharsets.UTF_8)), as);
	}

	MvcResult send(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request, long as) throws Exception {
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
