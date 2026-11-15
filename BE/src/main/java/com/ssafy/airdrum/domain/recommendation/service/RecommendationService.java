package com.ssafy.airdrum.domain.recommendation.service;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import com.ssafy.airdrum.domain.recommendation.exception.RecommendationErrorCode;
import com.ssafy.airdrum.domain.recommendation.model.RecommendationR3Settings;
import com.ssafy.airdrum.domain.recommendation.service.candidate.RecommendationCandidateService;
import com.ssafy.airdrum.domain.recommendation.service.drill.DrillInputs;
import com.ssafy.airdrum.domain.recommendation.service.drill.DrillPlanner;
import com.ssafy.airdrum.domain.recommendation.dto.RecommendationResponses.*;
import com.ssafy.airdrum.domain.recommendation.service.RecommendationScorer.*;
import com.ssafy.airdrum.domain.user.service.profile.UserQueryService;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.global.error.CommonErrorCode;
import com.ssafy.airdrum.domain.play.exception.PlayErrorCode;
import com.ssafy.airdrum.domain.song.service.catalog.SongQueryService;
import com.ssafy.airdrum.domain.chart.service.feature.ChartFeatureService;

/**
 * R1 곡 추천(설계 문서 CHART-COACH-곡추천-설계). 요청 시 DB의 공용 곡과 본인 기록만으로 규칙 점수를 계산하고 노출을 기록한다.
 * AI 서버를 부르지 않는다. 개인 곡은 후보에 넣지 않는다.
 */
@Service
public class RecommendationService {
	public static final String STRATEGY = "RULE_V1", R3_STRATEGY = "R3_V1", DRILL_STRATEGY = "DRILL_V1";
	static final int RECENT_PLAYS = 10, RECENT_REPORTS = 5;
	private static final Map<String, String> TEXT = Map.of(
			RecommendationScorer.CHALLENGE, "지금 실력보다 조금 어려워서 도전하기 좋아요",
			RecommendationScorer.WEAK_PAD, "최근 약했던 패드가 많이 나오는 곡이에요",
			RecommendationScorer.NEW_SONG, "아직 치지 않은 곡이에요",
			RecommendationScorer.RETRY, "한 번 더 치면 목표 정확도에 닿을 수 있어요",
			RecommendationScorer.STARTER, "처음 시작하기 좋은 쉬운 곡이에요");

	private static final Map<String, String> PAD_LABEL = Map.of("KICK", "킥", "SNARE", "스네어", "HIHAT", "하이햇", "HIHAT_PEDAL", "하이햇 페달", "CRASH", "크래시",
			"RIDE", "라이드", "SMALL_TOM", "스몰탐", "HI_TOM", "스몰탐", "MID_TOM", "미드탐", "FLOOR_TOM", "플로어탐");

	private final JdbcTemplate db;
	private final SongQueryService songs;
	private final UserQueryService users;
	private final JsonMapper json;
	private final Clock clock;
	private final RecommendationCandidateService candidateSongs;
	private final RecommendationR3Settings r3;
	private final DrillInputs drillInputs;

	public RecommendationService(JdbcTemplate db, SongQueryService songs, UserQueryService users, JsonMapper json, Clock clock,
			RecommendationCandidateService candidateSongs, RecommendationR3Settings r3, DrillInputs drillInputs) {
		this.db = db; this.songs = songs; this.users = users; this.json = json; this.clock = clock;
		this.candidateSongs = candidateSongs; this.r3 = r3; this.drillInputs = drillInputs;
	}

	public enum Context { SONG_PICKER, REPORT, DRILL }
	public enum Mode { RHYTHM, SHEET }

