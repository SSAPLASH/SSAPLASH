package com.ssafy.airdrum.song.midi;

import java.nio.file.Path;

public interface MidiBackingStore {
    void put(String key, Path path, long size, String sha256, long deadlineNanos);
    boolean exists(String key);
    void delete(String key);
}
