"""POST /analysis/weak-segments.

처리 로직은 이벤트 루프 없이 부를 수 있는 `process_body`로 직접 시험하고, 라우팅 연결(경로·헤더 검사)만
`TestClient`로 확인한다. 일부 Windows PC는 이벤트 루프를 만들 때 socketpair 오류(WinError 10014)가 나서
`TestClient` 시험은 그때 이유를 밝히고 건너뛴다(CI와 다른 PC에서는 실행된다).
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import pytest

from coach_helpers import N, build_request, same
from ssaplash_ai.server import weak_segments
from ssaplash_ai.server.app import app
from ssaplash_ai.server.weak_segments import process_body

SAMPLES = json.loads(
    (Path(__file__).parent.parent / "fixtures" / "coach" / "samples.json").read_text(
        encoding="utf-8"
    )
)
URL = "/analysis/weak-segments"


def _call(payload: object) -> tuple[int, dict]:
    body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
    response = process_body(body)
    return response.status_code, json.loads(response.body)


@pytest.fixture(scope="module")
def client():
    """라우팅 시험용 클라이언트(모듈당 하나). 이벤트 루프를 못 만드는 PC에서는 건너뛴다."""
    from fastapi.testclient import TestClient

    opened = TestClient(app)
    try:
        shared = opened.__enter__()  # 여기서 이벤트 루프(socketpair)를 만든다
    except OSError as exc:
        pytest.skip(
            f"이 PC에서는 이벤트 루프를 만들 수 없다({exc.__class__.__name__}: WinError 10014)"
        )
    try:
        yield shared
    finally:
        opened.__exit__(None, None, None)


# ---------- 처리 로직 (이벤트 루프 없이) ----------


@pytest.mark.parametrize("name", ["A", "B", "C"])
def test_합의_샘플_요청에_기대_응답을_돌려준다(name):
    status, body = _call(SAMPLES[name]["request"])

    assert status == 200
    assert body == SAMPLES[name]["response"]


def test_mode가_허용되지_않으면_400과_필드_이름만_돌려준다():
    status, body = _call(build_request(same(20), mode="FREE"))

    assert status == 400
    assert body == {"error": "INVALID_REQUEST", "fields": ["mode"]}


def test_필수_필드가_없으면_400이다():
    payload = build_request(same(20))
    del payload["hits"]

    status, body = _call(payload)

    assert status == 400
    assert body["fields"] == ["hits"]


def test_JSON이_아니면_400이다():
    status, body = _call(b"{not json")

    assert status == 400
    assert body == {"error": "INVALID_JSON"}


def test_오류_응답에_입력_값이_들어가지_않는다():
    payload = build_request(same(20))
    payload["hits"][0]["tMs"] = "SECRET-VALUE-123"

    status, body = _call(payload)

    assert status == 400
    assert body["fields"] == ["hits.0.tMs"]
    assert "SECRET-VALUE-123" not in json.dumps(body)


def test_맞은_타격에_오차가_없으면_400이다():
    payload = build_request(same(20, delta=0))
    payload["hits"][3]["deltaMs"] = None

    status, body = _call(payload)

    assert status == 400
    assert body["fields"] == ["hits.3"]


def test_타격이_50000건을_넘으면_413이다():
    hits = [{"seq": i, "tMs": float(i), "pad": "SNARE"} for i in range(50_001)]

    status, body = _call({**build_request(same(20)), "hits": hits})

    assert status == 413
    assert body == {"error": "TOO_MANY_HITS"}


def test_본문이_5MiB를_넘으면_413이다():
    status, body = _call(b" " * (5 * 1024 * 1024 + 1))

    assert status == 413
    assert body == {"error": "BODY_TOO_LARGE"}


def test_타격이_하나도_없는_요청은_200_표본_부족이다():
    status, body = _call(build_request([]))

    assert status == 200
    assert body["reason"] == "INSUFFICIENT_HITS"


def test_분석_요약만_로그에_남고_요청_값은_남지_않는다(caplog):
    sample = SAMPLES["A"]["request"]

    with caplog.at_level(logging.INFO, logger="ssaplash_ai.coach"):
        _call(sample)

    assert "weak-segments reason=OK" in caplog.text
    assert "TIMING_LATE:0.3" in caplog.text
    assert sample["playId"] not in caplog.text
    assert "n0001" not in caplog.text  # 노트 ID 같은 타격 데이터가 없다


def test_검증_실패도_입력_값을_로그에_남기지_않는다(caplog):
    payload = build_request(same(20))
    payload["hits"][0]["tMs"] = "SECRET-VALUE-123"

    with caplog.at_level(logging.INFO, logger="ssaplash_ai.coach"):
        _call(payload)

    assert "SECRET-VALUE-123" not in caplog.text
    assert "rejected status=400" in caplog.text


def test_uvicorn_로깅_설정에서도_분석_요약이_표준_출력으로_나간다(capsys):
    # 운영(uvicorn)은 root에 핸들러를 달지 않아 INFO가 버려지기 쉽다. 같은 설정을 적용해도 나가야 한다.
    import logging.config

    from uvicorn.config import LOGGING_CONFIG

    logging.config.dictConfig(LOGGING_CONFIG)

    _call(SAMPLES["A"]["request"])

    out = capsys.readouterr().out
    assert "weak-segments reason=OK" in out
    assert "TIMING_LATE:0.3" in out
    assert SAMPLES["A"]["request"]["playId"] not in out


def test_예상치_못한_오류는_500이고_메시지를_로그에_남기지_않는다(caplog, monkeypatch):
    def boom(_notes):
        raise RuntimeError("secret body text")

    monkeypatch.setattr(weak_segments, "analyze_notes", boom)

    with caplog.at_level(logging.INFO, logger="ssaplash_ai.coach"):
        status, body = _call(SAMPLES["A"]["request"])

    assert status == 500
    assert body == {"error": "INTERNAL_ERROR"}
    assert "RuntimeError" in caplog.text
    assert "secret body text" not in caplog.text


def test_타격_2만건_요청이_3초_안에_처리된다():
    pads = ["HIHAT", "SNARE", "MID_TOM", "KICK"]
    notes = [N(pad=pads[i % 4], delta=25 + (i % 7) * 3) for i in range(20_000)]
    body = json.dumps(build_request(notes, step_ms=300.0), separators=(",", ":")).encode()
    assert len(body) < 5 * 1024 * 1024

    started = time.perf_counter()
    response = process_body(body)
    elapsed = time.perf_counter() - started

    assert response.status_code == 200
    assert elapsed < 3.0, f"요청 처리에 {elapsed:.2f}초"


def test_모든_약점_항목에_연습_조언과_상세_설명과_심각도_단계가_붙고_버전이_올라간다():
    status, body = _call(SAMPLES["A"]["request"])

    assert status == 200
    assert body["analyzerVersion"] == "weak-rules-0.5"
    assert body["weakSegments"]
    for segment in body["weakSegments"]:
        assert segment["tip"]
        assert segment["detail"]
        assert segment["severityLevel"] in ("LOW", "MEDIUM", "HIGH")


def test_총평은_노트가_있으면_붙고_없으면_키가_빠진다():
    _, enough = _call(SAMPLES["A"]["request"])
    _, short = _call(SAMPLES["C"]["request"])
    _, few = _call(build_request([]))

    assert set(enough["summary"]) == {"level", "text", "focusPattern", "source"}
    assert enough["summary"]["focusPattern"] == "MISS_CLUSTER"
    assert short["reason"] == "NO_WEAKNESS"
    assert set(short["summary"]) == {"level", "text", "source"}
    assert few["reason"] == "INSUFFICIENT_HITS"
    assert "summary" not in few


def test_약점이_없으면_총평의_focusPattern_키가_빠진다():
    # None 필드는 응답에서 키를 생략한다(구버전 BE·FE와 같은 모양)
    _, body = _call(SAMPLES["B"]["request"])

    assert body["reason"] == "NO_WEAKNESS"
    assert "focusPattern" not in body["summary"]
    assert body["summary"]["strengthPad"] == "HIHAT"


def test_문구가_없는_pattern은_응답에서_tip_키가_빠진다(monkeypatch):
    # 새 규칙이 문구보다 먼저 들어와도 응답이 깨지지 않고, tip 키만 없어야 한다(구버전 BE·FE와 같은 모양)
    from ssaplash_ai.coach import analyzer
    from ssaplash_ai.coach.patterns import Candidate

    def detect_new(notes, th):
        return [
            Candidate(
                pattern="SOMETHING_NEW",
                from_ms=0.0,
                to_ms=1000.0,
                description="새 패턴이에요.",
                cause_tags=["NEW"],
                pads=["SNARE"],
                severity=0.5,
                metrics={"severity": 0.0, "scope": "WHOLE"},
            )
        ]

    monkeypatch.setattr(analyzer, "DETECTORS", [detect_new])

    status, body = _call(SAMPLES["A"]["request"])

    assert status == 200
    assert [s["pattern"] for s in body["weakSegments"]] == ["SOMETHING_NEW"]
    assert "tip" not in body["weakSegments"][0]


# ---------- 라우팅 연결 (TestClient) ----------


def test_경로에_POST하면_분석_응답이_온다(client):
    response = client.post(
        URL,
        content=json.dumps(SAMPLES["A"]["request"]),
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 200
    assert response.json() == SAMPLES["A"]["response"]


def test_선언된_본문_크기가_5MiB를_넘으면_읽기_전에_413이다(client):
    response = client.post(
        URL, content=b" " * (5 * 1024 * 1024 + 1), headers={"content-type": "application/json"}
    )

    assert response.status_code == 413
    assert response.json() == {"error": "BODY_TOO_LARGE"}


def test_health는_그대로_동작한다(client):
    assert client.get("/health").json() == {"status": "ok"}
