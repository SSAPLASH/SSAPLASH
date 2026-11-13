"""워커 설정. 환경 변수 → WorkerSettings.

비밀 값(BE 주소·workerId·토큰)은 환경 변수로만 받음. 토큰은 repr·오류 메시지에 넣지 않음.
music_check_config가 None이면 분리 전 검사를 하지 않음.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

from ssaplash_ai.chart.config import (
    DEFAULT_SEPARATION_CONFIG,
    DEFAULT_TRANSCRIPTION_CONFIG,
    ENV_WORK_DIR,
)

ENV_BASE_URL = "SSAPLASH_WORKER_BASE_URL"
ENV_WORKER_ID = "SSAPLASH_WORKER_ID"
ENV_TOKEN = "SSAPLASH_WORKER_TOKEN"
ENV_POLL_SEC = "SSAPLASH_WORKER_POLL_SEC"
ENV_HEARTBEAT_SEC = "SSAPLASH_WORKER_HEARTBEAT_SEC"
ENV_KEEP_FILES = "SSAPLASH_WORKER_KEEP_FILES"
# 실패 보고 본문에 reason을 넣을지. BE 저장·노출 연동을 확인하기 전까지 기본 꺼짐
ENV_SEND_REASON = "SSAPLASH_WORKER_SEND_REASON"

REQUIRED_ENV = (ENV_BASE_URL, ENV_WORKER_ID, ENV_TOKEN, ENV_WORK_DIR)
# BE README: 토큰은 UTF-8 32바이트 이상
TOKEN_MIN_BYTES = 32
# BE WorkerController의 공통 경로. BASE_URL 뒤에 붙임
API_PATH = "/internal/v1/chart-jobs"
# LLM 총평 작업 경로 (docs/coach-narrative.md). BASE_URL 뒤에 붙임
NARRATIVE_API_PATH = "/internal/v1/coach-narratives"
ENV_NARRATIVE_ENABLED = "SSAPLASH_NARRATIVE_ENABLED"
ENV_NARRATIVE_LLM_URL = "SSAPLASH_NARRATIVE_LLM_URL"
ENV_NARRATIVE_LLM_API = "SSAPLASH_NARRATIVE_LLM_API"
ENV_NARRATIVE_MODEL = "SSAPLASH_NARRATIVE_MODEL"
DEFAULT_NARRATIVE_LLM_URL = "http://127.0.0.1:11434"
# 연주 중 LLM 구간 코칭 워커(docs/live-coach-llm.md). 모델은 총평과 같은 설정(SSAPLASH_NARRATIVE_LLM_*·MODEL)을 쓴다
ENV_LIVE_POLL_SEC = "SSAPLASH_LIVE_POLL_SEC"
ENV_LIVE_LLM_TIMEOUT_SEC = "SSAPLASH_LIVE_LLM_TIMEOUT_SEC"
TRUE_WORDS = ("1", "true", "yes", "on")


@dataclass
class WorkerSettings:
    """워커 하나의 설정. 비밀 값 token은 repr에서 뺌."""

    base_url: str
    worker_id: str
    token: str = field(repr=False)
    work_dir: Path
    poll_sec: float = 5.0
    heartbeat_sec: float = 10.0
    keep_files: bool = False
    send_reason: bool = False
    separation_config: Path = DEFAULT_SEPARATION_CONFIG
    transcription_config: Path = DEFAULT_TRANSCRIPTION_CONFIG
    # 분리 전 음악 여부 검사 설정 yaml. None이면 검사 안 함
    music_check_config: Path | None = None
    # HTTP 시간 제한(초). JSON API는 연결·읽기, 파일 전송은 읽기·쓰기
    connect_timeout_sec: float = 5.0
    read_timeout_sec: float = 30.0
    download_timeout_sec: float = 120.0
    upload_timeout_sec: float = 300.0
    # LLM 총평 작업(기본 꺼짐). 로컬 모델 서버(Ollama·vLLM 등)는 같은 GPU 서버에서 따로 띄운다
    narrative_enabled: bool = False
    narrative_llm_url: str = DEFAULT_NARRATIVE_LLM_URL
    narrative_llm_api: str = "ollama"  # "ollama" 또는 "openai"(OpenAI 호환, vLLM·llama.cpp 서버)
    narrative_model: str = ""
    # 연주 중 구간 코칭: 큐를 보는 주기와 모델 한 번 호출의 시간 제한(늦은 답은 버려지므로 짧게)
    live_poll_sec: float = 1.0
    live_llm_timeout_sec: float = 8.0

    @property
    def narrative_api_url(self) -> str:
        """`<BASE_URL>/internal/v1/coach-narratives`."""
        return self.base_url.rstrip("/") + NARRATIVE_API_PATH

    @property
    def api_url(self) -> str:
        """`<BASE_URL>/internal/v1/chart-jobs`."""
        return self.base_url.rstrip("/") + API_PATH

    @property
    def jobs_dir(self) -> Path:
        """작업 폴더의 부모 `<WORK_DIR>/worker/`."""
        return self.work_dir / "worker"

    @classmethod
    def from_env(
        cls,
        env: Mapping[str, str] | None = None,
        *,
        separation_config: str | Path | None = None,
        transcription_config: str | Path | None = None,
        music_check_config: str | Path | None = None,
    ) -> WorkerSettings:
        """환경 변수에서 설정 읽기. 빠진 값·잘못된 값은 ValueError (토큰 값은 메시지에 안 넣음)."""
        source: Mapping[str, str] = os.environ if env is None else env
        missing = [name for name in REQUIRED_ENV if not source.get(name, "").strip()]
        if missing:
            raise ValueError(f"환경 변수가 없음: {', '.join(missing)}")

        base_url = source[ENV_BASE_URL].strip()
        if not base_url.startswith(("http://", "https://")):
            raise ValueError(f"{ENV_BASE_URL}은 http:// 또는 https://로 시작해야 함")
        token = source[ENV_TOKEN].strip()
        if len(token.encode("utf-8")) < TOKEN_MIN_BYTES:
            raise ValueError(f"{ENV_TOKEN}이 너무 짧음 (UTF-8 {TOKEN_MIN_BYTES}바이트 이상)")

        return cls(
            base_url=base_url,
            worker_id=source[ENV_WORKER_ID].strip(),
            token=token,
            work_dir=Path(source[ENV_WORK_DIR].strip()),
            poll_sec=_positive_float(source, ENV_POLL_SEC, cls.poll_sec),
            heartbeat_sec=_positive_float(source, ENV_HEARTBEAT_SEC, cls.heartbeat_sec),
            keep_files=source.get(ENV_KEEP_FILES, "").strip().lower() in TRUE_WORDS,
            send_reason=source.get(ENV_SEND_REASON, "").strip().lower() in TRUE_WORDS,
            narrative_enabled=source.get(ENV_NARRATIVE_ENABLED, "").strip().lower() in TRUE_WORDS,
            narrative_llm_url=source.get(ENV_NARRATIVE_LLM_URL, "").strip()
            or DEFAULT_NARRATIVE_LLM_URL,
            narrative_llm_api=source.get(ENV_NARRATIVE_LLM_API, "").strip().lower() or "ollama",
            narrative_model=source.get(ENV_NARRATIVE_MODEL, "").strip(),
            live_poll_sec=_positive_float(source, ENV_LIVE_POLL_SEC, cls.live_poll_sec),
            live_llm_timeout_sec=_positive_float(
                source, ENV_LIVE_LLM_TIMEOUT_SEC, cls.live_llm_timeout_sec
            ),
            separation_config=Path(separation_config or DEFAULT_SEPARATION_CONFIG),
            transcription_config=Path(transcription_config or DEFAULT_TRANSCRIPTION_CONFIG),
            music_check_config=Path(music_check_config) if music_check_config else None,
        )


def _positive_float(source: Mapping[str, str], name: str, default: float) -> float:
    raw = source.get(name, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError as e:
        raise ValueError(f"{name}은 숫자여야 함: {raw!r}") from e
    if value <= 0:
        raise ValueError(f"{name}은 양수여야 함: {raw!r}")
    return value
