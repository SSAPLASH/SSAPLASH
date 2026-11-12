package com.ssafy.airdrum.domain.auth.security;

import java.util.Optional;

import org.springframework.security.core.context.SecurityContextHolder;

import com.ssafy.airdrum.domain.user.model.AuthUser;

/**
 * 현재 요청의 인증된 회원. 컨트롤러는 인자 {@link AuthUser}로 받으면 되고, 이 클래스는 컨트롤러 밖
 * (인터셉터·다른 모듈의 연결 어댑터)에서 꺼낼 때 쓴다. 토큰이 없거나 무효인 요청이면 빈 값이다.
 */
public final class CurrentAuthUser {

	private CurrentAuthUser() {
	}

	public static Optional<AuthUser> find() {
		var authentication = SecurityContextHolder.getContext().getAuthentication();
		if (authentication instanceof AuthUserAuthentication auth) {
			return Optional.of(auth.getPrincipal());
		}
		return Optional.empty();
	}

}
