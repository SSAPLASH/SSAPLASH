package com.ssafy.airdrum.song.midi;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 난이도별 노트 솎기(설계 4-3절). HARD는 전부, NORMAL·EASY는 규칙으로 덜어낸다.
 * 규칙을 바꾸면 {@link #RULE_VERSION}을 올려 chart_versions.generator_version으로 구분한다.
 */
public final class DifficultyThinner {

	public static final String RULE_VERSION = "midi-rule-1.1";

	public enum Difficulty { EASY, NORMAL, HARD }

	/** 이 세기 미만은 고스트 노트로 본다. */
	private static final int GHOST = 40;
	private static final Set<DrumPad> CYMBAL_TIME = EnumSet.of(DrumPad.HIHAT, DrumPad.HIHAT_PEDAL, DrumPad.RIDE);
	/** 동시 타격·간격 충돌에서 남길 순서. 앞일수록 먼저 남긴다. */
	private static final List<DrumPad> PRIORITY = List.of(DrumPad.SNARE, DrumPad.KICK, DrumPad.CRASH, DrumPad.HIHAT,
			DrumPad.RIDE, DrumPad.SMALL_TOM, DrumPad.MID_TOM, DrumPad.FLOOR_TOM, DrumPad.HIHAT_PEDAL);
	private static final Comparator<DrumNote> STRONGER = Comparator
			.<DrumNote>comparingInt(n -> PRIORITY.indexOf(n.pad())).thenComparing(Comparator.comparingInt(DrumNote::velocity).reversed());
	static final Comparator<DrumNote> ORDER = Comparator.comparingLong(DrumNote::tick).thenComparing(DrumNote::pad);

	private DifficultyThinner() {}

	/**
	 * @param notes 패드로 바꾼 노트(순서 무관)
	 * @param ppq 4분음표당 tick
	 */
	public static Map<Difficulty, List<DrumNote>> thin(List<DrumNote> notes, int ppq) {
		var hard = merge(notes);
		var normal = thin(hard, ppq, false);
		if (normal.isEmpty()) normal = hard;
		var easy = thin(hard, ppq, true);
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

	private static List<DrumNote> thin(List<DrumNote> hard, int ppq, boolean easy) {
		double beat = easy ? ppq : ppq / 2.0; // 격자: EASY 4분, NORMAL 8분(하이햇·라이드·페달만)
		int limit = 2;
		double minGap = easy ? ppq / 2.0 : ppq / 4.0; // EASY 8분, NORMAL 16분
		var kept = new ArrayList<List<DrumNote>>();
		for (var group : groups(hard)) {
			var candidates = new ArrayList<DrumNote>();
			for (var n : group) {
				boolean cymbal = CYMBAL_TIME.contains(n.pad());
				if (easy && (n.pad() == DrumPad.HIHAT_PEDAL || n.velocity() < GHOST || !onGrid(n.tick(), beat, ppq))) continue;
				if (!easy && ((cymbal && !onGrid(n.tick(), beat, ppq)) || (n.pad() == DrumPad.SNARE && n.velocity() < GHOST))) continue;
				candidates.add(n);
			}
			if (candidates.isEmpty()) continue;
			candidates.sort(STRONGER);
			var chosen = candidates.subList(0, Math.min(limit, candidates.size()));
			if (!kept.isEmpty()) {
				var previous = kept.getLast();
				// 사람 연주의 흔들림을 고려해 기준 간격의 3/4 미만만 너무 가깝다고 본다.
				if (chosen.getFirst().tick() - previous.getFirst().tick() < minGap * 3 / 4) {
					if (STRONGER.compare(chosen.getFirst(), previous.getFirst()) < 0) kept.removeLast();
					else continue;
				}
			}
			kept.add(List.copyOf(chosen));
		}
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

}
