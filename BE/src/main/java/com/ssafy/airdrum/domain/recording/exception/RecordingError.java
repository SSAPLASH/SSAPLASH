package com.ssafy.airdrum.domain.recording.exception;

import org.springframework.http.HttpStatus;

import com.ssafy.airdrum.global.error.ErrorCode;

/** 연주 녹음 오류(256번 설계 3-3절). */
public enum RecordingError implements ErrorCode {
	RECORDING_INVALID(HttpStatus.BAD_REQUEST, "녹음 요청을 확인하세요."),
	RECORDING_TOO_LARGE(HttpStatus.PAYLOAD_TOO_LARGE, "녹음이 너무 깁니다."),
	RECORDING_QUOTA_EXCEEDED(HttpStatus.PAYLOAD_TOO_LARGE, "보관할 수 있는 녹음 수를 넘었습니다."),
	RECORDING_SCHEMA_UNSUPPORTED(HttpStatus.CONFLICT, "지원하지 않는 녹음 형식 버전입니다."),
	RECORDING_CONFLICT(HttpStatus.CONFLICT, "같은 녹음 키에 다른 내용이 저장되어 있습니다."),
	RECORDING_PLAY_NOT_FOUND(HttpStatus.NOT_FOUND, "연결할 수 있는 플레이가 없습니다."),
	RECORDING_NOT_FOUND(HttpStatus.NOT_FOUND, "녹음을 찾을 수 없습니다."),
	RECORDING_BUSY(HttpStatus.SERVICE_UNAVAILABLE, "녹음 저장이 지연되고 있습니다. 같은 요청을 잠시 후 다시 보내세요.");

	private final HttpStatus status;
	private final String title;

	RecordingError(HttpStatus status, String title) {
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
