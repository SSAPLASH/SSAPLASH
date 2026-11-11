package com.ssafy.airdrum.domain.song.storage.audio;

import java.nio.file.Path;

public interface AudioStore {
    void checkAvailable();

    void put(String key, Path path, long size, String contentType);

    boolean exists(String key);

    void delete(String key);
}
