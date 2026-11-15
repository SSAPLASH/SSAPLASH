package com.ssafy.airdrum.domain.recommendation.service;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import com.ssafy.airdrum.domain.recommendation.dto.RecommendationResponses;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.domain.song.service.level.SongLevelService;
import com.ssafy.airdrum.domain.chart.service.feature.ChartFeatureService;
import com.ssafy.airdrum.domain.recommendation.service.RecommendationService.Context;
import static org.assertj.core.api.Assertions.*;

/** 곡 추천 R1의 DB 연결 부분: 채보 특징 저장, 후보 조건, 노출·클릭 기록, 보관 정리. 순수 점수 규칙은 RecommendationScorerTest가 본다. */
@SpringBootTest(properties = "spring.datasource.hikari.schema=public")
class RecommendationServiceTest {
	@Autowired JdbcTemplate db;
	@Autowired PlatformTransactionManager manager;
	@Autowired SongLevelService levels;
	@Autowired ChartFeatureService features;
	@Autowired RecommendationService service;
	@Autowired com.ssafy.airdrum.domain.withdrawal.service.WithdrawalService withdrawal;
	TransactionTemplate tx;
	long user, other, slow, mid, fast, personal;
	long midVersion;

	@BeforeEach void setup() {
		tx = new TransactionTemplate(manager);
		user = db.queryForObject("INSERT INTO users(nickname) VALUES('rec-test') RETURNING id", Long.class);
		other = db.queryForObject("INSERT INTO users(nickname) VALUES('rec-other') RETURNING id", Long.class);
		slow = builtin("rec-slow", 200);   // 2/s
		mid = builtin("rec-mid", 400);     // 4/s
		fast = builtin("rec-fast", 800);   // 8/s
		personal = db.queryForObject("INSERT INTO songs(owner_id,title,source,status,duration_ms) VALUES(?,'rec-personal','MIDI','READY',100000) RETURNING id", Long.class, user);
		addChart(personal, 400);
		for (long id : new long[] { slow, mid, fast, personal }) tx.executeWithoutResult(s -> levels.process(id, true));
		midVersion = db.queryForObject("SELECT v.id FROM charts c JOIN chart_versions v ON v.chart_id=c.id WHERE c.song_id=?", Long.class, mid);
	}

