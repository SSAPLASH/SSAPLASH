package com.ssafy.airdrum.global.validation;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

/**
 * {@code JsonNode} 값이 JSON 객체이고 UTF-8 직렬화 길이가 {@link #maxBytes()} 이하인지 검사한다.
 * 내용(필드·스키마)은 보지 않는다. null과 JSON {@code null}은 통과시키므로 필수 여부는 {@code @NotNull}로 따로 건다.
 */
@Documented
@Constraint(validatedBy = JsonObjectValidator.class)
@Target({ ElementType.FIELD, ElementType.PARAMETER, ElementType.RECORD_COMPONENT, ElementType.METHOD })
@Retention(RetentionPolicy.RUNTIME)
public @interface JsonObject {

	String message() default "JSON 객체여야 합니다";

	/** 직렬화 길이 상한(바이트). 기본 16 KiB. */
	int maxBytes() default 16 * 1024;

	Class<?>[] groups() default {};

	Class<? extends Payload>[] payload() default {};

}
