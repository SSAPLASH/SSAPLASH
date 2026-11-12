package com.ssafy.airdrum.domain.auth.security;

import java.io.IOException;
import java.util.Set;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpMethod;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import com.ssafy.airdrum.global.error.ErrorResponseWriter;
import com.ssafy.airdrum.domain.user.model.AuthUser;
import com.ssafy.airdrum.domain.user.exception.UserErrorCode;
import com.ssafy.airdrum.domain.user.model.UserRole;

/**
 * 가입 동의를 마치지 않은 회원의 API 접근 제한(가입 동의 설계 3-4·4-2).
 *
 * <p>{@link AccessTokenAuthenticationFilter} 바로 뒤에서, 인증된 {@code USER}가 가입 미완료({@link AuthUser#signupCompleted()}
 * false)이면 허용 목록 밖 요청을 403 {@code SIGNUP_INCOMPLETE}로 끝낸다. 인증되지 않은 요청은 그대로 넘겨 기존처럼 인가 단계가
 * 401을 쓰게 하고, {@code ADMIN}은 면제한다(U5). 공개 경로 판단은 {@link SecurityConfig}가 한다.
 *
 * <p>빈으로 등록하지 않는다(서블릿 필터로 한 번 더 등록되지 않도록 {@link SecurityConfig}가 직접 만든다).
 */
class SignupGateFilter extends OncePerRequestFilter {

	private static final Logger log = LoggerFactory.getLogger(SignupGateFilter.class);

	static final String DETAIL = "가입 동의가 필요합니다.";

	/** 가입 전에도 부를 수 있는 요청(메서드 + 경로 정확히 일치). {@code OPTIONS}는 경로와 무관하게 허용한다. */
	private static final Set<String> ALLOWED = Set.of(
			"GET /api/users/me",
			"POST /api/users/me/signup-consent",
			"DELETE /api/users/me",
			"POST /api/auth/refresh",
			"POST /api/auth/logout");

	private final ErrorResponseWriter writer;

	SignupGateFilter(ErrorResponseWriter writer) {
		this.writer = writer;
	}

	@Override
	protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
			throws ServletException, IOException {
		if (isPendingUser() && !isAllowed(request)) {
			var code = UserErrorCode.SIGNUP_INCOMPLETE;
			log.warn("{} {} -> {} {}: {}", request.getMethod(), request.getRequestURI(), code.status().value(),
					code.code(), DETAIL);
			writer.write(response, code, DETAIL, request.getRequestURI());
			return;
		}
		chain.doFilter(request, response);
	}

	/** 인증된 USER이고 가입을 마치지 않았는지. 인증 실패·미인증 요청은 여기서 판단하지 않는다. */
	private static boolean isPendingUser() {
		var authentication = SecurityContextHolder.getContext().getAuthentication();
		if (!(authentication instanceof AuthUserAuthentication authUser)) {
			return false;
		}
		var user = authUser.getPrincipal();
		return user.role() != UserRole.ADMIN && !user.signupCompleted();
	}

	private static boolean isAllowed(HttpServletRequest request) {
		if (HttpMethod.OPTIONS.matches(request.getMethod())) {
			return true;
		}
		var path = request.getRequestURI().substring(request.getContextPath().length());
		return ALLOWED.contains(request.getMethod() + " " + path);
	}

}
