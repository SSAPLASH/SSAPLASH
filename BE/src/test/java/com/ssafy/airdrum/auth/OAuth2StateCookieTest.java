package com.ssafy.airdrum.auth;

import java.util.Map;

import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import com.ssafy.airdrum.auth.OAuth2FlowException.Reason;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;
import static org.assertj.core.api.Assertions.assertThatNoException;

/** 설계 문서 3-4: state 쿠키는 HttpOnly·SameSite=Lax·Path=/api/auth이고, 콜백에서 한 번만 쓰고 지운다. */
class OAuth2StateCookieTest {

	private final OAuth2StateCookie stateCookie = new OAuth2StateCookie(
			OAuth2ProviderRegistryTest.properties("http://localhost:8080", Map.of()));

	@Test
	void issueSetsRandomUrlSafeStateCookieWithSecureAttributes() {
		var response = new MockHttpServletResponse();

		var state = stateCookie.issue(response);

		assertThat(state).hasSize(43).matches("[A-Za-z0-9_-]+");
		var header = response.getHeader(HttpHeaders.SET_COOKIE);
		assertThat(header).startsWith("oauth_state=" + state + ";")
				.contains("Path=/api/auth").contains("Max-Age=300").contains("HttpOnly").contains("Secure")
				.contains("SameSite=Lax");
		assertThat(stateCookie.issue(new MockHttpServletResponse())).isNotEqualTo(state);
	}

	@Test
	void matchingStateIsConsumedAndCookieIsDeleted() {
		var request = requestWithCookie("abc123");
		var response = new MockHttpServletResponse();

		assertThatNoException().isThrownBy(() -> stateCookie.consume(request, response, "abc123"));

		var header = response.getHeader(HttpHeaders.SET_COOKIE);
		assertThat(header).startsWith("oauth_state=;").contains("Max-Age=0").contains("Path=/api/auth");
	}

	@Test
	void mismatchMissingCookieOrMissingStateFailsButStillDeletesCookie() {
		assertMismatch(requestWithCookie("abc123"), "other");
		assertMismatch(new MockHttpServletRequest(), "abc123");
		assertMismatch(requestWithCookie("abc123"), null);
		assertMismatch(requestWithCookie(""), "");
	}

	private void assertMismatch(MockHttpServletRequest request, String state) {
		var response = new MockHttpServletResponse();
		assertThatExceptionOfType(OAuth2FlowException.class)
				.isThrownBy(() -> stateCookie.consume(request, response, state))
				.satisfies(ex -> assertThat(ex.getReason()).isEqualTo(Reason.STATE_MISMATCH));
		assertThat(response.getHeader(HttpHeaders.SET_COOKIE)).contains("Max-Age=0");
	}

	private static MockHttpServletRequest requestWithCookie(String value) {
		var request = new MockHttpServletRequest();
		request.setCookies(new Cookie("oauth_state", value));
		return request;
	}

}
