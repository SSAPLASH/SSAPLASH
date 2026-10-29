package com.ssafy.airdrum.song.midi;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

import com.ssafy.airdrum.chart.ChartDocumentReader;
import com.ssafy.airdrum.chart.ChartResponses;
import com.ssafy.airdrum.chart.ChartVersionRepository;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.song.midi.DifficultyThinner.Difficulty;
import com.ssafy.airdrum.song.midi.MidiSequenceReader.DrumSequence;
import com.ssafy.airdrum.song.midi.MidiSequenceReader.Signature;
import com.ssafy.airdrum.song.midi.MidiSequenceReader.Tempo;

import tools.jackson.databind.json.JsonMapper;

/**
 * chart_versions.notes·timing JSON을 만든다(설계 3-3절, 4-2절). ms 계산은 조회 API의
 * {@link ChartDocumentReader#milliseconds}를 그대로 써서 악보 페이지 시간과 어긋나지 않게 한다.
 */
@Component
class MidiChartDocuments {

	/** MIDI 규격 기본값. 템포·박자표 메타가 없으면 tick 0에 넣는다. */
	private static final int DEFAULT_TEMPO_US = 500_000;
	private static final Signature DEFAULT_SIGNATURE = new Signature(0, 4, 4);
	static final int MAX_DURATION_MS = 30 * 60 * 1000;

	private final JsonMapper json;
	private final ChartDocumentReader reader;

	MidiChartDocuments(JsonMapper json, ChartDocumentReader reader) {
		this.json = json;
		this.reader = reader;
	}

	record Built(String notes, String timing, int noteCount) {}
	record Song(BigDecimal bpm, String timeSignature, int durationMs, Map<Difficulty, Built> charts) {}

	private record Notation(long tick, long durationTicks, int voice) {}
	private record Note(String noteId, long timeMs, String pad, int velocityHint, Notation notation) {}

	Song build(DrumSequence sequence, Map<Difficulty, List<DrumNote>> charts) {
		int ppq = sequence.ppq();
		var timing = timing(sequence);
		String timingJson = json.writeValueAsString(timing);
		var hard = charts.get(Difficulty.HARD);
		long lastTick = hard.isEmpty() ? 0 : hard.stream().mapToLong(DrumNote::tick).max().getAsLong();
		long endTick = Math.max(sequence.lengthTicks(), lastTick + barTicks(timing, lastTick));
		double durationMs = reader.milliseconds(timing, endTick);
		if (durationMs > MAX_DURATION_MS) throw new BusinessException(MidiErrorCode.UNSUPPORTED, "곡 길이는 30분 이하여야 합니다.");
		int duration = (int) Math.round(durationMs);

		var noteIds = new DecimalFormat("'n'0000");
		var built = new EnumMap<Difficulty, Built>(Difficulty.class);
		for (var entry : charts.entrySet()) {
			var sorted = new ArrayList<>(entry.getValue());
			sorted.sort(DifficultyThinner.ORDER);
			var notes = new ArrayList<Note>(sorted.size());
			for (int i = 0; i < sorted.size(); i++) {
				var n = sorted.get(i);
				long durationTicks = n.durationTicks() > 0 ? n.durationTicks() : Math.max(1, ppq / 4);
				notes.add(new Note(noteIds.format(i + 1), Math.round(reader.milliseconds(timing, n.tick())),
						n.pad().name(), n.velocity(), new Notation(n.tick(), durationTicks, n.pad().voice())));
			}
			var result = new Built(json.writeValueAsString(notes), timingJson, notes.size());
			// 조회 API가 못 읽는 채보는 저장하지 않는다. 실패는 생성기 버그다.
			reader.detail(new Draft(result.notes(), result.timing(), result.noteCount(), duration));
			built.put(entry.getKey(), result);
		}
		return new Song(BigDecimal.valueOf(timing.bpm()).setScale(2, RoundingMode.HALF_UP), timing.timeSignature(), duration,
				built);
	}

	private static ChartResponses.Timing timing(DrumSequence sequence) {
		var tempos = new ArrayList<ChartResponses.Tempo>();
		if (sequence.tempos().isEmpty() || sequence.tempos().getFirst().tick() != 0)
			tempos.add(new ChartResponses.Tempo(0, bpm(DEFAULT_TEMPO_US)));
		for (Tempo t : sequence.tempos()) tempos.add(new ChartResponses.Tempo(t.tick(), bpm(t.microsPerQuarter())));
		var signatures = new ArrayList<ChartResponses.Signature>();
		if (sequence.signatures().isEmpty() || sequence.signatures().getFirst().tick() != 0)
			signatures.add(signature(DEFAULT_SIGNATURE));
		for (Signature s : sequence.signatures()) signatures.add(signature(s));
		var first = signatures.getFirst();
		return new ChartResponses.Timing(tempos.getFirst().bpm(), 0, first.numerator() + "/" + first.denominator(),
				sequence.ppq(), List.copyOf(tempos), List.copyOf(signatures));
	}

	/** songs.bpm(numeric 6,2)과 같은 정밀도로 맞춘다. tempoMap과 ms 계산도 이 값을 쓴다. */
	private static double bpm(int microsPerQuarter) {
		return BigDecimal.valueOf(60_000_000.0 / microsPerQuarter).setScale(2, RoundingMode.HALF_UP).doubleValue();
	}

	private static ChartResponses.Signature signature(Signature s) {
		return new ChartResponses.Signature(s.tick(), s.numerator(), s.denominator());
	}

	/** tick 위치에 걸린 박자표의 한 마디 길이(tick). */
	private static long barTicks(ChartResponses.Timing timing, long tick) {
		var active = timing.timeSignatureMap().getFirst();
		for (var s : timing.timeSignatureMap()) if (s.tick() <= tick) active = s;
		return (long) active.numerator() * timing.ppq() * 4 / active.denominator();
	}

	/** 저장 전 자가 검증용 행. 조회 리더가 요구하는 값만 채운다. */
	record Draft(String notes, String timing, int noteCount, int duration) implements ChartVersionRepository.Detail {
		public String getNotes() { return notes; }
		public String getTiming() { return timing; }
		public int getNoteCount() { return noteCount; }
		public Integer getDurationMs() { return duration; }
		public int getSchemaVersion() { return 1; }
		public String getNotationStatus() { return "PENDING"; }
		public String getSheetPages() { return null; }
		public Long getSongId() { return 1L; }
		public Long getChartId() { return 1L; }
		public String getDifficulty() { return "HARD"; }
		public Long getChartVersionId() { return 1L; }
		public int getVersion() { return 1; }
		public String getTitle() { return "검증"; }
		public String getSource() { return "MIDI"; }
		public String getStatus() { return "READY"; }
	}

}
