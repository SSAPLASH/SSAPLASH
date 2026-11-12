package com.ssafy.airdrum.domain.chart.controller.query;

import jakarta.servlet.http.HttpServletRequest;

/**
 * 88번 인증 모듈 연결 지점. 검증된 AuthUser.id만 반환하는 Bean을 인증 모듈에서 제공한다.
 * 요청 파라미터·헤더의 사용자 ID를 신뢰해서는 안 된다. Bean이 없으면 조회는 모두 401이다.
 */
@FunctionalInterface
public interface ChartQueryUserResolver {
	long requireUserId(HttpServletRequest request);
}