	@Transactional
	public Recommendations recommend(long userId, Context context, UUID playId, int size) {
		if (!users.isActive(userId)) throw new BusinessException(CommonErrorCode.UNAUTHORIZED);
		if (playId != null) {
			if (context == Context.SONG_PICKER) throw new BusinessException(CommonErrorCode.INVALID_INPUT);
			var own = db.queryForObject("SELECT EXISTS(SELECT 1 FROM play_sessions WHERE id = ? AND user_id = ?)", Boolean.class, playId, userId);
			if (!Boolean.TRUE.equals(own)) throw new BusinessException(PlayErrorCode.PLAY_NOT_FOUND);
		}
		if (context == Context.DRILL) {
			if (playId == null) throw new BusinessException(CommonErrorCode.INVALID_INPUT);
			return drills(userId, playId, size);
		}
		Instant now = clock.instant();
		var pool = candidates();
		var profile = profile(userId, playId);
		var blended = RecommendationScorer.blend(pool, profile, now, size, candidateSongs.usableSongs(userId, now), r3.relevanceWeight());
		String strategy = blended.isEmpty() ? STRATEGY : R3_STRATEGY;
		var ranked = blended.isEmpty() ? RecommendationScorer.rank(pool, profile, now, size) : RecommendationScorer.fill(blended, pool, profile, now, size);
		var summaries = songs.byIds(userId, ranked.stream().map(s -> s.candidate().songId()).toList());
		var bySong = new HashMap<Long, com.ssafy.airdrum.domain.song.dto.SongResponses.SongSummary>();
		for (var s : summaries) bySong.put(s.id(), s);

		UUID requestId = UUID.randomUUID();
		var items = new ArrayList<Item>();
		int rank = 0;
		for (Scored scored : ranked) {
			var c = scored.candidate();
			var summary = bySong.get(c.songId());
			if (summary == null) continue; // 조회 사이에 비공개·삭제된 곡
			rank++;
			items.add(new Item(summary, c.chartId(), c.difficulty(),
					scored.reasons().stream().map(code -> new Reason(code, TEXT.get(code))).toList(), null));
			logExposure(requestId, rank, userId, context.name(), strategy, c.songId(), c.chartId(), scored.total(), scored.reasons(), null, now);
		}
		return new Recommendations(requestId, strategy, List.copyOf(items));
	}

	/** 연습 추천. 약점에 맞는 곡을 고른다. 기준 밀도가 없으면 방금 친 채보의 밀도를 쓴다. R3 후보는 쓰지 않는다. */
	private Recommendations drills(long userId, UUID playId, int size) {
		var inputs = drillInputs.read(playId);
		Double baseline = baselineDensity(userId);
		if (baseline == null) baseline = inputs.playedDensity();
		UUID requestId = UUID.randomUUID();
		if (baseline == null || inputs.weaknesses().isEmpty()) return new Recommendations(requestId, DRILL_STRATEGY, List.of());

		long played = inputs.playedSongId() == null ? -1 : inputs.playedSongId();
		var drills = DrillPlanner.plan(inputs.weaknesses(), drillCharts(), played, baseline, size);
		var summaries = songs.byIds(userId, drills.stream().map(d -> d.chart().songId()).toList());
		var bySong = new HashMap<Long, com.ssafy.airdrum.domain.song.dto.SongResponses.SongSummary>();
		for (var s : summaries) bySong.put(s.id(), s);

		Instant now = clock.instant();
		var items = new ArrayList<Item>();
		int rank = 0;
		for (var drill : drills) {
			var chart = drill.chart();
			var summary = bySong.get(chart.songId());
			if (summary == null) continue; // 조회 사이에 비공개·삭제된 곡
			rank++;
			items.add(new Item(summary, chart.chartId(), chart.difficulty(), List.of(new Reason(drill.reason(), drillText(drill))),
					new Focus(drill.pattern(), drill.pads())));
			logExposure(requestId, rank, userId, Context.DRILL.name(), DRILL_STRATEGY, chart.songId(), chart.chartId(), drill.score(), List.of(drill.reason()), null, now);
		}
		return new Recommendations(requestId, DRILL_STRATEGY, List.copyOf(items));
	}

