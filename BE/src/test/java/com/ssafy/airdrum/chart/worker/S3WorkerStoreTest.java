package com.ssafy.airdrum.chart.worker;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.ssafy.airdrum.common.error.BusinessException;
import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.HexFormat;
import org.junit.jupiter.api.*;
import software.amazon.awssdk.core.ResponseInputStream;
import software.amazon.awssdk.http.AbortableInputStream;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import tools.jackson.databind.json.JsonMapper;
class S3WorkerStoreTest {
    S3Client audio, backing; S3Presigner signer; S3WorkerStore store; byte[] bytes; String hash;
    @BeforeEach void init() throws Exception {
        audio = mock(S3Client.class); backing = mock(S3Client.class); signer = mock(S3Presigner.class);
        when(backing.getBucketVersioning(any(GetBucketVersioningRequest.class))).thenReturn(GetBucketVersioningResponse.builder().build());
        bytes = getClass().getResourceAsStream("/worker/one-second.flac").readAllBytes();
        hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        store = new S3WorkerStore(audio, signer, "audio", backing, signer, "backing", Duration.ofMinutes(10), System.getProperty("worker.test.ffprobe", System.getenv().getOrDefault("AUDIO_FFPROBE_PATH", "ffprobe")), JsonMapper.builder().build());
    }
    ResponseInputStream<GetObjectResponse> object(byte[] data, String mime) {
        return new ResponseInputStream<>(GetObjectResponse.builder().contentLength((long)data.length).contentType(mime).build(), AbortableInputStream.create(new ByteArrayInputStream(data)));
    }
    void rejectsAllAccompanimentObjectOperations() {
        assertEquals(WorkerError.UNAVAILABLE, assertThrows(BusinessException.class,
                () -> store.exists(WorkerStore.Bucket.ACCOMPANIMENT, "accompaniment/1.flac")).getErrorCode());
        verify(backing, never()).headObject(any(java.util.function.Consumer.class));
        assertEquals(WorkerError.UNAVAILABLE, assertThrows(BusinessException.class,
                () -> store.delete(WorkerStore.Bucket.ACCOMPANIMENT, "accompaniment/1.flac")).getErrorCode());
        verify(backing, never()).deleteObject(any(java.util.function.Consumer.class));
        var file = new WorkerStore.Verified(Path.of("not-read.flac"), 1, "a".repeat(64), 1);
        assertEquals(WorkerError.UNAVAILABLE, assertThrows(BusinessException.class,
                () -> store.promote(file, WorkerStore.Bucket.ACCOMPANIMENT, "accompaniment/1.flac")).getErrorCode());
        verify(backing, never()).putObject(any(PutObjectRequest.class), any(software.amazon.awssdk.core.sync.RequestBody.class));
    }
    @Test void versionedAccompanimentCannotBeTreatedAsAbsentOrDeleted() {
        for (var status : new String[] {"Enabled", "Suspended", "UnknownFutureState"}) {
            reset(backing);
            when(backing.getBucketVersioning(any(GetBucketVersioningRequest.class)))
                    .thenReturn(GetBucketVersioningResponse.builder().status(status).build());
            rejectsAllAccompanimentObjectOperations();
        }
    }
    @Test void versionLookupFailuresBlockAllAccompanimentObjectOperations() {
        for (var failure : new RuntimeException[] {S3Exception.builder().statusCode(403).build(),
                S3Exception.builder().statusCode(503).build(), software.amazon.awssdk.core.exception.SdkClientException.create("network")}) {
            reset(backing);
            when(backing.getBucketVersioning(any(GetBucketVersioningRequest.class))).thenThrow(failure);
            rejectsAllAccompanimentObjectOperations();
        }
    }
    @Test void publicAccompanimentUploadRejectsVersioningAndLookupFailuresBeforePut() throws Exception {
        Path file=Files.createTempFile("public-backing-test", ".wav");
        try {
            Files.write(file, new byte[]{1,2,3,4});
            for (String status : new String[]{"Enabled", "Suspended", "UnknownFutureState"}) {
                reset(backing);
                when(backing.getBucketVersioning(any(GetBucketVersioningRequest.class)))
                        .thenReturn(GetBucketVersioningResponse.builder().status(status).build());
                assertEquals(WorkerError.UNAVAILABLE, assertThrows(BusinessException.class,
                        () -> store.putAccompaniment("accompaniment/1/test.wav",file,4,"audio/wav")).getErrorCode());
                verify(backing).getBucketVersioning(any(GetBucketVersioningRequest.class));
                verify(backing, never()).putObject(any(PutObjectRequest.class),any(software.amazon.awssdk.core.sync.RequestBody.class));
            }
            for (RuntimeException failure : new RuntimeException[]{S3Exception.builder().statusCode(403).build(),
                    S3Exception.builder().statusCode(503).build(), software.amazon.awssdk.core.exception.SdkClientException.create("network")}) {
                reset(backing);
                when(backing.getBucketVersioning(any(GetBucketVersioningRequest.class))).thenThrow(failure);
                assertEquals(WorkerError.UNAVAILABLE, assertThrows(BusinessException.class,
                        () -> store.putAccompaniment("accompaniment/1/test.wav",file,4,"audio/wav")).getErrorCode());
                verify(backing).getBucketVersioning(any(GetBucketVersioningRequest.class));
                verify(backing, never()).putObject(any(PutObjectRequest.class),any(software.amazon.awssdk.core.sync.RequestBody.class));
            }
        } finally { Files.deleteIfExists(file); }
    }
    @Test void publicAccompanimentUploadChecksVersionBeforeConditionalPut() throws Exception {
        Path file=Files.createTempFile("public-backing-test", ".wav");
        try {
            Files.write(file,new byte[]{1,2,3,4});
            store.putAccompaniment("accompaniment/1/test.wav",file,4,"audio/wav");
            var request=org.mockito.ArgumentCaptor.forClass(PutObjectRequest.class);
            var order=inOrder(backing);
            order.verify(backing).getBucketVersioning(any(GetBucketVersioningRequest.class));
            order.verify(backing).putObject(request.capture(),any(software.amazon.awssdk.core.sync.RequestBody.class));
            assertEquals("backing",request.getValue().bucket());
            assertEquals("accompaniment/1/test.wav",request.getValue().key());
            assertEquals("audio/wav",request.getValue().contentType());
            assertEquals(4L,request.getValue().contentLength());
            assertEquals("*",request.getValue().ifNoneMatch());
        } finally { Files.deleteIfExists(file); }
    }
    @Test void validatesManifestAndSeparatesStorageErrors() {
        when(audio.getObject(any(GetObjectRequest.class))).thenThrow(S3Exception.builder().statusCode(404).build());
        assertEquals(WorkerError.RESULT_INVALID, assertThrows(BusinessException.class, () -> store.inspectFlac("staging", bytes.length, hash, 1000)).getErrorCode());
        when(audio.getObject(any(GetObjectRequest.class))).thenReturn(object(bytes, "audio/wav"));
        assertEquals(WorkerError.RESULT_INVALID, assertThrows(BusinessException.class, () -> store.inspectFlac("staging", bytes.length, hash, 1000)).getErrorCode());
        when(audio.getObject(any(GetObjectRequest.class))).thenReturn(object(bytes, "audio/flac"));
        assertEquals(WorkerError.RESULT_INVALID, assertThrows(BusinessException.class, () -> store.inspectFlac("staging", bytes.length, "0".repeat(64), 1000)).getErrorCode());
        assertEquals(WorkerError.RESULT_INVALID, assertThrows(BusinessException.class, () -> store.inspectFlac("staging", S3WorkerStore.MAX_BYTES + 1, hash, 1000)).getErrorCode());
        when(audio.getObject(any(GetObjectRequest.class))).thenThrow(S3Exception.builder().statusCode(503).build());
        assertEquals(WorkerError.UNAVAILABLE, assertThrows(BusinessException.class, () -> store.inspectFlac("staging", bytes.length, hash, 1000)).getErrorCode());
    }
    @Test void promotionUsesConditionalPutAndReadsBack() throws Exception {
        Path tmp = Files.createTempFile("worker-test", ".flac");
        try {
            Files.write(tmp, bytes); var file = new WorkerStore.Verified(tmp, bytes.length, hash, 1000);
            when(backing.putObject(any(PutObjectRequest.class), any(software.amazon.awssdk.core.sync.RequestBody.class))).thenReturn(PutObjectResponse.builder().build());
            when(backing.getObject(any(GetObjectRequest.class))).thenReturn(object(bytes, "audio/flac"));
            store.promote(file, WorkerStore.Bucket.ACCOMPANIMENT, "accompaniment/1.flac");
            var req = org.mockito.ArgumentCaptor.forClass(PutObjectRequest.class);
            verify(backing).putObject(req.capture(), any(software.amazon.awssdk.core.sync.RequestBody.class));
            assertEquals("*", req.getValue().ifNoneMatch()); verify(backing).getObject(any(GetObjectRequest.class));
            when(backing.putObject(any(PutObjectRequest.class), any(software.amazon.awssdk.core.sync.RequestBody.class))).thenThrow(S3Exception.builder().statusCode(412).build());
            when(backing.getObject(any(GetObjectRequest.class))).thenReturn(object(bytes, "audio/flac"));
            store.promote(file, WorkerStore.Bucket.ACCOMPANIMENT, "accompaniment/1.flac");
            when(backing.getObject(any(GetObjectRequest.class))).thenReturn(object(new byte[bytes.length], "audio/flac"));
            assertEquals(WorkerError.RESULT_INVALID, assertThrows(BusinessException.class, () -> store.promote(file, WorkerStore.Bucket.ACCOMPANIMENT, "accompaniment/1.flac")).getErrorCode());
            when(backing.putObject(any(PutObjectRequest.class), any(software.amazon.awssdk.core.sync.RequestBody.class))).thenReturn(PutObjectResponse.builder().build());
            when(backing.getObject(any(GetObjectRequest.class))).thenReturn(object(new byte[bytes.length], "audio/flac"));
            assertEquals(WorkerError.UNAVAILABLE, assertThrows(BusinessException.class, () -> store.promote(file, WorkerStore.Bucket.ACCOMPANIMENT, "accompaniment/1.flac")).getErrorCode());
        } finally { Files.deleteIfExists(tmp); }
    }
    @Test void signedPutIncludesExactLengthAndContentType() throws Exception {
        try (var realSigner = S3Presigner.builder().endpointOverride(java.net.URI.create("http://127.0.0.1:18334"))
                .region(software.amazon.awssdk.regions.Region.US_EAST_1)
                .credentialsProvider(software.amazon.awssdk.auth.credentials.StaticCredentialsProvider.create(
                        software.amazon.awssdk.auth.credentials.AwsBasicCredentials.create("fixture-access", "fixture-secret")))
                .serviceConfiguration(software.amazon.awssdk.services.s3.S3Configuration.builder().pathStyleAccessEnabled(true).checksumValidationEnabled(false).build()).build()) {
            var actual = new S3WorkerStore(audio, realSigner, "audio", backing, realSigner, "backing", Duration.ofMinutes(10), "ffprobe", JsonMapper.builder().build());
            String query=java.net.URLDecoder.decode(actual.signPut("staging", 8903).url(), java.nio.charset.StandardCharsets.UTF_8);
            assertTrue(query.contains("X-Amz-SignedHeaders=content-length;content-type;host"), query.replaceAll("X-Amz-Signature=[^&]+", "X-Amz-Signature=redacted"));
        }
    }
    @Test void realProbeChecksFlacAndDuration() {
        when(audio.getObject(any(GetObjectRequest.class))).thenReturn(object(bytes, "audio/flac"));
        try (var file = store.inspectFlac("staging", bytes.length, hash, 1000)) { assertEquals(hash, file.sha256()); }
        when(audio.getObject(any(GetObjectRequest.class))).thenReturn(object(bytes, "audio/flac"));
        assertEquals(WorkerError.RESULT_INVALID, assertThrows(BusinessException.class, () -> store.inspectFlac("staging", bytes.length, hash, 999)).getErrorCode());
    }

