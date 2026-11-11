package com.ssafy.airdrum.domain.lesson.model;

import java.util.HashSet;
import java.util.List;

import com.ssafy.airdrum.domain.chart.model.DrumPad;

/**
 * 카탈로그 한 곡에 붙는 레슨 정보(331번 설계 3-1절). 값 규칙은 여기서 검사하고 어기면 {@link IllegalArgumentException}이다.
 * 순서가 카탈로그 안에서 1부터 이어지는지는 카탈로그가 본다.
 *
 * @param order   1 이상 순서
 * @param summary 1~200자 설명
 * @param pads    1~4개 패드 이름(중복 없음)
 * @param guide   알아보기에서 음표 이름과 드럼을 처음부터 알려 주는가. 연주 레슨은 항상 참
 */
public record LessonSpec(int order, LessonKind kind, String summary, List<String> pads, boolean guide) {

	static final int SUMMARY_MAX = 200;
	static final int PADS_MAX = 4;

	public LessonSpec {
		if (order < 1) throw new IllegalArgumentException("order는 1 이상이어야 합니다.");
		if (kind == null) throw new IllegalArgumentException("kind가 없습니다.");
		if (summary == null || summary.isBlank()) throw new IllegalArgumentException("summary가 비어 있습니다.");
		if (summary.codePointCount(0, summary.length()) > SUMMARY_MAX)
			throw new IllegalArgumentException("summary는 " + SUMMARY_MAX + "자 이하여야 합니다.");
		if (pads == null || pads.isEmpty() || pads.size() > PADS_MAX)
			throw new IllegalArgumentException("pads는 1~" + PADS_MAX + "개여야 합니다.");
		var seen = new HashSet<String>();
		for (var pad : pads) {
			try {
				DrumPad.valueOf(pad);
			} catch (IllegalArgumentException | NullPointerException e) {
				throw new IllegalArgumentException("pads에 모르는 패드가 있습니다: " + pad);
			}
			if (!seen.add(pad)) throw new IllegalArgumentException("pads에 같은 패드가 두 번 있습니다: " + pad);
		}
		if (kind == LessonKind.PLAY && !guide) throw new IllegalArgumentException("guide는 READ 레슨에만 쓴다.");
		pads = List.copyOf(pads);
	}
}
