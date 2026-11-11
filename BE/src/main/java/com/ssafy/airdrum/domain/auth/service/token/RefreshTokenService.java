package com.ssafy.airdrum.domain.auth.service.token;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.HexFormat;
import java.util.regex.Pattern;

import org.springframework.stereotype.Service;

import com.ssafy.airdrum.domain.auth.config.AuthProperties;
import com.ssafy.airdrum.domain.auth.repository.token.RefreshTokenStore;
import com.ssafy.airdrum.domain.auth.security.AuthenticationService;
import com.ssafy.airdrum.domain.user.model.AuthUser;

/**
 * refresh 토큰 발급·회전·폐기(설계 문서(88) 3-4·4-B). 원문은 쿠키로만 나가고 서버는 SHA-256 해시만 보관한다.
 * 원문을 로그·예외 메시지에 남기지 않는다.
 */
@Service
public class RefreshTokenService {

	/** 32바이트 난수의 Base64 URL(패딩 없음) 표현. */
	static final Pattern FORMAT = Pattern.compile("[A-Za-z0-9_-]{43}");
	private static final int TOKEN_BYTES = 32;

	private final SecureRandom random = new SecureRandom();
	private final RefreshTokenStore store;
	private final AuthenticationService authentication;
	private final Duration ttl;

	public RefreshTokenService(RefreshTokenStore store, AuthenticationService authentication, AuthProperties properties) {
		this.store = store;
		this.authentication = authentication;
		this.ttl = properties.refreshToken().ttl();
	}

	/** @return 쿠키에 넣을 토큰 원문. 호출자는 응답에 쓴 뒤 보관하지 않는다 */
	public String issue(AuthUser user) {
		var bytes = new byte[TOKEN_BYTES];
		random.nextBytes(bytes);
		var token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
		store.save(hash(token), user.id(), ttl);
		return token;
	}

	/**
	 * 토큰을 한 번 소비하고, 회원이 ACTIVE면 새 토큰을 발급한다. 소비는 회원 상태와 관계없이 일어난다.
	 * 형식이 틀린 값은 저장소를 조회하지 않는다.
	 */
	public Rotation rotate(String presentedToken) {
		if (!isWellFormed(presentedToken)) {
			return new Rotation(Rotation.Outcome.MALFORMED, null, null);
		}
		var userId = store.consume(hash(presentedToken));
		if (userId.isEmpty()) {
			return new Rotation(Rotation.Outcome.UNKNOWN, null, null);
		}
		var user = authentication.findActive(userId.get());
		if (user.isEmpty()) {
			return new Rotation(Rotation.Outcome.INACTIVE, null, null);
		}
		return new Rotation(Rotation.Outcome.ROTATED, user.get(), issue(user.get()));
	}

	/** 로그아웃. 없거나 형식이 틀린 토큰도 조용히 넘어간다(멱등). */
	public void revoke(String presentedToken) {
		if (isWellFormed(presentedToken)) {
			store.consume(hash(presentedToken));
		}
	}

	/** 회원의 refresh 토큰을 모두 폐기한다. 탈퇴 작업이 {@code users} 잠금 뒤 호출한다. */
	public int revokeAllOf(long userId) {
		return store.revokeAll(userId);
	}

	public static boolean isWellFormed(String token) {
		return token != null && FORMAT.matcher(token).matches();
	}

	static String hash(String token) {
		try {
			var digest = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.US_ASCII));
			return HexFormat.of().formatHex(digest);
		}
		catch (NoSuchAlgorithmException ex) {
			throw new IllegalStateException("SHA-256을 쓸 수 없습니다.", ex);
		}
	}

	/**
	 * 재발급 결과. 쿠키 처리(설계 U4)가 결과마다 달라 사유를 구분한다.
	 *
	 * @param user ROTATED일 때만 값이 있다
	 * @param newToken ROTATED일 때만 값이 있다
	 */
	public record Rotation(Outcome outcome, AuthUser user, String newToken) {

		public enum Outcome {
			/** 소비하고 새 토큰을 발급했다 */
			ROTATED,
			/** 형식이 틀렸다. 저장소를 보지 않았다 */
			MALFORMED,
			/** 저장소에 없다(만료·이미 회전·로그아웃). 동시 재발급에서 진 요청도 여기 온다 */
			UNKNOWN,
			/** 소비했지만 회원이 없거나 ACTIVE가 아니다 */
			INACTIVE
		}

	}

}
