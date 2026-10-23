package com.ssafy.airdrum.config;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;

import com.ssafy.airdrum.support.HttpProbe;

import static org.assertj.core.api.Assertions.assertThat;

/** 기본 설정(SWAGGER_ENABLED 미지정)에서 OpenAPI 문서와 Swagger UI가 열리는지 확인한다. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class OpenApiExposureTest {

	@Value("${local.server.port}")
	private int port;

	@Test
	void apiDocsIsServedByDefault() throws Exception {
		var response = HttpProbe.get(port, "/v3/api-docs");
		assertThat(response.statusCode()).isEqualTo(200);
		assertThat(response.headers().firstValue("Content-Type").orElse("")).contains("application/json");
	}

	@Test
	void swaggerUiIsServedByDefault() throws Exception {
		var response = HttpProbe.get(port, "/swagger-ui/index.html");
		assertThat(response.statusCode()).isEqualTo(200);
	}

}
