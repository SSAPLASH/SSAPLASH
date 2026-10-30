"""약점 구간 분석 (COACH-003). BE가 플레이 후 호출하는 통계 규칙 엔진이다.

학습 모델을 쓰지 않는다. 플레이 로그(`hits[]`)에서 노트별 오차·놓침·세기를 통계로 계산하고,
정해 둔 임계값(판정 폭 `goodMs`에 비례)과 비교해 약점 구간을 고른다.
규칙 상세와 BE와의 합의 내용은 `AI/docs/coach-weak-segments.md`에 있다.
"""

from ssaplash_ai.coach.analyzer import analyze
from ssaplash_ai.coach.config import ANALYZER_VERSION
from ssaplash_ai.coach.schema import AnalysisRequest, AnalysisResponse

__all__ = ["ANALYZER_VERSION", "AnalysisRequest", "AnalysisResponse", "analyze"]
