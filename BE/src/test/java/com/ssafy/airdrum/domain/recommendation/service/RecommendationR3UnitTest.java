package com.ssafy.airdrum.domain.recommendation.service;

import static org.assertj.core.api.Assertions.*;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import com.ssafy.airdrum.domain.recommendation.model.RecommendationR3Settings;
import com.ssafy.airdrum.domain.recommendation.service.RecommendationScorer.Candidate;
import com.ssafy.airdrum.domain.recommendation.service.RecommendationScorer.Profile;

/** R3 재정렬·설정의 순수 규칙. DB 없이 돈다. */
class RecommendationR3UnitTest {
	static final Instant NOW = Instant.parse("2026-11-05T00:00:00Z");
	static final Profile PROFILE = new Profile(4.0, Map.of(), Map.of(), Map.of());

	static Candidate song(long id, double density) { return new Candidate(id, id * 10, "HARD", "BEGINNER", 100, density, Map.of()); }
	static List<Long> ids(List<RecommendationScorer.Scored> list) { return list.stream().map(s -> s.candidate().songId()).toList(); }
	static RecommendationR3Settings settings(int percent) { return new RecommendationR3Settings(true, percent, 7, 0.75, "a, b ,"); }

	@Test void hardLimitRemovesSongsWhateverTheirRank() {
		var all = List.of(song(1, 7.0), song(2, 4.0));
		assertThat(ids(RecommendationScorer.blend(all, PROFILE, NOW, 5, List.of(1L, 2L), 1.0))).containsExactly(2L);
	}

	@Test void weightOneKeepsCandidateOrderAndWeightZeroUsesRuleScore() {
		var all = List.of(song(1, 2.0), song(2, 4.6)); // 2번이 규칙 점수가 높다(도전 구간)
		var order = List.of(1L, 2L);
		assertThat(ids(RecommendationScorer.blend(all, PROFILE, NOW, 5, order, 1.0))).containsExactly(1L, 2L);
		assertThat(ids(RecommendationScorer.blend(all, PROFILE, NOW, 5, order, 0.0))).containsExactly(2L, 1L);
	}

	@Test void formulaMatchesThePocAndSongsOutsideThePoolAreIgnored() {
		var scored = RecommendationScorer.blend(List.of(song(1, 4.6)), PROFILE, NOW, 5, List.of(9L, 1L), 0.75);
		// 순위 2개 중 꼴찌라 순위 점수 0이고, R1 점수만 0.25배로 남는다
		var rule = RecommendationScorer.rank(List.of(song(1, 4.6)), PROFILE, NOW, 1).getFirst().total();
		assertThat(scored.getFirst().total()).isCloseTo(0.25 * rule, within(0.0001));
	}

	@Test void noBaselineOrNoCandidatesGivesNothing() {
		var noBase = new Profile(null, Map.of(), Map.of(), Map.of());
		assertThat(RecommendationScorer.blend(List.of(song(1, 4.0)), noBase, NOW, 5, List.of(1L), 0.75)).isEmpty();
		assertThat(RecommendationScorer.blend(List.of(song(1, 4.0)), PROFILE, NOW, 5, List.of(), 0.75)).isEmpty();
	}

	@Test void fillAddsRuleSongsWithoutDuplicatesUpToSize() {
		var all = List.of(song(1, 4.0), song(2, 4.4), song(3, 4.6));
		var picked = RecommendationScorer.blend(all, PROFILE, NOW, 3, List.of(1L), 0.75);
		var filled = RecommendationScorer.fill(picked, all, PROFILE, NOW, 2);
		assertThat(ids(filled)).hasSize(2).startsWith(1L).doesNotHaveDuplicates();
	}

	@Test void rolloutIsStableAndGrowsWithThePercent() {
		assertThat(settings(0).inRollout(1)).isFalse();
		assertThat(settings(100).inRollout(1)).isTrue();
		int in10 = 0, in50 = 0;
		for (long id = 1; id <= 2000; id++) {
			if (settings(10).inRollout(id)) { in10++; assertThat(settings(50).inRollout(id)).isTrue(); }
			if (settings(50).inRollout(id)) in50++;
		}
		assertThat(in10).isBetween(140, 260);
		assertThat(in50).isBetween(900, 1100);
	}

	@Test void acceptedVersionsAreTrimmedAndEmptyMeansNone() {
		assertThat(settings(0).accepts("b")).isTrue();
		assertThat(settings(0).accepts("c")).isFalse();
		assertThat(new RecommendationR3Settings(false, 0, 7, 0.75, "").accepts("")).isFalse();
	}

	@Test void badSettingsFailAtStartup() {
		assertThatThrownBy(() -> new RecommendationR3Settings(true, 101, 7, 0.75, "")).isInstanceOf(IllegalStateException.class);
		assertThatThrownBy(() -> new RecommendationR3Settings(true, 0, 0, 0.75, "")).isInstanceOf(IllegalStateException.class);
		assertThatThrownBy(() -> new RecommendationR3Settings(true, 0, 7, 1.5, "")).isInstanceOf(IllegalStateException.class);
	}

	@Test void secretDoesNotAppearInToString() {
		assertThat(settings(0).toString()).doesNotContain("secret");
	}
}
