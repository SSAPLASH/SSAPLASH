package com.ssafy.airdrum.domain.telemetry.exception;

import jakarta.servlet.http.HttpServletRequest;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DataAccessException;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import com.ssafy.airdrum.domain.telemetry.controller.TelemetryController;
import com.ssafy.airdrum.global.error.ApiErrorResponse;
import com.ssafy.airdrum.global.error.CommonErrorCode;

/** DB 오류만 맡는다. 그 외 예외는 공통 핸들러가 처리한다. */
@RestControllerAdvice(assignableTypes = TelemetryController.class)
@Order(-10)
public class TelemetryErrors {

	private static final Logger log = LoggerFactory.getLogger(TelemetryErrors.class);

	@ExceptionHandler(DataAccessException.class)
	ResponseEntity<ApiErrorResponse> database(DataAccessException ex, HttpServletRequest request) {
		// PG 제약 오류 메시지에는 실패 행 전체가 들어가므로 원인 메시지·스택을 출력하지 않는다.
		log.error("텔레메트리 DB 처리 실패: {}", ex.getClass().getSimpleName());
		var body = ApiErrorResponse.of(CommonErrorCode.INTERNAL_ERROR, null, request.getRequestURI());
		return ResponseEntity.status(body.status()).contentType(MediaType.APPLICATION_PROBLEM_JSON).body(body);
	}

}
