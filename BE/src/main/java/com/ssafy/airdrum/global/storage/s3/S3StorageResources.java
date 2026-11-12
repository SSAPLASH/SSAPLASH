package com.ssafy.airdrum.global.storage.s3;

import java.nio.file.Path;
import java.time.Duration;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetBucketVersioningRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/** 동일한 워커 쓰기 권한과 읽기 서명 권한을 공유하는 S3 연결. */
public final class S3StorageResources implements AutoCloseable {
    private final S3Client audio, accompaniment, sheet;
    private final S3Presigner audioSigner, accompanimentSigner;
    private final String audioBucket, accompanimentBucket, sheetBucket;
    private final Duration ttl;
    public S3StorageResources(S3Client audio, S3Presigner audioSigner, String audioBucket,
            S3Client accompaniment, S3Presigner accompanimentSigner, String accompanimentBucket,
            S3Client sheet, String sheetBucket, Duration ttl) {
        this.audio=audio; this.audioSigner=audioSigner; this.audioBucket=audioBucket;
        this.accompaniment=accompaniment; this.accompanimentSigner=accompanimentSigner; this.accompanimentBucket=accompanimentBucket;
        this.sheet=sheet; this.sheetBucket=sheetBucket; this.ttl=ttl;
    }
    public S3Client audio() { return audio; }
    public S3Presigner audioSigner() { return audioSigner; }
    public String audioBucket() { return audioBucket; }
    public S3Client accompaniment() { return accompaniment; }
    public S3Presigner accompanimentSigner() { return accompanimentSigner; }
    public String accompanimentBucket() { return accompanimentBucket; }
    public S3Client sheet() { return sheet; }
    public String sheetBucket() { return sheetBucket; }
    public Duration ttl() { return ttl; }
    public void putAccompaniment(String key, Path file, long size, String type) {
        if (accompaniment==null || accompanimentSigner==null) throw new IllegalStateException("반주 저장소를 사용할 수 없습니다.");
        var state=accompaniment.getBucketVersioning(GetBucketVersioningRequest.builder().bucket(accompanimentBucket).build()).statusAsString();
        if (state!=null && !state.isBlank()) throw new IllegalStateException("반주 버킷 버전 설정을 확인하세요.");
        accompaniment.putObject(PutObjectRequest.builder().bucket(accompanimentBucket).key(key).contentType(type).contentLength(size).ifNoneMatch("*").build(),RequestBody.fromFile(file));
    }
    public void putSheet(String key, Path file, long size, String type) {
        if (sheet==null) throw new IllegalStateException("악보 저장소를 사용할 수 없습니다.");
        sheet.putObject(PutObjectRequest.builder().bucket(sheetBucket).key(key).contentType(type).contentLength(size).ifNoneMatch("*").build(),RequestBody.fromFile(file));
    }
    public void putCover(String key, byte[] data, String type) {
        if (sheet==null) throw new IllegalStateException("악보 저장소를 사용할 수 없습니다.");
        sheet.putObject(PutObjectRequest.builder().bucket(sheetBucket).key(key).contentType(type).ifNoneMatch("*").build(),RequestBody.fromBytes(data));
    }
    public void close() {
        if(audio!=null) audio.close(); if(audioSigner!=null) audioSigner.close();
        if(accompaniment!=null) accompaniment.close(); if(accompanimentSigner!=null) accompanimentSigner.close(); if(sheet!=null) sheet.close();
    }
}
