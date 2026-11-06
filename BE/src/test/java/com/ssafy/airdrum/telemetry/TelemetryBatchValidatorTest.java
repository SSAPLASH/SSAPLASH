package com.ssafy.airdrum.telemetry;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Collections;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.common.error.CommonErrorCode;
import com.ssafy.airdrum.common.error.ErrorCode;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 수신 계약(설계 3-2~3-4)의 파싱·검증 규칙. Spring 없이 파서·검증기만 쓴다. */
class TelemetryBatchValidatorTest {

	static final String SENSOR_HIT = """
			{"time":"2026-10-28T01:00:00.000Z","kind":"HIT","stickId":0,"pad":"SNARE","baselinePad":"SNARE","predictedPad":null,\
			"judgement":"PERFECT","deltaMs":8.5,"velocity":96,"tSensor":1000123,"tRecv":1000.0,"tJudge":1000.4,"tAudio":1001.0,\
			"clockOffsetMs":-12.25,"packetLoss":null,"batteryPct":null,"tags":{"source":"ble","clockSynced":true,"firmware":"0.3.1"}}""";
	static final String KEYBOARD_HIT = """
			{"time":"2026-10-28T01:00:00.100Z","kind":"HIT","stickId":null,"pad":"HIHAT_PEDAL","velocity":100,\
			"tRecv":10.5,"tJudge":10.6,"tags":{"source":"keyboard","clockSynced":false}}""";
	static final String STATUS = """
			{"time":"2026-10-28T01:00:01Z","kind":"STATUS","stickId":1,"packetLoss":0.02,"batteryPct":80,\
			"clockOffsetMs":-12.0,"tags":{"source":"ble","connected":true}}""";

	final TelemetryJson json = new TelemetryJson();
	final TelemetryBatchValidator validator = new TelemetryBatchValidator(
			Clock.fixed(Instant.parse("2026-10-28T01:00:00Z"), ZoneOffset.UTC));

	static String batch(String... events) {
		return "{\"schemaVersion\":1,\"sessionId\":\"32fb1264-7ca0-4e8a-9d7f-f69616683fe1\",\"mode\":\"RHYTHM\",\"events\":["
				+ String.join(",", events) + "]}";
	}

	TelemetryBatchRequest read(String body) {
		var bytes = body.getBytes(StandardCharsets.UTF_8);
		return json.read(new ByteArrayInputStream(bytes), bytes.length);
	}

	void accept(String body) {
		validator.validate(read(body));
	}

	void reject(String body, ErrorCode code, String detailContains) {
		assertThatThrownBy(() -> validator.validate(read(body)))
				.isInstanceOfSatisfying(BusinessException.class, ex -> {
					assertThat(ex.getErrorCode()).isEqualTo(code);
					assertThat(ex.getDetail()).contains(detailContains);
				});
	}

	@Test
	void sensorKeyboardAndStatusEventsAreAcceptedWithNullsKept() {
		var request = read(batch(SENSOR_HIT, KEYBOARD_HIT, STATUS));
		validator.validate(request);
		assertThat(request.events()).hasSize(3);
		var keyboard = request.events().get(1);
		assertThat(keyboard.stickId()).isNull();
		assertThat(keyboard.tSensor()).isNull();
		assertThat(keyboard.clockOffsetMs()).isNull();
		assertThat(keyboard.tAudio()).isNull();
		assertThat(keyboard.pad()).isEqualTo(TelemetryBatchRequest.Pad.HIHAT_PEDAL);
		assertThat(request.events().getFirst().tSensor()).isEqualTo(1000123L);
		assertThat(request.events().get(2).kind()).isEqualTo(TelemetryBatchRequest.Kind.STATUS);
		accept(batch(SENSOR_HIT).replace("\"mode\":\"RHYTHM\"", "\"mode\":null"));
	}

