package com.ssafy.airdrum.global.worker;

import jakarta.servlet.http.HttpServletRequest;

/** 내부 워커 인증에서 확인한 워커 ID를 읽는다. */
public final class WorkerIdentity {
    // 기존 요청 속성 이름을 유지한다.
    static final String ATTRIBUTE = "com.ssafy.airdrum.chart.worker.WorkerSecurityConfiguration.worker";

    private WorkerIdentity() {}

    public static String id(HttpServletRequest request) {
        return (String) request.getAttribute(ATTRIBUTE);
    }
}
