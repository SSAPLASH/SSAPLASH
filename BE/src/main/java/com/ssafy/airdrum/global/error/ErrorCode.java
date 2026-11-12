package com.ssafy.airdrum.global.error;

import org.springframework.http.HttpStatus;

/**
 * 오류 코드 계약. 구현은 enum만 한다.
 *
 * <p>공통 코드는 {@link CommonErrorCode}, 도메인 코드는 각 도메인 패키지의 {@code {Domain}ErrorCode}가 맡는다.
 * 코드 문자열은 UPPER_SNAKE이며 도메인 코드는 {@code {도메인}_{상황}} 형식(예: USER_NOT_FOUND)을 쓴다.
 * 같은 코드 문자열을 두 enum이 쓰지 않는다.
 */
public interface ErrorCode {

	/** 기계 판별용 코드. 응답의 {@code code} 필드. */
	String code();

	/** 응답 HTTP 상태. */
	HttpStatus status();

	/** 사람이 읽는 한국어 제목. 응답의 {@code title} 필드이며 detail이 없을 때 대신 쓴다. */
	String title();

}
