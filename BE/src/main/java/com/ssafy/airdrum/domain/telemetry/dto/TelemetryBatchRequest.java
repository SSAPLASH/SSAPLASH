package com.ssafy.airdrum.domain.telemetry.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import tools.jackson.databind.JsonNode;

/**
 * schemaVersion=1 텔레메트리 배치(MONITOR-001 수신 계약). 선택 필드의 부재와 null은 같고, 필수 여부는
 * {@link TelemetryBatchValidator}가 HIT·STATUS에 따라 검사한다. 회원 ID는 받지 않고 인증 주체로 채운다.
 *
 * @param conditions 측정 세션 실험 조건(259번, MONITOR-002). 선택이며 없거나 null이면 조건 행을 건드리지 않는다
 */
public record TelemetryBatchRequest(Integer schemaVersion, UUID sessionId, Mode mode, List<Event> events, Conditions conditions) {

	public enum Mode { RHYTHM, FREE, TEMPO, SHEET }

	public enum Kind { HIT, STATUS }

	public enum Judgement { PERFECT, GOOD, MISS }

	/** 텔레메트리 패드 9종. 이전 HI_TOM 입력도 SMALL_TOM으로 정규화한다. */
	public enum Pad { CRASH, HIHAT, SNARE, @JsonAlias("HI_TOM") SMALL_TOM, MID_TOM, FLOOR_TOM, RIDE, KICK, HIHAT_PEDAL }

	/** 센서 부착 위치(EMB 확정, 2026-11-06). GRIP_FRONT는 하우징 안 그립 앞, BENCH는 하우징 없이 책상·손에 둔 시험용이다. */
	public enum SensorMount { GRIP_FRONT, BENCH }

	/**
	 * @param tSensor 랩 보정한 센서 시각(정수 µs)
	 * @param tRecv   브라우저 performance 시계 기준 ms. tJudge·tAudio도 같다
	 */
	public record Event(Instant time, Kind kind, Integer stickId, Pad pad, Pad baselinePad, Pad predictedPad,
			Judgement judgement, Double deltaMs, Integer velocity, Long tSensor, Double tRecv, Double tJudge,
			Double tAudio, Double clockOffsetMs, Double packetLoss, Integer batteryPct, JsonNode tags) {
	}

	/**
	 * 측정 세션 실험 조건 7개(FE 회신 2026-11-06). FE가 매 배치에 그 시점의 전체 값을 붙이고 서버는 마지막 값으로 행을 통째로 바꾼다.
	 * 이 객체 안의 모르는 키만 무시한다(EMB가 필드를 더할 때 FE를 먼저 배포할 수 있게). 외피·이벤트의 모르는 키는 여전히 거절한다.
	 * 세션 목록 응답에도 같은 모양으로 나간다.
	 *
	 * @param firmware       스틱별 펌웨어. 아직 STATUS를 못 받은 스틱은 null
	 * @param dongleFirmware 동글 펌웨어. 블루투스 직결이면 null
	 * @param linkMask       동글 LINK 연결 마스크 0~15(bit0 왼손, bit1 오른손, bit2 왼발, bit3 오른발)
	 * @param hapticEnable   타격 진동 켬/끔. FE가 값을 확인했을 때만 채운다
	 * @param appBuild       FE 빌드 식별자
	 * @param note           측정자 메모 0~200자
	 */
	@JsonIgnoreProperties(ignoreUnknown = true)
	public record Conditions(Firmware firmware, String dongleFirmware, Integer linkMask, Boolean hapticEnable, SensorMount sensorMount,
			String appBuild, String note) {
	}

	/** 스틱별 펌웨어 {@code {"0": "1.5", "1": null}}. 0 왼손·1 오른손. 그 밖의 키는 무시한다(설계 U4). */
	@JsonIgnoreProperties(ignoreUnknown = true)
	public record Firmware(@JsonProperty("0") String stick0, @JsonProperty("1") String stick1) {
	}

}
