"""실행 루프.

WorkerLoop: 설정 yaml 읽기 → 분리·채보 모델 올리기(claim 전에 한 번) → claim 폴링 → JobRunner → 반복.
채보 작업이 없으면 LLM 총평 작업 하나를 처리함(켜져 있을 때).
분리 전 음악 여부 검사 모델도 claim 전에 올림. 못 올리면 오류 로그를 남기고 검사 없이 계속함(채보는 막지 않음).
SIGINT·SIGTERM 첫 번째는 처리 중인 작업을 끝내고 종료, 두 번째는 바로 종료(임대 만료로 BE가 재배정).
종료 코드: 0 정상, 1 설정·모델 오류, 2 인증 실패(401).
"""

from __future__ import annotations

import logging
import signal
import threading
import time
import uuid
from collections.abc import Callable

import requests

from ssaplash_ai.chart.config import MusicCheckConfig, SeparationConfig, TranscriptionConfig
from ssaplash_ai.chart.errors import ChartModelError
from ssaplash_ai.chart.music_check import MusicCheckModule
from ssaplash_ai.chart.separation import SeparationModule
from ssaplash_ai.chart.transcription import TranscriptionModule
from ssaplash_ai.worker.api import ApiError, WorkerApi
from ssaplash_ai.worker.config import WorkerSettings
from ssaplash_ai.worker.job import JobOutcome, JobRunner
from ssaplash_ai.worker.narrative_job import NarrativeJobOutcome, NarrativeRunner

logger = logging.getLogger("ssaplash_ai.worker.loop")

EXIT_OK = 0
EXIT_CONFIG = 1
EXIT_AUTH = 2
# BE 계약: 분리 출력은 flac 16비트 44,100Hz
REQUIRED_OUTPUT_FORMAT = "flac"
REQUIRED_SAMPLE_RATE = 44100


