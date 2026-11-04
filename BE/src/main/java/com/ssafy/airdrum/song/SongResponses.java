package com.ssafy.airdrum.song;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import com.ssafy.airdrum.chart.job.JobSnapshot.JobError;
import io.swagger.v3.oas.annotations.media.Schema;

public final class SongResponses {
	private SongResponses() {}
	public record SongSummary(Long id, String title, String artist, String source, String status,
			BigDecimal bpm, String timeSignature, Integer durationMs, boolean hasAccompaniment,
			List<String> difficulties, Instant createdAt, String coverUrl,
			@Schema(description = "곡 난이도; 미산정 시 null", allowableValues = {"BEGINNER", "INTERMEDIATE", "ADVANCED"}, nullable = true) String songLevel,
			@Schema(description = "본인 곡의 최신 실패 작업에 대한 안전한 오류; 그 외 null", nullable = true) JobError chartFailure) {}
	public record SongDetail(Long id, String title, String artist, String source, String status,
			BigDecimal bpm, String timeSignature, Integer durationMs, boolean hasAccompaniment,
			List<String> difficulties, Instant createdAt, String license, Instant updatedAt,
			List<ChartSummary> charts, String coverUrl,
			@Schema(description = "곡 난이도; 미산정 시 null", allowableValues = {"BEGINNER", "INTERMEDIATE", "ADVANCED"}, nullable = true) String songLevel,
			@Schema(description = "본인 곡의 최신 실패 작업에 대한 안전한 오류; 그 외 null", nullable = true) JobError chartFailure) {}
	public record ChartSummary(Long id, String difficulty, Long chartVersionId, int version,
			int noteCount, String notationStatus) {}
	public record Accompaniment(String accompanimentUrl, Instant expiresAt) {}
}
