"""heartbeat 스레드와 eventSeq 번호.

- EventSeq: heartbeat와 failure가 같이 쓰는 증가 번호. BE는 중복·이전 순번을 무시하므로 잠금으로 순서를 지킴
- Heartbeat: 추론과 독립된 스레드. heartbeat_sec마다 현재 진행률을 보냄. 409(임대 만료·다른 attempt)·404·422면
  lease_lost를 켜고 더 보내지 않음. 연결 오류는 로그만 남기고 다음 주기에 다시 보냄
"""

from __future__ import annotations

import logging
import threading

from ssaplash_ai.worker.api import ApiError, WorkerApi

logger = logging.getLogger("ssaplash_ai.worker.heartbeat")

PROGRESS_MIN = 0
PROGRESS_MAX = 99


class EventSeq:
    """attempt 하나 안에서 1부터 증가하는 번호. 스레드 사이에서 안전."""

    def __init__(self) -> None:
        self._value = 0
        self._lock = threading.Lock()

    def next(self) -> int:
        with self._lock:
            self._value += 1
            return self._value

    @property
    def current(self) -> int:
        return self._value


class Heartbeat:
    """작업 하나의 heartbeat 스레드. start() → set_progress()로 갱신 → stop()."""

    def __init__(
        self,
        api: WorkerApi,
        job_id: int,
        attempt_id: str,
        seq: EventSeq,
        interval_sec: float,
        initial_progress: int = PROGRESS_MIN,
    ) -> None:
        self.api = api
        self.job_id = job_id
        self.attempt_id = attempt_id
        self.seq = seq
        self.interval_sec = interval_sec
        self._progress = _clamp(initial_progress)
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._lease_lost = threading.Event()
        self._thread = threading.Thread(target=self._run, name=f"heartbeat-{job_id}", daemon=True)
        self.sent: list[int] = []  # 보낸 진행률 기록(로그·테스트용)
        self.lease_expires_at = ""

    # ---- 상태 ----

    @property
    def progress(self) -> int:
        return self._progress

    @property
    def lease_lost(self) -> bool:
        """409·404·422를 받아 임대를 잃음. JobRunner가 단계 경계에서 확인해 중단."""
        return self._lease_lost.is_set()

    def set_progress(self, value: int) -> None:
        """진행률 갱신. 줄어드는 값은 무시."""
        value = _clamp(value)
        with self._lock:
            if value > self._progress:
                self._progress = value

    # ---- 스레드 ----

    def start(self) -> None:
        """첫 heartbeat를 바로 보내고 스레드 시작."""
        self._send()
        self._thread.start()

    def stop(self, timeout_sec: float | None = None) -> None:
        """스레드를 멈춤. 처리 중인 전송은 끝나길 기다림."""
        self._stop.set()
        if self._thread.is_alive():
            self._thread.join(timeout_sec if timeout_sec is not None else self.interval_sec + 5)

    def _run(self) -> None:
        while not self._stop.wait(self.interval_sec):
            if self._lease_lost.is_set():
                return
            self._send()

    def _send(self) -> None:
        if self._lease_lost.is_set():
            return
        with self._lock:
            progress = self._progress
        try:
            self.lease_expires_at = self.api.heartbeat(
                self.job_id, self.attempt_id, self.seq.next(), progress
            )
            self.sent.append(progress)
        except ApiError as e:
            if e.status in (409, 404, 422):
                logger.warning("heartbeat 거절, 임대 상실로 봄: %s", e)
                self._lease_lost.set()
            else:
                logger.warning("heartbeat 실패, 다음 주기에 다시: %s", e)


def _clamp(value: int) -> int:
    return max(PROGRESS_MIN, min(PROGRESS_MAX, int(value)))
