package com.ssafy.airdrum.telemetry;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.util.Set;

import org.springframework.stereotype.Component;

import tools.jackson.databind.JsonNode;

import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.telemetry.TelemetryBatchRequest.Conditions;
import com.ssafy.airdrum.telemetry.TelemetryBatchRequest.Event;
import com.ssafy.airdrum.telemetry.TelemetryBatchRequest.Judgement;
import com.ssafy.airdrum.telemetry.TelemetryBatchRequest.Kind;

/**
 * 파싱된 배치의 의미 규칙(설계 3-2~3-4, 259 조건은 3-1). 외피 → 이벤트 → conditions 순서로 첫 위반에서 멈추고
 * {@code events[i].필드: 이유}·{@code conditions.필드: 이유}를 detail로 낸다. 값을 보정하거나 0으로 채우지 않으며, 거부된 값은 detail에 넣지 않는다.
 */
@Component
public class TelemetryBatchValidator {

	public static final int MAX_EVENTS = 100;
	static final int TAGS_BYTES = 1024;
	static final Duration FUTURE_TOLERANCE = Duration.ofMinutes(5);
	static final String KEYBOARD = "keyboard";
	private static final Set<String> TAG_KEYS = Set.of("source", "clockSynced", "connected", "firmware");

	private final Clock clock;

	public TelemetryBatchValidator(Clock clock) {
		this.clock = clock;
	}

	public void validate(TelemetryBatchRequest batch) {
		if (batch == null) throw invalid("본문", "배치 객체가 필요합니다");
		if (batch.schemaVersion() == null) throw invalid("schemaVersion", "필수입니다");
		if (batch.schemaVersion() != 1) throw new BusinessException(TelemetryErrorCode.TELEMETRY_SCHEMA_UNSUPPORTED);
		if (batch.sessionId() == null) throw invalid("sessionId", "필수입니다");
		if (batch.events() == null || batch.events().isEmpty()) throw invalid("events", "1건 이상 필요합니다");
		if (batch.events().size() > MAX_EVENTS) {
			throw new BusinessException(TelemetryErrorCode.TELEMETRY_BATCH_TOO_LARGE, "이벤트는 요청당 " + MAX_EVENTS + "건 이하여야 합니다.");
		}
		var latest = clock.instant().plus(FUTURE_TOLERANCE);
		for (int i = 0; i < batch.events().size(); i++) {
			var at = "events[" + i + "]";
			var e = batch.events().get(i);
			if (e == null) throw invalid(at, "이벤트 객체가 필요합니다");
			event(at, e, latest);
		}
		if (batch.conditions() != null) conditions(batch.conditions());
	}

	/** 259 측정 조건의 의미 규칙(설계 3-1). 타입·목록 밖 값은 파서가 먼저 거절하므로 여기서는 길이·범위만 본다. */
	private static void conditions(Conditions c) {
		if (c.firmware() != null) {
			length("conditions.firmware.0", c.firmware().stick0(), 1, 64);
			length("conditions.firmware.1", c.firmware().stick1(), 1, 64);
		}
		length("conditions.dongleFirmware", c.dongleFirmware(), 1, 64);
		if (c.linkMask() != null && (c.linkMask() < 0 || c.linkMask() > 15)) throw invalid("conditions.linkMask", "0~15 정수여야 합니다");
		length("conditions.appBuild", c.appBuild(), 1, 64);
		length("conditions.note", c.note(), 0, 200);
	}

	/** 길이는 Java 문자 수 기준. U+0000은 PG text가 거절해 500이 되므로 여기서 400으로 막는다. */
	private static void length(String at, String value, int min, int max) {
		if (value == null) return;
		if (value.length() < min || value.length() > max) throw invalid(at, min + "~" + max + "자 문자열이어야 합니다");
		if (value.indexOf('\0') >= 0) throw invalid(at, "U+0000을 포함할 수 없습니다");
	}

	private static void event(String at, Event e, java.time.Instant latest) {
		if (e.time() == null) throw invalid(at + ".time", "필수입니다");
		if (e.time().isAfter(latest)) throw invalid(at + ".time", "서버 시각보다 5분 넘게 미래입니다");
		if (e.kind() == null) throw invalid(at + ".kind", "필수입니다");
		var tags = tags(at + ".tags", e.tags(), e.kind());

		if (e.stickId() != null && e.stickId() != 0 && e.stickId() != 1) throw invalid(at + ".stickId", "0 또는 1이어야 합니다");
		if (e.tSensor() != null && e.tSensor() < 0) throw invalid(at + ".tSensor", "0 이상이어야 합니다");
		optionalFinite(at + ".clockOffsetMs", e.clockOffsetMs());
		optionalFinite(at + ".packetLoss", e.packetLoss());
		if (e.packetLoss() != null && (e.packetLoss() < 0 || e.packetLoss() > 1)) throw invalid(at + ".packetLoss", "0~1이어야 합니다");
		if (e.batteryPct() != null && (e.batteryPct() < 0 || e.batteryPct() > 100)) throw invalid(at + ".batteryPct", "0~100이어야 합니다");

		if (e.kind() == Kind.HIT) hit(at, e, tags);
		else status(at, e);
	}

