"""분리 모델 어댑터. yaml의 adapter 값으로 구현체 선택. runner는 create_separator만 호출.

모델 패키지(torch·msst·demucs·openunmix)는 어댑터 안에서 늦게 import하므로
fake 어댑터와 단위 테스트는 `uv sync --extra models` 없이 동작.
"""

from __future__ import annotations

from pathlib import Path

from ssaplash_ai.bench.separators.base import (
    MODELS_DIR,
    BaseSeparator,
    SeparationResult,
    SeparatorConfig,
    SeparatorInfo,
    fit_length,
)
from ssaplash_ai.bench.separators.demucs import DemucsSeparator
from ssaplash_ai.bench.separators.fake import FakeSeparator
from ssaplash_ai.bench.separators.msst import MsstSeparator
from ssaplash_ai.bench.separators.openunmix import OpenUnmixSeparator
from ssaplash_ai.bench.separators.spleeter import SpleeterSeparator

ADAPTERS: dict[str, type[BaseSeparator]] = {
    cls.adapter: cls
    for cls in (
        FakeSeparator,
        MsstSeparator,
        DemucsSeparator,
        OpenUnmixSeparator,
        SpleeterSeparator,
    )
}


def create_separator(config: SeparatorConfig | str | Path, device: str = "cuda") -> BaseSeparator:
    """yaml 경로나 SeparatorConfig를 받아 adapter에 맞는 어댑터 생성. 가중치는 load()에서."""
    if not isinstance(config, SeparatorConfig):
        config = SeparatorConfig.from_yaml(config)
    try:
        cls = ADAPTERS[config.adapter]
    except KeyError as e:
        raise ValueError(f"모르는 어댑터: {config.adapter} (가능: {sorted(ADAPTERS)})") from e
    return cls(config, device)


__all__ = [
    "ADAPTERS",
    "MODELS_DIR",
    "BaseSeparator",
    "DemucsSeparator",
    "FakeSeparator",
    "MsstSeparator",
    "OpenUnmixSeparator",
    "SeparationResult",
    "SeparatorConfig",
    "SeparatorInfo",
    "SpleeterSeparator",
    "create_separator",
    "fit_length",
]
