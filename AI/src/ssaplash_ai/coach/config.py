"""약점 분석 설정. 임계값은 모두 이 파일 한 곳에 두고 기준 폭 `basis_ms`의 비율로 정의한다.

비율로 두는 이유: 사용자마다 판정 폭이 달라도 같은 박 오차에는 같은 말을 하려는 것이다. 기준 폭은 기본이 고정 60ms로,
FE 실시간 코칭과 같다(판정 폭은 게임 난이도이고 코칭은 실제 박 오차를 보기 때문. FE `coachBasis`의 fixed 방식).
`basis_ms=None`이면 이전처럼 플레이의 `timingWindows.goodMs`를 쓴다.
수치는 가정값이며 QA(합성 평가, 이후 실제 로그) 뒤에 이 파일만 고쳐 조정한다.
아래 `ms` 주석은 기준 폭 50ms로 계산한 값이다(기준 60ms면 1.2배).
"""

from __future__ import annotations

from dataclasses import dataclass

ANALYZER_VERSION = "weak-rules-0.6"

# 입력 상한 (BE 업로드 상한과 같다)
MAX_HITS = 50_000
MAX_BODY_BYTES = 5 * 1024 * 1024

# 노트가 이 이상이면 켜져 있는 패턴을 모두 본다. 이보다 적고 `Thresholds.short_min_notes` 이상이면
# 짧은 곡 분석(전체 타이밍·한쪽 손만), 그보다 적으면 분석하지 않는다(reason: INSUFFICIENT_HITS)
MIN_NOTES = 20

# 응답에 담는 최대 개수와 같은 pattern의 최대 개수
MAX_RESULTS = 5
MAX_PER_PATTERN = 2

# 연습 조언(`tip`) 한 항목의 최대 글자 수. 화면 폭에 맞는지는 FE와 확인한다
MAX_TIP_CHARS = 100

# 약점 상세 설명(`detail`)과 종합 총평(`summary.text`)의 최대 글자 수
MAX_DETAIL_CHARS = 120
MAX_SUMMARY_CHARS = 200
# LLM이 쓴 총평(summary.source=LLM)의 최대 글자 수. 규칙 총평(200자)보다 길게 쓸 수 있다
MAX_NARRATIVE_CHARS = 160
# LLM 총평의 문장 수와 한 문장의 최대 글자 수. 화면이 첫 문장을 제목, 나머지를 설명으로 보인다
# 화면이 첫 문장을 제목, 나머지를 「자세한 분석」에 문장마다 한 줄로 보인다. 자세한 분석이 2~3줄이 되게 한다.
# 약점이 없으면 쓸 내용이 적어 한 문장 적어도 된다
MIN_NARRATIVE_SENTENCES = 3
MIN_NARRATIVE_SENTENCES_NO_WEAKNESS = 2
MAX_NARRATIVE_SENTENCES = 4
MAX_NARRATIVE_SENTENCE_CHARS = 50

# 심각도 단계: severity(0~1)가 MEDIUM 미만이면 LOW, HIGH 미만이면 MEDIUM, 그 이상이면 HIGH (가정값)
SEVERITY_MEDIUM = 0.4
SEVERITY_HIGH = 0.7

# 종합 총평 등급 기준 (가정값). 골든 샘플과 실제 로그로 분포를 본 뒤 이 파일에서만 고친다.
SUMMARY_GOOD_MISS_RATE = 0.10  # 놓침 비율이 이보다 낮고
SUMMARY_GOOD_PERFECT_SHARE = 0.5  # PERFECT 비율이 이 이상이며 HIGH 약점이 없으면 GOOD
# 놓침 비율이 이 이상이면 NEEDS_WORK. HIGH 약점만으로는 내리지 않는다(약점 카드가 따로 알린다)
SUMMARY_NEEDS_WORK_MISS_RATE = 0.40
# 잘한 점으로 꼽는 패드: 노트가 이만큼 이상이고 적중률(놓치지 않은 비율)이 이 이상인 패드 중 가장 높은 것
STRENGTH_MIN_NOTES = 8
STRENGTH_MIN_RATE = 0.9

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
    # --- 기준 폭: 아래 비율(×)을 곱하는 ms 기준 ---
    # 판정 폭(goodMs)은 게임 난이도이고, 코칭은 실제 박 오차를 본다. 그래서 기본은 FE 실시간 코칭과 같은 고정 60ms다
    # (FE `domain/coachBasis.ts`의 fixed 방식. 판정 폭 60을 쓰는 사용자는 이전과 임계값이 같다).
    # None이면 플레이마다 `timingWindows.goodMs`를 쓴다(이전 동작. 보정·비교용).
    basis_ms: float | None = 60.0

    # --- TIMING_* : 전체적으로 늦거나 빠르다 ---
    timing_min_valid: int = 20  # 유효 타격(PERFECT/GOOD) 수
    timing_mean_ratio: float = 0.3  # 평균 |오차| ≥ 0.3 × 기준 폭 (18ms)
    timing_same_sign: float = 0.65  # 평균과 같은 부호인 타격 비율
    timing_min_se: float = 0.0  # 평균 |오차| ≥ 이 값 × 표준오차. 0이면 보지 않는다

    # --- PAD_* : 특정 패드에서 늦거나 빠르다 ---
    pad_min_valid: int = 8
    pad_mean_ratio: float = 0.4  # 그 패드 평균 |오차| ≥ 0.4 × 기준 폭 (24ms)
    pad_gap_ratio: float = 0.24  # 전체 평균과의 차이 ≥ 0.24 × 기준 폭 (14.4ms)

    # --- TRANSITION_* : 패드가 바뀔 때 늦거나 놓친다 ---
    transition_min_count: int = 6  # 같은 A→B 전환 횟수
    transition_min_valid: int = 3  # 평균 오차를 계산할 최소 유효 타격 (구현 보완: 1~2개 평균 방지)
    transition_late_ratio: float = 0.5  # 평균 오차 ≥ 0.5 × 기준 폭 (30ms)
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
    unsteady_std_ratio: float = 0.5  # 오차 표준편차 ≥ 0.5 × 기준 폭 (30ms)

    # --- 짧은 곡: 노트가 short_min_notes 이상 MIN_NOTES 미만이면 TIMING_*·HAND_WEAK만 아래 값으로 본다 ---
    # 표본이 적은 만큼 더 뚜렷해야 잡힌다. 나머지 패턴은 표본이 모자라 보지 않는다
    short_min_notes: int = 8
    short_timing_min_valid: int = 8
    short_timing_same_sign: float = 0.75
    short_timing_min_se: float = 2.5
    short_hand_min_valid: int = 5  # 양손 각각
    short_hand_ratio_max: float = 0.70

    # --- severity(0~1) 분모 ---
    severity_delta_ratio: float = 1.2  # min(1, |평균 오차| ÷ (1.2 × 기준 폭))
    severity_miss_rate: float = 0.6  # min(1, 놓침 비율 ÷ 0.6)
    severity_hand_span: float = 0.4  # min(1, (0.75 − 비율) ÷ 0.4)
    severity_unsteady_ratio: float = 0.8  # min(1, 표준편차 ÷ (0.8 × 기준 폭))


DEFAULT_THRESHOLDS = Thresholds()
