package com.ssafy.airdrum.global.validation;

import jakarta.validation.Validation;
import jakarta.validation.Validator;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.NullNode;

import static org.assertj.core.api.Assertions.assertThat;

/** 설계 문서(90) 4-G: JSON 객체만 통과하고 직렬화 길이 상한을 넘으면 실패한다. null은 이 제약이 판단하지 않는다. */
class JsonObjectValidatorTest {

	private static jakarta.validation.ValidatorFactory factory;
	private static Validator validator;
	private final JsonMapper json = new JsonMapper();

	record Holder(@JsonObject(maxBytes = 32) JsonNode value) {}

	@BeforeAll
	static void start() {
		factory = Validation.buildDefaultValidatorFactory();
		validator = factory.getValidator();
	}

	@AfterAll
	static void stop() {
		factory.close();
	}

	@Test
	void objectsPass() {
		assertThat(validator.validate(new Holder(json.readTree("{}")))).isEmpty();
		assertThat(validator.validate(new Holder(json.readTree("{\"a\":{\"b\":[1,2]}}")))).isEmpty();
	}

	@Test
	void nullIsLeftToNotNull() {
		assertThat(validator.validate(new Holder(null))).isEmpty();
		assertThat(validator.validate(new Holder(NullNode.getInstance()))).isEmpty();
	}

	@Test
	void nonObjectsFail() {
		for (var raw : new String[] { "[]", "\"x\"", "1", "true" }) {
			var violations = validator.validate(new Holder(json.readTree(raw)));
			assertThat(violations).as(raw).hasSize(1);
			assertThat(violations.iterator().next().getMessage()).isEqualTo("JSON 객체여야 합니다");
		}
	}

	@Test
	void sizeIsMeasuredInUtf8Bytes() {
		// {"k":"..."} = 8바이트 + 값. 한글은 3바이트.
		assertThat(validator.validate(new Holder(json.readTree("{\"k\":\"" + "a".repeat(24) + "\"}")))).isEmpty();
		var tooBig = validator.validate(new Holder(json.readTree("{\"k\":\"" + "a".repeat(25) + "\"}")));
		assertThat(tooBig).hasSize(1);
		assertThat(tooBig.iterator().next().getMessage()).isEqualTo("32바이트 이하여야 합니다");
		assertThat(validator.validate(new Holder(json.readTree("{\"k\":\"" + "가".repeat(9) + "\"}")))).hasSize(1);
	}

}
