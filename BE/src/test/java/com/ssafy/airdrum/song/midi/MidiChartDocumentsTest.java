package com.ssafy.airdrum.song.midi;

import java.math.BigDecimal;
import java.text.DecimalFormat;
import java.util.Locale;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.ssafy.airdrum.chart.ChartDocumentReader;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.song.midi.DifficultyThinner.Difficulty;
import com.ssafy.airdrum.song.midi.MidiSequenceReader.DrumSequence;
import com.ssafy.airdrum.song.midi.MidiSequenceReader.Signature;
import com.ssafy.airdrum.song.midi.MidiSequenceReader.Tempo;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import static com.ssafy.airdrum.song.midi.DrumPad.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 노트·timing JSON 생성(설계 3-3절, 4-2절). 생성 결과는 조회 API 리더로 다시 읽힌다. */
class MidiChartDocumentsTest {

	final JsonMapper json = JsonMapper.builder().build();
	final ChartDocumentReader reader = new ChartDocumentReader(json);
	final MidiChartDocuments documents = new MidiChartDocuments(json, reader);

	static DrumSequence seq(int ppq, List<Tempo> tempos, List<Signature> signatures, long lengthTicks) {
		return new DrumSequence(ppq, tempos, signatures, List.of(), lengthTicks);
	}

	static Map<Difficulty, List<DrumNote>> same(List<DrumNote> notes) {
		var map = new EnumMap<Difficulty, List<DrumNote>>(Difficulty.class);
		for (var d : Difficulty.values()) map.put(d, notes);
		return map;
	}

	JsonNode notes(MidiChartDocuments.Song song, Difficulty d) {
		return json.readTree(song.charts().get(d).notes());
	}

	JsonNode timing(MidiChartDocuments.Song song) {
		return json.readTree(song.charts().get(Difficulty.HARD).timing());
	}

	@Test
	void 노트_JSON은_noteId_정수_timeMs_패드_세기_notation을_가진다() {
		var song = documents.build(seq(480, List.of(new Tempo(0, 500_000)), List.of(), 0),
				same(List.of(new DrumNote(0, KICK, 110, 0), new DrumNote(480, SNARE, 90, 240),
						new DrumNote(480, HIHAT_PEDAL, 70, 30))));

		var notes = notes(song, Difficulty.HARD);
		assertThat(notes).hasSize(3);
		assertThat(notes.get(0).toString())
				.isEqualTo("{\"noteId\":\"n0001\",\"timeMs\":0,\"pad\":\"KICK\",\"velocityHint\":110,"
						+ "\"notation\":{\"tick\":0,\"durationTicks\":120,\"voice\":2}}");
		// 같은 tick은 DrumPad 순서(페달이 스네어보다 앞)
		assertThat(notes.get(1).get("pad").asString()).isEqualTo("HIHAT_PEDAL");
		assertThat(notes.get(1).get("notation").get("voice").asInt()).isEqualTo(2);
		assertThat(notes.get(2).get("pad").asString()).isEqualTo("SNARE");
		assertThat(notes.get(2).get("timeMs").isIntegralNumber()).isTrue();
		assertThat(notes.get(2).get("timeMs").asLong()).isEqualTo(500);
		assertThat(notes.get(2).get("notation").get("voice").asInt()).isEqualTo(1);
		assertThat(notes.get(2).get("notation").get("durationTicks").asLong()).isEqualTo(240);
		assertThat(song.charts().get(Difficulty.HARD).noteCount()).isEqualTo(3);
	}

	@Test
	void 템포_박자표가_없으면_120BPM_4_4를_tick_0에_넣는다() {
		var song = documents.build(seq(96, List.of(), List.of(), 0), same(List.of(new DrumNote(0, KICK, 100, 0))));

		assertThat(timing(song).toString()).isEqualTo("{\"bpm\":120.0,\"offsetMs\":0,\"timeSignature\":\"4/4\",\"ppq\":96,"
				+ "\"tempoMap\":[{\"tick\":0,\"bpm\":120.0}],\"timeSignatureMap\":[{\"tick\":0,\"numerator\":4,\"denominator\":4}]}");
		assertThat(song.bpm()).isEqualByComparingTo(new BigDecimal("120.00"));
		assertThat(song.timeSignature()).isEqualTo("4/4");
	}

