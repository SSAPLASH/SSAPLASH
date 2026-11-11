package com.ssafy.airdrum.domain.preset.controller;

import java.net.URI;
import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;

import com.ssafy.airdrum.domain.preset.dto.PresetRequest;
import com.ssafy.airdrum.domain.preset.dto.PresetResponse;
import com.ssafy.airdrum.domain.preset.service.KitPresetService;
import com.ssafy.airdrum.global.error.ApiErrorResponse;
import com.ssafy.airdrum.global.config.OpenApiConfig;
import com.ssafy.airdrum.domain.user.model.AuthUser;

/** 키트 프리셋 API(설계 문서(90) 3-1). 로그인한 회원 자신의 프리셋만 다룬다. */
@Tag(name = "Presets", description = "키트 프리셋(패드 배치·사운드)")
@RestController
@RequestMapping("/api/presets")
@SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)
@ApiResponse(responseCode = "401", description = "토큰 없음·만료·무효·탈퇴 회원 (UNAUTHORIZED)",
		content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
public class KitPresetController {

	private static final String ID_MESSAGE = "프리셋 ID는 양수여야 합니다";

	private final KitPresetService presets;

	public KitPresetController(KitPresetService presets) {
		this.presets = presets;
	}

	@Operation(summary = "내 프리셋 목록",
			description = "기본 프리셋이 있으면 첫 원소다(로그인 시 자동 적용). 나머지는 최근 생성 순. 최대 10개.")
	@GetMapping
	public List<PresetResponse> list(AuthUser me) {
		return presets.list(me.id());
	}

	@Operation(summary = "프리셋 단건")
	@ApiResponse(responseCode = "404", description = "없거나 다른 회원의 프리셋 (PRESET_NOT_FOUND)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@GetMapping("/{id}")
	public PresetResponse get(AuthUser me, @PathVariable @Positive(message = ID_MESSAGE) long id) {
		return presets.get(me.id(), id);
	}

	@Operation(summary = "프리셋 저장", description = "기본 프리셋이 아닌 상태로 만든다. 기본 지정은 PUT /{id}/default.")
	@ApiResponse(responseCode = "201", description = "생성됨. Location 헤더에 자원 경로")
	@ApiResponse(responseCode = "409", description = "이름 중복(PRESET_NAME_DUPLICATE)·10개 초과(PRESET_LIMIT_EXCEEDED)·동시 변경(PRESET_CONFLICT)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@PostMapping
	public ResponseEntity<PresetResponse> create(AuthUser me, @Valid @RequestBody PresetRequest request) {
		var created = presets.create(me.id(), request);
		return ResponseEntity.created(URI.create("/api/presets/" + created.id())).body(created);
	}

	@Operation(summary = "프리셋 수정", description = "이름·배치·사운드를 통째로 바꾼다. 기본 여부는 그대로다.")
	@ApiResponse(responseCode = "404", description = "없거나 다른 회원의 프리셋 (PRESET_NOT_FOUND)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "409", description = "다른 프리셋과 이름 중복(PRESET_NAME_DUPLICATE)·동시 변경(PRESET_CONFLICT)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@PutMapping("/{id}")
	public PresetResponse update(AuthUser me, @PathVariable @Positive(message = ID_MESSAGE) long id,
			@Valid @RequestBody PresetRequest request) {
		return presets.update(me.id(), id, request);
	}

	@Operation(summary = "기본 프리셋 지정", description = "이전 기본은 해제된다. 이미 기본이면 그대로 200.")
	@ApiResponse(responseCode = "404", description = "없거나 다른 회원의 프리셋 (PRESET_NOT_FOUND)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "409", description = "동시 변경 (PRESET_CONFLICT)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@PutMapping("/{id}/default")
	public PresetResponse makeDefault(AuthUser me, @PathVariable @Positive(message = ID_MESSAGE) long id) {
		return presets.makeDefault(me.id(), id);
	}

	@Operation(summary = "프리셋 삭제", description = "기본 프리셋을 지우면 남은 것 중 가장 최근 생성이 기본이 된다.")
	@ApiResponse(responseCode = "204", description = "삭제됨")
	@ApiResponse(responseCode = "404", description = "없거나 다른 회원의 프리셋 (PRESET_NOT_FOUND)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@DeleteMapping("/{id}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void delete(AuthUser me, @PathVariable @Positive(message = ID_MESSAGE) long id) {
		presets.delete(me.id(), id);
	}

}
