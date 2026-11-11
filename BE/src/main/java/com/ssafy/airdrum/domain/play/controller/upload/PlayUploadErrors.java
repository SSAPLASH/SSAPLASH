package com.ssafy.airdrum.domain.play.controller.upload;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.annotation.Order;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.dao.DataAccessException;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import com.ssafy.airdrum.global.error.ApiErrorResponse;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.global.error.CommonErrorCode;
import com.ssafy.airdrum.domain.play.exception.PlayErrorCode;

@RestControllerAdvice(assignableTypes=PlayUploadController.class)
@Order(-10)
public class PlayUploadErrors {
	@ExceptionHandler(BusinessException.class)
	ResponseEntity<ApiErrorResponse> business(BusinessException ex,HttpServletRequest request) {
		var body=ApiErrorResponse.of(ex.getErrorCode(),ex.getDetail(),request.getRequestURI());
		var response=ResponseEntity.status(body.status()).contentType(MediaType.APPLICATION_PROBLEM_JSON);
		if(body.status()==503) response.header("Retry-After","5");
		return response.body(body);
	}
	@ExceptionHandler({QueryTimeoutException.class,PessimisticLockingFailureException.class})
	ResponseEntity<ApiErrorResponse> busy(Exception ex,HttpServletRequest request) { return business(new BusinessException(PlayErrorCode.PLAY_UPLOAD_BUSY),request); }
	@ExceptionHandler(DataAccessException.class)
	ResponseEntity<ApiErrorResponse> database(DataAccessException ex,HttpServletRequest request) {
		// PG 제약 오류에는 실패 행의 센서 값이 포함될 수 있어 원인 메시지·스택을 출력하지 않는다.
		org.slf4j.LoggerFactory.getLogger(PlayUploadErrors.class).error("플레이 로그 DB 처리 실패: {}",ex.getClass().getSimpleName());
		return business(new BusinessException(CommonErrorCode.INTERNAL_ERROR),request);
	}
}
