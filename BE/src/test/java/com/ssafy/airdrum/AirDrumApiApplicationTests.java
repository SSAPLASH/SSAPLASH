package com.ssafy.airdrum;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.actuate.endpoint.web.PathMappedEndpoints;
import org.springframework.boot.health.actuate.endpoint.HealthEndpointGroups;
import org.springframework.boot.test.context.SpringBootTest;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AirDrumApiApplicationTests {

	@Value("${local.server.port}")
	private int port;

	@Autowired
	private HealthEndpointGroups healthGroups;

	@Autowired
	private PathMappedEndpoints endpoints;

	@ParameterizedTest
	@ValueSource(strings = {"/actuator/health", "/actuator/health/liveness", "/actuator/health/readiness"})
	void healthEndpointsReportUpWithoutDetails(String path) throws Exception {
		var response = get(path);
		assertThat(response.statusCode()).isEqualTo(200);
		var body = new JsonMapper().readTree(response.body());
		assertThat(body.path("status").asString()).isEqualTo("UP");
		assertThat(body.has("components")).isFalse();
		assertThat(body.has("details")).isFalse();
	}

	/** 설계 문서 U5: DB에 못 붙으면 요청을 받을 준비가 안 된 것으로 본다. 프로세스 생존(liveness)은 DB와 무관하다. */
	@Test
	void readinessIncludesDatabaseButLivenessDoesNot() {
		assertThat(healthGroups.get("readiness").isMember("db")).isTrue();
		assertThat(healthGroups.get("liveness").isMember("db")).isFalse();
	}

	/** 88번부터 health 외 관리 경로는 인증이 먼저 막는다(401). 노출 자체가 없다는 것은 아래 테스트가 본다. */
	@ParameterizedTest
	@ValueSource(strings = {"/actuator", "/actuator/env", "/actuator/configprops", "/actuator/beans"})
	void internalManagementEndpointsAreNotReachable(String path) throws Exception {
		var response = get(path);
		assertThat(response.statusCode()).isEqualTo(401);
		assertThat(response.body()).contains("\"code\":\"UNAUTHORIZED\"").doesNotContain("propertySources");
	}

	@Test
	void onlyHealthEndpointIsExposed() {
		assertThat(endpoints.getAllPaths()).containsExactly("/actuator/health");
	}

	private HttpResponse<String> get(String path) throws Exception {
		try (var client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()) {
			var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
					.timeout(Duration.ofSeconds(5))
					.GET()
					.build();
			return client.send(request, HttpResponse.BodyHandlers.ofString());
		}
	}

}
