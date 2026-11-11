package com.ssafy.airdrum.domain.recommendation.service.similar;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import com.ssafy.airdrum.domain.recommendation.model.ChartVector;

/**
 * R2 비슷한 곡의 유사도 계산(설계 문서 부록 A). DB·시간·난수에 의존하지 않아 같은 입력이면 항상 같은 값과 순서를 낸다.
 * 모든 수치는 가정값이며 평가와 노출·클릭 기록으로 보정한다.
 * 리듬 격자는 쓰지 않는다. 공용 곡의 절반 가까이가 격자를 만들 수 없어(가변 템포·격자 이탈) 비교 대상에서 빠지기 때문이다.
 */
public final class SimilarityEngine {
	public static final double W_PADS = 0.31, W_TRANSITIONS = 0.23, W_DENSITY = 0.23, W_TEMPO = 0.23;
	/** 메타데이터가 양쪽에 있을 때만 이 비율로 섞는다. */
	static final double META_WEIGHT = 0.15;
	/** 박자표 분자가 다르면 총점에 곱한다. */
	static final double TIME_SIGNATURE_PENALTY = 0.5;
	/** 이 미만은 결과에 넣지 않는다. */
	public static final double MIN_SIMILARITY = 0.5;
	/** 본인 기록 필터: 기준 밀도의 이 배수를 넘는 채보는 뺀다(R1과 같은 값). */
	public static final double HARD_LIMIT = 1.5;
	/** 두 BPM의 비가 2^0.5(약 1.41배) 이상이면 템포 점수가 0이 되는 폭(옥타브 단위). */
	static final double TEMPO_SPAN = 0.5;
	/** 이 이상 기여한 요소만 "비슷한 이유"로 보인다. */
	static final double MATCH_MIN_SCORE = 0.6;
	private static final List<String> DIFFICULTIES = List.of("EASY", "NORMAL", "HARD");

	public static final String PADS = "PADS", TRANSITIONS = "TRANSITIONS", DENSITY = "DENSITY", TEMPO = "TEMPO", GENRE = "GENRE", MOOD = "MOOD";

	public record Match(ChartVector chart, double similarity, List<String> matchedOn) {}

	private SimilarityEngine() {}

	/** 요소별 점수(0~1)와 최종 유사도. {@code contributions}는 총점에 대한 요소별 기여다(박자표 감점 전). */
	record Breakdown(double chartSimilarity, double similarity, Map<String, Double> scores, Map<String, Double> contributions, boolean usedMeta) {}

	/** 같은 채보끼리 1이고, 순서를 바꿔도 같은 값이다. */
	public static double similarity(ChartVector a, ChartVector b) { return breakdown(a, b).similarity(); }

	static Breakdown breakdown(ChartVector a, ChartVector b) {
		var scores = new LinkedHashMap<String, Double>();
		scores.put(PADS, cosine(a.padRatio(), b.padRatio()));
		scores.put(TRANSITIONS, cosine(a.transitionRatio(), b.transitionRatio()));
		scores.put(DENSITY, octaveCloseness(a.density(), b.density(), 1.0));
		scores.put(TEMPO, octaveCloseness(a.bpm(), b.bpm(), TEMPO_SPAN));
		double chart = W_PADS * scores.get(PADS) + W_TRANSITIONS * scores.get(TRANSITIONS)
				+ W_DENSITY * scores.get(DENSITY) + W_TEMPO * scores.get(TEMPO);
		int beatsA = numerator(a.timeSignature()), beatsB = numerator(b.timeSignature());
		if (beatsA > 0 && beatsB > 0 && beatsA != beatsB) chart *= TIME_SIGNATURE_PENALTY; // 모르는 쪽이 있으면 감점하지 않는다

		var meta = metaParts(a.meta(), b.meta());
		double total = chart;
		double chartShare = 1.0;
		if (!meta.isEmpty()) {
			double metaScore = meta.values().stream().mapToDouble(Double::doubleValue).average().orElse(0);
			total = (1 - META_WEIGHT) * chart + META_WEIGHT * metaScore;
			chartShare = 1 - META_WEIGHT;
		}
		var contributions = new LinkedHashMap<String, Double>();
		contributions.put(PADS, chartShare * W_PADS * scores.get(PADS));
		contributions.put(TRANSITIONS, chartShare * W_TRANSITIONS * scores.get(TRANSITIONS));
		contributions.put(DENSITY, chartShare * W_DENSITY * scores.get(DENSITY));
		contributions.put(TEMPO, chartShare * W_TEMPO * scores.get(TEMPO));
		for (var part : meta.entrySet()) {
			scores.put(part.getKey(), part.getValue());
			contributions.put(part.getKey(), META_WEIGHT * part.getValue() / meta.size());
		}
		return new Breakdown(chart, total, scores, contributions, !meta.isEmpty());
	}

