"""STRUM 8종 온셋 CRNN 어댑터. 드럼 트랙 하나로 8패드를 바로 냄.

STRUM(opria123/strum, MIT)의 모델 클래스 `TwoStageDrumsCRNN`만 씀. 모델 정의는 `strum/drums_v13.py`에 원본 그대로.
흐름: 드럼 트랙 → 모노 44.1kHz → 로그 멜 → 10초 구간을 절반씩 겹쳐 모델에 넣고 겹친 곳은 평균
→ 프레임별 8종 온셋 점수 → strum_rules(피크 찾기, 킥 규칙, 패드별 문턱값).

모델 yaml: checkpoint_path(학습 가중치), options.sha256(가중치 파일과 대조), options.model(모델 구조 값),
options.mel·segment_sec·batch, rules(strum_rules.rules_with_defaults 참고).
"""

from __future__ import annotations

import contextlib
import hashlib
import io
from collections.abc import Sequence
from pathlib import Path

import numpy as np

from ssaplash_ai.bench.transcribers.adtof_transcriber import resolve_checkpoint
from ssaplash_ai.bench.transcribers.strum_rules import (
    KickGainResult,
    acts_to_hits,
    rules_with_defaults,
)
from ssaplash_ai.bench.transcribers.transcriber_base import (
    BaseTranscriber,
    RawHit,
    resample,
    to_mono,
)

