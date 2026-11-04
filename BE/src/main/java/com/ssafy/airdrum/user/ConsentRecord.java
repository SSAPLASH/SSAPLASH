package com.ssafy.airdrum.user;

import java.time.Instant;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 동의 한 건(이용약관·개인정보). {@code GET /api/users/me}의 {@code consents} 안에 들어간다.
 *
 * @param version 동의한 판
 * @param agreedAt 이 판에 동의한 시각(UTC)
 */
public record ConsentRecord(
		@Schema(description = "동의한 판") String version,
		@Schema(description = "이 판에 동의한 시각(UTC)") Instant agreedAt) {

	/** 판·시각이 없으면(동의 전) null이다. DB CHECK가 둘이 함께 있거나 함께 없음을 보장한다. */
	static ConsentRecord of(String version, Instant agreedAt) {
		return version == null || agreedAt == null ? null : new ConsentRecord(version, agreedAt);
	}

}
