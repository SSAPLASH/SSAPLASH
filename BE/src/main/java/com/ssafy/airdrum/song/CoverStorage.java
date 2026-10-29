package com.ssafy.airdrum.song;

/** 비공개 커버 저장소. 서버가 만든 귀속 키만 받는다. */
public interface CoverStorage {
    void put(String key,byte[] data,String contentType);
    String sign(String key);
}
