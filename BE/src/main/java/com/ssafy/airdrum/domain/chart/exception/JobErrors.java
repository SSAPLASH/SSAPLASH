package com.ssafy.airdrum.domain.chart.exception;


import com.ssafy.airdrum.domain.chart.dto.job.JobSnapshot;
/** 워커의 내부 메시지를 반환하지 않는 고정 공개 오류 매핑. */
public final class JobErrors {
    private JobErrors() {}
    public static JobSnapshot.JobError safe(String code, String reason) {
        if (code == null) return new JobSnapshot.JobError("JOB_FAILED","작업을 완료할 수 없습니다.",reason);
        return switch (code) {
            case "INPUT_INVALID" -> new JobSnapshot.JobError(code,"입력 파일을 처리할 수 없습니다.",reason);
            case "OUTPUT_INVALID" -> new JobSnapshot.JobError(code,"채보 결과를 처리할 수 없습니다.",reason);
            case "MODEL_FAILED" -> new JobSnapshot.JobError(code,"채보 생성에 실패했습니다.",reason);
            case "JOB_CANCELLED" -> new JobSnapshot.JobError(code,"작업이 취소되었습니다.",reason);
            case "WORKER_OFFLINE" -> new JobSnapshot.JobError(code,"채보 서버가 잠시 멈춰 있습니다. 잠시 뒤 다시 올려 주세요.",reason);
            default -> new JobSnapshot.JobError("JOB_FAILED","작업을 완료할 수 없습니다.",reason);
        };
    }
}
