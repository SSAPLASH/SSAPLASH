package com.ssafy.airdrum.user;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import io.swagger.v3.oas.annotations.media.Schema;

/** 가입 동의 본문의 연주 기록 활용 동의. 필수 동의라 {@code true}만 받는다(FE 회신 2, 거부 상태는 저장하지 않는다). */
public record DataConsentInput(
		@Schema(description = "동의 여부. true만 허용(false·null·누락은 400)", example = "true")
		@NotNull @AssertTrue Boolean agreed,
		@Schema(description = "동의한 연주 기록 활용 안내문의 판(1~50자, 공백만 불가)", example = "2026-11-01")
		@NotBlank @Size(max = 50) String version) {
}
