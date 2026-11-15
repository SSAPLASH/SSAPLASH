"""SDR·SIR·SAR·SI-SDR.

museval `evaluate`(BSS Eval v4, images 방식)에 정답(드럼, 반주)과 예측(드럼, 반주) 2소스를
넣고 1초 윈도우 프레임별 값의 중앙값을 곡 값으로 사용. fast_bss_eval은 쓰지 않음.
배열 모양은 전부 (채널 2, 샘플). museval은 (소스, 샘플, 채널)을 받으므로 내부에서 전치.

무음 처리: BSS Eval은 예측을 정답 부분공간에 사영하는 배율 불변 분해라 무음 예측의 값이 정의되지
않고, museval은 전부 0인 예측을 거부(ValueError). images 방식은 소스마다 독립으로 분해하므로
무음 예측은 고정 시드 잡음으로 바꿔 museval을 돌린 뒤 그 소스의 SDR·SIR·SAR만 -inf로 덮어씀.
정답과 예측이 완전히 같으면 museval이 inf를 돌려주며 그대로 둠.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass

import numpy as np

SILENCE_DITHER = 1e-9


@dataclass
class BssResult:
    """곡 하나의 BSS 지표. 단위 dB. CSV 열과 1:1 (드럼 SIR·SAR은 보조값)."""

    sdr_drums: float
    sdr_accomp: float
    si_sdr_drums: float
    si_sdr_accomp: float
    sir_drums: float
    sir_accomp: float
    sar_drums: float
    sar_accomp: float


def _as_museval(audio: np.ndarray) -> np.ndarray:
    """(채널, 샘플) → (샘플, 채널) float64."""
    return np.ascontiguousarray(audio.T, dtype=np.float64)


def _is_silent(audio: np.ndarray) -> bool:
    return not np.any(audio != 0)


def _dither(audio: np.ndarray, seed: int) -> np.ndarray:
    """museval 입력용 자리 채움. 무음 소스의 결과는 쓰지 않음."""
    rng = np.random.default_rng(seed)
    return audio + SILENCE_DITHER * rng.standard_normal(audio.shape)


def si_sdr(reference: np.ndarray, estimate: np.ndarray) -> float:
    """스케일 불변 SDR (Le Roux 외 2019). 곡 전체 1회, 채널을 이어 붙여 계산. dB."""
    ref = reference.astype(np.float64).ravel()
    est = estimate.astype(np.float64).ravel()
    ref_energy = np.dot(ref, ref)
    if ref_energy == 0:
        return float("nan")
    scale = np.dot(est, ref) / ref_energy
    target = scale * ref
    noise = est - target
    target_energy = np.dot(target, target)
    noise_energy = np.dot(noise, noise)
    if target_energy == 0:
        return float("-inf")
    if noise_energy == 0:
        return float("inf")
    return float(10 * np.log10(target_energy / noise_energy))


def bss_metrics(
    drums_true: np.ndarray,
    accomp_true: np.ndarray,
    drums_pred: np.ndarray,
    accomp_pred: np.ndarray,
    sample_rate: int,
    window_sec: float = 1.0,
) -> BssResult:
    """드럼·반주 2소스 BSS Eval. 프레임(window_sec) 값의 nan 제외 중앙값."""
    import museval

    n = min(a.shape[1] for a in (drums_true, accomp_true, drums_pred, accomp_pred))
    references = np.stack([_as_museval(drums_true[:, :n]), _as_museval(accomp_true[:, :n])])
    preds = [_as_museval(drums_pred[:, :n]), _as_museval(accomp_pred[:, :n])]
    silent = [_is_silent(p) for p in preds]
    estimates = np.stack([_dither(p, seed=i + 1) if silent[i] else p for i, p in enumerate(preds)])
    win = max(1, int(round(window_sec * sample_rate)))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        sdr, _isr, sir, sar = museval.evaluate(references, estimates, win=win, hop=win)
        medians = [np.nanmedian(m, axis=1) for m in (sdr, sir, sar)]
    for i, is_silent in enumerate(silent):
        if is_silent:
            for m in medians:
                m[i] = -np.inf
    (sdr_d, sdr_a), (sir_d, sir_a), (sar_d, sar_a) = (tuple(float(v) for v in m) for m in medians)
    return BssResult(
        sdr_drums=sdr_d,
        sdr_accomp=sdr_a,
        si_sdr_drums=si_sdr(drums_true[:, :n], drums_pred[:, :n]),
        si_sdr_accomp=si_sdr(accomp_true[:, :n], accomp_pred[:, :n]),
        sir_drums=sir_d,
        sir_accomp=sir_a,
        sar_drums=sar_d,
        sar_accomp=sar_a,
    )
