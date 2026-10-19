package com.ssafy.airdrum.common.error;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import static org.assertj.core.api.Assertions.assertThat;

class BusinessExceptionTest {

	/** 도메인 패키지가 ErrorCode를 구현하는 방식의 예. 테스트 소스에만 있다. */
	private enum ProbeErrorCode implements ErrorCode {
		PROBE_NOT_FOUND(HttpStatus.NOT_FOUND, "프로브 없음");

		private final HttpStatus status;
		private final String title;

		ProbeErrorCode(HttpStatus status, String title) {
			this.status = status;
			this.title = title;
		}

		@Override
		public String code() {
			return name();
		}

		@Override
		public HttpStatus status() {
			return status;
		}

		@Override
		public String title() {
			return title;
		}
	}

	@Test
	void detailDefaultsToTitle() {
		var ex = new BusinessException(ProbeErrorCode.PROBE_NOT_FOUND);

		assertThat(ex.getErrorCode()).isEqualTo(ProbeErrorCode.PROBE_NOT_FOUND);
		assertThat(ex.getDetail()).isEqualTo("프로브 없음");
		assertThat(ex.getMessage()).isEqualTo("프로브 없음");
	}

	@Test
	void keepsCustomDetail() {
		var ex = new BusinessException(CommonErrorCode.CONFLICT, "같은 이름의 프리셋이 있습니다.");

		assertThat(ex.getErrorCode()).isEqualTo(CommonErrorCode.CONFLICT);
		assertThat(ex.getDetail()).isEqualTo("같은 이름의 프리셋이 있습니다.");
		assertThat(ex.getMessage()).isEqualTo("같은 이름의 프리셋이 있습니다.");
	}

}
