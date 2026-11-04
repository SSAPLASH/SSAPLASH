package com.ssafy.airdrum.user;

import org.springframework.http.HttpStatus;

import com.ssafy.airdrum.common.error.ErrorCode;

/** 회원 도메인 오류 코드. */
public enum UserErrorCode implements ErrorCode {

	/** 가입 동의(이용약관·개인정보)를 마치지 않은 USER가 허용 목록 밖 API를 불렀다(가입 동의 설계 3-4). */
	SIGNUP_INCOMPLETE(HttpStatus.FORBIDDEN, "가입 미완료"),

	/** 가입 동의로 보낸 약관·개인정보·데이터 활용 안내의 판이 서버에 설정된 허용 판 목록에 없다({@link SignupConsentVersions}). */
	SIGNUP_CONSENT_VERSION_INVALID(HttpStatus.UNPROCESSABLE_ENTITY, "허용되지 않은 동의 판");

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
