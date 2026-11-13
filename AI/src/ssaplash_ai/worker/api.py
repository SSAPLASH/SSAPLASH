"""BE 워커 API 호출부. `WorkerApi`가 BE `WorkerController`의 6개 경로를 부름.

요청 본문은 payload.encode의 정규 JSON 바이트. 2xx는 자료형으로, 204는 None.
503·연결 오류·시간 초과는 2·5·15초 간격으로 다시 보냄(heartbeat 제외). 그 밖의 4xx·5xx는 ApiError.
토큰·서명 URL은 로그에 남기지 않음.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

import requests

from ssaplash_ai.chart.errors import summarize_exception
from ssaplash_ai.worker.config import WorkerSettings
from ssaplash_ai.worker.payload import Envelope, encode

logger = logging.getLogger("ssaplash_ai.worker.api")

# 503·연결 오류 재시도 간격(초). 소진하면 전송 계층 실패
RETRY_DELAYS_SEC = (2.0, 5.0, 15.0)
STAGE_SEPARATING = "SEPARATING"
STAGE_TRANSCRIBING = "TRANSCRIBING"
ROLE_SOURCE_AUDIO = "SOURCE_AUDIO"
ROLE_DRUM_STEM = "DRUM_STEM"
ROLE_ACCOMPANIMENT = "ACCOMPANIMENT"
# 오류 본문에서 코드로 읽을 키 후보
ERROR_CODE_KEYS = ("code", "error", "errorCode")
ERROR_MESSAGE_LIMIT = 200


class ApiError(Exception):
    """BE 응답 오류 또는 전송 실패. status가 None이면 연결 오류·시간 초과."""

    def __init__(self, status: int | None, code: str | None, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message

    @property
    def transient(self) -> bool:
        """503 또는 연결 오류. 같은 요청을 다시 보내도 되는 경우."""
        return self.status is None or self.status == 503

    def __str__(self) -> str:
        head = f"HTTP {self.status}" if self.status is not None else "연결 오류"
        code = f" {self.code}" if self.code else ""
        return f"{head}{code}: {self.message}"


@dataclass(frozen=True)
class AssignmentInput:
    """claim 응답 `input`. durationMs는 BE에 저장된 원곡 길이."""

    role: str
    file_id: str
    content_type: str
    size_bytes: int
    sha256: str
    duration_ms: int

    @classmethod
    def from_dict(cls, raw: dict) -> AssignmentInput:
        return cls(
            role=str(raw["role"]),
            file_id=str(raw["fileId"]),
            content_type=str(raw.get("contentType", "")),
            size_bytes=int(raw["sizeBytes"]),
            sha256=str(raw["sha256"]).lower(),
            duration_ms=int(raw.get("durationMs", 0)),
        )


@dataclass(frozen=True)
class Assignment:
    """claim 200 응답 (`WorkerQueue.Assignment`)."""

    contract_version: int
    job_id: int
    song_id: int
    attempt_id: str
    resume_stage: str
    input: AssignmentInput
    requested_difficulties: tuple[str, ...]
    accepted_chart_schema_versions: tuple[int, ...]
    lease_expires_at: str
    stage_deadline_at: str

    @classmethod
    def from_dict(cls, raw: dict) -> Assignment:
        return cls(
            contract_version=int(raw.get("contractVersion", 0)),
            job_id=int(raw["jobId"]),
            song_id=int(raw.get("songId", 0)),
            attempt_id=str(raw["attemptId"]),
            resume_stage=str(raw["resumeStage"]),
            input=AssignmentInput.from_dict(raw["input"]),
            requested_difficulties=tuple(str(d) for d in raw.get("requestedDifficulties", [])),
            accepted_chart_schema_versions=tuple(
                int(v) for v in raw.get("acceptedChartSchemaVersions", [])
            ),
            lease_expires_at=str(raw.get("leaseExpiresAt", "")),
            stage_deadline_at=str(raw.get("stageDeadlineAt", "")),
        )


@dataclass(frozen=True)
class FileGrant:
    """file-access 응답의 파일 하나. url은 서명 URL이라 repr에서 뺌."""

    role: str
    file_id: str
    method: str
    url: str = field(repr=False)
    expires_at: str = ""

    @classmethod
    def from_dict(cls, raw: dict) -> FileGrant:
        return cls(
            role=str(raw["role"]),
            file_id=str(raw["fileId"]),
            method=str(raw["method"]).upper(),
            url=str(raw["url"]),
            expires_at=str(raw.get("expiresAt", "")),
        )


@dataclass(frozen=True)
class Receipt:
    """결과 제출 200 응답 (`WorkerResults.Receipt`)."""

    result_id: str
    accepted: bool
    job_status: str
    revision: int
    chart_version_ids: tuple[int, ...]

    @classmethod
    def from_dict(cls, raw: dict) -> Receipt:
        return cls(
            result_id=str(raw.get("resultId", "")),
            accepted=bool(raw.get("accepted", False)),
            job_status=str(raw.get("jobStatus", "")),
            revision=int(raw.get("revision", 0)),
            chart_version_ids=tuple(int(v) for v in raw.get("chartVersionIds", [])),
        )


@dataclass(frozen=True)
class FailureOutcome:
    """실패 보고 200 응답."""

    status: str
    revision: int


class WorkerApi:
    """BE 워커 API 6개. session과 sleep은 테스트에서 바꿔 끼움."""

    def __init__(
        self,
        settings: WorkerSettings,
        session: requests.Session | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.settings = settings
        self.session = session or requests.Session()
        self._sleep = sleep
        self._base_url = settings.api_url  # 하위 클래스가 다른 경로 접두어로 바꿈
        self._headers = {
            "Authorization": f"Bearer {settings.token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        self._timeout = (settings.connect_timeout_sec, settings.read_timeout_sec)

    # ---- 6개 호출 ----

    def claim(self, claim_request_id: str) -> Assignment | None:
        """`POST /claim`. 배정이 있으면 Assignment, 대기 작업이 없으면(204) None."""
        body = {"workerId": self.settings.worker_id, "claimRequestId": claim_request_id}
        raw = self._post("/claim", body)
        return None if raw is None else Assignment.from_dict(raw)

    def heartbeat(self, job_id: int, attempt_id: str, event_seq: int, progress: int) -> str:
        """`POST /{jobId}/heartbeat`. 새 임대 만료 시각 문자열. 재시도 없음(자기 주기에 다시 보냄)."""
        body = {"attemptId": attempt_id, "eventSeq": event_seq, "progress": int(progress)}
        raw = self._post(f"/{job_id}/heartbeat", body, retry=False) or {}
        return str(raw.get("leaseExpiresAt", ""))

    def file_access(self, job_id: int, attempt_id: str, files: Sequence[dict]) -> list[FileGrant]:
        """`POST /{jobId}/file-access`. files 항목은 {role, fileId?, sizeBytes?}."""
        body = {"attemptId": attempt_id, "files": list(files)}
        raw = self._post(f"/{job_id}/file-access", body) or {}
        return [FileGrant.from_dict(item) for item in raw.get("files", [])]

    def submit_separation(self, job_id: int, envelope: Envelope) -> Receipt:
        """`POST /{jobId}/results/separation`. 봉투 바이트를 그대로 보냄."""
        raw = self._post_bytes(f"/{job_id}/results/separation", envelope.body) or {}
        return Receipt.from_dict(raw)

    def submit_transcription(self, job_id: int, envelope: Envelope) -> Receipt:
        """`POST /{jobId}/results/transcription`."""
        raw = self._post_bytes(f"/{job_id}/results/transcription", envelope.body) or {}
        return Receipt.from_dict(raw)

    def report_failure(
        self,
        job_id: int,
        attempt_id: str,
        event_seq: int,
        stage: str,
        code: str,
        retryable: bool,
        summary: str,
        reason: str | None = None,
    ) -> FailureOutcome:
        """`POST /{jobId}/failure`. summary는 한 줄 200자로 자름. reason은 설정 send_reason이 참일 때만 넣음."""
        body = {
            "attemptId": attempt_id,
            "eventSeq": event_seq,
            "stage": stage,
            "code": code,
            "retryable": bool(retryable),
            "summary": one_line(summary),
        }
        if reason is not None and self.settings.send_reason:
            body["reason"] = reason
        raw = self._post(f"/{job_id}/failure", body) or {}
        return FailureOutcome(
            status=str(raw.get("status", "")), revision=int(raw.get("revision", 0))
        )

    # ---- 전송 ----

    def _post(self, path: str, body: dict, retry: bool = True) -> dict | None:
        return self._post_bytes(path, encode(body), retry=retry)

    def _post_bytes(self, path: str, body: bytes, retry: bool = True) -> dict | None:
        url = self._base_url + path
        delays: tuple[float, ...] = (0.0, *RETRY_DELAYS_SEC) if retry else (0.0,)
        last: ApiError | None = None
        for delay in delays:
            if delay:
                logger.info("%s 재시도까지 %.0f초 대기 (%s)", path, delay, last)
                self._sleep(delay)
            try:
                response = self.session.post(
                    url, data=body, headers=self._headers, timeout=self._timeout
                )
            except (requests.ConnectionError, requests.Timeout) as e:
                last = ApiError(None, None, summarize_exception(e))
                continue
            if response.status_code == 503:
                last = ApiError(503, _error_code(response), "일시 장애")
                continue
            if response.status_code == 204:
                return None
            if 200 <= response.status_code < 300:
                return _json_or_empty(response)
            raise ApiError(response.status_code, _error_code(response), _error_message(response))
        assert last is not None
        raise last


def one_line(text: str, limit: int = ERROR_MESSAGE_LIMIT) -> str:
    """줄바꿈을 공백으로 바꾸고 limit 글자로 자름. BE failure summary 조건."""
    flat = " ".join(str(text).split())
    return flat if len(flat) <= limit else flat[: limit - 3] + "..."


def _json_or_empty(response: requests.Response) -> dict:
    if not response.content:
        return {}
    try:
        data = response.json()
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def _error_code(response: requests.Response) -> str | None:
    data: Any = None
    try:
        data = response.json()
    except ValueError:
        return None
    if isinstance(data, dict):
        for key in ERROR_CODE_KEYS:
            value = data.get(key)
            if isinstance(value, str) and value:
                return value
    return None


def _error_message(response: requests.Response) -> str:
    try:
        data = response.json()
    except ValueError:
        return one_line(response.text[:ERROR_MESSAGE_LIMIT]) if response.text else "본문 없음"
    if isinstance(data, dict):
        for key in ("message", "detail", "error"):
            value = data.get(key)
            if isinstance(value, str) and value:
                return one_line(value)
    return one_line(str(data))
