"""M0 인기: 학습 구간의 연주 수 순서. 가장 단순한 기준선이다. 학습 구간에 없던 새 곡은 0이라 맨 뒤다."""

from __future__ import annotations

import numpy as np

from ssaplash_ai.recommend.models.base import ScoreRecommender


class Popularity(ScoreRecommender):
    name = "M0_popularity"

    def scores(self, user_key: str) -> np.ndarray:
        return self.popularity_counts
