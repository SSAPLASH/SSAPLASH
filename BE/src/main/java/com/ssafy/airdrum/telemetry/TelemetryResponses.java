package com.ssafy.airdrum.telemetry;

import java.time.Instant;
import java.util.UUID;

import tools.jackson.databind.JsonNode;

/** 텔레메트리 API 응답. 공통 규칙대로 감싸지 않고 그대로 낸다. */
public final class TelemetryResponses {

	private TelemetryResponses() {
	}

	/** @param acceptedCount 커밋된 이벤트 수. 부분 저장은 없으므로 요청 건수와 같다 */
	public record BatchAccepted(int acceptedCount) {
	}

	/**
	 * 조회 기간 안의 {@code (userId, sessionId)} 집계. 기간 밖 이벤트는 세지 않는다.
	 *
	 * @param mode 가장 최근 이벤트의 mode. 장치 진단 세션은 null
	 */
	public record SessionSummary(Long userId, UUID sessionId, String mode, Instant firstEventTime, Instant lastEventTime,
			long eventCount, long hitCount, long statusCount) {
	}

	/** 저장된 이벤트. 과거 HI_TOM 패드 값은 SMALL_TOM으로 반환한다. */
	public record EventItem(Instant time, String kind, Integer stickId, String pad, String baselinePad, String predictedPad,
			String judgement, Double deltaMs, Integer velocity, Long tSensor, Double tRecv, Double tJudge, Double tAudio,
			Double clockOffsetMs, Double packetLoss, Integer batteryPct, JsonNode tags) {
	}

}
