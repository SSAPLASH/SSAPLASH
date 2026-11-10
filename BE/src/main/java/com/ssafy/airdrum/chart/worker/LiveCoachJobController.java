package com.ssafy.airdrum.chart.worker;

import java.util.UUID;
import com.ssafy.airdrum.common.error.BusinessException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** 연주 중 LLM 구간 코칭 워커 API. 인증은 채보·총평 워커와 같은 WorkerTokenFilter(`/internal/**`)가 한다. */
@RestController
@RequestMapping("/internal/v1/live-coach-jobs")
class LiveCoachJobController {
    private final LiveCoachQueue queue;
    LiveCoachJobController(LiveCoachQueue queue) { this.queue = queue; }
    record ClaimRequest(String workerId, UUID claimRequestId) {}
    record ResultRequest(UUID attemptId, String title, String sub, String model, Long generationMs) {}
    record FailureRequest(UUID attemptId, String code, String summary) {}
    private String worker(HttpServletRequest request) { return (String) request.getAttribute(WorkerSecurityConfiguration.WORKER); }

    @PostMapping("/claim")
    ResponseEntity<LiveCoachQueue.Assignment> claim(@RequestBody ClaimRequest body, HttpServletRequest request) {
        String worker = worker(request);
        if (body.workerId() == null || !body.workerId().equals(worker) || body.claimRequestId() == null)
            throw new BusinessException(WorkerError.INVALID);
        var assignment = queue.claim(worker, body.claimRequestId());
        return assignment == null ? ResponseEntity.noContent().build() : ResponseEntity.ok(assignment);
    }

    @PostMapping("/{jobId}/result")
    LiveCoachQueue.Status result(@PathVariable long jobId, @RequestBody ResultRequest body, HttpServletRequest request) {
        return queue.result(jobId, worker(request), body.attemptId(), body.title(), body.sub(), body.model(), body.generationMs());
    }

    @PostMapping("/{jobId}/failure")
    LiveCoachQueue.Status failure(@PathVariable long jobId, @RequestBody FailureRequest body, HttpServletRequest request) {
        return queue.failure(jobId, worker(request), body.attemptId(), body.code(), body.summary());
    }
}
