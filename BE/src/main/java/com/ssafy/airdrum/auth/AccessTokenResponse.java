package com.ssafy.airdrum.auth;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * {@code POST /api/auth/refresh} 응답(FE 회신 2절).
 *
 * @param accessToken {@code Authorization: Bearer}에 넣을 값
 * @param tokenType 항상 {@code Bearer}
 * @param expiresIn 남은 수명(초)
 */
public record AccessTokenResponse(
		@Schema(description = "access 토큰(JWT)") String accessToken,
		@Schema(description = "항상 Bearer", example = "Bearer") String tokenType,
		@Schema(description = "만료까지 남은 초", example = "1800") long expiresIn) {

	static final String BEARER = "Bearer";

}
