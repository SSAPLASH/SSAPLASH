package com.ssafy.airdrum.domain.lesson.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.ssafy.airdrum.domain.lesson.dto.LessonsResponse;
import com.ssafy.airdrum.domain.lesson.service.LessonService;
import com.ssafy.airdrum.global.error.ApiErrorResponse;
import com.ssafy.airdrum.global.config.OpenApiConfig;
import com.ssafy.airdrum.domain.user.model.AuthUser;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletResponse;

@RestController
@RequestMapping("/api/v1/lessons")
@Tag(name = "Lessons", description = "학습 코스(입문·중급) 레슨과 본인 진도")
@SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)
@ApiResponse(responseCode = "401", description = "인증 필요", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
public class LessonController {

	private final LessonService lessons;

	LessonController(LessonService lessons) {
		this.lessons = lessons;
	}

	@ModelAttribute
	void noStore(HttpServletResponse response) {
		response.setHeader("Cache-Control", "private, no-store");
	}

	@GetMapping
	@Operation(summary = "학습 코스(입문·중급) 레슨 목록과 진도",
			description = "입문 전부 → 중급 순서로 레슨(코스·코스 안 순서)과 채보(NORMAL), 본인의 통과 여부, 잠김 여부를 준다. 연주 레슨은 1배속 악보 연습(SHEET)으로 끝까지 친 기록의 최고 정확도가 "
					+ "passAccuracy 이상이면 통과, 알아보기 레슨은 완료를 저장했으면 통과다. 목록에서 앞 레슨(앞 코스 포함) 중 통과하지 못한 것이 있으면 locked다.")
	@ApiResponse(responseCode = "200", description = "레슨 목록")
	public LessonsResponse list(@Parameter(hidden = true) AuthUser me) {
		return lessons.list(me.id());
	}

	@PostMapping("/{songId}/completion")
	@Operation(summary = "알아보기 레슨 완료 저장", description = "본문 없음. 이미 완료했어도 204이고 처음 완료 시각을 유지한다.")
	@ApiResponse(responseCode = "204", description = "저장")
	@ApiResponse(responseCode = "400", description = "연주 레슨: VALIDATION_FAILED",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "404", description = "레슨이 아니거나 볼 수 없는 곡: SONG_NOT_FOUND",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	public ResponseEntity<Void> complete(@Parameter(hidden = true) AuthUser me, @PathVariable long songId) {
		lessons.complete(me.id(), songId);
		return ResponseEntity.noContent().build();
	}
}
