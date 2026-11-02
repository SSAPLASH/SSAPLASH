package com.ssafy.airdrum.user;

import org.springframework.http.HttpStatus;

import com.ssafy.airdrum.common.error.ErrorCode;

/** 회원 도메인 오류 코드. */
public enum UserErrorCode implements ErrorCode {

	/** 가입 동의(이용약관·개인정보)를 마치지 않은 USER가 허용 목록 밖 API를 불렀다(가입 동의 설계 3-4). */
	SIGNUP_INCOMPLETE(HttpStatus.FORBIDDEN, "가입 미완료");

	private final HttpStatus status;
	private final String title;

	UserErrorCode(HttpStatus status, String title) {
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
