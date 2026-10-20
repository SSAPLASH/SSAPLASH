"""온셋 검출과 온셋 보존율 (설계 3-5절).

검출기는 librosa 스펙트럼 플럭스(onset_strength → onset_detect, hop 512 샘플 = 11.6ms)이며
정답 드럼 스템과 예측 드럼 스템에 같은 설정을 적용. 매칭은 mir_eval.onset.f_measure.
허용 오차는 50ms(기본)와 25ms(엄격) 두 가지.

정답 온셋은 합성곡이면 MIDI에서 온 값, MUSDB면 정답 스템에 검출기를 돌린 값.
같은 검출기를 같은 신호에 두 번 돌리면 결과가 같으므로 정답 스템을 예측으로 넣으면 F1이 1.0.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass

import numpy as np

HOP_LENGTH = 512
WINDOW_SEC = 0.05
WINDOW_TIGHT_SEC = 0.025


@dataclass
class OnsetResult:
    """온셋 보존율. 3-3절 CSV 열과 1:1. 온셋 개수는 보조값."""

    f1: float
    precision: float
    recall: float
    f1_tight: float
    n_true: int
    n_pred: int


def to_mono(audio: np.ndarray) -> np.ndarray:
    """(채널, 샘플) → (샘플,) float32 평균."""
    if audio.ndim == 1:
        return audio.astype(np.float32)
    return np.mean(audio, axis=0, dtype=np.float32)


def detect_onsets(audio: np.ndarray, sample_rate: int, hop_length: int = HOP_LENGTH) -> np.ndarray:
    """드럼 스템에서 온셋 시각(초)을 검출. 무음이면 빈 배열."""
    import librosa

    mono = to_mono(audio)
    if mono.size == 0 or not np.any(mono):
        return np.zeros(0, dtype=np.float64)
    strength = librosa.onset.onset_strength(y=mono, sr=sample_rate, hop_length=hop_length)
    frames = librosa.onset.onset_detect(
        onset_envelope=strength, sr=sample_rate, hop_length=hop_length, units="frames"
    )
    return librosa.frames_to_time(frames, sr=sample_rate, hop_length=hop_length).astype(np.float64)


def onset_scores(
    onsets_true: np.ndarray, onsets_pred: np.ndarray, window_sec: float = WINDOW_SEC
) -> tuple[float, float, float]:
    """(F1, 정밀도, 재현율). 정답이나 예측이 비면 전부 0.0 (mir_eval 규칙)."""
    import mir_eval

    true = np.sort(np.asarray(onsets_true, dtype=np.float64))
    pred = np.sort(np.asarray(onsets_pred, dtype=np.float64))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # 빈 배열 경고는 값으로 충분
        f1, precision, recall = mir_eval.onset.f_measure(true, pred, window=window_sec)
    return float(f1), float(precision), float(recall)


def onset_metrics(
    onsets_true: np.ndarray,
    drums_pred: np.ndarray,
    sample_rate: int,
) -> OnsetResult:
    """정답 온셋 대 예측 드럼 스템 검출 온셋. ±50ms와 ±25ms."""
    pred = detect_onsets(drums_pred, sample_rate)
    f1, precision, recall = onset_scores(onsets_true, pred, WINDOW_SEC)
    f1_tight, _, _ = onset_scores(onsets_true, pred, WINDOW_TIGHT_SEC)
    return OnsetResult(
        f1=f1,
        precision=precision,
        recall=recall,
        f1_tight=f1_tight,
        n_true=int(len(onsets_true)),
        n_pred=int(len(pred)),
    )
