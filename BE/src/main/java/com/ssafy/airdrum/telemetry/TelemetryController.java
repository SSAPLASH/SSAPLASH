package com.ssafy.airdrum.telemetry;

import java.io.IOException;
import java.time.Instant;
import java.util.UUID;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
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

import com.ssafy.airdrum.common.error.ApiErrorResponse;
import com.ssafy.airdrum.common.response.PageResponse;
import com.ssafy.airdrum.config.OpenApiConfig;
import com.ssafy.airdrum.telemetry.TelemetryBatchRequest.Kind;
import com.ssafy.airdrum.telemetry.TelemetryResponses.BatchAccepted;
import com.ssafy.airdrum.telemetry.TelemetryResponses.EventItem;
import com.ssafy.airdrum.telemetry.TelemetryResponses.SessionSummary;
import com.ssafy.airdrum.user.AuthUser;

/** MONITOR-001 진단 텔레메트리. ADMIN이 켠 진단 모드에서만 수집하므로 모든 API가 ADMIN 전용이다. */
@RestController
@RequestMapping("/api/telemetry")
@PreAuthorize("hasRole('ADMIN')")
@Tag(name = "Telemetry", description = "진단 텔레메트리 수신·조회 (ADMIN)")
@SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)
@ApiResponse(responseCode = "401", description = "인증 필요", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
@ApiResponse(responseCode = "403", description = "ADMIN 아님", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
public class TelemetryController {

	private final TelemetryJson json;
	private final TelemetryBatchValidator validator;
	private final TelemetryBatchService batches;
	private final TelemetryQueryService queries;

	public TelemetryController(TelemetryJson json, TelemetryBatchValidator validator, TelemetryBatchService batches,
			TelemetryQueryService queries) {
		this.json = json;
		this.validator = validator;
		this.batches = batches;
		this.queries = queries;
	}

	@PostMapping(value = "/batches", consumes = MediaType.APPLICATION_JSON_VALUE)
	@Operation(summary = "텔레메트리 배치 수신",
			description = "schemaVersion 1. 같은 세션·mode의 HIT·STATUS 이벤트 1~100건, 본문 128 KiB 이하. 한 건이라도 규칙 위반이면 "
					+ "전체 거절(400), 저장 실패는 전체 롤백(500). 재전송·멱등 처리는 없다. 회원은 인증 주체로 정한다.",
			requestBody = @io.swagger.v3.oas.annotations.parameters.RequestBody(required = true,
					content = @Content(schema = @Schema(implementation = TelemetryBatchRequest.class))))
	@ApiResponse(responseCode = "200", description = "배치 전체 저장", content = @Content(schema = @Schema(implementation = BatchAccepted.class)))
	@ApiResponse(responseCode = "413", description = "본문 128 KiB 또는 100건 초과: TELEMETRY_BATCH_TOO_LARGE",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	public BatchAccepted post(@Parameter(hidden = true) AuthUser me, HttpServletRequest request) throws IOException {
		var batch = json.read(request.getInputStream(), request.getContentLengthLong());
		validator.validate(batch);
		return new BatchAccepted(batches.save(me.id(), batch));
	}

	@GetMapping("/sessions")
	@Operation(summary = "세션 목록",
			description = "(userId, sessionId)별 기간·건수. 이벤트 time 기준 [from, to] 양끝 포함, 기본은 지금까지 최근 7일, 최대 31일. "
					+ "lastEventTime 내림차순. 기간 밖 이벤트는 세지 않는다.")
	public PageResponse<SessionSummary> sessions(
			@Parameter(description = "ISO-8601. 생략 시 to − 7일") @RequestParam(required = false) Instant from,
			@Parameter(description = "ISO-8601. 생략 시 지금") @RequestParam(required = false) Instant to,
			@Parameter(description = "특정 회원만") @RequestParam(required = false) @Min(1) Long userId,
			@RequestParam(defaultValue = "0") @Min(0) int page,
			@RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
		return queries.sessions(from, to, userId, page, size);
	}

	@GetMapping("/sessions/{sessionId}/events")
	@Operation(summary = "세션 이벤트",
			description = "저장값 그대로 time 오름차순(같은 시각은 stickId 0·1·null). 같은 sessionId도 회원별로 분리하므로 userId가 필요하다. "
					+ "없는 세션은 빈 페이지.")
	public PageResponse<EventItem> events(@PathVariable UUID sessionId,
			@Parameter(description = "세션 목록의 userId") @RequestParam @Min(1) long userId,
			@RequestParam(required = false) Kind kind,
			@RequestParam(defaultValue = "0") @Min(0) int page,
			@RequestParam(defaultValue = "500") @Min(1) @Max(1000) int size) {
		return queries.events(userId, sessionId, kind, page, size);
	}

}
