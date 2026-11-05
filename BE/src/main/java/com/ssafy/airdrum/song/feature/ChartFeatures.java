package com.ssafy.airdrum.song.feature;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import com.ssafy.airdrum.chart.ChartResponses.Note;

/**
 * 채보 한 버전의 특징. 밀도와 2초 창 최대치는 {@code SongLevelService}와 같은 기준이다.
 * 같은 노트와 곡 길이면 항상 같은 값이 나온다.
 */
public record ChartFeatures(double avgNotesPerSec, int peakNotes2s, Map<String, Double> padRatio, Map<String, Double> transitionRatio) {
	static final int TOP_TRANSITIONS = 12;

	public static ChartFeatures compute(List<Note> notes, int durationMs) {
		if (durationMs <= 0 || notes.isEmpty()) throw new IllegalArgumentException("유효한 곡 길이와 노트가 필요합니다.");
		int left = 0, peak = 0;
		for (int right = 0; right < notes.size(); right++) {
			double time = notes.get(right).timeMs();
			while (time - notes.get(left).timeMs() >= 2000) left++;
			peak = Math.max(peak, right - left + 1);
		}
		var padCounts = new TreeMap<String, Integer>();
		for (var note : notes) padCounts.merge(note.pad(), 1, Integer::sum);
		var pads = new LinkedHashMap<String, Double>();
		padCounts.forEach((pad, count) -> pads.put(pad, round(count / (double) notes.size())));

		// 전환: 시간이 다른 연속 두 노트의 패드가 바뀐 경우만 센다(동시 타격은 전환이 아니다).
		var transitionCounts = new TreeMap<String, Integer>();
		int pairs = 0;
		for (int i = 1; i < notes.size(); i++) {
			var before = notes.get(i - 1);
			var now = notes.get(i);
			if (Double.compare(before.timeMs(), now.timeMs()) == 0) continue;
			pairs++;
			if (!before.pad().equals(now.pad())) transitionCounts.merge(before.pad() + ">" + now.pad(), 1, Integer::sum);
		}
		var sorted = new ArrayList<>(transitionCounts.entrySet());
		sorted.sort(Map.Entry.<String, Integer>comparingByValue(Comparator.reverseOrder()).thenComparing(Map.Entry.comparingByKey()));
		var transitions = new LinkedHashMap<String, Double>();
		for (var entry : sorted.subList(0, Math.min(TOP_TRANSITIONS, sorted.size())))
			transitions.put(entry.getKey(), round(entry.getValue() / (double) pairs));
		return new ChartFeatures(Math.round(notes.size() * 1000.0 / durationMs * 1000.0) / 1000.0, peak, pads, transitions);
	}

	private static double round(double value) { return Math.round(value * 10000.0) / 10000.0; }
}