	/**
	 * 기준 채보와 비슷한 곡을 고른다. 기준 곡 자신은 뺀다. 곡당 채보 하나(기준과 같은 난이도, 없으면 밀도가 가장 가까운 것)를 비교하고,
	 * {@code baselineDensity}가 있으면 그 {@link #HARD_LIMIT}배를 넘는 채보는 점수와 무관하게 거른다(점수에는 섞지 않는다).
	 */
	public static List<Match> rank(ChartVector source, List<ChartVector> candidates, Double baselineDensity, int size) {
		var byDifficulty = new HashMap<Long, List<ChartVector>>();
		for (var c : dropDuplicateCharts(candidates)) {
			if (c.songId() == source.songId()) continue;
			if (baselineDensity != null && c.density() / baselineDensity > HARD_LIMIT) continue;
			byDifficulty.computeIfAbsent(c.songId(), k -> new ArrayList<>()).add(c);
		}
		var matches = new ArrayList<Match>();
		for (var charts : byDifficulty.values()) {
			var chosen = chooseCandidate(charts, source);
			var b = breakdown(source, chosen);
			double similarity = round(b.similarity());
			if (similarity < MIN_SIMILARITY) continue;
			matches.add(new Match(chosen, similarity, matchedOn(b)));
		}
		matches.sort(Comparator.comparingDouble((Match m) -> -m.similarity()).thenComparingLong(m -> m.chart().songId()));
		return matches.size() <= size ? List.copyOf(matches) : List.copyOf(matches.subList(0, size));
	}

	/**
	 * 기준 곡에서 비교할 채보를 고른다: 요청한 난이도, 없으면 난이도 순서(EASY·NORMAL·HARD)에서 가장 가까운 것(같으면 쉬운 쪽).
	 */
	public static ChartVector chooseSource(List<ChartVector> songCharts, String difficulty) {
		int want = DIFFICULTIES.indexOf(difficulty);
		return songCharts.stream().min(Comparator
				.comparingInt((ChartVector c) -> Math.abs(DIFFICULTIES.indexOf(c.difficulty()) - want))
				.thenComparingInt(c -> DIFFICULTIES.indexOf(c.difficulty()))
				.thenComparingLong(ChartVector::chartId)).orElseThrow();
	}

	/** 후보 곡에서 비교할 채보: 기준과 같은 난이도, 없으면 기준과 밀도가 가장 가까운 것. */
	static ChartVector chooseCandidate(List<ChartVector> songCharts, ChartVector source) {
		return songCharts.stream().min(Comparator
				.comparingInt((ChartVector c) -> c.difficulty().equals(source.difficulty()) ? 0 : 1)
				.thenComparingDouble(c -> densityGap(c.density(), source.density()))
				.thenComparingLong(ChartVector::chartId)).orElseThrow();
	}

	private static double densityGap(double x, double y) { return x <= 0 || y <= 0 ? Double.MAX_VALUE : Math.abs(Math.log(x / y)); }

