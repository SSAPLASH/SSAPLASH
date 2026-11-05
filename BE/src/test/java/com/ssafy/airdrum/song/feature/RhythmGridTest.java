package com.ssafy.airdrum.song.feature;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import com.ssafy.airdrum.chart.ChartResponses.Note;
import com.ssafy.airdrum.chart.ChartResponses.Tempo;
import com.ssafy.airdrum.chart.ChartResponses.Timing;
import static org.assertj.core.api.Assertions.*;

class RhythmGridTest {
	/** 120BPM, 4/4: 한 박 500ms. 12칸이면 칸 하나가 약 41.67ms. */
	static final Timing T120 = new Timing(120, 0, "4/4", null, null, null);
	private static int counter;
	private static Note note(double timeMs, String pad) { return new Note("n" + counter++, timeMs, pad, null, null); }

	@Test void 킥은_정박에_하이햇은_정박과_뒷박에_모인다() {
		var notes = new ArrayList<Note>();
		for (int beat = 0; beat < 8; beat++) {
			notes.add(note(beat * 500, "KICK"));
			notes.add(note(beat * 500, "HIHAT"));
			notes.add(note(beat * 500 + 250, "HIHAT"));
		}
		var grid = RhythmGrid.compute(notes, T120).grid();
		assertThat(grid.groups().get("KICK").get(0)).isEqualTo(1.0);
		assertThat(grid.groups().get("HAT").get(0)).isEqualTo(0.5);
		assertThat(grid.groups().get("HAT").get(6)).isEqualTo(0.5); // 8분 뒷박 = 한 박의 절반 = 6칸
		assertThat(grid.unquantizedRatio()).isZero();
	}

	@Test void 십육분과_셋잇단음표를_다른_칸으로_구분한다() {
		var sixteenth = RhythmGrid.compute(List.of(note(125, "SNARE"), note(625, "SNARE")), T120).grid();
		assertThat(sixteenth.groups().get("SNARE").get(3)).isEqualTo(1.0); // 1/4박 = 3칸
		var triplet = RhythmGrid.compute(List.of(note(500.0 / 3, "SNARE"), note(500 + 500.0 / 3, "SNARE")), T120).grid();
		assertThat(triplet.groups().get("SNARE").get(4)).isEqualTo(1.0); // 1/3박 = 4칸
	}

	@Test void 패드_묶음은_정해진_대로_합쳐진다() {
		var notes = List.of(note(0, "HIHAT_PEDAL"), note(0, "RIDE"), note(0, "CRASH"), note(0, "SMALL_TOM"), note(0, "FLOOR_TOM"));
		var grid = RhythmGrid.compute(notes, T120).grid();
		assertThat(grid.groups().get("HAT").get(0)).isEqualTo(1.0);
		assertThat(grid.groups().get("CYMBAL").get(0)).isEqualTo(1.0);
		assertThat(grid.groups().get("TOM").get(0)).isEqualTo(1.0);
		assertThat(grid.groups().get("KICK")).containsOnly(0.0); // 노트가 없는 묶음은 전부 0
	}

	@Test void 곡_시작_오프셋을_뺀_위치로_계산한다() {
		var timing = new Timing(120, 100, "4/4", null, null, null);
		var grid = RhythmGrid.compute(List.of(note(100, "KICK"), note(600, "KICK")), timing).grid();
		assertThat(grid.groups().get("KICK").get(0)).isEqualTo(1.0);
	}

	@Test void 모르는_패드는_무시하고_모르는_패드뿐이면_제외한다() {
		var mixed = RhythmGrid.compute(List.of(note(0, "KICK"), note(0, "UNKNOWN_PAD")), T120).grid();
		assertThat(mixed.groups().get("KICK").get(0)).isEqualTo(1.0);
		var none = RhythmGrid.compute(List.of(note(0, "UNKNOWN_PAD")), T120);
		assertThat(none.grid()).isNull();
		assertThat(none.excluded()).isEqualTo(RhythmGrid.NO_KNOWN_PADS);
	}

	@Test void 가변_템포는_제외하고_같은_BPM만_반복된_템포맵은_허용한다() {
		var variable = new Timing(120, 0, "4/4", 480, List.of(new Tempo(0, 120), new Tempo(480, 140)), null);
		var result = RhythmGrid.compute(List.of(note(0, "KICK")), variable);
		assertThat(result.grid()).isNull();
		assertThat(result.excluded()).isEqualTo(RhythmGrid.VARIABLE_TEMPO);
		var constant = new Timing(120, 0, "4/4", 480, List.of(new Tempo(0, 120), new Tempo(480, 120)), null);
		assertThat(RhythmGrid.compute(List.of(note(0, "KICK")), constant).grid()).isNotNull();
	}

	@Test void 격자에서_벗어난_노트가_20퍼센트를_넘으면_제외한다() {
		var tenOneOff = new ArrayList<Note>();
		for (int i = 0; i < 9; i++) tenOneOff.add(note(i * 500, "KICK"));
		tenOneOff.add(note(9 * 500 + 20, "KICK")); // 20ms 어긋남 = 0.48칸
		var kept = RhythmGrid.compute(tenOneOff, T120);
		assertThat(kept.grid()).isNotNull();
		assertThat(kept.grid().unquantizedRatio()).isEqualTo(0.1);

		var threeOff = new ArrayList<Note>();
		for (int i = 0; i < 7; i++) threeOff.add(note(i * 500, "KICK"));
		for (int i = 7; i < 10; i++) threeOff.add(note(i * 500 + 20, "KICK"));
		var dropped = RhythmGrid.compute(threeOff, T120);
		assertThat(dropped.grid()).isNull();
		assertThat(dropped.excluded()).isEqualTo(RhythmGrid.OFF_GRID);
	}

	@Test void 저장_문서는_격자_또는_제외_사유_하나만_담는다() {
		var ok = RhythmGrid.compute(List.of(note(0, "KICK")), T120).document();
		assertThat(ok).containsKeys("divisions", "bpm", "timeSignature", "unquantizedRatio", "groups").doesNotContainKey("excluded");
		assertThat(ok.get("divisions")).isEqualTo(12);
		@SuppressWarnings("unchecked") var groups = (java.util.Map<String, List<Double>>) ok.get("groups");
		assertThat(groups.keySet()).containsExactlyElementsOf(RhythmGrid.GROUP_NAMES);
		assertThat(groups.values()).allSatisfy(bins -> assertThat(bins).hasSize(12));
		assertThat(RhythmGrid.excluded(RhythmGrid.VARIABLE_TEMPO).document()).containsOnlyKeys("excluded");
	}

	@Test void 같은_입력은_항상_같은_결과() {
		var notes = List.of(note(0, "KICK"), note(250, "HIHAT"), note(500, "SNARE"), note(750, "HIHAT"));
		assertThat(RhythmGrid.compute(notes, T120)).isEqualTo(RhythmGrid.compute(notes, T120));
	}
}
