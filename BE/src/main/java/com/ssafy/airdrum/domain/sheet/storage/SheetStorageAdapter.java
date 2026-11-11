package com.ssafy.airdrum.domain.sheet.storage;

import java.nio.file.Path;
import org.springframework.stereotype.Component;
import com.ssafy.airdrum.domain.sheet.exception.SheetError;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.global.storage.s3.S3InlineSigner;
import com.ssafy.airdrum.global.storage.s3.S3StorageResources;

/** 내 악보 쓰기와 인라인 URL 서명. */
@Component
class SheetStorageAdapter implements SheetStorage {
    private final S3StorageResources storage; private final S3InlineSigner signer;
    SheetStorageAdapter(S3StorageResources storage,S3InlineSigner signer) { this.storage=storage; this.signer=signer; }
    public void put(String key,Path file,long size,String contentType) {
        try { storage.putSheet(key,file,size,contentType); } catch(RuntimeException ex) { throw unavailable(); }
    }
    public String sign(String key) {
        try { return signer.sign(key); } catch(RuntimeException ex) { throw unavailable(); }
    }
    private static BusinessException unavailable() { return new BusinessException(SheetError.SHEET_UNAVAILABLE); }
}
