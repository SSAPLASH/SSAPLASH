package com.ssafy.airdrum.domain.recommendation.service.drill;

import static org.assertj.core.api.Assertions.*;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import com.ssafy.airdrum.domain.recommendation.service.RecommendationService;
import com.ssafy.airdrum.domain.recommendation.service.drill.DrillPlanner.Chart;
import com.ssafy.airdrum.domain.recommendation.service.drill.DrillPlanner.Drill;
import com.ssafy.airdrum.domain.recommendation.service.drill.DrillPlanner.Weakness;

/** 약점별 연습 곡 선택 규칙. DB 없이 돈다. */
class DrillPlannerTest {
	static final double BASE = 4.0;
	static final long PLAYED = 99;

	static Chart chart(long song, double density, Map<String, Double> pads, Map<String, Double> transitions) {
		return new Chart(song, song * 10, "NORMAL", 100, density, pads, transitions);
	}
	static Chart plain(long song, double density) { return chart(song, density, Map.of("SNARE", 0.5), Map.of()); }
	static Weakness weak(String pattern, double severity, String... pads) { return new Weakness(pattern, List.of(pads), severity); }
	static List<Long> songs(List<Drill> drills) { return drills.stream().map(d -> d.chart().songId()).toList(); }
	static List<Drill> plan(List<Weakness> weaknesses, List<Chart> charts) { return DrillPlanner.plan(weaknesses, charts, PLAYED, BASE, 3); }

	@Test void 전환_약점은_그_방향의_전환이_있는_곡만_고르고_많은_곡이_먼저다() {
		var few = chart(1, 3.2, Map.of(), Map.of("HIHAT>SNARE", 0.1));
		var many = chart(2, 3.2, Map.of(), Map.of("HIHAT>SNARE", 0.4));
		var reversed = chart(3, 3.2, Map.of(), Map.of("SNARE>HIHAT", 0.9));
		var result = plan(List.of(weak("TRANSITION_LATE", 0.8, "HIHAT", "SNARE")), List.of(few, many, reversed));
		assertThat(songs(result)).containsExactly(2L);
		assertThat(result.getFirst().reason()).isEqualTo(DrillPlanner.TRANSITION);
		assertThat(result.getFirst().pattern()).isEqualTo("TRANSITION_LATE");
		assertThat(result.getFirst().pads()).containsExactly("HIHAT", "SNARE");
	}

	@Test void 맞는_전환이_없으면_약점을_건너뛴다() {
		assertThat(plan(List.of(weak("TRANSITION_MISS", 0.8, "KICK", "SNARE")), List.of(plain(1, 3.2)))).isEmpty();
	}

	@Test void 패드가_하나뿐인_전환_약점은_건너뛴다() {
		assertThat(plan(List.of(weak("TRANSITION_LATE", 0.8, "SNARE")), List.of(plain(1, 3.2)))).isEmpty();
	}

	@Test void 패드_약점은_그_패드를_치지_않는_곡을_빼고_비율이_높은_곡이_먼저다() {
		var none = chart(1, 3.2, Map.of("KICK", 1.0), Map.of());
		var low = chart(2, 3.2, Map.of("SNARE", 0.1), Map.of());
		var high = chart(3, 3.2, Map.of("SNARE", 0.6), Map.of());
		var result = plan(List.of(weak("PAD_LATE", 0.8, "SNARE")), List.of(none, low, high));
		assertThat(songs(result)).containsExactly(3L);
		assertThat(result.getFirst().reason()).isEqualTo(DrillPlanner.PAD);
	}

	@Test void 옛_패드_이름도_찾는다() {
		var tom = chart(1, 3.2, Map.of("SMALL_TOM", 0.5), Map.of());
		assertThat(songs(plan(List.of(weak("PAD_EARLY", 0.8, "HI_TOM")), List.of(tom)))).containsExactly(1L);
	}

	@Test void 놓침_약점은_놓친_패드가_많은_곡을_고른다() {
		var other = chart(1, 2.8, Map.of("KICK", 0.9), Map.of());
		var match = chart(2, 2.8, Map.of("SNARE", 0.4, "HIHAT", 0.4), Map.of());
		var result = plan(List.of(weak("MISS_CLUSTER", 0.8, "SNARE", "HIHAT")), List.of(other, match));
		assertThat(songs(result)).containsExactly(2L);
		assertThat(result.getFirst().reason()).isEqualTo(DrillPlanner.MISS);
	}

