package com.ssafy.airdrum.user;

import jakarta.validation.constraints.NotNull;

import io.swagger.v3.oas.annotations.media.Schema;

/** {@code PUT /api/users/me/data-consent} 본문. null로 되돌리는 요청은 받지 않는다. */
public record DataConsentRequest(
		@Schema(description = "동의 여부. true 동의 · false 거부. 필수", example = "true") @NotNull Boolean agreed) {
}