	public static String drillText(DrillPlanner.Drill drill) {
		var pads = drill.pads().stream().map(p -> PAD_LABEL.getOrDefault(p, p)).toList();
		return switch (drill.reason()) {
			case DrillPlanner.TRANSITION -> pads.get(0) + "에서 " + toward(pads.get(1)) + " 넘어가는 동작이 많아 연습하기 좋아요";
			case DrillPlanner.PAD -> object(pads.getFirst()) + " 많이 치는 곡이에요";
			case DrillPlanner.MISS -> "노트가 적당해서 놓친 부분을 다시 잡기 좋아요";
			default -> "느긋한 곡으로 박을 일정하게 맞춰 봐요";
		};
	}

	/** 마지막 글자의 받침. 한글이 아니면 0이다. */
	private static int finalConsonant(String word) {
		char last = word.charAt(word.length() - 1);
		return last >= '가' && last <= '힣' ? (last - '가') % 28 : 0;
	}
	/** 을·를. */
	private static String object(String word) { return word + (finalConsonant(word) == 0 ? "를" : "을"); }
	/** 으로·로. ㄹ 받침(8)은 "로"다. */
	private static String toward(String word) {
		int consonant = finalConsonant(word);
		return word + (consonant == 0 || consonant == 8 ? "로" : "으로");
	}

	/** 추천 노출 한 줄을 기록한다. 비슷한 곡(R2)도 같은 테이블을 쓰며 그때만 {@code sourceSongId}가 있다. */
	public void logExposure(UUID requestId, int rank, long userId, String context, String strategy, long songId, long chartId,
			double score, List<String> reasonCodes, Long sourceSongId, Instant shownAt) {
		db.update("""
				INSERT INTO recommendation_items(request_id, rank, user_id, context, strategy, song_id, chart_id, score, reason_codes, shown_at, source_song_id)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?)
				""", requestId, rank, userId, context, strategy, songId, chartId, score, reasonJson(reasonCodes),
				java.sql.Timestamp.from(shownAt), sourceSongId);
	}

	/**
	 * 본인의 기준 밀도: 최근 1배속 RHYTHM·SHEET 연주 10판 중 정확도 85% 이상인 판의 채보 밀도 최댓값. 해당하는 판이 없으면 {@code null}.
	 * 추천(R1)의 난이도 점수와 비슷한 곡(R2)의 "너무 어려운 곡 거르기"가 같은 값을 쓴다.
	 */
	public Double baselineDensity(long userId) {
		return db.query("""
				SELECT MAX(f.avg_notes_per_sec) FROM (
				  SELECT p.chart_version_id, p.accuracy FROM play_sessions p
				  WHERE p.user_id = ? AND p.mode IN ('RHYTHM', 'SHEET') AND p.accuracy IS NOT NULL
				    AND COALESCE((p.judgement_context->>'playbackRate')::numeric, 1) = 1
				  ORDER BY p.ended_at DESC, p.id LIMIT ?) recent
				JOIN chart_features f ON f.chart_version_id = recent.chart_version_id
				WHERE recent.accuracy >= ?
				""", (ResultSetExtractor<Double>) rs -> {
					// MAX(numeric)는 numeric이라 getObject(Double.class)로 읽으면 PostgreSQL 드라이버가 변환하지 못한다.
					if (!rs.next()) return null;
					var value = rs.getBigDecimal(1);
					return value == null ? null : value.doubleValue();
				}, userId, RECENT_PLAYS, RecommendationScorer.TARGET_ACCURACY);
	}

	/** 같은 사용자의 추천 기록만 갱신한다. 이미 눌렀다면 처음 시각을 유지한다. */
	@Transactional
	public void click(long userId, UUID requestId, long songId) {
		int rows = db.update("UPDATE recommendation_items SET clicked_at = COALESCE(clicked_at, ?) WHERE request_id = ? AND user_id = ? AND song_id = ?",
				java.sql.Timestamp.from(clock.instant()), requestId, userId, songId);
		if (rows == 0) throw new BusinessException(RecommendationErrorCode.RECOMMENDATION_NOT_FOUND);
	}

