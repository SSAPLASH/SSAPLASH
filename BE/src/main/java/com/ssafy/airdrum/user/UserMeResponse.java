package com.ssafy.airdrum.user;

import java.time.Instant;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * {@code GET /api/users/me} 응답(FE 회신 2절). 이메일·상태는 내보내지 않는다.
 *
 * @param provider 로그인한 제공자. 한 회원은 지금 연동이 하나다
 */
public record UserMeResponse(
		@Schema(description = "회원 ID") Long id,
		@Schema(description = "로그인한 제공자") SocialProvider provider,
		@Schema(description = "닉네임(1~30자)") String nickname,
		@Schema(description = "프로필 이미지 URL. 없으면 null", nullable = true) String profileImageUrl,
		@Schema(description = "권한") UserRole role,
		@Schema(description = "생성 시각(UTC)") Instant createdAt,
		@Schema(description = "수정 시각(UTC)") Instant updatedAt,
		@Schema(description = "연주 기록 활용 동의 상태. 객체는 항상 내려가고, 아직 답하지 않았으면 안의 값이 null이다")
		DataConsentResponse dataConsent) {
}
