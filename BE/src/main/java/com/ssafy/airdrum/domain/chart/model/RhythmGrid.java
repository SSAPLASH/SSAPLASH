package com.ssafy.airdrum.domain.chart.model;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import com.ssafy.airdrum.domain.chart.dto.ChartResponses.Note;
import com.ssafy.airdrum.domain.chart.dto.ChartResponses.Timing;

/**
 * 리듬 격자: 패드 묶음마다 "한 박을 12칸으로 나눴을 때 어느 칸에서 울리는가"의 비율(R2 비슷한 곡의 입력).
 * 12칸은 8분·16분·셋잇단음표를 모두 담는 가장 작은 수다. 같은 입력이면 항상 같은 결과다.
 *
 * <p>가변 템포이거나 격자에서 크게 벗어난 채보는 격자를 만들지 않고 {@code excluded} 사유만 돌려준다.
 */
public record RhythmGrid(double bpm, String timeSignature, double unquantizedRatio, Map<String, List<Double>> groups) {
	public static final int DIVISIONS = 12;
	/** 칸에서 이만큼(칸 단위) 넘게 벗어난 노트는 격자 밖으로 센다. 0.25칸 = 1/48박. */
	static final double OFF_GRID_TOLERANCE = 0.25;
	/** 격자 밖 노트가 이 비율을 넘으면 R2 후보에서 뺀다(가정값). */
	static final double MAX_UNQUANTIZED = 0.2;
	public static final List<String> GROUP_NAMES = List.of("KICK", "SNARE", "HAT", "CYMBAL", "TOM");
	private static final Map<String, String> GROUP_OF = Map.of(
			"KICK", "KICK", "SNARE", "SNARE", "HIHAT", "HAT", "HIHAT_PEDAL", "HAT",
			"CRASH", "CYMBAL", "RIDE", "CYMBAL", "SMALL_TOM", "TOM", "MID_TOM", "TOM", "FLOOR_TOM", "TOM");

	public static final String VARIABLE_TEMPO = "VARIABLE_TEMPO", OFF_GRID = "OFF_GRID", NO_KNOWN_PADS = "NO_KNOWN_PADS", INVALID_TIMING = "INVALID_TIMING";

	/** 격자가 있으면 {@code grid}, 없으면 {@code excluded}에 사유가 있다. 둘 중 하나만 채워진다. */
	public record Result(RhythmGrid grid, String excluded) {
		/** DB에 저장하는 JSON 문서. */
		public Map<String, Object> document() {
			var doc = new LinkedHashMap<String, Object>();
			if (grid == null) { doc.put("excluded", excluded); return doc; }
			doc.put("divisions", DIVISIONS);
			doc.put("bpm", grid.bpm());
			doc.put("timeSignature", grid.timeSignature());
			doc.put("unquantizedRatio", grid.unquantizedRatio());
			doc.put("groups", grid.groups());
			return doc;
		}
	}

	public static Result excluded(String reason) { return new Result(null, reason); }

	public static Result compute(List<Note> notes, Timing timing) {
		if (timing.tempoMap() != null) {
			double first = timing.tempoMap().getFirst().bpm();
			for (var tempo : timing.tempoMap()) if (Double.compare(tempo.bpm(), first) != 0) return excluded(VARIABLE_TEMPO);
		}
		double beatMs = 60000.0 / timing.bpm();
		var counts = new LinkedHashMap<String, double[]>();
		for (var name : GROUP_NAMES) counts.put(name, new double[DIVISIONS]);
		int considered = 0, off = 0;
		for (var note : notes) {
			var group = GROUP_OF.get(note.pad());
			if (group == null) continue; // 모르는 패드는 격자에 넣지 않는다
			double beat = (note.timeMs() - timing.offsetMs()) / beatMs;
			double scaled = (beat - Math.floor(beat)) * DIVISIONS;
			long bin = Math.round(scaled);
			if (Math.abs(scaled - bin) > OFF_GRID_TOLERANCE) off++;
			counts.get(group)[(int) (bin % DIVISIONS)]++;
			considered++;
		}
		if (considered == 0) return excluded(NO_KNOWN_PADS);
		double unquantized = round(off / (double) considered);
		if (unquantized > MAX_UNQUANTIZED) return excluded(OFF_GRID);
		var groups = new LinkedHashMap<String, List<Double>>();
		counts.forEach((name, bins) -> {
			double total = 0;
			for (double b : bins) total += b;
			var ratios = new ArrayList<Double>(DIVISIONS);
			for (double b : bins) ratios.add(total == 0 ? 0.0 : round(b / total));
			groups.put(name, List.copyOf(ratios));
		});
		return new Result(new RhythmGrid(timing.bpm(), timing.timeSignature(), unquantized, java.util.Collections.unmodifiableMap(groups)), null);
	}

	private static double round(double value) { return Math.round(value * 10000.0) / 10000.0; }
}
