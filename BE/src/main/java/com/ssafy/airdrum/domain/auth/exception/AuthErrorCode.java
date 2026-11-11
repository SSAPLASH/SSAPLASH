package com.ssafy.airdrum.domain.auth.exception;

import org.springframework.http.HttpStatus;

import com.ssafy.airdrum.global.error.ErrorCode;

/** 인증 도메인 오류 코드. 콜백의 로그인 실패는 오류 응답이 아니라 리다이렉트라 여기에 없다. */
public enum AuthErrorCode implements ErrorCode {

	/** 없는 제공자이거나 client-id·secret이 설정되지 않은 제공자 */
	AUTH_PROVIDER_NOT_SUPPORTED(HttpStatus.NOT_FOUND, "지원하지 않는 로그인 제공자");

	private final HttpStatus status;
	private final String title;

	AuthErrorCode(HttpStatus status, String title) {
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

}
