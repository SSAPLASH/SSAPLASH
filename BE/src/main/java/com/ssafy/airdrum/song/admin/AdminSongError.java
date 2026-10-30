package com.ssafy.airdrum.song.admin;

import org.springframework.http.HttpStatus;

import com.ssafy.airdrum.common.error.ErrorCode;

/** 공용 곡 반주 오류(156번 설계 3-3절). 곡·MIDI·커버 오류는 기존 코드를 쓴다. */
public enum AdminSongError implements ErrorCode {
	ACCOMPANIMENT_INVALID(HttpStatus.BAD_REQUEST, "반주 파일을 확인하세요."),
	ACCOMPANIMENT_UNSUPPORTED(HttpStatus.UNPROCESSABLE_ENTITY, "반주는 10분 이하의 WAV·MP3여야 합니다."),
	ACCOMPANIMENT_TOO_LARGE(HttpStatus.PAYLOAD_TOO_LARGE, "반주 파일이 너무 큽니다."),
	ACCOMPANIMENT_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "반주 저장소를 사용할 수 없습니다.");

	private final HttpStatus status;
	private final String title;

	AdminSongError(HttpStatus status, String title) {
		this.status = status;
		this.title = title;
	}

	public String code() {
		return name();
	}

	public HttpStatus status() {
		return status;
	}

	public String title() {
		return title;
	}

}
