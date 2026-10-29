package com.ssafy.airdrum.song.midi;

/** 패드로 바꾼 드럼 노트 하나. durationTicks는 note-off까지의 tick이며 없으면 0. */
public record DrumNote(long tick, DrumPad pad, int velocity, long durationTicks) {}
