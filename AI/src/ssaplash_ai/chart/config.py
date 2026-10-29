"""서비스 설정 읽기 (설계 3장 "서비스 설정").

`configs/chart/separation.yaml` → SeparationConfig. 채보 설정(`transcription.yaml`, S15P31A307-169)은
같은 공통 부분(ChartConfig)을 상속해 추가. yaml의 상대 경로는 벤치마크 yaml과 같이 AI/ 폴더(현재 작업 폴더) 기준.

환경 변수(`SSAPLASH_` 접두사, 인프라 -125 회신과 같은 규칙)가 yaml 값을 덮어씀.
- SSAPLASH_CHART_DEVICE: 장치(cuda / cpu)
- SSAPLASH_MODELS_DIR: 가중치 폴더. 벤치마크 어댑터(`SeparatorConfig.model_dir`)가 읽음. 기본 data/models
- SSAPLASH_WORK_DIR: 중간 파일 폴더. 명령줄 --out이 없을 때 cli가 씀
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml

ENV_DEVICE = "SSAPLASH_CHART_DEVICE"
ENV_MODELS_DIR = "SSAPLASH_MODELS_DIR"
ENV_WORK_DIR = "SSAPLASH_WORK_DIR"

DEFAULT_SEPARATION_CONFIG = Path("configs/chart/separation.yaml")
OUTPUT_FORMATS = ("flac", "wav")


@dataclass
class OutputConfig:
    """드럼 트랙·반주 파일 형식. flac은 16비트 무손실(설계 U2), wav는 PCM_16."""

    sample_rate: int = 44100
    format: str = "flac"

    @classmethod
    def from_dict(cls, raw: dict | None) -> OutputConfig:
        raw = raw or {}
        unknown = sorted(set(raw) - {"sample_rate", "format"})
        if unknown:
            raise ValueError(f"모르는 output 필드: {unknown}")
        fmt = str(raw.get("format", cls.format)).lower()
        if fmt not in OUTPUT_FORMATS:
            raise ValueError(f"output.format은 {OUTPUT_FORMATS} 중 하나: {fmt!r}")
        sample_rate = int(raw.get("sample_rate", cls.sample_rate))
        if sample_rate <= 0:
            raise ValueError(f"output.sample_rate는 양수: {sample_rate}")
        return cls(sample_rate=sample_rate, format=fmt)


@dataclass
class ChartConfig:
    """`configs/chart/*.yaml` 공통 부분. 모델 yaml 경로와 장치."""

    model_config: Path
    device: str = "cuda"
    source_path: Path | None = field(default=None, repr=False)


@dataclass
class SeparationConfig(ChartConfig):
    """`configs/chart/separation.yaml` 한 파일."""

    output: OutputConfig = field(default_factory=OutputConfig)
    max_duration_sec: float = 600.0

    @classmethod
    def from_yaml(cls, path: str | Path = DEFAULT_SEPARATION_CONFIG) -> SeparationConfig:
        path = Path(path)
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"분리 설정이 비어 있음: {path}")
        return cls.from_dict(raw, source_path=path)

    @classmethod
    def from_dict(cls, raw: dict, source_path: Path | None = None) -> SeparationConfig:
        known = {"model_config", "device", "output", "max_duration_sec"}
        unknown = sorted(set(raw) - known)
        if unknown:
            raise ValueError(f"모르는 분리 설정 필드: {unknown}")
        if not raw.get("model_config"):
            raise ValueError("분리 설정에 model_config(모델 yaml 경로)가 필요")
        max_duration = float(raw.get("max_duration_sec", cls.max_duration_sec))
        if max_duration <= 0:
            raise ValueError(f"max_duration_sec는 양수: {max_duration}")
        return cls(
            model_config=Path(str(raw["model_config"])),
            device=resolve_device_setting(str(raw.get("device", cls.device))),
            source_path=source_path,
            output=OutputConfig.from_dict(raw.get("output")),
            max_duration_sec=max_duration,
        )


def resolve_device_setting(device: str) -> str:
    """환경 변수 SSAPLASH_CHART_DEVICE가 있으면 그 값, 없으면 yaml 값."""
    return os.environ.get(ENV_DEVICE) or device


def work_dir_from_env() -> Path | None:
    """SSAPLASH_WORK_DIR이 있으면 그 경로, 없으면 None."""
    value = os.environ.get(ENV_WORK_DIR)
    return Path(value) if value else None
