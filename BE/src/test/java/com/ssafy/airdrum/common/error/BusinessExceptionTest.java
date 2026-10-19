package com.ssafy.airdrum.common.error;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class BusinessExceptionTest {

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
