package com.ssafy.airdrum.domain.recommendation.service.drill;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.ToDoubleFunction;

/**
 * 약점에 맞는 연습 곡을 고른다(설계 문서 COACH-004-연습추천-설계). DB·시간·난수에 의존하지 않아 같은 입력이면 항상 같은 결과다.
 * R1이 조금 어려운 곡을 권하는 것과 달리, 연습은 그 동작에 집중하도록 평소보다 쉬운 곡을 좋게 본다.
 * 모든 수치는 가정값이며 노출·클릭 기록으로 보정한다.
 */
public final class DrillPlanner {
	static final double W_MATCH = 0.6, W_FIT = 0.4;
	/** 기준 밀도의 이 배수를 넘는 채보는 점수와 무관하게 뺀다. R1의 1.5배보다 엄격하다. */
	static final double HARD_LIMIT = 1.25;
	static final int MAX_DRILLS = 3;

	public static final String PAD = "DRILL_PAD", TRANSITION = "DRILL_TRANSITION", TIMING = "DRILL_TIMING", MISS = "DRILL_MISS";

	/** 약점 하나. 리포트의 {@code weakSegments} 항목에서 필요한 값만 옮긴 것이다. */
	record Weakness(String pattern, List<String> pads, double severity) {}
	/** 후보 채보. 밀도와 비율은 {@code chart_features}의 값이다. */
	public record Chart(long songId, long chartId, String difficulty, int noteCount, double density,
			Map<String, Double> padRatio, Map<String, Double> transitionRatio) {}
	/** 고른 연습 곡과 어떤 약점을 위한 것인지. */
	public record Drill(Chart chart, String pattern, List<String> pads, String reason, double score) {}

	/** 약점 종류마다 어떤 값을 볼지와 좋게 볼 밀도 범위. */
	private record Rule(String reason, double low, double high, ToDoubleFunction<Chart> value, boolean lowerIsBetter) {}

	private DrillPlanner() {}

	/**
	 * 심한 약점부터 종류마다 곡 하나를 고른다. 방금 친 곡은 뺀다. 고를 곡이 없는 약점은 건너뛴다.
	 *
	 * @param baseline 기준 밀도. 없으면(양수가 아니면) 거를 근거가 없어 빈 목록이다
	 */
	public static List<Drill> plan(List<Weakness> weaknesses, List<Chart> charts, long playedSongId, double baseline, int size) {
		if (baseline <= 0 || size < 1) return List.of();
		var pool = new ArrayList<Chart>();
		for (var c : dropDuplicateCharts(charts)) {
			if (c.songId() != playedSongId && c.density() > 0 && c.density() / baseline <= HARD_LIMIT) pool.add(c);
		}
		var ordered = new ArrayList<>(weaknesses);
		ordered.sort(Comparator.comparingDouble(Weakness::severity).reversed().thenComparing(Weakness::pattern));

		var drills = new ArrayList<Drill>();
		var usedSongs = new HashSet<Long>();
		var usedReasons = new HashSet<String>();
		for (var weakness : ordered) {
			if (drills.size() >= Math.min(size, MAX_DRILLS)) break;
			var rule = rule(weakness);
			if (rule.isEmpty() || usedReasons.contains(rule.get().reason())) continue;
			var drill = pick(weakness, rule.get(), pool, usedSongs, baseline);
			if (drill == null) continue;
			drills.add(drill);
			usedSongs.add(drill.chart().songId());
			usedReasons.add(rule.get().reason());
		}
		return List.copyOf(drills);
	}