	@Test
	void everyWirePadAndLegacyAliasAreAccepted() {
		for (var pad : new String[] {"CRASH", "HIHAT", "SNARE", "SMALL_TOM", "MID_TOM", "FLOOR_TOM", "RIDE", "KICK", "HIHAT_PEDAL"}) {
			var request = read(batch(SENSOR_HIT.replace("\"pad\":\"SNARE\"", "\"pad\":\"" + pad + "\"")));
			assertThat(request.events().getFirst().pad().name()).isEqualTo(pad);
		}
		assertThat(read(batch(SENSOR_HIT.replace("\"pad\":\"SNARE\"", "\"pad\":\"HI_TOM\""))).events().getFirst().pad().name())
				.isEqualTo("SMALL_TOM");
		assertThatThrownBy(() -> read(batch(SENSOR_HIT.replace("\"pad\":\"SNARE\"", "\"pad\":\"UNKNOWN_PAD\""))))
				.isInstanceOfSatisfying(BusinessException.class, ex -> {
					assertThat(ex.getErrorCode()).isEqualTo(CommonErrorCode.INVALID_INPUT);
					assertThat(ex.getDetail()).contains("events[0].pad").doesNotContain("UNKNOWN_PAD");
				});
	}

	@ParameterizedTest
	@CsvSource(delimiter = '|', value = {
			"\"velocity\":96|\"velocity\":96.0|events[0].velocity",
			"\"deltaMs\":8.5|\"deltaMs\":\"8.5\"|events[0].deltaMs",
			"\"tSensor\":1000123|\"tSensor\":1000123.5|events[0].tSensor",
			"\"time\":\"2026-10-28T01:00:00.000Z\"|\"time\":1761613200000|events[0].time",
			"\"stickId\":0|\"stickId\":0,\"rawWindow\":[]|events[0]",
			"\"kind\":\"HIT\"|\"kind\":\"HIT\",\"kind\":\"HIT\"|",
			"\"judgement\":\"PERFECT\"|\"judgement\":\"perfect\"|events[0].judgement"})
	void contractShapeViolationsAreUnreadable(String from, String to, String path) {
		assertThatThrownBy(() -> read(batch(SENSOR_HIT.replace(from, to))))
				.isInstanceOfSatisfying(BusinessException.class, ex -> {
					assertThat(ex.getErrorCode()).isEqualTo(CommonErrorCode.INVALID_INPUT);
					if (path != null) assertThat(ex.getDetail()).contains(path);
				});
	}

	@Test
	void unknownEnvelopeFieldAndBrokenJsonAreUnreadable() {
		for (var body : new String[] {batch(SENSOR_HIT).replace("{\"schemaVersion\"", "{\"userId\":1,\"schemaVersion\""), "{", "[]", ""}) {
			assertThatThrownBy(() -> read(body)).isInstanceOfSatisfying(BusinessException.class,
					ex -> assertThat(ex.getErrorCode()).isEqualTo(CommonErrorCode.INVALID_INPUT));
		}
	}

	@Test
	void bodyOver128KiBIsTooLargeEvenWithoutContentLength() {
		var padding = " ".repeat(TelemetryJson.MAX_BYTES);
		var bytes = (batch(SENSOR_HIT) + padding).getBytes(StandardCharsets.UTF_8);
		for (long declared : new long[] {bytes.length, -1}) {
			assertThatThrownBy(() -> json.read(new ByteArrayInputStream(bytes), declared))
					.isInstanceOfSatisfying(BusinessException.class,
							ex -> assertThat(ex.getErrorCode()).isEqualTo(TelemetryErrorCode.TELEMETRY_BATCH_TOO_LARGE));
		}
		var exact = batch(SENSOR_HIT);
		var fits = (exact + " ".repeat(TelemetryJson.MAX_BYTES - exact.length())).getBytes(StandardCharsets.UTF_8);
		assertThat(json.read(new ByteArrayInputStream(fits), fits.length).events()).hasSize(1);
	}

