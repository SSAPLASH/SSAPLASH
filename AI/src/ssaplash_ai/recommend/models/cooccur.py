"""M3 동시 연주: 곡-곡 동시 연주 기반 item-item 추천.

학습 구간에서 같은 사용자가 친 두 곡의 동시 연주 횟수를 코사인으로 정규화한다. 사용자의 최근 `history`개 곡을
최근일수록 크게(`decay`^순서) 반영해 합한다(M2와 같은 이력 규칙이라 비교가 공정하다).
학습 구간에 없던 새 곡은 동시 연주가 없어 점수가 0이다. 연주 기록으로만 배우는 방법의 한계를 보여 준다.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ssaplash_ai.recommend.models.base import ScoreRecommender


class CoPlay(ScoreRecommender):
    name = "M3_coplay"

    def __init__(self, history: int = 5, decay: float = 0.8):
        self.history = history
        self.decay = decay

    def _fit(self, train: pd.DataFrame) -> None:
        users = {u: i for i, u in enumerate(sorted(self.histories))}
        played = np.zeros((len(users), len(self.song_ids)))
        for user, history in self.histories.items():
            for song in set(history.song_ids):
                played[users[user], self.song_index[song]] = 1.0
        cooccurrence = played.T @ played
        counts = np.diag(cooccurrence).copy()
        denominator = np.sqrt(np.outer(counts, counts))
        self.cosine = np.divide(
            cooccurrence, denominator, out=np.zeros_like(cooccurrence), where=denominator > 0
        )
        np.fill_diagonal(self.cosine, 0.0)  # 자기 자신은 "비슷한 곡"이 아니다

    def scores(self, user_key: str) -> np.ndarray:
        history = self.histories[user_key]
        recent: list[int] = []
        seen: set[int] = set()
        for song in reversed(history.song_ids):
            if song in seen:
                continue
            seen.add(song)
            recent.append(self.song_index[song])
            if len(recent) == self.history:
                break
        out = np.zeros(len(self.song_ids))
        for rank, index in enumerate(recent):
            out += (self.decay**rank) * self.cosine[index]
        return out
