"""ssaplash-worker 명령줄 테스트. check·run --once·fake-be 인자."""

from __future__ import annotations

from pathlib import Path

import pytest
from worker_helpers import worker_env, write_mock_configs

from helpers import make_hits, write_wav
from ssaplash_ai.worker.cli import build_parser, main
from ssaplash_ai.worker.config import ENV_BASE_URL, ENV_TOKEN, ENV_WORKER_ID
from ssaplash_ai.worker.fake_be import FakeBackend, FakeBackendServer


def _set_env(monkeypatch: pytest.MonkeyPatch, env: dict[str, str]) -> None:
    for key, value in env.items():
        monkeypatch.setenv(key, value)


def _config_args(tmp_path: Path) -> list[str]:
    sep_cfg, tr_cfg = write_mock_configs(tmp_path)
    # 분리 전 음악 여부 검사는 실제 분류 모델을 올리므로 mock 모델 테스트에서는 끔
    return [
        "--separation-config",
        str(sep_cfg),
        "--transcription-config",
        str(tr_cfg),
        "--music-check-config",
        "",
    ]


def test_check는_모델을_올려_보고_0(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
):
    _set_env(monkeypatch, worker_env("http://127.0.0.1:9", tmp_path / "work"))
    assert main(["check", *_config_args(tmp_path)]) == 0
    out = capsys.readouterr().out
    assert "분리 모델: mock_half" in out and "채보 모델: mock_clicks" in out
    assert "http://127.0.0.1:9/internal/v1/chart-jobs" in out


def test_환경_변수가_없으면_1(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    for key in (ENV_BASE_URL, ENV_WORKER_ID, ENV_TOKEN):
        monkeypatch.delenv(key, raising=False)
    assert main(["check", *_config_args(tmp_path)]) == 1
    assert main(["run", *_config_args(tmp_path)]) == 1


def test_설정_파일이_없으면_1(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _set_env(monkeypatch, worker_env("http://127.0.0.1:9", tmp_path / "work"))
    assert main(["check", "--separation-config", "없음.yaml"]) == 1


def test_run_once는_fake_BE의_작업_하나를_끝낸다(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    backend = FakeBackend(out_dir=None)
    song = tmp_path / "song.wav"
    write_wav(song, make_hits(2.2))
    backend.enqueue(song)
    with FakeBackendServer(backend) as srv:
        _set_env(monkeypatch, worker_env(srv.base_url, tmp_path / "work"))
        assert main(["run", "--once", *_config_args(tmp_path)]) == 0
    assert backend.jobs[1].status == "DONE"


def test_fake_be_인자():
    args = build_parser().parse_args(
        ["fake-be", "--song", "a.wav", "--song", "b.wav", "--port", "9000"]
    )
    assert args.song == ["a.wav", "b.wav"] and args.port == 9000 and args.out == "data/fake_be"
    assert args.duration_ms is None


def test_fake_be_곡이_없으면_1(capsys: pytest.CaptureFixture[str]):
    assert main(["fake-be"]) == 1
    assert "--song" in capsys.readouterr().err
