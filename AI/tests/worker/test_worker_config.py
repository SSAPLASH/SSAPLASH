"""워커 설정 읽기 테스트. 토큰 값이 오류 메시지·repr에 나오지 않는지도 본다."""

from __future__ import annotations

from pathlib import Path

import pytest

from ssaplash_ai.chart.config import ENV_WORK_DIR
from ssaplash_ai.worker.config import (
    ENV_BASE_URL,
    ENV_HEARTBEAT_SEC,
    ENV_KEEP_FILES,
    ENV_POLL_SEC,
    ENV_SEND_REASON,
    ENV_TOKEN,
    ENV_WORKER_ID,
    WorkerSettings,
)

TOKEN = "t" * 40


def _env(**over: str) -> dict[str, str]:
    env = {
        ENV_BASE_URL: "https://k15a307.p.ssafy.io/",
        ENV_WORKER_ID: "worker1",
        ENV_TOKEN: TOKEN,
        ENV_WORK_DIR: "C:/work",
    }
    env.update(over)
    return env


def test_필수_값만으로_기본값이_채워진다():
    s = WorkerSettings.from_env(_env())
    assert s.base_url == "https://k15a307.p.ssafy.io/"
    assert s.api_url == "https://k15a307.p.ssafy.io/internal/v1/chart-jobs"
    assert s.worker_id == "worker1" and s.token == TOKEN
    assert s.work_dir == Path("C:/work") and s.jobs_dir == Path("C:/work") / "worker"
    assert s.poll_sec == 5.0 and s.heartbeat_sec == 10.0 and s.keep_files is False
    assert s.separation_config == Path("configs/chart/separation.yaml")
    assert s.transcription_config == Path("configs/chart/transcription.yaml")


def test_선택_값과_설정_경로():
    s = WorkerSettings.from_env(
        _env(**{ENV_POLL_SEC: "2.5", ENV_HEARTBEAT_SEC: "7", ENV_KEEP_FILES: "true"}),
        separation_config="a.yaml",
        transcription_config=Path("b.yaml"),
    )
    assert s.poll_sec == 2.5 and s.heartbeat_sec == 7.0 and s.keep_files is True
    assert s.separation_config == Path("a.yaml") and s.transcription_config == Path("b.yaml")


def test_reason_전송은_기본_꺼짐():
    assert WorkerSettings.from_env(_env()).send_reason is False
    assert WorkerSettings.from_env(_env(**{ENV_SEND_REASON: "1"})).send_reason is True
    assert WorkerSettings.from_env(_env(**{ENV_SEND_REASON: "no"})).send_reason is False


def test_빠진_변수는_이름을_모두_알려준다():
    with pytest.raises(ValueError, match=f"{ENV_WORKER_ID}, {ENV_TOKEN}"):
        WorkerSettings.from_env({ENV_BASE_URL: "http://x", ENV_WORK_DIR: "w"})


def test_짧은_토큰은_거부하고_값은_메시지에_없다():
    short = "short-token"
    with pytest.raises(ValueError) as info:
        WorkerSettings.from_env(_env(**{ENV_TOKEN: short}))
    assert "32바이트" in str(info.value) and short not in str(info.value)


def test_토큰은_repr에_나오지_않는다():
    s = WorkerSettings.from_env(_env())
    assert TOKEN not in repr(s)


def test_주소는_http로_시작해야_한다():
    with pytest.raises(ValueError, match="http"):
        WorkerSettings.from_env(_env(**{ENV_BASE_URL: "k15a307.p.ssafy.io"}))


@pytest.mark.parametrize("bad", ["0", "-1", "abc"])
def test_주기는_양수_숫자(bad: str):
    with pytest.raises(ValueError, match=ENV_POLL_SEC):
        WorkerSettings.from_env(_env(**{ENV_POLL_SEC: bad}))
