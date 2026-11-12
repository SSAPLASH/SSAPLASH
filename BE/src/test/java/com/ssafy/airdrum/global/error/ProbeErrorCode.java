package com.ssafy.airdrum.global.error;

import org.springframework.http.HttpStatus;

/** 도메인 패키지가 ErrorCode를 구현하는 방식의 예. 테스트 소스에만 있다. */
enum ProbeErrorCode implements ErrorCode {

	PROBE_NOT_FOUND(HttpStatus.NOT_FOUND, "프로브 없음");

	private final HttpStatus status;
	private final String title;

	ProbeErrorCode(HttpStatus status, String title) {
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