	/** 보관 기간이 지난 기록을 지운다. 지운 개수를 돌려준다. */
	@Transactional
	public int deleteOlderThan(Instant cutoff) {
		return db.update("DELETE FROM recommendation_items WHERE shown_at < ?", java.sql.Timestamp.from(cutoff));
	}
	/** 탈퇴 시 노출 기록을 먼저 지우고 후보와 가명 키를 지운다. */
	public void deleteUserData(long userId) {
		db.update("DELETE FROM recommendation_items WHERE user_id = ?", userId);
		candidateSongs.deleteUserData(userId);
	}

	private String reasonJson(List<String> reasons) {
		try { return json.writeValueAsString(reasons); }
		catch (RuntimeException ex) { throw new IllegalStateException("추천 이유를 직렬화하지 못했습니다.", ex); }
	}

	/** 공개·READY·난이도 산정 완료인 공용 곡의 채보 최신 버전 중 특징이 계산된 것. */
	private List<Candidate> candidates() {
		return db.query("""
				SELECT s.id, c.id, c.difficulty, s.song_level, v.note_count, f.avg_notes_per_sec, CAST(f.pad_ratio AS text)
				FROM songs s JOIN charts c ON c.song_id = s.id
				JOIN chart_versions v ON v.id = (SELECT x.id FROM chart_versions x WHERE x.chart_id = c.id ORDER BY x.version DESC LIMIT 1)
				JOIN chart_features f ON f.chart_version_id = v.id AND f.feature_version = ?
				WHERE s.source = 'BUILTIN' AND s.owner_id IS NULL AND s.status = 'READY' AND s.published
				  AND s.deleted_at IS NULL AND s.song_level IS NOT NULL AND""" + com.ssafy.airdrum.domain.lesson.repository.LessonRepository.NOT_LESSON + """
				ORDER BY s.id, c.id
				""", (r, n) -> new Candidate(r.getLong(1), r.getLong(2), r.getString(3), r.getString(4), r.getInt(5), r.getDouble(6), numbers(r.getString(7))),
				ChartFeatureService.VERSION);
	}

	/** {@link #candidates()}와 같은 곡에 전환 비율을 더한 것. */
	private List<DrillPlanner.Chart> drillCharts() {
		return db.query("""
				SELECT s.id, c.id, c.difficulty, v.note_count, f.avg_notes_per_sec, CAST(f.pad_ratio AS text), CAST(f.transition_ratio AS text)
				FROM songs s JOIN charts c ON c.song_id = s.id
				JOIN chart_versions v ON v.id = (SELECT x.id FROM chart_versions x WHERE x.chart_id = c.id ORDER BY x.version DESC LIMIT 1)
				JOIN chart_features f ON f.chart_version_id = v.id AND f.feature_version = ?
				WHERE s.source = 'BUILTIN' AND s.owner_id IS NULL AND s.status = 'READY' AND s.published
				  AND s.deleted_at IS NULL AND s.song_level IS NOT NULL AND""" + com.ssafy.airdrum.domain.lesson.repository.LessonRepository.NOT_LESSON + """
				ORDER BY s.id, c.id
				""", (r, n) -> new DrillPlanner.Chart(r.getLong(1), r.getLong(2), r.getString(3), r.getInt(4), r.getDouble(5), numbers(r.getString(6)), numbers(r.getString(7))),
				ChartFeatureService.VERSION);
	}

