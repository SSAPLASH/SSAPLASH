package com.ssafy.airdrum.domain.preset.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import io.swagger.v3.oas.annotations.media.Schema;
import tools.jackson.databind.JsonNode;

import com.ssafy.airdrum.global.validation.JsonObject;

/**
 * 프리셋 생성·수정 본문(설계 문서(90) 3-2). 두 JSON은 FE 형식이며 서버는 객체인지와 크기만 본다.
 *
 * <p>JSON {@code null}은 Jackson이 {@code NullNode}로 넣으므로 생성자에서 Java null로 바꾼다. 그래야 {@code @NotNull}이
 * 걸린다. 이름은 앞뒤 공백을 잘라 검증·저장한다. 옛 FE 빌드가 보내던 {@code calibration}은 모르는 필드라 무시된다(128).
 */
public record PresetRequest(
		@Schema(description = "프리셋 이름(앞뒤 공백 제거 후 1~50자, 내 프리셋끼리 중복 불가)", example = "연습용")
		@NotBlank @Size(max = 50) String name,
		@Schema(type = "object", description = "패드 배치. FE KitLayout 객체 그대로",
				example = "{\"SNARE\":{\"x\":0.42,\"y\":0.68,\"r\":0.095}}")
		@NotNull @JsonObject JsonNode layout,
		@Schema(type = "object", description = "사운드 설정. 1단계는 {\"soundSetId\":\"ssaplash\"}",
				example = "{\"soundSetId\":\"ssaplash\"}")
		@NotNull @JsonObject JsonNode sounds,
		@Schema(description = "layout·sounds 형식 버전. 없으면 1", example = "1", nullable = true)
		@Min(1) Integer schemaVersion) {

	public PresetRequest {
		name = name == null ? null : name.strip();
		layout = orNull(layout);
		sounds = orNull(sounds);
	}

	/** 저장할 형식 버전. 누락이면 1. */
	public int schemaVersionOrDefault() {
		return schemaVersion == null ? 1 : schemaVersion;
	}

	private static JsonNode orNull(JsonNode node) {
		return node == null || node.isNull() ? null : node;
	}

}