class WorkerLoop:
    """워커 프로세스 하나. load_models() → run()."""

    def __init__(
        self,
        settings: WorkerSettings,
        session: requests.Session | None = None,
        api: WorkerApi | None = None,
        sleep: Callable[[float], None] | None = None,
        narrative: NarrativeRunner | None = None,
    ) -> None:
        self.settings = settings
        # LLM 총평 작업(선택). 채보 작업이 없을 때만 가져간다
        self.narrative = narrative
        self.narrative_outcomes: list[NarrativeJobOutcome] = []
        self.session = session or requests.Session()
        self.api = api or WorkerApi(settings, session=self.session)
        self.separation: SeparationModule | None = None
        self.transcription: TranscriptionModule | None = None
        self.music_check: MusicCheckModule | None = None
        # 음악 여부 검사 모델을 못 올렸을 때의 사유. 검사가 꺼져 있거나 정상으로 올렸으면 None
        self.music_check_error: str | None = None
        self.runner: JobRunner | None = None
        self._stop = threading.Event()
        self._signals = 0
        self._sleep = sleep
        self.outcomes: list[JobOutcome] = []

    # ---- 준비 ----

    def load_models(self) -> tuple[float, float]:
        """설정 yaml 읽기, 분리·채보·음악 여부 검사 모델 올리기. (분리 올린 초, 채보 올린 초)를 돌려줌."""
        sep_config = SeparationConfig.from_yaml(self.settings.separation_config)
        tr_config = TranscriptionConfig.from_yaml(self.settings.transcription_config)
        mc_config = None
        if self.settings.music_check_config is not None:
            mc_config = MusicCheckConfig.from_yaml(self.settings.music_check_config)
        if sep_config.output.format != REQUIRED_OUTPUT_FORMAT:
            raise ValueError(
                f"BE 계약상 분리 출력 형식은 {REQUIRED_OUTPUT_FORMAT}: {sep_config.output.format}"
            )
        if sep_config.output.sample_rate != REQUIRED_SAMPLE_RATE:
            raise ValueError(
                f"BE 계약상 분리 출력 샘플레이트는 {REQUIRED_SAMPLE_RATE}: {sep_config.output.sample_rate}"
            )
        separation = SeparationModule(sep_config)
        transcription = TranscriptionModule(tr_config)
        logger.info("장치: 분리 %s, 채보 %s", separation.device, transcription.device)
        # 서버에서 어느 채보 모델이 도는지 헷갈리지 않게 고른 이름과 yaml 경로를 남김
        logger.info(
            "채보 모델 선택: %s (%s)",
            tr_config.model_name or "이름 없음",
            tr_config.model_config.as_posix(),
        )
        sep_sec = separation.load()
        logger.info(
            "분리 모델 올림 %.1f초 (%s %s)",
            sep_sec,
            separation.model_name,
            separation.model_version,
        )
        try:
            tr_sec = transcription.load()
        except ChartModelError:
            separation.close()
            raise
        logger.info(
            "채보 모델 올림 %.1f초 (%s %s)",
            tr_sec,
            transcription.model_name,
            transcription.model_version,
        )
        self.separation, self.transcription = separation, transcription
        self.music_check = self._load_music_check(mc_config)
        self.runner = JobRunner(
            self.settings,
            self.api,
            separation,
            transcription,
            session=self.session,
            music_check=self.music_check,
            music_check_error=self.music_check_error,
        )
        return sep_sec, tr_sec

    def _load_music_check(self, config: MusicCheckConfig | None) -> MusicCheckModule | None:
        """분리 전 음악 여부 검사 모델 올리기. 설정이 없거나 기준값이 비어 있으면 None.

        모델을 못 올려도(패키지 없음·가중치 내려받기 실패) 워커는 검사 없이 계속 돎. 이때 사유를
        music_check_error에 남겨 작업마다 경고 로그가 나가고 `ssaplash-worker check`에도 보이게 함.
        """
        self.music_check_error = None
        if config is None or not config.enabled:
            logger.info("분리 전 음악 여부 검사: 꺼짐")
            return None
        module = MusicCheckModule(config)
        try:
            sec = module.load()
        except ChartModelError as e:
            self.music_check_error = e.message
            logger.error(
                "분리 전 음악 여부 검사 모델을 올리지 못해 검사 없이 계속함: %s. "
                "음악이 아닌 파일도 분리·채보까지 돎. 패키지(uv sync --extra music-check)와 "
                "가중치 내려받기를 확인한 뒤 워커를 다시 띄울 것",
                e.message,
            )
            return None
        logger.info(
            "분리 전 음악 여부 검사 모델 올림 %.1f초 (%s, 장치 %s, 음악 확률 기준 %s, 말소리 확률 기준 %s)",
            sec,
            config.model,
            config.device,
            config.min_music_prob,
            config.max_speech_prob,
        )
        return module

    def close(self) -> None:
        if self.music_check is not None:
            self.music_check.close()
        if self.separation is not None:
            self.separation.close()
        if self.transcription is not None:
            self.transcription.close()
        self.session.close()

    # ---- 실행 ----

    def request_stop(self) -> None:
        """현재 작업을 끝낸 뒤 루프를 멈춤."""
        self._stop.set()

    def run(self, once: bool = False, max_jobs: int | None = None) -> int:
        """claim 폴링 루프. once면 작업 하나, max_jobs면 그 수만큼 처리하고 종료."""
        if self.runner is None:
            raise RuntimeError("load_models()를 먼저 호출")
        previous_handlers = self._install_signal_handlers()
        processed = 0
        logger.info(
            "워커 시작: %s, BE %s, claim 주기 %.0f초",
            self.settings.worker_id,
            self.settings.api_url,
            self.settings.poll_sec,
        )
        try:
            while not self._stop.is_set():
                claim_request_id = str(uuid.uuid4())
                try:
                    assignment = self.api.claim(claim_request_id)
                except ApiError as e:
                    if e.status == 401:
                        logger.error("인증 실패(401). 토큰·workerId 설정 확인: %s", e)
                        return EXIT_AUTH
                    if e.status == 403:
                        # Nginx가 GPU 서버 공인 IP만 허용. IP가 바뀌면 403
                        logger.error(
                            "Nginx IP 허용에 막힘(403). 토큰 문제가 아님. GPU 서버 공인 IP가 바뀌었는지 "
                            "`curl -s https://api.ipify.org`로 확인하고 인프라에 알림. %.0f초 뒤 다시 시도",
                            self.settings.poll_sec,
                        )
                    else:
                        logger.warning("claim 실패, %.0f초 뒤 다시: %s", self.settings.poll_sec, e)
                    self._wait(self.settings.poll_sec)
                    continue
                if assignment is None:
                    try:
                        worked = self._narrative_once()
                    except ApiError as e:
                        if e.status == 401:
                            logger.error("인증 실패(401). 토큰·workerId 설정 확인: %s", e)
                            return EXIT_AUTH
                        raise
                    if not worked:
                        self._wait(self.settings.poll_sec)
                    continue
                try:
                    outcome = self.runner.run(assignment, claim_request_id)
                except ApiError as e:
                    if e.status == 401:
                        logger.error("인증 실패(401). 토큰·workerId 설정 확인: %s", e)
                        return EXIT_AUTH
                    raise
                self.outcomes.append(outcome)
                processed += 1
                if once or (max_jobs is not None and processed >= max_jobs):
                    break
        finally:
            self._restore_signal_handlers(previous_handlers)
            self.close()
        logger.info("워커 종료: 처리 %d건", processed)
        return EXIT_OK

    def _narrative_once(self) -> bool:
        """총평 작업 하나를 가져와 처리. 일을 했으면 True (바로 다음 claim으로 간다)."""
        if self.narrative is None:
            return False
        outcome = self.narrative.poll()
        if outcome is None:
            return False
        self.narrative_outcomes.append(outcome)
        return True

    def _wait(self, seconds: float) -> None:
        if self._sleep is not None:
            self._sleep(seconds)
        else:
            self._stop.wait(seconds)

    def _install_signal_handlers(self) -> list[tuple[int, object]]:
        """SIGINT·SIGTERM 핸들러 등록. 이전 핸들러를 돌려줘 run이 끝날 때 되돌림."""

        def handler(signum, frame) -> None:
            self._signals += 1
            if self._signals == 1:
                logger.info("종료 신호. 처리 중인 작업을 끝내고 멈춤 (한 번 더 보내면 바로 종료)")
                self.request_stop()
            else:
                logger.warning("두 번째 종료 신호. 바로 종료 (임대 만료 뒤 BE가 재배정)")
                raise KeyboardInterrupt

        previous: list[tuple[int, object]] = []
        for name in ("SIGINT", "SIGTERM"):
            sig = getattr(signal, name, None)
            if sig is None:
                continue
            try:
                previous.append((sig, signal.signal(sig, handler)))
            except ValueError:  # 메인 스레드가 아닐 때(테스트)
                break
        return previous

    @staticmethod
    def _restore_signal_handlers(previous: list[tuple[int, object]]) -> None:
        for sig, old in previous:
            try:
                signal.signal(sig, old)  # type: ignore[arg-type]
            except (ValueError, TypeError):
                pass


def sleep_seconds(seconds: float) -> None:
    time.sleep(seconds)