	private long builtin(String title, int notes) { return builtin(title, notes, "HARD"); }
	private long builtin(String title, int notes, String difficulty) {
		long id = db.queryForObject("INSERT INTO songs(title,source,status,duration_ms,license) VALUES(?,'BUILTIN','READY',100000,'CC0') RETURNING id", Long.class, title);
		addChart(id, notes, difficulty);
		return id;
	}
	/** 곡 난이도는 HARD 채보로 산정된다(SongLevelService). HARD가 없는 곡은 난이도도, 채보 특징도 없다. */
	private void addChart(long song, int notes) { addChart(song, notes, "HARD"); }
	private void addChart(long song, int notes, String difficulty) {
		long chart = db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,?) RETURNING id", Long.class, song, difficulty);
		var json = new StringBuilder("[");
		for (int i = 0; i < notes; i++) {
			if (i > 0) json.append(',');
			json.append("{\"noteId\":\"n").append(i).append("\",\"timeMs\":").append(i * (100000 / notes)).append(",\"pad\":\"").append(i % 2 == 0 ? "SNARE" : "KICK").append("\"}");
		}
		json.append(']');
		db.update("INSERT INTO chart_versions(chart_id,version,notes,timing,notation_status,note_count,generator) VALUES(?,1,?::jsonb,'{}'::jsonb,'READY',?,'MANUAL')", chart, json.toString(), notes);
	}
	private UUID play(long userId, long song, long version, double accuracy, Instant endedAt) {
		UUID id = UUID.randomUUID();
		db.update("""
				INSERT INTO play_sessions(id,user_id,song_id,chart_version_id,mode,input_source,judgement_context,payload_schema_version,payload_hash,accuracy,started_at,ended_at)
				VALUES (?,?,?,?, 'RHYTHM','KEYBOARD','{}'::jsonb,1,?,?,?,?)
				""", id, userId, song, version, "a".repeat(64), accuracy, Timestamp.from(endedAt.minusSeconds(60)), Timestamp.from(endedAt));
		return id;
	}

	@AfterEach void cleanup() {
		var users = new Object[] { user, other };
		db.update("DELETE FROM recommendation_items WHERE user_id IN (?,?)", users);
		db.update("DELETE FROM reports WHERE play_session_id IN (SELECT id FROM play_sessions WHERE user_id IN (?,?))", users);
		db.update("DELETE FROM play_sessions WHERE user_id IN (?,?)", users);
		db.update("UPDATE songs SET song_level=NULL,level_chart_version_id=NULL,level_rule_version=NULL,level_duration_ms=NULL WHERE title LIKE 'rec-%'");
		db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT c.id FROM charts c JOIN songs s ON s.id=c.song_id WHERE s.title LIKE 'rec-%')");
		db.update("DELETE FROM charts WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'rec-%')");
		db.update("DELETE FROM songs WHERE title LIKE 'rec-%'");
		db.update("DELETE FROM users WHERE id IN (?,?)", users);
	}

	@Test void 느린_기록은_최근성에만_반영한다() {
		Instant now = Instant.now();
		UUID practice = play(user, mid, midVersion, 99, now);
		db.update("UPDATE play_sessions SET mode='SHEET', judgement_context='{\"playbackRate\":0.7}' WHERE id=?", practice);
		assertThat(service.baselineDensity(user)).isNull();

		long baseVersion = db.queryForObject("SELECT v.id FROM chart_versions v JOIN charts c ON c.id=v.chart_id WHERE c.song_id=?", Long.class, personal);
		play(user, personal, baseVersion, 90, now.minus(20, ChronoUnit.DAYS));
		play(user, mid, midVersion, 75, now.minus(20, ChronoUnit.DAYS));
		var recent = service.recommend(user, Context.SONG_PICKER, null, 10);
		var item = recent.items().stream().filter(i -> i.song().id() == mid).findFirst().orElseThrow();
		assertThat(item.reasons()).extracting(RecommendationResponses.Reason::code).contains("RETRY");

		db.update("DELETE FROM play_sessions WHERE id=?", practice);
		var older = service.recommend(user, Context.SONG_PICKER, null, 10);
		String score = "SELECT score FROM recommendation_items WHERE request_id=? AND song_id=?";
		assertThat(db.queryForObject(score, Double.class, recent.requestId(), mid))
				.isLessThan(db.queryForObject(score, Double.class, older.requestId(), mid));
	}

	private java.util.List<Long> songIds(RecommendationResponses.Recommendations r) { return r.items().stream().map(i -> i.song().id()).toList(); }

	@Test void HARD_채보가_없는_곡은_난이도가_산정되지_않아_채보_특징도_추천_후보도_없다() {
		long noHard = builtin("rec-normal-only", 300, "NORMAL");
		tx.executeWithoutResult(s -> levels.process(noHard, true));
		assertThat(db.queryForObject("SELECT song_level FROM songs WHERE id=?", String.class, noHard)).isNull();
		assertThat(db.queryForObject("SELECT count(*) FROM chart_features f JOIN chart_versions v ON v.id=f.chart_version_id JOIN charts c ON c.id=v.chart_id WHERE c.song_id=?", Integer.class, noHard)).isZero();
		assertThat(songIds(service.recommend(user, Context.SONG_PICKER, null, 10))).doesNotContain(noHard);
	}

	@Test void 난이도_산정이_커밋되면_채보_특징이_저장되고_같은_값으로_다시_계산해도_중복이_없다() {
		assertThat(db.queryForObject("SELECT count(*) FROM chart_features WHERE chart_version_id=?", Integer.class, midVersion)).isEqualTo(1);
		var row = db.queryForMap("SELECT avg_notes_per_sec, peak_notes_2s, feature_version FROM chart_features WHERE chart_version_id=?", midVersion);
		assertThat(((Number) row.get("avg_notes_per_sec")).doubleValue()).isEqualTo(4.0);
		assertThat(row.get("feature_version")).isEqualTo(ChartFeatureService.VERSION);
		assertThat(features.computeForSong(mid)).isZero();
		assertThat(db.queryForObject("SELECT count(*) FROM chart_features WHERE chart_version_id=?", Integer.class, midVersion)).isEqualTo(1);
	}

	@Test void 기록이_없으면_BEGINNER의_쉬운_곡만_STARTER_이유로_추천하고_개인_곡은_넣지_않는다() {
		var result = service.recommend(user, Context.SONG_PICKER, null, 5);
		assertThat(result.strategy()).isEqualTo("RULE_V1");
		assertThat(songIds(result)).contains(slow, mid).doesNotContain(fast, personal);
		assertThat(songIds(result)).doesNotHaveDuplicates();
		assertThat(result.items()).allSatisfy(i -> assertThat(i.reasons()).extracting(RecommendationResponses.Reason::code).containsExactly("STARTER"));
	}

	@Test void 높은_정확도_기록이_있으면_기준_밀도의_1점5배를_넘는_채보를_추천하지_않는다() {
		play(user, mid, midVersion, 90, Instant.now().minus(1, ChronoUnit.DAYS));
		var result = service.recommend(user, Context.SONG_PICKER, null, 5);
		// 기준 4.0 → fast(8.0)는 비율 2.0으로 제외
		assertThat(songIds(result)).doesNotContain(fast, personal).contains(slow);
		assertThat(result.items()).allSatisfy(i -> assertThat(i.reasons()).isNotEmpty());
	}

	@Test void 악보_이미지가_준비되지_않은_채보도_추천한다() {
		db.update("UPDATE chart_versions SET notation_status='PENDING' WHERE id=?", midVersion);
		assertThat(songIds(service.recommend(user, Context.SONG_PICKER, null, 10))).contains(mid);
	}

	@Test void 같은_입력이면_같은_순서를_돌려준다() {
		play(user, mid, midVersion, 90, Instant.now().minus(1, ChronoUnit.DAYS));
		assertThat(songIds(service.recommend(user, Context.SONG_PICKER, null, 5)))
				.isEqualTo(songIds(service.recommend(user, Context.SONG_PICKER, null, 5)));
	}

	@Test void 약점_패드가_있으면_그_패드를_많이_치는_곡의_이유에_WEAK_PAD가_붙는다() {
		var id = play(user, mid, midVersion, 90, Instant.now().minus(1, ChronoUnit.DAYS));
		db.update("""
				INSERT INTO reports(play_session_id,timing_histogram,pad_stats,weak_segments,generator_version)
				VALUES (?, '[]'::jsonb, '[]'::jsonb, '[{"pattern":"PAD_LATE","pads":["SNARE","KICK"],"metrics":{"severity":0.9}}]'::jsonb, 'test')
				""", id);
		var result = service.recommend(user, Context.REPORT, id, 5);
		assertThat(result.items()).anySatisfy(i -> assertThat(i.reasons()).extracting(RecommendationResponses.Reason::code).contains("WEAK_PAD"));
	}

	private void report(UUID playId, String weakSegments) {
		db.update("INSERT INTO reports(play_session_id,timing_histogram,pad_stats,weak_segments,generator_version) VALUES (?, '[]'::jsonb, '[]'::jsonb, ?::jsonb, 'test')", playId, weakSegments);
	}
	private static final String TRANSITION_WEAK = "[{\"pattern\":\"TRANSITION_LATE\",\"pads\":[\"SNARE\",\"KICK\"],\"metrics\":{\"severity\":0.9}}]";

	@Test void 연습_추천은_약점에_맞는_곡을_이유와_함께_돌려주고_DRILL로_기록한다() {
		var id = play(user, mid, midVersion, 90, Instant.now());
		report(id, TRANSITION_WEAK);
		var result = service.recommend(user, Context.DRILL, id, 3);
		assertThat(result.strategy()).isEqualTo("DRILL_V1");
		assertThat(result.items()).hasSize(1);
		var item = result.items().getFirst();
		assertThat(item.song().id()).isNotEqualTo(mid).isNotEqualTo(fast).isNotEqualTo(personal);
		assertThat(item.reasons()).extracting(RecommendationResponses.Reason::code).containsExactly("DRILL_TRANSITION");
		assertThat(item.reasons().getFirst().text()).startsWith("스네어에서 킥으로 넘어가는");
		assertThat(item.focus().pattern()).isEqualTo("TRANSITION_LATE");
		assertThat(item.focus().pads()).containsExactly("SNARE", "KICK");
		assertThat(db.queryForObject("SELECT count(*) FROM recommendation_items WHERE request_id=? AND context='DRILL' AND strategy='DRILL_V1'", Integer.class, result.requestId())).isEqualTo(1);
		service.click(user, result.requestId(), item.song().id());
		assertThat(db.queryForObject("SELECT clicked_at IS NOT NULL FROM recommendation_items WHERE request_id=?", Boolean.class, result.requestId())).isTrue();
	}

	/** 331번: 입문 코스 레슨 곡은 공용 곡이지만 추천 후보·연습 추천에 넣지 않는다. */
	@Test void 입문_코스_레슨_곡은_추천과_연습_추천에서_빠진다() {
		db.update("INSERT INTO lessons(song_id,position,kind,summary,pads) VALUES(?,9001,'PLAY','레슨','[\"KICK\"]'::jsonb)", slow);
		assertThat(songIds(service.recommend(user, Context.SONG_PICKER, null, 10))).doesNotContain(slow).contains(mid);
		var id = play(user, mid, midVersion, 90, Instant.now());
		report(id, TRANSITION_WEAK);
		assertThat(songIds(service.recommend(user, Context.DRILL, id, 3))).doesNotContain(slow);
	}

	@Test void 연습_추천은_약점이_없거나_분석_전이면_빈_목록이고_기록하지_않는다() {
		var noWeakness = play(user, mid, midVersion, 90, Instant.now());
		report(noWeakness, "[]");
		var pending = play(user, mid, midVersion, 90, Instant.now());
		db.update("INSERT INTO reports(play_session_id,timing_histogram,pad_stats,generator_version) VALUES (?, '[]'::jsonb, '[]'::jsonb, 'test')", pending);
		var noReport = play(user, mid, midVersion, 90, Instant.now());
		for (var id : java.util.List.of(noWeakness, pending, noReport)) {
			var result = service.recommend(user, Context.DRILL, id, 3);
			assertThat(result.items()).isEmpty();
			assertThat(result.strategy()).isEqualTo("DRILL_V1");
		}
		assertThat(db.queryForObject("SELECT count(*) FROM recommendation_items WHERE user_id=?", Integer.class, user)).isZero();
	}

	@Test void 기준_밀도가_없으면_방금_친_채보의_밀도를_쓴다() {
		var id = play(user, mid, midVersion, 50, Instant.now()); // 85% 미만이라 기준 밀도가 없다
		report(id, TRANSITION_WEAK);
		var result = service.recommend(user, Context.DRILL, id, 3);
		assertThat(result.items()).isNotEmpty();
		assertThat(result.items()).extracting(i -> i.song().id()).doesNotContain(fast);
	}

	@Test void 연습_추천은_playId가_필수이고_타인의_연주는_404다() {
		assertThatThrownBy(() -> service.recommend(user, Context.DRILL, null, 3))
				.isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.getErrorCode().code()).isEqualTo("INVALID_INPUT"));
		var othersPlay = play(other, mid, midVersion, 90, Instant.now());
		assertThatThrownBy(() -> service.recommend(user, Context.DRILL, othersPlay, 3))
				.isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.getErrorCode().code()).isEqualTo("PLAY_NOT_FOUND"));
	}

	@Test void 다른_context의_항목에는_focus가_없고_JSON에도_나오지_않는다() {
		var result = service.recommend(user, Context.SONG_PICKER, null, 5);
		assertThat(result.items()).isNotEmpty().allSatisfy(i -> assertThat(i.focus()).isNull());
		assertThat(tools.jackson.databind.json.JsonMapper.builder().build().writeValueAsString(result.items().getFirst())).doesNotContain("focus");
	}

	@Test void 타인의_연주나_없는_연주_ID는_404이고_SONG_PICKER에_playId를_주면_400이다() {
		var othersPlay = play(other, mid, midVersion, 90, Instant.now());
		assertThatThrownBy(() -> service.recommend(user, Context.REPORT, othersPlay, 5))
				.isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.getErrorCode().code()).isEqualTo("PLAY_NOT_FOUND"));
		assertThatThrownBy(() -> service.recommend(user, Context.REPORT, UUID.randomUUID(), 5))
				.isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.getErrorCode().code()).isEqualTo("PLAY_NOT_FOUND"));
		var mine = play(user, mid, midVersion, 90, Instant.now());
		assertThatThrownBy(() -> service.recommend(user, Context.SONG_PICKER, mine, 5))
				.isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.getErrorCode().code()).isEqualTo("INVALID_INPUT"));
	}

	@Test void 노출이_기록되고_클릭은_본인_것만_처음_시각을_유지하며_기록된다() {
		var result = service.recommend(user, Context.SONG_PICKER, null, 5);
		assertThat(result.items()).isNotEmpty();
		assertThat(db.queryForObject("SELECT count(*) FROM recommendation_items WHERE request_id=? AND user_id=?", Integer.class, result.requestId(), user)).isEqualTo(result.items().size());
		long song = result.items().getFirst().song().id();
		service.click(user, result.requestId(), song);
		var first = db.queryForObject("SELECT clicked_at FROM recommendation_items WHERE request_id=? AND song_id=?", Timestamp.class, result.requestId(), song);
		assertThat(first).isNotNull();
		service.click(user, result.requestId(), song);
		assertThat(db.queryForObject("SELECT clicked_at FROM recommendation_items WHERE request_id=? AND song_id=?", Timestamp.class, result.requestId(), song)).isEqualTo(first);
		assertThatThrownBy(() -> service.click(other, result.requestId(), song)).isInstanceOf(BusinessException.class);
		assertThatThrownBy(() -> service.click(user, UUID.randomUUID(), song)).isInstanceOf(BusinessException.class);
		assertThatThrownBy(() -> service.click(user, result.requestId(), fast)).isInstanceOf(BusinessException.class);
	}

	@Test void 보관_기간이_지난_노출_기록만_지운다() {
		var result = service.recommend(user, Context.SONG_PICKER, null, 5);
		var old = UUID.randomUUID();
		db.update("INSERT INTO recommendation_items(request_id,rank,user_id,context,strategy,song_id,chart_id,score,reason_codes,shown_at) SELECT ?,1,?,'SONG_PICKER','RULE_V1',s.id,c.id,0.5,'[]'::jsonb,? FROM songs s JOIN charts c ON c.song_id=s.id WHERE s.id=?",
				old, user, Timestamp.from(Instant.now().minus(120, ChronoUnit.DAYS)), mid);
		assertThat(service.deleteOlderThan(Instant.now().minus(90, ChronoUnit.DAYS))).isGreaterThanOrEqualTo(1);
		assertThat(db.queryForObject("SELECT count(*) FROM recommendation_items WHERE request_id=?", Integer.class, old)).isZero();
		assertThat(db.queryForObject("SELECT count(*) FROM recommendation_items WHERE request_id=?", Integer.class, result.requestId())).isEqualTo(result.items().size());
	}

	@Test void 회원_탈퇴하면_그_회원의_추천_기록이_지워진다() {
		var mine = service.recommend(user, Context.SONG_PICKER, null, 5);
		var theirs = service.recommend(other, Context.SONG_PICKER, null, 5);
		assertThat(mine.items()).isNotEmpty();
		withdrawal.withdraw(user);
		assertThat(db.queryForObject("SELECT count(*) FROM recommendation_items WHERE user_id=?", Integer.class, user)).isZero();
		assertThat(db.queryForObject("SELECT count(*) FROM recommendation_items WHERE request_id=?", Integer.class, theirs.requestId())).isEqualTo(theirs.items().size());
	}
}
