package com.ssafy.airdrum.domain.play.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** 본인 연주의 목록 요약. 현재 접근할 수 없는 곡의 제목은 노출하지 않는다. */
public record PlaySummaryResponse(UUID playId, Instant startedAt, Instant endedAt, String mode,
        String inputSource,
        @Schema(description = "연주에 참조된 곡 ID", nullable = true) Long songId,
        @Schema(description = "현재 조회할 수 있는 곡의 제목", nullable = true) String songTitle,
        @Schema(description = "연주에 고정된 채보 버전 ID", nullable = true) Long chartVersionId,
        @Schema(description = "고정된 채보 버전이 속한 연습 단계 ID", nullable = true) Long chartId,
        @Schema(description = "고정된 채보 버전의 난이도", nullable = true) String difficulty,
        @Schema(description = "종료 사유. null은 미기록", nullable = true, allowableValues = {"COMPLETED", "ABORTED", "DISCONNECTED"}) String endReason,
        @Schema(description = "현재 회원의 곡 상세 조회 조건 충족 여부. 재생 및 저장소 정상 상태를 보장하지 않음") boolean songAccessible,
        @Schema(description = "연주 점수", nullable = true) Integer score,
        @Schema(description = "정확도 백분율 (0~100)", nullable = true, minimum = "0", maximum = "100") BigDecimal accuracy,
        @Schema(description = "최대 콤보", nullable = true) Integer maxCombo,
        @Schema(description = "RHYTHM 또는 SHEET 연주에 리포트가 존재하는지 여부; AI 코칭 상태와 무관") boolean hasReport,
        @Schema(description = "연주 배율. 미기록이면 1") double playbackRate) {}
