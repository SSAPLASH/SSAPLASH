package com.ssafy.airdrum.chart.worker;

import java.nio.file.Path;
import java.time.Duration;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;
import com.ssafy.airdrum.chart.asset.ChartStorageProperties;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.sheet.SheetError;
import com.ssafy.airdrum.sheet.SheetStorage;

/** 내 악보(155번) 쓰기·서명. 커버와 같은 악보 버킷 쓰기 자격증명과 읽기 서명을 쓴다. */
@Component
class SheetStorageAdapter implements SheetStorage {
    private final S3WorkerStore store; private final ObjectProvider<S3Presigner> signer; private final ChartStorageProperties properties;
    SheetStorageAdapter(S3WorkerStore store,ObjectProvider<S3Presigner> signer,ChartStorageProperties properties) { this.store=store;this.signer=signer;this.properties=properties; }
    public void put(String key,Path file,long size,String contentType) {
        try { store.putSheetMusic(key,file,size,contentType); } catch(RuntimeException ex) { throw unavailable(); }
    }
    public String sign(String key) {
        try {
            var presigner=signer.getIfAvailable();
            if(!properties.enabled() || presigner==null) throw unavailable();
            var get=GetObjectRequest.builder().bucket(properties.sheetBucket()).key(key).responseCacheControl("private, no-store").responseContentDisposition("inline").build();
            return presigner.presignGetObject(GetObjectPresignRequest.builder().signatureDuration(Duration.ofHours(1)).getObjectRequest(get).build()).url().toExternalForm();
        } catch(RuntimeException ex) { throw unavailable(); }
    }
    private static BusinessException unavailable() { return new BusinessException(SheetError.SHEET_UNAVAILABLE); }
}
