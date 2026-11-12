package com.ssafy.airdrum.domain.song.exception;

import com.ssafy.airdrum.global.error.ErrorCode;

import org.springframework.http.HttpStatus;

public enum AudioErrorCode implements ErrorCode {
    INVALID(HttpStatus.BAD_REQUEST, "음원 요청이 올바르지 않습니다."),
    UNSUPPORTED(HttpStatus.UNPROCESSABLE_ENTITY, "음원 형식 또는 길이가 올바르지 않습니다."),
    TOO_LARGE(HttpStatus.PAYLOAD_TOO_LARGE, "음원 파일의 허용 크기를 초과했습니다."),
    CONFLICT(HttpStatus.CONFLICT, "같은 요청 키에 다른 내용이 저장되어 있습니다."),
    BUSY(HttpStatus.TOO_MANY_REQUESTS, "진행 중인 음원 작업이 있습니다."),
    NOT_FOUND(HttpStatus.NOT_FOUND, "접근할 수 있는 곡이 없습니다."),
    UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "음원 처리 서비스를 사용할 수 없습니다.");
    private final HttpStatus status;
    private final String title;

    AudioErrorCode(HttpStatus status, String title) {
        this.status = status;
        this.title = title;
    }

    public String code() {
        return "AUDIO_" + name();
    }

    public HttpStatus status() {
        return status;
    }

    public String title() {
        return title;
    }
}
