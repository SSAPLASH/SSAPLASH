package com.ssafy.airdrum.chart.worker;

import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.song.audio.AudioDuration;
import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.HexFormat;
import java.util.concurrent.*;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.*;
import tools.jackson.databind.json.JsonMapper;

/** 저장소 요청은 트랜잭션 밖에서 실행하고 실제 바이트를 검증한다. */
final class S3WorkerStore implements WorkerStore, AutoCloseable {
    static final long MAX_BYTES = 128L * 1024 * 1024;
    private final S3Client audio, accompaniment, sheet;
    private final S3Presigner audioSigner, accompanimentSigner;
    private final String audioBucket, accompanimentBucket, sheetBucket, ffprobe;
    private final Duration ttl;
    private final JsonMapper json;

    S3WorkerStore(S3Client audio, S3Presigner audioSigner, String audioBucket,
                  S3Client accompaniment, S3Presigner accompanimentSigner, String accompanimentBucket,
                  Duration ttl, String ffprobe, JsonMapper json) {
        this(audio, audioSigner, audioBucket, accompaniment, accompanimentSigner, accompanimentBucket, null, "", ttl, ffprobe, json);
    }
    S3WorkerStore(S3Client audio, S3Presigner audioSigner, String audioBucket,
                  S3Client accompaniment, S3Presigner accompanimentSigner, String accompanimentBucket,
                  S3Client sheet, String sheetBucket, Duration ttl, String ffprobe, JsonMapper json) {
        this.sheet = sheet; this.sheetBucket = sheetBucket;
        this.audio = audio; this.audioSigner = audioSigner; this.audioBucket = audioBucket;
        this.accompaniment = accompaniment; this.accompanimentSigner = accompanimentSigner;
        this.accompanimentBucket = accompanimentBucket; this.ttl = ttl; this.ffprobe = ffprobe; this.json = json;
    }
    private S3Client client(Bucket b) { return switch (b) { case AUDIO -> audio; case ACCOMPANIMENT -> accompaniment; case SHEET -> sheet; }; }
    private S3Presigner signer(Bucket b) { return b == Bucket.AUDIO ? audioSigner : accompanimentSigner; }
    private String bucket(Bucket b) { return switch (b) { case AUDIO -> audioBucket; case ACCOMPANIMENT -> accompanimentBucket; case SHEET -> sheetBucket; }; }
    private void available(Bucket b) { if (client(b) == null || (b != Bucket.SHEET && signer(b) == null)) throw unavailable(); }
    public Signed signGet(Bucket b, String key) {
        if (b == Bucket.SHEET) throw unavailable();
        available(b);
        try {
            var req = GetObjectRequest.builder().bucket(bucket(b)).key(key).build();
            var signed = signer(b).presignGetObject(GetObjectPresignRequest.builder().signatureDuration(ttl).getObjectRequest(req).build());
            return new Signed(signed.url().toExternalForm(), signed.expiration());
        } catch (RuntimeException e) { throw unavailable(); }
    }
    public Signed signPut(String key, long sizeBytes) {
        if (sizeBytes <= 0 || sizeBytes > MAX_BYTES) throw invalid();
        available(Bucket.AUDIO);
        try {
            var req = PutObjectRequest.builder().bucket(audioBucket).key(key).contentType("audio/flac").contentLength(sizeBytes).build();
            var signed = audioSigner.presignPutObject(PutObjectPresignRequest.builder().signatureDuration(ttl).putObjectRequest(req).build());
            return new Signed(signed.url().toExternalForm(), signed.expiration());
        } catch (RuntimeException e) { throw unavailable(); }
    }
    public Verified inspectFlac(String key, long size, String sha, int duration) {
        available(Bucket.AUDIO);
        if (size <= 0 || size > MAX_BYTES || sha == null || !sha.matches("[0-9a-f]{64}") || duration <= 0 || duration > 600000) throw invalid();
        Path tmp = null;
        try {
            tmp = Files.createTempFile("airdrum-worker-", ".flac");
            try (var in = audio.getObject(GetObjectRequest.builder().bucket(audioBucket).key(key).build());
                 var out = Files.newOutputStream(tmp)) {
                if (!"audio/flac".equals(in.response().contentType()) || in.response().contentLength() == null || in.response().contentLength() != size) throw invalid();
                String actual = copyAndDigest(in, out, size);
                if (!sha.equals(actual)) throw invalid();
            }
            probe(tmp, duration);
            return new Verified(tmp, size, sha, duration);
        } catch (BusinessException e) { remove(tmp); throw e; }
        catch (S3Exception e) { remove(tmp); if (e.statusCode() == 404) throw invalid(); throw unavailable(); }
        catch (Exception e) { remove(tmp); throw unavailable(); }
    }
    public void promote(Verified file, Bucket b, String key) {
        available(b);
        boolean existed = false;
        try {
            client(b).putObject(PutObjectRequest.builder().bucket(bucket(b)).key(key).contentType("audio/flac").ifNoneMatch("*").build(), RequestBody.fromFile(file.path()));
        } catch (S3Exception e) {
            if (e.statusCode() != 412) throw unavailable();
            existed = true;
        } catch (RuntimeException e) { throw unavailable(); }
        try (var in = client(b).getObject(GetObjectRequest.builder().bucket(bucket(b)).key(key).build())) {
            if (in.response().contentLength() == null || in.response().contentLength() != file.sizeBytes() || !"audio/flac".equals(in.response().contentType()) || !file.sha256().equals(copyAndDigest(in, OutputStream.nullOutputStream(), file.sizeBytes()))) {
                if (existed) throw invalid();
                throw unavailable();
            }
        } catch (BusinessException e) { if (!existed) throw unavailable(); throw e; }
        catch (Exception e) { throw unavailable(); }
    }
    void putAccompaniment(String key,Path file,long size,String contentType) {
        available(Bucket.ACCOMPANIMENT);
        try { accompaniment.putObject(PutObjectRequest.builder().bucket(accompanimentBucket).key(key).contentType(contentType).contentLength(size).ifNoneMatch("*").build(),RequestBody.fromFile(file)); }
        catch(RuntimeException ex) { throw unavailable(); }
    }
    void putCover(String key,byte[] data,String contentType) {
        available(Bucket.SHEET);
        try { sheet.putObject(PutObjectRequest.builder().bucket(sheetBucket).key(key).contentType(contentType).ifNoneMatch("*").build(),RequestBody.fromBytes(data)); }
        catch(RuntimeException ex) { throw unavailable(); }
    }
    public boolean exists(Bucket b, String key) {
        available(b);
        try { client(b).headObject(r -> r.bucket(bucket(b)).key(key)); return true; }
        catch (S3Exception e) { if (e.statusCode() == 404) return false; throw unavailable(); }
        catch (RuntimeException e) { throw unavailable(); }
    }
    public void delete(Bucket b, String key) {
        available(b);
        try { client(b).deleteObject(r -> r.bucket(bucket(b)).key(key)); }
        catch (RuntimeException e) { throw unavailable(); }
    }
    private static String copyAndDigest(InputStream in, OutputStream out, long expected) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buf = new byte[65536]; long total = 0; int n;
        long deadline = System.nanoTime() + Duration.ofMinutes(2).toNanos();
        while ((n = in.read(buf)) != -1) {
            if (System.nanoTime() - deadline >= 0) throw new IOException("저장소 읽기 시간 초과");
            total += n; if (total > expected || total > MAX_BYTES) throw invalid();
            digest.update(buf, 0, n); out.write(buf, 0, n);
        }
        if (total != expected) throw invalid();
        return HexFormat.of().formatHex(digest.digest());
    }
    private void probe(Path file, int durationMs) {
        Process process;
        try {
            process = new ProcessBuilder(ffprobe, "-v", "error", "-protocol_whitelist", "file", "-format_whitelist", "flac", "-show_entries", "format=format_name,duration:stream=codec_type,codec_name,sample_rate,channels,bits_per_raw_sample", "-of", "json", file.toAbsolutePath().toString()).redirectErrorStream(true).start();
        } catch (IOException e) { throw unavailable(); }
        var output = new FutureTask<byte[]>(() -> {
            try (var in = process.getInputStream(); var out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[4096]; int n;
                while ((n = in.read(buf)) != -1) { if (out.size() + n > 65536) throw new IOException(); out.write(buf, 0, n); }
                return out.toByteArray();
            }
        });
        Thread.ofVirtual().start(output);
        try {
            if (!process.waitFor(10, TimeUnit.SECONDS)) throw unavailable();
            byte[] bytes = output.get(2, TimeUnit.SECONDS);
            if (process.exitValue() != 0) throw invalid();
            var root = json.readTree(bytes); var format = root.path("format");
            int actualDuration;
            try { actualDuration = AudioDuration.milliseconds(format.path("duration").asText()); }
            catch (IllegalArgumentException | ArithmeticException e) { throw invalid(); }
            if (!"flac".equals(format.path("format_name").asText()) || actualDuration != durationMs) throw invalid();
            int count = 0;
            for (var s : root.path("streams")) {
                if (!"audio".equals(s.path("codec_type").asText()) || !"flac".equals(s.path("codec_name").asText()) || !"44100".equals(s.path("sample_rate").asText()) || s.path("channels").asInt() != 2 || !"16".equals(s.path("bits_per_raw_sample").asText())) throw invalid();
                count++;
            }
            if (count != 1) throw invalid();
        } catch (BusinessException e) { throw e; }
        catch (Exception e) { if (e instanceof InterruptedException) Thread.currentThread().interrupt(); throw unavailable(); }
        finally {
            process.descendants().forEach(ProcessHandle::destroyForcibly);
            if (process.isAlive()) process.destroyForcibly();
            output.cancel(true);
            Thread.ofVirtual().start(() -> {
                try { process.getInputStream().close(); } catch (IOException ignored) {}
                try { process.getOutputStream().close(); } catch (IOException ignored) {}
                try { process.getErrorStream().close(); } catch (IOException ignored) {}
            });
        }
    }
    public void close() { if (audio != null) audio.close(); if (audioSigner != null) audioSigner.close(); if (accompaniment != null) accompaniment.close(); if (accompanimentSigner != null) accompanimentSigner.close(); if (sheet != null) sheet.close(); }
    private static void remove(Path p) { if (p != null) try { Files.deleteIfExists(p); } catch (IOException ignored) {} }
    private static BusinessException invalid() { return new BusinessException(WorkerError.RESULT_INVALID); }
    private static BusinessException unavailable() { return new BusinessException(WorkerError.UNAVAILABLE); }
}
