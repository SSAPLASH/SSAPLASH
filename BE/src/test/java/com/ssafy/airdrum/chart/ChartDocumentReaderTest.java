package com.ssafy.airdrum.chart;

import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class ChartDocumentReaderTest {
	final ChartDocumentReader reader = new ChartDocumentReader(JsonMapper.builder().build());
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
