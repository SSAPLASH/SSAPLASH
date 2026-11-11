package com.ssafy.airdrum.domain.recommendation.service.similar;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;
import com.ssafy.airdrum.domain.recommendation.model.ChartVector;
import com.ssafy.airdrum.domain.chart.exception.ChartErrorCode;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.global.error.CommonErrorCode;
import com.ssafy.airdrum.domain.user.service.profile.UserQueryService;
import com.ssafy.airdrum.domain.song.service.catalog.SongQueryService;
import com.ssafy.airdrum.domain.song.dto.SongResponses.SongSummary;
import com.ssafy.airdrum.domain.chart.service.feature.ChartFeatureService;
import com.ssafy.airdrum.domain.song.model.SongMetadata;
import com.ssafy.airdrum.domain.recommendation.service.RecommendationService;
import com.ssafy.airdrum.domain.recommendation.dto.SimilarResponses.Item;
import com.ssafy.airdrum.domain.recommendation.dto.SimilarResponses.Similar;

/**
 * R2 비슷한 곡(설계 문서 부록 A). 기준 곡의 채보와 공용 곡의 채보를 {@link SimilarityEngine}으로 비교해 곡당 채보 하나를 돌려준다.
 * AI 서버를 부르지 않는다. 유사도 계산에는 사용자 기록을 쓰지 않고, 본인 기준 밀도는 너무 어려운 채보를 거르는 데만 쓴다.
 */
@Service
public class SimilarSongsService {
	public static final String STRATEGY = "SIMILAR_V1", CONTEXT = "SIMILAR";
	private static final Logger log = LoggerFactory.getLogger(SimilarSongsService.class);
	private static final String LATEST_VERSION = "JOIN chart_versions v ON v.id = (SELECT x.id FROM chart_versions x WHERE x.chart_id = c.id ORDER BY x.version DESC LIMIT 1)";
	private static final String SELECT = """
			SELECT s.id, c.id, c.difficulty, v.note_count, f.avg_notes_per_sec, CAST(f.pad_ratio AS text), CAST(f.transition_ratio AS text), s.bpm, s.time_signature
			FROM songs s JOIN charts c ON c.song_id = s.id
			""" + LATEST_VERSION + """

			JOIN chart_features f ON f.chart_version_id = v.id AND f.feature_version = ?
			WHERE s.deleted_at IS NULL
			""";

	private record Cached(List<ChartVector> vectors, Instant loadedAt) {}

	private final JdbcTemplate db;
	private final SongQueryService songs;
	private final UserQueryService users;
	private final RecommendationService recommendations;
	private final JsonMapper json;
	private final Clock clock;
	private final long cacheSeconds;
	private final AtomicReference<Cached> cache = new AtomicReference<>();

	public SimilarSongsService(JdbcTemplate db, SongQueryService songs, UserQueryService users, RecommendationService recommendations,
			JsonMapper json, Clock clock, @Value("${similar.cache-ttl-seconds:300}") long cacheSeconds) {
		this.db = db; this.songs = songs; this.users = users; this.recommendations = recommendations;
		this.json = json; this.clock = clock; this.cacheSeconds = Math.max(0, cacheSeconds);
	}

	@Transactional
	public Similar similar(long userId, long songId, String difficulty, int size) {
		if (!users.isActive(userId)) throw new BusinessException(CommonErrorCode.UNAUTHORIZED);
		requireVisibleSource(userId, songId);
		Instant now = clock.instant();
		UUID requestId = UUID.randomUUID();
		var sourceCharts = withMeta(db.query(SELECT + " AND s.id = ? ORDER BY c.id", this::vector, ChartFeatureService.VERSION, songId)
				.stream().filter(v -> v != null).toList());
		// 채보 특징이 아직 없는 곡은 비교할 수 없다. 오류가 아니라 빈 결과다.
		if (sourceCharts.isEmpty()) return new Similar(requestId, STRATEGY, List.of());

		var source = SimilarityEngine.chooseSource(sourceCharts, difficulty);
		var matches = SimilarityEngine.rank(source, candidates(now), recommendations.baselineDensity(userId), size);
		var summaries = songs.byIds(userId, matches.stream().map(m -> m.chart().songId()).toList());
		var bySong = new HashMap<Long, SongSummary>();
		for (var summary : summaries) bySong.put(summary.id(), summary);

		var items = new ArrayList<Item>();
		int rank = 0;
		for (var match : matches) {
			var summary = bySong.get(match.chart().songId());
			if (summary == null) continue; // 캐시 갱신 사이에 비공개·삭제된 곡
			rank++;
			items.add(new Item(summary, match.chart().chartId(), match.chart().difficulty(), match.similarity(), match.matchedOn()));
			recommendations.logExposure(requestId, rank, userId, CONTEXT, STRATEGY, match.chart().songId(), match.chart().chartId(),
					match.similarity(), match.matchedOn(), songId, now);
		}
		return new Similar(requestId, STRATEGY, List.copyOf(items));
	}

