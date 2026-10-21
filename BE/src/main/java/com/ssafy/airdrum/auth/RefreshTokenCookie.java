package com.ssafy.airdrum.auth;

import java.time.Duration;
import java.util.Optional;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;
import org.springframework.web.util.WebUtils;

/**
 * refresh 토큰 쿠키(설계 문서(88) 3-4, FE 회신 2절). {@code Path=/api/auth}라 인증 API 요청에만 실린다.
 * 속성 체계는 {@link OAuth2StateCookie}와 같다.
 */
@Component
public class RefreshTokenCookie {

	static final String NAME = "refresh_token";
	static final String PATH = "/api/auth";

	private final boolean secure;
	private final Duration maxAge;

	public RefreshTokenCookie(AuthProperties properties) {
		this.secure = properties.cookieSecure();
		this.maxAge = properties.refreshToken().ttl();
	}

	public void issue(HttpServletResponse response, String token) {
		response.addHeader(HttpHeaders.SET_COOKIE, cookie(token, maxAge).toString());
	}

	public void clear(HttpServletResponse response) {
		response.addHeader(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO).toString());
	}

	/** 형식(43자 Base64 URL)이 맞는 값만 돌려준다. 없거나 틀리면 빈 값. */
	public Optional<String> read(HttpServletRequest request) {
		var cookie = WebUtils.getCookie(request, NAME);
		if (cookie == null || !RefreshTokenService.isWellFormed(cookie.getValue())) {
			return Optional.empty();
		}
		return Optional.of(cookie.getValue());
	}

	private ResponseCookie cookie(String value, Duration maxAge) {
		return ResponseCookie.from(NAME, value)
				.httpOnly(true)
				.secure(secure)
				.sameSite("Lax")
				.path(PATH)
				.maxAge(maxAge)
				.build();
	}

}
