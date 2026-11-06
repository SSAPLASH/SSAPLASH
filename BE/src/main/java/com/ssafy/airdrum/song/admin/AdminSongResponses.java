package com.ssafy.airdrum.song.admin;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

import com.ssafy.airdrum.song.meta.SongMetadata;

import io.swagger.v3.oas.annotations.media.Schema;

/** 운영자용 공용 곡 응답(설계 3-2절). 공용 곡은 항상 BUILTIN이라 출처 필드가 없다. */
public final class AdminSongResponses {
	private AdminSongResponses() {}
	public record AdminSongSummary(Long id, String title, String artist, String license, String status, BigDecimal bpm,
			String timeSignature, Integer durationMs, boolean hasAccompaniment, boolean hasCover, boolean published,
			List<String> difficulties, Instant createdAt, Instant updatedAt) {}
	public record AdminSongDetail(Long id, String title, String artist, String license, String status, BigDecimal bpm,
			String timeSignature, Integer durationMs, boolean hasAccompaniment, boolean hasCover, boolean published,
			List<String> difficulties, Instant createdAt, Instant updatedAt, String coverUrl, List<AdminChartSummary> charts,
			@Schema(description = "곡 추천용 메타데이터(255번). 저장소 카탈로그에서만 넣으며 없으면 null", nullable = true) SongMetadata metadata) {}
	public record AdminChartSummary(Long id, String difficulty, Long chartVersionId, int version, int noteCount,
			String notationStatus, String generator, String generatorVersion, Instant createdAt) {}
	public record CoverResponse(String coverUrl) {}
	public record AccompanimentResponse(String accompanimentUrl, Instant expiresAt) {}
}