	@Test
	void 첫_템포_박자표가_tick_0이_아니면_기본값을_앞에_넣는다() {
		var song = documents.build(seq(480, List.of(new Tempo(960, 1_000_000)), List.of(new Signature(1920, 3, 4)), 0),
				same(List.of(new DrumNote(1920, KICK, 100, 0))));

		var timing = timing(song);
		assertThat(timing.get("tempoMap").toString()).isEqualTo("[{\"tick\":0,\"bpm\":120.0},{\"tick\":960,\"bpm\":60.0}]");
		assertThat(timing.get("timeSignatureMap").toString())
				.isEqualTo("[{\"tick\":0,\"numerator\":4,\"denominator\":4},{\"tick\":1920,\"numerator\":3,\"denominator\":4}]");
		// 960 tick까지 120BPM 1000ms, 그다음 960 tick을 60BPM으로 2000ms
		assertThat(notes(song, Difficulty.HARD).get(0).get("timeMs").asLong()).isEqualTo(3000);
	}

	@Test
	void BPM은_소수_둘째_자리로_반올림하고_timeMs는_같은_값으로_계산한다() {
		var tempos = List.of(new Tempo(0, 451_128), new Tempo(1000, 666_667)); // 133.0000…, 89.99998…
		var noteTicks = new long[] { 0, 333, 999, 1000, 1001, 2777, 12345 };
		var notes = new ArrayList<DrumNote>();
		for (long t : noteTicks) notes.add(new DrumNote(t, SNARE, 100, 0));
		var song = documents.build(seq(480, tempos, List.of(new Signature(0, 7, 8)), 0), same(notes));

		var timing = timing(song);
		assertThat(timing.get("bpm").asDouble()).isEqualTo(133.0);
		assertThat(timing.get("tempoMap").get(1).get("bpm").asDouble()).isEqualTo(90.0);
		assertThat(song.bpm()).isEqualByComparingTo(new BigDecimal("133.00"));
		assertThat(song.timeSignature()).isEqualTo("7/8");
		var parsed = reader.timing(timing.toString());
		var out = notes(song, Difficulty.HARD);
		for (int i = 0; i < noteTicks.length; i++) {
			assertThat(out.get(i).get("timeMs").asLong()).as("tick %d", noteTicks[i])
					.isEqualTo(Math.round(reader.milliseconds(parsed, noteTicks[i])));
		}
	}

	@Test
	void 곡_길이는_마지막_노트에서_한_마디_뒤와_시퀀스_길이_중_긴_쪽이다() {
		// 120BPM 4/4, ppq 480: 한 마디 1920 tick = 2000ms
		var last = List.of(new DrumNote(1920, KICK, 100, 0));
		assertThat(documents.build(seq(480, List.of(), List.of(), 100), same(last)).durationMs()).isEqualTo(4000);
		assertThat(documents.build(seq(480, List.of(), List.of(), 9600), same(last)).durationMs()).isEqualTo(10000);
		// 3/4면 한 마디 1440 tick
		assertThat(documents.build(seq(480, List.of(), List.of(new Signature(0, 3, 4)), 0), same(last)).durationMs())
				.isEqualTo(3500);
	}

	@Test
	void 곡_길이가_30분을_넘으면_422() {
		// 120BPM에서 ppq 480 → 1분 = 57,600 tick. 30분 = 1,728,000 tick
		var notes = List.of(new DrumNote(0, KICK, 100, 0));
		assertThatThrownBy(() -> documents.build(seq(480, List.of(), List.of(), 1_728_001), same(notes)))
				.isInstanceOfSatisfying(BusinessException.class,
						e -> assertThat(e.getErrorCode()).isEqualTo(MidiErrorCode.UNSUPPORTED));
		assertThat(documents.build(seq(480, List.of(), List.of(), 1_726_000), same(notes)).durationMs())
				.isEqualTo(1_797_917);
	}

	@Test
	void noteId는_4자리를_넘으면_자릿수가_늘어난다() {
		var notes = new ArrayList<DrumNote>();
		for (int i = 0; i < 20_000; i++) notes.add(new DrumNote(i * 10L, KICK, 100, 0));
		var charts = new EnumMap<Difficulty, List<DrumNote>>(Difficulty.class);
		charts.put(Difficulty.HARD, notes);
		charts.put(Difficulty.NORMAL, List.of());
		charts.put(Difficulty.EASY, List.of());
		var song = documents.build(seq(480, List.of(), List.of(), 0), charts);

		var out = notes(song, Difficulty.HARD);
		assertThat(out.get(0).get("noteId").asString()).isEqualTo("n0001");
		assertThat(out.get(9_998).get("noteId").asString()).isEqualTo("n9999");
		assertThat(out.get(9_999).get("noteId").asString()).isEqualTo("n10000");
		assertThat(out.get(19_999).get("noteId").asString()).isEqualTo("n20000");
	}

