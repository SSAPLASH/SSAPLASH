package com.ssafy.airdrum.chart.asset;

import software.amazon.awssdk.core.exception.SdkException;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;
import com.ssafy.airdrum.chart.ChartErrorCode;
import com.ssafy.airdrum.common.error.BusinessException;

/** 내부 endpoint로 객체를 확인하고 브라우저가 접근할 공개 endpoint로 서명한다. */
public class S3ChartAssetStore implements ChartAssetStore {
	private final S3Client client;
	private final S3Presigner presigner;
	private final ChartStorageProperties properties;
	public S3ChartAssetStore(S3Client client, S3Presigner presigner, ChartStorageProperties properties) {
		this.client = client; this.presigner = presigner; this.properties = properties;
	}
	@Override
	public SignedAsset sign(Kind kind, String key) {
		String bucket = kind == Kind.SHEET ? properties.sheetBucket() : properties.accompanimentBucket();
		try {
			client.headObject(b -> b.bucket(bucket).key(key));
			var request = GetObjectRequest.builder().bucket(bucket).key(key)
					.responseCacheControl("private, no-store").responseContentDisposition("inline").build();
			var signed = presigner.presignGetObject(GetObjectPresignRequest.builder()
					.signatureDuration(properties.urlTtl()).getObjectRequest(request).build());
			return new SignedAsset(signed.url().toExternalForm(), signed.expiration());
		} catch (S3Exception ex) {
			throw new BusinessException(ex.statusCode() == 404 ? ChartErrorCode.CHART_ASSET_NOT_FOUND : ChartErrorCode.CHART_ASSET_UNAVAILABLE);
		} catch (SdkException ex) {
			// SDK 예외에는 endpoint·서명 정보가 포함될 수 있어 원문을 로깅하거나 응답하지 않는다.
			throw new BusinessException(ChartErrorCode.CHART_ASSET_UNAVAILABLE);
		}
	}
}
