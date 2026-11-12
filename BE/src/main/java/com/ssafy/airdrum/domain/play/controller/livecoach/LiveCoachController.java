package com.ssafy.airdrum.domain.play.controller.livecoach;

import java.util.UUID;
import com.ssafy.airdrum.domain.play.service.livecoach.LiveCoachQueue;
import com.ssafy.airdrum.global.config.OpenApiConfig;
import com.ssafy.airdrum.domain.user.model.AuthUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;

/**
 * 연주 중 LLM 구간 코칭 사용자 API(설계 COACH-001 연주 중 LLM 코칭 3.3절). 로그인 사용자만 쓴다.
 * 구간 사실을 넣으면 202와 요청 번호를 주고, FE가 짧은 주기로 결과를 조회한다. 꺼져 있으면 204.
 */
@RestController
@RequestMapping("/api/v1/live-coach/segments")
@SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)
class LiveCoachController {
    private final LiveCoachQueue queue;
    LiveCoachController(LiveCoachQueue queue) { this.queue = queue; }
    record SegmentRequest(UUID runId, JsonNode facts) {}

    @PostMapping
    @Operation(summary = "연주 중 구간 코칭 요청")
    ResponseEntity<LiveCoachQueue.Created> create(@Parameter(hidden = true) AuthUser user, @RequestBody SegmentRequest body) {
        var created = queue.create(user.id(), body.runId(), body.facts());
        return created == null ? ResponseEntity.noContent().build() : ResponseEntity.status(HttpStatus.ACCEPTED).body(created);
    }

    @GetMapping("/{requestId}")
    @Operation(summary = "연주 중 구간 코칭 결과 조회")
    ResponseEntity<LiveCoachQueue.Tip> find(@Parameter(hidden = true) AuthUser user, @PathVariable UUID requestId) {
        var tip = queue.find(user.id(), requestId);
        return "DONE".equals(tip.status()) ? ResponseEntity.ok(tip) : ResponseEntity.status(HttpStatus.ACCEPTED).body(tip);
    }
}
