package com.ssafy.airdrum.global.worker;

import com.ssafy.airdrum.global.error.ErrorCode;
import org.springframework.http.HttpStatus;

public enum WorkerError implements ErrorCode {
    INVALID(HttpStatus.BAD_REQUEST, "워커 요청이 올바르지 않습니다."),
    CONFLICT(HttpStatus.CONFLICT, "유효한 작업 시도가 아닙니다."),
    RESULT_INVALID(HttpStatus.UNPROCESSABLE_ENTITY, "작업 결과가 올바르지 않습니다."),
    UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "작업 저장소를 사용할 수 없습니다.");
    private final HttpStatus status;
    private final String title;
    WorkerError(HttpStatus status, String title) { this.status = status; this.title = title; }
    public String code() { return "WORKER_" + name(); }
    public HttpStatus status() { return status; }
    public String title() { return title; }
}
