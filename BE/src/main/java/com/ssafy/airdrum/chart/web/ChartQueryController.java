package com.ssafy.airdrum.chart.web;

import jakarta.validation.constraints.Positive;
import org.springframework.web.bind.annotation.*;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import com.ssafy.airdrum.chart.*;
import com.ssafy.airdrum.chart.asset.ChartAssetService;
import com.ssafy.airdrum.common.error.ApiErrorResponse;
import com.ssafy.airdrum.config.OpenApiConfig;
import static com.ssafy.airdrum.chart.ChartResponses.*;

@RestController
@RequestMapping("/api/v1")
@SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)
@ApiResponse(responseCode = "401", description = "인증 필요", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
@ApiResponse(responseCode = "404", description = "없는 자원·접근 불가·파일 부재", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
@ApiResponse(responseCode = "409", description = "생성 중·지원하지 않는 형식·악보 시간 정보 부족", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
public class ChartQueryController {
	private final ChartQueryService charts;
	private final ChartAssetService assets;
	public ChartQueryController(ChartQueryService charts, ChartAssetService assets) { this.charts = charts; this.assets = assets; }

	@GetMapping("/charts/{chartId}")
	@Operation(summary = "최신 채보 버전", description = "플레이 시작 후에는 반환된 chartVersionId를 고정합니다.")
	public ChartDetail latest(
			@Parameter(hidden = true) @RequestAttribute(ChartQueryWebConfiguration.USER_ID) long userId,
			@PathVariable @Positive(message = "채보 ID는 양수여야 합니다") long chartId) {
		return charts.latest(userId, chartId);
	}
	@GetMapping("/chart-versions/{chartVersionId}")
	@Operation(summary = "지정 채보 버전", description = "최신으로 대체하지 않으며 timeMs에 offsetMs를 다시 더하지 않습니다.")
	public ChartDetail version(
			@Parameter(hidden = true) @RequestAttribute(ChartQueryWebConfiguration.USER_ID) long userId,
			@PathVariable @Positive(message = "버전 ID는 양수여야 합니다") long chartVersionId) {
		return charts.version(userId, chartVersionId);
	}
	@GetMapping("/chart-versions/{chartVersionId}/assets")
	@Operation(summary = "같은 버전의 자산 URL 발급·갱신", description = "선택적 이미지·반주 GET URL. 원본·드럼 트랙·내부 키는 제공하지 않습니다.")
	@ApiResponse(responseCode = "503", description = "스토리지 미설정 또는 일시 장애", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	public ChartAssets assets(
			@Parameter(hidden = true) @RequestAttribute(ChartQueryWebConfiguration.USER_ID) long userId,
			@PathVariable @Positive(message = "버전 ID는 양수여야 합니다") long chartVersionId) {
		return assets.assets(userId, chartVersionId);
	}
}
