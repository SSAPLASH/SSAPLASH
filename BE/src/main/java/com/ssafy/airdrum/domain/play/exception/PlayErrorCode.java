package com.ssafy.airdrum.domain.play.exception;

import org.springframework.http.HttpStatus;
import com.ssafy.airdrum.global.error.ErrorCode;

public enum PlayErrorCode implements ErrorCode {
	PLAY_PAYLOAD_INVALID(HttpStatus.BAD_REQUEST, "플레이 로그 형식이 올바르지 않습니다."),
	PLAY_NOT_FOUND(HttpStatus.NOT_FOUND, "접근할 수 있는 플레이 또는 참조가 없습니다."),
	PLAY_PAYLOAD_CONFLICT(HttpStatus.CONFLICT, "같은 플레이 ID에 다른 요약이 저장되어 있습니다."),
	PLAY_RAW_PAYLOAD_CONFLICT(HttpStatus.CONFLICT, "같은 플레이에 다른 원본이 저장되어 있습니다."),
	PLAY_SCHEMA_UNSUPPORTED(HttpStatus.CONFLICT, "지원하지 않는 로그 또는 판정 버전입니다."),
	PLAY_STATE_CHANGED(HttpStatus.CONFLICT, "저장 중 상태가 바뀌었습니다. 같은 요청을 재시도하세요."),
	PLAY_RAW_LENGTH_REQUIRED(HttpStatus.LENGTH_REQUIRED, "플레이 원본 요청 크기를 확인할 수 없습니다."),
	PLAY_UPLOAD_TOO_LARGE(HttpStatus.PAYLOAD_TOO_LARGE, "플레이 로그의 허용 크기를 초과했습니다."),
	PLAY_UPLOAD_BUSY(HttpStatus.SERVICE_UNAVAILABLE, "처리 중인 업로드가 많습니다. 잠시 후 재시도하세요."),
	PLAY_RAW_STORAGE_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "원본 저장소를 사용할 수 없습니다.");
	private final HttpStatus status;
	private final String title;
	PlayErrorCode(HttpStatus status, String title) { this.status = status; this.title = title; }
	public String code() { return name(); }
	public HttpStatus status() { return status; }
	public String title() { return title; }
}
