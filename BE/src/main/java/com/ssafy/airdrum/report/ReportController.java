package com.ssafy.airdrum.report;

import java.util.UUID;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.web.bind.annotation.*;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import com.ssafy.airdrum.common.error.ApiErrorResponse;
import com.ssafy.airdrum.config.OpenApiConfig;
import com.ssafy.airdrum.user.AuthUser;

@RestController
@RequestMapping("/api/v1/plays/{playId}/report")
@Tag(name = "Reports", description = "본인 플레이의 통계·노트 그래프")
@SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)
@ApiResponse(responseCode = "400", description = "UUID 또는 페이지 파라미터 오류", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
@ApiResponse(responseCode = "401", description = "인증 필요", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
@ApiResponse(responseCode = "404", description = "세션 없음·타인: PLAY_NOT_FOUND, 본인 리포트 없음: REPORT_NOT_FOUND", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
public class ReportController {
    private final ReportQueryService reports;
    public ReportController(ReportQueryService reports) { this.reports = reports; }

    @GetMapping
    @Operation(summary = "리포트 요약", description = "신규 RHYTHM/SHEET 업로드 성공 직후 조회. AI·raw 업로드를 기다리지 않습니다. accuracy는 모두 0~100이며 analysisStatus는 AI 연동 전 NOT_REQUESTED입니다.")
    public ReportResponse report(@Parameter(hidden = true) AuthUser me, @PathVariable UUID playId) {
        return reports.report(me.id(), playId);
    }

    @GetMapping("/notes")
    @Operation(summary = "노트 그래프 페이지", description = "판정된 hits만 seq 오름차순. nextAfterSeq=null이면 끝입니다. seq는 시간순이 아니며 MISS의 deltaMs·velocity는 null입니다.")
    public ReportNotesResponse notes(@Parameter(hidden = true) AuthUser me, @PathVariable UUID playId,
            @RequestParam(required = false) @Min(0) Integer afterSeq,
            @RequestParam(defaultValue = "500") @Min(1) @Max(1000) int limit) {
        return reports.notes(me.id(), playId, afterSeq, limit);
    }
}
