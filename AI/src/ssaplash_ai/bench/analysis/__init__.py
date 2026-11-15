"""채보 규칙 분석 도구. ADTOF + 드럼 킷 분리 규칙용.

rule_features가 무거운 계산을 곡마다 한 번만 GPU로 돌려 저장하고, rule_eval·tom_pitch는 그 파일로 CPU에서 돎.
"""

from ssaplash_ai.bench.analysis.rule_eval import (
    RuleCandidate,
    eval_candidate,
    load_candidates,
    predict_hits,
    run_rule_eval,
    tom_summary,
)
from ssaplash_ai.bench.analysis.rule_features import (
    FEATURES_ROOT,
    RuleFeatures,
    build_features,
    feature_path,
    load_features,
    save_features,
)
from ssaplash_ai.bench.analysis.tom_pitch import (
    band_accuracy,
    collect_true_tom_f0,
    predicted_tom_table,
    run_tom_pitch,
    search_bands,
)

__all__ = [
    "FEATURES_ROOT",
    "RuleCandidate",
    "RuleFeatures",
    "band_accuracy",
    "build_features",
    "collect_true_tom_f0",
    "eval_candidate",
    "feature_path",
    "load_candidates",
    "load_features",
    "predict_hits",
    "predicted_tom_table",
    "run_rule_eval",
    "run_tom_pitch",
    "save_features",
    "search_bands",
    "tom_summary",
]
