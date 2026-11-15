"""온셋 검출과 온셋 보존율.

검출기는 librosa 스펙트럼 플럭스(onset_strength → onset_detect, hop 512 샘플 = 11.6ms)이며
정답 드럼 스템과 예측 드럼 스템에 같은 설정을 적용. 매칭은 mir_eval.onset.f_measure.
허용 오차는 50ms(기본)와 25ms(엄격) 두 가지.

정답 온셋은 로더가 준 값(MIDI·사람 주석·탭)이 있으면 그것, 없는 MUSDB는 정답 스템에 검출기를 돌린 값.
같은 검출기를 같은 신호에 두 번 돌리면 결과가 같으므로 정답 스템을 예측으로 넣으면 F1이 1.0.

MIDI·사람 주석 정답은 동시에 친 킥·하이햇을 따로 적어 같은 시각이 여러 번 나오는데, 검출기는 한 순간에
하나만 냄. 그대로 채점하면 남는 정답이 전부 놓친 것으로 세져 재현율이 막히므로, 러너는 이런 정답을
merge_onsets로 MERGE_GAP_SEC 안에 붙은 시각을 하나로 합친 뒤 넘김.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass

import numpy as np

HOP_LENGTH = 512
WINDOW_SEC = 0.05
WINDOW_TIGHT_SEC = 0.025
# 검출기가 두 온셋 사이에 두는 최소 간격(약 35ms)보다 짧게 둠
MERGE_GAP_SEC = 0.03


def merge_onsets(times: np.ndarray, gap_sec: float = MERGE_GAP_SEC) -> np.ndarray:
    """정렬 후, 앞에 남긴 시각과 gap_sec 안으로 붙은 시각은 버리고 첫 시각만 남김."""
    out: list[float] = []
    for t in np.sort(np.asarray(times, dtype=np.float64)):
        if not out or t - out[-1] > gap_sec:
            out.append(float(t))
    return np.array(out, dtype=np.float64)


@dataclass
class OnsetResult:
    """온셋 보존율. CSV 열과 1:1. 온셋 개수는 보조값."""

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
