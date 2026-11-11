package com.ssafy.airdrum.domain.recommendation.service.drill;

import static org.assertj.core.api.Assertions.*;

import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import com.ssafy.airdrum.domain.recommendation.service.drill.DrillPlanner.Weakness;

/** 리포트 약점 JSON을 연습 추천 입력으로 바꾸는 규칙. DB 없이 돈다. */
class DrillInputsTest {
	final DrillInputs inputs = new DrillInputs(null, JsonMapper.builder().build());

	@Test void 패턴과_패드와_심각도를_읽는다() {
		var result = inputs.weaknesses("""
				[{"pattern":"TRANSITION_LATE","pads":["HIHAT","SNARE"],"metrics":{"severity":0.7}}]
				""");
		assertThat(result).containsExactly(new Weakness("TRANSITION_LATE", List.of("HIHAT", "SNARE"), 0.7));
	}

	@Test void 분석_전이거나_형식이_틀리면_빈_목록이다() {
		assertThat(inputs.weaknesses(null)).isEmpty();
		assertThat(inputs.weaknesses("{}")).isEmpty();
		assertThat(inputs.weaknesses("not json")).isEmpty();
		assertThat(inputs.weaknesses("[]")).isEmpty();
	}

	@Test void 패턴이_없는_항목은_건너뛰고_나머지는_읽는다() {
		var result = inputs.weaknesses("""
				[{"pads":["SNARE"]},"oops",{"pattern":"UNSTEADY","pads":[],"metrics":{"severity":0.4}}]
				""");
		assertThat(result).extracting(Weakness::pattern).containsExactly("UNSTEADY");
	}

	@Test void 심각도가_없으면_기본값이고_범위_밖은_자른다() {
		var result = inputs.weaknesses("""
				[{"pattern":"A"},{"pattern":"B","metrics":{"severity":3}},{"pattern":"C","metrics":{"severity":-1}}]
				""");
		assertThat(result).extracting(Weakness::severity).containsExactly(DrillInputs.DEFAULT_SEVERITY, 1.0, 0.0);
	}

	@Test void 패드가_없거나_문자가_아니면_뺀다() {
		var result = inputs.weaknesses("""
				[{"pattern":"A"},{"pattern":"B","pads":["SNARE",1,""]}]
				""");
		assertThat(result.get(0).pads()).isEmpty();
		assertThat(result.get(1).pads()).containsExactly("SNARE");
	}
}
