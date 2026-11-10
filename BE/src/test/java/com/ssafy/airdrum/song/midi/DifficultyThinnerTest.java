package com.ssafy.airdrum.song.midi;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

import org.junit.jupiter.api.Test;

import com.ssafy.airdrum.song.midi.DifficultyThinner.Difficulty;
import com.ssafy.airdrum.song.midi.DifficultyThinner.Tempo;

import static com.ssafy.airdrum.song.midi.DrumPad.*;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * 난이도 솎기 규칙 midi-rule-2.0(151 설계 4-3절, 328 설계 4-1절). ppq 480 기준: 4분 480, 8분 240, 16분 120, 32분 60.
 * 템포를 주지 않은 테스트는 120 BPM(4분 500ms)이다.
 */
class DifficultyThinnerTest {

	static final int PPQ = 480;

	static DrumNote n(long tick, DrumPad pad) {
		return new DrumNote(tick, pad, 100, 60);
	}

	static DrumNote n(long tick, DrumPad pad, int velocity) {
		return new DrumNote(tick, pad, velocity, 60);
	}

	static List<DrumNote> thin(Difficulty difficulty, DrumNote... notes) {
		return DifficultyThinner.thin(List.of(notes), PPQ, List.of()).get(difficulty);
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

	static Tempo bpm(long tick, int bpm) {
		return new Tempo(tick, (int) Math.round(60_000_000.0 / bpm));
	}

	static List<DrumNote> easy(List<Tempo> tempos, DrumNote... notes) {
		return DifficultyThinner.thin(List.of(notes), PPQ, tempos).get(Difficulty.EASY);
	}

	static DrumNote[] every(long from, long step, int count, DrumPad pad) {
		var notes = new DrumNote[count];
		for (int i = 0; i < count; i++) notes[i] = n(from + i * step, pad);
		return notes;
	}

	@Test
	void EASY는_세기로_거르지_않는다() {
		assertThat(easy(List.of(), n(0, KICK), n(480, SNARE, 39), n(960, KICK)))
				.containsExactly(n(0, KICK), n(480, SNARE, 39), n(960, KICK));
	}

	@Test
	void EASY는_페달을_빼고_같은_tick은_우선순위로_2개만_남긴다() {
		assertThat(easy(List.of(), n(0, KICK), n(0, SNARE), n(0, CRASH), n(0, HIHAT_PEDAL), n(480, HIHAT_PEDAL)))
				.containsExactly(n(0, KICK), n(0, SNARE));
	}

	@Test
	void EASY_박은_템포로_정한다() {
		// 서로 300ms 넘게 떨어진 노트: 0(2분 박), 1200(8분 뒷박), 2400(4분 박), 3840(2분 박)
		var notes = new DrumNote[] { n(0, KICK), n(1200, KICK), n(2400, KICK), n(3840, KICK) };
		// 84·100 BPM → 8분, 120 BPM(빈 목록) → 4분, 210 BPM → 2분
		assertThat(easy(List.of(bpm(0, 84)), notes)).extracting(DrumNote::tick).containsExactly(0L, 1200L, 2400L, 3840L);
		assertThat(easy(List.of(bpm(0, 100)), notes)).extracting(DrumNote::tick).containsExactly(0L, 1200L, 2400L, 3840L);
		assertThat(easy(List.of(), notes)).extracting(DrumNote::tick).containsExactly(0L, 2400L, 3840L);
		assertThat(easy(List.of(bpm(0, 210)), notes)).extracting(DrumNote::tick).containsExactly(0L, 3840L);
	}

	@Test
	void 첫_템포가_tick_0이_아니면_그_템포를_0부터_쓴다() {
		var notes = new DrumNote[] { n(0, KICK), n(1200, KICK), n(2400, KICK), n(3840, KICK) };
		assertThat(easy(List.of(bpm(960, 210)), notes)).extracting(DrumNote::tick).containsExactly(0L, 3840L);
	}

	@Test
	void 빠른_16분_필인은_박마다_대표_하나를_남긴다() {
		// 140 BPM: 4분 428ms(EASY 박), 16분 107ms. 탐 16분 8개(2박) + 다음 박 크래시
		var notes = new ArrayList<>(List.of(every(0, 120, 8, SMALL_TOM)));
		notes.add(n(960, CRASH));
		var easy = DifficultyThinner.thin(notes, PPQ, List.of(bpm(0, 140))).get(Difficulty.EASY);

		assertThat(easy).containsExactly(n(0, SMALL_TOM), n(480, SMALL_TOM), n(960, CRASH));
	}

	@Test
	void 느린_곡의_8분_하이햇은_그대로_남는다() {
		// 90 BPM 8분 = 333ms: 연타가 아니고 EASY 박도 8분이다
		assertThat(easy(List.of(bpm(0, 90)), every(0, 240, 8, HIHAT))).hasSize(8);
	}

	@Test
	void 빠른_곡의_8분_하이햇은_4분_박만_남는다() {
		// 160 BPM 8분 = 187.5ms: 곡 전체가 연타 구간, EASY 박은 4분(375ms)
		assertThat(easy(List.of(bpm(0, 160)), every(0, 240, 8, HIHAT))).extracting(DrumNote::tick)
				.containsExactly(0L, 480L, 960L, 1440L);
	}

	@Test
	void 엇박에서_끝나는_연타가_앞_정박을_지우지_않는다() {
		// 120 BPM: 킥(정박) 뒤 스네어 16분 3개가 엇박(360)에서 끝난다. 연타 칸은 0 하나뿐이다
		assertThat(easy(List.of(), n(0, KICK), n(120, SNARE), n(240, SNARE), n(360, SNARE), n(960, KICK)))
				.containsExactly(n(0, KICK), n(960, KICK));
	}

	@Test
	void 연타_구간에서_박_위가_비면_칸_안의_가장_가까운_묶음을_남긴다() {
		// 160 BPM: 정박 킥 뒤 엇박 스네어 3개(1320·1560·1800, 187ms 간격). 1440 칸에서 1320과 1560이 같은 거리 → 먼저 친 1320
		assertThat(easy(List.of(bpm(0, 160)), n(0, KICK), n(1320, SNARE), n(1560, SNARE), n(1800, SNARE)))
				.containsExactly(n(0, KICK), n(1320, SNARE));
	}

	@Test
	void 묶음_2개는_연타가_아니라_박_위만_본다() {
		// 위와 같은데 엇박 스네어가 2개(더블): 연타가 아니므로 둘 다 박 밖이라 빠진다
		assertThat(easy(List.of(bpm(0, 160)), n(0, KICK), n(1320, SNARE), n(1560, SNARE))).containsExactly(n(0, KICK));
	}

	@Test
	void 연타_칸_거리가_같으면_우선순위가_높은_쪽을_남긴다() {
		// 160 BPM, 1440 칸에서 1320 탐과 1560 스네어가 같은 거리 → 스네어
		assertThat(easy(List.of(bpm(0, 160)), n(0, KICK), n(1320, SMALL_TOM), n(1560, SNARE), n(1800, SMALL_TOM)))
				.containsExactly(n(0, KICK), n(1560, SNARE));
	}

	@Test
	void 템포가_바뀌면_구간마다_EASY_박을_다시_정한다() {
		// 0~1920 90 BPM(8분 333ms, 그대로), 1920부터 160 BPM(8분 187ms, 4분 박만)
		var easy = easy(List.of(bpm(0, 90), bpm(1920, 160)), every(0, 240, 16, HIHAT));

		assertThat(easy).extracting(DrumNote::tick)
				.containsExactly(0L, 240L, 480L, 720L, 960L, 1200L, 1440L, 1680L, 1920L, 2400L, 2880L, 3360L);
	}

	@Test
	void 템포_목록은_순서와_무관하다() {
		var notes = every(0, 240, 16, HIHAT);
		assertThat(easy(List.of(bpm(1920, 160), bpm(0, 90)), notes)).isEqualTo(easy(List.of(bpm(0, 90), bpm(1920, 160)), notes));
	}

	@Test
	void EASY에_남은_묶음_사이는_모두_225ms_이상이고_전부_HARD_노트다() {
		var random = new Random(328);
		for (int round = 0; round < 300; round++) {
			int tempoBpm = 50 + random.nextInt(200);
			var tempo = bpm(0, tempoBpm);
			var notes = new ArrayList<DrumNote>();
			long tick = 0;
			int count = 1 + random.nextInt(60);
			for (int i = 0; i < count; i++) {
				tick += random.nextInt(4) * 60L;
				var pads = DrumPad.values();
				notes.add(new DrumNote(tick, pads[random.nextInt(pads.length)], 1 + random.nextInt(127), 60));
			}
			var charts = DifficultyThinner.thin(notes, PPQ, List.of(tempo));
			var easy = charts.get(Difficulty.EASY);

			assertThat(charts.get(Difficulty.HARD)).containsAll(easy);
			if (easy == charts.get(Difficulty.NORMAL) || easy == charts.get(Difficulty.HARD)) continue;
			var ticks = easy.stream().map(DrumNote::tick).distinct().toList();
			for (int i = 1; i < ticks.size(); i++) {
				long gapMicrosTimesPpq = (ticks.get(i) - ticks.get(i - 1)) * (long) tempo.microsPerQuarter();
				assertThat(gapMicrosTimesPpq).as("%d BPM, %s", tempoBpm, ticks).isGreaterThanOrEqualTo(225_000L * PPQ);
			}
		}
	}

	@Test
	void EASY가_비면_NORMAL을_NORMAL이_비면_HARD를_쓴다() {
		// 16분 엇박 하이햇만 있는 곡: NORMAL·EASY 규칙으로는 아무것도 안 남는다.
		var notes = List.of(n(120, HIHAT), n(360, HIHAT));
		var charts = DifficultyThinner.thin(notes, PPQ, List.of());

		assertThat(charts.get(Difficulty.HARD)).containsExactlyElementsOf(notes);
		assertThat(charts.get(Difficulty.NORMAL)).containsExactlyElementsOf(notes);
		assertThat(charts.get(Difficulty.EASY)).containsExactlyElementsOf(notes);
	}

	@Test
	void EASY만_비면_NORMAL을_쓴다() {
		var charts = DifficultyThinner.thin(List.of(n(0, HIHAT_PEDAL), n(240, HIHAT_PEDAL)), PPQ, List.of());

		assertThat(charts.get(Difficulty.EASY)).isEqualTo(charts.get(Difficulty.NORMAL));
		assertThat(charts.get(Difficulty.NORMAL)).hasSize(2);
	}

	@Test
	void ppq가_4로_나누어떨어지지_않아도_격자를_판정한다() {
		var normal = DifficultyThinner.thin(List.of(n(0, HIHAT), n(48, HIHAT), n(96, HIHAT)), 96, List.of()).get(Difficulty.NORMAL);

		assertThat(normal).extracting(DrumNote::tick).containsExactly(0L, 48L, 96L);
	}

}
