package com.ssafy.airdrum.domain.song.service.midi;

import com.ssafy.airdrum.domain.chart.model.DrumNote;
import com.ssafy.airdrum.domain.chart.model.DrumPad;

import java.util.ArrayList;
import java.util.List;

import com.ssafy.airdrum.domain.song.service.midi.MidiSequenceReader.DrumEvent;

/**
 * GM 드럼 피치 → 패드(설계 3-4절). AI 파트 {@code gmd.py}의 표와 맞추되 44(페달 하이햇)는 따로 둔다.
 * 표에 없는 피치(클랩·탬버린·카우벨 등)는 null이며 채보에서 뺀다.
 */
final class GmDrumMapping {

	private static final DrumPad[] TABLE = new DrumPad[128];
	static {
		put(DrumPad.KICK, 35, 36);
		put(DrumPad.SNARE, 37, 38, 40);
		put(DrumPad.HIHAT, 22, 26, 42, 46);
		put(DrumPad.HIHAT_PEDAL, 44);
		put(DrumPad.SMALL_TOM, 48, 50);
		put(DrumPad.MID_TOM, 45, 47);
		put(DrumPad.FLOOR_TOM, 41, 43, 58);
		put(DrumPad.CRASH, 49, 52, 55, 57);
		put(DrumPad.RIDE, 51, 53, 59);
	}

	private GmDrumMapping() {}

	static DrumPad pad(int pitch) {
		return pitch < 0 || pitch >= TABLE.length ? null : TABLE[pitch];
	}

	/** 표에 있는 피치만 패드 노트로 바꾼다. 순서는 입력 순서 그대로다. */
	static List<DrumNote> notes(List<DrumEvent> events) {
		var notes = new ArrayList<DrumNote>();
		for (var e : events) {
			var pad = pad(e.pitch());
			if (pad != null) notes.add(new DrumNote(e.tick(), pad, e.velocity(), e.durationTicks(),
					e.pitch() == 46 ? Boolean.TRUE : null));
		}
		return List.copyOf(notes);
	}

	private static void put(DrumPad pad, int... pitches) {
		for (int p : pitches) TABLE[p] = pad;
	}

}
