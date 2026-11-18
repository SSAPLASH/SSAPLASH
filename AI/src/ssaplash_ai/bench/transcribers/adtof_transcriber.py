"""ADTOF 어댑터 (ADTOF-pytorch 포트, 5가지: 킥·스네어·탐·하이햇·심벌). 세기는 안 냄.

입력은 파일로만 받아서 임시 wav(44.1kHz)를 씀. 활성값(100fps) → PeakPicker → MIDI 피치별 시각 목록.
원래 라벨은 MIDI 피치 35 킥, 38 스네어, 47 탐, 42 하이햇, 49 심벌.
checkpoint_path가 있으면 그 파일 model_info의 classes(출력 채널 라벨)와 thresholds를 읽음. yaml의 thresholds가 우선.
`data/models/`로 시작하는 checkpoint_path는 환경 변수 SSAPLASH_MODELS_DIR이 있으면 그 폴더 기준으로 찾음.
"""

from __future__ import annotations

import os
from collections.abc import Sequence
from pathlib import Path, PurePosixPath

import numpy as np

from ssaplash_ai.bench.transcribers.transcriber_base import (
    BaseTranscriber,
    RawHit,
    write_temp_wav,
)

ADTOF_SAMPLE_RATE = 44100
ADTOF_FPS = 100
ADTOF_LABELS_5: tuple[int, ...] = (35, 38, 47, 42, 49)


def resolve_checkpoint(path: str) -> Path:
    """`data/models/…` 상대 경로는 SSAPLASH_MODELS_DIR이 있으면 그 아래로 바꿈. 그 밖은 그대로"""
    root = os.environ.get("SSAPLASH_MODELS_DIR")
    parts = PurePosixPath(Path(path).as_posix()).parts
    if root and not Path(path).is_absolute() and parts[:2] == ("data", "models"):
        return Path(root).joinpath(*parts[2:])
    return Path(path)


def model_input(audio: np.ndarray, sample_rate: int):
    """(채널, 샘플) → ADTOF 모델 입력 특징 텐서 (CPU). 패키지가 파일만 받아 임시 wav를 거침."""
    import adtof_pytorch as adtof

    path = write_temp_wav(audio, sample_rate)
    try:
        return adtof.load_audio_for_model(str(path))
    finally:
        path.unlink(missing_ok=True)


def checkpoint_info(path: Path) -> dict:
    """체크포인트의 model_info. 기본 가중치 파일처럼 class_set이 없으면 5클래스로 봄(빈 dict에 가깝게)."""
    import torch

    ck = torch.load(str(path), map_location="cpu", weights_only=False)
    info = dict(ck.get("model_info") or {}) if isinstance(ck, dict) else {}
    if "class_set" not in info:
        return {}
    return info


class AdtofTranscriber(BaseTranscriber):
    adapter = "adtof"

    def __init__(self, config, device: str = "cuda") -> None:
        super().__init__(config, device)
        self._model = None
        self._picker = None
        self._weights: Path | None = None
        # 출력 채널 순서의 원래 라벨. five 계열은 MIDI 피치, pads(9패드) 체크포인트는 패드 이름
        self._labels: list[object] = list(ADTOF_LABELS_5)
        self._thresholds: list[float] = []

    def _load(self) -> None:
        import adtof_pytorch as adtof
        import torch

        path = self.config.checkpoint_path
        weights = resolve_checkpoint(path) if path else adtof.get_default_weights_path()
        if not weights or not Path(weights).is_file():
            raise FileNotFoundError(f"ADTOF 가중치 파일이 없음: {weights}")
        self._weights = Path(weights)
        info = checkpoint_info(self._weights)
        self._labels = list(info.get("classes") or ADTOF_LABELS_5)
        n_classes = int(info.get("n_classes") or len(self._labels))
        if n_classes != len(self._labels):
            raise ValueError(f"체크포인트의 n_classes {n_classes} ≠ classes {self._labels}")
        model = adtof.create_frame_rnn_model(adtof.calculate_n_bins())
        if n_classes != model.output_layer.out_features:
            model.output_layer = torch.nn.Linear(model.output_layer.in_features, n_classes)
        model = adtof.load_pytorch_weights(model, str(weights), strict=False)
        model.eval()
        device = self.device if torch.cuda.is_available() else "cpu"
        self._model = model.to(device)
        self._run_device = device
        thresholds = self.config.thresholds or info.get("thresholds") or adtof.FRAME_RNN_THRESHOLDS
        if len(thresholds) != n_classes:
            raise ValueError(f"문턱값 {len(thresholds)}개 ≠ 클래스 {n_classes}개")
        self._thresholds = [float(t) for t in thresholds]
        self._picker = adtof.PeakPicker(thresholds=self._thresholds, fps=ADTOF_FPS)

    def activations(self, audio: np.ndarray, sample_rate: int) -> np.ndarray:
        """(채널, 샘플) → 활성값 (프레임, 클래스 수). 다른 어댑터(adtof_drumsep)도 씀."""
        return self.activations_from_input(model_input(audio, sample_rate))

    def activations_from_input(self, x) -> np.ndarray:
        """model_input 결과(모델 입력 특징) → 활성값. 같은 곡에 가중치 여러 개를 돌릴 때 특징을 한 번만 만듦."""
        import torch

        with torch.no_grad():
            pred = self._model(x.to(self._run_device)).cpu().numpy()
        return pred[0]

    def peaks(self, activations: np.ndarray) -> dict[object, list[float]]:
        """활성값 → {원래 라벨: 시각 목록}. five 계열은 {MIDI 피치: …}, pads(9패드)는 {패드 이름: …}."""
        if self._labels == list(ADTOF_LABELS_5):
            picked = self._picker.pick(
                activations[None, :, :], labels=ADTOF_LABELS_5, label_offset=0
            )
            return {int(k): [float(t) for t in v] for k, v in picked[0].items()}
        # PeakPicker는 라벨을 int로 바꾸므로 패드 이름은 같은 계산을 직접 돌림
        from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import pick_peaks

        return {
            label: pick_peaks(activations[:, k], self._thresholds[k], fps=ADTOF_FPS)
            for k, label in enumerate(self._labels)
        }

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
