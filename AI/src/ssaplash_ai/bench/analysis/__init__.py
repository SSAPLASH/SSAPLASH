"""채보 규칙 분석 도구 (탐·크래시 규칙 설계 2장). S15P31A307-163.

- rule_features: ADTOF 타격 시각 + 드럼 킷 분리 트랙을 곡마다 한 번만 GPU로 계산해 npz로 저장
- rule_eval: 저장한 특징 + 규칙 설정 → 패드 붙이기 → 정답과 짝지어 점수·혼동표. 후보 여러 개 비교
- tom_pitch: 정답 탐 타격의 음높이 분포와 고정 경계 후보 계산

의존 방향: cli → analysis → transcribers(규칙 함수)·metrics(짝짓기)·datasets(정답). GPU는 rule_features만 씀.
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
