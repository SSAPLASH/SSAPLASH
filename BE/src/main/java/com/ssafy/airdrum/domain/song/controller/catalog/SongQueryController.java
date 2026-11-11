package com.ssafy.airdrum.domain.song.controller.catalog;

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
import com.ssafy.airdrum.domain.song.model.SongScope;
import com.ssafy.airdrum.domain.song.service.catalog.SongQueryService;
import com.ssafy.airdrum.domain.song.service.level.SongLevelService;
import com.ssafy.airdrum.domain.song.service.management.SongAccompanimentService;
import com.ssafy.airdrum.global.web.QueryAuthenticated;
import com.ssafy.airdrum.global.error.ApiErrorResponse;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.global.error.CommonErrorCode;
import com.ssafy.airdrum.global.response.PageResponse;
import com.ssafy.airdrum.global.config.OpenApiConfig;
import static com.ssafy.airdrum.domain.song.dto.SongResponses.*;

@RestController
@QueryAuthenticated
@RequestMapping("/api/v1/songs")
@SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)
@ApiResponse(responseCode = "401", description = "인증 필요", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
@ApiResponse(responseCode = "404", description = "없는 곡·타인 곡·삭제된 곡", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
public class SongQueryController {
	private final SongQueryService songs;
	private final SongAccompanimentService accompaniment;
	public SongQueryController(SongQueryService songs, SongAccompanimentService accompaniment) { this.songs = songs; this.accompaniment = accompaniment; }
	@InitBinder
	void trim(WebDataBinder binder) { binder.registerCustomEditor(String.class, new StringTrimmerEditor(false)); }

	@GetMapping
	@Operation(summary = "공용 또는 내 곡 목록", description = "노트 JSON을 제외한 목록. source는 목록 범위(BUILTIN/MINE)이며 곡 출처와 다릅니다.")
	public PageResponse<SongSummary> list(
			@Parameter(hidden = true) @RequestAttribute(QueryAuthenticated.USER_ID) long userId,
			@RequestParam(defaultValue = "BUILTIN") SongScope source,
			@RequestParam(required = false) @Size(max = 100, message = "검색어는 100자 이하여야 합니다") String q,
			@Parameter(description = "곡 난이도 필터. 생략하면 전체", schema = @Schema(allowableValues = {"BEGINNER", "INTERMEDIATE", "ADVANCED"})) @RequestParam(required = false) String songLevel,
			@Parameter(description = "READY이고 곡 난이도가 산정된 곡만 조회", schema = @Schema(allowableValues = {"true", "false"}, defaultValue = "false")) @RequestParam(required = false) String playableOnly,
			@Parameter(description = "반주가 준비됐거나 생성 중인 곡만 조회", schema = @Schema(allowableValues = {"true", "false"}, defaultValue = "false")) @RequestParam(required = false) String withAccompaniment,
			@RequestParam(defaultValue = "0") @Min(value = 0, message = "페이지는 0 이상이어야 합니다") @Max(value = 100000, message = "페이지는 100000 이하여야 합니다") int page,
			@RequestParam(defaultValue = "20") @Min(value = 1, message = "크기는 1 이상이어야 합니다") @Max(value = 100, message = "크기는 100 이하여야 합니다") int size) {
		if (songLevel != null) {
			try { SongLevelService.Level.valueOf(songLevel); }
			catch (IllegalArgumentException ex) { throw new BusinessException(CommonErrorCode.INVALID_INPUT); }
		}
		if (playableOnly != null && !java.util.Set.of("true", "false").contains(playableOnly))
			throw new BusinessException(CommonErrorCode.INVALID_INPUT);
		if (withAccompaniment != null && !java.util.Set.of("true", "false").contains(withAccompaniment))
			throw new BusinessException(CommonErrorCode.INVALID_INPUT);
		return songs.list(userId, source, q, songLevel, "true".equals(playableOnly), "true".equals(withAccompaniment), page, size);
	}
	@GetMapping("/{songId}")
	@Operation(summary = "곡 상세", description = "난이도별 최신 버전 요약. 파일 URL과 notes는 포함하지 않습니다.")
	public SongDetail detail(
			@Parameter(hidden = true) @RequestAttribute(QueryAuthenticated.USER_ID) long userId,
			@PathVariable @Positive(message = "곡 ID는 양수여야 합니다") long songId) {
		return songs.detail(userId, songId);
	}
	@GetMapping("/{songId}/accompaniment")
	@Operation(summary = "곡 반주 URL 발급·갱신", description = "채보 버전과 무관합니다. 반주가 없으면 URL과 만료 시각은 null입니다.")
	@ApiResponse(responseCode = "404", description = "없는 곡·타인 곡·삭제된 곡: SONG_NOT_FOUND, 반주 객체 부재: CHART_ASSET_NOT_FOUND", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "409", description = "곡이 아직 준비되지 않음", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "503", description = "스토리지 장애 또는 반주 교체 중", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	public Accompaniment accompaniment(
			@Parameter(hidden = true) @RequestAttribute(QueryAuthenticated.USER_ID) long userId,
			@PathVariable @Positive(message = "곡 ID는 양수여야 합니다") long songId) {
		return accompaniment.get(userId, songId);
	}
}
