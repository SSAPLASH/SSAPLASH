"""fake BE 자체 규칙 테스트. 워커 없이 requests로 직접 부른다."""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
import requests

from helpers import make_tone, write_wav
from ssaplash_ai.worker.fake_be import API_PREFIX, FAKE_TOKEN, FakeBackend, FakeBackendServer
from ssaplash_ai.worker.payload import encode

HEADERS = {"Authorization": f"Bearer {FAKE_TOKEN}", "Content-Type": "application/json"}


@pytest.fixture
def rig(tmp_path: Path):
    clock = [100.0]
    backend = FakeBackend(out_dir=None, clock=lambda: clock[0])
    song = tmp_path / "song.wav"
    write_wav(song, make_tone(1.0))
    backend.enqueue(song)
    with FakeBackendServer(backend) as srv:
        yield backend, srv, clock


def _post(srv, path: str, body: dict, headers=HEADERS):
    return requests.post(
        f"{srv.base_url}{API_PREFIX}{path}", data=encode(body), headers=headers, timeout=5
    )


def test_토큰이_다르면_401_workerId가_다르면_400(rig):
    _, srv, _ = rig
    r = _post(
        srv,
        "/claim",
        {"workerId": "worker1", "claimRequestId": "c"},
        {"Authorization": "Bearer nope"},
    )
    assert r.status_code == 401 and r.json()["code"] == "UNAUTHORIZED"
    r = _post(srv, "/claim", {"workerId": "other", "claimRequestId": "c"})
    assert r.status_code == 400 and r.json()["code"] == "WORKER_INVALID"


def test_claim은_배정_뒤_같은_ID면_같은_배정_새_ID면_204(rig):
    backend, srv, clock = rig
    cid = str(uuid.uuid4())
    first = _post(srv, "/claim", {"workerId": "worker1", "claimRequestId": cid})
    assert first.status_code == 200
    body = first.json()
    assert body["resumeStage"] == "SEPARATING" and body["input"]["role"] == "SOURCE_AUDIO"
    assert body["input"]["durationMs"] == 1000 and body["contractVersion"] == 1
    again = _post(srv, "/claim", {"workerId": "worker1", "claimRequestId": cid})
    assert again.status_code == 200 and again.json()["attemptId"] == body["attemptId"]
    other = _post(srv, "/claim", {"workerId": "worker1", "claimRequestId": str(uuid.uuid4())})
    assert other.status_code == 204
    # 임대 만료 뒤 같은 ID는 409, 새 ID는 새 attempt
    clock[0] += 61
    expired = _post(srv, "/claim", {"workerId": "worker1", "claimRequestId": cid})
    assert expired.status_code == 409
    renewed = _post(srv, "/claim", {"workerId": "worker1", "claimRequestId": str(uuid.uuid4())})
    assert renewed.status_code == 200 and renewed.json()["attemptId"] != body["attemptId"]
    assert backend.jobs[1].attempts_in_stage == 1


def test_heartbeat는_순번이_커야_임대를_늘리고_다른_attempt는_409(rig):
    backend, srv, clock = rig
    a = _post(srv, "/claim", {"workerId": "worker1", "claimRequestId": "c1"}).json()
    attempt = a["attemptId"]
    assert (
        _post(
            srv, "/1/heartbeat", {"attemptId": attempt, "eventSeq": 1, "progress": 10}
        ).status_code
        == 200
    )
    stale = _post(srv, "/1/heartbeat", {"attemptId": attempt, "eventSeq": 1, "progress": 20})
    assert stale.status_code == 200 and backend.jobs[1].progress == 10  # 중복 순번은 무시
    assert (
        _post(
            srv,
            "/1/heartbeat",
            {"attemptId": "11111111-1111-4111-8111-111111111111", "eventSeq": 2, "progress": 20},
        ).status_code
        == 409
    )
    clock[0] += 61
    assert (
        _post(
            srv, "/1/heartbeat", {"attemptId": attempt, "eventSeq": 3, "progress": 30}
        ).status_code
        == 409
    )


def test_failure는_코드와_retryable을_검사한다(rig):
    backend, srv, _ = rig
    a = _post(srv, "/claim", {"workerId": "worker1", "claimRequestId": "c1"}).json()
    attempt = a["attemptId"]
    base = {"attemptId": attempt, "stage": "SEPARATING", "summary": "x"}
    assert (
        _post(
            srv, "/1/failure", {**base, "eventSeq": 1, "code": "WEIRD", "retryable": False}
        ).status_code
        == 400
    )
    assert (
        _post(
            srv, "/1/failure", {**base, "eventSeq": 2, "code": "INPUT_INVALID", "retryable": True}
        ).status_code
        == 400
    )
    ok = _post(
        srv, "/1/failure", {**base, "eventSeq": 3, "code": "MODEL_FAILED", "retryable": True}
    )
    assert ok.status_code == 200 and ok.json()["status"] == "QUEUED"
    assert backend.jobs[1].attempt_id is None
    # 다시 배정 → 재시도 불가 실패 → FAILED
    b = _post(srv, "/claim", {"workerId": "worker1", "claimRequestId": "c2"}).json()
    final = _post(
        srv,
        "/1/failure",
        {
            **base,
            "attemptId": b["attemptId"],
            "eventSeq": 1,
            "code": "INPUT_INVALID",
            "retryable": False,
        },
    )
    assert final.json()["status"] == "FAILED"


def test_결과_봉투의_payloadHash가_틀리면_422(rig):
    _, srv, _ = rig
    a = _post(srv, "/claim", {"workerId": "worker1", "claimRequestId": "c1"}).json()
    envelope = {
        "contractVersion": 1,
        "jobId": 1,
        "attemptId": a["attemptId"],
        "resultId": str(uuid.uuid4()),
        "payloadHash": "0" * 64,
        "result": {"durationMs": 1000},
    }
    r = _post(srv, "/1/results/separation", envelope)
    assert r.status_code == 422 and r.json()["code"] == "PAYLOAD_HASH_MISMATCH"
