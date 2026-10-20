"""Spleeter(Deezer) 어댑터. 속도·품질 하한선용.

yaml 필드: spleeter_name (spleeter:4stems 등). 가중치는 spleeter가 pretrained_models/ 에 내려받음.
spleeter 2.4는 tensorflow 2.12·numpy<2·pandas<2에 고정돼 이 저장소의 가상환경에는 설치되지
않음 (pyproject 주석). 별도 python 3.11 환경에 `pip install spleeter ssaplash-ai`로 올려 실행.
입력은 (샘플, 채널) 44.1kHz. 장치는 tensorflow가 알아서 고르므로 device 인자는 기록용.
"""

from __future__ import annotations

import numpy as np

from ssaplash_ai.bench.separators.base import BaseSeparator, SeparatorConfig

SPLEETER_SAMPLE_RATE = 44100


class SpleeterSeparator(BaseSeparator):
    adapter = "spleeter"

    def __init__(self, config: SeparatorConfig, device: str = "cuda") -> None:
        super().__init__(config, device)
        if not config.spleeter_name:
            raise ValueError(f"spleeter 어댑터에는 spleeter_name이 필요: {config.name}")
        self._sep = None

    def _load(self) -> None:
        from spleeter.separator import Separator

        self._sep = Separator(self.config.spleeter_name, multiprocess=False)

    def _separate(self, mixture: np.ndarray, sample_rate: int) -> dict[str, np.ndarray]:
        if sample_rate != SPLEETER_SAMPLE_RATE:
            raise ValueError(f"spleeter는 {SPLEETER_SAMPLE_RATE}Hz 입력만 받음: {sample_rate}")
        stems = self._sep.separate(mixture.T)
        return {k: np.asarray(v, dtype=np.float32).T for k, v in stems.items()}

    def _checkpoint_id(self) -> str:
        return self.config.spleeter_name

    def _close(self) -> None:
        self._sep = None
