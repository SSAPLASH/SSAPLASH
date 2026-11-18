"""연주 중 LLM 구간 코칭 워커: BE 호출부(재시도 없음), 실행기, 전용 루프, 실행 명령. 가짜 세션과 가짜 생성기를 쓴다."""

from __future__ import annotations

import json
import threading
from pathlib import Path

import pytest

from ssaplash_ai.chart.config import ENV_WORK_DIR
from ssaplash_ai.worker.api import ApiError
from ssaplash_ai.worker.config import (
    ENV_BASE_URL,
    ENV_LIVE_LLM_TIMEOUT_SEC,
    ENV_LIVE_POLL_SEC,
    ENV_TOKEN,
    ENV_WORKER_ID,
    WorkerSettings,
)
from ssaplash_ai.worker.live_coach_job import (
    LiveCoachApi,
    LiveCoachAssignment,
    LiveCoachRunner,
    run_live_loop,
)

TOKEN = "k" * 40
FACTS = {
    "contractVersion": 1,
    "segment": {"index": 1, "fromBar": 5, "toBar": 8},
    "input": "stick",
    "counts": {"perfect": 10, "good": 8, "miss": 6},
    "timing": {"meanDeltaMs": 28.0, "stdDeltaMs": 18.0, "sameSignRatio": 0.8},
    "pads": [{"pad": "SNARE", "notes": 8, "misses": 3, "meanDeltaMs": 35.0}],
    "ruleCoach": {"tags": ["LIVE_LATE"], "causes": []},
    "stage": 2,
}
CLAIM = {"jobId": 9, "attemptId": "a-1", "leaseExpiresAt": "2026-11-10T10:00:00Z", "facts": FACTS}
GOOD = json.dumps({"title": "스틱을 낮게", "sub": "높이는 주먹 하나만큼"}, ensure_ascii=False)


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
        self.calls.append({"url": url, "data": json.loads(data)})
        return self.responses.pop(0)


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
    api = LiveCoachApi(_settings(tmp_path), session=session, sleep=lambda s: None)  # type: ignore[arg-type]
    return LiveCoachRunner(api, generator, "gemma3:4b"), session


def test_주기와_시간_제한은_짧은_기본값이고_환경_변수로_바꾼다(tmp_path):
    s = _settings(tmp_path)
    assert (s.live_poll_sec, s.live_llm_timeout_sec) == (1.0, 8.0)
    s = _settings(tmp_path, **{ENV_LIVE_POLL_SEC: "0.5", ENV_LIVE_LLM_TIMEOUT_SEC: "5"})
    assert (s.live_poll_sec, s.live_llm_timeout_sec) == (0.5, 5.0)


def test_claim은_연주_코칭_경로로_부르고_배정을_돌려준다(tmp_path):
    runner, session = _runner(tmp_path, lambda s, u: GOOD, _Response(200, CLAIM))
    got = runner.api.claim_live("req-1")
    assert got == LiveCoachAssignment(9, "a-1", FACTS)
    assert session.calls[0]["url"] == "http://be.test/internal/v1/live-coach-jobs/claim"
    assert session.calls[0]["data"] == {"workerId": "worker1", "claimRequestId": "req-1"}


def test_일시_장애도_재시도하지_않는다(tmp_path):
    runner, session = _runner(tmp_path, lambda s, u: GOOD, _Response(503))
    with pytest.raises(ApiError):
        runner.api.claim_live("req-1")
    assert len(session.calls) == 1


def test_통과한_문구를_제출한다(tmp_path):
    runner, session = _runner(
        tmp_path, lambda s, u: GOOD, _Response(200, CLAIM), _Response(200, {"status": "DONE"})
    )
    out = runner.poll()
    assert out is not None and out.status == "DONE"
    body = session.calls[1]["data"]
    assert session.calls[1]["url"].endswith("/9/result")
    assert body["title"] == "스틱을 낮게" and body["sub"] == "높이는 주먹 하나만큼"
    assert body["model"] == "gemma3:4b" and body["attemptId"] == "a-1"
    assert isinstance(body["generationMs"], int)


def test_가드레일에_걸리면_OUTPUT_INVALID로_보고한다(tmp_path):
    long_title = json.dumps(
        {"title": "스틱을 아주 많이 낮게 들어요", "sub": ""}, ensure_ascii=False
    )
    runner, session = _runner(
        tmp_path,
        lambda s, u: long_title,
        _Response(200, CLAIM),
        _Response(200, {"status": "FAILED"}),
    )
    out = runner.poll()
    assert out is not None and out.detail == "OUTPUT_INVALID"
    body = session.calls[1]["data"]
    assert body["code"] == "OUTPUT_INVALID" and "제목" in body["summary"]
    assert "retryable" not in body


