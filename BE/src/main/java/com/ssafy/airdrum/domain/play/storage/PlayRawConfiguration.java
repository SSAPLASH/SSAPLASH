package com.ssafy.airdrum.domain.play.storage;

import java.time.Duration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.core.retry.RetryPolicy;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.domain.play.exception.PlayErrorCode;

@Configuration(proxyBeanMethods = false)
@EnableScheduling
@EnableConfigurationProperties(PlayRawProperties.class)
public class PlayRawConfiguration {
	@Bean
	@ConditionalOnProperty(prefix="play.raw", name="enabled", havingValue="false", matchIfMissing=true)
	PlayRawStore unavailablePlayRawStore() {
		return new PlayRawStore() {
			public void checkAvailable() { throw new BusinessException(PlayErrorCode.PLAY_RAW_STORAGE_UNAVAILABLE); }
			public void put(String k,long n,java.util.function.Supplier<java.io.InputStream> s) { checkAvailable(); }
			public boolean exists(String k) { checkAvailable(); return false; }
			public void delete(String k) { checkAvailable(); }
		};
	}
	@Bean(destroyMethod="close")
	@ConditionalOnProperty(prefix="play.raw", name="enabled", havingValue="true")
	S3PlayRawStore s3PlayRawStore(PlayRawProperties p) {
		if(p.endpoint()==null || p.endpoint().getHost()==null || !java.util.Set.of("http","https").contains(p.endpoint().getScheme())
				|| p.endpoint().getUserInfo()!=null || p.endpoint().getQuery()!=null || p.endpoint().getFragment()!=null
				|| blank(p.bucket()) || blank(p.accessKey()) || blank(p.secretKey()) || blank(p.region()) || !p.privateBucketConfirmed())
			throw new IllegalStateException("play.raw에는 비공개 비버전 bucket·endpoint·region·접근 키 설정이 필요합니다.");
		var client=S3Client.builder().endpointOverride(p.endpoint()).region(Region.of(p.region())).forcePathStyle(true)
				.credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(p.accessKey(),p.secretKey())))
				.httpClientBuilder(UrlConnectionHttpClient.builder().connectionTimeout(Duration.ofSeconds(3)).socketTimeout(Duration.ofSeconds(60)))
				.overrideConfiguration(c -> c.apiCallTimeout(Duration.ofSeconds(60)).apiCallAttemptTimeout(Duration.ofSeconds(60)).retryPolicy(RetryPolicy.none()))
				.build();
		return new S3PlayRawStore(client,p.bucket());
	}
	private static boolean blank(String s) { return s==null || s.isBlank(); }
}
