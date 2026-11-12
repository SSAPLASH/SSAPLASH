"""연주 중 LLM 구간 코칭 작업의 BE 호출부와 실행기, 전용 루프 (`docs/live-coach-llm.md`).

`LiveCoachApi`가 BE의 `/internal/v1/live-coach-jobs` 3개 경로(claim·result·failure)를 부른다. 인증·오류 처리는
채보·총평 워커의 `WorkerApi`와 같지만, 늦은 답은 쓸모없어서 **재시도하지 않는다**.
`LiveCoachRunner`는 배정 하나를 받아 로컬 모델로 안내 칸 문구를 쓰고(가드레일 통과) 결과를 제출한다.
`run_live_loop`는 채보·총평 워커와 **따로 도는 프로세스**의 반복이다. 채보 작업이 몇 분씩 걸려도 연주 코칭이 기다리지 않는다.
어떤 실패도 BE에는 failure로 알리고, 그 구간은 FE에서 규칙 코칭만 쓴다. 사실(facts)은 로그에 남기지 않는다.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass

from pydantic import ValidationError

from ssaplash_ai.coach.live_narrative import LiveSegmentFacts, write_live_tip
from ssaplash_ai.coach.narrative import TextGenerator
from ssaplash_ai.worker.api import ApiError, WorkerApi, one_line

logger = logging.getLogger("ssaplash_ai.worker.live_coach")

LIVE_COACH_API_PATH = "/internal/v1/live-coach-jobs"
CODE_INPUT_INVALID = "INPUT_INVALID"
CODE_MODEL_FAILED = "MODEL_FAILED"
CODE_OUTPUT_INVALID = "OUTPUT_INVALID"
STATUS_DONE = "DONE"
STATUS_FAILED_REPORTED = "FAILED_REPORTED"
STATUS_ABANDONED = "ABANDONED"
NOT_FOUND_BACKOFF_SEC = 300.0
ERROR_BACKOFF_SEC = 5.0


@dataclass(frozen=True)
class LiveCoachAssignment:
    job_id: int
    attempt_id: str
    facts: dict


@dataclass(frozen=True)
class LiveCoachOutcome:
    job_id: int
    status: str
    detail: str = ""
    attempts: int = 0
    generation_ms: int = 0


class LiveCoachApi(WorkerApi):
    """`WorkerApi`와 같은 전송 규칙에 경로 접두어만 다르다. 모든 호출은 재시도 없이 한 번이다."""

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._base_url = self.settings.base_url.rstrip("/") + LIVE_COACH_API_PATH

    def claim_live(self, claim_request_id: str) -> LiveCoachAssignment | None:
        body = {"workerId": self.settings.worker_id, "claimRequestId": claim_request_id}
        raw = self._post("/claim", body, retry=False)
        if raw is None:
            return None
        try:
            return LiveCoachAssignment(int(raw["jobId"]), str(raw["attemptId"]), dict(raw["facts"]))
        except (KeyError, TypeError, ValueError) as exc:
            raise ApiError(200, None, "claim 응답 모양이 다름") from exc

    def submit_live(
        self, job_id: int, attempt_id: str, title: str, sub: str, model: str, generation_ms: int
    ) -> None:
        body = {
            "attemptId": attempt_id,
            "title": title,
            "sub": sub,
            "model": model,
            "generationMs": generation_ms,
        }
        self._post(f"/{job_id}/result", body, retry=False)

    def report_live_failure(self, job_id: int, attempt_id: str, code: str, summary: str) -> None:
        body = {"attemptId": attempt_id, "code": code, "summary": one_line(summary)}
        self._post(f"/{job_id}/failure", body, retry=False)


class LiveCoachRunner:
    def __init__(self, api: LiveCoachApi, generator: TextGenerator, model_name: str) -> None:
        self.api = api
        self.generator = generator
        self.model_name = model_name[:37]  # BE 검증: 모델 이름 37자 이하
        self._off_until = 0.0

    def poll(self) -> LiveCoachOutcome | None:
        """작업 하나를 가져와 처리한다. 없거나 가져오지 못하면 None. 401은 위로 올린다.

        BE에 이 API가 아직 없으면(404) 5분 동안 묻지 않는다.
        """
        if time.monotonic() < self._off_until:
            return None
        try:
            assignment = self.api.claim_live(str(uuid.uuid4()))
        except ApiError as exc:
            if exc.status == 401:
                raise
            if exc.status == 404:
                logger.info("연주 코칭 작업 API가 없음(404). 5분 뒤 다시 확인")
                self._off_until = time.monotonic() + NOT_FOUND_BACKOFF_SEC
            else:
                logger.warning("연주 코칭 claim 실패: %s", exc)
                self._off_until = time.monotonic() + ERROR_BACKOFF_SEC
            return None
        return None if assignment is None else self.run(assignment)

    def run(self, a: LiveCoachAssignment) -> LiveCoachOutcome:
        try:
            facts = LiveSegmentFacts.model_validate(a.facts)
        except ValidationError:
            self._fail(a, CODE_INPUT_INVALID, "facts 모양이 계약과 다름")
            return LiveCoachOutcome(a.job_id, STATUS_FAILED_REPORTED, CODE_INPUT_INVALID)

        started = time.perf_counter()
        outcome = write_live_tip(facts, self.generator)
        elapsed_ms = round((time.perf_counter() - started) * 1000)
        if outcome.tip is None:
            model_down = any(v.startswith("생성기 오류") for v in outcome.violations)
            code = CODE_MODEL_FAILED if model_down else CODE_OUTPUT_INVALID
            summary = (
                "로컬 모델 서버 오류"
                if model_down
                else "가드레일 거절: " + "; ".join(outcome.violations)
            )
            self._fail(a, code, summary)
            # 거절 이유는 규칙 이름과 글자 수뿐이라 사실 값이 없다. 운영에서 원인을 바로 보려고 남긴다
            logger.info(
                "연주 코칭 %d 실패 보고 (%s, 시도 %d, %d ms): %s",
                a.job_id,
                code,
                outcome.attempts,
                elapsed_ms,
                "; ".join(outcome.violations),
            )
            return LiveCoachOutcome(
                a.job_id, STATUS_FAILED_REPORTED, code, outcome.attempts, elapsed_ms
            )

        try:
            self.api.submit_live(
                a.job_id,
                a.attempt_id,
                outcome.tip.title,
                outcome.tip.sub,
                self.model_name,
                elapsed_ms,
            )
        except ApiError as exc:
            if exc.status == 401:
                raise
            logger.warning("연주 코칭 %d 결과 제출 거절, 놓음: %s", a.job_id, exc)
            return LiveCoachOutcome(
                a.job_id, STATUS_ABANDONED, str(exc), outcome.attempts, elapsed_ms
            )
        logger.info("연주 코칭 %d 완료 (시도 %d, %d ms)", a.job_id, outcome.attempts, elapsed_ms)
        return LiveCoachOutcome(a.job_id, STATUS_DONE, "", outcome.attempts, elapsed_ms)

    def _fail(self, a: LiveCoachAssignment, code: str, summary: str) -> None:
        try:
            self.api.report_live_failure(a.job_id, a.attempt_id, code, summary)
        except ApiError as exc:
            if exc.status == 401:
                raise
            logger.warning("연주 코칭 %d 실패 보고도 거절됨: %s", a.job_id, exc)


def run_live_loop(
    runner: LiveCoachRunner,
    poll_sec: float,
    stop: threading.Event,
    max_jobs: int | None = None,
    wait: Callable[[float], None] | None = None,
) -> int:
    """일이 있으면 바로 다음 claim, 없으면 `poll_sec` 기다린다. 처리한 작업 수를 돌려준다. 401이면 ApiError를 올린다."""
    pause = wait or stop.wait
    processed = 0
    while not stop.is_set():
        outcome = runner.poll()
        if outcome is None:
            pause(poll_sec)
            continue
        processed += 1
        if max_jobs is not None and processed >= max_jobs:
            break
    return processed
