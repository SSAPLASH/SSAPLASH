package com.ssafy.airdrum.common.error;

import java.util.List;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

class ApiErrorResponseTest {

	private final JsonMapper mapper = new JsonMapper();

	@Test
	void fillsRfc9457FieldsFromErrorCode() {
		var response = ApiErrorResponse.of(CommonErrorCode.NOT_FOUND, "회원이 없습니다.", "/api/users/1");

		assertThat(response.type()).isEqualTo("about:blank");
		assertThat(response.title()).isEqualTo(CommonErrorCode.NOT_FOUND.title());
		assertThat(response.status()).isEqualTo(404);
		assertThat(response.detail()).isEqualTo("회원이 없습니다.");
		assertThat(response.instance()).isEqualTo("/api/users/1");
		assertThat(response.code()).isEqualTo("NOT_FOUND");
		assertThat(response.errors()).isNull();
	}

	@Test
	void detailFallsBackToTitleWhenMissing() {
		assertThat(ApiErrorResponse.of(CommonErrorCode.FORBIDDEN, null, "/x").detail())
				.isEqualTo(CommonErrorCode.FORBIDDEN.title());
		assertThat(ApiErrorResponse.of(CommonErrorCode.FORBIDDEN, "  ", "/x").detail())
				.isEqualTo(CommonErrorCode.FORBIDDEN.title());
	}

	@Test
	void serializesWithoutErrorsKeyWhenNoFieldErrors() {
		var json = mapper.readTree(mapper.writeValueAsString(
				ApiErrorResponse.of(CommonErrorCode.CONFLICT, "중복", "/x")));

		assertThat(json.has("errors")).isFalse();
		assertThat(json.path("type").asString()).isEqualTo("about:blank");
		assertThat(json.path("title").asString()).isEqualTo(CommonErrorCode.CONFLICT.title());
		assertThat(json.path("status").asInt()).isEqualTo(409);
		assertThat(json.path("detail").asString()).isEqualTo("중복");
		assertThat(json.path("instance").asString()).isEqualTo("/x");
		assertThat(json.path("code").asString()).isEqualTo("CONFLICT");
	}

	@Test
	void serializesFieldErrorsWhenPresent() {
		var errors = List.of(new FieldErrorDetail("name", "공백일 수 없습니다"), new FieldErrorDetail("pads[2].key", "필수입니다"));
		var json = mapper.readTree(mapper.writeValueAsString(
				ApiErrorResponse.of(CommonErrorCode.VALIDATION_FAILED, "입력값을 확인해 주세요.", "/x", errors)));

		assertThat(json.path("errors").size()).isEqualTo(2);
		assertThat(json.path("errors").get(1).path("field").asString()).isEqualTo("pads[2].key");
		assertThat(json.path("errors").get(1).path("message").asString()).isEqualTo("필수입니다");
		assertThat(json.path("errors").get(0).has("rejectedValue")).isFalse();
	}

}
