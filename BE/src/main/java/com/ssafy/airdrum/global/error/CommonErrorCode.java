package com.ssafy.airdrum.global.error;

import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;

/**
 * 도메인에 속하지 않는 공통 오류 코드.
 * 도메인 자원이 없거나 충돌하는 경우는 여기 코드가 아니라 도메인 코드를 쓴다.
 */
public enum CommonErrorCode implements ErrorCode {

	/** 본문 파싱 실패, 필수 파라미터 누락, 타입 불일치, 그 외 분류되지 않은 4xx. */
	INVALID_INPUT(HttpStatus.BAD_REQUEST, "잘못된 요청"),
	/** {@code @Valid}·{@code @Validated} 실패. {@code errors}를 동반한다. */
	VALIDATION_FAILED(HttpStatus.BAD_REQUEST, "입력값 검증 실패"),
	UNAUTHORIZED(HttpStatus.UNAUTHORIZED, "인증 필요"),
	FORBIDDEN(HttpStatus.FORBIDDEN, "권한 없음"),
	/** 없는 경로. 도메인 자원이 없는 경우는 도메인 코드를 쓴다. */
	NOT_FOUND(HttpStatus.NOT_FOUND, "리소스 없음"),
	METHOD_NOT_ALLOWED(HttpStatus.METHOD_NOT_ALLOWED, "허용되지 않는 메서드"),
	NOT_ACCEPTABLE(HttpStatus.NOT_ACCEPTABLE, "표현할 수 없는 응답 형식"),
	CONFLICT(HttpStatus.CONFLICT, "충돌"),
	UNSUPPORTED_MEDIA_TYPE(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "지원하지 않는 요청 형식"),
	/** 처리되지 않은 예외, 분류되지 않은 5xx. */
	INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "서버 오류");

	private final HttpStatus status;
	private final String title;

	CommonErrorCode(HttpStatus status, String title) {
		this.status = status;
		this.title = title;
	}

	@Override
	public String code() {
		return name();
	}

	@Override
	public HttpStatus status() {
		return status;
	}

	@Override
	public String title() {
		return title;
	}

	/**
	 * 프레임워크가 상태 코드만 정해 준 경우(ProblemDetail 등)의 대응 코드.
	 * 분류되지 않은 4xx는 INVALID_INPUT, 그 외는 INTERNAL_ERROR로 본다. 상태 코드 자체는 호출 쪽이 유지한다.
	 */
	public static CommonErrorCode fromStatus(HttpStatusCode status) {
		return switch (status.value()) {
			case 400 -> INVALID_INPUT;
			case 401 -> UNAUTHORIZED;
			case 403 -> FORBIDDEN;
			case 404 -> NOT_FOUND;
			case 405 -> METHOD_NOT_ALLOWED;
			case 406 -> NOT_ACCEPTABLE;
			case 409 -> CONFLICT;
			case 415 -> UNSUPPORTED_MEDIA_TYPE;
			default -> status.is4xxClientError() ? INVALID_INPUT : INTERNAL_ERROR;
		};
	}

}
