"""실행 루프 테스트: 모델 올리기, claim 폴링, once·max_jobs, 401 종료, stop."""

from __future__ import annotations

import threading
import time
from pathlib import Path

import pytest
from worker_helpers import worker_env, write_mock_configs

from helpers import make_hits, write_wav
from ssaplash_ai.worker.api import WorkerApi
from ssaplash_ai.worker.config import ENV_TOKEN, WorkerSettings
from ssaplash_ai.worker.fake_be import FakeBackend, FakeBackendServer
from ssaplash_ai.worker.loop import EXIT_AUTH, EXIT_OK, WorkerLoop


@pytest.fixture
def server(tmp_path: Path):
    backend = FakeBackend(out_dir=None)
    with FakeBackendServer(backend) as srv:
        yield backend, srv


def _loop(tmp_path: Path, base_url: str, token: str | None = None) -> WorkerLoop:
    sep_cfg, tr_cfg = write_mock_configs(tmp_path)
    env = worker_env(base_url, tmp_path / "work")
    if token is not None:
        env[ENV_TOKEN] = token
    settings = WorkerSettings.from_env(env, separation_config=sep_cfg, transcription_config=tr_cfg)
    loop = WorkerLoop(settings, sleep=lambda s: time.sleep(min(s, 0.05)))
    loop.api = WorkerApi(settings, session=loop.session, sleep=lambda s: None)
    return loop


def _song(tmp_path: Path, name: str) -> Path:
    path = tmp_path / name
    write_wav(path, make_hits(2.2))
    return path


def test_load_models는_두_모델을_올리고_runner를_만든다(tmp_path: Path, server):
    _, srv = server
    loop = _loop(tmp_path, srv.base_url)
    sep_sec, tr_sec = loop.load_models()
    assert sep_sec >= 0 and tr_sec >= 0
    assert loop.separation.loaded and loop.transcription.loaded and loop.runner is not None
    loop.close()
    assert not loop.separation.loaded


def test_분리_출력이_flac이_아니면_ValueError(tmp_path: Path, server):
    _, srv = server
    loop = _loop(tmp_path, srv.base_url)
    cfg = loop.settings.separation_config
    cfg.write_text(
        cfg.read_text(encoding="utf-8").replace("format: flac", "format: wav"), encoding="utf-8"
    )
    with pytest.raises(ValueError, match="flac"):
        loop.load_models()


def test_once는_작업_하나_처리_후_종료(tmp_path: Path, server):
    backend, srv = server
    backend.enqueue(_song(tmp_path, "a.wav"))
    backend.enqueue(_song(tmp_path, "b.wav"))
    loop = _loop(tmp_path, srv.base_url)
    loop.load_models()
    assert loop.run(once=True) == EXIT_OK
    assert len(loop.outcomes) == 1 and loop.outcomes[0].status == "DONE"
    assert backend.jobs[1].status == "DONE" and backend.jobs[2].status == "QUEUED"


def test_max_jobs는_그_수만큼_처리(tmp_path: Path, server):
    backend, srv = server
    backend.enqueue(_song(tmp_path, "a.wav"))
    backend.enqueue(_song(tmp_path, "b.wav"))
    loop = _loop(tmp_path, srv.base_url)
    loop.load_models()
    assert loop.run(max_jobs=2) == EXIT_OK
    assert [j.status for j in backend.jobs.values()] == ["DONE", "DONE"]


def test_401이면_종료_코드_2(tmp_path: Path, server):
    _, srv = server
    loop = _loop(tmp_path, srv.base_url, token="wrong-token-" + "x" * 30)
    loop.load_models()
    assert loop.run() == EXIT_AUTH


def test_대기_작업이_없으면_폴링하다가_stop으로_끝난다(tmp_path: Path, server):
    _, srv = server
    loop = _loop(tmp_path, srv.base_url)
    loop.load_models()
    result: list[int] = []
    thread = threading.Thread(target=lambda: result.append(loop.run()))
    thread.start()
    time.sleep(0.3)
    loop.request_stop()
    thread.join(timeout=5)
    assert result == [EXIT_OK] and loop.outcomes == []
