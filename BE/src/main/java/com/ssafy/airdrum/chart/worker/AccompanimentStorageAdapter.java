package com.ssafy.airdrum.chart.worker;

import java.nio.file.Path;
import org.springframework.stereotype.Component;
import com.ssafy.airdrum.song.AccompanimentStorage;

/** 공용 곡 반주 쓰기. 워커의 반주 버킷 쓰기 자격증명을 그대로 쓴다. */
@Component
class AccompanimentStorageAdapter implements AccompanimentStorage {
    private final S3WorkerStore store;
    AccompanimentStorageAdapter(S3WorkerStore store) { this.store=store; }
    public void put(String key,Path file,long size,String contentType) { store.putAccompaniment(key,file,size,contentType); }
}
