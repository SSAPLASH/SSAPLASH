package com.ssafy.airdrum.song.midi;

import java.net.URI;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.awscore.AwsRequestOverrideConfiguration;
import software.amazon.awssdk.core.retry.RetryPolicy;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.S3Exception;

@Configuration(proxyBeanMethods=false)
class MidiBackingStorageConfiguration {
    @Bean(destroyMethod="close")
    MidiBackingS3 midiBackingStore(@Value("${chart.assets.enabled:false}") boolean enabled,
            @Value("${chart.assets.endpoint:}") String endpoint, @Value("${chart.assets.region:us-east-1}") String region,
            @Value("${chart.assets.accompaniment-bucket:}") String bucket,
            @Value("${worker.storage.accompaniment-write-access-key:${audio.storage.access-key:}}") String access,
            @Value("${worker.storage.accompaniment-write-secret-key:${audio.storage.secret-key:}}") String secret) {
        if (!enabled || access.isBlank() || secret.isBlank()) return new MidiBackingS3(null, "");
        URI uri=URI.create(endpoint);
        if (uri.getHost()==null || !("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))
                || uri.getUserInfo()!=null || uri.getQuery()!=null || uri.getFragment()!=null || bucket.isBlank() || region.isBlank())
            throw new IllegalStateException("MIDI 반주 저장소 설정을 확인하세요.");
        var client=S3Client.builder().endpointOverride(uri).region(Region.of(region))
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(access,secret)))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).chunkedEncodingEnabled(false).build())
                .httpClientBuilder(UrlConnectionHttpClient.builder().connectionTimeout(Duration.ofSeconds(3)).socketTimeout(Duration.ofSeconds(30)))
                .overrideConfiguration(c->c.apiCallTimeout(Duration.ofSeconds(30)).apiCallAttemptTimeout(Duration.ofSeconds(30)).retryPolicy(RetryPolicy.none())).build();
        return new MidiBackingS3(client,bucket);
    }
    static final class MidiBackingS3 implements MidiBackingStore,AutoCloseable {
        private final S3Client client; private final String bucket;
        MidiBackingS3(S3Client client,String bucket) { this.client=client; this.bucket=bucket; }
        private void available() { if (client==null) throw new IllegalStateException("반주 저장소를 사용할 수 없습니다."); }
        private void unversioned(long deadline) {
            available();
            var version=client.getBucketVersioning(b->b.bucket(bucket).overrideConfiguration(timeout(deadline)));
            if (version.statusAsString()!=null && !version.statusAsString().isBlank()) throw new IllegalStateException("반주 버킷 버전 관리 금지");
        }
        public void put(String key,Path file,long size,String sha,long attemptDeadline) {
            long deadline=Math.min(attemptDeadline,System.nanoTime()+Duration.ofSeconds(30).toNanos());
            unversioned(deadline);
            client.putObject(b->b.bucket(bucket).key(key).contentType("audio/flac").contentLength(size).ifNoneMatch("*")
                    .metadata(Map.of("sha256",sha)).overrideConfiguration(timeout(deadline)),RequestBody.fromFile(file));
            var head=client.headObject(b->b.bucket(bucket).key(key).overrideConfiguration(timeout(deadline)));
            if (head.contentLength()==null || head.contentLength()!=size || !sha.equals(head.metadata().get("sha256")))
                throw new IllegalStateException("반주 업로드 검증 실패");
        }
        public boolean exists(String key) {
            try { unversioned(System.nanoTime()+Duration.ofSeconds(30).toNanos()); client.headObject(b->b.bucket(bucket).key(key)); return true; }
            catch (S3Exception e) { if (e.statusCode()==404) return false; throw e; }
        }
        public void delete(String key) {
            long deadline=System.nanoTime()+Duration.ofSeconds(30).toNanos(); unversioned(deadline);
            client.deleteObject(b->b.bucket(bucket).key(key).overrideConfiguration(timeout(deadline)));
        }
        private static AwsRequestOverrideConfiguration timeout(long deadline) {
            long left=deadline-System.nanoTime(); if (left<=0) throw new IllegalStateException("저장소 요청 시간 초과");
            var duration=Duration.ofNanos(left);
            return AwsRequestOverrideConfiguration.builder().apiCallTimeout(duration).apiCallAttemptTimeout(duration).build();
        }
        public void close() { if (client!=null) client.close(); }
    }
}
