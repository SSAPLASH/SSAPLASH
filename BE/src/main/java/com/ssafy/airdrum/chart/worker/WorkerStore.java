package com.ssafy.airdrum.chart.worker;

import java.nio.file.Path;
import java.time.Instant;

/** 서버가 생성한 키만 전달한다. 메서드는 데이터베이스 트랜잭션 밖에서 호출한다. */
interface WorkerStore {
    enum Bucket { AUDIO, ACCOMPANIMENT }
    record Signed(String url, Instant expiresAt) {}
    record Verified(Path path, long sizeBytes, String sha256, int durationMs) implements AutoCloseable {
        public void close() {
            try { java.nio.file.Files.deleteIfExists(path); }
            catch (java.io.IOException ignored) { }
        }
    }
    Signed signGet(Bucket bucket, String key);
    Signed signPut(String stagingKey, long sizeBytes);
    /** 부재·불일치·잘못된 FLAC은 RESULT_INVALID, 일시 저장소·프로브 장애는 UNAVAILABLE. */
    Verified inspectFlac(String stagingKey, long sizeBytes, String sha256, int durationMs);
    /** 검증한 로컬 바이트를 조건부 생성하고 기존 객체가 있으면 동일한 바이트만 수용한다. */
    void promote(Verified file, Bucket bucket, String key);
    boolean exists(Bucket bucket, String key);
    void delete(Bucket bucket, String key);
}
