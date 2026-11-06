package com.ssafy.airdrum.chart;

import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class ChartDocumentReaderTest {
	final ChartDocumentReader reader = new ChartDocumentReader(JsonMapper.builder().build());
	@Test void hihatOpenPreservesOnlyBooleanValues() {
		var notes = reader.notes("""
			[{"noteId":"a","timeMs":0,"pad":"HIHAT","hihatOpen":true,"velocityHint":90},
			 {"noteId":"b","timeMs":1,"pad":"HIHAT","hihatOpen":false},
			 {"noteId":"c","timeMs":2,"pad":"HIHAT"},
			 {"noteId":"d","timeMs":3,"pad":"HIHAT","hihatOpen":null},
			 {"noteId":"e","timeMs":4,"pad":"HIHAT","hihatOpen":"true"},
			 {"noteId":"f","timeMs":5,"pad":"HIHAT","hihatOpen":1},
			 {"noteId":"g","timeMs":6,"pad":"HIHAT","hihatOpen":{}},
			 {"noteId":"h","timeMs":7,"pad":"SNARE","hihatOpen":true},
			 {"noteId":"i","timeMs":8,"pad":"KICK","hihatOpen":false}]
			""", 9);
		assertThat(notes).extracting(ChartResponses.Note::hihatOpen).containsExactly(true, false, null, null, null, null, null, null, null);
		assertThat(notes.getFirst().velocityHint()).isEqualTo(90);
		assertThat(notes.getFirst().pad()).isEqualTo("HIHAT");
	}
	@Test void ratingNotesDoNotDependOnDamagedSheetPagesButDetailStillFails() {
		var row = mock(ChartVersionRepository.Detail.class);
		when(row.getSchemaVersion()).thenReturn(1);
		when(row.getTiming()).thenReturn(ChartQueryApiTest.TIMING);
		when(row.getNotes()).thenReturn(ChartQueryApiTest.NOTES);
		when(row.getNoteCount()).thenReturn(1);
		when(row.getSheetPages()).thenReturn("{}");
		assertThat(reader.notes(row.getNotes(),row.getNoteCount())).hasSize(1);
		assertThatThrownBy(() -> reader.detail(row)).isInstanceOf(IllegalStateException.class);
	}
	@Test void compoundMeterOptionalFieldsAndSimultaneousNotesRemainUnchanged() {
		var row = mock(ChartVersionRepository.Detail.class);
		when(row.getSchemaVersion()).thenReturn(1);
		when(row.getTiming()).thenReturn("{\"bpm\":90,\"offsetMs\":-100,\"timeSignature\":\"6/8\"}");
		when(row.getNotes()).thenReturn("""
			[{"noteId":"b","timeMs":0.5,"pad":"SNARE"},{"noteId":"a","timeMs":0.5,"pad":"KICK"}]
			""");
		when(row.getNoteCount()).thenReturn(2);
		when(row.getDurationMs()).thenReturn(null);
		var result = reader.detail(row);
		assertThat(result.beatsPerBar()).isEqualTo(6);
		assertThat(result.timeSignature()).isEqualTo("6/8");
		assertThat(result.durationMs()).isNull();
		assertThat(result.timing().ppq()).isNull();
		assertThat(result.notes()).extracting(ChartResponses.Note::noteId).containsExactly("b", "a");
		assertThat(result.notes()).extracting(ChartResponses.Note::timeMs).containsExactly(0.5, 0.5);
		assertThat(result.notes().getFirst().notation()).isNull();
		assertThat(result.notes().getFirst().velocityHint()).isNull();
	}
	@Test void malformedNumbersMissingFieldsAndAmbiguousMapsAreRejected() {
		for (String raw : List.of("{}", "null", "[]", "not json",
				"{\"bpm\":\"120\",\"offsetMs\":0,\"timeSignature\":\"4/4\"}",
				"{\"bpm\":1e400,\"offsetMs\":0,\"timeSignature\":\"4/4\"}",
				"{\"bpm\":120,\"offsetMs\":0.5,\"timeSignature\":\"4/4\"}",
				"{\"bpm\":120,\"offsetMs\":0,\"timeSignature\":\"4/3\"}",
				"{\"bpm\":120,\"offsetMs\":0,\"timeSignature\":\"4/4\",\"tempoMap\":[]}",
				"{\"bpm\":120,\"offsetMs\":0,\"timeSignature\":\"4/4\",\"tempoMap\":[{\"tick\":1,\"bpm\":120}]}")) {
			assertThatThrownBy(() -> reader.timing(raw)).isInstanceOf(IllegalStateException.class)
					.hasMessage("저장된 채보 데이터 형식이 올바르지 않습니다.");
		}
	}
	@Test void piecewiseTempoConversionAppliesOffsetOnceIncludingExactBoundary() {
		var timing = reader.timing(ChartQueryApiTest.TIMING.replace("250", "-100"));
		assertThat(reader.milliseconds(timing, 0)).isEqualTo(-100);
		assertThat(reader.milliseconds(timing, 480)).isEqualTo(400);
		assertThat(reader.milliseconds(timing, 960)).isEqualTo(1400);
	}
	@Test void adtTempoMapWithoutNotationIsAcceptedAndConvertedPiecewise() {
		// AI 공용 곡 채보(Take Me Out 형식): 노트는 timeMs만, timing에 ppq·tempoMap·timeSignatureMap
		var timing = reader.timing("""
			{"bpm":142.04,"offsetMs":280,"timeSignature":"4/4","ppq":480,
			 "tempoMap":[{"tick":0,"bpm":142.04},{"tick":55680,"bpm":125.65},{"tick":59520,"bpm":113.21},{"tick":61440,"bpm":104.97}],
			 "timeSignatureMap":[{"tick":0,"numerator":4,"denominator":4}]}
			""");
		assertThat(timing.tempoMap()).hasSize(4);
		assertThat(reader.milliseconds(timing, 55680)).isCloseTo(280 + 116 * 60000.0 / 142.04, within(1e-6));
		assertThat(reader.milliseconds(timing, 61440))
				.isCloseTo(280 + 116 * 60000.0 / 142.04 + 8 * 60000.0 / 125.65 + 4 * 60000.0 / 113.21, within(1e-6));
	}
	@Test void duplicateOutOfOrderOrInvalidNotesFailInsteadOfBeingSilentlyRepaired() {
		for (String notes : List.of(
				"[{\"noteId\":\"a\",\"timeMs\":1,\"pad\":\"SNARE\"},{\"noteId\":\"a\",\"timeMs\":2,\"pad\":\"KICK\"}]",
				"[{\"noteId\":\"a\",\"timeMs\":2,\"pad\":\"SNARE\"},{\"noteId\":\"b\",\"timeMs\":1,\"pad\":\"KICK\"}]",
				"[{\"noteId\":\"a\",\"timeMs\":-1,\"pad\":\"SNARE\"},{\"noteId\":\"b\",\"timeMs\":2,\"pad\":\"KICK\"}]")) {
			var row = mock(ChartVersionRepository.Detail.class);
			when(row.getSchemaVersion()).thenReturn(1);
			when(row.getTiming()).thenReturn(ChartQueryApiTest.TIMING);
			when(row.getNotes()).thenReturn(notes);
			when(row.getNoteCount()).thenReturn(2);
			assertThatThrownBy(() -> reader.detail(row)).isInstanceOf(IllegalStateException.class);
		}
	}
	@Test void pageOrderIsNormalizedButGapsAndOverlappingRangesAreRejected() {
		String first = "{\"page\":1,\"imageKey\":\"sheet/1/1.png\",\"fromTick\":0,\"toTick\":480}";
		String second = "{\"page\":2,\"imageKey\":\"sheet/1/2.png\",\"fromTick\":480,\"toTick\":960}";
		assertThat(reader.pages("[" + second + "," + first + "]"))
				.extracting(ChartDocumentReader.StoredPage::page).containsExactly(1, 2);
		assertThatThrownBy(() -> reader.pages("[" + second + "]")).isInstanceOf(IllegalStateException.class);
		assertThatThrownBy(() -> reader.pages("[" + first + "," + second.replace("\"fromTick\":480", "\"fromTick\":479") + "]"))
				.isInstanceOf(IllegalStateException.class);
	}
}
