package com.ssafy.airdrum.chart.worker;

import com.ssafy.airdrum.common.error.ErrorCode;
import org.springframework.http.HttpStatus;

/** 연주 중 LLM 구간 코칭 사용자 API의 오류. 워커 API는 {@link WorkerError}를 쓴다. */
enum LiveCoachError implements ErrorCode {
    INVALID(HttpStatus.BAD_REQUEST, "구간 코칭 요청이 올바르지 않습니다."),
    TOO_MANY(HttpStatus.TOO_MANY_REQUESTS, "구간 코칭 요청이 너무 많습니다."),
    NOT_FOUND(HttpStatus.NOT_FOUND, "구간 코칭 요청을 찾을 수 없습니다."),
    GONE(HttpStatus.GONE, "구간 코칭 결과가 없거나 만료됐습니다.");
    private final HttpStatus status;
    private final String title;
    LiveCoachError(HttpStatus status, String title) { this.status = status; this.title = title; }
    public String code() { return "LIVE_COACH_" + name(); }
    public HttpStatus status() { return status; }
    public String title() { return title; }
}
