package com.ssafy.airdrum.user;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import io.swagger.v3.oas.annotations.media.Schema;

/** 맞춤 곡 추천 학습 활용 동의(선택). 연주 기록 활용 동의와 달리 거절과 철회가 가능하다. */
public record RecommendationConsentInput(
		@Schema(description = "동의 여부", example = "true")
		@NotNull Boolean agreed,
		@Schema(description = "안내문의 판(1~50자, 공백만 불가)", example = "2026-11-05")
		@NotBlank @Size(max = 50) String version) {
}
