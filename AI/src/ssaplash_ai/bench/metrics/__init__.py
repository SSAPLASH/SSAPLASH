"""벤치마크 지표. numpy 배열만 받고 모델·파일은 모름.

- bss: SDR·SIR·SAR (museval, BSS Eval v4) + SI-SDR
- onset: 온셋 검출과 온셋 보존율 (F1·정밀도·재현율, ±50ms·±25ms)
- transient: attack slope 왜곡 (온셋 직후 10ms 포락선 기울기의 로그 비율)
- resource: 처리 시간·피크 RAM·피크 VRAM 측정
- mr_quality: 드럼리스 MR fullness·bleedless·고음 fullness·음량 차이·잘림 비율
- hit_f1: 채보 타격 F1 (라벨별 짝짓기, SUM 집계, 5가지·8패드·9패드·라벨 무시 기준, 시각 오차·세기 상관, 페달 혼동 수)
"""

from ssaplash_ai.bench.metrics.attack_slope_distortion import (
    TransientResult,
    attack_slope_distortion,
)
from ssaplash_ai.bench.metrics.bss_eval_metrics import BssResult, bss_metrics, si_sdr
from ssaplash_ai.bench.metrics.hit_f1 import (
    HitEvaluation,
    HitScores,
    MatchCounts,
    PedalConfusion,
    evaluate_hits,
    f1_from_counts,
    pedal_confusion,
    score_hits,
)
from ssaplash_ai.bench.metrics.mr_quality import MrQuality, bleed_full, mr_quality
from ssaplash_ai.bench.metrics.onset_preservation import (
    OnsetResult,
    detect_onsets,
    merge_onsets,
    onset_metrics,
    onset_scores,
)
from ssaplash_ai.bench.metrics.resource_usage import ResourceUsage, measure_resources

__all__ = [
    "BssResult",
    "HitEvaluation",
    "HitScores",
    "MatchCounts",
    "MrQuality",
    "OnsetResult",
    "PedalConfusion",
    "ResourceUsage",
    "TransientResult",
    "attack_slope_distortion",
    "bleed_full",
    "bss_metrics",
    "detect_onsets",
    "evaluate_hits",
    "f1_from_counts",
    "measure_resources",
    "merge_onsets",
    "mr_quality",
    "onset_metrics",
    "onset_scores",
    "pedal_confusion",
    "score_hits",
    "si_sdr",
]
