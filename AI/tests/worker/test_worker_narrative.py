"""LLM 총평 작업: BE 호출부(claim·result·failure)와 실행기. 가짜 세션과 가짜 생성기를 쓴다."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import requests

from ssaplash_ai.chart.config import ENV_WORK_DIR
from ssaplash_ai.worker.api import ApiError
from ssaplash_ai.worker.config import (
    ENV_BASE_URL,
    ENV_NARRATIVE_ENABLED,
    ENV_NARRATIVE_MODEL,
    ENV_TOKEN,
    ENV_WORKER_ID,
    WorkerSettings,
)
from ssaplash_ai.worker.narrative_job import (
    NarrativeApi,
    NarrativeAssignment,
    NarrativeRunner,
)

TOKEN = "k" * 40
FACTS = {
    "contractVersion": 1,
    "level": "FAIR",
    "focusPattern": "MISS_CLUSTER",
    "counts": {"perfect": 20, "good": 10, "miss": 10},
    "strengthPad": "KICK",
    "segments": [
        {
            "pattern": "MISS_CLUSTER",
            "severityLevel": "MEDIUM",
            "pads": ["SNARE"],
            "fromMs": 7000.0,
            "toMs": 12000.0,
            "scope": "SEGMENT",
            "metrics": {"severity": 0.67, "missRate": 0.4, "missCount": 4, "noteCount": 10},
        }
    ],
}
GOOD_TEXT = (
    "전체적으로 기본기는 잘 잡혀 있어요. 킥은 특히 안정적으로 쳤어요. "
    "7~12초 구간에서 노트 10개 중 4개를 놓쳤으니 그 부분만 느린 템포로 반복해 보세요."
)
CLAIM = {
    "jobId": 7,
    "attemptId": "a-1",
    "leaseExpiresAt": "2026-11-04T10:00:00Z",
    "facts": FACTS,
}


class _Response:
    def __init__(self, status: int, body: object = None) -> None:
        self.status_code = status
        self._body = body
        self.text = "" if body is None else json.dumps(body)
        self.content = self.text.encode("utf-8")

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


class _Session:
    def __init__(self, *responses) -> None:
        self.responses = list(responses)
        self.calls: list[dict] = []

    def post(self, url, data, headers, timeout):
        self.calls.append({"url": url, "data": json.loads(data), "headers": headers})
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def _settings(tmp_path: Path, **extra: str) -> WorkerSettings:
    return WorkerSettings.from_env(
        {
            ENV_BASE_URL: "http://be.test",
            ENV_WORKER_ID: "worker1",
            ENV_TOKEN: TOKEN,
            ENV_WORK_DIR: str(tmp_path),
            **extra,
        }
    )


def _runner(tmp_path: Path, generator, *responses):
    session = _Session(*responses)
    api = NarrativeApi(_settings(tmp_path), session=session, sleep=lambda s: None)  # type: ignore[arg-type]
    return NarrativeRunner(api, generator, "model-a"), session


# ---------- 설정 ----------


def test_총평_작업은_기본으로_꺼져_있고_경로가_다르다(tmp_path):
    settings = _settings(tmp_path)

    assert settings.narrative_enabled is False
    assert settings.narrative_api_url == "http://be.test/internal/v1/coach-narratives"
    assert settings.api_url == "http://be.test/internal/v1/chart-jobs"


def test_환경_변수로_켜고_모델을_고른다(tmp_path):
    settings = _settings(tmp_path, **{ENV_NARRATIVE_ENABLED: "true", ENV_NARRATIVE_MODEL: " m1 "})

    assert settings.narrative_enabled is True and settings.narrative_model == "m1"
    assert settings.narrative_llm_url == "http://127.0.0.1:11434"
    assert settings.narrative_llm_api == "ollama"


# ---------- BE 호출 ----------


def test_claim은_총평_경로로_부르고_배정을_돌려준다(tmp_path):
    runner, session = _runner(tmp_path, lambda s, u: "", _Response(200, CLAIM), _Response(204))

    got = runner.api.claim_narrative("req-1")

    assert got == NarrativeAssignment(7, "a-1", "2026-11-04T10:00:00Z", FACTS)
    call = session.calls[0]
    assert call["url"] == "http://be.test/internal/v1/coach-narratives/claim"
    assert call["data"] == {"workerId": "worker1", "claimRequestId": "req-1"}
    assert call["headers"]["Authorization"] == f"Bearer {TOKEN}"
    assert runner.api.claim_narrative("req-2") is None  # 204


def test_claim_응답_모양이_다르면_ApiError이다(tmp_path):
    runner, _ = _runner(tmp_path, lambda s, u: "", _Response(200, {"jobId": 1}))

    with pytest.raises(ApiError, match="모양"):
        runner.api.claim_narrative("r")


# ---------- 실행기 ----------


def test_가드레일을_통과하면_결과를_제출한다(tmp_path):
    runner, session = _runner(tmp_path, lambda s, u: GOOD_TEXT, _Response(200, {"status": "DONE"}))

    outcome = runner.run(NarrativeAssignment(7, "a-1", "", FACTS))

    assert outcome.status == "DONE" and outcome.attempts == 1
    call = session.calls[0]
    assert call["url"].endswith("/coach-narratives/7/result")
    assert call["data"]["attemptId"] == "a-1" and call["data"]["text"] == GOOD_TEXT
    assert call["data"]["model"] == "model-a" and call["data"]["generationMs"] >= 0


def test_가드레일에_두_번_걸리면_OUTPUT_INVALID로_보고한다(tmp_path):
    runner, session = _runner(
        tmp_path, lambda s, u: "점수가 낮아요.", _Response(200, {"status": "FAILED"})
    )

    outcome = runner.run(NarrativeAssignment(7, "a-1", "", FACTS))

    assert outcome.status == "FAILED_REPORTED" and outcome.detail == "OUTPUT_INVALID"
    data = session.calls[0]["data"]
    assert session.calls[0]["url"].endswith("/7/failure")
    assert data["code"] == "OUTPUT_INVALID" and data["retryable"] is False
    assert "가드레일 거절" in data["summary"]


def test_모델_서버_오류는_MODEL_FAILED_재시도_가능으로_보고한다(tmp_path):
    def broken(system, user):
        raise ConnectionError("모델 서버 꺼짐")

    runner, session = _runner(tmp_path, broken, _Response(200, {"status": "QUEUED"}))

    outcome = runner.run(NarrativeAssignment(7, "a-1", "", FACTS))

    assert outcome.detail == "MODEL_FAILED" and outcome.attempts == 1
    data = session.calls[0]["data"]
    assert data["code"] == "MODEL_FAILED" and data["retryable"] is True
    assert "ConnectionError" not in data["summary"]


def test_facts_모양이_다르면_모델을_부르지_않고_INPUT_INVALID로_보고한다(tmp_path):
    calls = []
    runner, session = _runner(
        tmp_path, lambda s, u: calls.append(1) or GOOD_TEXT, _Response(200, {"status": "FAILED"})
    )

    outcome = runner.run(NarrativeAssignment(7, "a-1", "", {"level": "NOPE"}))

    assert outcome.detail == "INPUT_INVALID" and calls == []
    assert session.calls[0]["data"]["code"] == "INPUT_INVALID"
    assert "NOPE" not in json.dumps(session.calls[0]["data"])  # 입력 값을 담지 않는다


def test_결과_제출이_거절되면_놓는다(tmp_path):
    runner, _ = _runner(tmp_path, lambda s, u: GOOD_TEXT, _Response(409, {"code": "LEASE_EXPIRED"}))

    outcome = runner.run(NarrativeAssignment(7, "a-1", "", FACTS))

    assert outcome.status == "ABANDONED"


def test_결과_제출이_401이면_위로_올린다(tmp_path):
    runner, _ = _runner(tmp_path, lambda s, u: GOOD_TEXT, _Response(401, {"code": "UNAUTHORIZED"}))

    with pytest.raises(ApiError) as caught:
        runner.run(NarrativeAssignment(7, "a-1", "", FACTS))
    assert caught.value.status == 401


def test_연결_오류가_계속되면_결과를_놓는다(tmp_path):
    runner, _ = _runner(tmp_path, lambda s, u: GOOD_TEXT, *[requests.ConnectionError("x")] * 4)

    outcome = runner.run(NarrativeAssignment(7, "a-1", "", FACTS))

    assert outcome.status == "ABANDONED"


# ---------- 루프가 쓰는 poll ----------


def test_poll은_작업이_있으면_처리하고_없으면_None이다(tmp_path):
    runner, session = _runner(
        tmp_path,
        lambda s, u: GOOD_TEXT,
        _Response(200, CLAIM),
        _Response(200, {"status": "DONE"}),
        _Response(204),
    )

    done = runner.poll()
    empty = runner.poll()

    assert done is not None and done.status == "DONE" and empty is None
    assert [c["url"].rsplit("/", 1)[-1] for c in session.calls] == ["claim", "result", "claim"]


def test_poll은_404이면_5분_동안_묻지_않는다(tmp_path):
    runner, session = _runner(tmp_path, lambda s, u: GOOD_TEXT, _Response(404, {"code": "X"}))

    assert runner.poll() is None
    assert runner.poll() is None  # 응답이 더 없어도 호출하지 않는다
    assert len(session.calls) == 1


def test_poll은_401이면_위로_올린다(tmp_path):
    runner, _ = _runner(tmp_path, lambda s, u: GOOD_TEXT, _Response(401, {"code": "U"}))

    with pytest.raises(ApiError) as caught:
        runner.poll()
    assert caught.value.status == 401


def test_poll은_5xx면_None으로_돌아가_다음_주기에_다시_묻는다(tmp_path):
    runner, session = _runner(
        tmp_path, lambda s, u: GOOD_TEXT, _Response(500, {"code": "E"}), _Response(204)
    )

    assert runner.poll() is None
    assert runner.poll() is None
    assert len(session.calls) == 2
