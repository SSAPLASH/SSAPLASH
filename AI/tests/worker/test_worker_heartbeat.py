"""heartbeat 스레드·eventSeq 테스트. BE API 대신 호출을 기록하는 가짜 객체를 씀."""

from __future__ import annotations

import threading
import time

from ssaplash_ai.worker.api import ApiError
from ssaplash_ai.worker.heartbeat import EventSeq, Heartbeat


class _Api:
    def __init__(self, fail_status: int | None = None, fail_at: int | None = None) -> None:
        self.calls: list[tuple[int, str, int, int]] = []
        self.fail_status = fail_status
        self.fail_at = fail_at

    def heartbeat(self, job_id, attempt_id, event_seq, progress):
        self.calls.append((job_id, attempt_id, event_seq, progress))
        if self.fail_status is not None and (
            self.fail_at is None or len(self.calls) >= self.fail_at
        ):
            raise ApiError(self.fail_status, None, "x")
        return "2026-10-29T00:00:10Z"


def test_eventseq는_스레드_사이에서_겹치지_않는다():
    seq = EventSeq()
    got: list[int] = []
    lock = threading.Lock()

    def worker():
        for _ in range(200):
            n = seq.next()
            with lock:
                got.append(n)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(got) == list(range(1, 801)) and seq.current == 800


def test_시작할_때_바로_보내고_주기마다_현재_진행률을_보낸다():
    api = _Api()
    hb = Heartbeat(api, 42, "a", EventSeq(), interval_sec=0.05)
    hb.start()
    hb.set_progress(10)
    time.sleep(0.18)
    hb.set_progress(40)
    time.sleep(0.12)
    hb.stop()
    seqs = [c[2] for c in api.calls]
    progresses = [c[3] for c in api.calls]
    assert seqs == list(range(1, len(seqs) + 1))  # 증가
    assert progresses[0] == 0 and progresses == sorted(progresses)  # 줄지 않음
    assert 40 in progresses and len(api.calls) >= 4
    assert hb.lease_expires_at == "2026-10-29T00:00:10Z"
    assert not hb.lease_lost


def test_진행률은_줄어들지_않고_0_99로_자른다():
    hb = Heartbeat(_Api(), 1, "a", EventSeq(), interval_sec=10, initial_progress=50)
    hb.set_progress(30)
    assert hb.progress == 50
    hb.set_progress(150)
    assert hb.progress == 99


def test_409면_임대_상실로_표시하고_더_보내지_않는다():
    api = _Api(fail_status=409, fail_at=2)
    hb = Heartbeat(api, 1, "a", EventSeq(), interval_sec=0.03)
    hb.start()
    time.sleep(0.2)
    hb.stop()
    assert hb.lease_lost is True
    assert len(api.calls) == 2  # 1번 성공, 2번 409, 그 뒤 없음


def test_연결_오류는_다음_주기에_다시_보낸다():
    api = _Api(fail_status=None)
    seq = EventSeq()
    hb = Heartbeat(api, 1, "a", seq, interval_sec=0.03)
    api.fail_status = None
    hb.start()
    api.fail_status = 503  # 연결 오류·503은 임대 상실이 아님
    time.sleep(0.1)
    hb.stop()
    assert not hb.lease_lost and len(api.calls) >= 2
    assert seq.current == len(api.calls)  # failure가 쓸 다음 번호는 heartbeat보다 큼
