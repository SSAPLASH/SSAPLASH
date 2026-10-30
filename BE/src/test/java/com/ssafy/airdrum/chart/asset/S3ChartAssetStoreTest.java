package com.ssafy.airdrum.chart.asset;

import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import com.ssafy.airdrum.chart.ChartErrorCode;
import com.ssafy.airdrum.common.error.BusinessException;
import static org.assertj.core.api.Assertions.*;

/** SDK는 실제 사용하고 HEAD 응답만 로컬 HTTP 서버로 제공한다. 실제 SeaweedFS 검증과는 다르다. */
class S3ChartAssetStoreTest {
	HttpServer server;
	S3Client client;
	S3Presigner presigner;
	S3ChartAssetStore store;
	final AtomicInteger status = new AtomicInteger(200);
	final AtomicReference<String> request = new AtomicReference<>();
	final AtomicReference<String> authorization = new AtomicReference<>();
	@BeforeEach void start() throws Exception {
		server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
		server.createContext("/", exchange -> {
			request.set(exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath());
			authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
			exchange.sendResponseHeaders(status.get(), -1);
			exchange.close();
		});
		server.start();
		var p = new ChartStorageProperties(true, URI.create("http://127.0.0.1:" + server.getAddress().getPort()),
				URI.create("https://assets.example.test"), "us-east-1", "sheets", "backing",
				"test-access-key", "test-secret-key-not-real", Duration.ofMinutes(10));
		var config = new ChartStorageConfiguration.Enabled();
		client = config.chartS3Client(p);
		presigner = config.chartS3Presigner(p);
		store = new S3ChartAssetStore(client, presigner, p);
	}
	@AfterEach void stop() {
		if (client != null) client.close();
		if (presigner != null) presigner.close();
		if (server != null) server.stop(0);
	}
	@Test void sdkChecksPrivateObjectAndSignsPublicGetWithExpiryAndNoStore() {
		Instant before = Instant.now();
		var signed = store.sign(ChartAssetStore.Kind.SHEET, "sheet/10/1.png");
		assertThat(request.get()).isEqualTo("HEAD /sheets/sheet/10/1.png");
		assertThat(authorization.get()).startsWith("AWS4-HMAC-SHA256 ");
		var uri = URI.create(signed.url());
		assertThat(uri.getHost()).isEqualTo("assets.example.test");
		assertThat(uri.getPath()).isEqualTo("/sheets/sheet/10/1.png");
		assertThat(URLDecoder.decode(uri.getRawQuery(), StandardCharsets.UTF_8))
				.contains("X-Amz-Expires=600", "X-Amz-Signature=", "response-cache-control=private, no-store",
						"response-content-disposition=inline", "X-Amz-SignedHeaders=host")
				.doesNotContain("test-secret-key-not-real");
		assertThat(signed.expiresAt()).isBetween(before.plusSeconds(599), Instant.now().plusSeconds(601));
		store.sign(ChartAssetStore.Kind.ACCOMPANIMENT, "accompaniment/20.wav");
		assertThat(request.get()).isEqualTo("HEAD /backing/accompaniment/20.wav");
	}
	@Test void missingObjectAndDeniedStorageHaveDifferentSafeErrors() {
		status.set(404);
		assertThatThrownBy(() -> store.sign(ChartAssetStore.Kind.SHEET, "sheet/10/1.png"))
				.isInstanceOfSatisfying(BusinessException.class,
						ex -> assertThat(ex.getErrorCode()).isEqualTo(ChartErrorCode.CHART_ASSET_NOT_FOUND));
		status.set(403);
		assertThatThrownBy(() -> store.sign(ChartAssetStore.Kind.SHEET, "sheet/10/1.png"))
				.isInstanceOfSatisfying(BusinessException.class, ex -> {
					assertThat(ex.getErrorCode()).isEqualTo(ChartErrorCode.CHART_ASSET_UNAVAILABLE);
					assertThat(ex.getMessage()).doesNotContain("sheet/", "127.0.0.1", "test-access");
				});
	}
	@Test void disabledStorageFailsClosedAndEnabledConfigurationRequiresCredentials() {
		new ApplicationContextRunner().withUserConfiguration(ChartStorageConfiguration.class).run(context -> {
			assertThat(context).hasNotFailed().hasSingleBean(ChartAssetStore.class).doesNotHaveBean(S3Client.class);
			assertThatThrownBy(() -> context.getBean(ChartAssetStore.class).sign(ChartAssetStore.Kind.SHEET, "sheet/1/1.png"))
					.isInstanceOfSatisfying(BusinessException.class,
							ex -> assertThat(ex.getErrorCode()).isEqualTo(ChartErrorCode.CHART_ASSET_UNAVAILABLE));
		});
		new ApplicationContextRunner().withUserConfiguration(ChartStorageConfiguration.class)
				.withPropertyValues("chart.assets.enabled=true").run(context -> assertThat(context).hasFailed());
	}
}
