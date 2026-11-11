package com.ssafy.airdrum.domain.play.storage;

import java.io.InputStream;
import java.util.function.Supplier;
import software.amazon.awssdk.core.exception.SdkException;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.S3Exception;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.domain.play.exception.PlayErrorCode;

/** 버전 관리 이력이 있는 bucket은 지원하지 않는다. 자격 증명·SDK 메시지를 외부로 내보내지 않는다. */
public class S3PlayRawStore implements PlayRawStore, AutoCloseable {
	private final S3Client client;
	private final String bucket;
	public S3PlayRawStore(S3Client client,String bucket) { this.client=client; this.bucket=bucket; }
	public void checkAvailable() {
		try {
			var response=client.getBucketVersioning(b -> b.bucket(bucket));
			if(response.statusAsString()!=null && !response.statusAsString().isBlank()) throw unavailable();
		} catch(SdkException ex) { throw unavailable(); }
	}
	public void put(String key,long length,Supplier<InputStream> content) {
		try (var stream=content.get()) {
			client.putObject(b -> b.bucket(bucket).key(key).contentType("application/gzip"),RequestBody.fromInputStream(stream,length));
		} catch(Exception ex) { throw unavailable(); }
	}
	public boolean exists(String key) {
		try { client.headObject(b -> b.bucket(bucket).key(key)); return true; }
		catch(S3Exception ex) { if(ex.statusCode()==404) return false; throw unavailable(); }
		catch(SdkException ex) { throw unavailable(); }
	}
	public void delete(String key) {
		try { client.deleteObject(b -> b.bucket(bucket).key(key)); }
		catch(S3Exception ex) { if(ex.statusCode()!=404) throw unavailable(); }
		catch(SdkException ex) { throw unavailable(); }
	}
	private static BusinessException unavailable() { return new BusinessException(PlayErrorCode.PLAY_RAW_STORAGE_UNAVAILABLE); }
	public void close() { client.close(); }
}
