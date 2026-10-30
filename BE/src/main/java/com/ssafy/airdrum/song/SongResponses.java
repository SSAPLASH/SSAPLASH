package com.ssafy.airdrum.song;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public final class SongResponses {
	private SongResponses() {}
	public record SongSummary(Long id, String title, String artist, String source, String status,
			BigDecimal bpm, String timeSignature, Integer durationMs, boolean hasAccompaniment,
			List<String> difficulties, Instant createdAt, String coverUrl) {}
	public record SongDetail(Long id, String title, String artist, String source, String status,
			BigDecimal bpm, String timeSignature, Integer durationMs, boolean hasAccompaniment,
			List<String> difficulties, Instant createdAt, String license, Instant updatedAt,
			List<ChartSummary> charts, String coverUrl) {}
	public record ChartSummary(Long id, String difficulty, Long chartVersionId, int version,
			int noteCount, String notationStatus) {}
}
