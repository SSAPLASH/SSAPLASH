package com.ssafy.airdrum.domain.play.support;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.zip.GZIPOutputStream;

public final class PlayFixtures {
	private PlayFixtures() {}
	public static String free(UUID id) {
		return """
			{"schemaVersion":1,"playId":"%s","mode":"FREE","inputSource":"STICK",
			"startedAt":"2026-10-21T00:00:00Z","endedAt":"2026-10-21T00:01:00Z","consent":false,
			"hits":[{"seq":0,"tMs":-10.125,"stickId":0,"pad":"SNARE","velocity":85,
			"peakAccel":1.25,"pitch":20,"yaw":-10}]}
			""".formatted(id);
	}
	public static String scored(UUID id,long song,long version) {
		return """
			{"schemaVersion":1,"playId":"%s","mode":"RHYTHM","inputSource":"KEYBOARD",
			"songId":%d,"chartVersionId":%d,"startedAt":"2026-10-21T00:00:00Z",
			"endedAt":"2026-10-21T00:01:00Z","consent":false,
			"judgementContext":{"schemaVersion":1,"judgementVersion":"SCORE_V1",
			"timingWindows":{"perfectMs":25,"goodMs":60},"playbackRate":1,"padMapping":{}},
			"summary":{"score":100,"accuracy":50,"maxCombo":1,"judgementCounts":{"perfect":1,"good":0,"miss":1}},
			"hits":[{"seq":0,"tMs":100.125,"pad":"SNARE","velocity":100,"judgement":"PERFECT","matchedNoteId":"n1","deltaMs":0.125},
			{"seq":1,"tMs":200,"pad":"KICK","judgement":"MISS","matchedNoteId":"n2"}]}
			""".formatted(id,song,version);
	}
	public static String raw(UUID id) {
		return """
			{"schemaVersion":1,"playId":"%s","clockContext":{"sensorTickHz":1000,
			"browserClock":"PERFORMANCE_NOW","audioClock":"SONG_POSITION"},
			"hits":[{"seq":0,"stickId":0,"hitId":"sensor-1","tHit":1000,"tRecv":1200.25,
			"tResolved":1201.5,"tAudio":-10.125,"swingWindow":{"sampleRateHz":100,
			"accelScale":0.001,"gyroScale":0.001,"samples":[[-32768,32767,0,1,2,3],[0,0,0,0,0,0]]}}]}
			""".formatted(id);
	}
	public static byte[] gzip(String json) {
		try { var out=new ByteArrayOutputStream(); try(var gz=new GZIPOutputStream(out)) { gz.write(json.getBytes(StandardCharsets.UTF_8)); } return out.toByteArray(); }
		catch(java.io.IOException ex) { throw new java.io.UncheckedIOException(ex); }
	}
}
