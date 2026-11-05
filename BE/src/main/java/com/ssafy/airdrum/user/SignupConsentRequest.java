package com.ssafy.airdrum.user;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * {@code POST /api/users/me/signup-consent} 본문(가입 동의 설계 3-2). 판은 FE가 정한 문자열이며 서버는 빈 값만 거부하고
 * 비교·해석하지 않는다.
 */
public record SignupConsentRequest(
		@Schema(description = "동의한 이용약관의 판(1~50자, 공백만 불가)", example = "2026-11-01")
		@NotBlank @Size(max = 50) String termsVersion,
		@Schema(description = "동의한 개인정보 수집·이용 안내의 판(1~50자, 공백만 불가)", example = "2026-11-01")
		@NotBlank @Size(max = 50) String privacyVersion,
		@Schema(description = "연주 기록 활용 동의(필수)")
		@NotNull @Valid DataConsentInput dataConsent,
		@Schema(description = "맞춤 곡 추천 학습 활용 동의(선택). 생략하면 미동의이고 이전 응답을 바꾸지 않는다")
		@Valid RecommendationConsentInput recommendationConsent) {

	public SignupConsentRequest(String termsVersion, String privacyVersion, DataConsentInput dataConsent) {
		this(termsVersion, privacyVersion, dataConsent, null);
	}
}