def test_모델_오류는_MODEL_FAILED_사실이_틀리면_INPUT_INVALID(tmp_path):
    def boom(s: str, u: str) -> str:
        raise TimeoutError

    runner, session = _runner(
        tmp_path, boom, _Response(200, CLAIM), _Response(200, {"status": "FAILED"})
    )
    assert runner.poll().detail == "MODEL_FAILED"  # type: ignore[union-attr]

    bad = {**CLAIM, "facts": {"contractVersion": 1}}
    runner, session = _runner(
        tmp_path, lambda s, u: GOOD, _Response(200, bad), _Response(200, {"status": "FAILED"})
    )
    assert runner.poll().detail == "INPUT_INVALID"  # type: ignore[union-attr]
    # 값은 담지 않는다
    assert "SNARE" not in json.dumps(session.calls[1]["data"])


def test_API가_없으면_5분_동안_묻지_않는다(tmp_path):
    runner, session = _runner(tmp_path, lambda s, u: GOOD, _Response(404))
    assert runner.poll() is None
    assert runner.poll() is None
    assert len(session.calls) == 1


def test_401은_위로_올린다(tmp_path):
    runner, _ = _runner(tmp_path, lambda s, u: GOOD, _Response(401))
    with pytest.raises(ApiError):
        runner.poll()


def test_루프는_일이_있으면_바로_다음으로_없으면_기다린다(tmp_path):
    runner, session = _runner(
        tmp_path,
        lambda s, u: GOOD,
        _Response(200, CLAIM),
        _Response(200, {"status": "DONE"}),
        _Response(204),
        _Response(200, CLAIM),
        _Response(200, {"status": "DONE"}),
    )
    waits: list[float] = []
    n = run_live_loop(runner, 1.0, threading.Event(), max_jobs=2, wait=waits.append)
    assert n == 2
    assert waits == [1.0]


def test_live_run은_모델_이름이_없으면_설정_오류(tmp_path, monkeypatch):
    from ssaplash_ai.worker.cli import main
    from ssaplash_ai.worker.loop import EXIT_CONFIG

    for k, v in {
        ENV_BASE_URL: "http://be.test",
        ENV_WORKER_ID: "worker1",
        ENV_TOKEN: TOKEN,
        ENV_WORK_DIR: str(tmp_path),
    }.items():
        monkeypatch.setenv(k, v)
    monkeypatch.delenv("SSAPLASH_NARRATIVE_MODEL", raising=False)
    assert main(["live-run", "--max-jobs", "1"]) == EXIT_CONFIG


def test_BE가_붙인_습관이_프롬프트에_들어가고_습관_문구를_제출한다(tmp_path):
    # BE LiveCoachHabit이 만드는 모양 그대로(설계 COACH-001 습관 개인화 3.1)와 FE playedPads
    facts = {
        **FACTS,
        "playedPads": ["KICK", "SNARE"],
        "habit": {"plays": 4, "items": [{"pattern": "TIMING_LATE", "share": "OFTEN"}]},
    }
    prompts: list[str] = []

    def gen(system: str, user: str) -> str:
        prompts.append(user)
        return json.dumps(
            {"title": "킥보다 먼저", "sub": "이번에도 늦어요, 먼저 쳐요"}, ensure_ascii=False
        )

    runner, session = _runner(
        tmp_path,
        gen,
        _Response(200, {**CLAIM, "facts": facts}),
        _Response(200, {"status": "DONE"}),
    )
    out = runner.poll()
    assert out is not None and out.status == "DONE"
    assert "평소 습관(자주): 박보다 늦게 침 → 이번 구간에도 같음" in prompts[0]
    assert session.calls[1]["data"]["sub"] == "이번에도 늦어요, 먼저 쳐요"


def test_습관이_없는데_습관_문구를_쓰면_OUTPUT_INVALID(tmp_path):
    bad = json.dumps(
        {"title": "킥보다 먼저", "sub": "평소처럼 늦어요, 먼저 쳐요"}, ensure_ascii=False
    )
    runner, session = _runner(
        tmp_path, lambda s, u: bad, _Response(200, CLAIM), _Response(200, {"status": "FAILED"})
    )
    runner.poll()
    assert session.calls[1]["url"].endswith("/9/failure")
    assert session.calls[1]["data"]["code"] == "OUTPUT_INVALID"
    assert "근거 없이 습관을 말함" in session.calls[1]["data"]["summary"]
