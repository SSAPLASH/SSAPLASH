"""BE API 호출부 단위 테스트. requests.Session 대신 응답을 미리 정해 둔 가짜 세션을 끼운다.

실제 HTTP 왕복은 tests/worker/test_worker_job.py가 BE 대역(fake_be)으로 검사한다.
"""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

import pytest
import requests

from ssaplash_ai.chart.config import ENV_WORK_DIR
from ssaplash_ai.worker.api import ApiError, WorkerApi, one_line
from ssaplash_ai.worker.config import ENV_BASE_URL, ENV_TOKEN, ENV_WORKER_ID, WorkerSettings
from ssaplash_ai.worker.payload import make_envelope

TOKEN = "k" * 40


class _Response:
    def __init__(self, status: int, body: object = None, text: str | None = None) -> None:
        self.status_code = status
        self._body = body
        self.text = text if text is not None else ("" if body is None else json.dumps(body))
        self.content = self.text.encode("utf-8")

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


class _Session:
    """post 호출을 기록하고 미리 넣어 둔 응답(또는 예외)을 차례로 돌려줌."""

    def __init__(self, *responses) -> None:
        self.responses = list(responses)
        self.calls: list[dict] = []

    def post(self, url, data, headers, timeout):
        self.calls.append({"url": url, "data": data, "headers": headers, "timeout": timeout})
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def _settings(tmp_path: Path) -> WorkerSettings:
    return WorkerSettings.from_env(
        {
            ENV_BASE_URL: "http://be.test",
            ENV_WORKER_ID: "worker1",
            ENV_TOKEN: TOKEN,
            ENV_WORK_DIR: str(tmp_path),
        }
    )


def _api(tmp_path: Path, *responses) -> tuple[WorkerApi, _Session, list[float]]:
    session = _Session(*responses)
    slept: list[float] = []
    api = WorkerApi(_settings(tmp_path), session=session, sleep=slept.append)  # type: ignore[arg-type]
    return api, session, slept


ASSIGNMENT = {
    "contractVersion": 1,
    "jobId": 42,
    "songId": 17,
    "attemptId": "11111111-1111-4111-8111-111111111111",
    "resumeStage": "SEPARATING",
    "input": {
        "role": "SOURCE_AUDIO",
        "fileId": "33333333-3333-4333-8333-333333333333",
        "contentType": "audio/wav",
        "sizeBytes": 176444,
        "sha256": "A" * 64,
        "durationMs": 1000,
    },
    "requestedDifficulties": ["NORMAL"],
    "acceptedChartSchemaVersions": [1],
    "leaseExpiresAt": "2026-10-27T08:00:00Z",
    "stageDeadlineAt": "2026-10-27T08:01:00Z",
}


def test_claim_200은_Assignment_204는_None(tmp_path: Path):
    api, session, _ = _api(tmp_path, _Response(200, ASSIGNMENT), _Response(204))
    a = api.claim("22222222-2222-4222-8222-222222222222")
    assert a is not None
    assert a.job_id == 42 and a.attempt_id == ASSIGNMENT["attemptId"]
    assert a.resume_stage == "SEPARATING" and a.input.role == "SOURCE_AUDIO"
    assert a.input.duration_ms == 1000 and a.input.sha256 == "a" * 64  # 소문자로 통일
    assert a.accepted_chart_schema_versions == (1,)
    assert api.claim("22222222-2222-4222-8222-222222222223") is None
    call = session.calls[0]
    assert call["url"] == "http://be.test/internal/v1/chart-jobs/claim"
    assert call["headers"]["Authorization"] == f"Bearer {TOKEN}"
    assert call["headers"]["Content-Type"] == "application/json"
    assert call["data"] == (
        b'{"claimRequestId":"22222222-2222-4222-8222-222222222222","workerId":"worker1"}'
    )
    assert call["timeout"] == (5.0, 30.0)


def test_503과_연결_오류는_같은_본문으로_재시도(tmp_path: Path):
    api, session, slept = _api(
        tmp_path,
        _Response(503),
        requests.ConnectionError("down"),
        _Response(200, {"leaseExpiresAt": "x"}),
    )
    grants = api.file_access(42, "a", [{"role": "SOURCE_AUDIO", "fileId": "f"}])
    assert grants == []
    assert slept == [2.0, 5.0]
    assert len({c["data"] for c in session.calls}) == 1  # 본문 동일


