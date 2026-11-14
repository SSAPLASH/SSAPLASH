package com.ssafy.airdrum.domain.play.controller.history;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import com.ssafy.airdrum.global.error.ApiErrorResponse;
import com.ssafy.airdrum.global.response.PageResponse;
import com.ssafy.airdrum.global.config.OpenApiConfig;
import com.ssafy.airdrum.domain.play.service.history.PlayQueryService;
import com.ssafy.airdrum.domain.play.dto.BestRecordsResponse;
import com.ssafy.airdrum.domain.play.dto.PlaySummaryResponse;
import com.ssafy.airdrum.domain.user.model.AuthUser;

@RestController
@RequestMapping("/api/v1/plays")
@Tag(name = "Plays", description = "본인 플레이 기록")
@SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)
@ApiResponse(responseCode = "400", description = "페이지 또는 필터 파라미터 오류", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
@ApiResponse(responseCode = "401", description = "인증 필요", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
public class PlayQueryController {
    private final PlayQueryService plays;
    public PlayQueryController(PlayQueryService plays) { this.plays = plays; }
    @GetMapping
    @ApiResponse(responseCode = "200", description = "본인 연주 기록 페이지")
    @Operation(summary = "내 연주 기록 목록", description = "본인 기록을 종료 시각과 ID 기준으로 정렬합니다. 날짜는 한국 시간의 종료일 기준이며 양 끝을 포함합니다. 검색은 접근 가능한 곡 제목만 대상으로 합니다. 접근할 수 없는 곡의 제목은 null입니다. accuracy는 0~100이며 hasReport가 true인 플레이는 기존 리포트 API에서 조회할 수 있습니다.")
    public PageResponse<PlaySummaryResponse> list(@Parameter(hidden = true) AuthUser me,
            @Parameter(description = "곡 제목 부분 검색(공백 제거 후 100자 이하, %와 _는 문자 그대로)") @RequestParam(required = false) String q,
            @Parameter(description = "종료일 시작(한국 시간, 포함)", example = "2026-01-01") @RequestParam(required = false) String from,
            @Parameter(description = "종료일 끝(한국 시간, 포함)", example = "2026-01-31") @RequestParam(required = false) String to,
            @Parameter(description = "모드 필터", schema = @Schema(allowableValues = {"FREE", "RHYTHM", "SHEET", "TEMPO"})) @RequestParam(required = false) String mode,
            @Parameter(description = "종료 시각 정렬", schema = @Schema(allowableValues = {"NEWEST", "OLDEST"}, defaultValue = "NEWEST")) @RequestParam(required = false) String sort,
            @RequestParam(defaultValue = "0") @Min(0) @Max(100000) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return plays.list(me.id(), page, size, q, from, to, mode, sort);
    }
    @GetMapping("/best-records")
    @ApiResponse(responseCode = "200", description = "접근 가능한 요청 곡의 본인 최고 기록")
    @Operation(summary = "곡·연습 단계별 최고 기록", description = "쉼표로 구분한 곡 ID 최대 100개. 명시적으로 완료한 1배속 RHYTHM/SHEET 기록만 포함하며, 최고 점수와 정확도는 각각 집계합니다. 정확도는 0~100입니다.")
    public BestRecordsResponse bestRecords(@Parameter(hidden = true) AuthUser me,
            @Parameter(description = "양의 곡 ID 1~100개, 쉼표 구분", required = true, example = "1,2") @RequestParam String songIds) {
        return plays.bestRecords(me.id(), songIds);
    }
}
