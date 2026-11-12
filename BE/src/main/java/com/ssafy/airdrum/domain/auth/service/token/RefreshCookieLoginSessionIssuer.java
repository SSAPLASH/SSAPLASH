package com.ssafy.airdrum.domain.auth.service.token;

import jakarta.servlet.http.HttpServletResponse;

import org.springframework.stereotype.Component;

import com.ssafy.airdrum.domain.auth.cookie.RefreshTokenCookie;
import com.ssafy.airdrum.domain.user.model.AuthUser;
import com.ssafy.airdrum.domain.user.entity.User;

/**
 * 로그인 성공 처리(설계 문서(88) 4-A). refresh 토큰을 발급해 쿠키로 심는다. access 토큰은 FE가 이어서
 * {@code POST /api/auth/refresh}로 받는다. 저장소 장애 등 예외는 그대로 올려 콜백이 로그인 실패로 처리하게 한다.
 */
@Component
class RefreshCookieLoginSessionIssuer implements LoginSessionIssuer {

	private final RefreshTokenService refreshTokens;
	private final RefreshTokenCookie cookie;

	RefreshCookieLoginSessionIssuer(RefreshTokenService refreshTokens, RefreshTokenCookie cookie) {
		this.refreshTokens = refreshTokens;
		this.cookie = cookie;
	}

	@Override
	public void issue(User user, HttpServletResponse response) {
		cookie.issue(response, refreshTokens.issue(new AuthUser(user.getId(), user.getRole())));
	}

}
