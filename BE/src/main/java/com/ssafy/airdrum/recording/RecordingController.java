package com.ssafy.airdrum.recording;

import java.io.IOException;
import java.net.URI;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
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
import tools.jackson.core.StreamReadFeature;
import tools.jackson.core.json.JsonFactory;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.common.response.PageResponse;
import com.ssafy.airdrum.config.OpenApiConfig;
import com.ssafy.airdrum.recording.RecordingResponses.RecordingDetail;
import com.ssafy.airdrum.recording.RecordingResponses.RecordingSummary;
import com.ssafy.airdrum.user.AuthUser;

/** REC-001 연주 녹음(256번). 타격 시퀀스를 플레이 기록과 따로 저장한다. */
@RestController
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/recordings")
@Tag(name = "Recordings", description = "연주 녹음(타격 시퀀스) 저장·보관함")
@SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)
@ApiResponse(responseCode = "401", description = "인증 필요·탈퇴 회원", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
class RecordingController {
	private static final String PROBLEM = "application/problem+json";
	private static final int RENAME_BYTES = 4096;
	/** 제목 변경 본문 전용. 중복 키·후행 JSON을 거부한다(155 rename과 같음). */
	private final JsonMapper strict = JsonMapper.builder(JsonFactory.builder().enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build())
			.enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();

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

	@GetMapping
	@Operation(summary = "내 녹음 목록", description = "본인의 살아 있는 녹음만. sort는 녹음 시작 시각(startedAt) 기준 NEWEST(기본)·OLDEST, mode는 한 모드만(없으면 전체). "
			+ "q는 제목 부분 검색(앞뒤 공백 제거 뒤 100자까지, % _ 는 글자 그대로). 항목에 곡 정보(song)는 있고 시퀀스·timing은 없다.")
	@ApiResponse(responseCode = "200", description = "녹음 요약 페이지")
	@ApiResponse(responseCode = "400", description = "VALIDATION_FAILED: 페이지 범위. RECORDING_INVALID: 검색어 길이, sort·mode 값", content = @Content(mediaType = PROBLEM, schema = @Schema(implementation = ApiErrorResponse.class)))
	PageResponse<RecordingSummary> list(@Parameter(hidden = true) AuthUser me,
			@Parameter(description = "제목 검색어") @RequestParam(required = false) String q,
			@Parameter(description = "모드 필터", schema = @Schema(allowableValues = {"FREE", "RHYTHM", "SHEET", "TEMPO"})) @RequestParam(required = false) String mode,
			@Parameter(description = "정렬(녹음 시작 시각 기준)", schema = @Schema(allowableValues = {"NEWEST", "OLDEST"}, defaultValue = "NEWEST")) @RequestParam(required = false) String sort,
			@RequestParam(defaultValue = "0") @Min(value = 0, message = "페이지는 0 이상이어야 합니다") @Max(value = 100000, message = "페이지는 100000 이하여야 합니다") int page,
			@RequestParam(defaultValue = "20") @Min(value = 1, message = "크기는 1 이상이어야 합니다") @Max(value = 100, message = "크기는 100 이하여야 합니다") int size) {
		return service.list(me.id(), q, mode, sort, page, size);
	}

	@GetMapping("/{id}")
	@Operation(summary = "녹음 상세", description = "타격 시퀀스(tMs 오름차순)와, 플레이에 연결된 녹음이면 그 플레이가 고정한 채보 버전의 템포(timing). MIDI 내보내기에 쓴다.")
	@ApiResponse(responseCode = "200", description = "녹음 상세")
	@ApiResponse(responseCode = "404", description = "RECORDING_NOT_FOUND: 없는·지운·남의 녹음", content = @Content(mediaType = PROBLEM, schema = @Schema(implementation = ApiErrorResponse.class)))
	RecordingDetail detail(@Parameter(hidden = true) AuthUser me, @PathVariable long id) {
		return service.detail(me.id(), id);
	}

	@PatchMapping(value = "/{id}", consumes = MediaType.APPLICATION_JSON_VALUE)
	@Operation(summary = "녹음 제목 변경", description = "JSON {\"title\": \"...\"}만 받는다(4 KiB 이하). 앞뒤 공백 제거 뒤 1~100자. 모르는 필드·중복 키·후행 JSON은 RECORDING_INVALID.")
	@ApiResponse(responseCode = "200", description = "바뀐 녹음 요약")
	@ApiResponse(responseCode = "400", description = "RECORDING_INVALID", content = @Content(mediaType = PROBLEM, schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "404", description = "RECORDING_NOT_FOUND: 없는·지운·남의 녹음", content = @Content(mediaType = PROBLEM, schema = @Schema(implementation = ApiErrorResponse.class)))
	RecordingSummary rename(@Parameter(hidden = true) AuthUser me, @PathVariable long id, HttpServletRequest request) {
		JsonNode node;
		try {
			byte[] bytes = request.getInputStream().readNBytes(RENAME_BYTES + 1);
			if (bytes.length > RENAME_BYTES) throw invalid();
			node = strict.readTree(bytes);
		} catch (BusinessException ex) {
			throw ex;
		} catch (Exception ex) {
			throw invalid();
		}
		if (node == null || !node.isObject() || node.size() != 1 || !node.path("title").isString()) throw invalid();
		return service.rename(me.id(), id, RecordingValidator.title(node.path("title").asString()));
	}

	@DeleteMapping("/{id}")
	@Operation(summary = "녹음 삭제", description = "목록·상세에서 사라진다. 연결된 플레이와의 연결도 풀려 같은 플레이로 다시 녹음을 저장할 수 있다.")
	@ApiResponse(responseCode = "204", description = "삭제")
	@ApiResponse(responseCode = "404", description = "RECORDING_NOT_FOUND: 없는·지운·남의 녹음", content = @Content(mediaType = PROBLEM, schema = @Schema(implementation = ApiErrorResponse.class)))
	ResponseEntity<Void> delete(@Parameter(hidden = true) AuthUser me, @PathVariable long id) {
		service.delete(me.id(), id);
		return ResponseEntity.noContent().build();
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

	private static BusinessException invalid() {
		return new BusinessException(RecordingError.RECORDING_INVALID);
	}
}
