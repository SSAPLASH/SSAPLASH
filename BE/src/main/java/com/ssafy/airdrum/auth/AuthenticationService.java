package com.ssafy.airdrum.auth;

import java.util.Optional;

import org.springframework.stereotype.Service;

import com.ssafy.airdrum.auth.AccessTokenException.Reason;
import com.ssafy.airdrum.user.AuthUser;
import com.ssafy.airdrum.user.UserRepository;

/**
 * 토큰 검증과 회원 확인의 공개 진입점(설계 문서(88) 3-7). 서블릿·Security 타입에 의존하지 않는다.
 *
 * <p>HTTP 필터, WS 첫 인증 메시지, WS 전송마다의 재확인이 모두 이 두 메서드를 쓴다. 다른 모듈은 로직을 복제하지 않는다.
 */
@Service
public class AuthenticationService {

	private final AccessTokenService tokens;
	private final UserRepository users;

	public AuthenticationService(AccessTokenService tokens, UserRepository users) {
		this.tokens = tokens;
		this.users = users;
	}

	/**
	 * 토큰을 검증하고 회원이 ACTIVE인지 DB에서 확인한다. 권한은 DB 값이다.
	 *
	 * @throws AccessTokenException 토큰이 유효하지 않거나 회원이 없거나 ACTIVE가 아닐 때
	 */
	public AuthenticatedUser authenticate(String accessToken) {
		var claims = tokens.verify(accessToken);
		var user = users.findActiveAuthUser(claims.userId())
				.orElseThrow(() -> new AccessTokenException(Reason.USER_NOT_ACTIVE));
		return new AuthenticatedUser(user, claims.expiresAt());
	}

	/** ACTIVE 회원이면 현재 권한과 함께 돌려준다. WS 전송마다 다시 확인할 때 쓴다. */
	public Optional<AuthUser> findActive(long userId) {
		return users.findActiveAuthUser(userId);
	}

}
