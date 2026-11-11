package com.ssafy.airdrum.domain.auth.config;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import org.springframework.boot.context.properties.ConfigurationProperties;

import com.ssafy.airdrum.domain.user.model.SocialProvider;

/**
 * 소셜 로그인 설정({@code auth.*}). 값은 application.yaml과 환경변수(로컬은 BE/.env)에서 온다.
 *
 * <p>{@code .env}에 {@code FRONTEND_BASE_URL=}처럼 빈 줄이 있으면 yaml의 기본값이 아니라 빈 문자열이 들어온다.
 * 그래서 빈 값을 받으면 여기서 로컬 기본값으로 되돌린다.
 *
 * @param frontendBaseUrl 로그인 후 돌아갈 FE 주소. 끝의 {@code /}는 뗀다
 * @param redirectBaseUrl 제공자에 보낼 콜백 URI의 앞부분. 요청 Host로 만들지 않는다(Nginx 뒤에서 달라진다)
 * @param loginSuccessPath FE 로그인 성공 페이지 경로
 * @param loginFailurePath FE 로그인 실패 페이지 경로. {@code ?error=}가 붙는다
 * @param cookieSecure state 쿠키와 refresh 쿠키의 Secure 속성
 * @param stateCookieMaxAge state 쿠키 수명
 * @param admin ADMIN 화이트리스트
 * @param providers 경로 값({@code google}, {@code ssafy})별 제공자 설정
 * @param jwt access 토큰 서명 설정(88번). 서명 키가 없으면 기동하지 않는다
 * @param accessTokenTtl access 토큰 수명
 * @param refreshToken refresh 토큰 수명·저장소
 */
@ConfigurationProperties("auth")
public record AuthProperties(
		String frontendBaseUrl,
		String redirectBaseUrl,
		String loginSuccessPath,
		String loginFailurePath,
		Boolean cookieSecure,
		Duration stateCookieMaxAge,
		Admin admin,
		Map<String, Provider> providers,
		Jwt jwt,
		Duration accessTokenTtl,
		RefreshToken refreshToken) {

	static final String DEFAULT_FRONTEND_BASE_URL = "http://localhost:5173";
	static final String DEFAULT_REDIRECT_BASE_URL = "http://localhost:8080";

	public AuthProperties {
		frontendBaseUrl = baseUrl(frontendBaseUrl, DEFAULT_FRONTEND_BASE_URL);
		redirectBaseUrl = baseUrl(redirectBaseUrl, DEFAULT_REDIRECT_BASE_URL);
		loginSuccessPath = orDefault(loginSuccessPath, "/auth/callback");
		loginFailurePath = orDefault(loginFailurePath, "/login");
		cookieSecure = cookieSecure == null || cookieSecure;
		stateCookieMaxAge = stateCookieMaxAge == null ? Duration.ofMinutes(5) : stateCookieMaxAge;
		admin = admin == null ? new Admin(List.of()) : admin;
		providers = providers == null ? Map.of() : Map.copyOf(providers);
		jwt = jwt == null ? new Jwt(null, null) : jwt;
		accessTokenTtl = accessTokenTtl == null ? Duration.ofMinutes(30) : accessTokenTtl;
		refreshToken = refreshToken == null ? new RefreshToken(null, null) : refreshToken;
	}

	private static String baseUrl(String value, String fallback) {
		var url = orDefault(value, fallback);
		return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
	}

	private static String orDefault(String value, String fallback) {
		return (value == null || value.isBlank()) ? fallback : value.trim();
	}

	/** @param emails ADMIN으로 판정할 이메일. 쉼표로 구분된 환경변수가 목록으로 바인딩된다 */
	public record Admin(List<String> emails) {

		public Admin {
			emails = emails == null ? List.of() : List.copyOf(emails);
		}

	}

	/**
	 * 제공자 하나의 설정. {@code clientId}·{@code clientSecret}이 모두 있어야 활성화된다.
	 *
	 * @param socialProvider DB에 저장할 제공자 값
	 * @param scope 인가 요청의 scope. null이면 파라미터를 보내지 않는다(SSAFY)
	 * @param attributes 사용자 정보 응답에서 값을 꺼낼 속성 이름
	 * @param assumeEmailVerified 제공자가 검증 여부를 주지 않을 때 이메일을 검증된 것으로 볼지(SSAFY, 10/20 결정)
	 */
	public record Provider(
			SocialProvider socialProvider,
			String clientId,
			String clientSecret,
			String authorizationUri,
			String tokenUri,
			String userInfoUri,
			String scope,
			ClientAuthenticationMethod clientAuthenticationMethod,
			Attributes attributes,
			boolean assumeEmailVerified) {

		public boolean hasCredentials() {
			return clientId != null && !clientId.isBlank() && clientSecret != null && !clientSecret.isBlank();
		}

	}

	/** 사용자 정보 응답의 속성 이름. {@code id}만 필수이고 나머지는 제공자가 주지 않으면 null이다. */
	public record Attributes(String id, String email, String emailVerified, String name, String picture) {
	}

	/**
	 * access 토큰(HS256 JWT) 서명 설정. 키는 UTF-8 32바이트 이상이어야 하며, 짧거나 없으면 바인딩 단계에서 기동을 멈춘다.
	 * 키 값은 메시지·로그에 남기지 않는다.
	 *
	 * @param secret 서명 키({@code JWT_SECRET})
	 * @param issuer {@code iss} 클레임. 검증 때도 일치해야 한다
	 */
	public record Jwt(String secret, String issuer) {

		static final int MIN_SECRET_BYTES = 32;
		static final String DEFAULT_ISSUER = "airdrum-api";

		public Jwt {
			if (secret == null || secret.isBlank() || secret.getBytes(StandardCharsets.UTF_8).length < MIN_SECRET_BYTES) {
				throw new IllegalStateException(
						"JWT 서명 키가 설정되지 않았거나 32바이트보다 짧습니다. 환경변수 JWT_SECRET을 지정하세요.");
			}
			issuer = orDefault(issuer, DEFAULT_ISSUER);
		}

	}

	/**
	 * @param ttl refresh 토큰과 쿠키의 수명
	 * @param store 저장소. {@code memory}는 재시작하면 모든 로그인이 풀리므로 테스트·로컬 전용이다
	 */
	public record RefreshToken(Duration ttl, Store store) {

		public RefreshToken {
			ttl = ttl == null ? Duration.ofDays(14) : ttl;
			store = store == null ? Store.REDIS : store;
		}

		public enum Store {
			REDIS,
			MEMORY
		}

	}

	/** 토큰 요청에서 클라이언트를 인증하는 방식. */
	public enum ClientAuthenticationMethod {
		/** {@code Authorization: Basic base64(client_id:client_secret)} (Google) */
		BASIC,
		/** 본문에 {@code client_id}·{@code client_secret} (SSAFY) */
		POST
	}

}
