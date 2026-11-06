package com.ssafy.airdrum.song.similar;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.song.SongLevelService;
import com.ssafy.airdrum.song.meta.SongMetadata;
import com.ssafy.airdrum.song.meta.SongMetadataRepository;
import com.ssafy.airdrum.song.recommend.RecommendationService;
import static org.assertj.core.api.Assertions.*;

/** R2 비슷한 곡의 DB 연결: 후보 조건, 개인 곡 제외, 404, 격자 없는 기준 곡, 본인 기록 필터, 노출·클릭 기록. 순수 유사도는 SimilarityEngineTest가 본다. */
@SpringBootTest(properties = { "spring.datasource.hikari.schema=public", "similar.cache-ttl-seconds=0" })
class SimilarSongsServiceTest {
	static final String TIMING_120 = "{\"bpm\":120,\"offsetMs\":0,\"timeSignature\":\"4/4\"}";
	@Autowired JdbcTemplate db;
	@Autowired PlatformTransactionManager manager;
	@Autowired SongLevelService levels;
	@Autowired SimilarSongsService service;
	@Autowired RecommendationService recommendations;
	@Autowired SongMetadataRepository metadata;
	TransactionTemplate tx;
	long user, other, rockA, rockB, four, shuffle, personal, noGrid, fast;

	@BeforeEach void setup() {
		tx = new TransactionTemplate(manager);
		user = db.queryForObject("INSERT INTO users(nickname) VALUES('sim-test') RETURNING id", Long.class);
		other = db.queryForObject("INSERT INTO users(nickname) VALUES('sim-other') RETURNING id", Long.class);
		rockA = builtin("sim-rock-a", "ROCK", 100_000, TIMING_120);
		rockB = builtin("sim-rock-b", "ROCK", 100_000, TIMING_120);
		four = builtin("sim-four", "FOUR", 100_000, TIMING_120);
		shuffle = builtin("sim-shuffle", "SHUFFLE", 100_000, TIMING_120);
		fast = builtin("sim-fast", "ROCK", 25_000, TIMING_120);       // 노트는 같고 곡이 짧아 밀도가 4배
		noGrid = builtin("sim-nogrid", "ROCK", 100_000, "{}");        // 박자 정보가 망가져 격자 없음
		personal = personal("sim-personal", user, "ROCK");
		for (long id : new long[] { rockA, rockB, four, shuffle, fast, noGrid, personal }) tx.executeWithoutResult(s -> levels.process(id, true));
	}

