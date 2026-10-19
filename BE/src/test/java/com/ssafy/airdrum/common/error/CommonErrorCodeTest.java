package com.ssafy.airdrum.common.error;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.http.HttpStatus;

import static org.assertj.core.api.Assertions.assertThat;

class CommonErrorCodeTest {

	@ParameterizedTest
	@EnumSource(CommonErrorCode.class)
	void codeStringEqualsEnumName(CommonErrorCode code) {
		assertThat(code.code()).isEqualTo(code.name());
		assertThat(code.title()).isNotBlank();
		assertThat(code.status().isError()).isTrue();
	}

	@Test
	void mapsKnownStatusesToDedicatedCodes() {
		assertThat(CommonErrorCode.fromStatus(HttpStatus.BAD_REQUEST)).isEqualTo(CommonErrorCode.INVALID_INPUT);
		assertThat(CommonErrorCode.fromStatus(HttpStatus.UNAUTHORIZED)).isEqualTo(CommonErrorCode.UNAUTHORIZED);
		assertThat(CommonErrorCode.fromStatus(HttpStatus.FORBIDDEN)).isEqualTo(CommonErrorCode.FORBIDDEN);
		assertThat(CommonErrorCode.fromStatus(HttpStatus.NOT_FOUND)).isEqualTo(CommonErrorCode.NOT_FOUND);
		assertThat(CommonErrorCode.fromStatus(HttpStatus.METHOD_NOT_ALLOWED)).isEqualTo(CommonErrorCode.METHOD_NOT_ALLOWED);
		assertThat(CommonErrorCode.fromStatus(HttpStatus.NOT_ACCEPTABLE)).isEqualTo(CommonErrorCode.NOT_ACCEPTABLE);
		assertThat(CommonErrorCode.fromStatus(HttpStatus.CONFLICT)).isEqualTo(CommonErrorCode.CONFLICT);
		assertThat(CommonErrorCode.fromStatus(HttpStatus.UNSUPPORTED_MEDIA_TYPE)).isEqualTo(CommonErrorCode.UNSUPPORTED_MEDIA_TYPE);
		assertThat(CommonErrorCode.fromStatus(HttpStatus.INTERNAL_SERVER_ERROR)).isEqualTo(CommonErrorCode.INTERNAL_ERROR);
	}

	@Test
	void fallsBackByStatusFamily() {
		// 설계 3-7: 분류되지 않은 4xx는 INVALID_INPUT, 5xx는 INTERNAL_ERROR
		assertThat(CommonErrorCode.fromStatus(HttpStatus.I_AM_A_TEAPOT)).isEqualTo(CommonErrorCode.INVALID_INPUT);
		assertThat(CommonErrorCode.fromStatus(HttpStatus.PAYLOAD_TOO_LARGE)).isEqualTo(CommonErrorCode.INVALID_INPUT);
		assertThat(CommonErrorCode.fromStatus(HttpStatus.SERVICE_UNAVAILABLE)).isEqualTo(CommonErrorCode.INTERNAL_ERROR);
		assertThat(CommonErrorCode.fromStatus(HttpStatus.OK)).isEqualTo(CommonErrorCode.INTERNAL_ERROR);
	}

}
