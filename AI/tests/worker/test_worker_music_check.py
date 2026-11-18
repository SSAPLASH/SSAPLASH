"""워커의 분리 전 음악 여부 검사 테스트: fake BE + mock 모델 + 분류 모델 대역.

검사에 걸린 파일은 분리를 돌리지 않고 NOT_TRANSCRIBABLE로 보고하고, 통과한 파일과 검사가 꺼진 경우는 지금과 같이 DONE까지 감.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path

import numpy as np
import pytest
from worker_helpers import Rig, worker_env, write_mock_configs

from helpers import make_hits, write_wav
from ssaplash_ai.chart import music_check
from ssaplash_ai.chart.config import DEFAULT_MUSIC_CHECK_CONFIG, MusicCheckConfig
from ssaplash_ai.chart.music_check import MusicCheckModule
from ssaplash_ai.worker.api import WorkerApi
from ssaplash_ai.worker.cli import build_parser
from ssaplash_ai.worker.cli import main as worker_main
from ssaplash_ai.worker.config import WorkerSettings
from ssaplash_ai.worker.fake_be import FakeBackend, FakeBackendServer
from ssaplash_ai.worker.job import STATUS_DONE, STATUS_FAILED_REPORTED
from ssaplash_ai.worker.loop import WorkerLoop


class FakeTagger:
    """정해 둔 음악 확률·말소리 확률을 돌려주는 분류 모델 대역."""

    name = "fake_tagger"
    version = "v1"

    def __init__(self, music: float, speech: float, load_error: Exception | None = None):
        self.music, self.speech, self.load_error = music, speech, load_error
        self.calls = 0
        self.fail = False

    def load(self) -> None:
        if self.load_error is not None:
            raise self.load_error

    def predict(self, windows):
        self.calls += 1
        if self.fail:
            raise RuntimeError("분류 모델 실행 실패")
        n = len(windows)
        return np.full(n, self.music, dtype=np.float32), np.full(n, self.speech, dtype=np.float32)

    def close(self) -> None:
        return None


def _check(tagger: FakeTagger) -> MusicCheckModule:
    config = MusicCheckConfig.from_dict({"min_music_prob": 0.28, "max_speech_prob": 0.44})
    module = MusicCheckModule(config, tagger=tagger)
    module.load()
    return module


def _song(tmp_path: Path) -> Path:
    path = tmp_path / "song.wav"
    write_wav(path, make_hits(2.2))
    return path


def _events(backend: FakeBackend, job_id: int, kind: str) -> list[dict]:
    return [e for e in backend.jobs[job_id].events if e["type"] == kind]


# ---- 작업 흐름 ----


def test_검사에_걸리면_분리를_돌리지_않고_NOT_TRANSCRIBABLE로_보고한다(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    tagger = FakeTagger(music=0.15, speech=0.63)
    with Rig(tmp_path, send_reason=True, music_check=_check(tagger)) as rig:
        job_id = rig.backend.enqueue(_song(tmp_path))

        def must_not_run(*args, **kwargs):
            raise AssertionError("검사에 걸린 파일인데 분리 모듈이 불림")

        monkeypatch.setattr(rig.separation, "separate_file", must_not_run)
        out = rig.run_one()
        assert out.status == STATUS_FAILED_REPORTED and out.separate_ms is None
        assert out.failure_code == "INPUT_INVALID" and out.failure_reason == "NOT_TRANSCRIBABLE"
        event = _events(rig.backend, job_id, "FAILURE")[0]
        assert event["stage"] == "SEPARATING" and event["code"] == "INPUT_INVALID"
        assert event["retryable"] is False and event["reason"] == "NOT_TRANSCRIBABLE"
        assert "음악 확률 0.15, 기준 0.28" in event["summary"]
        assert "말소리 확률 0.63, 기준 0.44" in event["summary"]
        assert len(event["summary"]) <= 200 and "\n" not in event["summary"]
        job = rig.backend.jobs[job_id]
        assert job.status == "FAILED" and job.separation_result is None
        # 원곡만 내려받고 올린 파일은 없음
        accesses = [f for e in _events(rig.backend, job_id, "FILE_ACCESS") for f in e["files"]]
        assert accesses == ["SOURCE_AUDIO:GET"]
        assert tagger.calls == 1


def test_검사를_통과하면_DONE까지_가고_로그에_확률이_남는다(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
):
    tagger = FakeTagger(music=0.8, speech=0.02)
    with Rig(tmp_path, music_check=_check(tagger)) as rig:
        job_id = rig.backend.enqueue(_song(tmp_path))
        with caplog.at_level(logging.INFO, logger="ssaplash_ai.worker.job"):
            out = rig.run_one()
        assert out.status == STATUS_DONE and rig.backend.jobs[job_id].status == "DONE"
        assert tagger.calls == 1
        assert "음악 여부 검사 통과: 음악 확률 0.80, 말소리 확률 0.02" in caplog.text


def test_분류_모델_실행이_실패하면_검사를_건너뛰고_DONE까지_간다(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
):
    tagger = FakeTagger(music=0.8, speech=0.02)
    with Rig(tmp_path, music_check=_check(tagger)) as rig:
        tagger.fail = True
        job_id = rig.backend.enqueue(_song(tmp_path))
        with caplog.at_level(logging.WARNING, logger="ssaplash_ai.worker.job"):
            out = rig.run_one()
        assert out.status == STATUS_DONE and rig.backend.jobs[job_id].status == "DONE"
        assert "음악 여부 검사를 건너뛰고 분리로 넘어감" in caplog.text


def test_기준값이_비어_있는_검사_모듈은_분류_모델을_부르지_않는다(tmp_path: Path):
    tagger = FakeTagger(music=0.0, speech=1.0)
    module = MusicCheckModule(MusicCheckConfig.from_dict({}), tagger=tagger)
    module.load()
    with Rig(tmp_path, music_check=module) as rig:
        rig.backend.enqueue(_song(tmp_path))
        assert rig.run_one().status == STATUS_DONE
        assert tagger.calls == 0


# ---- 설정·명령줄 ----


def test_설정_경로는_기본_None이고_명령줄은_기본_경로를_넘긴다(tmp_path: Path):
    env = worker_env("http://127.0.0.1:1", tmp_path / "work")
    assert WorkerSettings.from_env(env).music_check_config is None
    assert WorkerSettings.from_env(env, music_check_config="").music_check_config is None
    given = WorkerSettings.from_env(env, music_check_config="a.yaml")
    assert given.music_check_config == Path("a.yaml")
    args = build_parser().parse_args(["run"])
    assert args.music_check_config == str(DEFAULT_MUSIC_CHECK_CONFIG)


# ---- 모델 올리기 ----


@pytest.fixture()
def server():
    backend = FakeBackend(out_dir=None)
    with FakeBackendServer(backend) as srv:
        yield backend, srv


def _loop(tmp_path: Path, base_url: str, music_check_yaml: str | None) -> WorkerLoop:
    sep_cfg, tr_cfg = write_mock_configs(tmp_path)
    mc_cfg = None
    if music_check_yaml is not None:
        mc_cfg = tmp_path / "music_check.yaml"
        mc_cfg.write_text(music_check_yaml, encoding="utf-8")
    settings = WorkerSettings.from_env(
        worker_env(base_url, tmp_path / "work"),
        separation_config=sep_cfg,
        transcription_config=tr_cfg,
        music_check_config=mc_cfg,
    )
    loop = WorkerLoop(settings, sleep=lambda s: time.sleep(min(s, 0.05)))
    loop.api = WorkerApi(settings, session=loop.session, sleep=lambda s: None)
    return loop


ENABLED_YAML = "min_music_prob: 0.28\nmax_speech_prob: 0.44\n"


def test_설정_경로가_없으면_검사_없이_올린다(tmp_path: Path, server):
    _, srv = server
    loop = _loop(tmp_path, srv.base_url, None)
    loop.load_models()
    assert loop.music_check is None and loop.runner.music_check is None
    loop.close()


def test_기준값이_비어_있으면_분류_모델을_만들지_않는다(
    tmp_path: Path, server, monkeypatch: pytest.MonkeyPatch
):
    def must_not_create(config):
        raise AssertionError("기준값이 비어 있는데 분류 모델을 만듦")

    monkeypatch.setattr(music_check, "create_tagger", must_not_create)
    _, srv = server
    loop = _loop(tmp_path, srv.base_url, "device: cpu\n")
    loop.load_models()
    assert loop.music_check is None
    loop.close()


def test_기준값이_있으면_검사_모델을_올려_runner에_넘긴다(
    tmp_path: Path, server, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(music_check, "create_tagger", lambda config: FakeTagger(0.8, 0.02))
    _, srv = server
    loop = _loop(tmp_path, srv.base_url, ENABLED_YAML)
    loop.load_models()
    assert loop.music_check is not None and loop.music_check.loaded
    assert loop.runner.music_check is loop.music_check
    loop.close()
    assert not loop.music_check.loaded


def test_검사_모델을_못_올려도_워커는_검사_없이_계속_돈다(
    tmp_path: Path, server, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    monkeypatch.setattr(
        music_check,
        "create_tagger",
        lambda config: FakeTagger(0, 0, load_error=ImportError("No module named 'transformers'")),
    )
    backend, srv = server
    loop = _loop(tmp_path, srv.base_url, ENABLED_YAML)
    with caplog.at_level(logging.ERROR, logger="ssaplash_ai.worker.loop"):
        loop.load_models()
    assert loop.music_check is None and loop.runner is not None
    assert "transformers" in loop.music_check_error
    errors = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert len(errors) == 1 and "검사 없이 계속함" in errors[0].getMessage()
    assert "uv sync --extra music-check" in errors[0].getMessage()
    caplog.clear()
    backend.enqueue(_song(tmp_path))
    with caplog.at_level(logging.WARNING, logger="ssaplash_ai.worker.job"):
        assert loop.run(once=True) == 0
    assert loop.outcomes[0].status == STATUS_DONE
    # 작업마다 검사 없이 넘어갔다는 경고가 남음
    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert any("음악 여부 검사 없이 분리로 넘어감" in m and "transformers" in m for m in warnings)
    loop.close()


def test_일부러_끈_검사는_작업마다_경고를_남기지_않는다(
    tmp_path: Path, server, caplog: pytest.LogCaptureFixture
):
    backend, srv = server
    loop = _loop(tmp_path, srv.base_url, None)
    loop.load_models()
    assert loop.music_check_error is None
    backend.enqueue(_song(tmp_path))
    with caplog.at_level(logging.WARNING, logger="ssaplash_ai.worker.job"):
        assert loop.run(once=True) == 0
    assert "음악 여부 검사" not in caplog.text
    loop.close()


def _check_output(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    music_check_yaml: str | None,
) -> str:
    """`ssaplash-worker check`를 돌려 표준 출력을 돌려줌. music_check_yaml이 None이면 검사를 끔."""
    sep_cfg, tr_cfg = write_mock_configs(tmp_path)
    mc_arg = ""
    if music_check_yaml is not None:
        mc_cfg = tmp_path / "music_check.yaml"
        mc_cfg.write_text(music_check_yaml, encoding="utf-8")
        mc_arg = str(mc_cfg)
    for key, value in worker_env("http://127.0.0.1:9", tmp_path / "work").items():
        monkeypatch.setenv(key, value)
    args = ["check", "--separation-config", str(sep_cfg), "--transcription-config", str(tr_cfg)]
    assert worker_main([*args, "--music-check-config", mc_arg]) == 0
    return capsys.readouterr().out


def test_check는_검사가_켜져_있으면_모델과_기준값을_보여_준다(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
):
    monkeypatch.setattr(music_check, "create_tagger", lambda config: FakeTagger(0.8, 0.02))
    out = _check_output(tmp_path, monkeypatch, capsys, ENABLED_YAML)
    assert "음악 여부 검사: 켜짐" in out
    assert "음악 확률 기준 0.28" in out and "말소리 확률 기준 0.44" in out


def test_check는_검사_모델을_못_올리면_주의를_보여_주고_0(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
):
    monkeypatch.setattr(
        music_check,
        "create_tagger",
        lambda config: FakeTagger(0, 0, load_error=ImportError("No module named 'transformers'")),
    )
    out = _check_output(tmp_path, monkeypatch, capsys, ENABLED_YAML)
    assert "음악 여부 검사: [주의] 모델을 올리지 못해 검사 없이 돎" in out
    assert "transformers" in out and "uv sync --extra music-check" in out


def test_check는_검사가_꺼져_있으면_꺼짐을_보여_준다(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
):
    assert "음악 여부 검사: 꺼짐" in _check_output(tmp_path, monkeypatch, capsys, None)


def test_검사_설정_파일이_잘못되면_ValueError(tmp_path: Path, server):
    _, srv = server
    loop = _loop(tmp_path, srv.base_url, "min_music_prob: 2\n")
    with pytest.raises(ValueError, match="min_music_prob"):
        loop.load_models()
