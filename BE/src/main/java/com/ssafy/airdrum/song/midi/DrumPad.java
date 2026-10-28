package com.ssafy.airdrum.song.midi;

/**
 * MIDI 채보가 쓰는 패드(공통 명세서 9-2, FE {@code PadId}와 같은 이름).
 * 선언 순서가 같은 시각 노트의 저장 순서다(설계 3-3절). 발로 치는 패드는 악보 voice 2.
 */
enum DrumPad {
	KICK(true), HIHAT_PEDAL(true), SNARE(false), HIHAT(false), SMALL_TOM(false), MID_TOM(false), FLOOR_TOM(false),
	CRASH(false), RIDE(false);

	private final boolean foot;

	DrumPad(boolean foot) {
		this.foot = foot;
	}

	int voice() {
		return foot ? 2 : 1;
	}

}
