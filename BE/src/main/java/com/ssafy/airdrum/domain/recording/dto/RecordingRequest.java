package com.ssafy.airdrum.domain.recording.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonInclude;

import io.swagger.v3.oas.annotations.media.Schema;

import com.ssafy.airdrum.domain.play.dto.PlayUploadRequest.InputSource;
import com.ssafy.airdrum.domain.play.dto.PlayUploadRequest.Mode;
import com.ssafy.airdrum.domain.play.dto.PlayUploadRequest.Pad;

/**
 * 녹음 저장 요청 schemaVersion 1(256번 설계 3-2절). 필수 여부는 {@link RecordingValidator}가 검사한다.
 * 모드·입력원·패드 코드는 플레이 로그 계약과 같다.
 */
@Schema(description = "녹음 저장 요청")
public record RecordingRequest(
		@Schema(description = "1", requiredMode = Schema.RequiredMode.REQUIRED) Integer schemaVersion,
		@Schema(description = "녹음 시작 때 만든 UUID. 재전송 때 유지", requiredMode = Schema.RequiredMode.REQUIRED) UUID clientKey,
		@Schema(description = "1~100자, 앞뒤 공백 제거", requiredMode = Schema.RequiredMode.REQUIRED) String title,
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED) Mode mode,
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED) InputSource inputSource,
		@Schema(description = "연결할 본인 플레이 ID, 없으면 null") UUID playId,
		@Schema(description = "ISO-8601 시각 문자열", requiredMode = Schema.RequiredMode.REQUIRED) Instant startedAt,
		@Schema(description = "녹음 길이 ms, 0~7200000, 마지막 tMs 이상", requiredMode = Schema.RequiredMode.REQUIRED) Integer durationMs,
		@Schema(description = "타격 1~50000개. 순서는 자유이며 서버가 tMs로 안정 정렬한다", requiredMode = Schema.RequiredMode.REQUIRED) List<Hit> hits) {

	/** 저장·해시에서 빠진 stickId는 null과 같게 다루려고 null을 쓰지 않는다. */
	@JsonInclude(JsonInclude.Include.NON_NULL)
	@Schema(description = "타격 하나")
	public record Hit(
			@Schema(description = "녹음 시작 기준 ms, 0 이상", requiredMode = Schema.RequiredMode.REQUIRED) Double tMs,
			@Schema(description = "HI_TOM은 SMALL_TOM으로 저장", requiredMode = Schema.RequiredMode.REQUIRED) Pad pad,
			@Schema(description = "0~127", requiredMode = Schema.RequiredMode.REQUIRED) Integer velocity,
			@Schema(description = "0 왼손, 1 오른손. 키보드·비센서 입력은 생략") Integer stickId) {
	}
}
