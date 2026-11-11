package com.ssafy.airdrum.domain.auth.cookie;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;
import org.springframework.web.util.WebUtils;

import com.ssafy.airdrum.domain.auth.config.AuthProperties;
import com.ssafy.airdrum.domain.auth.exception.OAuth2FlowException;
import com.ssafy.airdrum.domain.auth.exception.OAuth2FlowException.Reason;

/**
 * 로그인 CSRF 방어용 state(설계 문서 3-4). 서버 세션 없이 HttpOnly 쿠키에 두고 콜백에서 한 번만 쓴다.
 * 로그인을 연달아 시작하면 마지막 쿠키만 남아 앞선 콜백은 실패한다.
 */
@Component
public class OAuth2StateCookie {

	static final String NAME = "oauth_state";
	static final String PATH = "/api/auth";
	private static final int STATE_BYTES = 32;

	private final SecureRandom random = new SecureRandom();
	private final boolean secure;
	private final Duration maxAge;

	public OAuth2StateCookie(AuthProperties properties) {
		this.secure = properties.cookieSecure();
		this.maxAge = properties.stateCookieMaxAge();
	}

	/** 새 state를 만들어 쿠키로 심고 반환한다. */
	public String issue(HttpServletResponse response) {
		var bytes = new byte[STATE_BYTES];
		random.nextBytes(bytes);
		var state = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
		response.addHeader(HttpHeaders.SET_COOKIE, cookie(state, maxAge).toString());
		return state;
	}

	/**
	 * 쿠키를 지우고 쿼리의 state와 비교한다. 결과와 관계없이 쿠키는 지운다.
	 *
	 * @throws OAuth2FlowException 쿠키·파라미터가 없거나 다를 때 ({@link Reason#STATE_MISMATCH})
	 */
	public void consume(HttpServletRequest request, HttpServletResponse response, String state) {
		var stored = WebUtils.getCookie(request, NAME);
		response.addHeader(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO).toString());
		if (stored == null || isBlank(stored.getValue()) || isBlank(state) || !matches(stored.getValue(), state)) {
			throw new OAuth2FlowException(Reason.STATE_MISMATCH, null);
		}
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

	/** 길이·내용 차이를 시간으로 드러내지 않는 비교. */
	private static boolean matches(String expected, String actual) {
		return MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), actual.getBytes(StandardCharsets.UTF_8));
	}

	private static boolean isBlank(String value) {
		return value == null || value.isBlank();
	}

}
