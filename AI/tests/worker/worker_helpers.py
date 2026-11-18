"""워커 테스트 공용 도구. mock 모델 설정 yaml과 fake BE·워커 묶음(Rig).

tests/worker/conftest.py가 이 폴더를 sys.path에 넣으므로 `from worker_helpers import Rig`로 씀.
"""

from __future__ import annotations

from pathlib import Path

import requests

from ssaplash_ai.chart.config import ENV_WORK_DIR, SeparationConfig, TranscriptionConfig
from ssaplash_ai.chart.music_check import MusicCheckModule
from ssaplash_ai.chart.separation import SeparationModule
from ssaplash_ai.chart.transcription import TranscriptionModule
from ssaplash_ai.worker.api import WorkerApi
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
from ssaplash_ai.worker.fake_be import FAKE_TOKEN, FakeBackend, FakeBackendServer
from ssaplash_ai.worker.job import JobRunner


def write_mock_configs(tmp_path: Path) -> tuple[Path, Path]:
    """분리 mock(half)·채보 mock(clicks, librosa bpm) 설정 yaml 두 개. 모델 다운로드 없음."""
    sep_model = tmp_path / "sep_mock.yaml"
    sep_model.write_text(
        "name: mock_half\nadapter: mock\nmock_mode: half\nlicense_code: x\nlicense_weights: y\n",
        encoding="utf-8",
    )
    sep_cfg = tmp_path / "separation.yaml"
    sep_cfg.write_text(
        f"model_config: {sep_model.as_posix()}\ndevice: cpu\noutput:\n  format: flac\n"
        "max_duration_sec: 10\n",
        encoding="utf-8",
    )
    tr_model = tmp_path / "tr_mock.yaml"
    tr_model.write_text(
        "name: mock_clicks\nadapter: mock\nmock_mode: clicks\nlicense_code: x\nlicense_weights: y\n"
        "labels:\n  kick: KICK\n",
        encoding="utf-8",
    )
    tr_cfg = tmp_path / "transcription.yaml"
    tr_cfg.write_text(
        f"model_config: {tr_model.as_posix()}\ndevice: cpu\nmax_duration_sec: 10\n"
        "tempo:\n  method: librosa\n",
        encoding="utf-8",
    )
    return sep_cfg, tr_cfg


def worker_env(
    base_url: str, work_dir: Path, heartbeat_sec: str = "0.2", token: str = FAKE_TOKEN
) -> dict[str, str]:
    """fake BE에 맞는 워커 환경 변수. heartbeat·claim 주기는 테스트용으로 짧게."""
    return {
        ENV_BASE_URL: base_url,
        ENV_WORKER_ID: "worker1",
        ENV_TOKEN: token,
        ENV_WORK_DIR: str(work_dir),
        ENV_HEARTBEAT_SEC: heartbeat_sec,
        ENV_POLL_SEC: "0.05",
    }


class Rig:
    """fake BE 서버 + 설정 + 모델 두 개 + JobRunner. with 문으로 씀."""

    def __init__(
        self,
        tmp_path: Path,
        backend: FakeBackend | None = None,
        keep_files: bool = False,
        send_reason: bool = False,
        music_check: MusicCheckModule | None = None,
    ) -> None:
        self.tmp_path = tmp_path
        # 분리 전 음악 여부 검사 모듈(이미 올린 것). 없으면 검사 없이 돎
        self.music_check = music_check
        self.backend = backend if backend is not None else FakeBackend(out_dir=tmp_path / "be_out")
        self.server = FakeBackendServer(self.backend)
        self.sep_cfg, self.tr_cfg = write_mock_configs(tmp_path)
        self.env = worker_env(self.server.base_url, tmp_path / "work")
        if keep_files:
            self.env[ENV_KEEP_FILES] = "1"
        if send_reason:
            self.env[ENV_SEND_REASON] = "1"
        self.settings = WorkerSettings.from_env(
            self.env, separation_config=self.sep_cfg, transcription_config=self.tr_cfg
        )
        self.session = requests.Session()
        # 503 재시도 대기(2·5·15초)는 테스트에서 건너뜀
        self.api = WorkerApi(self.settings, session=self.session, sleep=lambda s: None)
        self.separation: SeparationModule | None = None
        self.transcription: TranscriptionModule | None = None
        self.runner: JobRunner | None = None

    def __enter__(self) -> Rig:
        self.server.start()
        self.separation = SeparationModule(SeparationConfig.from_yaml(self.sep_cfg))
        self.transcription = TranscriptionModule(TranscriptionConfig.from_yaml(self.tr_cfg))
        self.separation.load()
        self.transcription.load()
        self.runner = JobRunner(
            self.settings,
            self.api,
            self.separation,
            self.transcription,
            session=self.session,
            music_check=self.music_check,
        )
        return self

    def __exit__(self, *exc) -> None:
        if self.separation is not None:
            self.separation.close()
        if self.transcription is not None:
            self.transcription.close()
        self.session.close()
        self.server.stop()

    def run_one(self, claim_request_id: str = "c-1"):
        """claim 한 번 → 배정을 JobRunner로 끝까지."""
        assert self.runner is not None
        assignment = self.api.claim(claim_request_id)
        assert assignment is not None, "대기 작업이 없음"
        return self.runner.run(assignment, claim_request_id)
