package com.ssafy.airdrum.song.feature;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import com.ssafy.airdrum.chart.ChartResponses.Note;
import com.ssafy.airdrum.song.SongLevelService;
import static org.assertj.core.api.Assertions.*;

class ChartFeaturesTest {
	private static Note note(int index, double timeMs, String pad) { return new Note("n" + index, timeMs, pad, null, null); }

	@Test void 밀도와_2초_창_최대치를_난이도_산정과_같은_기준으로_센다() {
		var notes = new ArrayList<Note>();
		// 0~1500ms에 4개, 그 뒤 8초 동안 2개: 곡 길이 10초
		for (int i = 0; i < 4; i++) notes.add(note(i, i * 500, "SNARE"));
		notes.add(note(4, 5000, "KICK"));
		notes.add(note(5, 9000, "KICK"));
		var features = ChartFeatures.compute(notes, 10_000);
		assertThat(features.avgNotesPerSec()).isEqualTo(0.6);
		assertThat(features.peakNotes2s()).isEqualTo(4);
	}

	@Test void 같은_노트는_난이도_산정과_같은_2초_창_결과를_준다() {
		var notes = new ArrayList<Note>();
		for (int i = 0; i < 30; i++) notes.add(note(i, i * 100, i % 2 == 0 ? "SNARE" : "KICK"));
		var level = SongLevelService.calculate(notes, 4000);
		var features = ChartFeatures.compute(notes, 4000);
		// 30개가 3초에 있으니 2초 창에는 최대 20개이며 ADVANCED 기준(16)을 넘는다.
		assertThat(features.peakNotes2s()).isEqualTo(20);
		assertThat(level).isEqualTo(SongLevelService.Level.ADVANCED);
	}

	@Test void 패드_비율의_합은_1이고_이름순으로_고정된다() {
		var notes = List.of(note(0, 0, "SNARE"), note(1, 500, "KICK"), note(2, 1000, "SNARE"), note(3, 1500, "HIHAT"));
		var features = ChartFeatures.compute(notes, 4000);
		assertThat(features.padRatio()).containsExactly(
				java.util.Map.entry("HIHAT", 0.25), java.util.Map.entry("KICK", 0.25), java.util.Map.entry("SNARE", 0.5));
	}

	@Test void 동시_타격은_전환으로_세지_않고_같은_패드_반복도_세지_않는다() {
		var notes = List.of(note(0, 0, "KICK"), note(1, 0, "HIHAT"), note(2, 500, "HIHAT"), note(3, 1000, "SNARE"));
		var features = ChartFeatures.compute(notes, 4000);
		// 시간이 다른 쌍은 (HIHAT,HIHAT) 500ms, (HIHAT,SNARE) 1000ms 둘이고 전환은 HIHAT>SNARE 하나다.
		assertThat(features.transitionRatio()).containsExactly(java.util.Map.entry("HIHAT>SNARE", 0.5));
	}

	@Test void 전환은_상위_12개만_남긴다() {
		var notes = new ArrayList<Note>();
		String[] pads = { "A", "B", "C", "D", "E", "F", "G" };
		for (int i = 0; i < 80; i++) notes.add(note(i, i * 100, pads[(i * 3 + i / 7) % pads.length]));
		assertThat(ChartFeatures.compute(notes, 10_000).transitionRatio().size()).isLessThanOrEqualTo(ChartFeatures.TOP_TRANSITIONS);
	}

	@Test void 같은_입력은_항상_같은_결과() {
		var notes = List.of(note(0, 0, "KICK"), note(1, 400, "SNARE"), note(2, 800, "KICK"));
		assertThat(ChartFeatures.compute(notes, 3000)).isEqualTo(ChartFeatures.compute(notes, 3000));
	}

	@Test void 길이가_없거나_노트가_없으면_거부한다() {
		assertThatThrownBy(() -> ChartFeatures.compute(List.of(), 1000)).isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> ChartFeatures.compute(List.of(note(0, 0, "KICK")), 0)).isInstanceOf(IllegalArgumentException.class);
	}
}
