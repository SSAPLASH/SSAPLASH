package com.ssafy.airdrum.song;

import jakarta.validation.constraints.*;
import org.springframework.beans.propertyeditors.StringTrimmerEditor;
import org.springframework.web.bind.WebDataBinder;
import org.springframework.web.bind.annotation.*;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import com.ssafy.airdrum.chart.web.ChartQueryWebConfiguration;
import com.ssafy.airdrum.common.error.ApiErrorResponse;
import com.ssafy.airdrum.common.response.PageResponse;
import com.ssafy.airdrum.config.OpenApiConfig;
import static com.ssafy.airdrum.song.SongResponses.*;

@RestController
@RequestMapping("/api/v1/songs")
@SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)
@ApiResponse(responseCode = "401", description = "인증 필요", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
@ApiResponse(responseCode = "404", description = "없는 곡·타인 곡·삭제된 곡", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
public class SongQueryController {
	private final SongQueryService songs;
	public SongQueryController(SongQueryService songs) { this.songs = songs; }
	@InitBinder
	void trim(WebDataBinder binder) { binder.registerCustomEditor(String.class, new StringTrimmerEditor(false)); }

	@GetMapping
	@Operation(summary = "공용 또는 내 곡 목록", description = "노트 JSON을 제외한 목록. source는 목록 범위(BUILTIN/MINE)이며 곡 출처와 다릅니다.")
	public PageResponse<SongSummary> list(
			@Parameter(hidden = true) @RequestAttribute(ChartQueryWebConfiguration.USER_ID) long userId,
			@RequestParam(defaultValue = "BUILTIN") SongScope source,
			@RequestParam(required = false) @Size(max = 100, message = "검색어는 100자 이하여야 합니다") String q,
			@RequestParam(defaultValue = "0") @Min(value = 0, message = "페이지는 0 이상이어야 합니다") @Max(value = 100000, message = "페이지는 100000 이하여야 합니다") int page,
			@RequestParam(defaultValue = "20") @Min(value = 1, message = "크기는 1 이상이어야 합니다") @Max(value = 100, message = "크기는 100 이하여야 합니다") int size) {
		return songs.list(userId, source, q, page, size);
	}
	@GetMapping("/{songId}")
	@Operation(summary = "곡 상세", description = "난이도별 최신 버전 요약. 파일 URL과 notes는 포함하지 않습니다.")
	public SongDetail detail(
			@Parameter(hidden = true) @RequestAttribute(ChartQueryWebConfiguration.USER_ID) long userId,
			@PathVariable @Positive(message = "곡 ID는 양수여야 합니다") long songId) {
		return songs.detail(userId, songId);
	}
}
