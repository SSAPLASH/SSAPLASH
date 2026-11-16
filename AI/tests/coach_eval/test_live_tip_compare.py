"""연주 중 LLM 구간 코칭 평가: 골든 사실, 집계, 보고서. 가짜 생성기를 쓴다(모델 서버 없이)."""

from __future__ import annotations

import json
import math
from pathlib import Path

from ssaplash_ai.coach_eval.live_tip_compare import (
    DEFAULT_URL,
    build_cases,
    markdown,
    out_path,
    percentile,
    run,
    summarize,
)

GOOD = json.dumps({"title": "킥에 맞춰요", "sub": "킥 소리에 손을 맞춰요"}, ensure_ascii=False)


def test_골든_사실은_12가지이고_키보드와_잘_친_구간을_담는다() -> None:
    cases = build_cases()
    assert len(cases) == 12
    # 판정 폭, 대신 친 패드, 스틱 끝 방향 사례가 있다
    assert all(f.timing.goodMs == 60.0 for f in cases.values())
    assert cases["패드 헷갈림"].pads[0].instead == "MID_TOM" and cases["패드 헷갈림"].aim
    assert cases["스틱 끝 낮음"].aim[0].vertical == "LOW"
    assert cases["키보드 늦음"].input == "keyboard"
    assert cases["잘 친 구간"].previous.lastTip is not None
    assert {"WRONG_PAD", "TRANSITION", "DENSE", "DRIFT_LATE"} <= {
        c for f in cases.values() for c in f.ruleCoach.causes
    }


def _varied():
    """부를 때마다 제목이 다른 가짜 생성기"""
    n = iter(range(1000))
    titles = ["킥보다 먼저", "킥 기다려", "박 고르게", "박 미리", "지금 그대로"]

    def gen(system: str, user: str) -> str:
        return json.dumps(
            {"title": titles[next(n) % len(titles)], "sub": "마디 첫 박에 맞춰요"},
            ensure_ascii=False,
        )

    return gen


def test_모두_통과하면_통과율_1이고_목표를_본다() -> None:
    trials = run(_varied(), repeat=1)
    s = summarize("fake", trials)
    # 잘 친 구간에 "킥 기다려"가 걸려 한 번 다시 쓴다(고치라는 말 금지)
    assert s.trials == 12 and s.passRate == 1.0 and s.firstTryRate == round(11 / 12, 4)
    assert s.titleVariety == round(5 / 12, 4) and not s.meetsTarget


def test_제목_다양성은_상황별_대표_제목으로_센다() -> None:
    # 같은 상황을 반복하면 같은 제목이 나오는 것이 정상이다. 상황마다 다른 제목이면 1
    per_case = iter(["킥보다 먼저", "킥보다 먼저", "킥 기다려", "킥 기다려"] + ["지금 그대로"] * 20)

    def gen(system: str, user: str) -> str:
        return json.dumps(
            {"title": next(per_case), "sub": "마디 첫 박에 맞춰요"}, ensure_ascii=False
        )

    s = summarize("fake", run(gen, repeat=2))
    assert s.titleVariety == round(3 / 12, 4)


def test_같은_제목만_쓰면_목표_미달이다() -> None:
    s = summarize("fake", run(lambda s, u: GOOD, repeat=2))
    assert s.passRate == 1.0 and s.titleVariety == round(1 / 12, 4) and not s.meetsTarget


def test_거절_이유를_센다() -> None:
    long = json.dumps({"title": "아주 긴 제목을 쓰는 모델", "sub": ""}, ensure_ascii=False)
    trials = run(lambda s, u: long, repeat=1)
    s = summarize("fake", trials)
    assert s.passRate == 0.0 and not s.meetsTarget
    assert s.violations.get("제목이 8자를 넘음", 0) >= 12


def test_백분위와_보고서() -> None:
    assert percentile([1, 2, 3, 4, 100], 0.95) == 100
    assert math.isnan(percentile([], 0.5))
    trials = run(lambda s, u: GOOD, repeat=1)
    text = markdown(summarize("fake", trials), trials)
    assert "킥에 맞춰요" in text and "95백분위" in text


def test_거절된_문구와_길이를_보고서에_남긴다() -> None:
    long_sub = "손목을 살짝 뒤로 젖혀서 스틱을 누르세요"
    bad = json.dumps({"title": "손목", "sub": long_sub}, ensure_ascii=False)
    trials = run(lambda s, u: bad, repeat=1)
    assert all(t.rejectedTitle == "손목" and t.rejectedSub == long_sub for t in trials)
    text = markdown(summarize("fake", trials), trials)
    assert f"{long_sub} ({len(long_sub)})" in text
    # 표의 거절 이유는 규칙 이름만(글자 수 안내는 jsonl에 남는다)
    assert "보조가 20자를 넘음" in text and "지금 공백 포함" not in text


def test_여러_모델이면_모델마다_파일을_나눈다() -> None:
    out = Path("data/results/live-tip-compare.md")
    assert out_path(out, "gemma3:4b", 1) == out
    assert out_path(out, "gemma3:12b", 2).name == "live-tip-compare-gemma3-12b.md"


def test_기본_주소는_우리_ollama다() -> None:
    assert DEFAULT_URL.endswith(":11435")
