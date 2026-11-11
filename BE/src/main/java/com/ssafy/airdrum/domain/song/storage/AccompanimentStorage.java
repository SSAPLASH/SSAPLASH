package com.ssafy.airdrum.domain.song.storage;

import java.nio.file.Path;

/** 비공개 반주 저장소(156번 공용 곡 반주). 서버가 만든 귀속 키만 받는다. 같은 키에 덮어쓰지 않는다. */
public interface AccompanimentStorage {
    void put(String key,Path file,long size,String contentType);
}
