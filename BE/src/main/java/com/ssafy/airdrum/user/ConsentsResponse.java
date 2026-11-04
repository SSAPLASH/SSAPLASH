package com.ssafy.airdrum.user;

import io.swagger.v3.oas.annotations.media.Schema;

/** {@code GET /api/users/me}의 {@code consents}. 객체는 항상 내려가고 동의 전 항목은 null이다. */
public record ConsentsResponse(
		@Schema(description = "이용약관 동의. 동의 전이면 null", nullable = true) ConsentRecord terms,
		@Schema(description = "개인정보 수집·이용 동의. 동의 전이면 null", nullable = true) ConsentRecord privacy) {
}
