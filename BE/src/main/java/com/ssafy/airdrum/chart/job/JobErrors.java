package com.ssafy.airdrum.chart.job;

/** 워커의 내부 메시지를 반환하지 않는 고정 공개 오류 매핑. */
public final class JobErrors {
    private JobErrors() {}
    public static JobSnapshot.JobError safe(String code) {
        if (code == null) return new JobSnapshot.JobError("JOB_FAILED","작업을 완료할 수 없습니다.");
        return switch (code) {
            case "INPUT_INVALID" -> new JobSnapshot.JobError(code,"입력 파일을 처리할 수 없습니다.");
            case "OUTPUT_INVALID" -> new JobSnapshot.JobError(code,"채보 결과를 처리할 수 없습니다.");
            case "MODEL_FAILED" -> new JobSnapshot.JobError(code,"채보 생성에 실패했습니다.");
            case "JOB_CANCELLED" -> new JobSnapshot.JobError(code,"작업이 취소되었습니다.");
            default -> new JobSnapshot.JobError("JOB_FAILED","작업을 완료할 수 없습니다.");
        };
    }
}
