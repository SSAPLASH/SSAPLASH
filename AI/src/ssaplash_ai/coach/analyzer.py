"""약점 분석 진입점: 요청 → 노트 표 → 패턴 후보 → 선택 → 응답."""

from __future__ import annotations

from ssaplash_ai.coach.advice import detail_for, level_for, tip_for
from ssaplash_ai.coach.config import (
    ANALYZER_VERSION,
    DEFAULT_THRESHOLDS,
    MIN_NOTES,
    Thresholds,
)
from ssaplash_ai.coach.notes import NoteTable, build_notes
from ssaplash_ai.coach.patterns import DETECTORS, Candidate
from ssaplash_ai.coach.schema import AnalysisRequest, AnalysisResponse, WeakSegment
from ssaplash_ai.coach.select import select_candidates
from ssaplash_ai.coach.summary import build_summary


def analyze(
    request: AnalysisRequest, thresholds: Thresholds = DEFAULT_THRESHOLDS
) -> AnalysisResponse:
    return analyze_notes(build_notes(request), thresholds)


def analyze_notes(
    notes: NoteTable, thresholds: Thresholds = DEFAULT_THRESHOLDS
) -> AnalysisResponse:
    if notes.size < MIN_NOTES:
        return AnalysisResponse(
            analyzerVersion=ANALYZER_VERSION, reason="INSUFFICIENT_HITS", weakSegments=[]
        )

    candidates: list[Candidate] = []
    for detect in DETECTORS:
        candidates.extend(detect(notes, thresholds))
    chosen = select_candidates(candidates)

    segments = [_to_segment(c) for c in chosen]
    return AnalysisResponse(
        analyzerVersion=ANALYZER_VERSION,
        reason="OK" if segments else "NO_WEAKNESS",
        weakSegments=segments,
        summary=build_summary(notes, segments),
    )


def _to_segment(c: Candidate) -> WeakSegment:
    # metrics의 severity 자리(맨 앞)를 반올림한 값으로 채운다
    metrics = {**c.metrics, "severity": round(c.severity, 2)}
    return WeakSegment(
        fromMs=c.from_ms,
        toMs=c.to_ms,
        pattern=c.pattern,
        description=c.description,
        tip=tip_for(c.pattern, c.pads),
        detail=detail_for(c.pattern, c.pads, metrics, c.from_ms, c.to_ms),
        severityLevel=level_for(float(metrics["severity"])),  # type: ignore[arg-type]
        causeTags=c.cause_tags,
        pads=c.pads,
        metrics=metrics,
    )
