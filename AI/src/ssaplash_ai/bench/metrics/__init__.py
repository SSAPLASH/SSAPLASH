"""벤치마크 지표. numpy 배열만 받고 모델·파일은 모름 (설계 2장 의존 방향).

- bss: SDR·SIR·SAR (museval, BSS Eval v4) + SI-SDR
- onset: 온셋 검출과 온셋 보존율 (F1·정밀도·재현율, ±50ms·±25ms)
- transient: 어택 기울기 왜곡 (온셋 직후 10ms 포락선 기울기의 로그 비율)
- resource: 처리 시간·피크 RAM·피크 VRAM 측정
"""

from ssaplash_ai.bench.metrics.bss import BssResult, bss_metrics, si_sdr
from ssaplash_ai.bench.metrics.onset import (
    OnsetResult,
    detect_onsets,
    onset_metrics,
    onset_scores,
)
from ssaplash_ai.bench.metrics.resource import ResourceUsage, measure_resources
from ssaplash_ai.bench.metrics.transient import TransientResult, attack_slope_distortion

__all__ = [
    "BssResult",
    "OnsetResult",
    "ResourceUsage",
    "TransientResult",
    "attack_slope_distortion",
    "bss_metrics",
    "detect_onsets",
    "measure_resources",
    "onset_metrics",
    "onset_scores",
    "si_sdr",
]
