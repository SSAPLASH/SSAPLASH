package com.ssafy.airdrum.report;

import java.math.BigDecimal;
import java.util.List;
import com.ssafy.airdrum.play.PlayUploadRequest.Counts;
import com.ssafy.airdrum.play.PlayUploadRequest.Pad;

/** BE_REPORT_V1 저장 형식. accuracy는 내부 비율이며 공개 백분율은 원본 판정 개수에서 계산한다. */
public record ReportAggregate(TimingHistogram timingHistogram, List<PadStats> padStats) {
	public static final String GENERATOR_VERSION = "BE_REPORT_V1";
	public ReportAggregate { padStats = List.copyOf(padStats); }
	public record TimingHistogram(int binMs, int fromMs, List<Integer> counts) {
		public TimingHistogram { counts = List.copyOf(counts); }
	}
	public record PadStats(Pad pad, BigDecimal accuracy, BigDecimal meanDeltaMs,
			BigDecimal meanVelocity, Counts judgementCounts, int sampleCount) {}
}
