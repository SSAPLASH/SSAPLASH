package com.ssafy.airdrum.common.validation;

import java.nio.charset.StandardCharsets;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

import tools.jackson.databind.JsonNode;

/** {@link JsonObject} 구현. 크기 초과는 상한을 담은 별도 문구로 낸다. */
public class JsonObjectValidator implements ConstraintValidator<JsonObject, JsonNode> {

	private int maxBytes;

	@Override
	public void initialize(JsonObject annotation) {
		this.maxBytes = annotation.maxBytes();
	}

	@Override
	public boolean isValid(JsonNode value, ConstraintValidatorContext context) {
		if (value == null || value.isNull()) {
			return true;
		}
		if (!value.isObject()) {
			return false;
		}
		if (value.toString().getBytes(StandardCharsets.UTF_8).length <= maxBytes) {
			return true;
		}
		context.disableDefaultConstraintViolation();
		context.buildConstraintViolationWithTemplate(sizeMessage()).addConstraintViolation();
		return false;
	}

	private String sizeMessage() {
		return maxBytes % 1024 == 0 ? (maxBytes / 1024) + " KiB 이하여야 합니다" : maxBytes + "바이트 이하여야 합니다";
	}

}
