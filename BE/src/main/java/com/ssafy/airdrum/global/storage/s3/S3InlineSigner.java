package com.ssafy.airdrum.global.storage.s3;

import java.time.Duration;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

/** 공용 악보 버킷의 1시간 인라인 URL 서명. */
@Component
public class S3InlineSigner {
    private final ObjectProvider<S3Presigner> signer;
    private final boolean enabled;
    private final String bucket;
    public S3InlineSigner(ObjectProvider<S3Presigner> signer, @Value("${chart.assets.enabled:false}") boolean enabled,
            @Value("${chart.assets.sheet-bucket:}") String bucket) {
        this.signer=signer; this.enabled=enabled; this.bucket=bucket;
    }
    public String sign(String key) {
        var presigner=signer.getIfAvailable();
        if(!enabled || presigner==null) throw new IllegalStateException("악보 서명을 사용할 수 없습니다.");
        var get=GetObjectRequest.builder().bucket(bucket).key(key).responseCacheControl("private, no-store").responseContentDisposition("inline").build();
        return presigner.presignGetObject(GetObjectPresignRequest.builder().signatureDuration(Duration.ofHours(1)).getObjectRequest(get).build()).url().toExternalForm();
    }
}
