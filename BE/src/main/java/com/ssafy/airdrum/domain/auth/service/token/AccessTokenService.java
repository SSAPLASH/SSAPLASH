package com.ssafy.airdrum.domain.auth.service.token;

import java.text.ParseException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.stereotype.Service;

import com.nimbusds.jwt.JWTParser;
import com.ssafy.airdrum.domain.auth.config.AuthProperties;
import com.ssafy.airdrum.domain.auth.exception.AccessTokenException;
import com.ssafy.airdrum.domain.auth.exception.AccessTokenException.Reason;
import com.ssafy.airdrum.domain.user.model.AuthUser;

/**
 * access 토큰(HS256 JWT) 발급·검증(설계 문서(88) 3-4). 클레임은 {@code iss}·{@code sub}(회원 id)·{@code iat}·{@code exp}뿐이다.
 * 권한·상태는 넣지 않는다 — 인증 때마다 DB에서 읽는다.
 *
 * <p>서명·발급자는 디코더가, 만료는 이 클래스가 {@link Clock}으로 확인한다. 만료를 따로 보는 이유는 사유를
 * {@link Reason#EXPIRED}로 정확히 구분하고 테스트에서 시각을 고정하기 위해서다.
 */
@Service
public class AccessTokenService {

	/** 서버 간 시계 차이 허용 오차. Nimbus 기본값과 같다(설계 U7). */
	static final Duration CLOCK_SKEW = Duration.ofSeconds(60);

	private final JwtEncoder encoder;
	private final JwtDecoder decoder;
	private final String issuer;
	private final Duration ttl;
	private final Clock clock;

	public AccessTokenService(JwtEncoder encoder, JwtDecoder decoder, AuthProperties properties, Clock clock) {
		this.encoder = encoder;
		this.decoder = decoder;
		this.issuer = properties.jwt().issuer();
		this.ttl = properties.accessTokenTtl();
		this.clock = clock;
	}

	/** {@code now}부터 {@code auth.access-token-ttl} 동안 유효한 토큰을 만든다. */
	public IssuedAccessToken issue(AuthUser user, Instant now) {
		var issuedAt = now.truncatedTo(ChronoUnit.SECONDS);
		var expiresAt = issuedAt.plus(ttl);
		var claims = JwtClaimsSet.builder()
				.issuer(issuer)
				.subject(String.valueOf(user.id()))
				.issuedAt(issuedAt)
				.expiresAt(expiresAt)
				.build();
		var header = JwsHeader.with(MacAlgorithm.HS256).type("JWT").build();
		var token = encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
		return new IssuedAccessToken(token, expiresAt);
	}

	/** 토큰 수명. 응답의 {@code expiresIn}이다. */
	public Duration ttl() {
		return ttl;
	}

	/**
	 * @throws AccessTokenException 형식·서명·발급자·만료 중 하나라도 맞지 않을 때
	 */
	public AccessTokenClaims verify(String token) {
		if (token == null || token.isBlank()) {
			throw new AccessTokenException(Reason.MALFORMED);
		}
		try {
			JWTParser.parse(token);
		}
		catch (ParseException ex) {
			throw new AccessTokenException(Reason.MALFORMED);
		}
		org.springframework.security.oauth2.jwt.Jwt jwt;
		try {
			jwt = decoder.decode(token);
		}
		catch (JwtException ex) {
			throw new AccessTokenException(Reason.INVALID_SIGNATURE);
		}
		var expiresAt = jwt.getExpiresAt();
		var userId = userId(jwt.getSubject());
		if (expiresAt == null || userId == null) {
			throw new AccessTokenException(Reason.MALFORMED);
		}
		if (clock.instant().isAfter(expiresAt.plus(CLOCK_SKEW))) {
			throw new AccessTokenException(Reason.EXPIRED);
		}
		return new AccessTokenClaims(userId, expiresAt);
	}

	private static Long userId(String subject) {
		if (subject == null || !subject.matches("[1-9][0-9]{0,18}")) {
			return null;
		}
		try {
			return Long.parseLong(subject);
		}
		catch (NumberFormatException ex) {
			return null;
		}
	}

	/** @param token 응답 본문의 {@code accessToken} 값 @param expiresAt {@code exp} */
	public record IssuedAccessToken(String token, Instant expiresAt) {
	}

	/** 검증을 통과한 토큰의 내용. 회원 상태는 아직 확인하지 않은 값이다. */
	public record AccessTokenClaims(long userId, Instant expiresAt) {
	}

}
