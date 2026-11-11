package com.ssafy.airdrum.global.error;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

/** Security 필터(87·88번)가 쓰는 작성기가 전역 핸들러와 같은 형식을 내는지 확인한다. */
class ErrorResponseWriterTest {

	private final JsonMapper mapper = new JsonMapper();
	private final ErrorResponseWriter writer = new ErrorResponseWriter(mapper);

	@Test
	void writesProblemJsonWithStatusAndFields() throws Exception {
		var response = new MockHttpServletResponse();

		writer.write(response, CommonErrorCode.UNAUTHORIZED, "토큰이 없습니다.", "/api/me");

		assertThat(response.getStatus()).isEqualTo(401);
		assertThat(response.getContentType()).startsWith("application/problem+json");
		assertThat(response.getCharacterEncoding()).isEqualToIgnoringCase("UTF-8");

		var json = mapper.readTree(response.getContentAsString());
		assertThat(json.path("type").asString()).isEqualTo("about:blank");
		assertThat(json.path("title").asString()).isEqualTo(CommonErrorCode.UNAUTHORIZED.title());
		assertThat(json.path("status").asInt()).isEqualTo(401);
		assertThat(json.path("detail").asString()).isEqualTo("토큰이 없습니다.");
		assertThat(json.path("instance").asString()).isEqualTo("/api/me");
		assertThat(json.path("code").asString()).isEqualTo("UNAUTHORIZED");
		assertThat(json.has("errors")).isFalse();
	}

	@Test
	void usesTitleWhenDetailMissing() throws Exception {
		var response = new MockHttpServletResponse();

		writer.write(response, CommonErrorCode.FORBIDDEN, null, "/api/songs/3");

		assertThat(response.getStatus()).isEqualTo(403);
		var json = mapper.readTree(response.getContentAsString());
		assertThat(json.path("detail").asString()).isEqualTo(CommonErrorCode.FORBIDDEN.title());
		assertThat(json.path("code").asString()).isEqualTo("FORBIDDEN");
	}

}
