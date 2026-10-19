package com.ssafy.airdrum.common.error;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonInclude;
import org.springframework.http.HttpStatusCode;

/**
 * 모든 오류 응답의 본문. RFC 9457 Problem Details 필드에 {@code code}·{@code errors}를 확장했다.
 * 미디어 타입은 {@code application/problem+json}.
 *
 * <p>전역 핸들러와 필터용 작성기 모두 {@link #of} 팩터리로만 만든다. 이름은 Spring의
 * {@code org.springframework.web.ErrorResponse}와 겹치지 않도록 {@code Api} 접두사를 붙였다.
 *
 * @param type     고정 {@value #TYPE_ABOUT_BLANK}. 오류 문서 사이트가 생기면 코드별 URL로 바꾼다
 * @param title    오류 코드의 한국어 제목
 * @param status   HTTP 상태 코드와 같은 값
 * @param detail   사람이 읽는 한국어 설명. 비어 있으면 제목으로 채운다
 * @param instance 요청 경로(쿼리 문자열 제외)
 * @param code     기계 판별용 코드(UPPER_SNAKE)
 * @param errors   검증 실패 목록. 없으면 JSON에 키 자체를 내지 않는다
 */
public record ApiErrorResponse(
		String type,
		String title,
		int status,
		String detail,
		String instance,
		String code,
		@JsonInclude(JsonInclude.Include.NON_NULL) List<FieldErrorDetail> errors) {

	public static final String TYPE_ABOUT_BLANK = "about:blank";

	public static ApiErrorResponse of(ErrorCode errorCode, String detail, String instance) {
		return of(errorCode, detail, instance, null);
	}

	public static ApiErrorResponse of(ErrorCode errorCode, String detail, String instance, List<FieldErrorDetail> errors) {
		return of(errorCode, errorCode.status(), detail, instance, errors);
	}

	/**
	 * 프레임워크가 정한 상태 코드를 그대로 유지해야 할 때(설계 3-7: 분류되지 않은 4xx·5xx) 쓴다.
	 * {@code status} 필드는 항상 실제 HTTP 상태와 같아야 하므로 코드의 기본 상태 대신 이 값을 쓴다.
	 */
	public static ApiErrorResponse of(ErrorCode errorCode, HttpStatusCode status, String detail, String instance,
			List<FieldErrorDetail> errors) {
		String resolvedDetail = (detail == null || detail.isBlank()) ? errorCode.title() : detail;
		List<FieldErrorDetail> resolvedErrors = (errors == null || errors.isEmpty()) ? null : List.copyOf(errors);
		return new ApiErrorResponse(
				TYPE_ABOUT_BLANK,
				errorCode.title(),
				status.value(),
				resolvedDetail,
				instance,
				errorCode.code(),
				resolvedErrors);
	}

}
