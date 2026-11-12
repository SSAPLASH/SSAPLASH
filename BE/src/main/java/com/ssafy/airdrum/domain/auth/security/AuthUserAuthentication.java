package com.ssafy.airdrum.domain.auth.security;

import java.util.List;

import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;

import com.ssafy.airdrum.domain.user.model.AuthUser;

/** Security 컨텍스트에 두는 인증 결과. principal은 {@link AuthUser}, 권한은 {@code ROLE_USER}·{@code ROLE_ADMIN}. */
public class AuthUserAuthentication extends AbstractAuthenticationToken {

	private final AuthUser user;

	public AuthUserAuthentication(AuthUser user) {
		super(List.of(new SimpleGrantedAuthority("ROLE_" + user.role().name())));
		this.user = user;
		setAuthenticated(true);
	}

	@Override
	public AuthUser getPrincipal() {
		return user;
	}

	/** 토큰 원문을 컨텍스트에 남기지 않는다. */
	@Override
	public Object getCredentials() {
		return null;
	}

}
