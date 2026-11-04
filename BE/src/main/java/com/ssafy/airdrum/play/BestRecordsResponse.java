package com.ssafy.airdrum.play;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.util.List;

/** 요청한 곡의 연습 단계·모드별 최고 기록. */
public record BestRecordsResponse(List<Item> items) {
    public BestRecordsResponse { items = List.copyOf(items); }

    @Schema(name = "BestRecordItem")
    public record Item(long songId, long chartId, String difficulty, String mode,
            @Schema(description = "독립적으로 집계한 최고 점수", nullable = true) Integer bestScore,
            @Schema(description = "독립적으로 집계한 최고 정확도 백분율 (0~100)", nullable = true, minimum = "0", maximum = "100") BigDecimal bestAccuracy) {}
}
