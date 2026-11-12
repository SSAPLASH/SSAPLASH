package com.ssafy.airdrum.domain.report.service.summary;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
import static com.ssafy.airdrum.domain.report.model.ReportSummaryInput.*;
import com.ssafy.airdrum.domain.report.model.ReportAggregate;
import com.ssafy.airdrum.domain.report.model.ReportSummaryInput;
import com.ssafy.airdrum.domain.report.model.ScoreRule;
import com.ssafy.airdrum.domain.report.model.ReportAggregate.Counts;

class ReportAggregatorTest {
	private final ReportAggregator aggregator = new ReportAggregator();
	@Test void missesAndUnmatchedHitsDoNotBecomeTimingOrVelocitySamples() {
		var result = aggregate(60, List.of(hit(0, Judgement.PERFECT, -20d, 80),
				hit(1, Judgement.GOOD, 40d, 100), hit(2, Judgement.MISS, null, null), hit(3, null, null, 127)));
		var snare = result.padStats().get(1);
		assertThat(snare.accuracy()).isEqualByComparingTo("0.5333");
		assertThat(snare.meanDeltaMs()).isEqualByComparingTo("10.00");
		assertThat(snare.meanVelocity()).isEqualByComparingTo("90.00");
		assertThat(snare.sampleCount()).isEqualTo(2);
		assertThat(snare.judgementCounts()).isEqualTo(new Counts(1, 1, 1));
		assertThat(result.timingHistogram().counts().stream().mapToInt(Integer::intValue).sum()).isEqualTo(2);
		assertThat(result.padStats()).extracting(ReportAggregate.PadStats::pad).containsExactly(Pad.values());
		assertThat(result.padStats().getFirst().accuracy()).isNull();
	}
	@Test void decimalEdgesZeroAndBothWindowEndpointsKeepTheirBins() {
		double[] deltas = {-60, -50.00000000000001, -50, -Double.MIN_VALUE, 0, 9.999999999999998, 10, 60};
		var hits = new ArrayList<Hit>();
		for (int i = 0; i < deltas.length; i++) hits.add(hit(i, Judgement.GOOD, deltas[i], 80));
		var histogram = aggregate(60, hits).timingHistogram();
		assertThat(histogram.fromMs()).isEqualTo(-60);
		assertThat(histogram.counts()).containsExactly(2, 1, 0, 0, 0, 1, 2, 1, 0, 0, 0, 1);
	}
	@Test void noSamplesDifferFromActualZeroAndAllMissesHaveZeroAccuracy() {
		var empty = aggregate(60, List.of());
		assertThat(empty.timingHistogram().counts()).containsOnly(0);
		assertThat(empty.padStats()).allSatisfy(p -> {
			assertThat(p.accuracy()).isNull(); assertThat(p.meanDeltaMs()).isNull(); assertThat(p.meanVelocity()).isNull();
		});
		var miss = aggregate(60, List.of(hit(0, Judgement.MISS, null, null))).padStats().get(1);
		assertThat(miss.accuracy()).isEqualByComparingTo("0");
		assertThat(miss.meanDeltaMs()).isNull(); assertThat(miss.meanVelocity()).isNull();
		var zero = aggregate(60, List.of(hit(0, Judgement.PERFECT, 0d, 0))).padStats().get(1);
		assertThat(zero.meanDeltaMs()).isEqualByComparingTo("0"); assertThat(zero.meanVelocity()).isEqualByComparingTo("0");
	}
	@Test void tinyAndLargestAllowedWindowsRemainBounded() {
		assertThat(aggregate(Double.MIN_VALUE, List.of(hit(0, Judgement.PERFECT, 0d, 80)))
				.timingHistogram().counts()).containsExactly(0, 1);
		assertThat(aggregate(1000, List.of(hit(0, Judgement.GOOD, 1000d, 80)))
				.timingHistogram().counts()).hasSize(200).endsWith(1);
	}
	@Test void maximumHitCountPreservesCountsAndMeans() {
		var hits = IntStream.range(0, 50_000).mapToObj(i -> hit(i, Judgement.PERFECT, i % 2 == 0 ? -20d : 20d, 127)).toList();
		var report = aggregate(60, hits);
		assertThat(report.padStats().get(1).sampleCount()).isEqualTo(50_000);
		assertThat(report.padStats().get(1).meanDeltaMs()).isEqualByComparingTo("0");
		assertThat(report.padStats().get(1).meanVelocity()).isEqualByComparingTo("127");
		assertThat(report.timingHistogram().counts().stream().mapToInt(Integer::intValue).sum()).isEqualTo(50_000);
	}
	@Test void padAccuracyFollowsTheScoreRuleOfThePlay() {
		var hits = List.of(hit(0, Judgement.PERFECT, -20d, 80), hit(1, Judgement.GOOD, 40d, 100), hit(2, Judgement.MISS, null, null));
		// (100 + 60) / 300, (100 + 80) / 300
		assertThat(aggregator.aggregate(new ReportSummaryInput(60, ScoreRule.SCORE_V1, hits)).padStats().get(1).accuracy()).isEqualByComparingTo("0.5333");
		assertThat(aggregator.aggregate(new ReportSummaryInput(60, ScoreRule.SCORE_V2, hits)).padStats().get(1).accuracy()).isEqualByComparingTo("0.6000");
	}
	private ReportAggregate aggregate(double goodMs, List<Hit> hits) {
		return aggregator.aggregate(new ReportSummaryInput(goodMs, ScoreRule.SCORE_V1, hits));
	}
	private static Hit hit(int seq, Judgement judgement, Double delta, Integer velocity) {
		return new Hit(Pad.SNARE, judgement, delta, velocity);
	}
}
