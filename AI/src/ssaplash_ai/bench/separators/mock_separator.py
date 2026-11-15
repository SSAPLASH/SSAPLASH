"""테스트용 mock 어댑터. 모델 없이 러너·CSV·보고서 파이프라인을 돌림.

mock_mode
- mixture: 원곡을 그대로 드럼으로 (SDR 낮음, 온셋은 반주 때문에 지저분)
- silence: 무음 (SDR -inf, 온셋 F1 0)
- half: 원곡 × 0.5
- drums_from_other: other_stems에 "accomp" = 원곡 − 드럼도 같이 돌려줌 (4스템 모델 흉내)
fail_on_call: n번째 separate 호출에서 RuntimeError (예외 격리 테스트용)
"""

from __future__ import annotations

import numpy as np

from ssaplash_ai.bench.separators.separator_base import BaseSeparator

MODES = ("mixture", "silence", "half", "drums_from_other")


class MockSeparator(BaseSeparator):
    adapter = "mock"

    def __init__(self, config, device: str = "cpu") -> None:
        super().__init__(config, device)
        if config.mock_mode not in MODES:
            raise ValueError(f"mock_mode는 {MODES} 중 하나: {config.mock_mode}")
        self.calls = 0

    def _load(self) -> None:
        pass

    def _separate(self, mixture: np.ndarray, sample_rate: int) -> dict[str, np.ndarray]:
        self.calls += 1
        if self.config.fail_on_call is not None and self.calls == self.config.fail_on_call:
            raise RuntimeError(f"모의 실패 (호출 {self.calls})")
        mode = self.config.mock_mode
        if mode == "silence":
            return {"drums": np.zeros_like(mixture)}
        if mode == "half":
            return {"drums": 0.5 * mixture}
        if mode == "drums_from_other":
            drums = 0.5 * mixture
            return {"drums": drums, "accomp": mixture - drums}
        return {"drums": mixture.copy()}

    def _checkpoint_id(self) -> str:
        return f"mock:{self.config.mock_mode}"

    def _n_params(self) -> int | None:
        return 0
