package com.ssafy.airdrum.song.similar;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * R2 유사도의 입력: 채보 하나의 특징. 값은 {@code chart_features}에서 읽고, {@code groups}는 {@code rhythm_grid}의 묶음별 12칸 비율이다.
 * 격자가 없는 채보(가변 템포·격자 이탈)는 후보가 될 수 없으므로 이 타입으로 만들지 않는다.
 */
public record ChartVector(long songId, long chartId, String difficulty, int noteCount, double density, double bpm, String timeSignature,
		Map<String, Double> padRatio, Map<String, Double> transitionRatio, Map<String, List<Double>> groups, SongMeta meta) {

	/** 곡 메타데이터(선택). 비어 있는 곡은 {@code null}이거나 모든 집합이 비어 있다. */
	public record SongMeta(Set<String> genres, Set<String> moods, Set<String> drumStyles, Integer energy) {
		public static final SongMeta NONE = new SongMeta(Set.of(), Set.of(), Set.of(), null);
		boolean isEmpty() { return genres.isEmpty() && moods.isEmpty() && drumStyles.isEmpty() && energy == null; }
	}

	public ChartVector withMeta(SongMeta meta) {
		return new ChartVector(songId, chartId, difficulty, noteCount, density, bpm, timeSignature, padRatio, transitionRatio, groups, meta);
	}
}
