package com.ssafy.airdrum.global.error;

import java.io.IOException;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 요청 파라미터에 NUL 문자({@code \u0000}, URL에서는 {@code %00})가 있으면 컨트롤러·DB까지 가기 전에 400으로 거절한다.
 *
 * <p>PostgreSQL의 텍스트 컬럼은 NUL 바이트를 담지 못해, 검증 없이 쿼리까지 넘기면 {@code PSQLException}이
 * 처리되지 않은 채 500으로 나간다. ZAP 공격 스캔과 수동 재현({@code GET /api/v1/sheets?q=a%00b})에서 확인했다
 * (SECURITY.md 16절).
 *
 * <p>multipart 요청은 여기서 파라미터를 읽지 않는다. 이 시점은 Spring의 multipart 파싱(컨트롤러의
 * {@code @RequestPart} 처리) 이전이라, 여기서 먼저 {@link HttpServletRequest#getParameterMap()}을 부르면
 * 본문을 앞서 소모해 이후 파싱이 깨질 수 있다.
 */
@Component
@Order(-95)
public class NulParameterFilter extends OncePerRequestFilter {

	private final ErrorResponseWriter errors;

	public NulParameterFilter(ErrorResponseWriter errors) {
		this.errors = errors;
	}

	@Override
	protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
			throws ServletException, IOException {
		var contentType = request.getContentType();
		if (contentType != null && contentType.toLowerCase().startsWith(MediaType.MULTIPART_FORM_DATA_VALUE)) {
			chain.doFilter(request, response);
			return;
		}
		for (var values : request.getParameterMap().values()) {
			for (var value : values) {
				if (value.indexOf('\u0000') >= 0) {
					errors.write(response, CommonErrorCode.INVALID_INPUT, "요청 파라미터에 NUL 문자를 포함할 수 없습니다.",
							request.getRequestURI());
					return;
				}
			}
		}
		chain.doFilter(request, response);
	}

}
