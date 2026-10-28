"""약점 분석 설정. 임계값은 모두 이 파일 한 곳에 두고 판정 폭 `goodMs`의 비율로 정의한다.

비율로 두는 이유: `goodMs`는 사용자가 30~150ms로 바꿀 수 있어서 "15ms 늦다"가 사람마다 다른 크기다.
수치는 가정값이며 QA(합성 평가, 이후 실제 로그) 뒤에 이 파일만 고쳐 조정한다.
아래 `ms` 주석은 `goodMs = 50` 기준 값이다.
"""

from __future__ import annotations

from dataclasses import dataclass

ANALYZER_VERSION = "weak-rules-0.1"

# 입력 상한 (BE 업로드 상한과 같다)
MAX_HITS = 50_000
MAX_BODY_BYTES = 5 * 1024 * 1024

# 노트가 이보다 적으면 분석하지 않는다 (reason: INSUFFICIENT_HITS)
MIN_NOTES = 20

# 응답에 담는 최대 개수와 같은 pattern의 최대 개수
MAX_RESULTS = 5
MAX_PER_PATTERN = 2

# 켜져 있는 패턴. 나머지(TEMPO_DRIFT_*, VELOCITY_FADE, PAD_CONFUSION, DENSE_WEAK)는 후속이다.
ENABLED_PATTERNS = frozenset(
    {
        "TIMING_LATE",
        "TIMING_EARLY",
        "PAD_LATE",
        "PAD_EARLY",
        "TRANSITION_LATE",
        "TRANSITION_MISS",
        "HAND_WEAK",
        "MISS_CLUSTER",
        "UNSTEADY",
    }
)

# 문구에 쓰는 패드 한글 이름 (FE `PAD_META`의 label과 같다)
PAD_LABELS_KO = {
    "CRASH": "크래시",
    "HIHAT": "하이햇",
    "SNARE": "스네어",
    "SMALL_TOM": "스몰탐",
    "MID_TOM": "미드탐",
    "FLOOR_TOM": "플로어탐",
    "RIDE": "라이드",
    "KICK": "킥",
    "HIHAT_PEDAL": "하이햇 페달",
}


@dataclass(frozen=True)
class Thresholds:
    # --- TIMING_* : 전체적으로 늦거나 빠르다 ---
    timing_min_valid: int = 20  # 유효 타격(PERFECT/GOOD) 수
    timing_mean_ratio: float = 0.3  # 평균 |오차| ≥ 0.3 × goodMs (15ms)
    timing_same_sign: float = 0.65  # 평균과 같은 부호인 타격 비율

    # --- PAD_* : 특정 패드에서 늦거나 빠르다 ---
    pad_min_valid: int = 8
    pad_mean_ratio: float = 0.4  # 그 패드 평균 |오차| ≥ 0.4 × goodMs (20ms)
    pad_gap_ratio: float = 0.24  # 전체 평균과의 차이 ≥ 0.24 × goodMs (12ms)

    # --- TRANSITION_* : 패드가 바뀔 때 늦거나 놓친다 ---
    transition_min_count: int = 6  # 같은 A→B 전환 횟수
    transition_min_valid: int = 3  # 평균 오차를 계산할 최소 유효 타격 (구현 보완: 1~2개 평균 방지)
    transition_late_ratio: float = 0.5  # 평균 오차 ≥ 0.5 × goodMs (25ms)
    transition_miss_rate: float = 0.30

    # --- HAND_WEAK : 한쪽 손 세기가 약하다 ---
    hand_min_valid: int = 15  # 양손 각각
    hand_ratio_max: float = 0.75  # 약한 손 평균 세기 ÷ 센 손 평균 세기 < 0.75

    # --- MISS_CLUSTER : 특정 구간에서 몰려 놓친다 ---
    cluster_window_ms: float = 5000.0
    cluster_step_ms: float = 1000.0
    cluster_min_notes: int = 4
    cluster_miss_rate: float = 0.40

    # --- UNSTEADY : 박자가 불안정하다 ---
    unsteady_min_valid: int = 20
    unsteady_std_ratio: float = 0.5  # 오차 표준편차 ≥ 0.5 × goodMs (25ms)

    # --- severity(0~1) 분모 ---
    severity_delta_ratio: float = 1.2  # min(1, |평균 오차| ÷ (1.2 × goodMs))
    severity_miss_rate: float = 0.6  # min(1, 놓침 비율 ÷ 0.6)
    severity_hand_span: float = 0.4  # min(1, (0.75 − 비율) ÷ 0.4)
    severity_unsteady_ratio: float = 0.8  # min(1, 표준편차 ÷ (0.8 × goodMs))


DEFAULT_THRESHOLDS = Thresholds()
