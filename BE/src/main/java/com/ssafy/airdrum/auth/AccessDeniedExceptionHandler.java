package com.ssafy.airdrum.auth;

import jakarta.servlet.http.HttpServletRequest;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import com.ssafy.airdrum.common.error.ApiErrorResponse;
import com.ssafy.airdrum.common.error.CommonErrorCode;

/**
 * {@code @PreAuthorize} 거부를 403으로 바꾼다. 메서드 보안 예외는 컨트롤러 안에서 나므로 Security의 접근 거부 핸들러가
 * 아니라 MVC 예외 처리로 온다. 전역 핸들러의 {@code Exception} 처리(500)보다 먼저 잡도록 우선순위를 높인다.
 */
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
class AccessDeniedExceptionHandler {

	private static final Logger log = LoggerFactory.getLogger(AccessDeniedExceptionHandler.class);

	@ExceptionHandler(AccessDeniedException.class)
	ResponseEntity<ApiErrorResponse> handle(HttpServletRequest request) {
		var code = CommonErrorCode.FORBIDDEN;
		var body = ApiErrorResponse.of(code, SecurityProblemHandlers.FORBIDDEN, request.getRequestURI());
		log.warn("{} {} -> {} {}: {}", request.getMethod(), request.getRequestURI(), body.status(), body.code(),
				body.detail());
		return ResponseEntity.status(code.status()).contentType(MediaType.APPLICATION_PROBLEM_JSON).body(body);
	}

}