	/** 점수에 가장 크게 기여한 요소 최대 2개. 기준 점수 이상인 것만, 하나도 없으면 가장 큰 것 하나. */
	private static List<String> matchedOn(Breakdown b) {
		var ordered = b.contributions().entrySet().stream()
				.sorted(Map.Entry.<String, Double>comparingByValue().reversed().thenComparing(Map.Entry.comparingByKey())).toList();
		var picked = new ArrayList<String>();
		for (var e : ordered) {
			if (picked.size() == 2) break;
			if (b.scores().get(e.getKey()) >= MATCH_MIN_SCORE) picked.add(e.getKey());
		}
		if (picked.isEmpty() && !ordered.isEmpty()) picked.add(ordered.getFirst().getKey());
		return List.copyOf(picked);
	}

	/** 곡 목록의 중복 제거 규칙과 같다. NORMAL과 노트 수가 같은 EASY·HARD는 같은 채보로 보고 뺀다. */
	private static List<ChartVector> dropDuplicateCharts(List<ChartVector> all) {
		var normalCount = new HashMap<Long, Integer>();
		for (var c : all) if ("NORMAL".equals(c.difficulty())) normalCount.put(c.songId(), c.noteCount());
		return all.stream().filter(c -> "NORMAL".equals(c.difficulty()) || !normalCount.containsKey(c.songId()) || normalCount.get(c.songId()) != c.noteCount()).toList();
	}

	static double cosine(Map<String, Double> a, Map<String, Double> b) {
		double dot = 0, na = 0, nb = 0;
		for (var e : a.entrySet()) { na += e.getValue() * e.getValue(); dot += e.getValue() * b.getOrDefault(e.getKey(), 0.0); }
		for (double v : b.values()) nb += v * v;
		return na == 0 || nb == 0 ? 0 : clamp(dot / Math.sqrt(na * nb));
	}

	/** 두 양수의 비가 2배(1 옥타브)일 때 {@code span} 옥타브를 기준으로 0이 되는 가까움. 같으면 1. */
	static double octaveCloseness(double x, double y, double span) {
		if (x <= 0 || y <= 0) return 0;
		double octaves = Math.abs(Math.log(x / y) / Math.log(2));
		return Math.max(0, 1 - Math.min(1, octaves / span));
	}

	/** 한쪽이라도 메타데이터가 없으면 비어 있다(채보 유사도만 쓴다). 있는 부분만 점수로 돌려준다. */
	private static Map<String, Double> metaParts(ChartVector.SongMeta a, ChartVector.SongMeta b) {
		var parts = new LinkedHashMap<String, Double>();
		if (a == null || b == null || a.isEmpty() || b.isEmpty()) return parts;
		if (!a.genres().isEmpty() && !b.genres().isEmpty()) parts.put(GENRE, jaccard(a.genres(), b.genres()));
		if (!a.moods().isEmpty() && !b.moods().isEmpty()) parts.put(MOOD, jaccard(a.moods(), b.moods()));
		if (!a.drumStyles().isEmpty() && !b.drumStyles().isEmpty()) parts.put("DRUM_STYLE", jaccard(a.drumStyles(), b.drumStyles()));
		if (a.energy() != null && b.energy() != null) parts.put("ENERGY", 1 - Math.abs(a.energy() - b.energy()) / 4.0);
		return parts;
	}

	private static double jaccard(Set<String> a, Set<String> b) {
		var union = new HashSet<>(a);
		union.addAll(b);
		var common = new HashSet<>(a);
		common.retainAll(b);
		return union.isEmpty() ? 0 : common.size() / (double) union.size();
	}

	private static int numerator(String timeSignature) {
		if (timeSignature == null) return -1;
		int slash = timeSignature.indexOf('/');
		try { return Integer.parseInt(slash < 0 ? timeSignature : timeSignature.substring(0, slash)); }
		catch (NumberFormatException ex) { return -1; }
	}

	private static double clamp(double v) { return Math.max(0, Math.min(1, v)); }
	private static double round(double v) { return Math.round(v * 1000.0) / 1000.0; }
}
