"""연주 중 LLM 구간 코칭 평가: 골든 사실, 집계, 보고서. 가짜 생성기를 쓴다(모델 서버 없이)."""

from __future__ import annotations

import json
import math

from ssaplash_ai.coach_eval.live_tip_compare import (
    build_cases,
    markdown,
    percentile,
    run,
    summarize,
)

GOOD = json.dumps({"title": "킥에 맞춰요", "sub": "킥 소리에 손을 맞춰요"}, ensure_ascii=False)


def test_골든_사실은_10가지이고_키보드와_잘_친_구간을_담는다() -> None:
    cases = build_cases()
    assert len(cases) == 10
    assert cases["키보드 늦음"].input == "keyboard"
    assert cases["잘 친 구간"].previous.lastTip is not None
    assert {"WRONG_PAD", "TRANSITION", "DENSE", "DRIFT_LATE"} <= {
        c for f in cases.values() for c in f.ruleCoach.causes
    }


def test_모두_통과하면_통과율_1이고_목표를_본다() -> None:
    trials = run(lambda s, u: GOOD, repeat=2)
    s = summarize("fake", trials)
    assert s.trials == 20 and s.passRate == 1.0 and s.firstTryRate == 1.0
    assert s.meetsTarget


def test_거절_이유를_센다() -> None:
    long = json.dumps({"title": "아주 긴 제목을 쓰는 모델", "sub": ""}, ensure_ascii=False)
    trials = run(lambda s, u: long, repeat=1)
    s = summarize("fake", trials)
    assert s.passRate == 0.0 and not s.meetsTarget
    assert s.violations.get("제목이 8자를 넘음", 0) >= 10


def test_백분위와_보고서() -> None:
    assert percentile([1, 2, 3, 4, 100], 0.95) == 100
    assert math.isnan(percentile([], 0.5))
    trials = run(lambda s, u: GOOD, repeat=1)
    text = markdown(summarize("fake", trials), trials)
    assert "킥에 맞춰요" in text and "95백분위" in text
