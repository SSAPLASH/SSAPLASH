package com.ssafy.airdrum.song.midi;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.ssafy.airdrum.song.midi.MidiSequenceReader.DrumEvent;

import static org.assertj.core.api.Assertions.assertThat;

/** GM 피치 → 패드 표(설계 3-4절). 0~127 전 범위를 표와 대조한다. */
class GmDrumMappingTest {

	static final Map<Integer, DrumPad> EXPECTED = new HashMap<>();
	static {
		put(DrumPad.KICK, 35, 36);
		put(DrumPad.SNARE, 37, 38, 40);
		put(DrumPad.HIHAT, 42, 46, 22, 26);
		put(DrumPad.HIHAT_PEDAL, 44);
		put(DrumPad.SMALL_TOM, 48, 50);
		put(DrumPad.MID_TOM, 45, 47);
		put(DrumPad.FLOOR_TOM, 41, 43, 58);
		put(DrumPad.CRASH, 49, 57, 55, 52);
		put(DrumPad.RIDE, 51, 59, 53);
	}

	static void put(DrumPad pad, int... pitches) {
		for (int p : pitches) EXPECTED.put(p, pad);
	}

	@Test
	void 표의_피치만_패드로_바꾸고_나머지는_제외한다() {
		for (int pitch = 0; pitch <= 127; pitch++) {
			assertThat(GmDrumMapping.pad(pitch)).as("pitch %d", pitch).isEqualTo(EXPECTED.get(pitch));
		}
	}

	@Test
	void 클랩_탬버린_카우벨은_제외한다() {
		assertThat(GmDrumMapping.pad(39)).isNull();
		assertThat(GmDrumMapping.pad(54)).isNull();
		assertThat(GmDrumMapping.pad(56)).isNull();
	}

	@Test
	void 드럼_이벤트를_패드_노트로_바꾸고_표에_없는_피치는_버린다() {
		var notes = GmDrumMapping.notes(List.of(new DrumEvent(0, 36, 110, 0), new DrumEvent(0, 56, 90, 10),
				new DrumEvent(240, 44, 70, 30)));

		assertThat(notes).containsExactly(new DrumNote(0, DrumPad.KICK, 110, 0), new DrumNote(240, DrumPad.HIHAT_PEDAL, 70, 30));
	}

	@Test
	void 범위_밖_피치는_제외한다() {
		assertThat(GmDrumMapping.pad(-1)).isNull();
		assertThat(GmDrumMapping.pad(128)).isNull();
	}

}