	@Test void 패드가_없는_놓침_약점은_밀도가_낮은_곡을_고른다() {
		assertThat(songs(plan(List.of(weak("MISS_CLUSTER", 0.8)), List.of(plain(1, 3.4), plain(2, 2.4))))).containsExactly(2L);
	}

	@Test void 타이밍과_불안정_약점은_밀도가_낮은_곡을_고른다() {
		var charts = List.of(plain(1, 3.8), plain(2, 2.4));
		for (var pattern : List.of("TIMING_LATE", "TIMING_EARLY", "UNSTEADY")) {
			var result = plan(List.of(weak(pattern, 0.8)), charts);
			assertThat(songs(result)).as(pattern).containsExactly(2L);
			assertThat(result.getFirst().reason()).isEqualTo(DrillPlanner.TIMING);
		}
	}

	@Test void 손_약점과_모르는_약점은_건너뛴다() {
		var charts = List.of(plain(1, 3.2));
		assertThat(plan(List.of(weak("HAND_WEAK", 0.9), weak("NEW_PATTERN", 0.9)), charts)).isEmpty();
	}

	@Test void 기준_밀도의_1점25배를_넘는_곡은_맞아도_빠진다() {
		var limit = chart(1, BASE * 1.25, Map.of("SNARE", 0.1), Map.of());
		var over = chart(2, BASE * 1.26, Map.of("SNARE", 0.9), Map.of());
		assertThat(songs(plan(List.of(weak("PAD_LATE", 0.8, "SNARE")), List.of(limit, over)))).containsExactly(1L);
	}

	@Test void 방금_친_곡은_빠진다() {
		assertThat(plan(List.of(weak("PAD_LATE", 0.8, "SNARE")), List.of(plain(PLAYED, 3.2)))).isEmpty();
	}

	@Test void 심한_약점부터_종류마다_곡_하나씩_중복_없이_고른다() {
		var pads = chart(1, 3.2, Map.of("SNARE", 0.5), Map.of("HIHAT>SNARE", 0.2));
		var both = chart(2, 3.2, Map.of("SNARE", 0.6), Map.of("HIHAT>SNARE", 0.5));
		var result = plan(List.of(weak("PAD_LATE", 0.4, "SNARE"), weak("TRANSITION_LATE", 0.9, "HIHAT", "SNARE")), List.of(pads, both));
		assertThat(result).extracting(Drill::reason).containsExactly(DrillPlanner.TRANSITION, DrillPlanner.PAD);
		assertThat(songs(result)).containsExactly(2L, 1L);
	}

	@Test void 같은_종류의_약점은_한_번만_쓴다() {
		var charts = List.of(chart(1, 3.2, Map.of("SNARE", 0.5, "KICK", 0.5), Map.of()), chart(2, 3.2, Map.of("SNARE", 0.5, "KICK", 0.5), Map.of()));
		var result = plan(List.of(weak("PAD_LATE", 0.9, "SNARE"), weak("PAD_EARLY", 0.8, "KICK")), charts);
		assertThat(result).hasSize(1);
		assertThat(result.getFirst().pattern()).isEqualTo("PAD_LATE");
	}

	@Test void 곡은_최대_3개다() {
		var charts = new ArrayList<Chart>();
		for (long song = 1; song <= 6; song++) charts.add(chart(song, 3.0, Map.of("SNARE", 0.5, "KICK", 0.5), Map.of("HIHAT>SNARE", 0.3)));
		var weaknesses = List.of(weak("PAD_LATE", 0.9, "SNARE"), weak("TRANSITION_LATE", 0.8, "HIHAT", "SNARE"), weak("MISS_CLUSTER", 0.7, "KICK"), weak("UNSTEADY", 0.6));
		assertThat(DrillPlanner.plan(weaknesses, charts, PLAYED, BASE, 10)).hasSize(3);
		assertThat(DrillPlanner.plan(weaknesses, charts, PLAYED, BASE, 2)).hasSize(2);
	}

	@Test void 곡당_채보_하나이고_밀도가_범위에_맞는_채보를_고른다() {
		var easy = new Chart(1, 10, "EASY", 50, 1.0, Map.of("SNARE", 0.5), Map.of());
		var normal = new Chart(1, 11, "NORMAL", 100, 3.2, Map.of("SNARE", 0.5), Map.of());
		var result = plan(List.of(weak("PAD_LATE", 0.8, "SNARE")), List.of(easy, normal));
		assertThat(result).hasSize(1);
		assertThat(result.getFirst().chart().chartId()).isEqualTo(11L);
	}

