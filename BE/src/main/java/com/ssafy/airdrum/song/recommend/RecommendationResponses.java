package com.ssafy.airdrum.song.recommend;

import java.util.List;
import java.util.UUID;
import com.fasterxml.jackson.annotation.JsonInclude;
import io.swagger.v3.oas.annotations.media.Schema;
import com.ssafy.airdrum.song.SongResponses.SongSummary;

public final class RecommendationResponses {
	private RecommendationResponses() {}
	public record Reason(
			@Schema(allowableValues = {"CHALLENGE", "WEAK_PAD", "NEW_SONG", "RETRY", "STARTER", "DRILL_PAD", "DRILL_TRANSITION", "DRILL_TIMING", "DRILL_MISS"}) String code,
			@Schema(description = "화면에 그대로 보여 줄 한국어 문구") String text) {}
	/** 어떤 약점을 위한 연습인지. {@code pads}는 리포트 약점의 값이고 전환이면 [앞, 뒤] 순서다. */
	public record Focus(String pattern, List<String> pads) {}
	public record Item(SongSummary song, long chartId,
			@Schema(allowableValues = {"EASY", "NORMAL", "HARD"}) String difficulty, List<Reason> reasons,
			@Schema(description = "context=DRILL에서만 온다") @JsonInclude(JsonInclude.Include.NON_NULL) Focus focus) {}
	public record Recommendations(@Schema(description = "클릭 기록에 쓰는 키") UUID requestId, @Schema(allowableValues = {"RULE_V1", "R3_V1", "DRILL_V1"}) String strategy, List<Item> items) {}
	public record ClickRequest(@Schema(description = "누른 추천 곡") Long songId) {}
}
