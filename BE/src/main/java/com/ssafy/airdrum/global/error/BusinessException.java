package com.ssafy.airdrum.global.error;

/**
 * 서비스·컨트롤러가 던지는 유일한 비즈니스 예외. 코드가 상태·제목을 정하고 detail은 선택이다.
 *
 * <p>상속해서 세분화하지 않는다(코드가 이미 구분한다). 원인 예외를 받는 생성자도 두지 않는다 —
 * 원인이 있는 실패는 대부분 500이어야 하므로 감싸지 말고 그대로 전파한다.
 */
public class BusinessException extends RuntimeException {

	private final ErrorCode errorCode;
	private final String detail;

	public BusinessException(ErrorCode errorCode) {
		this(errorCode, null);
	}

	public BusinessException(ErrorCode errorCode, String detail) {
		super((detail == null || detail.isBlank()) ? errorCode.title() : detail);
		this.errorCode = errorCode;
		this.detail = getMessage();
	}

	public ErrorCode getErrorCode() {
		return errorCode;
	}

	/** 응답 {@code detail}에 그대로 나가는 한국어 문장. */
	public String getDetail() {
		return detail;
	}

}
