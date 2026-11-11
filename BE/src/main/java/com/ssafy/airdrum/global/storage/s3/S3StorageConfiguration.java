package com.ssafy.airdrum.global.storage.s3;

import java.net.URI;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.*;
import software.amazon.awssdk.core.retry.RetryPolicy;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.*;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;


@Configuration(proxyBeanMethods = false)
public class S3StorageConfiguration {
    @Bean(destroyMethod = "close")
    public S3StorageResources storage(
            @Value("${audio.storage.enabled:false}") boolean audioEnabled,
            @Value("${audio.storage.endpoint:}") String audioEndpoint,
            @Value("${audio.storage.public-endpoint:${audio.storage.endpoint:}}") String audioPublic,
            @Value("${audio.storage.region:us-east-1}") String audioRegion,
            @Value("${audio.storage.bucket:}") String audioBucket,
            @Value("${audio.storage.access-key:}") String audioAccess,
            @Value("${audio.storage.secret-key:}") String audioSecret,
            @Value("${audio.storage.private-bucket-confirmed:false}") boolean audioPrivate,
            @Value("${chart.assets.enabled:false}") boolean chartEnabled,
            @Value("${chart.assets.endpoint:}") String chartEndpoint,
            @Value("${chart.assets.public-endpoint:}") String chartPublic,
            @Value("${chart.assets.region:us-east-1}") String chartRegion,
            @Value("${chart.assets.accompaniment-bucket:}") String chartBucket,
            @Value("${chart.assets.sheet-bucket:}") String sheetBucket,
            @Value("${chart.assets.access-key:}") String chartAccess,
            @Value("${chart.assets.secret-key:}") String chartSecret,
            @Value("${worker.storage.accompaniment-write-access-key:${audio.storage.access-key:}}") String chartWriteAccess,
            @Value("${worker.storage.accompaniment-write-secret-key:${audio.storage.secret-key:}}") String chartWriteSecret,
            @Value("${worker.storage.url-ttl:10m}") Duration ttl) {
        if (ttl.compareTo(Duration.ofMinutes(1)) < 0 || ttl.compareTo(Duration.ofMinutes(10)) > 0)
            throw new IllegalStateException("워커 URL 유효시간을 확인하세요.");
        if (audioEnabled) validate(audioEndpoint, audioPublic, audioRegion, audioBucket, audioAccess, audioSecret, audioPrivate);
        if (chartEnabled) validate(chartEndpoint, chartPublic, chartRegion, chartBucket, chartAccess, chartSecret, true);
        boolean chartWriterEnabled = chartEnabled && (!chartWriteAccess.isBlank() || !chartWriteSecret.isBlank());
        if (chartWriterEnabled) validate(chartEndpoint, chartPublic, chartRegion, chartBucket, chartWriteAccess, chartWriteSecret, true);
        return new S3StorageResources(audioEnabled ? client(audioEndpoint, audioRegion, audioAccess, audioSecret) : null,
                audioEnabled ? signer(audioPublic, audioRegion, audioAccess, audioSecret) : null, audioBucket,
                chartWriterEnabled ? client(chartEndpoint, chartRegion, chartWriteAccess, chartWriteSecret) : null,
                chartEnabled ? signer(chartPublic, chartRegion, chartAccess, chartSecret) : null, chartBucket,
                chartWriterEnabled && !sheetBucket.isBlank() ? client(chartEndpoint, chartRegion, chartWriteAccess, chartWriteSecret) : null,
                sheetBucket, ttl);
    }
    private static void validate(String endpoint, String publicEndpoint, String region, String bucket, String access, String secret, boolean confirmed) {
        if (!url(endpoint) || !url(publicEndpoint) || region.isBlank() || bucket.isBlank() || access.isBlank() || secret.isBlank() || !confirmed)
            throw new IllegalStateException("워커 저장소 설정을 확인하세요.");
    }
    private static boolean url(String value) {
        try { var u = URI.create(value); return ("http".equals(u.getScheme()) || "https".equals(u.getScheme())) && u.getHost() != null && u.getUserInfo() == null && u.getQuery() == null && u.getFragment() == null; }
        catch (IllegalArgumentException e) { return false; }
    }
    private static StaticCredentialsProvider credentials(String access, String secret) {
        return StaticCredentialsProvider.create(AwsBasicCredentials.create(access, secret));
    }
    private static S3Client client(String endpoint, String region, String access, String secret) {
        return S3Client.builder().endpointOverride(URI.create(endpoint)).region(Region.of(region))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).chunkedEncodingEnabled(false).build())
                .credentialsProvider(credentials(access, secret)).httpClientBuilder(UrlConnectionHttpClient.builder().connectionTimeout(Duration.ofSeconds(3)).socketTimeout(Duration.ofSeconds(60)))
                .overrideConfiguration(c -> c.apiCallTimeout(Duration.ofMinutes(2)).apiCallAttemptTimeout(Duration.ofMinutes(2)).retryPolicy(RetryPolicy.none())).build();
    }
    private static S3Presigner signer(String endpoint, String region, String access, String secret) {
        return S3Presigner.builder().endpointOverride(URI.create(endpoint)).region(Region.of(region)).credentialsProvider(credentials(access, secret))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).checksumValidationEnabled(false).build()).build();
    }
}
