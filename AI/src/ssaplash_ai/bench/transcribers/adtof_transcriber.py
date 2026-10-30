"""ADTOF 어댑터 (ADTOF-pytorch 포트, 5가지: 킥·스네어·탐·하이햇·심벌).

패키지 `adtof_pytorch`(extra `transcribers`). 모델은 load()에서 한 번 만들고 가중치는 패키지에 들어 있음.
입력은 파일로만 받으므로 임시 wav(44.1kHz)를 쓰고, 활성값(프레임 100fps × 5) → PeakPicker(저장소 기본
문턱값 [0.22, 0.24, 0.32, 0.22, 0.30]) → MIDI 피치별 시각 목록. 원래 라벨은 MIDI 피치
35 킥, 38 스네어, 47 탐, 42 하이햇, 49 심벌. 세기는 안 냄.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import numpy as np

from ssaplash_ai.bench.transcribers.transcriber_base import (
    BaseTranscriber,
    RawHit,
    write_temp_wav,
)

ADTOF_SAMPLE_RATE = 44100
ADTOF_FPS = 100


class AdtofTranscriber(BaseTranscriber):
    adapter = "adtof"

    def __init__(self, config, device: str = "cuda") -> None:
        super().__init__(config, device)
        self._model = None
        self._picker = None
        self._weights: Path | None = None

    def _load(self) -> None:
        import adtof_pytorch as adtof
        import torch

        weights = self.config.checkpoint_path or adtof.get_default_weights_path()
        if not weights or not Path(weights).is_file():
            raise FileNotFoundError(f"ADTOF 가중치 파일이 없음: {weights}")
        self._weights = Path(weights)
        model = adtof.create_frame_rnn_model(adtof.calculate_n_bins())
        model = adtof.load_pytorch_weights(model, str(weights), strict=False)
        model.eval()
        device = self.device if torch.cuda.is_available() else "cpu"
        self._model = model.to(device)
        self._run_device = device
        thresholds = self.config.thresholds or adtof.FRAME_RNN_THRESHOLDS
        self._picker = adtof.PeakPicker(thresholds=list(thresholds), fps=ADTOF_FPS)

    def activations(self, audio: np.ndarray, sample_rate: int) -> np.ndarray:
        """(채널, 샘플) → 활성값 (프레임, 5). 다른 어댑터(adtof_drumsep)도 씀."""
        import adtof_pytorch as adtof
        import torch

        path = write_temp_wav(audio, sample_rate)
        try:
            x = adtof.load_audio_for_model(str(path)).to(self._run_device)
            with torch.no_grad():
                pred = self._model(x).cpu().numpy()
        finally:
            path.unlink(missing_ok=True)
        return pred[0]

    def peaks(self, activations: np.ndarray) -> dict[int, list[float]]:
        """활성값 → {MIDI 피치: 시각 목록}."""
        import adtof_pytorch as adtof

        picked = self._picker.pick(activations[None, :, :], labels=adtof.LABELS_5, label_offset=0)
        return {int(k): [float(t) for t in v] for k, v in picked[0].items()}

    def _transcribe(
        self, audio: np.ndarray, sample_rate: int, song_id: str | None
    ) -> Sequence[RawHit]:
        peaks = self.peaks(self.activations(audio, sample_rate))
        return [(t, pitch, None) for pitch, times in peaks.items() for t in times]

    def _checkpoint_id(self) -> str:
        return self._weights.name if self._weights else "adtof_frame_rnn_pytorch_weights.pth"

    def _n_params(self) -> int | None:
        from ssaplash_ai.bench.separators.separator_base import count_torch_params

        return count_torch_params(self._model) if self._model is not None else None

    def _close(self) -> None:
        self._model = None
        self._picker = None
        from ssaplash_ai.bench.separators.separator_base import release_cuda

        release_cuda()
