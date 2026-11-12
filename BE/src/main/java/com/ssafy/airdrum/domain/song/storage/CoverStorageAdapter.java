package com.ssafy.airdrum.domain.song.storage;

import org.springframework.stereotype.Component;
import com.ssafy.airdrum.domain.song.exception.SongManagementError;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.global.storage.s3.S3InlineSigner;
import com.ssafy.airdrum.global.storage.s3.S3StorageResources;

@Component
class CoverStorageAdapter implements CoverStorage {
    private final S3StorageResources storage; private final S3InlineSigner signer;
    CoverStorageAdapter(S3StorageResources storage,S3InlineSigner signer) { this.storage=storage; this.signer=signer; }
    public void put(String key,byte[] data,String contentType) {
        try { storage.putCover(key,data,contentType); } catch(RuntimeException ex) { throw unavailable(); }
    }
    public String sign(String key) {
        try { return signer.sign(key); } catch(RuntimeException ex) { throw unavailable(); }
    }
    private static BusinessException unavailable() { return new BusinessException(SongManagementError.COVER_UNAVAILABLE); }
}
