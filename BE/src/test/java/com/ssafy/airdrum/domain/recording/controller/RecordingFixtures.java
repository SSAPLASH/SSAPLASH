package com.ssafy.airdrum.domain.recording.controller;

import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

/** 256번 녹음 저장 요청 본문. 테스트마다 문자열을 바꿔 잘못된 입력을 만든다. */
public final class RecordingFixtures {
	public static final UUID KEY = UUID.fromString("5b0f7a1e-2c3d-4e5f-8a9b-0c1d2e3f4a5b");

	private RecordingFixtures() {
	}

	/** 타격 3개(시간순), 자유 모드, 스틱 입력. */
	public static String free(UUID key) {
		return """
				{"schemaVersion":1,"clientKey":"%s","title":"  즉흥 연주 1 ","mode":"FREE","inputSource":"STICK","playId":null,
				"startedAt":"2026-11-03T01:00:00Z","durationMs":1500,
				"hits":[{"tMs":0,"pad":"SNARE","velocity":90,"stickId":1},{"tMs":250.5,"pad":"HI_TOM","velocity":64,"stickId":0},{"tMs":1000,"pad":"KICK","velocity":110}]}
				""".formatted(key);
	}

	/** 같은 시각 0.0에 n개, 마지막 시각 durationMs 1. */
	public static String many(UUID key, int n) {
		String hits = IntStream.range(0, n).mapToObj(i -> "{\"tMs\":0,\"pad\":\"SNARE\",\"velocity\":1}").collect(Collectors.joining(","));
		return "{\"schemaVersion\":1,\"clientKey\":\"" + key + "\",\"title\":\"많은 타격\",\"mode\":\"FREE\",\"inputSource\":\"KEYBOARD\","
				+ "\"startedAt\":\"2026-11-03T01:00:00Z\",\"durationMs\":1,\"hits\":[" + hits + "]}";
	}
}