	private long builtin(String title, String kind, int durationMs, String timing) {
		long id = db.queryForObject("INSERT INTO songs(title,source,status,duration_ms,license,bpm,time_signature) VALUES(?,'BUILTIN','READY',?,'CC0',120,'4/4') RETURNING id", Long.class, title, durationMs);
		chart(id, kind, timing);
		return id;
	}
	private long personal(String title, long owner, String kind) {
		long id = db.queryForObject("INSERT INTO songs(owner_id,title,source,status,duration_ms,bpm,time_signature) VALUES(?,?,'MIDI','READY',100000,120,'4/4') RETURNING id", Long.class, owner, title);
		chart(id, kind, TIMING_120);
		return id;
	}
	/** 곡 난이도는 HARD 채보로 산정된다(SongLevelService). HARD가 없으면 난이도도 채보 특징도 생기지 않는다. */
	private void chart(long song, String kind, String timing) {
		long chart = db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,'HARD') RETURNING id", Long.class, song);
		var notes = notes(kind);
		db.update("INSERT INTO chart_versions(chart_id,version,notes,timing,notation_status,note_count,generator) VALUES(?,1,?::jsonb,?::jsonb,'READY',?,'MANUAL')",
				chart, json(notes), timing, notes.size());
	}
	private record N(double t, String pad) {}
	/** 120BPM 4/4 8마디. SimilarityEngineTest의 패턴과 같다. */
	private static List<N> notes(String kind) {
		var list = new ArrayList<N>();
		for (int bar = 0; bar < 8; bar++) for (int b = 0; b < 4; b++) {
			double t = (bar * 4 + b) * 500.0;
			boolean backbeat = b == 1 || b == 3;
			switch (kind) {
				case "ROCK" -> { list.add(new N(t, backbeat ? "SNARE" : "KICK")); list.add(new N(t, "HIHAT")); list.add(new N(t + 250, "HIHAT")); }
				case "FOUR" -> { list.add(new N(t, "KICK")); list.add(new N(t + 250, "HIHAT")); if (backbeat) list.add(new N(t, "SNARE")); }
				default -> { list.add(new N(t, "RIDE")); list.add(new N(t + 500 * 2.0 / 3, "RIDE")); if (backbeat) list.add(new N(t, "SNARE")); if (b == 0) list.add(new N(t, "KICK")); }
			}
		}
		list.sort(Comparator.comparingDouble(N::t));
		return list;
	}
	private static String json(List<N> notes) {
		var sb = new StringBuilder("[");
		for (int i = 0; i < notes.size(); i++) {
			if (i > 0) sb.append(',');
			sb.append("{\"noteId\":\"n").append(i).append("\",\"timeMs\":").append(notes.get(i).t()).append(",\"pad\":\"").append(notes.get(i).pad()).append("\"}");
		}
		return sb.append(']').toString();
	}

	@AfterEach void cleanup() {
		var users = new Object[] { user, other };
		db.update("DELETE FROM recommendation_items WHERE user_id IN (?,?)", users);
		db.update("DELETE FROM play_sessions WHERE user_id IN (?,?)", users);
		db.update("UPDATE songs SET song_level=NULL,level_chart_version_id=NULL,level_rule_version=NULL,level_duration_ms=NULL WHERE title LIKE 'sim-%'");
		db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT c.id FROM charts c JOIN songs s ON s.id=c.song_id WHERE s.title LIKE 'sim-%')");
		db.update("DELETE FROM charts WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'sim-%')");
		db.update("DELETE FROM songs WHERE title LIKE 'sim-%'");
		db.update("DELETE FROM users WHERE id IN (?,?)", users);
	}

	private List<Long> songIds(SimilarResponses.Similar r) { return r.items().stream().map(i -> i.song().id()).toList(); }

	@Test void 같은_종류의_곡이_앞에_오고_기준_곡과_개인_곡은_빠진다() {
		var result = service.similar(user, rockA, "NORMAL", 10);
		assertThat(result.strategy()).isEqualTo("SIMILAR_V1");
		assertThat(songIds(result)).doesNotContain(rockA, personal).doesNotHaveDuplicates();
		assertThat(songIds(result).subList(0, 2)).containsExactlyInAnyOrder(rockB, noGrid);
		assertThat(result.items()).allSatisfy(i -> {
			assertThat(i.similarity()).isBetween(0.5, 1.0);
			assertThat(i.matchedOn()).isNotEmpty().hasSizeLessThanOrEqualTo(2);
		});
		var similarities = result.items().stream().map(SimilarResponses.Item::similarity).toList();
		assertThat(similarities).isSortedAccordingTo(Comparator.reverseOrder());
	}

	@Test void 같은_입력이면_같은_결과를_돌려준다() {
		assertThat(songIds(service.similar(user, rockA, "NORMAL", 10))).isEqualTo(songIds(service.similar(user, rockA, "NORMAL", 10)));
	}

	@Test void 없는_곡과_타인의_개인_곡은_404이고_본인_곡은_기준으로_쓸_수_있다() {
		assertThatThrownBy(() -> service.similar(user, Long.MAX_VALUE, "NORMAL", 5)).isInstanceOfSatisfying(BusinessException.class,
				e -> assertThat(e.getErrorCode().code()).isEqualTo("SONG_NOT_FOUND"));
		assertThatThrownBy(() -> service.similar(other, personal, "NORMAL", 5)).isInstanceOfSatisfying(BusinessException.class,
				e -> assertThat(e.getErrorCode().code()).isEqualTo("SONG_NOT_FOUND"));
		var own = service.similar(user, personal, "NORMAL", 10);
		assertThat(songIds(own)).contains(rockA).doesNotContain(personal);
	}

	@Test void 격자가_없는_곡도_후보와_기준_곡이_된다() {
		assertThat(db.queryForObject("SELECT count(*) FROM chart_features f JOIN chart_versions v ON v.id=f.chart_version_id JOIN charts c ON c.id=v.chart_id WHERE c.song_id=? AND (f.rhythm_grid -> 'groups') IS NOT NULL", Integer.class, noGrid)).isZero();
		assertThat(songIds(service.similar(user, rockA, "NORMAL", 10))).contains(noGrid);
		assertThat(songIds(service.similar(user, noGrid, "NORMAL", 10))).contains(rockA);
	}

	@Test void 기준_곡에_채보_특징이_없으면_200과_빈_목록이고_노출을_남기지_않는다() {
		long empty = db.queryForObject("INSERT INTO songs(title,source,status,duration_ms,license) VALUES('sim-empty','BUILTIN','READY',100000,'CC0') RETURNING id", Long.class);
		var result = service.similar(user, empty, "NORMAL", 5);
		assertThat(result.items()).isEmpty();
		assertThat(db.queryForObject("SELECT count(*) FROM recommendation_items WHERE request_id=?", Integer.class, result.requestId())).isZero();
	}

	@Test void 본인_기준_밀도의_1점5배를_넘는_채보는_걸러지고_기록이_없으면_걸러지지_않는다() {
		assertThat(songIds(service.similar(user, rockA, "NORMAL", 10))).contains(fast); // 기록 없음: 거르지 않음
		long version = db.queryForObject("SELECT v.id FROM charts c JOIN chart_versions v ON v.chart_id=c.id WHERE c.song_id=?", Long.class, rockB);
		UUID play = UUID.randomUUID();
		db.update("""
				INSERT INTO play_sessions(id,user_id,song_id,chart_version_id,mode,input_source,judgement_context,payload_schema_version,payload_hash,accuracy,started_at,ended_at)
				VALUES (?,?,?,?, 'RHYTHM','KEYBOARD','{}'::jsonb,1,?,90,?,?)
				""", play, user, rockB, version, "a".repeat(64), Timestamp.from(Instant.now().minus(2, ChronoUnit.DAYS)), Timestamp.from(Instant.now().minus(1, ChronoUnit.DAYS)));
		assertThat(songIds(service.similar(user, rockA, "NORMAL", 10))).doesNotContain(fast).contains(rockB);
		assertThat(songIds(service.similar(other, rockA, "NORMAL", 10))).contains(fast); // 다른 사용자는 영향 없음
	}

	@Test void 노출은_SIMILAR로_기준_곡과_함께_기록되고_클릭은_본인_것만_갱신된다() {
		var result = service.similar(user, rockA, "NORMAL", 3);
		assertThat(result.items()).isNotEmpty();
		var rows = db.queryForList("SELECT context, strategy, source_song_id, song_id FROM recommendation_items WHERE request_id=? ORDER BY rank", result.requestId());
		assertThat(rows).hasSize(result.items().size());
		assertThat(rows).allSatisfy(row -> {
			assertThat(row.get("context")).isEqualTo("SIMILAR");
			assertThat(row.get("strategy")).isEqualTo("SIMILAR_V1");
			assertThat(((Number) row.get("source_song_id")).longValue()).isEqualTo(rockA);
		});
		long clicked = result.items().getFirst().song().id();
		recommendations.click(user, result.requestId(), clicked);
		assertThat(db.queryForObject("SELECT clicked_at FROM recommendation_items WHERE request_id=? AND song_id=?", Timestamp.class, result.requestId(), clicked)).isNotNull();
		assertThatThrownBy(() -> recommendations.click(other, result.requestId(), clicked)).isInstanceOf(BusinessException.class);
	}

	private double similarityOf(SimilarResponses.Similar r, long songId) {
		return r.items().stream().filter(i -> i.song().id() == songId).findFirst().orElseThrow().similarity();
	}

	/** 255번 설계 4-2절: 곡 메타데이터가 양쪽에 있으면 엔진이 섞고, 한쪽이라도 없으면 채보 유사도만 쓴다(엔진 기존 규칙). */
	@Test void 곡_메타데이터가_같은_곡이_더_비슷하고_메타가_없는_곡은_점수가_그대로다() {
		var before = service.similar(user, rockA, "NORMAL", 10);
		assertThat(similarityOf(before, rockB)).isEqualTo(similarityOf(before, noGrid)); // 채보가 같아 점수도 같다
		var rock = new SongMetadata("ROCK", List.of("POP"), List.of("ENERGETIC"), 4, null, "EN", List.of("EIGHT_BEAT"), "HUMAN", null);
		var ballad = new SongMetadata("BALLAD", List.of(), List.of("CALM"), 1, null, "KO", List.of("HALF_TIME"), "HUMAN", null);
		metadata.upsert(rockA, rock);
		metadata.upsert(noGrid, rock);
		metadata.upsert(rockB, ballad);

		var after = service.similar(user, rockA, "NORMAL", 10);
		assertThat(similarityOf(after, noGrid)).isGreaterThan(similarityOf(after, rockB));
		assertThat(similarityOf(after, four)).isEqualTo(similarityOf(before, four));
	}

	@Test void 크기_제한을_지킨다() {
		assertThat(service.similar(user, rockA, "NORMAL", 1).items()).hasSize(1);
	}
}
