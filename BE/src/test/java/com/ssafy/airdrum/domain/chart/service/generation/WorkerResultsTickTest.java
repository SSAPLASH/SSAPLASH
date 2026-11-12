package com.ssafy.airdrum.domain.chart.service.generation;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.*;

class WorkerResultsTickTest {
	final JsonMapper json = JsonMapper.builder().build();

	static long tick(long timeMs, tools.jackson.databind.JsonNode timing, double bpm, int ppq) {
		return TranscriptionCharts.VirtualTicks.of(timing, bpm, ppq).tick(timeMs);
	}

	@Test void tempoMapWithoutNotationUsesEachSegmentBpm() {
		// 0~2000ms는 120bpm(4박 = 1920틱), 그 뒤는 60bpm
		var timing = json.readTree("""
			{"bpm":120,"offsetMs":500,"timeSignature":"4/4","ppq":480,
			 "tempoMap":[{"tick":0,"bpm":120},{"tick":1920,"bpm":60}]}
			""");
		assertThat(tick(500, timing, 120, 480)).isZero();
		assertThat(tick(1000, timing, 120, 480)).isEqualTo(480);
		assertThat(tick(2500, timing, 120, 480)).isEqualTo(1920);
		assertThat(tick(3500, timing, 120, 480)).isEqualTo(2400);
		assertThat(tick(100, timing, 120, 480)).isZero();
	}

	@Test void tempoMapTicksAreRescaledToThinningPpq() {
		var timing = json.readTree("""
			{"bpm":120,"offsetMs":0,"timeSignature":"4/4","ppq":960,
			 "tempoMap":[{"tick":0,"bpm":120},{"tick":3840,"bpm":60}]}
			""");
		assertThat(tick(3000, timing, 120, 480)).isEqualTo(1920 + 480);
	}

	@Test void withoutTempoMapUsesSingleBpmAsBefore() {
		var timing = json.readTree("{\"bpm\":120,\"offsetMs\":500,\"timeSignature\":\"4/4\"}");
		assertThat(tick(2500, timing, 120, 480)).isEqualTo(1920);
	}

	@Test void exactSegmentBoundaryBelongsToNextSegment() {
		var timing = json.readTree("""
			{"bpm":120,"offsetMs":0,"timeSignature":"4/4","ppq":480,
			 "tempoMap":[{"tick":0,"bpm":120},{"tick":960,"bpm":60},{"tick":1440,"bpm":240}]}
			""");
		// 960틱 = 1000ms에서 60bpm, 1440틱 = 2000ms에서 240bpm
		assertThat(tick(1000, timing, 120, 480)).isEqualTo(960);
		assertThat(tick(2000, timing, 120, 480)).isEqualTo(1440);
		assertThat(tick(2125, timing, 120, 480)).isEqualTo(1440 + 240);
	}

	@Test void manySegmentsAndNotesStayLinearithmic() {
		// 구간 50,000개(구간마다 1박, 120bpm = 500ms)와 노트 50,000개
		var map = new StringBuilder("[");
		for (int i = 0; i < 50_000; i++) map.append(i == 0 ? "" : ",").append("{\"tick\":").append(i * 480L).append(",\"bpm\":120}");
		var timing = json.readTree("{\"bpm\":120,\"offsetMs\":0,\"timeSignature\":\"4/4\",\"ppq\":480,\"tempoMap\":" + map + "]}");
		var ticks = TranscriptionCharts.VirtualTicks.of(timing, 120, 480);
		long sum = 0;
		for (int i = 0; i < 50_000; i++) sum += ticks.tick(i * 500L);
		assertThat(sum).isEqualTo(480L * 50_000 * 49_999 / 2);
	}
}
