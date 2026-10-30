package com.ssafy.airdrum.song.midi;

import java.util.List;

import org.junit.jupiter.api.Test;

import com.ssafy.airdrum.song.midi.DifficultyThinner.Difficulty;

import static com.ssafy.airdrum.song.midi.DrumPad.*;
import static org.assertj.core.api.Assertions.assertThat;

/** 난이도 솎기 규칙 midi-rule-1.1(설계 4-3절). ppq 480 기준: 4분 480, 8분 240, 16분 120, 32분 60. */
class DifficultyThinnerTest {

	static final int PPQ = 480;

	static DrumNote n(long tick, DrumPad pad) {
		return new DrumNote(tick, pad, 100, 60);
	}

	static DrumNote n(long tick, DrumPad pad, int velocity) {
		return new DrumNote(tick, pad, velocity, 60);
	}

	static List<DrumNote> thin(Difficulty difficulty, DrumNote... notes) {
		return DifficultyThinner.thin(List.of(notes), PPQ).get(difficulty);
	}

	@Test
	void HARD는_전부_남기고_같은_tick_패드는_세기가_큰_것_하나로_합친다() {
		var hard = thin(Difficulty.HARD, n(0, SNARE, 80), n(0, SNARE, 110), n(120, HIHAT), n(60, HIHAT, 30));

		assertThat(hard).containsExactly(n(0, SNARE, 110), n(60, HIHAT, 30), n(120, HIHAT));
	}

	@Test
	void 결과는_tick_그다음_패드_순서다() {
		var hard = thin(Difficulty.HARD, n(0, RIDE), n(0, KICK), n(0, HIHAT_PEDAL), n(0, SNARE));

		assertThat(hard).extracting(DrumNote::pad).containsExactly(KICK, HIHAT_PEDAL, SNARE, RIDE);
	}

	@Test
	void NORMAL은_하이햇_라이드_페달을_8분_격자에만_남긴다() {
		var normal = thin(Difficulty.NORMAL, n(0, HIHAT), n(120, HIHAT), n(240, HIHAT), n(360, RIDE), n(480, RIDE),
				n(600, HIHAT_PEDAL), n(720, HIHAT_PEDAL));

		assertThat(normal).containsExactly(n(0, HIHAT), n(240, HIHAT), n(480, RIDE), n(720, HIHAT_PEDAL));
	}

	@Test
	void 격자_판정은_32분음표_절반까지_흔들림을_허용한다() {
		// 허용 오차 ppq/8 = 60
		var normal = thin(Difficulty.NORMAL, n(0, HIHAT), n(240 + 55, HIHAT), n(480 - 60, HIHAT), n(720 + 61, HIHAT));

		assertThat(normal).extracting(DrumNote::tick).containsExactly(0L, 295L, 420L);
	}

	@Test
	void NORMAL은_스네어_고스트만_빼고_다른_약한_노트는_남긴다() {
		var normal = thin(Difficulty.NORMAL, n(0, KICK, 30), n(240, SNARE, 39), n(480, SNARE, 40), n(720, SMALL_TOM, 20));

		assertThat(normal).containsExactly(n(0, KICK, 30), n(480, SNARE, 40), n(720, SMALL_TOM, 20));
	}

	@Test
	void NORMAL은_같은_시각_2개까지_우선순위로_남긴다() {
		var normal = thin(Difficulty.NORMAL, n(0, HIHAT), n(0, KICK), n(0, CRASH), n(0, SNARE));

		assertThat(normal).extracting(DrumNote::pad).containsExactly(KICK, SNARE);
	}

	@Test
	void NORMAL은_16분음표보다_가까운_노트를_우선순위로_정리한다() {
		// 32분(60) 간격: 우선순위가 높은 스네어가 이긴다. 16분(120) 간격은 둘 다 남는다.
		var normal = thin(Difficulty.NORMAL, n(0, KICK), n(60, SNARE), n(180, SMALL_TOM), n(300, MID_TOM));

		assertThat(normal).containsExactly(n(60, SNARE), n(180, SMALL_TOM), n(300, MID_TOM));
	}

	@Test
	void 간격이_가깝고_우선순위가_같으면_세기가_큰_쪽_같으면_먼저_친_쪽을_남긴다() {
		assertThat(thin(Difficulty.NORMAL, n(0, SNARE, 80), n(60, SNARE, 90))).containsExactly(n(60, SNARE, 90));
		assertThat(thin(Difficulty.NORMAL, n(0, SNARE, 90), n(60, SNARE, 90))).containsExactly(n(0, SNARE, 90));
	}

	@Test
	void EASY는_페달만_빼고_4분_격자만_남긴다() {
		var easy = thin(Difficulty.EASY, n(0, KICK), n(0, HIHAT), n(240, SNARE), n(240, HIHAT), n(480, SNARE), n(480, RIDE),
				n(960, HIHAT_PEDAL), n(1440, FLOOR_TOM));

		assertThat(easy).containsExactly(n(0, KICK), n(0, HIHAT), n(480, SNARE), n(480, RIDE), n(1440, FLOOR_TOM));
	}

	@Test
	void EASY는_약한_노트를_모두_빼고_같은_시각_2개까지_남긴다() {
		var easy = thin(Difficulty.EASY, n(0, KICK), n(0, SNARE), n(0, CRASH), n(480, KICK, 39), n(960, KICK, 40));

		assertThat(easy).containsExactly(n(0, KICK), n(0, SNARE), n(960, KICK, 40));
	}

	@Test
	void EASY가_비면_NORMAL을_NORMAL이_비면_HARD를_쓴다() {
		// 16분 엇박 하이햇만 있는 곡: NORMAL·EASY 규칙으로는 아무것도 안 남는다.
		var notes = List.of(n(120, HIHAT), n(360, HIHAT));
		var charts = DifficultyThinner.thin(notes, PPQ);

		assertThat(charts.get(Difficulty.HARD)).containsExactlyElementsOf(notes);
		assertThat(charts.get(Difficulty.NORMAL)).containsExactlyElementsOf(notes);
		assertThat(charts.get(Difficulty.EASY)).containsExactlyElementsOf(notes);
	}

	@Test
	void EASY만_비면_NORMAL을_쓴다() {
		var charts = DifficultyThinner.thin(List.of(n(0, HIHAT_PEDAL), n(240, HIHAT_PEDAL)), PPQ);

		assertThat(charts.get(Difficulty.EASY)).isEqualTo(charts.get(Difficulty.NORMAL));
		assertThat(charts.get(Difficulty.NORMAL)).hasSize(2);
	}

	@Test
	void ppq가_4로_나누어떨어지지_않아도_격자를_판정한다() {
		var normal = DifficultyThinner.thin(List.of(n(0, HIHAT), n(48, HIHAT), n(96, HIHAT)), 96).get(Difficulty.NORMAL);

		assertThat(normal).extracting(DrumNote::tick).containsExactly(0L, 48L, 96L);
	}

}
