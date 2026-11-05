package com.ssafy.airdrum.song.similar;

import java.util.List;
import java.util.UUID;
import io.swagger.v3.oas.annotations.media.Schema;
import com.ssafy.airdrum.song.SongResponses.SongSummary;

public final class SimilarResponses {
	private SimilarResponses() {}
	public record Item(SongSummary song, long chartId,
			@Schema(allowableValues = {"EASY", "NORMAL", "HARD"}) String difficulty,
			@Schema(description = "0~1. 화면에는 숫자로 보이지 않기를 권장") double similarity,
			@Schema(description = "점수에 크게 기여한 요소 최대 2개", allowableValues = {"RHYTHM", "PADS", "TRANSITIONS", "DENSITY", "TEMPO", "GENRE", "MOOD", "DRUM_STYLE", "ENERGY"}) List<String> matchedOn) {}
	public record Similar(@Schema(description = "클릭 기록에 쓰는 키") UUID requestId, @Schema(example = "SIMILAR_V1") String strategy, List<Item> items) {}
}
