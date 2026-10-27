package com.ssafy.airdrum.song.audio;

import com.ssafy.airdrum.common.error.BusinessException;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import software.amazon.awssdk.auth.credentials.*;
import software.amazon.awssdk.core.retry.RetryPolicy;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.S3Exception;

import java.net.URI;
import java.nio.file.Path;
import java.time.Duration;

@Configuration(proxyBeanMethods = false)
public class AudioStorageConfiguration {
    @Bean(destroyMethod = "close")
    AudioStoreImpl audioStore(
            @Value("${audio.storage.enabled:false}") boolean enabled,
            @Value("${audio.storage.endpoint:}") String endpoint,
            @Value("${audio.storage.region:us-east-1}") String region,
            @Value("${audio.storage.bucket:}") String bucket,
            @Value("${audio.storage.access-key:}") String access,
            @Value("${audio.storage.secret-key:}") String secret,
            @Value("${audio.storage.private-bucket-confirmed:false}") boolean confirmed) {
        if (!enabled) return new AudioStoreImpl(null, "");
        URI uri = URI.create(endpoint);
        if (uri.getHost() == null
                || !("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))
                || uri.getUserInfo() != null
                || uri.getQuery() != null
                || uri.getFragment() != null
                || bucket.isBlank()
                || access.isBlank()
                || secret.isBlank()
                || region.isBlank()
                || !confirmed) throw new IllegalStateException("음원 저장소 설정을 확인하세요.");
        var client =
                S3Client.builder()
                        .endpointOverride(uri)
                        .region(Region.of(region))
                        .forcePathStyle(true)
                        .credentialsProvider(
                                StaticCredentialsProvider.create(
                                        AwsBasicCredentials.create(access, secret)))
                        .httpClientBuilder(
                                UrlConnectionHttpClient.builder()
                                        .connectionTimeout(Duration.ofSeconds(3))
                                        .socketTimeout(Duration.ofSeconds(60)))
                        .overrideConfiguration(
                                c ->
                                        c.apiCallTimeout(Duration.ofSeconds(60))
                                                .apiCallAttemptTimeout(Duration.ofSeconds(60))
                                                .retryPolicy(RetryPolicy.none()))
                        .build();
        return new AudioStoreImpl(client, bucket);
    }

    static class AudioStoreImpl implements AudioStore, AutoCloseable {
        private final S3Client client;
        private final String bucket;

        AudioStoreImpl(S3Client client, String bucket) {
            this.client = client;
            this.bucket = bucket;
        }

        public void checkAvailable() {
            try {
                if (client == null) throw unavailable();
                var v = client.getBucketVersioning(b -> b.bucket(bucket));
                if (v.statusAsString() != null && !v.statusAsString().isBlank())
                    throw unavailable();
            } catch (RuntimeException e) {
                throw unavailable();
            }
        }

        public void put(String key, Path path, long size, String mime) {
            try {
                client.putObject(
                        b -> b.bucket(bucket).key(key).contentType(mime),
                        RequestBody.fromFile(path));
            } catch (Exception e) {
                throw unavailable();
            }
        }

        public boolean exists(String key) {
            try {
                client.headObject(b -> b.bucket(bucket).key(key));
                return true;
            } catch (S3Exception e) {
                if (e.statusCode() == 404) return false;
                throw unavailable();
            } catch (RuntimeException e) {
                throw unavailable();
            }
        }

        public void delete(String key) {
            try {
                client.deleteObject(b -> b.bucket(bucket).key(key));
            } catch (RuntimeException e) {
                throw unavailable();
            }
        }

        public void close() {
            if (client != null) client.close();
        }

        private static BusinessException unavailable() {
            return new BusinessException(AudioErrorCode.UNAVAILABLE);
        }
    }
}
