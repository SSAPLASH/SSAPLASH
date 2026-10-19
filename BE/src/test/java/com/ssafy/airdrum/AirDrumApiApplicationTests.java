package com.ssafy.airdrum;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AirDrumApiApplicationTests {

	@Value("${local.server.port}")
	private int port;

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

	@ParameterizedTest
	@ValueSource(strings = {"/actuator", "/actuator/env", "/actuator/configprops", "/actuator/beans"})
	void internalManagementEndpointsAreNotExposed(String path) throws Exception {
		assertThat(get(path).statusCode()).isEqualTo(404);
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
