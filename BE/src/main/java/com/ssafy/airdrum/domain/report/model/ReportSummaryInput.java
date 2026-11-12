package com.ssafy.airdrum.domain.report.model;

import java.util.List;
import com.fasterxml.jackson.annotation.JsonAlias;

/** 검증된 판정 데이터 중 리포트 집계에 필요한 값. {@code rule}은 그 기록의 점수 규칙(패드 정확도의 GOOD 점수). */
public record ReportSummaryInput(double goodMs, ScoreRule rule, List<Hit> hits) {
	public ReportSummaryInput { hits = List.copyOf(hits); }
	public enum Pad { HIHAT, SNARE, @JsonAlias("HI_TOM") SMALL_TOM, MID_TOM, FLOOR_TOM, CRASH, RIDE, KICK, HIHAT_PEDAL }
	public enum Judgement { PERFECT, GOOD, MISS }
	public record Hit(Pad pad, Judgement judgement, Double deltaMs, Integer velocity) {}
}
