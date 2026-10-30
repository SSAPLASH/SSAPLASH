package com.ssafy.airdrum.chart.worker;

import java.time.Duration;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;
import com.ssafy.airdrum.chart.asset.ChartStorageProperties;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.song.CoverStorage;
import com.ssafy.airdrum.song.SongManagementError;

@Component
class CoverStorageAdapter implements CoverStorage {
    private final S3WorkerStore store; private final ObjectProvider<S3Presigner> signer; private final ChartStorageProperties properties;
    CoverStorageAdapter(S3WorkerStore store,ObjectProvider<S3Presigner> signer,ChartStorageProperties properties) { this.store=store;this.signer=signer;this.properties=properties; }
    public void put(String key,byte[] data,String contentType) {
        try { store.putCover(key,data,contentType); } catch(RuntimeException ex) { throw unavailable(); }
    }
    public String sign(String key) {
        try {
            var presigner=signer.getIfAvailable();
            if(!properties.enabled() || presigner==null) throw unavailable();
            var get=GetObjectRequest.builder().bucket(properties.sheetBucket()).key(key).responseCacheControl("private, no-store").responseContentDisposition("inline").build();
            return presigner.presignGetObject(GetObjectPresignRequest.builder().signatureDuration(Duration.ofHours(1)).getObjectRequest(get).build()).url().toExternalForm();
        } catch(RuntimeException ex) { throw unavailable(); }
    }
    private static BusinessException unavailable() { return new BusinessException(SongManagementError.COVER_UNAVAILABLE); }
}
