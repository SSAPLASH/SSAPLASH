package com.ssafy.airdrum.recording;

import java.io.IOException;
import java.net.URI;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;

import com.ssafy.airdrum.common.error.ApiErrorResponse;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.config.OpenApiConfig;
import com.ssafy.airdrum.recording.RecordingResponses.RecordingSummary;
import com.ssafy.airdrum.user.AuthUser;

/** REC-001 연주 녹음(256번). 타격 시퀀스를 플레이 기록과 따로 저장한다. */
@RestController
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/recordings")
@Tag(name = "Recordings", description = "연주 녹음(타격 시퀀스) 저장")
@SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)
@ApiResponse(responseCode = "401", description = "인증 필요·탈퇴 회원", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
class RecordingController {

	private final RecordingJson json;
	private final RecordingService service;

	RecordingController(RecordingJson json, RecordingService service) {
		this.json = json;
		this.service = service;
	}

	@ModelAttribute
	void noStore(HttpServletResponse response) {
		response.setHeader(HttpHeaders.CACHE_CONTROL, "private, no-store");
	}

	@PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
	@Operation(summary = "녹음 저장",
			description = "schemaVersion 1. clientKey가 같은 살아 있는 녹음이 있으면 저장하지 않고 같은 내용이면 200, 다른 내용이면 409. "
					+ "타격은 서버가 tMs로 안정 정렬해 저장하므로 순서만 다른 재전송도 같은 내용이다. 본문 5 MiB, 타격 50,000개, 2시간, 회원당 200개.",
			requestBody = @io.swagger.v3.oas.annotations.parameters.RequestBody(required = true,
					content = @Content(schema = @Schema(implementation = RecordingRequest.class))))
	@ApiResponse(responseCode = "201", description = "최초 저장. Location에 녹음 경로")
	@ApiResponse(responseCode = "200", description = "같은 clientKey·같은 내용 재전송. 기존 녹음")
	@ApiResponse(responseCode = "400", description = "RECORDING_INVALID: 필수·범위·형식, 모르는 필드·중복 키, 마지막 타격이 길이보다 늦음, HTTP 본문 압축",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "404", description = "RECORDING_PLAY_NOT_FOUND: playId가 없거나 남의 것, 이미 다른 녹음과 연결됨",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "409", description = "RECORDING_CONFLICT(같은 키 다른 내용), RECORDING_SCHEMA_UNSUPPORTED",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "413", description = "RECORDING_TOO_LARGE(5 MiB·50,000개·2시간), RECORDING_QUOTA_EXCEEDED(회원당 200개)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "503", description = "RECORDING_BUSY: 잠금 대기 초과. 같은 요청을 다시 보낸다",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	ResponseEntity<RecordingSummary> save(@Parameter(hidden = true) AuthUser me, HttpServletRequest request) throws IOException {
		String encoding = request.getHeader(HttpHeaders.CONTENT_ENCODING);
		if (encoding != null && !encoding.equalsIgnoreCase("identity")) throw new BusinessException(RecordingError.RECORDING_INVALID);
		if (request.getContentLengthLong() > RecordingJson.MAX_BYTES) throw new BusinessException(RecordingError.RECORDING_TOO_LARGE);
		byte[] body = request.getInputStream().readNBytes(RecordingJson.MAX_BYTES + 1);
		var saved = service.save(me.id(), json.read(body));
		if (!saved.created()) return ResponseEntity.ok(saved.summary());
		return ResponseEntity.created(URI.create("/api/v1/recordings/" + saved.summary().id())).body(saved.summary());
	}
}
