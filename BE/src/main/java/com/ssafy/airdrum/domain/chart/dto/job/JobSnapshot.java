package com.ssafy.airdrum.domain.chart.dto.job;

import java.time.Instant;

public record JobSnapshot(long jobId, long songId, Status status, int progress, long revision,
        JobError error, Instant createdAt, Instant startedAt, Instant finishedAt) {
    public enum Status { QUEUED, SEPARATING, TRANSCRIBING, DONE, FAILED }
    public record JobError(String code, String message, String reason) {}
}
