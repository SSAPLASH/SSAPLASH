"""attack slope 왜곡 (간이 버전).

정답 온셋 시각마다 정답 드럼과 예측 드럼의 진폭 포락선이 온셋 후 10ms 동안 오른 기울기를
구해 로그 비율의 절댓값을 온셋 전체로 평균. 0이면 타격 앞머리(attack slope)가 그대로.

계산 규칙
- 포락선: 모노 절댓값을 1ms 블록으로 나눠 블록마다 최댓값. 10ms 구간이면 블록 10개.
- 기울기: 블록 10개에 최소제곱 직선을 맞춘 기울기 (진폭/ms).
- 왜곡: |ln(기울기_예측 / 기울기_정답)|. 예측 기울기가 바닥값(SLOPE_FLOOR) 이하이면 바닥값으로 대체.
- 정답 기울기가 바닥값 이하인 온셋(구간 안에 상승이 없는 온셋)은 제외하고 개수만 기록.

참고 논문(Beyond SDR, arXiv 2609.04224)의 attack slope를 단순화한 것이며 재현이 아님.
결과 해석 때 이 한계를 적어야 함.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ssaplash_ai.bench.metrics.onset_preservation import to_mono

ATTACK_MS = 10.0
BLOCK_MS = 1.0
SLOPE_FLOOR = 1e-6


@dataclass
class TransientResult:
    """attack slope 왜곡. distortion이 CSV의 attackSlopeDistortion. 나머지는 보조값."""

    distortion: float
    n_used: int
    n_skipped: int


def block_peak_envelope(
    mono: np.ndarray, sample_rate: int, block_ms: float = BLOCK_MS
) -> np.ndarray:
    """절댓값을 block_ms 블록으로 나눠 블록 최댓값. 길이 = 샘플 수 // 블록 샘플 수."""
    block = max(1, int(round(block_ms * sample_rate / 1000)))
    n_blocks = mono.shape[0] // block
    if n_blocks == 0:
        return np.zeros(0, dtype=np.float64)
    trimmed = np.abs(mono[: n_blocks * block].astype(np.float64))
    return trimmed.reshape(n_blocks, block).max(axis=1)


def _slope(env: np.ndarray) -> float:
    """블록 포락선에 최소제곱 직선을 맞춘 기울기 (진폭/블록)."""
    x = np.arange(env.shape[0], dtype=np.float64)
    x -= x.mean()
    denom = np.dot(x, x)
    if denom == 0:
        return 0.0
    return float(np.dot(x, env - env.mean()) / denom)


def attack_slope_distortion(
    drums_true: np.ndarray,
    drums_pred: np.ndarray,
    onsets_true: np.ndarray,
    sample_rate: int,
    attack_ms: float = ATTACK_MS,
) -> TransientResult:
    """온셋마다 10ms attack slope의 로그 비율 절댓값을 평균. 쓸 온셋이 없으면 nan."""
    true_mono = to_mono(drums_true)
    pred_mono = to_mono(drums_pred)
    n = min(true_mono.shape[0], pred_mono.shape[0])
    true_mono, pred_mono = true_mono[:n], pred_mono[:n]
    attack_samples = int(round(attack_ms * sample_rate / 1000))

    values: list[float] = []
    skipped = 0
    for t in np.asarray(onsets_true, dtype=np.float64):
        start = int(round(t * sample_rate))
        end = start + attack_samples
        if start < 0 or end > n:
            skipped += 1
            continue
        slope_true = _slope(block_peak_envelope(true_mono[start:end], sample_rate))
        if slope_true <= SLOPE_FLOOR:
            skipped += 1
            continue
        slope_pred = max(
            _slope(block_peak_envelope(pred_mono[start:end], sample_rate)), SLOPE_FLOOR
        )
        values.append(abs(float(np.log(slope_pred / slope_true))))

    distortion = float(np.mean(values)) if values else float("nan")
    return TransientResult(distortion=distortion, n_used=len(values), n_skipped=skipped)
