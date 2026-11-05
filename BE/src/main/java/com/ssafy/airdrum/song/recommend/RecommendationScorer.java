package com.ssafy.airdrum.song.recommend;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * R1 규칙 점수. DB·시간·난수에 의존하지 않아 같은 입력이면 항상 같은 순서를 돌려준다.
 * 수치는 모두 가정값이며 노출·클릭 기록으로 보정한다(설계 문서 U8).
 */
final class RecommendationScorer {
	static final double W_CHALLENGE = 0.45, W_WEAK = 0.30, W_NEW = 0.15, W_RETRY = 0.10;
	/** 기준 밀도 대비 최고점 구간. */
	static final double SWEET_LOW = 1.10, SWEET_HIGH = 1.25;
	/** 기준 밀도의 이 배수를 넘는 채보는 점수와 무관하게 제외한다. */
	static final double HARD_LIMIT = 1.5;
	/** 기준 밀도로 인정하는 정확도, 재도전 구간의 아래 끝(정확도 %). */
	static final double TARGET_ACCURACY = 85, RETRY_FLOOR = 70;
	static final Duration STALE = Duration.ofDays(14);
	/** 약점 점수는 (패드 비율 × 약점 가중치)의 합에 이 배수를 곱해 1로 자른다. 패드 하나의 비율이 작아서 키운다. */
	static final double WEAK_SCALE = 2.0;
	static final double CHALLENGE_REASON_MIN = 0.8, WEAK_REASON_MIN = 0.3;

	static final String CHALLENGE = "CHALLENGE", WEAK_PAD = "WEAK_PAD", NEW_SONG = "NEW_SONG", RETRY = "RETRY", STARTER = "STARTER";

	record Candidate(long songId, long chartId, String difficulty, String songLevel, int noteCount, double density, Map<String, Double> padRatio) {}
	/** baselineDensity가 null이면 기록이 없거나 목표 정확도를 넘긴 판이 없는 사용자다. */
	record Profile(Double baselineDensity, Map<String, Double> weakPads, Map<Long, Instant> songLastPlayed, Map<Long, Double> chartBestAccuracy) {}
	record Scored(Candidate candidate, double total, List<String> reasons, String primary) {}

	private RecommendationScorer() {}

	static List<Scored> rank(List<Candidate> all, Profile profile, Instant now, int size) {
		var candidates = dropDuplicateCharts(all);
		if (profile.baselineDensity() == null) return starter(candidates, size);
		double base = profile.baselineDensity();
		var bestPerSong = new HashMap<Long, Scored>();
		for (var c : candidates) {
			double ratio = c.density() / base;
			if (ratio > HARD_LIMIT) continue;
			var scored = score(c, ratio, profile, now);
			bestPerSong.merge(c.songId(), scored, (a, b) -> better(a, b) <= 0 ? a : b);
		}
		var ranked = new ArrayList<>(bestPerSong.values());
		ranked.sort(RecommendationScorer::better);
		return diversify(ranked, size);
	}

	/** 기록이 없으면 BEGINNER 곡의 가장 쉬운 채보를 보여 준다. */
	private static List<Scored> starter(List<Candidate> candidates, int size) {
		var easiest = new HashMap<Long, Candidate>();
		for (var c : candidates) {
			if (!"BEGINNER".equals(c.songLevel())) continue;
			easiest.merge(c.songId(), c, (a, b) -> a.density() != b.density() ? (a.density() < b.density() ? a : b) : (a.chartId() <= b.chartId() ? a : b));
		}
		return easiest.values().stream()
				.sorted(Comparator.comparingDouble(Candidate::density).thenComparingLong(Candidate::songId))
				.limit(size)
				.map(c -> new Scored(c, 0, List.of(STARTER), STARTER)).toList();
	}

