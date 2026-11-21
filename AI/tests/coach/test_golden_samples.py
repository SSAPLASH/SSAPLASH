"""BE와 합의한 샘플 A/B/C(`.claude/mail` COACH-003 회신 3·5)를 그대로 돌려 기대 응답과 맞는지 본다.

샘플은 설계 규칙으로 계산한 계약 예시다. 구현이 샘플과 다르면 구현 버그인지 샘플 계산 오류인지
먼저 따진다. 임계값을 QA 뒤 조정하면 이 기대값도 함께 다시 만든다.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ssaplash_ai.coach import AnalysisRequest, analyze

SAMPLES = json.loads(
    (Path(__file__).parent.parent / "fixtures" / "coach" / "samples.json").read_text(
        encoding="utf-8"
    )
)


@pytest.mark.parametrize("name", ["A", "B", "C"])
def test_합의_샘플의_응답이_기대와_같다(name):
    sample = SAMPLES[name]

    response = analyze(AnalysisRequest.model_validate(sample["request"]))

    assert response.model_dump(exclude_none=True) == sample["response"]


def test_샘플_A는_전체_지연과_놓침_몰림을_찾는다():
    response = analyze(AnalysisRequest.model_validate(SAMPLES["A"]["request"]))

    assert [s.pattern for s in response.weakSegments] == ["TIMING_LATE", "MISS_CLUSTER"]
    cluster = response.weakSegments[1]
    assert (cluster.fromMs, cluster.toMs) == (7000.0, 12000.0)
    assert cluster.description == "7~12초 구간에서 노트의 40%를 놓쳤어요."


def test_샘플_B는_약점이_없고_샘플_C는_짧은_곡이지만_분석한다():
    b = analyze(AnalysisRequest.model_validate(SAMPLES["B"]["request"]))
    c = analyze(AnalysisRequest.model_validate(SAMPLES["C"]["request"]))

    assert (b.reason, b.weakSegments) == ("NO_WEAKNESS", [])
    assert (c.reason, c.weakSegments) == ("NO_WEAKNESS", [])
    assert c.summary is not None
