package com.ssafy.airdrum.chart.worker;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.common.error.BusinessException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 293: 음원 워커 결과 검증·3난이도 파생을 {@code WorkerResults}에서 꺼낸 공용 클래스. MusicXML 업로드가 같은 규칙을 쓴다.
 * 동작은 워커 결과 저장({@code WorkerApiTest})과 같아야 한다.
 */
@SpringBootTest
class TranscriptionChartsTest {

	@Autowired TranscriptionCharts charts;
	final JsonMapper json = new JsonMapper();

	static Map<String, Object> note(String id, int timeMs, String pad, Object... extra) {
		var m = new java.util.LinkedHashMap<String, Object>(Map.of("noteId", id, "timeMs", timeMs, "pad", pad));
		for (int i = 0; i < extra.length; i += 2) m.put((String) extra[i], extra[i + 1]);
		return m;
	}

	JsonNode chart(String generator, String version, List<Map<String, Object>> notes) {
		return json.valueToTree(Map.of("schemaVersion", 1, "generator", generator, "generatorVersion", version, "metrics", Map.of("convertMs", 3),
				"charts", List.of(Map.of("difficulty", "NORMAL", "notationStatus", "UNAVAILABLE", "notes", notes,
						"timing", Map.of("bpm", 120, "offsetMs", 0, "timeSignature", "4/4")))));
	}

	@Test
	void 워커_결과_모양의_채보를_HARD_원본과_NORMAL_EASY_파생으로_나눈다() {
		// 120 BPM: 16분 = 125 ms, 8분 = 250 ms, 4분 = 500 ms. 하이햇 16분 4개 + 킥 2개 + 열린 하이햇 표시
		var notes = List.of(note("n1", 0, "KICK"), note("n2", 0, "HIHAT", "hihatOpen", true), note("n3", 125, "HIHAT"),
				note("n4", 250, "HIHAT"), note("n5", 375, "HIHAT"), note("n6", 500, "KICK", "velocityHint", 90));
		var data = charts.parse(chart("ADT_MODEL", "sheet-musicxml-3", notes), 4000);
		assertThat(data.noteCount()).isEqualTo(6);
		assertThat(data.generatorVersion()).isEqualTo("sheet-musicxml-3");
		assertThat(data.bpm()).isEqualByComparingTo("120.00");
		assertThat(data.offset()).isZero();
		assertThat(data.timeSignature()).isEqualTo("4/4");
		assertThat(data.notationStatus()).isEqualTo("UNAVAILABLE");
		// HARD는 원본 그대로(hihatOpen 보존), NORMAL은 하이햇을 8분 격자만, EASY는 4분 격자만 남긴다
		assertThat(data.notes()).contains("\"hihatOpen\":true");
		assertThat(ids(data.normalNotes())).containsExactly("n1", "n2", "n4", "n6");
		assertThat(ids(data.easyNotes())).containsExactly("n1", "n2", "n6");
		assertThat(data.normalCount()).isEqualTo(4);
		assertThat(data.easyCount()).isEqualTo(3);
		assertThat(TranscriptionCharts.derivedVersion("sheet-musicxml-3")).isEqualTo("sheet-musicxml-3+midi-rule-2.0");
		assertThat(data.metrics()).contains("convertMs");
	}

	@Test
	void 빠르기_구간이_있는_음원_채보는_구간_빠르기로_솎는다() {
		// CHART-003-variable-tempo-exp: AI가 찾은 박으로 낸 tempoMap. 120bpm 8박(0~4000ms) 뒤 90bpm
		// 90bpm 구간의 EASY 박은 8분(333ms)이라 4333ms가 박 위다. 고정 120bpm으로 셌다면 4333ms는 4분 박 밖이라 빠진다(328번 midi-rule-2.0)
		var notes = List.of(note("n1", 0, "KICK"), note("n2", 500, "KICK"), note("n3", 4000, "KICK"),
				note("n4", 4333, "KICK"), note("n5", 5000, "KICK"));
		JsonNode doc = json.valueToTree(Map.of("schemaVersion", 1, "generator", "ADT_MODEL", "generatorVersion", "adtof_drumsep@abc",
				"metrics", Map.of("transcribeMs", 3), "charts", List.of(Map.of("difficulty", "NORMAL", "notationStatus", "UNAVAILABLE",
						"notes", notes, "timing", Map.of("bpm", 120.0, "offsetMs", 0, "timeSignature", "4/4", "ppq", 480,
								"tempoMap", List.of(Map.of("tick", 0, "bpm", 120.0), Map.of("tick", 8 * 480, "bpm", 90.0)),
								"timeSignatureMap", List.of(Map.of("tick", 0, "numerator", 4, "denominator", 4)))))));
		var data = charts.parse(doc, 6000);
		assertThat(ids(data.easyNotes())).containsExactly("n1", "n2", "n3", "n4", "n5");
		assertThat(data.timing()).contains("\"tempoMap\"");
	}

	@Test
	void 계약_밖_채보는_RESULT_INVALID다() {
		var ok = List.of(note("n1", 100, "SNARE"));
		assertThatThrownBy(() -> charts.parse(chart("MUSICXML_RULE", "v", ok), 2000)).isInstanceOfSatisfying(BusinessException.class,
				ex -> assertThat(ex.getErrorCode()).isEqualTo(WorkerError.RESULT_INVALID));
		assertThatThrownBy(() -> charts.parse(chart("ADT_MODEL", "v", List.of(note("n1", 2001, "SNARE"))), 2000))
				.isInstanceOf(BusinessException.class);
		assertThatThrownBy(() -> charts.parse(chart("ADT_MODEL", "v", List.of(note("n1", 100, "TAMBOURINE"))), 2000))
				.isInstanceOf(BusinessException.class);
		assertThatThrownBy(() -> charts.parse(chart("ADT_MODEL", "v", List.of(note("n1", 100, "HIHAT", "hihatOpen", "yes"))), 2000))
				.isInstanceOf(BusinessException.class);
		assertThatThrownBy(() -> charts.parse(chart("ADT_MODEL", "", ok), 2000)).isInstanceOf(BusinessException.class);
	}

	List<String> ids(String notesJson) {
		var list = new java.util.ArrayList<String>();
		json.readTree(notesJson).forEach(n -> list.add(n.path("noteId").asString()));
		return list;
	}
}
