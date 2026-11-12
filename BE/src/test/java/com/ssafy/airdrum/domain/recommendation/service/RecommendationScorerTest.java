package com.ssafy.airdrum.domain.recommendation.service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
import com.ssafy.airdrum.domain.recommendation.service.RecommendationScorer.*;

class RecommendationScorerTest {
	static final Instant NOW = Instant.parse("2026-11-05T00:00:00Z");

	private static Candidate chart(long song, long chart, String difficulty, String level, int notes, double density, Map<String, Double> pads) {
		return new Candidate(song, chart, difficulty, level, notes, density, pads);
	}
	private static Candidate chart(long song, double density) { return chart(song, song * 10, "NORMAL", "INTERMEDIATE", (int) (density * 100), density, Map.of("SNARE", 1.0)); }
	private static Profile profile(Double base, Map<String, Double> weak, Map<Long, Instant> last, Map<Long, Double> best) { return new Profile(base, weak, last, best); }
	private static Profile plain(double base) { return profile(base, Map.of(), Map.of(), Map.of()); }

	@Test void 기록이_없으면_BEGINNER_곡의_가장_쉬운_채보를_STARTER로_추천한다() {
		var list = List.of(
				chart(1, 10, "EASY", "BEGINNER", 100, 2.0, Map.of("SNARE", 1.0)),
				chart(1, 11, "HARD", "BEGINNER", 300, 4.0, Map.of("SNARE", 1.0)),
				chart(2, 20, "NORMAL", "ADVANCED", 600, 7.0, Map.of("SNARE", 1.0)),
				chart(3, 30, "NORMAL", "BEGINNER", 150, 1.5, Map.of("SNARE", 1.0)));
		var ranked = RecommendationScorer.rank(list, profile(null, Map.of(), Map.of(), Map.of()), NOW, 5);
		assertThat(ranked).extracting(s -> s.candidate().chartId()).containsExactly(30L, 10L);
		assertThat(ranked).allSatisfy(s -> assertThat(s.reasons()).containsExactly("STARTER"));
	}

	@Test void 기준_밀도의_1점5배를_넘는_채보는_점수와_무관하게_제외한다() {
		var list = List.of(chart(1, 6.0), chart(2, 4.6), chart(3, 4.5));
		// 기준 3.0 → 한도 4.5. 4.5는 한도 이하라 남고 4.6과 6.0은 제외
		var ranked = RecommendationScorer.rank(list, plain(3.0), NOW, 5);
		assertThat(ranked).extracting(s -> s.candidate().songId()).containsExactly(3L);
	}

	@Test void 곡당_하나만_나오고_점수가_더_높은_채보를_고른다() {
		var list = List.of(
				chart(1, 10, "EASY", "INTERMEDIATE", 100, 1.0, Map.of("SNARE", 1.0)),
				chart(1, 11, "NORMAL", "INTERMEDIATE", 200, 3.3, Map.of("SNARE", 1.0)),
				chart(1, 12, "HARD", "INTERMEDIATE", 300, 4.0, Map.of("SNARE", 1.0)));
		var ranked = RecommendationScorer.rank(list, plain(3.0), NOW, 5);
		assertThat(ranked).hasSize(1);
		assertThat(ranked.getFirst().candidate().chartId()).isEqualTo(11L); // 3.3/3.0=1.1 최고점
	}

	@Test void NORMAL과_노트_수가_같은_EASY는_같은_채보로_보고_제외한다() {
		var list = List.of(
				chart(1, 10, "EASY", "INTERMEDIATE", 200, 3.3, Map.of("SNARE", 1.0)),
				chart(1, 11, "NORMAL", "INTERMEDIATE", 200, 3.3, Map.of("SNARE", 1.0)));
		var ranked = RecommendationScorer.rank(list, plain(3.0), NOW, 5);
		assertThat(ranked).extracting(s -> s.candidate().chartId()).containsExactly(11L);
	}

	@Test void 약점_패드_비율이_높은_채보의_점수가_올라간다() {
		var snare = chart(1, 10, "NORMAL", "INTERMEDIATE", 330, 3.3, Map.of("SNARE", 0.8, "KICK", 0.2));
		var kick = chart(2, 20, "NORMAL", "INTERMEDIATE", 330, 3.3, Map.of("SNARE", 0.1, "KICK", 0.9));
		var withWeak = RecommendationScorer.rank(List.of(snare, kick), profile(3.0, Map.of("SNARE", 0.9), Map.of(), Map.of()), NOW, 5);
		assertThat(withWeak.getFirst().candidate().songId()).isEqualTo(1L);
		assertThat(withWeak.getFirst().reasons()).contains("WEAK_PAD");
		var without = RecommendationScorer.rank(List.of(snare, kick), plain(3.0), NOW, 5);
		assertThat(withWeak.getFirst().total()).isGreaterThan(without.stream().filter(s -> s.candidate().songId() == 1L).findFirst().get().total());
	}