	private static void hit(String at, Event e, JsonNode tags) {
		if (e.stickId() == null && !KEYBOARD.equals(tags.get("source").asString())) {
			throw invalid(at + ".stickId", "센서 입력은 필수입니다");
		}
		if (e.velocity() == null || e.velocity() < 0 || e.velocity() > 127) throw invalid(at + ".velocity", "0~127 정수가 필요합니다");
		requiredFinite(at + ".tRecv", e.tRecv());
		requiredFinite(at + ".tJudge", e.tJudge());
		optionalFinite(at + ".tAudio", e.tAudio());
		optionalFinite(at + ".deltaMs", e.deltaMs());
		boolean timed = e.judgement() == Judgement.PERFECT || e.judgement() == Judgement.GOOD;
		if (timed && e.deltaMs() == null) throw invalid(at + ".deltaMs", "PERFECT·GOOD에는 필수입니다");
		if (!timed && e.deltaMs() != null) throw invalid(at + ".deltaMs", "판정이 없거나 MISS이면 null이어야 합니다");
	}

	private static void status(String at, Event e) {
		if (e.stickId() == null) throw invalid(at + ".stickId", "STATUS에는 필수입니다");
		mustBeNull(at + ".pad", e.pad());
		mustBeNull(at + ".baselinePad", e.baselinePad());
		mustBeNull(at + ".predictedPad", e.predictedPad());
		mustBeNull(at + ".judgement", e.judgement());
		mustBeNull(at + ".deltaMs", e.deltaMs());
		mustBeNull(at + ".velocity", e.velocity());
		mustBeNull(at + ".tRecv", e.tRecv());
		mustBeNull(at + ".tJudge", e.tJudge());
		mustBeNull(at + ".tAudio", e.tAudio());
	}

	/** 크기 → 허용 키 → 키별 타입·필수 순서. 허용 키를 상한까지 채워도 1 KiB 안이므로 크기 검사는 모르는 키를 먼저 막는다. */
	private static JsonNode tags(String at, JsonNode tags, Kind kind) {
		if (tags == null || !tags.isObject()) throw invalid(at, "JSON 객체가 필요합니다");
		if (tags.toString().getBytes(StandardCharsets.UTF_8).length > TAGS_BYTES) throw invalid(at, "1 KiB 이하여야 합니다");
		for (var name : tags.propertyNames()) {
			if (!TAG_KEYS.contains(name)) throw invalid(at, "허용하지 않는 키가 있습니다");
		}
		text(at + ".source", tags.get("source"), 32, true);
		text(at + ".firmware", tags.get("firmware"), 64, false);
		bool(at + ".clockSynced", tags.get("clockSynced"), kind == Kind.HIT);
		bool(at + ".connected", tags.get("connected"), kind == Kind.STATUS);
		return tags;
	}

	private static void text(String at, JsonNode value, int max, boolean required) {
		if (absent(value)) {
			if (required) throw invalid(at, "필수입니다");
			return;
		}
		if (!value.isString() || value.asString().isEmpty() || value.asString().length() > max) {
			throw invalid(at, "1~" + max + "자 문자열이어야 합니다");
		}
	}

	private static void bool(String at, JsonNode value, boolean required) {
		if (absent(value)) {
			if (required) throw invalid(at, "필수입니다");
			return;
		}
		if (!value.isBoolean()) throw invalid(at, "true 또는 false여야 합니다");
	}

	private static boolean absent(JsonNode value) {
		return value == null || value.isNull();
	}

	private static void requiredFinite(String at, Double value) {
		if (value == null) throw invalid(at, "필수입니다");
		optionalFinite(at, value);
	}

	/** {@code 1e999}처럼 범위를 넘는 숫자는 Infinity로 읽히므로 여기서 거절한다. */
	private static void optionalFinite(String at, Double value) {
		if (value != null && !Double.isFinite(value)) throw invalid(at, "유한한 수여야 합니다");
	}

	private static void mustBeNull(String at, Object value) {
		if (value != null) throw invalid(at, "STATUS에서는 null이어야 합니다");
	}

	private static BusinessException invalid(String at, String reason) {
		return new BusinessException(TelemetryErrorCode.TELEMETRY_EVENT_INVALID, at + ": " + reason);
	}

}