	@Test
	void envelopeRules() {
		reject(batch(SENSOR_HIT).replace("\"schemaVersion\":1", "\"schemaVersion\":2"), TelemetryErrorCode.TELEMETRY_SCHEMA_UNSUPPORTED, "");
		reject(batch(SENSOR_HIT).replace("\"schemaVersion\":1,", ""), TelemetryErrorCode.TELEMETRY_EVENT_INVALID, "schemaVersion");
		reject(batch(SENSOR_HIT).replace("\"sessionId\":\"32fb1264-7ca0-4e8a-9d7f-f69616683fe1\",", ""), TelemetryErrorCode.TELEMETRY_EVENT_INVALID, "sessionId");
		reject(batch(), TelemetryErrorCode.TELEMETRY_EVENT_INVALID, "events");
		reject(batch(SENSOR_HIT).replace(",\"events\":[" + SENSOR_HIT + "]", ""), TelemetryErrorCode.TELEMETRY_EVENT_INVALID, "events");
		reject(batch(SENSOR_HIT).replace(SENSOR_HIT, "null"), TelemetryErrorCode.TELEMETRY_EVENT_INVALID, "events[0]");
		accept(batch(Collections.nCopies(100, KEYBOARD_HIT).toArray(String[]::new)));
		reject(batch(Collections.nCopies(101, KEYBOARD_HIT).toArray(String[]::new)), TelemetryErrorCode.TELEMETRY_BATCH_TOO_LARGE, "");
	}

	@ParameterizedTest
	@CsvSource(delimiter = '|', value = {
			// 공통
			"\"time\":\"2026-10-28T01:00:00.000Z\",|''|events[0].time",
			"\"kind\":\"HIT\",|''|events[0].kind",
			"\"stickId\":0|\"stickId\":2|events[0].stickId",
			"\"tSensor\":1000123|\"tSensor\":-1|events[0].tSensor",
			"\"clockOffsetMs\":-12.25|\"clockOffsetMs\":1e999|events[0].clockOffsetMs",
			"\"packetLoss\":null|\"packetLoss\":1.5|events[0].packetLoss",
			"\"packetLoss\":null|\"packetLoss\":-0.1|events[0].packetLoss",
			"\"batteryPct\":null|\"batteryPct\":101|events[0].batteryPct",
			// HIT
			"\"velocity\":96|\"velocity\":128|events[0].velocity",
			"\"velocity\":96,|''|events[0].velocity",
			"\"tRecv\":1000.0,|''|events[0].tRecv",
			"\"tJudge\":1000.4|\"tJudge\":null|events[0].tJudge",
			"\"tAudio\":1001.0|\"tAudio\":-1e999|events[0].tAudio",
			"\"deltaMs\":8.5|\"deltaMs\":null|events[0].deltaMs",
			"\"judgement\":\"PERFECT\"|\"judgement\":\"MISS\"|events[0].deltaMs",
			"\"judgement\":\"PERFECT\"|\"judgement\":null|events[0].deltaMs",
			"\"stickId\":0,|''|events[0].stickId",
			// tags
			"\"clockSynced\":true,|''|events[0].tags.clockSynced",
			"\"clockSynced\":true|\"clockSynced\":\"true\"|events[0].tags.clockSynced",
			"\"source\":\"ble\",|''|events[0].tags.source",
			"\"source\":\"ble\"|\"source\":\"\"|events[0].tags.source",
			"\"firmware\":\"0.3.1\"|\"firmware\":\"0.3.1\",\"testerId\":\"me\"|events[0].tags",
			"\"tags\":{\"source\":\"ble\",\"clockSynced\":true,\"firmware\":\"0.3.1\"}|\"tags\":null|events[0].tags",
			"\"tags\":{\"source\":\"ble\",\"clockSynced\":true,\"firmware\":\"0.3.1\"}|\"tags\":[]|events[0].tags",
			"\"time\":\"2026-10-28T01:00:00.000Z\"|\"time\":\"2026-10-28T01:05:00.001Z\"|events[0].time"})
	void sensorHitRules(String from, String to, String path) {
		reject(batch(SENSOR_HIT.replace(from, to)), TelemetryErrorCode.TELEMETRY_EVENT_INVALID, path);
	}

