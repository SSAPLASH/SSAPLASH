"""드럼리스 MR 품질 지표.

정답 MR(원곡 − 정답 드럼)과 예측 MR을 비교함. 분리 커뮤니티가 "SDR은 높은데 먹먹한" 결과를 잡으려고
쓰는 fullness·bleedless(MSST `msst.utils.metrics.bleed_full`, MVSEP)를 numpy로 옮긴 것과, 우리가
진단용으로 붙인 고음 fullness, 음량 차이, 잘림 비율.

계산 규칙
- bleed_full: 두 신호를 STFT(n_fft 4096, hop 1024, hann, 가운데 맞춤·0 채움) → mel 512칸 → 진폭 dB
  (20·log10, 바닥 1e-10, 전체 최댓값에서 80dB 아래는 잘라 올림). 예측 − 정답 dB 차이에서
  양수 평균 b, 음수 평균 a(음수)로 bleedless = 100/(1+b), fullness = 100/(1−a). msst 구현과 같은 값.
- 고음 fullness: 같은 차이에서 mel 칸 중심 주파수가 HIGH_FMIN_HZ 이상인 칸만 씀 (우리 진단용).
- 음량 차이: ITU-R BS.1770 적분 음량(LUFS, pyloudnorm) 예측 − 정답. 정답이 무음이면 nan.
- 잘림 비율: 예측 MR에서 절댓값이 1 이상이라 16비트 저장 때 잘릴 샘플의 비율.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

N_FFT = 4096
HOP_LENGTH = 1024
N_MELS = 512
TOP_DB = 80.0
AMIN = 1e-10
HIGH_FMIN_HZ = 5000.0


@dataclass
class MrQuality:
    """MR 품질. CSV 열 mrFullness·mrBleedless·mrFullnessHigh·mrLufsDiff·mrClipRatio와 1:1."""

    fullness: float
    bleedless: float
    fullness_high: float
    lufs_diff: float
    clip_ratio: float


def _mel_db(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    """(채널, 샘플) 또는 (샘플,) → (채널, mel, 프레임) dB. top_db는 전체 최댓값 기준."""
    import librosa

    x = np.atleast_2d(np.asarray(audio, dtype=np.float32))
    mag = np.abs(
        librosa.stft(
            x, n_fft=N_FFT, hop_length=HOP_LENGTH, window="hann", center=True, pad_mode="constant"
        )
    )
    mel = librosa.filters.mel(sr=sample_rate, n_fft=N_FFT, n_mels=N_MELS)
    db = 20.0 * np.log10(np.maximum(np.einsum("mf,cft->cmt", mel, mag), AMIN))
    return np.maximum(db, db.max() - TOP_DB)


def mel_centers(sample_rate: int) -> np.ndarray:
    """mel 칸마다 중심 주파수 (Hz)."""
    import librosa

    return librosa.mel_frequencies(n_mels=N_MELS + 2, fmax=sample_rate / 2)[1:-1]


def _scores(diff: np.ndarray) -> tuple[float, float]:
    pos, neg = diff[diff > 0], diff[diff < 0]
    b = float(pos.mean()) if pos.size else 0.0
    a = float(neg.mean()) if neg.size else 0.0
    return 100.0 / (1.0 + b), 100.0 / (1.0 - a)


def bleed_full(
    reference: np.ndarray, estimate: np.ndarray, sample_rate: int
) -> tuple[float, float]:
    """(bleedless, fullness). 둘 다 0~100, 클수록 좋음."""
    return _scores(_mel_db(estimate, sample_rate) - _mel_db(reference, sample_rate))


def loudness_lufs(audio: np.ndarray, sample_rate: int) -> float:
    """ITU-R BS.1770 적분 음량. 무음이거나 너무 짧으면 nan."""
    import pyloudnorm

    x = np.atleast_2d(np.asarray(audio, dtype=np.float64)).T
    try:
        value = pyloudnorm.Meter(sample_rate).integrated_loudness(x)
    except ValueError:
        return math.nan
    return float(value) if math.isfinite(value) else math.nan


def clip_ratio(audio: np.ndarray) -> float:
    a = np.asarray(audio)
    return float(np.mean(np.abs(a) >= 1.0)) if a.size else 0.0


def mr_quality(accomp_true: np.ndarray, accomp_pred: np.ndarray, sample_rate: int) -> MrQuality:
    """정답 MR 대비 예측 MR 품질. 길이는 짧은 쪽에 맞춤."""
    n = min(accomp_true.shape[-1], accomp_pred.shape[-1])
    ref, est = accomp_true[..., :n], accomp_pred[..., :n]
    diff = _mel_db(est, sample_rate) - _mel_db(ref, sample_rate)
    bleedless, fullness = _scores(diff)
    keep = mel_centers(sample_rate) >= HIGH_FMIN_HZ
    return MrQuality(
        fullness=fullness,
        bleedless=bleedless,
        fullness_high=_scores(diff[:, keep, :])[1],
        lufs_diff=loudness_lufs(est, sample_rate) - loudness_lufs(ref, sample_rate),
        clip_ratio=clip_ratio(est),
    )
