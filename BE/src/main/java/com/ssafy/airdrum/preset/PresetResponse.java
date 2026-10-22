package com.ssafy.airdrum.preset;

import java.time.Instant;

import com.fasterxml.jackson.annotation.JsonProperty;

import io.swagger.v3.oas.annotations.media.Schema;
import tools.jackson.databind.JsonNode;

/** 프리셋 응답(설계 문서(90) 3-3). 소유자 id는 내보내지 않는다. 없는 캘리브레이션은 null로 낸다. */
public record PresetResponse(
		@Schema(description = "프리셋 ID") Long id,
		@Schema(description = "이름") String name,
		@Schema(description = "로그인 시 자동 적용할 기본 프리셋이면 true. 목록에서 최대 1개")
		@JsonProperty("isDefault") boolean isDefault,
		@Schema(type = "object", description = "패드 배치") JsonNode layout,
		@Schema(type = "object", description = "사운드 설정") JsonNode sounds,
		@Schema(type = "object", nullable = true, description = "센서 캘리브레이션. 없으면 null") JsonNode calibration,
		@Schema(description = "형식 버전") int schemaVersion,
		@Schema(description = "생성 시각(UTC)") Instant createdAt,
		@Schema(description = "수정 시각(UTC)") Instant updatedAt) {
}
