package com.ssafy.airdrum.domain.chart.controller.query;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.stereotype.Component;

import com.ssafy.airdrum.domain.auth.security.CurrentAuthUser;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.global.error.CommonErrorCode;
import com.ssafy.airdrum.domain.user.model.AuthUser;

/**
 * 88번 인증 모듈 연결. 인증 필터가 검증한 access 토큰의 회원 id만 돌려준다.
 * 요청의 파라미터·헤더·속성에 담긴 회원 id는 보지 않는다. 인증되지 않은 요청은 401이다.
 */
@Component
class AuthenticatedChartQueryUserResolver implements ChartQueryUserResolver {

	@Override
	public long requireUserId(HttpServletRequest request) {
		return CurrentAuthUser.find()
				.map(AuthUser::id)
				.orElseThrow(() -> new BusinessException(CommonErrorCode.UNAUTHORIZED));
	}

}