	@Test void NORMAL과_노트_수가_같은_EASY는_같은_채보로_보고_뺀다() {
		var easy = new Chart(1, 10, "EASY", 100, 3.2, Map.of("SNARE", 0.5), Map.of());
		var normal = new Chart(1, 11, "NORMAL", 100, 3.2, Map.of("SNARE", 0.5), Map.of());
		assertThat(plan(List.of(weak("PAD_LATE", 0.8, "SNARE")), List.of(easy, normal)).getFirst().chart().chartId()).isEqualTo(11L);
	}

	@Test void 같은_입력이면_후보_순서와_무관하게_같은_결과다() {
		var charts = new ArrayList<>(List.of(plain(1, 3.0), plain(2, 3.0), plain(3, 3.0)));
		var weaknesses = List.of(weak("PAD_LATE", 0.8, "SNARE"));
		var first = plan(weaknesses, charts);
		assertThat(songs(first)).containsExactly(1L); // 점수가 같으면 곡 id 순
		Collections.reverse(charts);
		assertThat(plan(weaknesses, charts)).isEqualTo(first);
	}

	@Test void 약점이_없거나_후보가_없거나_기준이_없으면_빈_목록이다() {
		var weaknesses = List.of(weak("PAD_LATE", 0.8, "SNARE"));
		assertThat(plan(List.of(), List.of(plain(1, 3.2)))).isEmpty();
		assertThat(plan(weaknesses, List.of())).isEmpty();
		assertThat(DrillPlanner.plan(weaknesses, List.of(plain(1, 3.2)), PLAYED, 0, 3)).isEmpty();
	}

	@Test void pads가_null이어도_던지지_않는다() {
		assertThat(plan(List.of(new Weakness("PAD_LATE", null, 0.8)), List.of(plain(1, 3.2)))).isEmpty();
		assertThat(plan(List.of(new Weakness("UNSTEADY", null, 0.8)), List.of(plain(1, 3.2)))).hasSize(1);
	}

	@Test void 밀도_적합도는_범위_안이_1이고_벗어날수록_줄어든다() {
		assertThat(DrillPlanner.densityFit(0.8, 0.6, 1.0)).isEqualTo(1.0);
		assertThat(DrillPlanner.densityFit(0.3, 0.6, 1.0)).isCloseTo(0.5, within(1e-9));
		assertThat(DrillPlanner.densityFit(1.125, 0.6, 1.0)).isCloseTo(0.5, within(1e-9));
		assertThat(DrillPlanner.densityFit(1.25, 0.6, 1.0)).isCloseTo(0.0, within(1e-9));
	}

	@Test void 순위는_값이_같으면_같고_낮을수록_좋은_경우를_뒤집는다() {
		var values = List.of(1.0, 2.0, 2.0, 4.0);
		assertThat(DrillPlanner.percentile(4.0, values, false)).isEqualTo(1.0);
		assertThat(DrillPlanner.percentile(2.0, values, false)).isEqualTo(0.75);
		assertThat(DrillPlanner.percentile(1.0, values, true)).isEqualTo(1.0);
	}

	private static String text(String reason, String... pads) {
		return RecommendationService.drillText(new Drill(plain(1, 3.0), "X", List.of(pads), reason, 0));
	}

	@Test void 문구의_조사가_받침에_맞는다() {
		assertThat(text(DrillPlanner.TRANSITION, "SNARE", "KICK")).startsWith("스네어에서 킥으로 ");
		assertThat(text(DrillPlanner.TRANSITION, "KICK", "SNARE")).startsWith("킥에서 스네어로 ");
		assertThat(text(DrillPlanner.TRANSITION, "KICK", "HIHAT_PEDAL")).startsWith("킥에서 하이햇 페달로 ");
		assertThat(text(DrillPlanner.PAD, "HIHAT")).startsWith("하이햇을 ");
		assertThat(text(DrillPlanner.PAD, "SNARE")).startsWith("스네어를 ");
		assertThat(text(DrillPlanner.PAD, "NEW_PAD")).startsWith("NEW_PAD를 ");
	}
}