	@Test
	void tagsAreLimitedTo1KiBAndTimeUpToFiveMinutesAheadIsAccepted() {
		accept(batch(SENSOR_HIT.replace("\"time\":\"2026-10-28T01:00:00.000Z\"", "\"time\":\"2026-10-28T10:05:00+09:00\"")));
		var firmware = "x".repeat(64);
		accept(batch(SENSOR_HIT.replace("0.3.1", firmware)));
		reject(batch(SENSOR_HIT.replace("0.3.1", firmware + "x")), TelemetryErrorCode.TELEMETRY_EVENT_INVALID, "events[0].tags.firmware");
		reject(batch(SENSOR_HIT.replace("\"source\":\"ble\"", "\"source\":\"" + "가".repeat(33) + "\"")),
				TelemetryErrorCode.TELEMETRY_EVENT_INVALID, "events[0].tags.source");
		// 허용 키 4개를 상한까지 채워도 1 KiB 안이다. 1 KiB 검사는 키 목록보다 먼저 막는 방어선이다.
		accept(batch(SENSOR_HIT.replace("\"firmware\":\"0.3.1\"", "\"firmware\":\"" + "가".repeat(64) + "\",\"connected\":true")));
		reject(batch(SENSOR_HIT.replace("\"firmware\":\"0.3.1\"", "\"firmware\":\"0.3.1\",\"note\":\"" + "x".repeat(2000) + "\"")),
				TelemetryErrorCode.TELEMETRY_EVENT_INVALID, "events[0].tags: 1 KiB");
	}

	@Test
	void keyboardHitMayOmitStickAndSensorValues() {
		accept(batch(KEYBOARD_HIT));
		reject(batch(KEYBOARD_HIT.replace("\"clockSynced\":false", "\"connected\":true")), TelemetryErrorCode.TELEMETRY_EVENT_INVALID,
				"events[0].tags.clockSynced");
	}

	@ParameterizedTest
	@CsvSource(delimiter = '|', value = {
			"\"stickId\":1|\"stickId\":null|events[0].stickId",
			"\"connected\":true|\"clockSynced\":true|events[0].tags.connected",
			"\"batteryPct\":80|\"batteryPct\":80,\"velocity\":10|events[0].velocity",
			"\"batteryPct\":80|\"batteryPct\":80,\"pad\":\"SNARE\"|events[0].pad",
			"\"batteryPct\":80|\"batteryPct\":80,\"baselinePad\":\"SNARE\"|events[0].baselinePad",
			"\"batteryPct\":80|\"batteryPct\":80,\"predictedPad\":\"SNARE\"|events[0].predictedPad",
			"\"batteryPct\":80|\"batteryPct\":80,\"judgement\":\"MISS\"|events[0].judgement",
			"\"batteryPct\":80|\"batteryPct\":80,\"deltaMs\":1.0|events[0].deltaMs",
			"\"batteryPct\":80|\"batteryPct\":80,\"tRecv\":1.0|events[0].tRecv",
			"\"batteryPct\":80|\"batteryPct\":80,\"tJudge\":1.0|events[0].tJudge",
			"\"batteryPct\":80|\"batteryPct\":80,\"tAudio\":1.0|events[0].tAudio"})
	void statusRules(String from, String to, String path) {
		reject(batch(STATUS.replace(from, to)), TelemetryErrorCode.TELEMETRY_EVENT_INVALID, path);
	}

	// --- 259 외피 conditions(측정 세션 실험 조건) ---

	/** FE 회신(2026-11-06)의 7개 필드. firmware는 스틱별 객체이고 "1"은 아직 STATUS를 못 받은 상태다. */
	static final String CONDITIONS = """
			{"firmware":{"0":"1.5","1":null},"dongleFirmware":"2.3","linkMask":3,"hapticEnable":true,\
			"sensorMount":"GRIP_FRONT","appBuild":"v3.0","note":"블루투스 거리 3m"}""";

	static String withConditions(String conditions, String... events) {
		return batch(events).replace("\"events\":[", "\"conditions\":" + conditions + ",\"events\":[");
	}

