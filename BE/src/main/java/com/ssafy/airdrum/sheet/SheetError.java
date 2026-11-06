package com.ssafy.airdrum.sheet;

import org.springframework.http.HttpStatus;

import com.ssafy.airdrum.common.error.ErrorCode;

/** 내 악보 보관 오류(155번 설계 3절). */
public enum SheetError implements ErrorCode {
	SHEET_INVALID(HttpStatus.BAD_REQUEST, "악보 요청을 확인하세요."),
	SHEET_TOO_LARGE(HttpStatus.PAYLOAD_TOO_LARGE, "악보 파일이 너무 큽니다."),
	SHEET_QUOTA_EXCEEDED(HttpStatus.PAYLOAD_TOO_LARGE, "보관할 수 있는 악보 수나 용량을 넘었습니다."),
	SHEET_UNSUPPORTED(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "악보는 JPG·PNG·WEBP 이미지나 PDF여야 합니다."),
	SHEET_NOT_FOUND(HttpStatus.NOT_FOUND, "악보를 찾을 수 없습니다."),
	/** 248: 그 곡에 살아 있는 악보가 이미 있다. 지우면 다시 올릴 수 있다. */
	SHEET_ALREADY_LINKED(HttpStatus.CONFLICT, "이 곡에는 이미 악보가 있습니다."),
	SHEET_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "악보 저장소를 사용할 수 없습니다.");

	private final HttpStatus status;
	private final String title;

	SheetError(HttpStatus status, String title) {
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
