package com.ssafy.airdrum.domain.song.storage;

import java.nio.file.Path;
import org.springframework.stereotype.Component;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.global.storage.s3.S3StorageResources;
import com.ssafy.airdrum.global.worker.WorkerError;

/** 공용 곡 반주 쓰기. 기존 반주 버킷 쓰기 권한을 사용한다. */
@Component
class AccompanimentStorageAdapter implements AccompanimentStorage {
    private final S3StorageResources storage;
    AccompanimentStorageAdapter(S3StorageResources storage) { this.storage=storage; }
    public void put(String key,Path file,long size,String contentType) {
        try { storage.putAccompaniment(key,file,size,contentType); }
        catch(RuntimeException ex) { throw new BusinessException(WorkerError.UNAVAILABLE); }
    }
}
