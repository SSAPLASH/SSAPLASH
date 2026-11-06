package com.ssafy.airdrum.song.recommend;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.song.SongLevelService;
import com.ssafy.airdrum.song.recommend.RecommendationCandidateService.Upload;
import com.ssafy.airdrum.song.recommend.RecommendationCandidateService.UserCandidates;
import com.ssafy.airdrum.song.recommend.RecommendationService.Context;
import com.ssafy.airdrum.user.RecommendationConsentInput;
import com.ssafy.airdrum.user.RecommendationConsentService;
import com.ssafy.airdrum.user.SignupConsentRequest;

/** R3 운영 연결(설계 문서 부록 C.7): 동의, 읽기 뷰, 적재, 서빙, 철회·탈퇴. */
@SpringBootTest(properties = { "spring.datasource.hikari.schema=public", "auth.jwt.secret=test-only-jwt-secret-0123456789ab",
		"auth.refresh-token.store=memory", "chart.worker.credentials=worker1=01234567890123456789012345678901",
		"recommend.r3.enabled=true", "recommend.r3.rollout-percent=100", "recommend.r3.accepted-model-versions=r3-base-aaaaaaaa",
		"recommend.r3.key-secret=test-secret" })
@AutoConfigureMockMvc
class RecommendationR3Test {
	static final String MODEL = "r3-base-aaaaaaaa", TOKEN = "Bearer 01234567890123456789012345678901";

	@Autowired JdbcTemplate db;
	@Autowired PlatformTransactionManager manager;
	@Autowired SongLevelService levels;
	@Autowired RecommendationService service;
	@Autowired RecommendationCandidateService candidates;
	@Autowired RecommendationConsentService consents;
	@Autowired RecommendationR3Settings settings;
	@Autowired com.ssafy.airdrum.withdrawal.WithdrawalService withdrawal;
	@Autowired com.ssafy.airdrum.user.SignupConsentService signup;
	@Autowired MockMvc mvc;

	TransactionTemplate tx;
	long user, stranger, easy, mid, tooHard;
	final List<Long> users = new ArrayList<>(), songs = new ArrayList<>();

	@BeforeEach void setup() {
		tx = new TransactionTemplate(manager);
		user = newUser("r3-user");
		stranger = newUser("r3-stranger");
		easy = song("r3-easy", 200);    // 2/s
		mid = song("r3-mid", 300);      // 3/s
		tooHard = song("r3-hard", 800); // 8/s
		for (long id : List.of(easy, mid, tooHard)) tx.executeWithoutResult(s -> levels.process(id, true));
	}

