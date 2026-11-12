package com.ssafy.airdrum.domain.auth.cookie;

import java.time.Duration;
import java.util.List;
import java.util.Map;

import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;
import com.ssafy.airdrum.domain.auth.config.AuthProperties;
import com.ssafy.airdrum.domain.auth.config.AuthPropertiesFixture;
import com.ssafy.airdrum.domain.auth.config.AuthTokenPropertiesTest;

/** 설계 문서(88) 3-4, 인수 조건 3·5: refresh 쿠키 속성과 읽기 형식 검사. */
class RefreshTokenCookieTest {

	static final String TOKEN = "A".repeat(20) + "b-_" + "9".repeat(20);

	private final RefreshTokenCookie cookie = new RefreshTokenCookie(AuthPropertiesFixture.defaults());

	@Test
	void issuedCookieHasContractAttributes() {
		var response = new MockHttpServletResponse();

		cookie.issue(response, TOKEN);

		assertThat(response.getHeader(HttpHeaders.SET_COOKIE)).startsWith("refresh_token=" + TOKEN + ";")
				.contains("Path=/api/auth").contains("Max-Age=1209600").contains("HttpOnly").contains("Secure")
				.contains("SameSite=Lax");
	}

	@Test
	void secureFollowsCookieSecureSetting() {
		var insecure = new AuthProperties(null, null, null, null, false, Duration.ofMinutes(5),
				new AuthProperties.Admin(List.of()), Map.of(),
				new AuthProperties.Jwt(AuthTokenPropertiesTest.SECRET_32, null), null, null);
		var response = new MockHttpServletResponse();

		new RefreshTokenCookie(insecure).issue(response, TOKEN);

		assertThat(response.getHeader(HttpHeaders.SET_COOKIE)).doesNotContain("Secure");
	}

	@Test
	void clearExpiresCookieWithSameAttributes() {
		var response = new MockHttpServletResponse();

		cookie.clear(response);

		assertThat(response.getHeader(HttpHeaders.SET_COOKIE)).startsWith("refresh_token=;").contains("Max-Age=0")
				.contains("Path=/api/auth").contains("HttpOnly").contains("SameSite=Lax");
	}

	@Test
	void readReturnsWellFormedValueOnly() {
		assertThat(cookie.read(request(TOKEN))).contains(TOKEN);
		assertThat(cookie.read(new MockHttpServletRequest())).isEmpty();
		for (var bad : new String[] { "", "A".repeat(42), "A".repeat(44), "+".repeat(43), "A".repeat(42) + "=" }) {
			assertThat(cookie.read(request(bad))).as(bad).isEmpty();
		}
	}

	private static MockHttpServletRequest request(String value) {
		var request = new MockHttpServletRequest();
		request.setCookies(new Cookie("refresh_token", value));
		return request;
	}

}
