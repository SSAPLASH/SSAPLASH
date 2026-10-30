package com.ssafy.airdrum.support;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * 실제 포트로 띄운 서버에 요청을 보내는 테스트 보조 도구.
 * 기존 AirDrumApiApplicationTests와 같은 방식(JDK HttpClient)을 쓴다.
 */
public final class HttpProbe {

	private HttpProbe() {
	}

	public static HttpResponse<String> get(int port, String path) throws Exception {
		try (var client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()) {
			var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
					.timeout(Duration.ofSeconds(5))
					.GET()
					.build();
			return client.send(request, HttpResponse.BodyHandlers.ofString());
		}
	}

}
