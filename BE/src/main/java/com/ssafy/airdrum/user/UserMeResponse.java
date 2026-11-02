package com.ssafy.airdrum.user;

import java.time.Instant;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * {@code GET /api/users/me} 응답(FE 회신 2절, 가입 동의 설계 3-1). 이메일·상태는 내보내지 않는다.
 * 가입 동의 {@code POST}의 응답도 이 형식이다.
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
		@Schema(description = "가입 완료 여부. 이용약관·개인정보 동의가 둘 다 있으면 true. 역할과 무관하다")
		boolean signupCompleted,
		@Schema(description = "이용약관·개인정보 동의. 객체는 항상 내려가고, 동의 전 항목은 null이다")
		ConsentsResponse consents,
		@Schema(description = "연주 기록 활용 동의 상태. 객체는 항상 내려가고, 아직 동의하지 않았으면 안의 값이 모두 null이다")
		DataConsentResponse dataConsent) {
}
