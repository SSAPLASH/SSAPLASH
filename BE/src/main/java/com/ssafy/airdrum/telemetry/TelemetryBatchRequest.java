package com.ssafy.airdrum.telemetry;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import tools.jackson.databind.JsonNode;

/**
 * schemaVersion=1 텔레메트리 배치(MONITOR-001 수신 계약). 선택 필드의 부재와 null은 같고, 필수 여부는
 * {@link TelemetryBatchValidator}가 HIT·STATUS에 따라 검사한다. 회원 ID는 받지 않고 인증 주체로 채운다.
 */
public record TelemetryBatchRequest(Integer schemaVersion, UUID sessionId, Mode mode, List<Event> events) {

	public enum Mode { RHYTHM, FREE, TEMPO, SHEET }

	public enum Kind { HIT, STATUS }

	public enum Judgement { PERFECT, GOOD, MISS }

	/** 텔레메트리 wire 패드 9종. FE의 SMALL_TOM은 HI_TOM으로 바꿔 보낸다. 플레이 업로드 enum과 별개다. */
	public enum Pad { CRASH, HIHAT, SNARE, HI_TOM, MID_TOM, FLOOR_TOM, RIDE, KICK, HIHAT_PEDAL }

	/**
	 * @param tSensor 랩 보정한 센서 시각(정수 µs)
	 * @param tRecv   브라우저 performance 시계 기준 ms. tJudge·tAudio도 같다
	 */
	public record Event(Instant time, Kind kind, Integer stickId, Pad pad, Pad baselinePad, Pad predictedPad,
			Judgement judgement, Double deltaMs, Integer velocity, Long tSensor, Double tRecv, Double tJudge,
			Double tAudio, Double clockOffsetMs, Double packetLoss, Integer batteryPct, JsonNode tags) {
	}

}
