package com.ssafy.airdrum.domain.auth.security;

import java.io.IOException;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.stereotype.Component;

import com.ssafy.airdrum.domain.auth.exception.AccessTokenException.Reason;
import com.ssafy.airdrum.global.error.CommonErrorCode;
import com.ssafy.airdrum.global.error.ErrorCode;
import com.ssafy.airdrum.global.error.ErrorResponseWriter;

/**
 * Security가 막은 요청의 401·403 응답(설계 문서(88) 3-6). 형식은 전역 핸들러와 같은 problem+json이고
 * 코드는 {@code UNAUTHORIZED}·{@code FORBIDDEN} 하나씩이며 사유는 {@code detail}로만 구분한다.
 * 로그는 WARN 한 줄이고 토큰 값은 남기지 않는다.
 */
@Component
class SecurityProblemHandlers implements AuthenticationEntryPoint, AccessDeniedHandler {

	private static final Logger log = LoggerFactory.getLogger(SecurityProblemHandlers.class);

	static final String LOGIN_REQUIRED = "로그인이 필요합니다.";
	static final String TOKEN_EXPIRED = "액세스 토큰이 만료되었습니다.";
	static final String TOKEN_INVALID = "액세스 토큰이 올바르지 않습니다.";
	static final String USER_NOT_ACTIVE = "사용할 수 없는 계정입니다.";
	static final String FORBIDDEN = "권한이 없습니다.";

	private final ErrorResponseWriter writer;

	SecurityProblemHandlers(ErrorResponseWriter writer) {
		this.writer = writer;
	}

	@Override
	public void commence(HttpServletRequest request, HttpServletResponse response, AuthenticationException ex)
			throws IOException {
		response.setHeader(HttpHeaders.WWW_AUTHENTICATE, "Bearer");
		write(request, response, CommonErrorCode.UNAUTHORIZED,
				unauthorizedDetail((Reason) request.getAttribute(AccessTokenAuthenticationFilter.FAILURE_ATTRIBUTE)));
	}

	@Override
	public void handle(HttpServletRequest request, HttpServletResponse response, AccessDeniedException ex)
			throws IOException {
		write(request, response, CommonErrorCode.FORBIDDEN, FORBIDDEN);
	}

	static String unauthorizedDetail(Reason reason) {
		if (reason == null) {
			return LOGIN_REQUIRED;
		}
		return switch (reason) {
			case EXPIRED -> TOKEN_EXPIRED;
			case USER_NOT_ACTIVE -> USER_NOT_ACTIVE;
			case MALFORMED, INVALID_SIGNATURE -> TOKEN_INVALID;
		};
	}

	private void write(HttpServletRequest request, HttpServletResponse response, ErrorCode code, String detail)
			throws IOException {
		var reason = request.getAttribute(AccessTokenAuthenticationFilter.FAILURE_ATTRIBUTE);
		log.warn("{} {} -> {} {}: {}{}", request.getMethod(), request.getRequestURI(), code.status().value(),
				code.code(), detail, reason == null ? "" : " (reason=" + reason + ")");
		writer.write(response, code, detail, request.getRequestURI());
	}

}