	@AfterEach void cleanup() {
		for (long id : users) {
			db.update("DELETE FROM social_accounts WHERE user_id = ?", id);
			db.update("DELETE FROM recommendation_items WHERE user_id = ?", id);
			db.update("DELETE FROM play_sessions WHERE user_id = ?", id);
		}
		for (long id : songs) {
			db.update("UPDATE songs SET song_level=NULL,level_chart_version_id=NULL,level_rule_version=NULL,level_duration_ms=NULL WHERE id = ?", id);
			db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT id FROM charts WHERE song_id = ?)", id);
			db.update("DELETE FROM charts WHERE song_id = ?", id);
			db.update("DELETE FROM songs WHERE id = ?", id);
		}
		for (long id : users) db.update("DELETE FROM users WHERE id = ?", id);
		users.clear();
		songs.clear();
	}

	private long newUser(String name) {
		long id = db.queryForObject("INSERT INTO users(nickname) VALUES(?) RETURNING id", Long.class, name + UUID.randomUUID().toString().substring(0, 6));
		users.add(id);
		return id;
	}

	private long song(String title, int notes) {
		long id = db.queryForObject("INSERT INTO songs(title,source,status,duration_ms,bpm,license) VALUES(?,'BUILTIN','READY',100000,120,'CC0') RETURNING id", Long.class, title);
		songs.add(id);
		long chart = db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,'HARD') RETURNING id", Long.class, id);
		var json = new StringBuilder("[");
		for (int i = 0; i < notes; i++) {
			if (i > 0) json.append(',');
			json.append("{\"noteId\":\"n").append(i).append("\",\"timeMs\":").append(i * (100000 / notes)).append(",\"pad\":\"SNARE\"}");
		}
		json.append(']');
		db.update("INSERT INTO chart_versions(chart_id,version,notes,timing,notation_status,note_count,generator) VALUES(?,1,?::jsonb,'{}'::jsonb,'READY',?,'MANUAL')", chart, json.toString(), notes);
		return id;
	}

	private long version(long song) {
		return db.queryForObject("SELECT v.id FROM charts c JOIN chart_versions v ON v.chart_id=c.id WHERE c.song_id=?", Long.class, song);
	}

	private void play(long userId, long song, double accuracy, long seconds) { play(userId, song, accuracy, seconds, true); }

	private void play(long userId, long song, double accuracy, long seconds, boolean consent) {
		Instant end = Instant.now().truncatedTo(ChronoUnit.SECONDS);
		db.update("""
				INSERT INTO play_sessions(id,user_id,song_id,chart_version_id,mode,input_source,judgement_context,consent,payload_schema_version,payload_hash,accuracy,started_at,ended_at)
				VALUES (?,?,?,?, 'RHYTHM','KEYBOARD','{}'::jsonb,?,1,?,?,?,?)
				""", UUID.randomUUID(), userId, song, version(song), consent, "a".repeat(64), accuracy, Timestamp.from(end.minusSeconds(seconds)), Timestamp.from(end));
	}

	private void agree(long id) { consents.save(id, new RecommendationConsentInput(true, "2026-11-05")); }
	private void disagree(long id) { consents.save(id, new RecommendationConsentInput(false, "2026-11-05")); }

	private Upload upload(long id, String generatedAt, Long... songIds) {
		return new Upload("b-1", MODEL, generatedAt, List.of(new UserCandidates(settings.userKey(id), List.of(songIds))));
	}
	private String now() { return Instant.now().truncatedTo(ChronoUnit.SECONDS).toString(); }
	private int stored(long id) { return db.queryForObject("SELECT count(*) FROM recommendation_candidates WHERE user_id=?", Integer.class, id); }

	/** 후보를 쓸 수 있는 상태: 동의, 기준 밀도 3/s(mid를 90%로 침), 후보 적재. */
	private void ready(Long... songIds) {
		agree(user);
		play(user, mid, 90, 100);
		candidates.upload(upload(user, now(), songIds));
	}

	// ---- 동의

	@Test void neverAnsweredMeansNotAgreed() {
		var consent = consents.get(user);
		assertThat(consent.agreed()).isFalse();
		assertThat(consent.version()).isNull();
	}

	@Test void withdrawingConsentDeletesCandidatesInTheSameCall() {
		ready(easy);
		assertThat(stored(user)).isEqualTo(1);
		disagree(user);
		assertThat(stored(user)).isZero();
		assertThat(consents.get(user).agreed()).isFalse();
	}

	@Test void withdrawingConsentIsAcceptedEvenWithAnOldVersion() {
		var strict = new RecommendationConsentService(db, java.time.Clock.systemUTC(), "new-version");
		ready(easy);
		assertThatThrownBy(() -> strict.save(user, new RecommendationConsentInput(true, "old-version"))).isInstanceOf(com.ssafy.airdrum.common.error.BusinessException.class);
		assertThat(strict.save(user, new RecommendationConsentInput(false, "old-version")).agreed()).isFalse();
		assertThat(stored(user)).isZero();
	}

	@Test void signupCanCarryTheOptionalConsentAndOmittingItKeepsThePreviousAnswer() {
		db.update("INSERT INTO social_accounts(user_id,provider,provider_user_id) VALUES(?,'GOOGLE',?)", user, "r3-" + user);
		var data = new com.ssafy.airdrum.user.DataConsentInput(true, "d");
		signup.save(user, new SignupConsentRequest("t", "p", data, new RecommendationConsentInput(true, "r-1")));
		assertThat(consents.get(user).agreed()).isTrue();
		signup.save(user, new SignupConsentRequest("t", "p", data));
		assertThat(consents.get(user).version()).isEqualTo("r-1");
	}

	private List<String> history(long id) {
		return db.queryForList("SELECT agreed::text || ':' || version FROM user_recommendation_consent_history WHERE user_id = ? ORDER BY id", String.class, id);
	}

	@Test void everyAnswerIsKeptInTheHistory() {
		agree(user);
		disagree(user);
		consents.save(user, new RecommendationConsentInput(true, "r-2"));
		assertThat(history(user)).containsExactly("true:2026-11-05", "false:2026-11-05", "true:r-2");
	}

	@Test void withdrawalIsRecordedAsWithdrawingConsent() {
		agree(user);
		withdrawal.withdraw(user);
		assertThat(history(user)).containsExactly("true:2026-11-05", "false:2026-11-05");
	}

	@Test void withdrawalWithoutConsentAddsNoHistory() {
		disagree(user);
		withdrawal.withdraw(user);
		assertThat(history(user)).containsExactly("false:2026-11-05");
	}

	@Test void historyIsDeletedOnlyAfterTheRetentionOfWithdrawnConsent() {
		agree(user);
		disagree(stranger);
		var future = Instant.now().plus(java.time.Duration.ofDays(1));
		assertThat(consents.deleteHistoryBefore(Instant.now().minus(java.time.Duration.ofDays(1)))).isZero();
		assertThat(consents.deleteHistoryBefore(future)).isEqualTo(1);
		assertThat(history(stranger)).isEmpty();
		assertThat(consents.get(stranger).version()).isEqualTo("2026-11-05");
		assertThat(history(user)).hasSize(1);
	}

	@Test void withdrawnMembersLoseTheirConsentRowWithTheHistory() {
		agree(user);
		withdrawal.withdraw(user);
		consents.deleteHistoryBefore(Instant.now().plus(java.time.Duration.ofDays(1)));
		assertThat(history(user)).isEmpty();
		assertThat(db.queryForObject("SELECT count(*) FROM user_recommendation_consent WHERE user_id = ?", Integer.class, user)).isZero();
	}

	@Test void withdrawalDeletesCandidates() {
		ready(easy);
		withdrawal.withdraw(user);
		assertThat(stored(user)).isZero();
	}

	@Test void uploadAfterWithdrawalStoresNothing() {
		agree(user);
		withdrawal.withdraw(user);
		var result = candidates.upload(upload(user, now(), easy));
		assertThat(result.accepted()).isZero();
		assertThat(stored(user)).isZero();
	}

	@Test void expiredCandidatesAreDeletedAndFreshOnesKept() {
		agree(user);
		agree(stranger);
		candidates.upload(upload(user, Instant.now().minus(java.time.Duration.ofDays(8)).truncatedTo(ChronoUnit.SECONDS).toString(), easy));
		candidates.upload(upload(stranger, now(), easy));
		assertThat(candidates.deleteExpired(Instant.now())).isEqualTo(1);
		assertThat(stored(user)).isZero();
		assertThat(stored(stranger)).isEqualTo(1);
	}

	// ---- 적재

	@Test void uploadAcceptsConsentedAndDropsOthersWithoutError() {
		agree(user);
		var body = new Upload("b-1", MODEL, now(), List.of(
				new UserCandidates(settings.userKey(user), List.of(easy)),
				new UserCandidates(settings.userKey(stranger), List.of(easy)),
				new UserCandidates("0".repeat(32), List.of(easy))));
		var result = candidates.upload(body);
		assertThat(result.accepted()).isEqualTo(1);
		assertThat(result.droppedNoConsent()).isEqualTo(1);
		assertThat(result.droppedUnknown()).isEqualTo(1);
		assertThat(stored(stranger)).isZero();
	}

	@Test void sameBodyTwiceGivesTheSameRows() {
		agree(user);
		var body = upload(user, now(), easy, mid);
		candidates.upload(body);
		candidates.upload(body);
		assertThat(db.queryForList("SELECT song_id FROM recommendation_candidates WHERE user_id=? ORDER BY rank", Long.class, user)).containsExactly(easy, mid);
	}

	@Test void newBatchReplacesAndOlderBatchDoesNot() {
		agree(user);
		candidates.upload(upload(user, "2026-11-05T00:00:00Z", easy));
		candidates.upload(upload(user, "2026-11-06T00:00:00Z", mid));
		candidates.upload(upload(user, "2026-11-04T00:00:00Z", easy));
		assertThat(db.queryForList("SELECT song_id FROM recommendation_candidates WHERE user_id=?", Long.class, user)).containsExactly(mid);
	}

	@Test void songsThatAreNoLongerServableAreSkippedAndRanksStayDense() {
		agree(user);
		long personal = db.queryForObject("INSERT INTO songs(owner_id,title,source,status,duration_ms) VALUES(?,'r3-personal','MIDI','READY',100000) RETURNING id", Long.class, user);
		songs.add(personal);
		candidates.upload(upload(user, now(), personal, 999_999_999L, mid));
		assertThat(db.queryForList("SELECT rank FROM recommendation_candidates WHERE user_id=?", Integer.class, user)).containsExactly(1);
	}

	@Test void unknownModelVersionIsRejected() {
		agree(user);
		var body = new Upload("b-1", "r3-base-bbbbbbbb", now(), List.of());
		assertThatThrownBy(() -> candidates.upload(body)).isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("errorCode", RecommendationErrorCode.MODEL_VERSION_NOT_ACCEPTED);
	}

	@Test void malformedBodiesAreRejected() {
		var key = settings.userKey(user);
		var bad = List.of(
				new Upload("", MODEL, now(), List.of()),
				new Upload("b", MODEL, "어제", List.of()),
				new Upload("b", MODEL, now(), List.of(new UserCandidates("NOT-A-KEY", List.of(1L)))),
				new Upload("b", MODEL, now(), List.of(new UserCandidates(key, List.of(1L, 1L)))),
				new Upload("b", MODEL, now(), List.of(new UserCandidates(key, List.of(1L)), new UserCandidates(key, List.of(2L)))));
		for (var body : bad) assertThatThrownBy(() -> candidates.upload(body)).isInstanceOf(BusinessException.class);
	}

	@Test void apiNeedsTheWorkerTokenAndReturnsCountsOnly() throws Exception {
		agree(user);
		String body = "{\"batchId\":\"b-1\",\"modelVersion\":\"" + MODEL + "\",\"generatedAt\":\"" + now() + "\",\"users\":[{\"userKey\":\"" + settings.userKey(user) + "\",\"songIds\":[" + easy + "]}]}";
		mvc.perform(post("/internal/v1/recommend-candidates").contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isUnauthorized());
		mvc.perform(post("/internal/v1/recommend-candidates").header("Authorization", TOKEN).contentType(MediaType.APPLICATION_JSON).content(body))
				.andExpect(status().isOk()).andExpect(jsonPath("$.accepted").value(1)).andExpect(jsonPath("$.droppedUnknown").value(0));
		mvc.perform(get("/internal/v1/recommend-candidates/status").header("Authorization", TOKEN))
				.andExpect(status().isOk()).andExpect(jsonPath("$.modelVersion").value(MODEL));
	}

	// ---- 서빙

	@Test void servesCandidatesWithHardExclusionAndLogsTheStrategy() {
		ready(tooHard, easy);
		var result = service.recommend(user, Context.SONG_PICKER, null, 5);
		assertThat(result.strategy()).isEqualTo("R3_V1");
		assertThat(result.items()).extracting(i -> i.song().id()).doesNotContain(tooHard).startsWith(easy);
		assertThat(db.queryForList("SELECT DISTINCT strategy FROM recommendation_items WHERE user_id=?", String.class, user)).containsExactly("R3_V1");
	}

	@Test void candidatesAreIgnoredWithoutConsent() {
		ready(easy);
		db.update("UPDATE user_recommendation_consent SET agreed=false WHERE user_id=?", user);
		assertThat(service.recommend(user, Context.SONG_PICKER, null, 5).strategy()).isEqualTo("RULE_V1");
	}

	@Test void staleCandidatesFallBackToRules() {
		ready(easy);
		db.update("UPDATE recommendation_candidates SET generated_at = generated_at - interval '8 days' WHERE user_id=?", user);
		assertThat(service.recommend(user, Context.SONG_PICKER, null, 5).strategy()).isEqualTo("RULE_V1");
	}

	@Test void onlyUnsafeCandidatesFallBackToRules() {
		ready(tooHard);
		assertThat(service.recommend(user, Context.SONG_PICKER, null, 5).strategy()).isEqualTo("RULE_V1");
	}

	@Test void userWithoutBaselineGetsRules() {
		agree(user);
		candidates.upload(upload(user, now(), easy));
		assertThat(service.recommend(user, Context.SONG_PICKER, null, 5).strategy()).isEqualTo("RULE_V1");
	}

	// ---- 읽기 뷰

	@Test void viewsExposeOnlyConsentedActiveUsersAndMatchTheServiceKey() {
		agree(user);
		disagree(stranger);
		play(user, mid, 90, 90);
		play(user, easy, 50, 10);
		play(user, tooHard, 70, 10, false);
		play(stranger, mid, 90, 90);
		tx.executeWithoutResult(s -> {
			db.queryForObject("SELECT set_config('app.recommend_key_secret', 'test-secret', true)", String.class);
			String key = settings.userKey(user);
			assertThat(db.queryForObject("SELECT count(*) FROM recommend_interactions_v WHERE user_key=? AND song_id=?", Integer.class, key, tooHard)).isZero();
			assertThat(db.queryForList("SELECT user_key FROM recommend_users_v", String.class)).contains(key).doesNotContain(settings.userKey(stranger));
			assertThat(db.queryForList("SELECT DISTINCT user_key FROM recommend_interactions_v", String.class)).contains(key).doesNotContain(settings.userKey(stranger));
			assertThat(db.queryForObject("SELECT completed FROM recommend_interactions_v WHERE user_key=? AND song_id=?", Boolean.class, key, mid)).isTrue();
			assertThat(db.queryForObject("SELECT completed FROM recommend_interactions_v WHERE user_key=? AND song_id=?", Boolean.class, key, easy)).isFalse();
			assertThat(db.queryForObject("SELECT rhythm_grid FROM recommend_chart_features_v WHERE song_id=?", String.class, mid)).startsWith("{");
		});
		tx.executeWithoutResult(s -> {
			db.queryForObject("SELECT set_config('app.recommend_key_secret', '', true)", String.class);
			assertThat(db.queryForObject("SELECT count(*) FROM recommend_users_v", Integer.class)).isZero();
		});
	}

	@Test void readerRoleCanReadViewsButNotTables() {
		assertThat(db.queryForObject("SELECT has_table_privilege('recommend_export_reader', 'recommend_users_v', 'SELECT')", Boolean.class)).isTrue();
		for (String table : List.of("users", "play_sessions", "user_recommendation_consent", "recommendation_candidates"))
			assertThat(db.queryForObject("SELECT has_table_privilege('recommend_export_reader', ?, 'SELECT')", Boolean.class, table)).isFalse();
	}
}
