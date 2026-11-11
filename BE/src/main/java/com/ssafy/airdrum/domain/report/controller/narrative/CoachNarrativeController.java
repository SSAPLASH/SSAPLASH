package com.ssafy.airdrum.domain.report.controller.narrative;

import com.ssafy.airdrum.domain.report.service.narrative.CoachNarrativeQueue;
import com.ssafy.airdrum.global.worker.WorkerError;
import com.ssafy.airdrum.global.worker.WorkerIdentity;

import java.util.UUID;
import com.ssafy.airdrum.global.error.BusinessException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** LLM 총평 작업 워커 API. 인증은 채보 워커와 같은 WorkerTokenFilter(`/internal/**`)가 한다. */
@RestController
@RequestMapping("/internal/v1/coach-narratives")
class CoachNarrativeController {
    private final CoachNarrativeQueue queue;
    CoachNarrativeController(CoachNarrativeQueue queue) { this.queue = queue; }
    record ClaimRequest(String workerId, UUID claimRequestId) {}
    record ResultRequest(UUID attemptId, String text, String model, Long generationMs) {}
    record FailureRequest(UUID attemptId, String code, boolean retryable, String summary) {}
    private String worker(HttpServletRequest request) { return WorkerIdentity.id(request); }

    @PostMapping("/claim")
    ResponseEntity<CoachNarrativeQueue.Assignment> claim(@RequestBody ClaimRequest body, HttpServletRequest request) {
        String worker = worker(request);
        if (body.workerId() == null || !body.workerId().equals(worker) || body.claimRequestId() == null)
            throw new BusinessException(WorkerError.INVALID);
        var assignment = queue.claim(worker, body.claimRequestId());
        return assignment == null ? ResponseEntity.noContent().build() : ResponseEntity.ok(assignment);
    }

    @PostMapping("/{jobId}/result")
    CoachNarrativeQueue.Status result(@PathVariable long jobId, @RequestBody ResultRequest body, HttpServletRequest request) {
        return queue.result(jobId, worker(request), body.attemptId(), body.text(), body.model(), body.generationMs());
    }

    @PostMapping("/{jobId}/failure")
    CoachNarrativeQueue.Status failure(@PathVariable long jobId, @RequestBody FailureRequest body, HttpServletRequest request) {
        return queue.failure(jobId, worker(request), body.attemptId(), body.code(), body.retryable(), body.summary());
    }
}
