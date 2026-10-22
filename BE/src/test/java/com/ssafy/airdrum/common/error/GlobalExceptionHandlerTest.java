package com.ssafy.airdrum.common.error;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import com.ssafy.airdrum.play.raw.PlayRawProperties;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 설계 문서 3-6·3-8과 인수 조건 1~6: 모든 오류가 같은 형식으로 나가고 로그 규칙을 지키는지 확인한다.
 * 오류 형식만 보는 슬라이스라 Security 필터는 뺀다. 인증 오류(401·403)는 auth.SecurityConfigTest가 본다.
 */
@WebMvcTest(controllers = ErrorProbeController.class)
@AutoConfigureMockMvc(addFilters = false)
@EnableConfigurationProperties(PlayRawProperties.class)
@Import(ErrorResponseWriter.class)
@ExtendWith(OutputCaptureExtension.class)
class GlobalExceptionHandlerTest {

	@Autowired
	private MockMvc mockMvc;

	private final JsonMapper mapper = new JsonMapper();

	@Test
	void domainBusinessExceptionUsesItsCodeStatusAndDetail(CapturedOutput output) throws Exception {
		var result = mockMvc.perform(get("/probe/business/domain")).andReturn();

		assertProblem(result, 404, "PROBE_NOT_FOUND", "/probe/business/domain");
		var body = body(result);
		assertThat(body.path("title").asString()).isEqualTo("프로브 없음");
		assertThat(body.path("detail").asString()).isEqualTo("프로브 7이 없습니다.");
		assertThat(body.has("errors")).isFalse();

		// 4xx: WARN 한 줄, 스택 없음
		assertThat(output.getOut()).contains("WARN").contains("PROBE_NOT_FOUND");
		assertThat(output.getOut()).doesNotContain("BusinessException");
	}

	@Test
	void commonBusinessExceptionFallsBackToTitleAsDetail() throws Exception {
		var result = mockMvc.perform(get("/probe/business/common")).andReturn();

		assertProblem(result, 409, "CONFLICT", "/probe/business/common");
		assertThat(body(result).path("detail").asString()).isEqualTo(CommonErrorCode.CONFLICT.title());
	}

	@Test
	void bodyValidationFailureListsFieldsWithoutRejectedValues() throws Exception {
		var result = mockMvc.perform(post("/probe/valid")
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"name\":\"\",\"size\":0}")).andReturn();

		assertProblem(result, 400, "VALIDATION_FAILED", "/probe/valid");
		var errors = body(result).path("errors");
		assertThat(errors.isArray()).isTrue();
		assertThat(errors.size()).isEqualTo(2);
		for (var error : errors) {
			assertThat(error.path("field").asString()).isIn("name", "size");
			assertThat(error.path("message").asString()).matches(".*[가-힣].*");
			assertThat(error.has("rejectedValue")).isFalse();
		}
	}

	@Test
	void parameterConstraintFailureIsAlsoValidationFailed() throws Exception {
		var result = mockMvc.perform(get("/probe/range").param("value", "0")).andReturn();

		assertProblem(result, 400, "VALIDATION_FAILED", "/probe/range");
		var errors = body(result).path("errors");
		assertThat(errors.size()).isEqualTo(1);
		assertThat(errors.get(0).path("field").asString()).isEqualTo("value");
		assertThat(errors.get(0).path("message").asString()).matches(".*[가-힣].*");
	}

	@Test
	void malformedJsonBodyIsInvalidInput() throws Exception {
		var result = mockMvc.perform(post("/probe/valid")
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"name\":")).andReturn();

		assertProblem(result, 400, "INVALID_INPUT", "/probe/valid");
		assertThat(body(result).path("detail").asString()).isEqualTo("요청 본문을 읽을 수 없습니다.");
	}

	@Test
	void missingRequiredParameterIsInvalidInput() throws Exception {
		var result = mockMvc.perform(get("/probe/param")).andReturn();

		assertProblem(result, 400, "INVALID_INPUT", "/probe/param");
		assertThat(body(result).path("detail").asString()).contains("size");
	}

	@Test
	void parameterTypeMismatchIsInvalidInput() throws Exception {
		var result = mockMvc.perform(get("/probe/param").param("size", "abc")).andReturn();

		assertProblem(result, 400, "INVALID_INPUT", "/probe/param");
		assertThat(body(result).path("detail").asString()).contains("size");
	}

	@Test
	void unknownPathIsNotFound() throws Exception {
		var result = mockMvc.perform(get("/nope")).andReturn();

		assertProblem(result, 404, "NOT_FOUND", "/nope");
		assertThat(body(result).path("detail").asString()).isEqualTo("요청한 경로가 없습니다.");
	}

	@Test
	void unsupportedMethodIsMethodNotAllowed() throws Exception {
		var result = mockMvc.perform(post("/probe/boom")).andReturn();

		assertProblem(result, 405, "METHOD_NOT_ALLOWED", "/probe/boom");
		assertThat(body(result).path("detail").asString()).contains("GET");
	}

	@Test
	void unsupportedContentTypeIsUnsupportedMediaType() throws Exception {
		var result = mockMvc.perform(post("/probe/valid")
				.contentType(MediaType.TEXT_PLAIN)
				.content("name=a")).andReturn();

		assertProblem(result, 415, "UNSUPPORTED_MEDIA_TYPE", "/probe/valid");
	}

	@Test
	void springErrorResponseExceptionKeepsStatusAndReason() throws Exception {
		var result = mockMvc.perform(get("/probe/status")).andReturn();

		assertProblem(result, 409, "CONFLICT", "/probe/status");
		assertThat(body(result).path("detail").asString()).isEqualTo("이미 있음");
	}

	@Test
	void unexpectedExceptionIsInternalErrorWithoutLeakingDetails(CapturedOutput output) throws Exception {
		var result = mockMvc.perform(get("/probe/boom")).andReturn();

		assertProblem(result, 500, "INTERNAL_ERROR", "/probe/boom");
		var raw = result.getResponse().getContentAsString();
		assertThat(body(result).path("detail").asString()).isEqualTo("서버 내부 오류가 발생했습니다.");
		assertThat(raw).doesNotContain("비밀 내부 메시지").doesNotContain("IllegalStateException");

		// 5xx: ERROR 로그에 스택 1회
		assertThat(output.getOut()).contains("ERROR").contains("INTERNAL_ERROR");
		assertThat(output.getOut()).contains("IllegalStateException").contains("\tat ");
	}

	private void assertProblem(MvcResult result, int status, String code, String instance) throws Exception {
		assertThat(result.getResponse().getStatus()).isEqualTo(status);
		assertThat(result.getResponse().getContentType()).startsWith(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
		var body = body(result);
		assertThat(body.path("type").asString()).isEqualTo("about:blank");
		assertThat(body.path("title").asString()).matches(".*[가-힣].*");
		assertThat(body.path("status").asInt()).isEqualTo(status);
		assertThat(body.path("detail").asString()).isNotBlank();
		assertThat(body.path("instance").asString()).isEqualTo(instance);
		assertThat(body.path("code").asString()).isEqualTo(code);
	}

	private JsonNode body(MvcResult result) throws Exception {
		return mapper.readTree(result.getResponse().getContentAsString());
	}

}
