package com.ssafy.airdrum.global.config;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.support.HttpProbe;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 설계 3-9와 인수 조건 8: 문서 메타, bearerAuth 보안 스킴, 공통 오류 스키마·응답이 문서에 있는지 확인한다.
 * 테스트 소스의 ErrorProbeController가 함께 떠서 paths가 비어 있지 않다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class OpenApiConfigTest {

	@Value("${local.server.port}")
	private int port;

	private JsonNode document;

	@BeforeAll
	void loadDocument() throws Exception {
		var response = HttpProbe.get(port, "/v3/api-docs");
		assertThat(response.statusCode()).isEqualTo(200);
		document = new JsonMapper().readTree(response.body());
	}

	@Test
	void describesApiWithTitleAndBuildVersion() {
		assertThat(document.path("openapi").asString()).startsWith("3.");
		assertThat(document.path("info").path("title").asString()).isEqualTo("Air Drum API");
		assertThat(document.path("info").path("version").asString()).isNotBlank().isNotEqualTo("v0");
	}

	@Test
	void registersBearerAuthSchemeWithoutGlobalRequirement() {
		var scheme = document.path("components").path("securitySchemes").path("bearerAuth");
		assertThat(scheme.path("type").asString()).isEqualTo("http");
		assertThat(scheme.path("scheme").asString()).isEqualTo("bearer");
		assertThat(scheme.path("bearerFormat").asString()).isEqualTo("JWT");
		// 보호 API는 각 기능 작업이 @SecurityRequirement로 표시한다. 전역 requirement는 걸지 않는다.
		assertThat(document.has("security")).isFalse();
	}

	@Test
	void registersErrorSchemasWithRfc9457Fields() {
		var schemas = document.path("components").path("schemas");
		var properties = schemas.path("ApiErrorResponse").path("properties");
		assertThat(properties.isObject()).isTrue();
		for (var field : new String[] {"type", "title", "status", "detail", "instance", "code", "errors"}) {
			assertThat(properties.has(field)).as("ApiErrorResponse.%s", field).isTrue();
		}
		assertThat(schemas.path("FieldErrorDetail").path("properties").has("field")).isTrue();
		assertThat(schemas.path("FieldErrorDetail").path("properties").has("message")).isTrue();
	}

	@Test
	void everyOperationDocumentsCommonErrorResponses() {
		var paths = document.path("paths");
		assertThat(paths.isObject()).isTrue();
		assertThat(paths.size()).isGreaterThan(0);

		paths.properties().forEach(path -> path.getValue().properties().forEach(operation -> {
			var responses = operation.getValue().path("responses");
			for (var status : new String[] {"400", "500"}) {
				var content = responses.path(status).path("content").path("application/problem+json");
				assertThat(content.path("schema").path("$ref").asString())
						.as("%s %s -> %s", operation.getKey(), path.getKey(), status)
						.isEqualTo("#/components/schemas/ApiErrorResponse");
			}
		}));
	}

}
