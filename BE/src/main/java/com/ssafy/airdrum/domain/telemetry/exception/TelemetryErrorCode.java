package com.ssafy.airdrum.domain.telemetry.exception;

import org.springframework.http.HttpStatus;

import com.ssafy.airdrum.global.error.ErrorCode;

public enum TelemetryErrorCode implements ErrorCode {

	/** 외피·이벤트 의미 규칙 위반. detail에 {@code events[i].필드} 위치를 담고 값은 넣지 않는다. */
	TELEMETRY_EVENT_INVALID(HttpStatus.BAD_REQUEST, "텔레메트리 이벤트 형식이 올바르지 않습니다."),
	TELEMETRY_SCHEMA_UNSUPPORTED(HttpStatus.BAD_REQUEST, "지원하지 않는 텔레메트리 스키마 버전입니다."),
	/** 본문 128 KiB 또는 이벤트 100건 초과. */
	TELEMETRY_BATCH_TOO_LARGE(HttpStatus.PAYLOAD_TOO_LARGE, "텔레메트리 배치의 허용 크기를 초과했습니다.");

	private final HttpStatus status;
	private final String title;

	TelemetryErrorCode(HttpStatus status, String title) {
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
