"""M2 R2 최근접: 사용자가 최근 친 곡들과 채보 유사도(`similarity.py`)가 높은 곡.

최근 `history`개의 서로 다른 곡을 최근일수록 크게(`decay`^순서) 반영해 후보 곡의 점수를 합한다.
채보 특징만 쓰므로 학습 구간에 없던 새 곡도 점수를 받는다(격자가 없는 채보는 비교할 수 없어 0점).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ssaplash_ai.recommend.models.base import ScoreRecommender
from ssaplash_ai.recommend.similarity import ChartSimilarity


class SimilarToRecent(ScoreRecommender):
    name = "M2_similar_to_recent"

    def __init__(self, history: int = 5, decay: float = 0.8):
        self.history = history
        self.decay = decay

    def _fit(self, train: pd.DataFrame) -> None:
        self.similarity = ChartSimilarity(self.data.chart_features, self.data.songs)
        # 곡 순서가 모델과 유사도 행렬에서 같아야 한다(둘 다 곡 id 오름차순)
        assert np.array_equal(self.similarity.song_ids, self.song_ids)

    def scores(self, user_key: str) -> np.ndarray:
        history = self.histories[user_key]
        recent: list[int] = []  # 가장 최근에 친 채보부터, 곡이 겹치지 않게
        seen: set[int] = set()
        for song, chart in zip(
            reversed(history.song_ids), reversed(history.chart_ids), strict=True
        ):
            if song in seen:
                continue
            seen.add(song)
            recent.append(chart)
            if len(recent) == self.history:
                break
        out = np.zeros(len(self.song_ids))
        for rank, chart in enumerate(recent):
            out += (self.decay**rank) * self.similarity.to_song[self.similarity.chart_index[chart]]
        return out
