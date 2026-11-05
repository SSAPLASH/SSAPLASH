package com.ssafy.airdrum.song.recommend;

import java.util.List;
import java.util.UUID;
import io.swagger.v3.oas.annotations.media.Schema;
import com.ssafy.airdrum.song.SongResponses.SongSummary;

public final class RecommendationResponses {
	private RecommendationResponses() {}
	public record Reason(
			@Schema(allowableValues = {"CHALLENGE", "WEAK_PAD", "NEW_SONG", "RETRY", "STARTER"}) String code,
			@Schema(description = "화면에 그대로 보여 줄 한국어 문구") String text) {}
	public record Item(SongSummary song, long chartId,
			@Schema(allowableValues = {"EASY", "NORMAL", "HARD"}) String difficulty, List<Reason> reasons) {}
	public record Recommendations(@Schema(description = "클릭 기록에 쓰는 키") UUID requestId, @Schema(allowableValues = {"RULE_V1", "R3_V1"}) String strategy, List<Item> items) {}
	public record ClickRequest(@Schema(description = "누른 추천 곡") Long songId) {}
}
