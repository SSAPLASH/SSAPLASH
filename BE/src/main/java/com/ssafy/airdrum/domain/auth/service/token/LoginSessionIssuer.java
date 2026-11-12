package com.ssafy.airdrum.domain.auth.service.token;

import jakarta.servlet.http.HttpServletResponse;

import com.ssafy.airdrum.domain.user.entity.User;

/**
 * 로그인 성공 처리. 콜백이 회원을 확정한 뒤, FE로 리다이렉트하기 전에 한 번 호출한다(설계 문서 3-6).
 *
 * <p>구현은 응답에 쿠키·헤더를 더할 수 있고 본문은 쓰지 않는다. 예외를 던지면 콜백은 로그인 실패로 처리한다.
 * 88번(JWT·refresh)이 refresh 쿠키 발급으로 구현한다.
 */
public interface LoginSessionIssuer {

	void issue(User user, HttpServletResponse response);

}
