package com.ssafy.airdrum.domain.chart.tool;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.core.ResponseInputStream;
import software.amazon.awssdk.http.AbortableInputStream;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectResponse;
import software.amazon.awssdk.services.s3.model.S3Exception;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 오브젝트 저장 분기를 대역으로 확인하고, 실제 SDK·MinIO 연동은 로컬 통합 절차에서 검증한다. */
class S3PracticeBackingObjectStoreTest {
	private static final String BUCKET = "backing";
	private static final String KEY = "accompaniment/1.wav";

	@Test
	void missingObjectUsesConditionalPutThenReadsBackAndHashesContents() throws IOException {
		byte[] expected = {1, 2, 3, 4, 5};
		String sha256 = S3PracticeBackingObjectStore.sha256(expected);
		S3Client client = mock(S3Client.class);
		when(client.headObject(any(HeadObjectRequest.class)))
				.thenThrow(missingObject())
				.thenReturn(head(expected.length));
		when(client.putObject(any(PutObjectRequest.class), any(RequestBody.class)))
				.thenReturn(PutObjectResponse.builder().build());
		when(client.getObject(any(GetObjectRequest.class))).thenReturn(response(expected));

		assertThat(new S3PracticeBackingObjectStore(client).ensureBytes(BUCKET, KEY, expected, sha256)).isFalse();

		var request = org.mockito.ArgumentCaptor.forClass(PutObjectRequest.class);
		verify(client).putObject(request.capture(), any(RequestBody.class));
		assertThat(request.getValue().ifNoneMatch()).isEqualTo("*");
		assertThat(request.getValue().contentLength()).isEqualTo((long) expected.length);
		verify(client, org.mockito.Mockito.times(2)).headObject(any(HeadObjectRequest.class));
		verify(client).getObject(any(GetObjectRequest.class));
	}

	@Test
	void preconditionRaceReusesOnlyAnExistingObjectWithMatchingHash() throws IOException {
		byte[] expected = {1, 2, 3, 4, 5};
		S3Client client = mock(S3Client.class);
		when(client.headObject(any(HeadObjectRequest.class)))
				.thenThrow(missingObject())
				.thenReturn(head(expected.length));
		when(client.putObject(any(PutObjectRequest.class), any(RequestBody.class)))
				.thenThrow(serviceError(412));
		when(client.getObject(any(GetObjectRequest.class))).thenReturn(response(expected));

		assertThat(new S3PracticeBackingObjectStore(client).ensureBytes(BUCKET, KEY, expected,
				S3PracticeBackingObjectStore.sha256(expected))).isTrue();

		verify(client).putObject(any(PutObjectRequest.class), any(RequestBody.class));
		verify(client).getObject(any(GetObjectRequest.class));
	}

	@Test
	void existingObjectWithDifferentHashFailsClosed() throws IOException {
		byte[] expected = {1, 2, 3, 4, 5};
		byte[] actual = {5, 4, 3, 2, 1};
		S3Client client = mock(S3Client.class);
		when(client.headObject(any(HeadObjectRequest.class))).thenReturn(head(actual.length));
		when(client.getObject(any(GetObjectRequest.class))).thenReturn(response(actual));

		assertThatThrownBy(() -> new S3PracticeBackingObjectStore(client).ensureBytes(BUCKET, KEY, expected,
				S3PracticeBackingObjectStore.sha256(expected)))
				.hasMessageContaining("기존 비공개 반주 자산 확인");

		verify(client, never()).putObject(any(PutObjectRequest.class), any(RequestBody.class));
		verify(client).getObject(any(GetObjectRequest.class));
	}

	@Test
	void differentHeadLengthIsRejectedWithoutDownloadingObject() {
		byte[] expected = {1, 2, 3, 4, 5};
		S3Client client = mock(S3Client.class);
		when(client.headObject(any(HeadObjectRequest.class))).thenReturn(head(8_000_000), head(8_000_000));

		assertThatThrownBy(() -> new S3PracticeBackingObjectStore(client).ensureBytes(BUCKET, KEY, expected,
				S3PracticeBackingObjectStore.sha256(expected)))
				.hasMessageContaining("기존 비공개 반주 자산 확인");

		verify(client, never()).getObject(any(GetObjectRequest.class));
		verify(client, never()).putObject(any(PutObjectRequest.class), any(RequestBody.class));
	}

	private static S3Exception missingObject() {
		return serviceError(404);
	}

	private static S3Exception serviceError(int status) {
		return (S3Exception) S3Exception.builder().statusCode(status).build();
	}

	private static HeadObjectResponse head(long length) {
		return HeadObjectResponse.builder().contentLength(length).build();
	}

	private static ResponseInputStream<GetObjectResponse> response(byte[] bytes) {
		return new ResponseInputStream<>(GetObjectResponse.builder().contentLength((long) bytes.length).build(),
				AbortableInputStream.create(new ByteArrayInputStream(bytes)));
	}
}
