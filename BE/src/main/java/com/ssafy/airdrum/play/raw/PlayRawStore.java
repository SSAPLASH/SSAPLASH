package com.ssafy.airdrum.play.raw;

import java.io.InputStream;
import java.util.function.Supplier;

public interface PlayRawStore {
	void checkAvailable();
	void put(String key, long compressedBytes, Supplier<InputStream> content);
	boolean exists(String key);
	void delete(String key);
}