	private record ReferenceNotation(long tick, long durationTicks, int voice) {}
	private record ReferenceNote(String noteId, long timeMs, String pad, int velocityHint, ReferenceNotation notation) {}

	@Test
	void 서로_다른_난이도와_로케일의_노트_JSON은_기존_직렬화와_같다() {
		Locale previous = Locale.getDefault(Locale.Category.FORMAT);
		try {
			for (Locale locale : List.of(Locale.ENGLISH, Locale.KOREAN, Locale.forLanguageTag("ar"),
					Locale.forLanguageTag("fa"), Locale.forLanguageTag("th-TH-u-nu-thai"))) {
				Locale.setDefault(Locale.Category.FORMAT, locale);
				var all = new ArrayList<DrumNote>();
				for (int i = DrumPad.values().length - 1; i >= 0; i--)
					all.add(new DrumNote(i * 240L, DrumPad.values()[i], 90 + i, i == 0 ? 0 : 30));
				var charts = new EnumMap<Difficulty, List<DrumNote>>(Difficulty.class);
				charts.put(Difficulty.HARD, all);
				charts.put(Difficulty.NORMAL, new ArrayList<>(all.subList(0, 6)));
				charts.put(Difficulty.EASY, new ArrayList<>(all.subList(3, 6)));
				var song = documents.build(seq(480, List.of(new Tempo(0, 500_000)), List.of(), 0), charts);
				var formatter = new DecimalFormat("'n'0000");
				for (var difficulty : Difficulty.values()) {
					var sorted = new ArrayList<>(charts.get(difficulty));
					sorted.sort(DifficultyThinner.ORDER);
					var timing = reader.timing(song.charts().get(difficulty).timing());
					var expected = new ArrayList<ReferenceNote>();
					for (int i = 0; i < sorted.size(); i++) {
						var n = sorted.get(i);
						expected.add(new ReferenceNote(formatter.format(i + 1), Math.round(reader.milliseconds(timing, n.tick())),
								n.pad().name(), n.velocity(), new ReferenceNotation(n.tick(), n.durationTicks() > 0 ? n.durationTicks() : 120, n.pad().voice())));
					}
					assertThat(song.charts().get(difficulty).notes()).as("locale=%s difficulty=%s", locale, difficulty)
							.isEqualTo(json.writeValueAsString(expected));
				}
			}
		} finally {
			Locale.setDefault(Locale.Category.FORMAT, previous);
		}
	}

	@Test
	void 생성한_문서는_조회_리더가_그대로_읽는다() {
		var song = documents.build(seq(480, List.of(new Tempo(0, 500_000), new Tempo(1920, 600_000)),
				List.of(new Signature(0, 4, 4), new Signature(1920, 6, 8)), 3840),
				same(List.of(new DrumNote(0, KICK, 100, 0), new DrumNote(0, CRASH, 120, 0), new DrumNote(2400, RIDE, 64, 0))));

		for (var d : Difficulty.values()) {
			var built = song.charts().get(d);
			var detail = reader.detail(new MidiChartDocuments.Draft(built.notes(), built.timing(), built.noteCount(),
					song.durationMs()));
			assertThat(detail.notes()).hasSize(3);
			assertThat(detail.timing().ppq()).isEqualTo(480);
			assertThat(detail.timing().timeSignatureMap()).hasSize(2);
		}
	}

	@Test
	void 노트_2만개를_1초_안에_만든다() {
		var notes = new ArrayList<DrumNote>();
		for (int i = 0; i < 20_000; i++) notes.add(new DrumNote(i * 60L, DrumPad.values()[i % 9], 100, 30));
		long start = System.nanoTime();
		documents.build(seq(480, List.of(new Tempo(0, 500_000)), List.of(), 0), same(notes));
		assertThat((System.nanoTime() - start) / 1_000_000).isLessThan(1000);
	}

}
