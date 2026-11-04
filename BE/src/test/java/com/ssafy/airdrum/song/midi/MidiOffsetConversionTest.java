package com.ssafy.airdrum.song.midi;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.ssafy.airdrum.chart.ChartDocumentReader;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.song.midi.DifficultyThinner.Difficulty;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

/**
 * 260번 설계 4-1·4-2절: 공용 곡 카탈로그의 offsetMs(원본 음원 0초 기준 첫 마디 첫 박)를 솎기 격자와 notation.tick의 원점으로 쓴다.
 * AI MIDI는 0틱 = 음원 0초라 첫 박이 0틱이 아니다. 업타운펑크(1840ms, 115 BPM)와 같은 조건을 PPQ 480으로 만든다.
 */
class MidiOffsetConversionTest {

	static final int PPQ = 480;
	/** 1840ms × 115 BPM × 480 / 60000 = 1692.8 → 1693틱. */
	static final long FIRST = 1693;

	final JsonMapper json = JsonMapper.builder().build();
	final ChartDocumentReader reader = new ChartDocumentReader(json);
	final MidiChartConverter converter = new MidiChartConverter(new MidiSequenceReader(), new MidiChartDocuments(json, reader));

	/** 첫 박부터 4마디: 정박마다 킥(36), 8분 뒷박마다 스네어(38). */
	static byte[] uptown() {
		var midi = MidiFixtures.ppq(PPQ).tempo(0, 115);
		for (int beat = 0; beat < 16; beat++) {
			midi.drum(FIRST + beat * 480L, 36);
			midi.drum(FIRST + beat * 480L + 240, 38);
		}
		return midi.bytes();
	}

	JsonNode notes(MidiChartDocuments.Song song, Difficulty d) {
		return json.readTree(song.charts().get(d).notes());
	}

	JsonNode timing(MidiChartDocuments.Song song) {
		return json.readTree(song.charts().get(Difficulty.HARD).timing());
	}

	static List<String> pads(JsonNode notes) {
		var pads = new ArrayList<String>();
		for (var n : notes) pads.add(n.path("pad").asString());
		return pads;
	}

	@Test
	void offsetMs를_주면_첫_박이_0틱이_되고_timing과_곡에_offsetMs가_남는다() {
		var song = converter.convert(uptown(), 1840);

		assertThat(song.offsetMs()).isEqualTo(1840);
		var timing = timing(song);
		assertThat(timing.path("offsetMs").asInt()).isEqualTo(1840);
		assertThat(timing.path("tempoMap").get(0).path("tick").asLong()).isZero();
		assertThat(timing.path("tempoMap").get(0).path("bpm").asDouble()).isEqualTo(115.0);
		var hard = notes(song, Difficulty.HARD);
		assertThat(hard).hasSize(32);
		assertThat(hard.get(0).path("notation").path("tick").asLong()).isZero();
		assertThat(hard.get(0).path("timeMs").asLong()).isEqualTo(1840);
		assertThat(hard.get(2).path("notation").path("tick").asLong()).isEqualTo(480);
		// 곡 길이도 음원 0초부터: 마지막 노트(7440틱) + 한 마디(1920틱)의 ms에 offsetMs를 더한다.
		assertThat(song.durationMs()).isEqualTo((int) Math.round(1840 + 9360 * 60000.0 / PPQ / 115));
	}

	@Test
	void 노트_시각은_offsetMs와_상관없이_원본_MIDI_시각과_같다() {
		var shifted = notes(converter.convert(uptown(), 1840), Difficulty.HARD);
		var original = notes(converter.convert(uptown(), 0), Difficulty.HARD);

		assertThat(shifted).hasSameSizeAs(original);
		for (int i = 0; i < original.size(); i++)
			assertThat(shifted.get(i).path("timeMs").asDouble()).as("노트 %d", i)
					.isCloseTo(original.get(i).path("timeMs").asDouble(), within(1.0));
	}

