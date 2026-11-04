package com.ssafy.airdrum.song.midi;

import java.net.URI;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.HexFormat;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import com.ssafy.airdrum.common.error.BusinessException;
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
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

@Configuration(proxyBeanMethods = false)
class MidiOriginalStorageConfiguration {
    @Bean(destroyMethod = "close")
    MidiS3Store midiOriginalStore(@Value("${midi.storage.enabled:false}") boolean enabled,
            @Value("${midi.storage.endpoint:}") String endpoint, @Value("${midi.storage.region:us-east-1}") String region,
            @Value("${midi.storage.bucket:}") String bucket, @Value("${midi.storage.access-key:}") String access,
            @Value("${midi.storage.secret-key:}") String secret,
            @Value("${midi.storage.private-bucket-confirmed:false}") boolean confirmed) {
        if (!enabled) return new MidiS3Store(null, null, "");
        URI uri = URI.create(endpoint);
        if (uri.getHost() == null || !("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))
                || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
                || bucket.isBlank() || access.isBlank() || secret.isBlank() || region.isBlank() || !confirmed)
            throw new IllegalStateException("MIDI 원본 저장소 설정을 확인하세요.");
        var client = S3Client.builder().endpointOverride(uri).region(Region.of(region))
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(access, secret)))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).chunkedEncodingEnabled(false).build())
                .httpClientBuilder(UrlConnectionHttpClient.builder().connectionTimeout(Duration.ofSeconds(3)).socketTimeout(Duration.ofSeconds(30)))
                .overrideConfiguration(c -> c.apiCallTimeout(Duration.ofSeconds(30)).apiCallAttemptTimeout(Duration.ofSeconds(30)).retryPolicy(RetryPolicy.none()))
                .build();
        var signer=S3Presigner.builder().endpointOverride(uri).region(Region.of(region))
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(access,secret)))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).checksumValidationEnabled(false).build()).build();
        return new MidiS3Store(client, signer, bucket);
    }

    static final class MidiS3Store implements MidiOriginalStore, AutoCloseable {
        private final S3Client client;
        private final S3Presigner signer;
        private final MidiBoundedDownload download=new MidiBoundedDownload();
        private final String bucket;
        MidiS3Store(S3Client client, S3Presigner signer, String bucket) { this.client = client; this.signer=signer; this.bucket = bucket; }

        public void putAndVerify(String key, byte[] bytes, String sha256) {
            long deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
            try {
                requireClient();
                var version = client.getBucketVersioning(b -> b.bucket(bucket).overrideConfiguration(timeout(deadline)));
                if (version.statusAsString() != null && !version.statusAsString().isBlank()) throw unavailable();
                client.putObject(b -> b.bucket(bucket).key(key).contentType("audio/midi").contentLength((long) bytes.length)
                        .metadata(java.util.Map.of("sha256", sha256)).ifNoneMatch("*").overrideConfiguration(timeout(deadline)), RequestBody.fromBytes(bytes));
                var head = client.headObject(b -> b.bucket(bucket).key(key).overrideConfiguration(timeout(deadline)));
                if (head.contentLength() == null || head.contentLength() != bytes.length || !sha256.equals(head.metadata().get("sha256")))
                    throw unavailable();
                get(key,bytes.length,sha256,deadline);
            } catch (RuntimeException e) { throw unavailable(); }
        }
        public byte[] get(String key, int size, String sha256, long attemptDeadline) {
            long deadline=Math.min(attemptDeadline,System.nanoTime()+Duration.ofSeconds(30).toNanos());
            try {
                requireClient();
                if (size <= 0 || size > MidiChartConverter.LIMIT) throw new IllegalArgumentException("MIDI 원본 크기가 올바르지 않습니다.");
                var request=GetObjectRequest.builder().bucket(bucket).key(key).build();
                var signed=signer.presignGetObject(b -> b.signatureDuration(Duration.ofMinutes(1)).getObjectRequest(request));
                var data=download.get(signed.url().toURI(),size,deadline);
                if (System.nanoTime()>=deadline) throw unavailable();
                if (data.length != size || !sha256.equals(hash(data))) throw new IllegalArgumentException("MIDI 원본 무결성 검증 실패");
                return data;
            } catch (IllegalArgumentException e) { throw e; }
            catch (S3Exception e) { if (e.statusCode()==404) throw new IllegalArgumentException("MIDI 원본이 없습니다."); throw unavailable(); }
            catch (Exception e) { throw unavailable(); }
        }
        public boolean exists(String key) {
            try {
                requireClient();
                var version=client.getBucketVersioning(b -> b.bucket(bucket));
                if (version.statusAsString()!=null && !version.statusAsString().isBlank()) throw unavailable();
                client.headObject(b -> b.bucket(bucket).key(key)); return true;
            }
            catch (S3Exception e) { if (e.statusCode() == 404) return false; throw unavailable(); }
            catch (RuntimeException e) { throw unavailable(); }
        }
        public void delete(String key) {
            try {
                requireClient();
                var version = client.getBucketVersioning(b -> b.bucket(bucket));
                if (version.statusAsString() != null && !version.statusAsString().isBlank()) throw unavailable();
                client.deleteObject(b -> b.bucket(bucket).key(key));
            }
            catch (RuntimeException e) { throw unavailable(); }
        }
        private void requireClient() { if (client == null || signer == null) throw unavailable(); }
        private static AwsRequestOverrideConfiguration timeout(long deadline) {
            long remaining = deadline - System.nanoTime();
            if (remaining <= 0) throw unavailable();
            Duration duration = Duration.ofNanos(remaining);
            return AwsRequestOverrideConfiguration.builder().apiCallTimeout(duration).apiCallAttemptTimeout(duration).build();
        }
        static String hash(byte[] data) {
            try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data)); }
            catch (Exception e) { throw new IllegalStateException(e); }
        }
        private static BusinessException unavailable() { return new BusinessException(MidiErrorCode.STORAGE_UNAVAILABLE); }
        public void close() { download.close(); if (client != null) client.close(); if (signer!=null) signer.close(); }
    }
}
