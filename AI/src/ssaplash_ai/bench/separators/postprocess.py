"""분리 결과 후처리.

split_high_sustain (후보 E): 드럼 트랙의 고음 대역에서 타격음이 아닌 지속음 성분을 골라냄. 드럼 트랙에 딸려 온
보컬 "ㅅ" 소리·신스 고음은 시간 방향으로 이어지고, 하이햇·심벌 타격은 순간적이라는 성질로 나눔 (librosa HPSS의
소프트 마스크). 골라낸 성분은 호출한 쪽이 드럼에서 빼고 반주에 더함.

limit_peaks: 저장 전 반주 리미터. 피크가 상한을 넘는 순간만 음량을 줄임. 줄이기는 LOOKAHEAD_MS 앞에서 미리
시작하고, 되돌리기는 RELEASE_MS 시간 상수의 지수 곡선으로 천천히 함. 5ms 만에 되돌리면 킥·베이스 한 주기 안에서
음량이 오르내려 저음이 찌그러질 수 있기 때문. 좌우 채널에 같은 이득을 써서 음상이 안 흔들림.
"""

from __future__ import annotations

import math
from functools import cache

import numpy as np
from scipy.ndimage import minimum_filter1d, uniform_filter1d

N_FFT = 2048
HOP_LENGTH = 512
HPSS_MARGIN = 2.0
# 리미터 상한(dBFS)·미리 줄이는 시간·되돌리는 시간 상수
LIMIT_DBFS = -1.0
LOOKAHEAD_MS = 5.0
RELEASE_MS = 100.0


@cache
def _release_kernel():
    """줄일 때는 바로, 되돌릴 때는 지수 곡선으로 따라가는 이득. 샘플 수가 많아 numba로 컴파일."""
    import numba

    @numba.njit(cache=False)
    def release(held: np.ndarray, coef: float) -> np.ndarray:
        out = np.empty_like(held)
        prev = 1.0
        for i in range(held.size):
            t = held[i]
            prev = t if t < prev else coef * prev + (1.0 - coef) * t
            out[i] = prev
        return out

    return release


def limit_peaks(
    audio: np.ndarray,
    sample_rate: int,
    peak_dbfs: float = LIMIT_DBFS,
    lookahead_ms: float = LOOKAHEAD_MS,
    release_ms: float = RELEASE_MS,
) -> tuple[np.ndarray, float]:
    """(채널, 샘플) → (피크를 peak_dbfs 아래로 누른 소리, 가장 많이 누른 양 dB). 안 넘으면 그대로와 0."""
    audio = np.asarray(audio, dtype=np.float32)
    limit = 10.0 ** (peak_dbfs / 20.0)
    peak = np.abs(audio).max(axis=0).astype(np.float64) if audio.size else np.zeros(0)
    need = np.minimum(1.0, limit / np.maximum(peak, 1e-12))
    if need.size == 0 or need.min() >= 1.0:
        return audio, 0.0
    look = max(1, int(round(lookahead_ms / 1000.0 * sample_rate)))
    held = minimum_filter1d(need, 2 * look + 1)
    coef = math.exp(-1.0 / (release_ms / 1000.0 * sample_rate))
    released = _release_kernel()(held, coef)
    # 줄이기 시작하는 곳의 급한 변화를 미리 보기 시간에 걸쳐 부드럽게. 마지막 min은 상한을 넘지 않게 하는 안전장치
    gain = np.minimum(uniform_filter1d(released, look + 1), need)
    return (audio * gain).astype(np.float32), round(20.0 * math.log10(float(gain.min())), 2)


def split_high_sustain(
    drums: np.ndarray, sample_rate: int, cutoff_hz: float, margin: float = HPSS_MARGIN
) -> np.ndarray:
    """(채널, 샘플) 드럼 → 같은 모양의 'cutoff_hz 위 지속음' 성분. 드럼에서 빼면 타격음만 남음."""
    import librosa

    out = np.zeros_like(drums, dtype=np.float32)
    freqs = librosa.fft_frequencies(sr=sample_rate, n_fft=N_FFT)
    high = (freqs >= cutoff_hz)[:, None]
    for ch in range(drums.shape[0]):
        spec = librosa.stft(drums[ch], n_fft=N_FFT, hop_length=HOP_LENGTH)
        mask_h, _ = librosa.decompose.hpss(np.abs(spec), mask=True, margin=margin)
        sustain = spec * mask_h * high
        out[ch] = librosa.istft(sustain, hop_length=HOP_LENGTH, length=drums.shape[1])
    return out