	@Test
	void 격자가_첫_박에서_시작해_정박_킥이_EASY에_남는다() {
		// offsetMs를 주면 정박 킥이 4분 격자 위, 뒷박 스네어는 격자 밖이다.
		var easy = notes(converter.convert(uptown(), 1840), Difficulty.EASY);
		assertThat(pads(easy)).hasSize(16).containsOnly("KICK");

		// offsetMs 0이면 격자가 0틱부터라 반대가 된다(1693 % 480 = 253: 킥이 격자 밖, 1933 % 480 = 13: 스네어가 격자 위).
		var wrong = notes(converter.convert(uptown(), 0), Difficulty.EASY);
		assertThat(pads(wrong)).hasSize(16).containsOnly("SNARE");
	}

	@Test
	void offsetMs_0은_기존_변환과_결과가_같다() {
		var before = converter.convert(uptown());
		var zero = converter.convert(uptown(), 0);

		assertThat(zero.offsetMs()).isZero();
		assertThat(zero.durationMs()).isEqualTo(before.durationMs());
		assertThat(zero.bpm()).isEqualTo(before.bpm());
		for (var d : Difficulty.values()) {
			assertThat(zero.charts().get(d).notes()).as(d.name()).isEqualTo(before.charts().get(d).notes());
			assertThat(zero.charts().get(d).timing()).as(d.name()).isEqualTo(before.charts().get(d).timing());
			assertThat(zero.charts().get(d).noteCount()).as(d.name()).isEqualTo(before.charts().get(d).noteCount());
		}
		assertThat(timing(before).path("offsetMs").asInt()).isZero();
	}

	@Test
	void 첫_박보다_32분음표_절반을_넘게_앞선_노트가_있으면_변환하지_않는다() {
		var early = MidiFixtures.ppq(PPQ).tempo(0, 115).drum(FIRST - 61, 36).drum(FIRST, 38).bytes();

		assertThatThrownBy(() -> converter.convert(early, 1840))
				.isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.getErrorCode()).isEqualTo(MidiErrorCode.UNSUPPORTED))
				.hasMessageContaining("offsetMs");
	}

	@Test
	void 첫_박보다_32분음표_절반_이내로_앞선_노트는_0틱으로_본다() {
		var near = MidiFixtures.ppq(PPQ).tempo(0, 115).drum(FIRST - 60, 36).drum(FIRST, 38).bytes();

		var hard = notes(converter.convert(near, 1840), Difficulty.HARD);
		assertThat(hard).hasSize(2);
		assertThat(hard.get(0).path("notation").path("tick").asLong()).isZero();
		assertThat(hard.get(1).path("notation").path("tick").asLong()).isZero();
	}

	@Test
	void 템포가_여러_개면_첫_박_틱을_템포_맵으로_역산하고_첫_박의_템포와_박자표를_0틱에_둔다() {
		// 0~960틱 120 BPM(1000ms), 이후 90 BPM: 1500ms = 960 + 500 × 90 × 480 / 60000 = 1320틱. 2280틱에서 60 BPM.
		var midi = MidiFixtures.ppq(PPQ).tempo(0, 120).tempo(960, 90).tempo(2280, 60).signature(0, 3, 2)
				.drum(1320, 36).drum(1800, 38).drum(2760, 36).bytes();

		var song = converter.convert(midi, 1500);
		var timing = timing(song);
		assertThat(timing.path("tempoMap").toString()).isEqualTo("[{\"tick\":0,\"bpm\":90.0},{\"tick\":960,\"bpm\":60.0}]");
		assertThat(timing.path("timeSignatureMap").toString()).isEqualTo("[{\"tick\":0,\"numerator\":3,\"denominator\":4}]");
		assertThat(timing.path("bpm").asDouble()).isEqualTo(90.0);
		var hard = notes(song, Difficulty.HARD);
		assertThat(hard.get(0).path("notation").path("tick").asLong()).isZero();
		assertThat(hard.get(0).path("timeMs").asLong()).isEqualTo(1500);
		assertThat(hard.get(1).path("notation").path("tick").asLong()).isEqualTo(480);
		var original = notes(converter.convert(midi, 0), Difficulty.HARD);
		for (int i = 0; i < 3; i++)
			assertThat(hard.get(i).path("timeMs").asDouble()).as("노트 %d", i)
					.isCloseTo(original.get(i).path("timeMs").asDouble(), within(1.0));
	}

	@Test
	void 사용자_MIDI_업로드_경로는_offsetMs_0이다() {
		assertThat(converter.convert(uptown()).offsetMs()).isZero();
	}
}
