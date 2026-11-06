package com.ssafy.airdrum.song.recommend;

import java.util.UUID;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.ResponseEntity;
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
import com.ssafy.airdrum.song.recommend.RecommendationResponses.*;
import com.ssafy.airdrum.user.AuthUser;

@RestController
@RequestMapping("/api/v1")
@Validated
@Tag(name = "Recommendations", description = "규칙 기반 곡 추천(R1)")
@SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)
@ApiResponse(responseCode = "401", description = "인증 필요", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
public class RecommendationController {
	private final RecommendationService service;
	public RecommendationController(RecommendationService service) { this.service = service; }

	@GetMapping("/songs/recommendations")
	@Operation(summary = "곡 추천", description = "곡당 채보 1개를 추천 이유와 함께 돌려줍니다. 후보가 없으면 200과 빈 items입니다. 개인 곡은 추천하지 않습니다. 호출하면 노출이 기록됩니다.")
	@ApiResponse(responseCode = "400", description = "잘못된 파라미터. SONG_PICKER에 playId를 주거나 DRILL에 playId가 없는 경우 포함", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "404", description = "없는 연주·타인의 연주: PLAY_NOT_FOUND", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	public Recommendations recommend(@Parameter(hidden = true) AuthUser me,
			@RequestParam RecommendationService.Context context,
			@Parameter(description = "카드를 누르면 갈 연주 모드. 값을 검사만 하고 결과에는 영향을 주지 않는다(악보 이미지 유무는 추천에 쓰지 않는다)") @RequestParam(defaultValue = "RHYTHM") RecommendationService.Mode mode,
			@Parameter(description = "REPORT일 때 그 연주의 약점을 우선한다. DRILL이면 필수이고 그 연주의 약점에 맞는 연습 곡을 최대 3개 돌려준다. 약점이 없거나 분석 전이면 빈 items. 본인 연주만 가능") @RequestParam(required = false) UUID playId,
			@RequestParam(defaultValue = "5") @Min(value = 1, message = "크기는 1 이상이어야 합니다") @Max(value = 10, message = "크기는 10 이하여야 합니다") int size) {
		return service.recommend(me.id(), context, playId, size);
	}

	@PostMapping("/recommendations/{requestId}/clicks")
	@Operation(summary = "추천 클릭 기록", description = "추천 카드를 눌렀음을 기록합니다. 같은 카드를 다시 눌러도 첫 시각을 유지합니다. 실패해도 곡 이동은 막지 않아야 합니다.")
	@ApiResponse(responseCode = "204", description = "기록됨")
	@ApiResponse(responseCode = "404", description = "없는 추천·타인의 추천·그 추천에 없는 곡: RECOMMENDATION_NOT_FOUND", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	public ResponseEntity<Void> click(@Parameter(hidden = true) AuthUser me, @PathVariable UUID requestId, @RequestBody @NotNull @jakarta.validation.Valid ClickRequest body) {
		if (body.songId() == null || body.songId() <= 0) throw new com.ssafy.airdrum.common.error.BusinessException(com.ssafy.airdrum.common.error.CommonErrorCode.INVALID_INPUT);
		service.click(me.id(), requestId, body.songId());
		return ResponseEntity.noContent().build();
	}
}