    @Test void exactDurationUsesRealFlacFilesAndStrictMilliseconds() throws Exception {
        // 44.1kHz에서 floor(D*44100/1000) 샘플로 만든 실제 16bit stereo FLAC.
        for (int duration : new int[] {1,1001,4001,4030,12345}) {
            byte[] audioBytes;
            try (var resource=getClass().getResourceAsStream("/worker/duration-"+duration+"ms.flac")) {
                audioBytes=resource.readAllBytes();
            }
            String sha=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(audioBytes));
            when(audio.getObject(any(GetObjectRequest.class))).thenAnswer(i -> object(audioBytes, "audio/flac"));
            try (var verified=store.inspectFlac("staging",audioBytes.length,sha,duration)) {
                assertEquals(duration,verified.durationMs());
            }
            assertEquals(WorkerError.RESULT_INVALID, assertThrows(BusinessException.class,
                    () -> store.inspectFlac("staging",audioBytes.length,sha,duration+1)).getErrorCode());
        }
    }

    @Test void missingProbeIsUnavailableRatherThanInvalidResult() {
        when(audio.getObject(any(GetObjectRequest.class))).thenReturn(object(bytes, "audio/flac"));
        String missing=Path.of(System.getProperty("java.io.tmpdir"), "missing-ffprobe-"+java.util.UUID.randomUUID()).toString();
        var unavailable=new S3WorkerStore(audio, signer, "audio", backing, signer, "backing", Duration.ofMinutes(10), missing, JsonMapper.builder().build());
        assertEquals(WorkerError.UNAVAILABLE, assertThrows(BusinessException.class,
                () -> unavailable.inspectFlac("staging",bytes.length,hash,1000)).getErrorCode());
    }
}
