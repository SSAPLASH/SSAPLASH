package com.ssafy.airdrum.song.similar;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Positive;
import org.springframework.validation.annotation.Validated;
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
import com.ssafy.airdrum.song.similar.SimilarResponses.Similar;
import com.ssafy.airdrum.user.AuthUser;

@RestController
@RequestMapping("/api/v1/songs/{songId}/similar")
@Validated
@Tag(name = "Recommendations", description = "채보 특징 기반 비슷한 곡(R2)")
@SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)
@ApiResponse(responseCode = "401", description = "인증 필요", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
public class SimilarSongsController {
	public enum Difficulty { EASY, NORMAL, HARD }
	private final SimilarSongsService service;
	public SimilarSongsController(SimilarSongsService service) { this.service = service; }

	@GetMapping
	@Operation(summary = "비슷한 곡", description = "기준 곡과 연주 느낌(패드·전환·밀도·템포)이 비슷한 공용 곡을 곡당 채보 하나로 돌려줍니다. 후보가 없거나 기준 곡의 채보 특징이 없으면 200과 빈 items입니다. 개인 곡은 결과에 나오지 않습니다. 호출하면 노출이 기록되며 클릭은 POST /api/v1/recommendations/{requestId}/clicks로 기록합니다.")
	@ApiResponse(responseCode = "400", description = "잘못된 파라미터", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "404", description = "없는 곡·타인의 개인 곡: SONG_NOT_FOUND", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	public Similar similar(@Parameter(hidden = true) AuthUser me,
			@PathVariable @Positive(message = "곡 ID는 양수여야 합니다") long songId,
			@Parameter(description = "비교 기준 난이도. 그 난이도가 없으면 난이도 순서에서 가장 가까운 채보") @RequestParam(defaultValue = "NORMAL") Difficulty difficulty,
			@RequestParam(defaultValue = "5") @Min(value = 1, message = "크기는 1 이상이어야 합니다") @Max(value = 10, message = "크기는 10 이하여야 합니다") int size) {
		return service.similar(me.id(), songId, difficulty.name(), size);
	}
}
