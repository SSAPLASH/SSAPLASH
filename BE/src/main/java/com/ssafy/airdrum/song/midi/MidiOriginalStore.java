package com.ssafy.airdrum.song.midi;

/** 원본은 외부에 서명 URL을 발급하지 않는 전용 비공개 저장소에 둔다. */
public interface MidiOriginalStore {
    void putAndVerify(String key, byte[] bytes, String sha256);
    byte[] get(String key, int size, String sha256, long deadlineNanos);
    default byte[] get(String key, int size, String sha256) {
        return get(key,size,sha256,System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(30));
    }
    boolean exists(String key);
    void delete(String key);
}
