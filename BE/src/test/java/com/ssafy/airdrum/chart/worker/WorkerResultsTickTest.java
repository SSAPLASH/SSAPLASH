package com.ssafy.airdrum.chart.worker;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.*;

class WorkerResultsTickTest {
	final JsonMapper json = JsonMapper.builder().build();

	@Test void tempoMapWithoutNotationUsesEachSegmentBpm() {
		// 0~2000ms는 120bpm(4박 = 1920틱), 그 뒤는 60bpm
		var timing = json.readTree("""
			{"bpm":120,"offsetMs":500,"timeSignature":"4/4","ppq":480,
			 "tempoMap":[{"tick":0,"bpm":120},{"tick":1920,"bpm":60}]}
			""");
		assertThat(WorkerResults.tickAt(500, timing, 120, 480)).isZero();
		assertThat(WorkerResults.tickAt(1000, timing, 120, 480)).isEqualTo(480);
		assertThat(WorkerResults.tickAt(2500, timing, 120, 480)).isEqualTo(1920);
		assertThat(WorkerResults.tickAt(3500, timing, 120, 480)).isEqualTo(2400);
		assertThat(WorkerResults.tickAt(100, timing, 120, 480)).isZero();
	}

	@Test void tempoMapTicksAreRescaledToThinningPpq() {
		var timing = json.readTree("""
			{"bpm":120,"offsetMs":0,"timeSignature":"4/4","ppq":960,
			 "tempoMap":[{"tick":0,"bpm":120},{"tick":3840,"bpm":60}]}
			""");
		assertThat(WorkerResults.tickAt(3000, timing, 120, 480)).isEqualTo(1920 + 480);
	}

	@Test void withoutTempoMapUsesSingleBpmAsBefore() {
		var timing = json.readTree("{\"bpm\":120,\"offsetMs\":500,\"timeSignature\":\"4/4\"}");
		assertThat(WorkerResults.tickAt(2500, timing, 120, 480)).isEqualTo(1920);
	}
}
