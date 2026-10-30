package com.ssafy.airdrum.report;

import org.springframework.http.HttpStatus;
import com.ssafy.airdrum.common.error.ErrorCode;

public enum ReportErrorCode implements ErrorCode {
    REPORT_NOT_FOUND;
    public String code() { return name(); }
    public HttpStatus status() { return HttpStatus.NOT_FOUND; }
    public String title() { return "이 플레이의 리포트가 없습니다."; }
}
