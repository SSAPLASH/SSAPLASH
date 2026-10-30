"""노트 표 계산과 입력 검증."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from coach_helpers import N, build_request, patterns_of, run, same
from ssaplash_ai.coach import AnalysisRequest
from ssaplash_ai.coach.notes import build_notes
from ssaplash_ai.coach.schema import normalize_pad


def _request(notes: list[N], **kwargs) -> AnalysisRequest:
    return AnalysisRequest.model_validate(build_request(notes, **kwargs))


def test_노트_시각은_맞은_타격은_tMs에서_오차를_빼고_놓침은_tMs_그대로다():
    request = _request([N(delta=4), N(delta=None), N(delta=-10)], t0=1000, step_ms=500)

    notes = build_notes(request)

    assert notes.time.tolist() == [1000.0, 1500.0, 2000.0]
    assert notes.miss.tolist() == [False, True, False]
    assert notes.delta[0] == 4 and notes.delta[2] == -10
    assert str(notes.delta[1]) == "nan"


def test_여분의_타격은_노트에_세지_않는다():
    request = _request(same(5), strays=((1250.0, "HIHAT", 70), (1800.0, "SNARE", 70)))

    assert len(request.hits) == 7
    assert build_notes(request).size == 5


def test_타격_순서가_뒤섞여도_노트는_시각_순으로_정렬된다():
    data = build_request(same(24, delta=20))
    shuffled = {**data, "hits": list(reversed(data["hits"]))}

    original = AnalysisRequest.model_validate(data)
    reordered = AnalysisRequest.model_validate(shuffled)

    assert build_notes(original).time.tolist() == build_notes(reordered).time.tolist()


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("HI_TOM", "SMALL_TOM"),  # 옛 이름은 정식 이름으로
        ("SMALL_TOM", "SMALL_TOM"),
        ("HIHAT_PEDAL", "HIHAT_PEDAL"),
        ("WOODBLOCK", "OTHER"),  # 모르는 이름은 OTHER
    ],
)
def test_패드_이름을_정식_이름으로_바꾼다(raw, expected):
    assert normalize_pad(raw) == expected


def test_옛_이름_HI_TOM은_결과에서_SMALL_TOM으로_나온다():
    response = run(same(24, pad="HI_TOM", delta=20))

    assert response["weakSegments"][0]["pads"] == ["SMALL_TOM"]


def test_모르는_패드는_OTHER로_모아_계산에_포함한다():
    response = run(same(24, pad="WOODBLOCK", delta=20))

    assert response["weakSegments"][0]["pads"] == ["OTHER"]


def test_모르는_필드는_무시한다():
    data = build_request(same(20))
    data["hits"][0]["pitch"] = 1.5
    data["extraTopLevel"] = "x"

    AnalysisRequest.model_validate(data)  # 오류 없이 통과


def test_mode가_RHYTHM_SHEET가_아니면_검증_오류다():
    data = build_request(same(20), mode="FREE")

    with pytest.raises(ValidationError) as caught:
        AnalysisRequest.model_validate(data)

    assert caught.value.errors()[0]["loc"] == ("mode",)


def test_PERFECT인데_오차가_없으면_계약_위반이다():
    data = build_request(same(20, delta=0))
    data["hits"][0]["deltaMs"] = None

    with pytest.raises(ValidationError):
        AnalysisRequest.model_validate(data)


def test_goodMs가_0_이하면_검증_오류다():
    data = build_request(same(20), good_ms=0)

    with pytest.raises(ValidationError):
        AnalysisRequest.model_validate(data)


def test_타격_기록이_없는_요청도_받는다():
    data = build_request([])

    assert AnalysisRequest.model_validate(data).hits == []
    assert patterns_of(run([])) == []
