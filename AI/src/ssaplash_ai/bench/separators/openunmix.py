"""Open-Unmix(openunmix 패키지) 어댑터. umxhq 하한선용.

yaml 필드: umx_name (umxhq / umxl / umx). 가중치는 torch hub 캐시에 내려받음.
prepare()에서 한 번 불러 캐시를 채우고 버리므로 loadSec에는 다운로드 시간이 안 들어감.
openunmix.umxhq()가 돌려주는 Separator 모듈은 (배치, 채널, 샘플) 44.1kHz 입력을 받아
(배치, 타깃, 채널, 샘플)을 돌려주고 to_dict로 이름을 붙임.
"""

from __future__ import annotations

import numpy as np

from ssaplash_ai.bench.separators.base import (
    BaseSeparator,
    SeparatorConfig,
    count_torch_params,
    release_cuda,
)

UMX_SAMPLE_RATE = 44100


class OpenUnmixSeparator(BaseSeparator):
    adapter = "openunmix"

    def __init__(self, config: SeparatorConfig, device: str = "cuda") -> None:
        super().__init__(config, device)
        if not config.umx_name:
            raise ValueError(f"openunmix 어댑터에는 umx_name이 필요: {config.name}")
        self._model = None

    def _factory(self):
        import openunmix

        factory = getattr(openunmix, self.config.umx_name, None)
        if factory is None:
            raise ValueError(f"openunmix에 {self.config.umx_name} 모델 없음")
        return factory

    def prepare(self) -> None:
        self._factory()(device="cpu")

    def _load(self) -> None:
        import torch

        device = self.device if torch.cuda.is_available() else "cpu"
        self.device = device
        self._model = self._factory()(device=device)
        self._model.eval()

    def _separate(self, mixture: np.ndarray, sample_rate: int) -> dict[str, np.ndarray]:
        import torch

        if sample_rate != UMX_SAMPLE_RATE:
            raise ValueError(f"openunmix는 {UMX_SAMPLE_RATE}Hz 입력만 받음: {sample_rate}")
        mix = torch.from_numpy(mixture)[None].to(self.device)
        with torch.no_grad():
            estimates = self._model(mix)
        named = self._model.to_dict(estimates)
        return {k: v[0].cpu().numpy().astype(np.float32) for k, v in named.items()}

    def _checkpoint_id(self) -> str:
        return f"openunmix:{self.config.umx_name}"

    def _n_params(self) -> int | None:
        return count_torch_params(self._model)

    def _close(self) -> None:
        self._model = None
        release_cuda()
