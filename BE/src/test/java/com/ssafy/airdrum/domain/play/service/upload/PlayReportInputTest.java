package com.ssafy.airdrum.domain.play.service.upload;

import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;
import static com.ssafy.airdrum.domain.play.dto.PlayUploadRequest.*;
import com.ssafy.airdrum.domain.play.dto.PlayUploadRequest;

class PlayReportInputTest {
	@Test void mapsEveryPadAndPreservesJudgementAndSamples() {
		var hits = Arrays.stream(Pad.values()).map(pad -> new Hit(0, 0d, null, pad, null, null, 90,
				null, null, null, Judgement.GOOD, "note", -12.5)).toList();
		var p = new PlayUploadRequest(1, null, Mode.RHYTHM, InputSource.KEYBOARD, null, null, null, null, null,
				new JudgementContext(1, "SCORE_V1", new TimingWindows(20d, 60d), 1d, null),
				null, null, false, null, hits, List.of(), null);
		var input = PlayReportInput.from(p);
		assertThat(input.goodMs()).isEqualTo(60d);
		assertThat(input.hits()).extracting(h -> h.pad().name()).containsExactlyElementsOf(
				Arrays.stream(Pad.values()).map(Enum::name).toList());
		assertThat(input.hits()).allSatisfy(h -> {
			assertThat(h.judgement().name()).isEqualTo("GOOD");
			assertThat(h.deltaMs()).isEqualTo(-12.5);
			assertThat(h.velocity()).isEqualTo(90);
		});
	}
}
