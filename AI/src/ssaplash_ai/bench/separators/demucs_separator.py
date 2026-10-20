"""공식 demucs 패키지 어댑터 (htdemucs, htdemucs_ft).

yaml 필드: demucs_name. 가중치는 demucs가 torch hub 캐시에 내려받음 (data/models 아님).
prepare()에서 한 번 불러 캐시를 채우고 버리므로 loadSec에는 다운로드 시간이 안 들어감.
htdemucs_ft는 모델 4개 묶음(BagOfModels)이라 기본 htdemucs의 약 4배 시간.
segment_sec·overlap은 apply_model 인자로 전달. shifts=0(시간 이동 앙상블 없음)으로 고정해
RTF를 공정하게 잼.
"""

from __future__ import annotations

import numpy as np

from ssaplash_ai.bench.separators.separator_base import (
    BaseSeparator,
    SeparatorConfig,
    count_torch_params,
    release_cuda,
)


class DemucsSeparator(BaseSeparator):
    adapter = "demucs"

    def __init__(self, config: SeparatorConfig, device: str = "cuda") -> None:
        super().__init__(config, device)
        if not config.demucs_name:
            raise ValueError(f"demucs 어댑터에는 demucs_name이 필요: {config.name}")
        self._model = None

    def prepare(self) -> None:
        from demucs.pretrained import get_model

        get_model(self.config.demucs_name)

    def _load(self) -> None:
        import torch
        from demucs.pretrained import get_model

        device = self.device if torch.cuda.is_available() else "cpu"
        self.device = device
        self._model = get_model(self.config.demucs_name)
        self._model.to(device)
        self._model.eval()

    def _separate(self, mixture: np.ndarray, sample_rate: int) -> dict[str, np.ndarray]:
        import torch
        from demucs.apply import apply_model

        if sample_rate != self._model.samplerate:
            raise ValueError(f"demucs는 {self._model.samplerate}Hz 입력만 받음: {sample_rate}")
        mix = torch.from_numpy(mixture)[None].to(self.device)
        with torch.no_grad():
            out = apply_model(
                self._model,
                mix,
                shifts=0,
                split=True,
                overlap=self.config.overlap if self.config.overlap is not None else 0.25,
                segment=self.config.segment_sec,
                progress=False,
                device=self.device,
            )[0]
        return {
            name: out[i].cpu().numpy().astype(np.float32)
            for i, name in enumerate(self._model.sources)
        }

    def _checkpoint_id(self) -> str:
        return f"demucs:{self.config.demucs_name}"

    def _n_params(self) -> int | None:
        models = getattr(self._model, "models", None)
        return count_torch_params(list(models) if models is not None else self._model)

    def _close(self) -> None:
        self._model = None
        release_cuda()
