"""후보 적재 API 클라이언트(설계 문서 부록 C.4, 요청 문서 `COACH-004_R3-후보적재-계약`).

- 같은 `batchId`로 사용자를 나눠 보낸다. 한 요청의 크기는 `max_bytes`를 넘지 않는다.
- 연결 오류·시간 초과·429·5xx는 같은 본문으로 다시 보낸다. BE가 `batchId`로 멱등하게 처리하므로 안전하다.
- 그 밖의 4xx는 재시도해도 같으므로 바로 멈춘다. 멈추면 지금까지 보낸 개수를 보고한다(부분 실패).
- 토큰, 사용자 키, 응답 본문은 오류·로그에 쓰지 않는다. 상태 코드와 개수만 쓴다.
"""

from __future__ import annotations

import json
import os
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import requests

# 채보 워커와 같은 BE 주소·토큰을 쓴다(worker.config를 가져오면 채보 의존성까지 올라온다)
ENV_BASE_URL = "SSAPLASH_WORKER_BASE_URL"
ENV_TOKEN = "SSAPLASH_WORKER_TOKEN"
API_PATH = "/internal/v1/recommend-candidates"
MAX_SONGS_PER_USER = 50
DEFAULT_MAX_BYTES = 4 * 1024 * 1024
_RETRY_STATUS = frozenset({429, 500, 502, 503, 504})


class UploadError(Exception):
    """적재 실패. 상태 코드와 이유만 담는다."""


@dataclass(frozen=True)
class UserCandidates:
    user_key: str = field(repr=False)
    song_ids: tuple[int, ...] = field(repr=False)


@dataclass(frozen=True)
class CandidateBatch:
    batch_id: str
    model_version: str
    generated_at: str
    users: tuple[UserCandidates, ...] = field(repr=False)


@dataclass(frozen=True)
class UploadResult:
    """적재 결과. 모두 개수다. `error`가 있으면 일부만 적재됐다."""

    chunks_total: int
    chunks_sent: int
    users_sent: int
    accepted: int
    dropped_unknown: int
    dropped_no_consent: int
    error: str | None = None

    @property
    def complete(self) -> bool:
        return self.error is None and self.chunks_sent == self.chunks_total


def _head(batch: CandidateBatch) -> dict[str, Any]:
    return {
        "batchId": batch.batch_id,
        "modelVersion": batch.model_version,
        "generatedAt": batch.generated_at,
    }


def _encode(body: Mapping[str, Any]) -> bytes:
    return json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def build_bodies(batch: CandidateBatch, max_bytes: int = DEFAULT_MAX_BYTES) -> list[bytes]:
    """요청 본문들. 사용자 순서를 지키며 `max_bytes` 안에서 묶는다. 후보가 없으면 빈 목록이다."""
    head = _head(batch)
    base = len(_encode({**head, "users": []}))
    bodies: list[bytes] = []
    current: list[dict[str, Any]] = []
    size = base
    for user in batch.users:
        if len(user.song_ids) > MAX_SONGS_PER_USER or len(set(user.song_ids)) != len(user.song_ids):
            raise ValueError("사용자 후보는 중복 없이 50개 이하여야 합니다.")
        item = {"userKey": user.user_key, "songIds": list(user.song_ids)}
        item_size = len(_encode(item)) + 1  # 항목 사이 쉼표
        if base + item_size > max_bytes:
            raise ValueError("사용자 한 명의 후보가 요청 크기 한도를 넘습니다.")
        if current and size + item_size > max_bytes:
            bodies.append(_encode({**head, "users": current}))
            current, size = [], base
        current.append(item)
        size += item_size
    if current:
        bodies.append(_encode({**head, "users": current}))
    return bodies


class CandidatesClient:
    def __init__(
        self,
        base_url: str,
        token: str,
        *,
        session: Any = None,
        max_bytes: int = DEFAULT_MAX_BYTES,
        attempts: int = 3,
        backoff_sec: float = 2.0,
        timeout: tuple[float, float] = (5.0, 60.0),
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if not base_url or not token:
            raise ValueError("BE 주소와 토큰이 필요합니다.")
        if attempts < 1:
            raise ValueError("attempts는 1 이상이어야 합니다.")
        self._url = base_url.rstrip("/") + API_PATH
        self._headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        self._session = session or requests.Session()
        self._max_bytes = max_bytes
        self._attempts = attempts
        self._backoff_sec = backoff_sec
        self._timeout = timeout
        self._sleep = sleep

    def __repr__(self) -> str:  # 토큰이 로그에 찍히지 않게 한다
        return f"CandidatesClient(url={self._url!r})"

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None, **kwargs: Any) -> CandidatesClient:
        values = os.environ if env is None else env
        missing = [k for k in (ENV_BASE_URL, ENV_TOKEN) if not values.get(k)]
        if missing:
            raise RuntimeError(f"환경 변수가 없습니다: {missing}")
        return cls(values[ENV_BASE_URL], values[ENV_TOKEN], **kwargs)

    def upload(self, batch: CandidateBatch) -> UploadResult:
        """나눠 보내고 합계를 돌려준다. 실패해도 예외를 던지지 않고 `error`에 이유를 담는다."""
        bodies = build_bodies(batch, self._max_bytes)
        sent = users = accepted = unknown = no_consent = 0
        error: str | None = None
        for body in bodies:
            try:
                counts = self._post(body)
            except UploadError as ex:
                error = str(ex)
                break
            sent += 1
            users += len(json.loads(body)["users"])
            accepted += counts["accepted"]
            unknown += counts["droppedUnknown"]
            no_consent += counts["droppedNoConsent"]
        return UploadResult(len(bodies), sent, users, accepted, unknown, no_consent, error)

    def status(self) -> dict[str, Any]:
        """현재 적재 상태(집계 값)."""
        try:
            response = self._session.get(
                self._url + "/status", headers=self._headers, timeout=self._timeout
            )
        except requests.RequestException as ex:
            raise UploadError(f"연결 실패: {type(ex).__name__}") from None
        if response.status_code != 200:
            raise UploadError(f"상태 조회 거절: HTTP {response.status_code}")
        return _json_object(response)

    def _post(self, body: bytes) -> dict[str, int]:
        last = "알 수 없는 오류"
        for attempt in range(self._attempts):
            if attempt:
                self._sleep(self._backoff_sec * 2 ** (attempt - 1))
            try:
                response = self._session.post(
                    self._url, data=body, headers=self._headers, timeout=self._timeout
                )
            except requests.RequestException as ex:
                last = f"연결 실패: {type(ex).__name__}"
                continue
            if response.status_code in _RETRY_STATUS:
                last = f"서버 오류: HTTP {response.status_code}"
                continue
            if response.status_code != 200:
                raise UploadError(f"적재 거절: HTTP {response.status_code}")
            return _counts(_json_object(response))
        raise UploadError(f"{last} ({self._attempts}번 시도)")


def _json_object(response: Any) -> dict[str, Any]:
    try:
        value = response.json()
    except ValueError:
        raise UploadError("응답이 JSON이 아닙니다") from None
    if not isinstance(value, dict):
        raise UploadError("응답 형식이 계약과 다릅니다")
    return value


def _counts(value: Mapping[str, Any]) -> dict[str, int]:
    names: Sequence[str] = ("accepted", "droppedUnknown", "droppedNoConsent")
    if not all(type(value.get(n)) is int and value[n] >= 0 for n in names):
        raise UploadError("응답 형식이 계약과 다릅니다")
    return {n: value[n] for n in names}
