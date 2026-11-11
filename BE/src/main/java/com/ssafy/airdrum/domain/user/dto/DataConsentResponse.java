package com.ssafy.airdrum.domain.user.dto;

import java.time.Instant;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 연주 기록 활용 동의 상태. {@code GET /api/users/me}의 {@code dataConsent}다. 저장은 가입 동의 {@code POST}로만 하며
 * 철회는 탈퇴다. 미설정이면 세 값 모두 null이다.
 *
 * @param agreed 동의 여부. 아직 답하지 않았으면 null
 * @param version 동의한 안내문의 판. {@code agreed}가 null이면 null
 * @param updatedAt 현재 값을 선택한 시각. {@code agreed}가 null이면 null
 */
public record DataConsentResponse(
		@Schema(description = "true 동의 · null 아직 답하지 않음(가입 전·기존 회원)", nullable = true) Boolean agreed,
		@Schema(description = "동의한 연주 기록 활용 안내문의 판. agreed가 null이면 null", nullable = true) String version,
		@Schema(description = "현재 선택을 한 시각(UTC). agreed가 null이면 null", nullable = true) Instant updatedAt) {
}