	@Test
	void conditionsAreReadAsSentAndUnknownKeysInsideAreIgnored() {
		var c = read(withConditions(CONDITIONS, SENSOR_HIT)).conditions();
		assertThat(c.firmware().stick0()).isEqualTo("1.5");
		assertThat(c.firmware().stick1()).isNull();
		assertThat(c.dongleFirmware()).isEqualTo("2.3");
		assertThat(c.linkMask()).isEqualTo(3);
		assertThat(c.hapticEnable()).isTrue();
		assertThat(c.sensorMount()).isEqualTo(TelemetryBatchRequest.SensorMount.GRIP_FRONT);
		assertThat(c.appBuild()).isEqualTo("v3.0");
		assertThat(c.note()).isEqualTo("블루투스 거리 3m");
		accept(withConditions(CONDITIONS, SENSOR_HIT));
		accept(withConditions(CONDITIONS.replace("GRIP_FRONT", "BENCH"), SENSOR_HIT));
		// 부재와 null은 같다
		assertThat(read(batch(SENSOR_HIT)).conditions()).isNull();
		assertThat(read(withConditions("null", SENSOR_HIT)).conditions()).isNull();
		accept(withConditions("null", SENSOR_HIT));
		// 모든 값이 null인 객체도 객체다(보낸 적 있음)
		var empty = read(withConditions("{}", SENSOR_HIT)).conditions();
		assertThat(empty).isNotNull();
		assertThat(empty.firmware()).isNull();
		assertThat(empty.linkMask()).isNull();
		accept(withConditions("{}", SENSOR_HIT));
		// conditions 안의 모르는 키(EMB가 나중에 더하는 필드)는 무시한다. firmware 안도 같다(설계 U4)
		var extra = read(withConditions(CONDITIONS.replace("\"note\"", "\"stickWeight\":42,\"note\"")
				.replace("\"1\":null", "\"1\":null,\"2\":\"9.9\""), SENSOR_HIT)).conditions();
		assertThat(extra.note()).isEqualTo("블루투스 거리 3m");
		assertThat(extra.firmware().stick0()).isEqualTo("1.5");
		accept(withConditions(CONDITIONS.replace("\"note\"", "\"stickWeight\":42,\"note\""), SENSOR_HIT));
		// 외피의 모르는 키는 지금처럼 거절한다
		assertThatThrownBy(() -> read(withConditions(CONDITIONS, SENSOR_HIT).replace("\"conditions\":", "\"stickWeight\":42,\"conditions\":")))
				.isInstanceOfSatisfying(BusinessException.class, ex -> assertThat(ex.getErrorCode()).isEqualTo(CommonErrorCode.INVALID_INPUT));
	}

	@ParameterizedTest
	@CsvSource(delimiter = '|', value = {
			"\"linkMask\":3|\"linkMask\":\"3\"|conditions.linkMask",
			"\"linkMask\":3|\"linkMask\":3.0|conditions.linkMask",
			"\"hapticEnable\":true|\"hapticEnable\":1|conditions.hapticEnable",
			"\"hapticEnable\":true|\"hapticEnable\":\"true\"|conditions.hapticEnable",
			"\"sensorMount\":\"GRIP_FRONT\"|\"sensorMount\":\"TIP\"|conditions.sensorMount",
			"\"sensorMount\":\"GRIP_FRONT\"|\"sensorMount\":\"grip_front\"|conditions.sensorMount",
			"\"sensorMount\":\"GRIP_FRONT\"|\"sensorMount\":0|conditions.sensorMount",
			"\"firmware\":{\"0\":\"1.5\",\"1\":null}|\"firmware\":\"1.5\"|conditions.firmware",
			"\"firmware\":{\"0\":\"1.5\",\"1\":null}|\"firmware\":{\"0\":15,\"1\":null}|conditions.firmware.0",
			"\"note\":\"블루투스 거리 3m\"|\"note\":[]|conditions.note",
			"\"note\":\"블루투스 거리 3m\"|\"note\":\"블루투스 거리 3m\",\"note\":\"x\"|"})
	void conditionsShapeViolationsAreUnreadable(String from, String to, String path) {
		assertThatThrownBy(() -> read(withConditions(CONDITIONS.replace(from, to), SENSOR_HIT)))
				.isInstanceOfSatisfying(BusinessException.class, ex -> {
					assertThat(ex.getErrorCode()).isEqualTo(CommonErrorCode.INVALID_INPUT);
					if (path != null) assertThat(ex.getDetail()).contains(path).doesNotContain("TIP");
				});
		assertThatThrownBy(() -> read(withConditions("[]", SENSOR_HIT)))
				.isInstanceOfSatisfying(BusinessException.class, ex -> assertThat(ex.getDetail()).contains("conditions"));
	}