	@Test void 안_친_곡은_새로움_점수를_받고_최근_친_곡은_받지_않는다() {
		var a = chart(1, 3.3);
		var b = chart(2, 3.3);
		var ranked = RecommendationScorer.rank(List.of(a, b), profile(3.0, Map.of(), Map.of(2L, NOW.minusSeconds(3600)), Map.of()), NOW, 5);
		assertThat(ranked.getFirst().candidate().songId()).isEqualTo(1L);
		assertThat(ranked.getFirst().reasons()).contains("NEW_SONG");
		assertThat(ranked.get(1).reasons()).doesNotContain("NEW_SONG");
	}

	@Test void 목표_정확도_바로_아래로_친_채보는_재도전_이유를_받는다() {
		var a = chart(1, 3.3);
		var ranked = RecommendationScorer.rank(List.of(a), profile(3.0, Map.of(), Map.of(1L, NOW.minusSeconds(3600)), Map.of(10L, 80.0)), NOW, 5);
		assertThat(ranked.getFirst().reasons()).contains("RETRY");
		var done = RecommendationScorer.rank(List.of(a), profile(3.0, Map.of(), Map.of(1L, NOW.minusSeconds(3600)), Map.of(10L, 90.0)), NOW, 5);
		assertThat(done.getFirst().reasons()).doesNotContain("RETRY");
	}

	@Test void 어떤_이유도_넘지_못해도_이유가_하나_이상_있다() {
		// 비율 0.8 → 도전 점수 0.5, 최근 친 곡이라 새로움 0, 약점·재도전 없음
		var ranked = RecommendationScorer.rank(List.of(chart(1, 2.4)), profile(3.0, Map.of(), Map.of(1L, NOW.minusSeconds(60)), Map.of()), NOW, 5);
		assertThat(ranked.getFirst().reasons()).containsExactly("CHALLENGE");
	}

	@Test void 도전_점수는_구간_안에서_최고이고_벗어날수록_줄어든다() {
		assertThat(RecommendationScorer.challenge(1.10)).isEqualTo(1.0);
		assertThat(RecommendationScorer.challenge(1.25)).isEqualTo(1.0);
		assertThat(RecommendationScorer.challenge(0.5)).isEqualTo(0.0);
		assertThat(RecommendationScorer.challenge(1.5)).isEqualTo(0.0);
		assertThat(RecommendationScorer.challenge(0.8)).isBetween(0.0, 1.0);
		assertThat(RecommendationScorer.challenge(1.0)).isGreaterThan(RecommendationScorer.challenge(0.8));
	}

	@Test void 같은_대표_이유는_전체의_절반_이하이고_모자라면_남는_자리를_채운다() {
		var list = new ArrayList<Candidate>();
		for (int i = 1; i <= 6; i++) list.add(chart(i, 3.3)); // 모두 안 친 곡 + 도전 구간
		var ranked = RecommendationScorer.rank(list, plain(3.0), NOW, 4);
		assertThat(ranked).hasSize(4); // 후보가 한 종류뿐이어도 자리를 채운다
	}

	@Test void 이유_종류가_다른_후보가_있으면_같은_대표_이유는_절반을_넘지_않는다() {
		var list = new ArrayList<Candidate>();
		// 도전 구간(비율 1.1)의 KICK 곡 4개: 점수 0.6, 대표 이유 CHALLENGE
		for (int i = 1; i <= 4; i++) list.add(chart(i, i * 10, "NORMAL", "INTERMEDIATE", 330, 3.3, Map.of("KICK", 1.0)));
		// 도전 점수는 0이지만 약점 SNARE 100%인 곡 2개: 점수 0.45, 대표 이유 WEAK_PAD
		for (int i = 5; i <= 6; i++) list.add(chart(i, i * 10, "NORMAL", "INTERMEDIATE", 150, 1.5, Map.of("SNARE", 1.0)));
		var ranked = RecommendationScorer.rank(list, profile(3.0, Map.of("SNARE", 1.0), Map.of(), Map.of()), NOW, 4);
		assertThat(ranked).hasSize(4);
		assertThat(ranked.stream().filter(s -> s.primary().equals("CHALLENGE")).count()).isEqualTo(2);
		assertThat(ranked.stream().filter(s -> s.primary().equals("WEAK_PAD")).count()).isEqualTo(2);
	}

	@Test void 같은_입력은_후보_순서와_무관하게_같은_결과를_준다() {
		var list = new ArrayList<Candidate>();
		for (int i = 1; i <= 8; i++) list.add(chart(i, 2.0 + i * 0.3));
		var profile = profile(3.0, Map.of("SNARE", 0.5), Map.of(2L, NOW.minusSeconds(60)), Map.of(30L, 75.0));
		var first = RecommendationScorer.rank(list, profile, NOW, 5);
		var reversed = new ArrayList<>(list);
		java.util.Collections.reverse(reversed);
		assertThat(RecommendationScorer.rank(reversed, profile, NOW, 5)).isEqualTo(first);
		assertThat(RecommendationScorer.rank(list, profile, NOW, 5)).isEqualTo(first);
	}

	@Test void 후보가_없으면_빈_목록() {
		assertThat(RecommendationScorer.rank(List.of(), plain(3.0), NOW, 5)).isEmpty();
		assertThat(RecommendationScorer.rank(List.of(), profile(null, Map.of(), Map.of(), Map.of()), NOW, 5)).isEmpty();
	}
}
