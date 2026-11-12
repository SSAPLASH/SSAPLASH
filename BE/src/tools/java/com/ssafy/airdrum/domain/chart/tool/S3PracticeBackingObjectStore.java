package com.ssafy.airdrum.domain.chart.tool;

import java.io.IOException;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import software.amazon.awssdk.core.exception.SdkException;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;

/** 실제 오브젝트 내용을 확인하고 If-None-Match 조건부로만 새 파일을 쓴다. */
final class S3PracticeBackingObjectStore implements PracticeBackingObjectStore {
	private final S3Client client;

	S3PracticeBackingObjectStore(S3Client client) { this.client = client; }

	@Override
	public boolean ensureBytes(String bucket, String key, byte[] expectedBytes, String expectedSha256) {
		if (exists(bucket, key)) {
			verifyContent(bucket, key, expectedBytes.length, expectedSha256);
			return true;
		}
		try {
			client.putObject(PutObjectRequest.builder().bucket(bucket).key(key).contentType("audio/wav")
					.contentLength((long) expectedBytes.length).metadata(Map.of("sha256", expectedSha256))
					.ifNoneMatch("*").build(), RequestBody.fromBytes(expectedBytes));
		} catch (S3Exception ex) {
			if (ex.statusCode() == 409 || ex.statusCode() == 412) {
				verifyContent(bucket, key, expectedBytes.length, expectedSha256);
				return true;
			}
			throw failed();
		} catch (SdkException ex) {
			throw failed();
		}
		verifyContent(bucket, key, expectedBytes.length, expectedSha256);
		return false;
	}

	private boolean exists(String bucket, String key) {
		try {
			client.headObject(HeadObjectRequest.builder().bucket(bucket).key(key).build());
			return true;
		} catch (S3Exception ex) {
			if (ex.statusCode() == 404) return false;
			throw failed();
		} catch (SdkException ex) {
			throw failed();
		}
	}

	private void verifyContent(String bucket, String key, int expectedLength, String expectedSha256) {
		try {
			var head = client.headObject(HeadObjectRequest.builder().bucket(bucket).key(key).build());
			if (head.contentLength() == null || head.contentLength() != expectedLength) throw failed();
			byte[] actual;
			try (var stream = client.getObject(GetObjectRequest.builder().bucket(bucket).key(key).build())) {
				actual = stream.readNBytes(expectedLength + 1);
			}
			if (actual.length != expectedLength || !sha256(actual).equals(expectedSha256)) throw failed();
		} catch (SdkException | IOException ex) {
			throw failed();
		}
	}

	static String sha256(byte[] bytes) {
		try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
		catch (Exception ex) { throw new IllegalStateException("SHA-256을 계산할 수 없습니다."); }
	}

	private static IllegalStateException failed() {
		return new IllegalStateException("기존 비공개 반주 자산 확인 또는 조건부 업로드에 실패했습니다.");
	}
}
