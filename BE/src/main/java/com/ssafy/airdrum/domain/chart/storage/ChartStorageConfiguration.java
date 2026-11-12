package com.ssafy.airdrum.domain.chart.storage;

import java.net.URI;
import java.time.Duration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import com.ssafy.airdrum.domain.chart.exception.ChartErrorCode;
import com.ssafy.airdrum.global.error.BusinessException;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(ChartStorageProperties.class)
public class ChartStorageConfiguration {
	@Bean
	@ConditionalOnProperty(prefix = "chart.assets", name = "enabled", havingValue = "false", matchIfMissing = true)
	ChartAssetStore unavailableChartAssetStore() {
		return (kind, key) -> { throw new BusinessException(ChartErrorCode.CHART_ASSET_UNAVAILABLE); };
	}

	@Configuration(proxyBeanMethods = false)
	@ConditionalOnProperty(prefix = "chart.assets", name = "enabled", havingValue = "true")
	public static class Enabled {
		@Bean(destroyMethod = "close")
		public S3Client chartS3Client(ChartStorageProperties p) {
			validate(p);
			return S3Client.builder().endpointOverride(p.endpoint()).region(Region.of(p.region()))
					.credentialsProvider(credentials(p)).forcePathStyle(true)
					.httpClientBuilder(UrlConnectionHttpClient.builder().connectionTimeout(Duration.ofSeconds(2))
							.socketTimeout(Duration.ofSeconds(3)))
					.overrideConfiguration(c -> c.apiCallTimeout(Duration.ofSeconds(5)).apiCallAttemptTimeout(Duration.ofSeconds(3)))
					.build();
		}
		@Bean(destroyMethod = "close")
		S3Presigner chartS3Presigner(ChartStorageProperties p) {
			validate(p);
			return S3Presigner.builder().endpointOverride(p.publicEndpoint()).region(Region.of(p.region()))
					.credentialsProvider(credentials(p))
					.serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).checksumValidationEnabled(false).build())
					.build();
		}
		@Bean
		ChartAssetStore chartAssetStore(S3Client client, S3Presigner presigner, ChartStorageProperties p) {
			return new S3ChartAssetStore(client, presigner, p);
		}
	}
	private static StaticCredentialsProvider credentials(ChartStorageProperties p) {
		return StaticCredentialsProvider.create(AwsBasicCredentials.create(p.accessKey(), p.secretKey()));
	}
	private static void validate(ChartStorageProperties p) {
		if (!endpoint(p.endpoint()) || !endpoint(p.publicEndpoint()) || blank(p.sheetBucket()) || blank(p.accompanimentBucket())
				|| blank(p.region()) || blank(p.accessKey()) || blank(p.secretKey()) || p.urlTtl() == null
				|| p.urlTtl().compareTo(Duration.ofMinutes(1)) < 0 || p.urlTtl().compareTo(Duration.ofMinutes(10)) > 0) {
			throw new IllegalStateException("chart.assets 활성화에는 내부/공개 endpoint·region·버킷·접근 키와 1~10분 TTL이 필요합니다.");
		}
	}
	private static boolean endpoint(URI uri) {
		return uri != null && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))
				&& uri.getHost() != null && uri.getRawUserInfo() == null && uri.getRawQuery() == null && uri.getRawFragment() == null;
	}
	private static boolean blank(String value) { return value == null || value.isBlank(); }
}