	private static Scored score(Candidate c, double ratio, Profile profile, Instant now) {
		double challenge = challenge(ratio);
		double weak = 0;
		for (var pad : c.padRatio().entrySet()) weak += pad.getValue() * profile.weakPads().getOrDefault(pad.getKey(), 0.0);
		weak = Math.min(1, weak * WEAK_SCALE);
		var last = profile.songLastPlayed().get(c.songId());
		double fresh = last == null ? 1.0 : Duration.between(last, now).compareTo(STALE) >= 0 ? 0.5 : 0.0;
		var best = profile.chartBestAccuracy().get(c.chartId());
		double retry = best != null && best >= RETRY_FLOOR && best < TARGET_ACCURACY ? 1.0 : 0.0;
		double total = W_CHALLENGE * challenge + W_WEAK * weak + W_NEW * fresh + W_RETRY * retry;

		var parts = new LinkedHashMap<String, Double>();
		parts.put(CHALLENGE, W_CHALLENGE * challenge);
		parts.put(WEAK_PAD, W_WEAK * weak);
		parts.put(NEW_SONG, W_NEW * fresh);
		parts.put(RETRY, W_RETRY * retry);
		var reasons = new ArrayList<String>();
		if (challenge >= CHALLENGE_REASON_MIN) reasons.add(CHALLENGE);
		if (weak >= WEAK_REASON_MIN) reasons.add(WEAK_PAD);
		if (fresh >= 1.0) reasons.add(NEW_SONG);
		if (retry > 0) reasons.add(RETRY);
		// 어떤 조건도 넘지 못해도 이유는 하나 이상 있어야 한다. 가장 크게 기여한 요소를 쓴다.
		String top = parts.entrySet().stream().max(Map.Entry.<String, Double>comparingByValue().thenComparing(e -> -indexOf(e.getKey()))).get().getKey();
		if (reasons.isEmpty()) reasons.add(top);
		// 대표 이유는 점수에 가장 크게 기여한 요소 중 실제로 이유로 채택된 것
		String primary = reasons.stream().max(Comparator.comparingDouble(parts::get)).get();
		return new Scored(c, Math.round(total * 10000.0) / 10000.0, List.copyOf(reasons), primary);
	}

	private static int indexOf(String code) { return switch (code) { case CHALLENGE -> 0; case WEAK_PAD -> 1; case NEW_SONG -> 2; default -> 3; }; }

	/** 기준 밀도 대비 비율이 1.10~1.25면 1점이고 벗어날수록 줄어든다. */
	static double challenge(double ratio) {
		if (ratio >= SWEET_LOW && ratio <= SWEET_HIGH) return 1.0;
		if (ratio < SWEET_LOW) return Math.max(0, 1.0 - (SWEET_LOW - ratio) / 0.6);
		return Math.max(0, 1.0 - (ratio - SWEET_HIGH) / (HARD_LIMIT - SWEET_HIGH));
	}

	private static int better(Scored a, Scored b) {
		int byScore = Double.compare(b.total(), a.total());
		if (byScore != 0) return byScore;
		int bySong = Long.compare(a.candidate().songId(), b.candidate().songId());
		return bySong != 0 ? bySong : Long.compare(a.candidate().chartId(), b.candidate().chartId());
	}

	/** 같은 대표 이유는 전체의 절반 이하로 둔다. 후보가 모자라면 남는 자리를 순서대로 채운다. */
	private static List<Scored> diversify(List<Scored> ranked, int size) {
		int cap = Math.max(1, size / 2);
		var picked = new ArrayList<Scored>();
		var counts = new HashMap<String, Integer>();
		var skipped = new ArrayList<Scored>();
		for (var s : ranked) {
			if (picked.size() >= size) break;
			if (counts.getOrDefault(s.primary(), 0) >= cap) { skipped.add(s); continue; }
			picked.add(s);
			counts.merge(s.primary(), 1, Integer::sum);
		}
		for (var s : skipped) { if (picked.size() >= size) break; picked.add(s); }
		picked.sort(RecommendationScorer::better);
		return picked;
	}

	/** 곡 목록의 중복 제거 기준과 같다. NORMAL과 노트 수가 같은 EASY·HARD는 같은 채보로 보고 뺀다. */
	private static List<Candidate> dropDuplicateCharts(List<Candidate> all) {
		var normalCount = new HashMap<Long, Integer>();
		for (var c : all) if ("NORMAL".equals(c.difficulty())) normalCount.put(c.songId(), c.noteCount());
		return all.stream().filter(c -> "NORMAL".equals(c.difficulty()) || !normalCount.containsKey(c.songId()) || normalCount.get(c.songId()) != c.noteCount()).toList();
	}
}
