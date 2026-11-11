package com.ssafy.airdrum.domain.report.controller.query;

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
import com.ssafy.airdrum.domain.report.dto.ReportNotesResponse;
import com.ssafy.airdrum.domain.report.dto.ReportResponse;
import com.ssafy.airdrum.domain.report.service.query.ReportQueryService;
import com.ssafy.airdrum.global.error.ApiErrorResponse;
import com.ssafy.airdrum.global.config.OpenApiConfig;
import com.ssafy.airdrum.domain.user.model.AuthUser;

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
    @Operation(summary = "리포트 요약", description = "신규 RHYTHM/SHEET 업로드 성공 직후 조회. AI·raw 업로드를 기다리지 않습니다. accuracy는 모두 0~100이며 analysisStatus는 저장된 값이고 신규 리포트는 PENDING에서 분석을 시작합니다.")
    public ReportResponse report(@Parameter(hidden = true) AuthUser me, @PathVariable UUID playId) {
        return reports.report(me.id(), playId);
    }

    @GetMapping("/notes")
    @Operation(summary = "노트 그래프 페이지", description = "판정된 hits만 seq 오름차순. nextAfterSeq=null이면 끝입니다. seq는 시간순이 아니며 MISS의 deltaMs·velocity는 null입니다. fromMs·toMs를 주면 그 구간(fromMs 이상 toMs 미만)의 노트만 돌려줍니다(약점 구간 재생용).")
    public ReportNotesResponse notes(@Parameter(hidden = true) AuthUser me, @PathVariable UUID playId,
            @RequestParam(required = false) @Min(0) Integer afterSeq,
            @RequestParam(defaultValue = "500") @Min(1) @Max(1000) int limit,
            @RequestParam(required = false) Double fromMs, @RequestParam(required = false) Double toMs) {
        return reports.notes(me.id(), playId, afterSeq, limit, fromMs, toMs);
    }
}
