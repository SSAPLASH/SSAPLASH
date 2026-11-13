"""여러 분리 모델의 드럼 트랙 평균.

yaml의 members에 적은 모델 yaml을 각각 불러 같은 원곡을 분리하고, 드럼 트랙을 샘플마다 평균함.
모델마다 잘 빼는 소리가 달라 평균하면 한 모델의 실수가 줄어드는 경우가 많음 (MVSEP 앙상블과 같은 생각).
멤버 경로는 작업 폴더(AI/) 기준. 반주는 상위 설정의 accomp_mode가 정함.
"""

from __future__ import annotations

import numpy as np

from ssaplash_ai.bench.separators.separator_base import BaseSeparator, SeparatorConfig


class EnsembleSeparator(BaseSeparator):
    adapter = "ensemble"

    def __init__(self, config: SeparatorConfig, device: str = "cuda") -> None:
        super().__init__(config, device)
        if not config.members or len(config.members) < 2:
            raise ValueError(f"{config.name}: ensemble은 members에 모델 yaml이 둘 이상 필요")
        from ssaplash_ai.bench.separators import create_separator

        self.members = [create_separator(path, device) for path in config.members]

    def prepare(self) -> None:
        for m in self.members:
            m.prepare()

    def _load(self) -> None:
        for m in self.members:
            m.load()

    def _separate(self, mixture: np.ndarray, sample_rate: int) -> dict[str, np.ndarray]:
        drums = [m.separate(mixture, sample_rate).drums for m in self.members]
        return {"drums": np.mean(drums, axis=0, dtype=np.float32)}

    def _checkpoint_id(self) -> str:
        return "+".join(m._checkpoint_id() for m in self.members)

    def _n_params(self) -> int | None:
        counts = [m._n_params() for m in self.members]
        return None if any(c is None for c in counts) else int(sum(counts))

    def _close(self) -> None:
        for m in self.members:
            m.close()