	@Test
	void conditionsValueRules() {
		var max = "x".repeat(64);
		accept(withConditions(CONDITIONS.replace("\"0\":\"1.5\"", "\"0\":\"" + max + "\"").replace("\"2.3\"", "\"" + max + "\"")
				.replace("\"v3.0\"", "\"" + max + "\"").replace("블루투스 거리 3m", "가".repeat(200)), SENSOR_HIT));
		accept(withConditions(CONDITIONS.replace("\"linkMask\":3", "\"linkMask\":0").replace("블루투스 거리 3m", ""), SENSOR_HIT));
		accept(withConditions(CONDITIONS.replace("\"linkMask\":3", "\"linkMask\":15"), SENSOR_HIT));
		var invalid = TelemetryErrorCode.TELEMETRY_EVENT_INVALID;
		reject(withConditions(CONDITIONS.replace("\"0\":\"1.5\"", "\"0\":\"" + max + "x\""), SENSOR_HIT), invalid, "conditions.firmware.0");
		reject(withConditions(CONDITIONS.replace("\"0\":\"1.5\"", "\"0\":\"\""), SENSOR_HIT), invalid, "conditions.firmware.0");
		reject(withConditions(CONDITIONS.replace("\"1\":null", "\"1\":\"\""), SENSOR_HIT), invalid, "conditions.firmware.1");
		reject(withConditions(CONDITIONS.replace("\"2.3\"", "\"\""), SENSOR_HIT), invalid, "conditions.dongleFirmware");
		reject(withConditions(CONDITIONS.replace("\"2.3\"", "\"" + max + "x\""), SENSOR_HIT), invalid, "conditions.dongleFirmware");
		reject(withConditions(CONDITIONS.replace("\"linkMask\":3", "\"linkMask\":16"), SENSOR_HIT), invalid, "conditions.linkMask");
		reject(withConditions(CONDITIONS.replace("\"linkMask\":3", "\"linkMask\":-1"), SENSOR_HIT), invalid, "conditions.linkMask");
		reject(withConditions(CONDITIONS.replace("\"v3.0\"", "\"\""), SENSOR_HIT), invalid, "conditions.appBuild");
		reject(withConditions(CONDITIONS.replace("\"v3.0\"", "\"" + max + "x\""), SENSOR_HIT), invalid, "conditions.appBuild");
		reject(withConditions(CONDITIONS.replace("블루투스 거리 3m", "가".repeat(201)), SENSOR_HIT), invalid, "conditions.note");
		// PG text가 거절하는 U+0000은 DB 오류(500)가 아니라 400으로 막는다(검증 보완 1)
		reject(withConditions(CONDITIONS.replace("블루투스 거리 3m", "a\\u0000b"), SENSOR_HIT), invalid, "conditions.note");
		reject(withConditions(CONDITIONS.replace("\"0\":\"1.5\"", "\"0\":\"1.5\\u0000\""), SENSOR_HIT), invalid, "conditions.firmware.0");
		// 거부된 값은 detail에 넣지 않는다
		assertThatThrownBy(() -> validator.validate(read(withConditions(CONDITIONS.replace("\"linkMask\":3", "\"linkMask\":16"), SENSOR_HIT))))
				.isInstanceOfSatisfying(BusinessException.class, ex -> assertThat(ex.getDetail()).doesNotContain("16"));
		// 이벤트 검사가 conditions 검사보다 먼저다
		reject(withConditions(CONDITIONS.replace("\"linkMask\":3", "\"linkMask\":16"), SENSOR_HIT.replace("\"velocity\":96", "\"velocity\":128")),
				invalid, "events[0].velocity");
	}

	@Test
	void reportsIndexOfTheFirstBadEventWithoutEchoingValues() {
		reject(batch(SENSOR_HIT, KEYBOARD_HIT, STATUS.replace("\"batteryPct\":80", "\"batteryPct\":12345")),
				TelemetryErrorCode.TELEMETRY_EVENT_INVALID, "events[2].batteryPct");
		assertThatThrownBy(() -> validator.validate(read(batch(STATUS.replace("\"batteryPct\":80", "\"batteryPct\":12345")))))
				.isInstanceOfSatisfying(BusinessException.class, ex -> assertThat(ex.getDetail()).doesNotContain("12345"));
	}

}