	private Profile profile(long userId, UUID playId) {
		Double baseline = baselineDensity(userId);
		var lastPlayed = new HashMap<Long, Instant>();
		var bestByChart = new HashMap<Long, Double>();
		db.query("""
				SELECT p.song_id, c.id, MAX(p.accuracy) FILTER (WHERE COALESCE((p.judgement_context->>'playbackRate')::numeric, 1) = 1), MAX(p.ended_at)
				FROM play_sessions p JOIN chart_versions v ON v.id = p.chart_version_id JOIN charts c ON c.id = v.chart_id
				WHERE p.user_id = ? AND p.mode IN ('RHYTHM', 'SHEET') AND p.song_id IS NOT NULL
				GROUP BY p.song_id, c.id
				""", rs -> {
					lastPlayed.merge(rs.getLong(1), rs.getTimestamp(4).toInstant(), (a, b) -> a.isAfter(b) ? a : b);
					var accuracy = rs.getBigDecimal(3); // numeric(5,2)의 MAX. 위와 같은 이유로 BigDecimal로 읽는다
					if (accuracy != null) bestByChart.put(rs.getLong(2), accuracy.doubleValue());
				}, userId);
		return new Profile(baseline, weakPads(userId, playId), lastPlayed, bestByChart);
	}

	/**
	 * 최근 연주 리포트의 약점 중 패드가 있는 종류만 패드별 가중치(심각도)로 모은다. 지정한 연주는 그대로,
	 * 나머지는 오래될수록 줄인다. 분석이 끝나지 않았거나 실패한 리포트(weak_segments null)는 건너뛴다.
	 * 전환 약점은 pads의 순서가 방향인지 확인되지 않아 쓰지 않는다(설계 U6).
	 */
	private Map<String, Double> weakPads(long userId, UUID playId) {
		var weights = new HashMap<String, Double>();
		var rows = new ArrayList<String[]>(); // {playId, weakSegments}
		db.query("""
				SELECT p.id, CAST(r.weak_segments AS text) FROM play_sessions p JOIN reports r ON r.play_session_id = p.id
				WHERE p.user_id = ? AND p.mode IN ('RHYTHM', 'SHEET') AND r.weak_segments IS NOT NULL
				ORDER BY p.ended_at DESC, p.id LIMIT ?
				""", rs -> { rows.add(new String[] { rs.getString(1), rs.getString(2) }); }, userId, RECENT_REPORTS);
		double decay = 1.0;
		for (var row : rows) {
			boolean target = playId != null && playId.toString().equals(row[0]);
			double factor = playId == null ? decay : target ? 1.0 : 0.5 * decay;
			accumulate(weights, row[1], factor);
			decay *= 0.8;
		}
		if (playId != null && rows.stream().noneMatch(r -> playId.toString().equals(r[0]))) {
			var own = db.queryForList("SELECT CAST(weak_segments AS text) FROM reports WHERE play_session_id = ? AND weak_segments IS NOT NULL", String.class, playId);
			if (!own.isEmpty()) accumulate(weights, own.getFirst(), 1.0);
		}
		return weights;
	}

	private void accumulate(Map<String, Double> weights, String raw, double factor) {
		JsonNode array;
		try { array = json.readTree(raw); } catch (RuntimeException ex) { return; }
		if (array == null || !array.isArray()) return;
		for (var segment : array) {
			String pattern = segment.path("pattern").asString("");
			if (!pattern.equals("PAD_LATE") && !pattern.equals("PAD_EARLY") && !pattern.equals("MISS_CLUSTER")) continue;
			var pads = segment.path("pads");
			if (!pads.isArray() || pads.isEmpty()) continue;
			var severityNode = segment.path("metrics").path("severity");
			double severity = severityNode.isNumber() ? Math.max(0, Math.min(1, severityNode.doubleValue())) : 0.5;
			for (var pad : pads) {
				String name = pad.asString("");
				if (name.isBlank()) continue;
				if (name.equals("HI_TOM")) name = "SMALL_TOM"; // 옛 이름
				weights.merge(name, severity * factor, Math::max);
			}
		}
	}

	private Map<String, Double> numbers(String raw) {
		var result = new HashMap<String, Double>();
		try {
			if (json.readValue(raw, Map.class) instanceof Map<?, ?> map)
				for (var e : map.entrySet()) if (e.getValue() instanceof Number n) result.put(String.valueOf(e.getKey()), n.doubleValue());
		} catch (RuntimeException ex) { /* 특징이 망가진 채보는 패드 비율 없이 계산한다 */ }
		return result;
	}
}
