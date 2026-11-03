package com.ssafy.airdrum.recording;

import java.time.Instant;
import java.util.UUID;

import io.swagger.v3.oas.annotations.media.Schema;

/** 녹음 응답(256번 설계 3-3절). 시퀀스(hits)는 상세 조회(257)에서만 준다. */
final class RecordingResponses {
	private RecordingResponses() {
	}

	@Schema(description = "녹음 요약")
	record RecordingSummary(long id, UUID clientKey, String title, String mode, String inputSource,
			@Schema(description = "연결된 플레이 ID. 없거나 플레이가 지워지면 null") UUID playId,
			int hitCount, int durationMs, Instant startedAt, Instant createdAt, Instant updatedAt) {
	}
}
