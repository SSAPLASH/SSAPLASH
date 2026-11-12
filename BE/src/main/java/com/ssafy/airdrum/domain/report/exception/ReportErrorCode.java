package com.ssafy.airdrum.domain.report.exception;

import org.springframework.http.HttpStatus;
import com.ssafy.airdrum.global.error.ErrorCode;

public enum ReportErrorCode implements ErrorCode {
    REPORT_NOT_FOUND("이 플레이의 리포트가 없습니다."),
    PLAY_NOT_FOUND("접근할 수 있는 플레이 또는 참조가 없습니다.");
    private final String title;
    ReportErrorCode(String title) { this.title = title; }
    public String code() { return name(); }
    public HttpStatus status() { return HttpStatus.NOT_FOUND; }
    public String title() { return title; }
}
