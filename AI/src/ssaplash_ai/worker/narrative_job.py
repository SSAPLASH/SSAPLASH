"""LLM 총평 작업의 BE 호출부와 실행기 (`docs/coach-narrative.md`).

`NarrativeApi`가 BE의 `/internal/v1/coach-narratives` 3개 경로(claim·result·failure)를 부른다. 인증·재시도·오류
처리는 채보 워커의 `WorkerApi`와 같다. `NarrativeRunner`는 배정 하나를 받아 로컬 모델로 문장을 쓰고(가드레일 통과),
결과를 제출한다. 어떤 실패도 BE에는 failure로 알리고 규칙 총평은 그대로 남는다. 입력 값(사실)은 로그에 남기지 않는다.
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass

from pydantic import ValidationError

from ssaplash_ai.coach.narrative import NarrativeFacts, TextGenerator, write_narrative
from ssaplash_ai.worker.api import ApiError, WorkerApi, one_line

logger = logging.getLogger("ssaplash_ai.worker.narrative")

CODE_INPUT_INVALID = "INPUT_INVALID"
CODE_MODEL_FAILED = "MODEL_FAILED"
CODE_OUTPUT_INVALID = "OUTPUT_INVALID"

NOT_FOUND_BACKOFF_SEC = 300.0

STATUS_DONE = "DONE"
STATUS_FAILED_REPORTED = "FAILED_REPORTED"
STATUS_ABANDONED = "ABANDONED"  # BE가 임대 만료·중복 등으로 거절 → 놓음


@dataclass(frozen=True)
class NarrativeAssignment:
    job_id: int
    attempt_id: str
    lease_expires_at: str
    facts: dict  # 검증은 실행기가 한다(모양이 틀리면 INPUT_INVALID로 보고)


@dataclass(frozen=True)
class NarrativeJobOutcome:
    job_id: int
    status: str
    detail: str = ""
    attempts: int = 0
    generation_ms: int = 0


class NarrativeApi(WorkerApi):
    """`WorkerApi`와 같은 전송 규칙을 쓰되 경로 접두어만 다르다."""

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._base_url = self.settings.narrative_api_url

    def claim_narrative(self, claim_request_id: str) -> NarrativeAssignment | None:
        """`POST /claim`. 작업이 없으면(204) None."""
        body = {"workerId": self.settings.worker_id, "claimRequestId": claim_request_id}
        raw = self._post("/claim", body)
        if raw is None:
            return None
        try:
            return NarrativeAssignment(
                job_id=int(raw["jobId"]),
                attempt_id=str(raw["attemptId"]),
                lease_expires_at=str(raw.get("leaseExpiresAt", "")),
                facts=dict(raw["facts"]),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ApiError(200, None, "claim 응답 모양이 다름") from exc

    def submit_narrative(
        self, job_id: int, attempt_id: str, text: str, model: str, generation_ms: int
    ) -> None:
        body = {
            "attemptId": attempt_id,
            "text": text,
            "model": model,
            "generationMs": generation_ms,
        }
        self._post(f"/{job_id}/result", body)

    def report_narrative_failure(
        self, job_id: int, attempt_id: str, code: str, retryable: bool, summary: str
    ) -> None:
        body = {
            "attemptId": attempt_id,
            "code": code,
            "retryable": retryable,
            "summary": one_line(summary),
        }
        self._post(f"/{job_id}/failure", body)


class NarrativeRunner:
    def __init__(self, api: NarrativeApi, generator: TextGenerator, model_name: str) -> None:
        self.api = api
        self.generator = generator
        self.model_name = model_name[:37]  # BE 검증: 모델 이름 37자 이하
        self._off_until = 0.0

    def poll(self) -> NarrativeJobOutcome | None:
        """총평 작업 하나를 가져와 처리한다. 작업이 없거나 가져오지 못하면 None.

        BE에 총평 작업 API가 아직 없으면(404) 채보 작업에 영향이 없도록 5분 동안 묻지 않는다.
        401은 위로 올려 워커 루프가 종료 코드로 알린다.
        """
        if time.monotonic() < self._off_until:
            return None
        try:
            assignment = self.api.claim_narrative(str(uuid.uuid4()))
        except ApiError as exc:
            if exc.status == 401:
                raise
            if exc.status == 404:
                logger.info("총평 작업 API가 없음(404). 5분 뒤 다시 확인")
                self._off_until = time.monotonic() + NOT_FOUND_BACKOFF_SEC
            else:
                logger.warning("총평 작업 claim 실패: %s", exc)
            return None
        return None if assignment is None else self.run(assignment)

    def run(self, assignment: NarrativeAssignment) -> NarrativeJobOutcome:
        job_id, attempt_id = assignment.job_id, assignment.attempt_id
        try:
            facts = NarrativeFacts.model_validate(assignment.facts)
        except ValidationError:
            # 어느 필드가 틀렸는지만 알리고 값은 담지 않는다
            self._fail(assignment, CODE_INPUT_INVALID, False, "facts 모양이 계약과 다름")
            return NarrativeJobOutcome(job_id, STATUS_FAILED_REPORTED, CODE_INPUT_INVALID)

        started = time.perf_counter()
        outcome = write_narrative(facts, self.generator)
        elapsed_ms = round((time.perf_counter() - started) * 1000)

        if outcome.text is None:
            model_down = any(v.startswith("생성기 오류") for v in outcome.violations)
            code = CODE_MODEL_FAILED if model_down else CODE_OUTPUT_INVALID
            summary = (
                "로컬 모델 서버 오류"
                if model_down
                else "가드레일 거절: " + "; ".join(outcome.violations)
            )
            self._fail(assignment, code, model_down, summary)
            logger.info("총평 작업 %d 실패 보고 (%s, 시도 %d)", job_id, code, outcome.attempts)
            return NarrativeJobOutcome(
                job_id, STATUS_FAILED_REPORTED, code, outcome.attempts, elapsed_ms
            )

        try:
            self.api.submit_narrative(job_id, attempt_id, outcome.text, self.model_name, elapsed_ms)
        except ApiError as exc:
            if exc.status == 401:
                raise
            logger.warning("총평 작업 %d 결과 제출 거절, 놓음: %s", job_id, exc)
            return NarrativeJobOutcome(
                job_id, STATUS_ABANDONED, str(exc), outcome.attempts, elapsed_ms
            )
        logger.info(
            "총평 작업 %d 완료 (시도 %d, %d ms, %d자)",
            job_id,
            outcome.attempts,
            elapsed_ms,
            len(outcome.text),
        )
        return NarrativeJobOutcome(job_id, STATUS_DONE, "", outcome.attempts, elapsed_ms)

    def _fail(self, a: NarrativeAssignment, code: str, retryable: bool, summary: str) -> None:
        try:
            self.api.report_narrative_failure(a.job_id, a.attempt_id, code, retryable, summary)
        except ApiError as exc:
            if exc.status == 401:
                raise
            logger.warning("총평 작업 %d 실패 보고도 거절됨: %s", a.job_id, exc)
