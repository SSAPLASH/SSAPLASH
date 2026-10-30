package com.ssafy.airdrum.report;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import tools.jackson.databind.JsonNode;
import com.ssafy.airdrum.play.PlayUploadRequest.Counts;
import com.ssafy.airdrum.play.PlayUploadRequest.Pad;
import com.ssafy.airdrum.report.ReportAggregate.TimingHistogram;

/** 공개 accuracy는 모두 백분율이다. 내부 V1 저장 비율을 그대로 노출하지 않는다. */
public record ReportResponse(long id, UUID playId, int score, BigDecimal accuracy, int maxCombo,
        Counts judgementCounts, TimingHistogram timingHistogram, List<PadStats> padStats,
        String mode, String inputSource, String endReason, AnalysisStatus analysisStatus,
        JsonNode weakSegments, JsonNode recommendedDrills, String generatorVersion, Instant generatedAt) {
    public ReportResponse { padStats = List.copyOf(padStats); }
    public enum AnalysisStatus { NOT_REQUESTED, PENDING, DONE, FAILED }
    public record PadStats(Pad pad, BigDecimal accuracy, BigDecimal meanDeltaMs, BigDecimal meanVelocity,
            Counts judgementCounts, int sampleCount) {
        static PadStats from(ReportAggregate.PadStats stored) {
            Counts c = stored.judgementCounts();
            long evaluated = (long) c.perfect() + c.good() + c.miss();
            // 반올림된 저장 비율을 재변환하지 않고 원본 개수에서 한 번만 반올림한다.
            BigDecimal percent = evaluated == 0 ? null : BigDecimal.valueOf(c.perfect() * 100L + c.good() * 60L)
                    .divide(BigDecimal.valueOf(evaluated), 2, RoundingMode.HALF_UP);
            return new PadStats(stored.pad(), percent, stored.meanDeltaMs(), stored.meanVelocity(), c, stored.sampleCount());
        }
    }
}