def test_재시도를_소진하면_마지막_오류(tmp_path: Path):
    api, _, slept = _api(tmp_path, *[_Response(503)] * 4)
    with pytest.raises(ApiError) as info:
        api.file_access(42, "a", [])
    assert info.value.status == 503 and info.value.transient
    assert slept == [2.0, 5.0, 15.0]


def test_heartbeat는_재시도하지_않는다(tmp_path: Path):
    api, session, slept = _api(tmp_path, requests.Timeout("slow"))
    with pytest.raises(ApiError) as info:
        api.heartbeat(42, "a", 3, 10)
    assert info.value.status is None and info.value.transient
    assert slept == [] and len(session.calls) == 1
    assert session.calls[0]["data"] == b'{"attemptId":"a","eventSeq":3,"progress":10}'


def test_4xx는_ApiError_코드와_메시지(tmp_path: Path):
    api, _, _ = _api(tmp_path, _Response(400, {"code": "WORKER_INVALID", "message": "bad id"}))
    with pytest.raises(ApiError) as info:
        api.claim("c")
    e = info.value
    assert e.status == 400 and e.code == "WORKER_INVALID" and e.message == "bad id"
    assert not e.transient and "WORKER_INVALID" in str(e)


def test_401_본문_없음(tmp_path: Path):
    api, _, _ = _api(tmp_path, _Response(401, text=""))
    with pytest.raises(ApiError) as info:
        api.claim("c")
    assert info.value.status == 401 and info.value.code is None


def test_결과_제출은_봉투_바이트를_그대로_보낸다(tmp_path: Path):
    receipt_body = {
        "resultId": "r",
        "accepted": True,
        "jobStatus": "TRANSCRIBING",
        "revision": 4,
        "chartVersionIds": [],
    }
    api, session, _ = _api(tmp_path, _Response(200, receipt_body))
    env = make_envelope(42, "a", "r", {"durationMs": 1000, "metrics": {"loadMs": 1}})
    receipt = api.submit_separation(42, env)
    assert receipt.accepted and receipt.job_status == "TRANSCRIBING" and receipt.revision == 4
    assert session.calls[0]["data"] == env.body
    assert session.calls[0]["url"].endswith("/42/results/separation")
    body = json.loads(env.body, parse_float=Decimal)
    assert body["payloadHash"] == env.payload_hash


def test_실패_보고_본문(tmp_path: Path):
    api, session, _ = _api(tmp_path, _Response(200, {"status": "QUEUED", "revision": 5}))
    out = api.report_failure(42, "a", 7, "SEPARATING", "MODEL_FAILED", True, "GPU 메모리\n부족")
    assert out.status == "QUEUED" and out.revision == 5
    sent = json.loads(session.calls[0]["data"])
    assert sent == {
        "attemptId": "a",
        "eventSeq": 7,
        "stage": "SEPARATING",
        "code": "MODEL_FAILED",
        "retryable": True,
        "summary": "GPU 메모리 부족",
    }


def test_reason은_설정이_켜져_있을_때만_본문에_넣는다(tmp_path: Path):
    ok = {"status": "FAILED", "revision": 1}
    api, session, _ = _api(tmp_path, _Response(200, ok), _Response(200, ok), _Response(200, ok))
    api.report_failure(42, "a", 1, "TRANSCRIBING", "INPUT_INVALID", False, "x", "NOT_TRANSCRIBABLE")
    assert "reason" not in json.loads(session.calls[0]["data"])
    api.settings.send_reason = True
    api.report_failure(42, "a", 2, "TRANSCRIBING", "INPUT_INVALID", False, "x", "NOT_TRANSCRIBABLE")
    assert json.loads(session.calls[1]["data"])["reason"] == "NOT_TRANSCRIBABLE"
    api.report_failure(42, "a", 3, "TRANSCRIBING", "INPUT_INVALID", False, "x")
    assert "reason" not in json.loads(session.calls[2]["data"])


def test_one_line은_한_줄_200자():
    assert one_line("a\nb\r\n  c") == "a b c"
    assert len(one_line("x" * 500)) == 200 and one_line("x" * 500).endswith("...")