	/** 손 약점과 모르는 약점은 채보로 고를 근거가 없어 규칙이 없다. */
	private static Optional<Rule> rule(Weakness w) {
		var pads = w.pads() == null ? List.<String>of() : w.pads().stream().map(DrillPlanner::canonical).toList();
		return switch (w.pattern()) {
			case "TRANSITION_LATE", "TRANSITION_MISS" -> pads.size() < 2 ? Optional.empty() : Optional.of(new Rule(TRANSITION, 0.6, 1.0,
					c -> c.transitionRatio().getOrDefault(pads.get(0) + ">" + pads.get(1), 0.0), false));
			case "PAD_LATE", "PAD_EARLY" -> pads.isEmpty() ? Optional.empty() : Optional.of(new Rule(PAD, 0.6, 1.0,
					c -> c.padRatio().getOrDefault(pads.getFirst(), 0.0), false));
			case "MISS_CLUSTER" -> Optional.of(pads.isEmpty() ? new Rule(MISS, 0.5, 0.85, Chart::density, true)
					: new Rule(MISS, 0.5, 0.85, c -> pads.stream().mapToDouble(p -> c.padRatio().getOrDefault(p, 0.0)).sum(), false));
			case "TIMING_LATE", "TIMING_EARLY", "UNSTEADY" -> Optional.of(new Rule(TIMING, 0.5, 0.85, Chart::density, true));
			default -> Optional.empty();
		};
	}

	private static Drill pick(Weakness weakness, Rule rule, List<Chart> pool, HashSet<Long> usedSongs, double baseline) {
		var eligible = pool.stream().filter(c -> rule.value().applyAsDouble(c) > 0).toList();
		var values = eligible.stream().map(rule.value()::applyAsDouble).toList();
		var bestPerSong = new HashMap<Long, Drill>();
		for (var chart : eligible) {
			if (usedSongs.contains(chart.songId())) continue;
			double match = percentile(rule.value().applyAsDouble(chart), values, rule.lowerIsBetter());
			double score = W_MATCH * match + W_FIT * densityFit(chart.density() / baseline, rule.low(), rule.high());
			var drill = new Drill(chart, weakness.pattern(), weakness.pads() == null ? List.of() : List.copyOf(weakness.pads()), rule.reason(), round(score));
			bestPerSong.merge(chart.songId(), drill, (a, b) -> better(a, b) <= 0 ? a : b);
		}
		return bestPerSong.values().stream().min(DrillPlanner::better).orElse(null);
	}

	/** 후보 안에서의 순위(0보다 크고 1 이하). 값이 같으면 같은 순위다. */
	static double percentile(double value, List<Double> values, boolean lowerIsBetter) {
		long atOrWorse = values.stream().filter(v -> lowerIsBetter ? v >= value : v <= value).count();
		return (double) atOrWorse / values.size();
	}

	/** 범위 안이면 1이다. 아래로는 0에서, 위로는 {@link #HARD_LIMIT}에서 0이 된다. */
	static double densityFit(double ratio, double low, double high) {
		if (ratio < low) return Math.max(0, ratio / low);
		if (ratio > high) return Math.max(0, 1 - (ratio - high) / (HARD_LIMIT - high));
		return 1;
	}

	private static int better(Drill a, Drill b) {
		int byScore = Double.compare(b.score(), a.score());
		if (byScore != 0) return byScore;
		int bySong = Long.compare(a.chart().songId(), b.chart().songId());
		return bySong != 0 ? bySong : Long.compare(a.chart().chartId(), b.chart().chartId());
	}

	private static String canonical(String pad) { return "HI_TOM".equals(pad) ? "SMALL_TOM" : pad; } // 옛 이름

	/** 곡 목록의 중복 제거 규칙과 같다. NORMAL과 노트 수가 같은 EASY·HARD는 같은 채보로 보고 뺀다. */
	private static List<Chart> dropDuplicateCharts(List<Chart> all) {
		var normalCount = new HashMap<Long, Integer>();
		for (var c : all) if ("NORMAL".equals(c.difficulty())) normalCount.put(c.songId(), c.noteCount());
		return all.stream().filter(c -> "NORMAL".equals(c.difficulty()) || !normalCount.containsKey(c.songId()) || normalCount.get(c.songId()) != c.noteCount()).toList();
	}

	private static double round(double v) { return Math.round(v * 10000.0) / 10000.0; }
}
