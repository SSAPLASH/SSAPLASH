package com.ssafy.airdrum.song.midi;

import java.io.StringWriter;
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
public class MidiChartDocuments {

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

	public record Built(String notes, String timing, int noteCount) {}
	/** {@code offsetMs}는 원본 음원 0초 기준 첫 박 시각이다. 사용자 MIDI 업로드는 0(260번 설계 3-3절). */
	public record Song(BigDecimal bpm, String timeSignature, int durationMs, int offsetMs, Map<Difficulty, Built> charts) {}
	/** 첫 박을 0틱으로 옮긴 시퀀스와 노트. */
	record Rebased(DrumSequence sequence, List<DrumNote> notes) {}

	Song build(DrumSequence sequence, Map<Difficulty, List<DrumNote>> charts) {
		return build(sequence, 0, charts);
	}

	/**
	 * 첫 박(원본 음원 {@code offsetMs})을 0틱으로 옮긴다(260번 설계 4-1·4-2절). 노트·템포·박자표·길이 tick에서 첫 박 tick을 빼고,
	 * 첫 박에 걸린 템포·박자표를 0틱에 둔다. 그래서 솎기 격자와 notation.tick이 첫 박에서 시작하고, timeMs는 offsetMs + tick의 ms가 된다.
	 * 첫 박보다 32분음표 절반(ppq/8) 넘게 앞선 노트가 있으면 변환하지 않는다(설계 U1). 그 안쪽은 0틱으로 본다.
	 */
	Rebased rebase(DrumSequence sequence, List<DrumNote> notes, int offsetMs) {
		if (offsetMs == 0) return new Rebased(sequence, notes);
		var original = timing(sequence, 0);
		long first = tickAt(original, offsetMs);
		long tolerance = sequence.ppq() / 8;
		long earliest = Long.MAX_VALUE;
		var moved = new ArrayList<DrumNote>(notes.size());
		for (var n : notes) {
			long tick = n.tick() - first;
			if (tick < -tolerance) earliest = Math.min(earliest, n.tick());
			moved.add(new DrumNote(Math.max(0, tick), n.pad(), n.velocity(), n.durationTicks()));
		}
		if (earliest != Long.MAX_VALUE)
			throw new BusinessException(MidiErrorCode.UNSUPPORTED, "offsetMs(" + offsetMs + "ms)보다 앞선 드럼 노트가 있습니다(첫 노트 "
					+ Math.round(reader.milliseconds(original, earliest)) + "ms). offsetMs는 첫 노트와 같거나 앞이어야 합니다.");
		var tempos = new ArrayList<Tempo>();
		for (var t : sequence.tempos()) {
			if (t.tick() <= first) tempos.clear();
			tempos.add(new Tempo(Math.max(0, t.tick() - first), t.microsPerQuarter()));
		}
		var signatures = new ArrayList<Signature>();
		for (var sig : sequence.signatures()) {
			if (sig.tick() <= first) signatures.clear();
			signatures.add(new Signature(Math.max(0, sig.tick() - first), sig.numerator(), sig.denominator()));
		}
		var events = new ArrayList<MidiSequenceReader.DrumEvent>(sequence.events().size());
		for (var e : sequence.events())
			events.add(new MidiSequenceReader.DrumEvent(Math.max(0, e.tick() - first), e.pitch(), e.velocity(), e.durationTicks()));
		var shifted = new DrumSequence(sequence.ppq(), List.copyOf(tempos), List.copyOf(signatures), List.copyOf(events),
				Math.max(0, sequence.lengthTicks() - first));
		return new Rebased(shifted, List.copyOf(moved));
	}

	/** {@code ms}(offset 0 기준)에 해당하는 가장 가까운 tick. 템포 맵을 앞에서부터 적분한다. */
	private static long tickAt(ChartResponses.Timing timing, double ms) {
		var map = timing.tempoMap();
		double at = 0;
		for (int i = 0; i < map.size(); i++) {
			var tempo = map.get(i);
			double span = i + 1 < map.size() ? (map.get(i + 1).tick() - tempo.tick()) * 60000.0 / timing.ppq() / tempo.bpm()
					: Double.POSITIVE_INFINITY;
			if (ms <= at + span) return Math.round(tempo.tick() + (ms - at) * tempo.bpm() * timing.ppq() / 60000.0);
			at += span;
		}
		throw new IllegalStateException("템포 맵이 비어 있습니다.");
	}

	Song build(DrumSequence sequence, int offsetMs, Map<Difficulty, List<DrumNote>> charts) {
		int ppq = sequence.ppq();
		var timing = timing(sequence, offsetMs);
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
			var output = new StringWriter();
			try (var generator = json.createGenerator(output)) {
				generator.writeStartArray();
				for (int i = 0; i < sorted.size(); i++) {
					var n = sorted.get(i);
					long durationTicks = n.durationTicks() > 0 ? n.durationTicks() : Math.max(1, ppq / 4);
					generator.writeStartObject();
					generator.writeStringProperty("noteId", noteIds.format(i + 1));
					generator.writeNumberProperty("timeMs", Math.round(reader.milliseconds(timing, n.tick())));
					generator.writeStringProperty("pad", n.pad().name());
					generator.writeNumberProperty("velocityHint", n.velocity());
					generator.writeName("notation");
					generator.writeStartObject();
					generator.writeNumberProperty("tick", n.tick());
					generator.writeNumberProperty("durationTicks", durationTicks);
					generator.writeNumberProperty("voice", n.pad().voice());
					generator.writeEndObject();
					generator.writeEndObject();
				}
				generator.writeEndArray();
			}
			var result = new Built(output.toString(), timingJson, sorted.size());
			// 조회 API가 못 읽는 채보는 저장하지 않는다. 실패는 생성기 버그다.
			reader.detail(new Draft(result.notes(), result.timing(), result.noteCount(), duration));
			built.put(entry.getKey(), result);
		}
		return new Song(BigDecimal.valueOf(timing.bpm()).setScale(2, RoundingMode.HALF_UP), timing.timeSignature(), duration,
				offsetMs, built);
	}

	private static ChartResponses.Timing timing(DrumSequence sequence, int offsetMs) {
		var tempos = new ArrayList<ChartResponses.Tempo>();
		if (sequence.tempos().isEmpty() || sequence.tempos().getFirst().tick() != 0)
			tempos.add(new ChartResponses.Tempo(0, bpm(DEFAULT_TEMPO_US)));
		for (Tempo t : sequence.tempos()) tempos.add(new ChartResponses.Tempo(t.tick(), bpm(t.microsPerQuarter())));
		var signatures = new ArrayList<ChartResponses.Signature>();
		if (sequence.signatures().isEmpty() || sequence.signatures().getFirst().tick() != 0)
			signatures.add(signature(DEFAULT_SIGNATURE));
		for (Signature s : sequence.signatures()) signatures.add(signature(s));
		var first = signatures.getFirst();
		return new ChartResponses.Timing(tempos.getFirst().bpm(), offsetMs, first.numerator() + "/" + first.denominator(),
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
