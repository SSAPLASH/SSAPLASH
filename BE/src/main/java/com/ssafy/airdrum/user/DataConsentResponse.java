package com.ssafy.airdrum.user;

import java.time.Instant;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 데이터 활용 동의 상태. {@code PUT} 응답이자 {@code GET /api/users/me}의 {@code dataConsent}다.
 *
 * @param agreed 동의 여부. 아직 답하지 않았으면 null
 * @param updatedAt 현재 값을 선택한 시각. {@code agreed}가 null이면 null
 */
public record DataConsentResponse(
		@Schema(description = "true 동의 · false 거부 · null 아직 답하지 않음", nullable = true) Boolean agreed,
		@Schema(description = "현재 선택을 한 시각(UTC). agreed가 null이면 null", nullable = true) Instant updatedAt) {
}
