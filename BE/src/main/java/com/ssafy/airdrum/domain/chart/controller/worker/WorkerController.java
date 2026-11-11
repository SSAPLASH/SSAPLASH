package com.ssafy.airdrum.domain.chart.controller.worker;

import com.ssafy.airdrum.domain.chart.service.worker.WorkerFileAccess;
import com.ssafy.airdrum.domain.chart.service.worker.WorkerPayload;
import com.ssafy.airdrum.domain.chart.service.worker.WorkerQueue;
import com.ssafy.airdrum.domain.chart.service.worker.WorkerResults;
import com.ssafy.airdrum.global.worker.WorkerError;
import com.ssafy.airdrum.global.worker.WorkerIdentity;

import java.util.UUID;

import com.ssafy.airdrum.global.error.BusinessException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/internal/v1/chart-jobs")
class WorkerController {
    private final WorkerQueue queue;
    private final WorkerFileAccess files;
    private final WorkerResults results;
    private final WorkerPayload payload;
    WorkerController(WorkerQueue queue, WorkerFileAccess files, WorkerResults results, WorkerPayload payload) { this.queue=queue; this.files=files; this.results=results; this.payload=payload; }
    record ClaimRequest(String workerId, UUID claimRequestId) {}
    record HeartbeatRequest(UUID attemptId, long eventSeq, int progress) {}
    record FailureRequest(UUID attemptId, long eventSeq, String stage, String code, boolean retryable, String summary, String reason) {}
    private String worker(HttpServletRequest request) { return WorkerIdentity.id(request); }
    @PostMapping("/claim")
    ResponseEntity<WorkerQueue.Assignment> claim(@RequestBody ClaimRequest body, HttpServletRequest request) {
        String worker=worker(request);
        if (body.workerId()==null || !body.workerId().equals(worker) || body.claimRequestId()==null)
            throw new BusinessException(WorkerError.INVALID);
        var result=queue.claim(worker,body.claimRequestId());
        return result==null ? ResponseEntity.noContent().build() : ResponseEntity.ok(result);
    }
    @PostMapping("/{jobId}/heartbeat")
    WorkerQueue.Heartbeat heartbeat(@PathVariable long jobId, @RequestBody HeartbeatRequest body, HttpServletRequest request) {
        return queue.heartbeat(jobId,worker(request),body.attemptId(),body.eventSeq(),body.progress());
    }
    @PostMapping("/{jobId}/file-access")
    WorkerFileAccess.Response fileAccess(@PathVariable long jobId, @RequestBody WorkerFileAccess.Request body, HttpServletRequest request) {
        return files.access(jobId,worker(request),body);
    }
    @PostMapping("/{jobId}/results/separation")
    WorkerResults.Receipt separation(@PathVariable long jobId, HttpServletRequest request) throws java.io.IOException {
        return results.separation(jobId,worker(request),payload.read(request.getInputStream()));
    }
    @PostMapping("/{jobId}/results/transcription")
    WorkerResults.Receipt transcription(@PathVariable long jobId, HttpServletRequest request) throws java.io.IOException {
        return results.transcription(jobId,worker(request),payload.read(request.getInputStream()));
    }
    @PostMapping("/{jobId}/failure")
    WorkerQueue.FailureOutcome failure(@PathVariable long jobId, @RequestBody FailureRequest body, HttpServletRequest request) {
        return queue.failure(jobId,worker(request),body.attemptId(),body.eventSeq(),body.stage(),body.code(),body.retryable(),body.summary(),body.reason());
    }
}
