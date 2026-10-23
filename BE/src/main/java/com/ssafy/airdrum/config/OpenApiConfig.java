package com.ssafy.airdrum.config;

import java.util.List;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.media.ArraySchema;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.IntegerSchema;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.ObjectSchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.media.StringSchema;
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.responses.ApiResponses;
import io.swagger.v3.oas.models.security.SecurityScheme;

import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.info.BuildProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.ssafy.airdrum.common.error.ApiErrorResponse;
import com.ssafy.airdrum.common.error.FieldErrorDetail;

/**
 * OpenAPI 문서 메타·보안 스킴·공통 오류 응답.
 *
 * <p>오류 스키마는 {@link ApiErrorResponse} 레코드와 같은 필드로 직접 정의한다. 모든 operation에 400·500 응답을
 * 붙이므로 각 기능 작업은 401·403·404·409처럼 그 API에만 해당하는 응답만 {@code @ApiResponse}로 적으면 된다.
 * 보호 API는 {@code @SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)}로 표시한다(-88).
 */
@Configuration(proxyBeanMethods = false)
public class OpenApiConfig {

	public static final String BEARER_AUTH = "bearerAuth";

	static final String PROBLEM_JSON = org.springframework.http.MediaType.APPLICATION_PROBLEM_JSON_VALUE;
	static final String API_ERROR_SCHEMA = ApiErrorResponse.class.getSimpleName();
	static final String FIELD_ERROR_SCHEMA = FieldErrorDetail.class.getSimpleName();

	@Bean
	OpenAPI airDrumOpenApi(ObjectProvider<BuildProperties> buildProperties) {
		var build = buildProperties.getIfAvailable();
		var version = build != null ? build.getVersion() : "unknown";
		return new OpenAPI()
				.info(new Info()
						.title("Air Drum API")
						.version(version)
						.description("에어 드럼 서비스 API. 오류 응답은 application/problem+json(RFC 9457)에 "
								+ "code·errors 필드를 더한 형식이며, code로 분기한다."))
				.components(new Components()
						.addSecuritySchemes(BEARER_AUTH, new SecurityScheme()
								.type(SecurityScheme.Type.HTTP)
								.scheme("bearer")
								.bearerFormat("JWT")
								.description("Authorization: Bearer {accessToken}")));
	}

	/** 오류 스키마를 등록하고 모든 operation에 400·500 응답을 더한다. 이미 적힌 응답은 덮어쓰지 않는다. */
	@Bean
	OpenApiCustomizer commonErrorResponsesCustomizer() {
		return openApi -> {
			if (openApi.getComponents() == null) {
				openApi.setComponents(new Components());
			}
			var components = openApi.getComponents();
			if (components.getSchemas() == null || !components.getSchemas().containsKey(FIELD_ERROR_SCHEMA)) {
				components.addSchemas(FIELD_ERROR_SCHEMA, fieldErrorSchema());
			}
			if (!components.getSchemas().containsKey(API_ERROR_SCHEMA)) {
				components.addSchemas(API_ERROR_SCHEMA, apiErrorSchema());
			}
			if (openApi.getPaths() == null) {
				return;
			}
			openApi.getPaths().values().forEach(pathItem -> pathItem.readOperations().forEach(operation -> {
				if (operation.getResponses() == null) {
					operation.setResponses(new ApiResponses());
				}
				operation.getResponses().putIfAbsent("400", problemResponse("잘못된 요청 또는 입력값 검증 실패"));
				operation.getResponses().putIfAbsent("500", problemResponse("서버 오류"));
			}));
		};
	}

	private static ApiResponse problemResponse(String description) {
		return new ApiResponse()
				.description(description)
				.content(new Content().addMediaType(PROBLEM_JSON,
						new MediaType().schema(new Schema<>().$ref("#/components/schemas/" + API_ERROR_SCHEMA))));
	}

	private static Schema<?> apiErrorSchema() {
		var schema = new ObjectSchema();
		schema.description("오류 응답. RFC 9457 Problem Details + code·errors 확장 필드");
		schema.addProperty("type", new StringSchema().description("고정 about:blank").example("about:blank"));
		schema.addProperty("title", new StringSchema().description("오류 코드의 한국어 제목").example("입력값 검증 실패"));
		schema.addProperty("status", new IntegerSchema().description("HTTP 상태 코드와 같은 값").example(400));
		schema.addProperty("detail", new StringSchema().description("사람이 읽는 한국어 설명").example("입력값을 확인해 주세요."));
		schema.addProperty("instance", new StringSchema().description("요청 경로(쿼리 문자열 제외)").example("/api/presets"));
		schema.addProperty("code", new StringSchema().description("기계 판별용 코드(UPPER_SNAKE)").example("VALIDATION_FAILED"));
		schema.addProperty("errors", new ArraySchema()
				.items(new Schema<>().$ref("#/components/schemas/" + FIELD_ERROR_SCHEMA))
				.description("검증 실패 목록. 검증 실패일 때만 있다"));
		schema.required(List.of("type", "title", "status", "detail", "instance", "code"));
		return schema;
	}

	private static Schema<?> fieldErrorSchema() {
		var schema = new ObjectSchema();
		schema.description("검증 실패 항목");
		schema.addProperty("field", new StringSchema().description("필드 경로 또는 파라미터 이름").example("pads[2].key"));
		schema.addProperty("message", new StringSchema().description("제약 메시지(한국어)").example("공백일 수 없습니다"));
		schema.required(List.of("field", "message"));
		return schema;
	}

}
