package com.ssafy.airdrum.auth;

import java.io.IOException;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.HttpHeaders;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import com.ssafy.airdrum.auth.AccessTokenException.Reason;

/**
 * {@code Authorization: Bearer} 헤더로 인증한다(설계 문서(88) 4-C).
 *
 * <p>실패해도 여기서 응답하지 않는다. 사유만 요청 속성에 남기고 다음으로 넘기면, 공개 경로는 그대로 통과하고 보호 경로는
 * 인가 단계에서 {@link SecurityProblemHandlers}가 사유별 401을 쓴다. 빈으로 등록하지 않는다(서블릿 필터로 한 번 더
 * 등록되지 않도록 {@link SecurityConfig}가 직접 만든다).
 */
class AccessTokenAuthenticationFilter extends OncePerRequestFilter {

	/** 인증 실패 사유({@link Reason})를 담는 요청 속성. */
	static final String FAILURE_ATTRIBUTE = AccessTokenAuthenticationFilter.class.getName() + ".failure";

	private static final String BEARER_PREFIX = "bearer ";

	private final AuthenticationService authentication;

	AccessTokenAuthenticationFilter(AuthenticationService authentication) {
		this.authentication = authentication;
	}

	@Override
	protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
			throws ServletException, IOException {
		var header = request.getHeader(HttpHeaders.AUTHORIZATION);
		if (header != null) {
			authenticate(header, request);
		}
		chain.doFilter(request, response);
	}

	private void authenticate(String header, HttpServletRequest request) {
		if (header.length() < BEARER_PREFIX.length()
				|| !header.regionMatches(true, 0, BEARER_PREFIX, 0, BEARER_PREFIX.length())) {
			fail(request, Reason.MALFORMED);
			return;
		}
		try {
			var result = authentication.authenticate(header.substring(BEARER_PREFIX.length()).strip());
			var context = SecurityContextHolder.createEmptyContext();
			context.setAuthentication(new AuthUserAuthentication(result.user()));
			SecurityContextHolder.setContext(context);
		}
		catch (AccessTokenException ex) {
			fail(request, ex.getReason());
		}
	}

	private static void fail(HttpServletRequest request, Reason reason) {
		SecurityContextHolder.clearContext();
		request.setAttribute(FAILURE_ATTRIBUTE, reason);
	}

}