STRUM_SAMPLE_RATE = 44100
# 모델 출력 열 순서(Kick, Snare, HiHat, HighTom, Ride, LowTom, Crash, FloorTom)의 패드 이름
STRUM_CLASS_PADS: tuple[str, ...] = (
    "KICK",
    "SNARE",
    "HIHAT",
    "SMALL_TOM",
    "RIDE",
    "MID_TOM",
    "CRASH",
    "FLOOR_TOM",
)
# STRUM drums_phase3 공개 가중치 config.model의 구조 값
DEFAULT_MODEL: dict = {
    "n_mels": 128,
    "conv_channels": [64, 128, 256, 512],
    "freq_subbands": [32, 64, 96, 128],
    "subband_proj_dim": 256,
    "lstm_hidden": 640,
    "lstm_layers": 3,
    "attention_heads": 10,
    "attention_type": "flash",
    "attention_window": 512,
    "onset_detector_hidden": 320,
    "classifier_hidden": 640,
    "num_classes": 8,
    "predict_velocity": False,
}
DEFAULT_MEL: dict = {"n_fft": 2048, "hop_length": 512}
DEFAULT_SEGMENT_SEC = 10.0
DEFAULT_BATCH = 8
OPTION_KEYS = ("sha256", "model", "mel", "segment_sec", "batch")


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def segment_starts(total: int, seg: int) -> list[int]:
    """프레임 total개를 seg 길이 구간으로 절반씩 겹쳐 덮는 시작 프레임 목록."""
    hop = max(seg // 2, 1)
    starts = list(range(0, max(total - seg, 0) + 1, hop)) or [0]
    if starts[-1] + seg < total:
        starts.append(starts[-1] + hop)
    return starts


class StrumCrnnTranscriber(BaseTranscriber):
    adapter = "strum_crnn"

    def __init__(self, config, device: str = "cuda") -> None:
        super().__init__(config, device)
        options = dict(config.options or {})
        unknown = sorted(set(options) - set(OPTION_KEYS))
        if unknown:
            raise ValueError(f"{config.name}: 모르는 options 필드 {unknown}")
        if not config.checkpoint_path:
            raise ValueError(f"{config.name}: checkpoint_path(학습 가중치 경로)가 필요")
        unknown = sorted(set(options.get("model") or {}) - set(DEFAULT_MODEL))
        if unknown:
            raise ValueError(f"{config.name}: 모르는 options.model 필드 {unknown}")
        self._model_options = {**DEFAULT_MODEL, **(options.get("model") or {})}
        self._mel_options = {**DEFAULT_MEL, **(options.get("mel") or {})}
        self._segment_sec = float(options.get("segment_sec", DEFAULT_SEGMENT_SEC))
        self._batch = int(options.get("batch", DEFAULT_BATCH))
        self._sha256 = str(options["sha256"]).lower() if options.get("sha256") else None
        self._rules = rules_with_defaults(config.rules)
        self._weights = resolve_checkpoint(config.checkpoint_path)
        self._model = None
        self._mel = None
        self._run_device = "cpu"
        # 마지막 곡의 킥 규칙 적용 결과(확인 스크립트·로그용)
        self.last_kick_gain: KickGainResult | None = None

    @property
    def fps(self) -> float:
        return STRUM_SAMPLE_RATE / int(self._mel_options["hop_length"])

    def prepare(self) -> None:
        if not self._weights.is_file():
            raise FileNotFoundError(f"STRUM 학습 가중치 파일이 없음: {self._weights}")

    def _load(self) -> None:
        import torch
        import torchaudio

        from ssaplash_ai.bench.transcribers.strum import drums_v13

        if self._sha256:
            actual = file_sha256(self._weights)
            if actual != self._sha256:
                raise ValueError(
                    f"STRUM 가중치 sha256이 yaml과 다름: {self._weights} ({actual[:12]}…)"
                )
        # 모델 클래스가 생성 때 파라미터 수를 표준 출력에 찍으므로 막음
        with contextlib.redirect_stdout(io.StringIO()):
            model = drums_v13.TwoStageDrumsCRNN(dropout=0.0, **self._model_options)
            model.add_multiclass_onset_head()
        state = torch.load(str(self._weights), map_location="cpu", weights_only=True)
        if not isinstance(state, dict) or "model_state_dict" not in state:
            raise ValueError(f"STRUM 가중치 파일에 model_state_dict가 없음: {self._weights}")
        model.load_state_dict(state["model_state_dict"], strict=True)
        model.eval()
        device = self.device if torch.cuda.is_available() else "cpu"
        self._run_device = device
        self._model = model.to(device)
        self._mel = torchaudio.transforms.MelSpectrogram(
            sample_rate=STRUM_SAMPLE_RATE,
            n_fft=int(self._mel_options["n_fft"]),
            hop_length=int(self._mel_options["hop_length"]),
            n_mels=int(self._model_options["n_mels"]),
        ).to(device)

    def activations(self, audio: np.ndarray, sample_rate: int) -> np.ndarray:
        """(채널, 샘플) → 프레임별 8종 온셋 점수 (프레임, 8). 열 순서는 STRUM_CLASS_PADS."""
        import torch

        mono = to_mono(resample(audio, sample_rate, STRUM_SAMPLE_RATE))
        n_classes = len(STRUM_CLASS_PADS)
        if mono.size == 0:
            return np.zeros((0, n_classes), dtype=np.float32)
        device = self._run_device
        cudnn = torch.backends.cudnn
        # 같은 프로세스의 분리 모델 패키지(msst)가 cudnn.benchmark를 켜 두면 구간 수가 곡마다 달라 입력 모양이
        # 바뀔 때마다 커널 탐색을 다시 해서 곡당 2초가 8 ~ 15초가 됨. 계산하는 동안만 끔
        flags = cudnn.flags(
            enabled=cudnn.enabled,
            benchmark=False,
            benchmark_limit=cudnn.benchmark_limit,
            deterministic=cudnn.deterministic,
            allow_tf32=cudnn.allow_tf32,
        )
        with flags, torch.no_grad():
            wave = torch.from_numpy(np.ascontiguousarray(mono)).to(device)[None]
            spec = torch.log(self._mel(wave) + 1e-8)  # (1, 멜, 프레임)
            total = spec.shape[-1]
            seg = max(int(self._segment_sec * self.fps), 1)
            starts = segment_starts(total, seg)
            acc = torch.zeros(total, n_classes, device=device)
            count = torch.zeros(total, 1, device=device)
            for i in range(0, len(starts), self._batch):
                chunk = starts[i : i + self._batch]
                parts = [spec[:, :, s : s + seg] for s in chunk]
                x = torch.stack([torch.nn.functional.pad(p, (0, seg - p.shape[-1])) for p in parts])
                probs = self._model(x)["mc_onset_probs"]
                for k, s in enumerate(chunk):
                    n = min(seg, total - s)
                    acc[s : s + n] += probs[k, :n]
                    count[s : s + n] += 1
            return (acc / count.clamp(min=1)).cpu().numpy()

    def _transcribe(
        self, audio: np.ndarray, sample_rate: int, song_id: str | None
    ) -> Sequence[RawHit]:
        acts = self.activations(audio, sample_rate)
        hits, self.last_kick_gain = acts_to_hits(acts, STRUM_CLASS_PADS, self.fps, self._rules)
        return hits

    def _checkpoint_id(self) -> str:
        return f"{self._weights.parent.name}/{self._weights.name}"

    def _n_params(self) -> int | None:
        from ssaplash_ai.bench.separators.separator_base import count_torch_params

        return count_torch_params(self._model) if self._model is not None else None

    def _close(self) -> None:
        self._model = None
        self._mel = None
        from ssaplash_ai.bench.separators.separator_base import release_cuda

        release_cuda()
