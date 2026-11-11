package com.ssafy.airdrum.domain.auth.service.token;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;

import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;

import com.ssafy.airdrum.domain.auth.config.AuthProperties;
import com.ssafy.airdrum.domain.auth.config.AuthPropertiesFixture;
import com.ssafy.airdrum.domain.auth.config.AuthTokenPropertiesTest;
import com.ssafy.airdrum.domain.auth.exception.AccessTokenException;
import com.ssafy.airdrum.domain.auth.security.SecurityConfig;
import com.ssafy.airdrum.domain.auth.exception.AccessTokenException.Reason;
import com.ssafy.airdrum.domain.user.model.AuthUser;
import com.ssafy.airdrum.domain.user.model.UserRole;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;

/** 설계 문서(88) 3-4, 인수 조건 4·9: access 토큰 형식과 검증 실패 사유. */
public class AccessTokenServiceTest {

	public static final String SECRET = AuthTokenPropertiesTest.SECRET_32;
	static final Instant NOW = Instant.parse("2026-10-21T03:00:00Z");

	private final AccessTokenService service = service(SECRET, "airdrum-api", NOW);

	@Test
	void issuedTokenCarriesOnlySubjectIssuerAndTimes() {
		var issued = service.issue(new AuthUser(7L, UserRole.ADMIN), NOW);

		assertThat(issued.expiresAt()).isEqualTo(NOW.plus(Duration.ofMinutes(30)));
		assertThat(issued.token().split("\\.")).hasSize(3);
		var header = decodePart(issued.token(), 0);
		assertThat(header).contains("\"alg\":\"HS256\"").contains("\"typ\":\"JWT\"");
		var payload = decodePart(issued.token(), 1);
		assertThat(payload).contains("\"sub\":\"7\"").contains("\"iss\":\"airdrum-api\"")
				.contains("\"iat\":" + NOW.getEpochSecond())
				.contains("\"exp\":" + NOW.plus(Duration.ofMinutes(30)).getEpochSecond())
				// role·닉네임·이메일은 토큰에 넣지 않는다(설계 결정 2)
				.doesNotContain("ADMIN").doesNotContain("role");
	}

	@Test
	void verifyReturnsUserIdAndExpiry() {
		var issued = service.issue(new AuthUser(7L, UserRole.USER), NOW);

		var claims = service.verify(issued.token());

		assertThat(claims.userId()).isEqualTo(7L);
		assertThat(claims.expiresAt()).isEqualTo(issued.expiresAt());
	}

	@Test
	void expiredTokenIsRejectedAfterSixtySecondsOfSkew() {
		var token = service.issue(new AuthUser(7L, UserRole.USER), NOW).token();
		var expiry = NOW.plus(Duration.ofMinutes(30));

		assertThat(service(SECRET, null, expiry.plusSeconds(59)).verify(token).userId()).isEqualTo(7L);
		assertReason(service(SECRET, null, expiry.plusSeconds(61)), token, Reason.EXPIRED);
	}

	@Test
	void tokenSignedWithAnotherKeyOrIssuerIsRejected() {
		var otherKey = service("another-secret-0123456789abcdefgh", null, NOW).issue(user(), NOW).token();
		var otherIssuer = service(SECRET, "someone-else", NOW).issue(user(), NOW).token();

		assertReason(service, otherKey, Reason.INVALID_SIGNATURE);
		assertReason(service, otherIssuer, Reason.INVALID_SIGNATURE);
	}

	@Test
	void tamperedPayloadIsRejected() {
		var parts = service.issue(user(), NOW).token().split("\\.");
		var forged = Base64.getUrlEncoder().withoutPadding()
				.encodeToString(decodePart(parts[0] + "." + parts[1], 1).replace("\"7\"", "\"8\"")
						.getBytes(StandardCharsets.UTF_8));

		assertReason(service, parts[0] + "." + forged + "." + parts[2], Reason.INVALID_SIGNATURE);
	}

	@Test
	void unsignedTokenIsRejected() {
		var encoder = Base64.getUrlEncoder().withoutPadding();
		var header = encoder.encodeToString("{\"alg\":\"none\"}".getBytes(StandardCharsets.UTF_8));
		var payload = encoder.encodeToString(("{\"sub\":\"7\",\"iss\":\"airdrum-api\",\"exp\":"
				+ NOW.plusSeconds(600).getEpochSecond() + "}").getBytes(StandardCharsets.UTF_8));

		assertReason(service, header + "." + payload + ".", Reason.INVALID_SIGNATURE);
	}

	@Test
	void malformedValuesAreRejected() {
		for (var token : new String[] { null, "", " ", "abc", "a.b.c" }) {
			assertReason(service, token, Reason.MALFORMED);
		}
	}

	@Test
	void signedTokenWithoutNumericSubjectOrExpiryIsMalformed() {
		var noNumber = JwtClaimsSet.builder().issuer("airdrum-api").subject("kim").issuedAt(NOW)
				.expiresAt(NOW.plusSeconds(600)).build();
		var noExpiry = JwtClaimsSet.builder().issuer("airdrum-api").subject("7").issuedAt(NOW).build();

		assertReason(service, sign(noNumber), Reason.MALFORMED);
		assertReason(service, sign(noExpiry), Reason.MALFORMED);
	}

	@Test
	void exceptionMessageDoesNotLeakToken() {
		var token = service("another-secret-0123456789abcdefgh", null, NOW).issue(user(), NOW).token();

		assertThatExceptionOfType(AccessTokenException.class).isThrownBy(() -> service.verify(token))
				.withMessageNotContaining(token);
	}

	public static AccessTokenService service(String secret, String issuer, Instant now) {
		var properties = AuthPropertiesFixture.withJwt(new AuthProperties.Jwt(secret, issuer));
		return new AccessTokenService(SecurityConfig.jwtEncoder(properties), SecurityConfig.jwtDecoder(properties),
				properties, Clock.fixed(now, ZoneOffset.UTC));
	}

	private static String sign(JwtClaimsSet claims) {
		var properties = AuthPropertiesFixture.withJwt(new AuthProperties.Jwt(SECRET, null));
		var header = JwsHeader.with(MacAlgorithm.HS256).type("JWT").build();
		return SecurityConfig.jwtEncoder(properties).encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
	}

	private static void assertReason(AccessTokenService service, String token, Reason reason) {
		assertThatExceptionOfType(AccessTokenException.class).isThrownBy(() -> service.verify(token))
				.satisfies(ex -> assertThat(ex.getReason()).isEqualTo(reason));
	}

	private static AuthUser user() {
		return new AuthUser(7L, UserRole.USER);
	}

	private static String decodePart(String token, int index) {
		return new String(Base64.getUrlDecoder().decode(token.split("\\.")[index]), StandardCharsets.UTF_8);
	}

}
