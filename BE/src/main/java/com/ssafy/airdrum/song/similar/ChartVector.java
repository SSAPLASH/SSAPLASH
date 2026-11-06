package com.ssafy.airdrum.song.similar;

import java.util.Map;
import java.util.Set;

/**
 * R2 유사도의 입력: 채보 하나의 특징. 밀도·패드·전환은 {@code chart_features}, 템포와 박자표는 {@code songs}에서 읽는다.
 * 곡에 템포나 박자표가 없으면 각각 0과 null이다.
 */
public record ChartVector(long songId, long chartId, String difficulty, int noteCount, double density, double bpm, String timeSignature,
		Map<String, Double> padRatio, Map<String, Double> transitionRatio, SongMeta meta) {

	/** 곡 메타데이터(선택). 비어 있는 곡은 {@code null}이거나 모든 집합이 비어 있다. */
	public record SongMeta(Set<String> genres, Set<String> moods, Set<String> drumStyles, Integer energy) {
		public static final SongMeta NONE = new SongMeta(Set.of(), Set.of(), Set.of(), null);
		boolean isEmpty() { return genres.isEmpty() && moods.isEmpty() && drumStyles.isEmpty() && energy == null; }
	}

	public ChartVector withMeta(SongMeta meta) {
		return new ChartVector(songId, chartId, difficulty, noteCount, density, bpm, timeSignature, padRatio, transitionRatio, meta);
	}
}