	/** 기준 곡은 공개된 공용 곡이거나 본인 곡이어야 한다. 타인의 개인 곡과 없는 곡은 같은 404다. */
	private void requireVisibleSource(long userId, long songId) {
		boolean visible = Boolean.TRUE.equals(db.queryForObject("""
				SELECT EXISTS(SELECT 1 FROM songs s WHERE s.id = ? AND s.deleted_at IS NULL
				  AND ((s.source = 'BUILTIN' AND s.owner_id IS NULL AND s.status = 'READY' AND s.published) OR s.owner_id = ?))
				""", Boolean.class, songId, userId));
		if (!visible) throw new BusinessException(ChartErrorCode.SONG_NOT_FOUND);
	}

	/** 공개·READY·곡 난이도 산정 완료인 공용 곡의 채보 중 특징이 있는 것. 사용자와 무관하므로 잠시 캐시한다. */
	private List<ChartVector> candidates(Instant now) {
		var cached = cache.get();
		if (cacheSeconds > 0 && cached != null && now.isBefore(cached.loadedAt().plusSeconds(cacheSeconds))) return cached.vectors();
		var loaded = db.query(SELECT + """
				 AND s.source = 'BUILTIN' AND s.owner_id IS NULL AND s.status = 'READY' AND s.published AND s.song_level IS NOT NULL
				 AND""" + com.ssafy.airdrum.domain.lesson.repository.LessonRepository.NOT_LESSON + """
				ORDER BY s.id, c.id
				""", this::vector, ChartFeatureService.VERSION).stream().filter(v -> v != null).toList();
		loaded = withMeta(loaded);
		if (cacheSeconds > 0) cache.set(new Cached(loaded, now));
		return loaded;
	}

	/**
	 * 곡 메타데이터(255번)를 채운다. 없는 곡은 null로 두어 엔진이 채보 유사도만 쓴다. 장르는 대표+보조 장르를 합친다(인웅님 합의 11/06).
	 * 후보 목록은 캐시되므로 메타데이터 변경은 캐시가 만료된 뒤(기본 300초) 반영된다.
	 */
	private List<ChartVector> withMeta(List<ChartVector> vectors) {
		if (vectors.isEmpty()) return vectors;
		var bySong = songs.metadataByIds(vectors.stream().map(ChartVector::songId).distinct().toList());
		if (bySong.isEmpty()) return vectors;
		return vectors.stream().map(v -> {
			SongMetadata m = bySong.get(v.songId());
			return m == null ? v : v.withMeta(new ChartVector.SongMeta(m.genresWithSub(), Set.copyOf(m.mood()), Set.copyOf(m.drumStyle()), m.energy()));
		}).toList();
	}

	/** 읽은 JSON이 망가졌으면 그 채보만 건너뛴다. */
	private ChartVector vector(ResultSet rs, int row) throws SQLException {
		try {
			return new ChartVector(rs.getLong(1), rs.getLong(2), rs.getString(3), rs.getInt(4), rs.getDouble(5), rs.getDouble(8),
					rs.getString(9), numbers(rs.getString(6)), numbers(rs.getString(7)), null);
		} catch (RuntimeException ex) {
			log.warn("비슷한 곡 입력 채보 건너뜀 songId={} chartId={} errorType={}", rs.getLong(1), rs.getLong(2), ex.getClass().getSimpleName());
			return null;
		}
	}

	private Map<String, Double> numbers(String raw) {
		var result = new HashMap<String, Double>();
		if (json.readValue(raw, Map.class) instanceof Map<?, ?> map)
			for (var e : map.entrySet()) if (e.getValue() instanceof Number n) result.put(String.valueOf(e.getKey()), n.doubleValue());
		return result;
	}
}
