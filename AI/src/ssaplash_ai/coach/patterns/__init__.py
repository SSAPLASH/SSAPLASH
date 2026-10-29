"""패턴별 통계 규칙. 각 함수는 `(노트 표, 임계값) -> 후보 목록`인 순수 함수다."""

from ssaplash_ai.coach.patterns.base import Candidate
from ssaplash_ai.coach.patterns.hand import detect_hand_weak
from ssaplash_ai.coach.patterns.miss import detect_miss_cluster
from ssaplash_ai.coach.patterns.stability import detect_unsteady
from ssaplash_ai.coach.patterns.timing import detect_pad_timing, detect_timing
from ssaplash_ai.coach.patterns.transition import detect_transition

DETECTORS = (
    detect_timing,
    detect_pad_timing,
    detect_transition,
    detect_hand_weak,
    detect_miss_cluster,
    detect_unsteady,
)

__all__ = ["DETECTORS", "Candidate"]
