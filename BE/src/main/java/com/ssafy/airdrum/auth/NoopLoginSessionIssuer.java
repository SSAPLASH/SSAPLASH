package com.ssafy.airdrum.auth;

import jakarta.servlet.http.HttpServletResponse;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import com.ssafy.airdrum.user.User;

/** 88번 전까지의 임시 구현. 아무것도 발급하지 않는다. 88번이 실제 구현을 넣을 때 이 클래스를 지운다. */
@Component
class NoopLoginSessionIssuer implements LoginSessionIssuer {

	private static final Logger log = LoggerFactory.getLogger(NoopLoginSessionIssuer.class);

	@Override
	public void issue(User user, HttpServletResponse response) {
		log.warn("세션 발급 미구현(S15P31A307-88 전). 회원 {} 로그인은 회원 확정까지만 처리합니다.", user.getId());
	}

}
