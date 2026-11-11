package com.ssafy.airdrum.domain.lesson.dto;

import java.math.BigDecimal;
import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;

/** 입문 코스 레슨 목록과 본인 진도(331번 설계 3-3절). */
public record LessonsResponse(
		@Schema(description = "연주 레슨 통과 기준 정확도(백분율)", example = "70") int passAccuracy,
		List<Item> items) {

	public LessonsResponse {
		items = List.copyOf(items);
	}

	@Schema(name = "LessonItem")
	public record Item(
			@Schema(description = "순서(1부터)") int order,
			@Schema(description = "READ: 악보가 흐르지 않는 알아보기, PLAY: 악보 연습 화면으로 치는 연주", allowableValues = { "READ", "PLAY" }) String kind,
			long songId,
			@Schema(description = "레슨 채보(NORMAL)") long chartId,
			String title,
			String summary,
			@Schema(description = "치는 패드") List<String> pads,
			@Schema(description = "알아보기에서 음표 이름과 드럼을 처음부터 알려 주는가") boolean guide,
			@Schema(nullable = true) BigDecimal bpm,
			@Schema(nullable = true) Integer durationMs,
			int noteCount,
			@Schema(description = "연주 레슨: 본인의 악보 연습 최고 정확도(0~100). 알아보기는 항상 null", nullable = true) BigDecimal bestAccuracy,
			@Schema(description = "통과. 연주는 최고 정확도가 기준 이상, 알아보기는 완료 기록 있음") boolean passed,
			@Schema(description = "앞 순서 레슨 중 통과하지 못한 것이 있음") boolean locked) {
	}
}
