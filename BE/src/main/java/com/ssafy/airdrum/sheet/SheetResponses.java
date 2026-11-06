package com.ssafy.airdrum.sheet;

import java.time.Instant;
import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;

/** 내 악보 응답(155번 설계 3절). URL은 1시간 서명이며 내부 키는 내보내지 않는다. */
final class SheetResponses {
	private SheetResponses() {}

	@Schema(description = "악보 목록 항목")
	record SheetSummary(long id, String title, String source, String kind, int pageCount, long totalBytes,
			@Schema(description = "이미지 악보는 1쪽 보기 URL, PDF는 null") String thumbnailUrl, Instant createdAt, Instant updatedAt,
			@Schema(description = "연결된 개인 곡(248번). 곡 없는 악보는 null", nullable = true) Long songId) {}

	@Schema(description = "악보 상세")
	record SheetDetail(long id, String title, String source, String kind, int pageCount, long totalBytes, String thumbnailUrl,
			Instant createdAt, Instant updatedAt, List<SheetPage> pages, @Schema(description = "보기 URL 만료 시각") Instant expiresAt,
			@Schema(description = "연결된 개인 곡(248번). 곡 없는 악보는 null", nullable = true) Long songId) {}

	@Schema(description = "악보 페이지")
	record SheetPage(int pageNo, String url, String contentType, Integer width, Integer height, long bytes) {}
}
