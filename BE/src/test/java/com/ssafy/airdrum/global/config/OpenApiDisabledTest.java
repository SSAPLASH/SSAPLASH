package com.ssafy.airdrum.global.config;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;

import com.ssafy.airdrum.support.HttpProbe;

import static org.assertj.core.api.Assertions.assertThat;

/** SWAGGER_ENABLED=false 이면 문서와 UI 모두 닫힌다. 운영 환경 토글 검증. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "SWAGGER_ENABLED=false")
class OpenApiDisabledTest {

	@Value("${local.server.port}")
	private int port;

	@Test
	void apiDocsIsHiddenWhenDisabled() throws Exception {
		assertThat(HttpProbe.get(port, "/v3/api-docs").statusCode()).isEqualTo(404);
	}

	@Test
	void swaggerUiIsHiddenWhenDisabled() throws Exception {
		assertThat(HttpProbe.get(port, "/swagger-ui/index.html").statusCode()).isEqualTo(404);
	}

}
