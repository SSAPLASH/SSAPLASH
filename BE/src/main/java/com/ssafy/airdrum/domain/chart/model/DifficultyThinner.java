package com.ssafy.airdrum.domain.chart.model;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * 난이도별 노트 솎기(151 설계 4-3절, EASY는 328 설계 4-1절). HARD는 전부, NORMAL·EASY는 규칙으로 덜어낸다.
 * 규칙을 바꾸면 {@link #RULE_VERSION}을 올려 chart_versions.generator_version으로 구분한다.
 */
public final class DifficultyThinner {

	public static final String RULE_VERSION = "midi-rule-2.0";

	public enum Difficulty { EASY, NORMAL, HARD }

	/** tick부터 적용되는 4분음표 길이(µs). */
	public record Tempo(long tick, int microsPerQuarter) {}

	/** 이 간격(ms)보다 짧게 이어지는 타격은 연타다. EASY 박도 이 길이 이상인 가장 짧은 음표로 정한다. 플레이 확인 뒤 조정한다. */
	static final int T_MIN_MS = 300;
	/** 연타 구간으로 보는 최소 묶음 수. 2개(플램·더블)는 연타가 아니다. */
	static final int BURST_RUN = 3;
	static final int DEFAULT_TEMPO_US = 500_000;

	/** NORMAL에서 이 세기 미만 스네어는 고스트 노트로 본다. */
	private static final int GHOST = 40;
	private static final Set<DrumPad> CYMBAL_TIME = EnumSet.of(DrumPad.HIHAT, DrumPad.HIHAT_PEDAL, DrumPad.RIDE);
	/** 동시 타격·간격 충돌에서 남길 순서. 앞일수록 먼저 남긴다. */
	private static final List<DrumPad> PRIORITY = List.of(DrumPad.SNARE, DrumPad.KICK, DrumPad.CRASH, DrumPad.HIHAT,
			DrumPad.RIDE, DrumPad.SMALL_TOM, DrumPad.MID_TOM, DrumPad.FLOOR_TOM, DrumPad.HIHAT_PEDAL);
	private static final Comparator<DrumNote> STRONGER = Comparator
			.<DrumNote>comparingInt(n -> PRIORITY.indexOf(n.pad())).thenComparing(Comparator.comparingInt(DrumNote::velocity).reversed());
	public static final Comparator<DrumNote> ORDER = Comparator.comparingLong(DrumNote::tick).thenComparing(DrumNote::pad);
	/** 같은 시각에 남기는 최대 노트 수(NORMAL·EASY). */
	private static final int LIMIT = 2;

	private DifficultyThinner() {}

	/**
	 * @param notes 패드로 바꾼 노트(순서 무관)
	 * @param ppq 4분음표당 tick
	 * @param tempos 템포 목록(순서 무관, EASY만 쓴다). 비면 120 BPM, 첫 점이 tick 0이 아니면 그 템포를 0부터 쓴다
	 */
	public static Map<Difficulty, List<DrumNote>> thin(List<DrumNote> notes, int ppq, List<Tempo> tempos) {
		var hard = merge(notes);
		var normal = normal(hard, ppq);
		if (normal.isEmpty()) normal = hard;
		var easy = easy(hard, ppq, new Clock(tempos, ppq));
		if (easy.isEmpty()) easy = normal;
		var result = new EnumMap<Difficulty, List<DrumNote>>(Difficulty.class);
		result.put(Difficulty.EASY, easy);
		result.put(Difficulty.NORMAL, normal);
		result.put(Difficulty.HARD, hard);
		return result;
	}

	/** 같은 (tick, 패드)는 세기가 큰 노트 하나로 합친다. */
	private static List<DrumNote> merge(List<DrumNote> notes) {
		var merged = new LinkedHashMap<String, DrumNote>();
		for (var n : notes) merged.merge(n.tick() + ":" + n.pad(), n, (a, b) -> b.velocity() > a.velocity() ? b : a);
		var list = new ArrayList<>(merged.values());
		list.sort(ORDER);
		return List.copyOf(list);
	}

	/**
	 * NORMAL(midi-rule-1.1과 같다): 하이햇·라이드·페달은 8분 격자만, 스네어 고스트 제외, 같은 시각 2개,
	 * 16분의 3/4보다 가까우면 우선순위로 하나. 사람 연주의 흔들림을 고려해 기준 간격의 3/4 미만만 너무 가깝다고 본다.
	 */
	private static List<DrumNote> normal(List<DrumNote> hard, int ppq) {
		double eighth = ppq / 2.0;
		double minGap = ppq / 4.0 * 3 / 4;
		var kept = new ArrayList<List<DrumNote>>();
		for (var group : groups(hard)) {
			var candidates = new ArrayList<DrumNote>();
			for (var n : group) {
				boolean cymbal = CYMBAL_TIME.contains(n.pad());
				if ((cymbal && !onGrid(n.tick(), eighth, ppq)) || (n.pad() == DrumPad.SNARE && n.velocity() < GHOST)) continue;
				candidates.add(n);
			}
			if (candidates.isEmpty()) continue;
			var chosen = strongest(candidates);
			if (!kept.isEmpty() && tick(chosen) - tick(kept.getLast()) < minGap) {
				if (STRONGER.compare(chosen.getFirst(), kept.getLast().getFirst()) < 0) kept.removeLast();
				else continue;
			}
			kept.add(chosen);
		}
		return flatten(kept);
	}

	/**
	 * EASY(midi-rule-2.0): 페달을 빼고 같은 시각 2개까지 둔 묶음 가운데, 템포로 정한 EASY 박 위의 묶음만 남긴다.
	 * 300ms보다 짧게 3묶음 이상 이어지는 연타 구간은 EASY 박 칸마다 박에 가장 가까운 묶음 하나로 줄인다.
	 * 마지막으로 225ms보다 가까운 묶음은 우선순위가 높은 쪽(같으면 먼저 친 쪽) 하나만 남긴다. 세기로는 거르지 않는다.
	 */
	private static List<DrumNote> easy(List<DrumNote> hard, int ppq, Clock clock) {
		var groups = new ArrayList<List<DrumNote>>();
		for (var group : groups(hard)) {
			var candidates = group.stream().filter(n -> n.pad() != DrumPad.HIHAT_PEDAL).toList();
			if (!candidates.isEmpty()) groups.add(strongest(candidates));
		}
		var picked = new LinkedHashSet<List<DrumNote>>();
		long burstGap = (long) T_MIN_MS * 1000 * ppq;
		for (int start = 0; start < groups.size();) {
			int end = start;
			while (end + 1 < groups.size() && clock.between(tick(groups.get(end)), tick(groups.get(end + 1))) < burstGap) end++;
			var run = groups.subList(start, end + 1);
			if (run.size() >= BURST_RUN) picked.addAll(representatives(run, ppq, clock));
			else for (var group : run) if (onGrid(tick(group), clock.easyBeat(tick(group)), ppq)) picked.add(group);
			start = end + 1;
		}
		var ordered = new ArrayList<>(picked);
		ordered.sort(Comparator.comparingLong(DifficultyThinner::tick));
		long minGap = (long) T_MIN_MS * 1000 * 3 / 4 * ppq;
		var kept = new ArrayList<List<DrumNote>>();
		for (var group : ordered) {
			if (!kept.isEmpty() && clock.between(tick(kept.getLast()), tick(group)) < minGap) {
				if (STRONGER.compare(group.getFirst(), kept.getLast().getFirst()) < 0) kept.removeLast();
				else continue;
			}
			kept.add(group);
		}
		return flatten(kept);
	}

	/**
	 * 연타 구간의 대표: 구간 양 끝(±ppq/8) 안의 EASY 박마다, 박 앞뒤 반 칸(양 끝 제외) 안에서 박에 가장 가까운 묶음 하나.
	 * 거리가 같으면 우선순위, 그것도 같으면 먼저 친 묶음이다. 박은 8분 위치를 차례로 보며 그 위치 템포의 EASY 박 격자에 맞는 것만 쓴다.
	 */
	private static List<List<DrumNote>> representatives(List<List<DrumNote>> run, int ppq, Clock clock) {
		double tolerance = ppq / 8.0, eighth = ppq / 2.0;
		long from = tick(run.getFirst()), to = tick(run.getLast());
		var chosen = new ArrayList<List<DrumNote>>();
		for (long k = Math.max(0, (long) Math.ceil((from - tolerance) / eighth)); k * eighth <= to + tolerance; k++) {
			double beat = k * eighth;
			double unit = clock.easyBeat((long) beat);
			if (!multipleOf(beat, unit)) continue;
			List<DrumNote> best = null;
			for (var group : run) {
				double distance = Math.abs(tick(group) - beat);
				if (distance >= unit / 2) continue;
				if (best == null) { best = group; continue; }
				int byDistance = Double.compare(distance, Math.abs(tick(best) - beat));
				if (byDistance < 0 || byDistance == 0 && STRONGER.compare(group.getFirst(), best.getFirst()) < 0) best = group;
			}
			if (best != null) chosen.add(best);
		}
		return chosen;
	}

	/** 우선순위 순으로 최대 {@link #LIMIT}개. 첫 노트가 묶음의 대표다. */
	private static List<DrumNote> strongest(List<DrumNote> candidates) {
		var sorted = new ArrayList<>(candidates);
		sorted.sort(STRONGER);
		return List.copyOf(sorted.subList(0, Math.min(LIMIT, sorted.size())));
	}

	private static long tick(List<DrumNote> group) {
		return group.getFirst().tick();
	}

	private static List<DrumNote> flatten(List<List<DrumNote>> kept) {
		var result = new ArrayList<DrumNote>();
		kept.forEach(result::addAll);
		result.sort(ORDER);
		return List.copyOf(result);
	}

	/** 정렬된 노트를 같은 tick끼리 묶는다. */
	private static List<List<DrumNote>> groups(List<DrumNote> sorted) {
		var groups = new ArrayList<List<DrumNote>>();
		for (var n : sorted) {
			if (groups.isEmpty() || groups.getLast().getFirst().tick() != n.tick()) groups.add(new ArrayList<>());
			groups.getLast().add(n);
		}
		return groups;
	}

	/** 격자에서 32분음표 절반(ppq/8) 이내면 격자 위로 본다. */
	private static boolean onGrid(long tick, double unit, int ppq) {
		double r = tick % unit;
		double tolerance = ppq / 8.0;
		return r <= tolerance || unit - r <= tolerance;
	}

	/** 8분 위치가 EASY 박 격자와 정확히 겹치는가(둘 다 ppq/2의 배수라 오차는 부동소수점뿐이다). */
	private static boolean multipleOf(double position, double unit) {
		double r = position % unit;
		return r < 1e-6 || unit - r < 1e-6;
	}

	/**
	 * 템포 목록으로 tick 사이 시간을 잰다. 실수 누적 오차로 경계(100 BPM 8분 = 정확히 300ms)가 흔들리지 않도록
	 * 시간은 "tick × 4분음표 µs"(= µs × ppq) 정수로 센다.
	 */
	static final class Clock {
		private final long[] ticks;
		private final int[] micros;
		private final long[] starts;
		private final int ppq;

		Clock(List<Tempo> tempos, int ppq) {
			if (ppq <= 0) throw new IllegalArgumentException("ppq는 양수여야 합니다.");
			var byTick = new TreeMap<Long, Integer>();
			for (var t : tempos) {
				if (t.microsPerQuarter() <= 0) throw new IllegalArgumentException("템포는 양수여야 합니다: " + t);
				byTick.put(Math.max(0, t.tick()), t.microsPerQuarter());
			}
			if (byTick.isEmpty()) byTick.put(0L, DEFAULT_TEMPO_US);
			if (byTick.firstKey() != 0) byTick.put(0L, byTick.firstEntry().getValue());
			int m = byTick.size();
			ticks = new long[m];
			micros = new int[m];
			starts = new long[m];
			int i = 0;
			for (var e : byTick.entrySet()) {
				ticks[i] = e.getKey();
				micros[i] = e.getValue();
				starts[i] = i == 0 ? 0 : starts[i - 1] + (ticks[i] - ticks[i - 1]) * micros[i - 1];
				i++;
			}
			this.ppq = ppq;
		}

		/** a에서 b까지 시간(µs × ppq). */
		long between(long a, long b) {
			return time(b) - time(a);
		}

		private long time(long tick) {
			int i = segment(tick);
			return starts[i] + (tick - ticks[i]) * micros[i];
		}

		/** tick의 템포로 정한 EASY 박(tick): 길이가 T_MIN_MS 이상인 가장 짧은 8분·4분·2분, 없으면 2분. */
		double easyBeat(long tick) {
			int quarter = micros[segment(tick)];
			if (quarter >= 2L * T_MIN_MS * 1000) return ppq / 2.0;
			if (quarter >= (long) T_MIN_MS * 1000) return ppq;
			return ppq * 2.0;
		}

		private int segment(long tick) {
			int i = Arrays.binarySearch(ticks, Math.max(0, tick));
			return i >= 0 ? i : Math.max(0, -i - 2);
		}
	}

}
