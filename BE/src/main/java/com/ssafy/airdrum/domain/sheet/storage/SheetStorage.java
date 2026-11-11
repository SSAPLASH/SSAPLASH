package com.ssafy.airdrum.domain.sheet.storage;

import java.nio.file.Path;

/** 내 악보 파일 저장소(악보 버킷). 서버가 만든 귀속 키만 받는다. */
public interface SheetStorage {
    void put(String key,Path file,long size,String contentType);
    /** 1시간 유효한 보기 URL. 브라우저에서 바로 열리도록 inline으로 서명한다. */
    String sign(String key);
}
