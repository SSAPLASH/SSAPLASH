"""M1 R1 규칙: 서비스의 규칙 추천 점수(`r1.py`)를 학습 구간의 본인 기록에 적용한다.

특징(밀도·패드 비율)이 있으면 학습 구간에 없던 새 곡도 점수를 받는다. 학습 구간에 연주가 없는 사용자는 인기 순서로 대체한다.
"""

from __future__ import annotations

from collections.abc import Collection

import pandas as pd

from ssaplash_ai.recommend import r1
from ssaplash_ai.recommend.models.base import Recommender


class R1Rules(Recommender):
    name = "M1_r1_rules"

    def _fit(self, train: pd.DataFrame) -> None:
        charts = self.data.chart_features
        songs = self.data.songs.set_index("song_id")
        self.density_of = {
            int(c): float(d)
            for c, d in zip(charts["chart_id"], charts["avg_notes_per_sec"], strict=True)
        }
        self.pads_of = {
            int(c): dict(p) for c, p in zip(charts["chart_id"], charts["pad_ratio"], strict=True)
        }
        self.candidates = [
            r1.Candidate(
                int(row.song_id),
                int(row.chart_id),
                str(row.difficulty),
                str(songs.loc[row.song_id, "song_level"]),
                float(row.avg_notes_per_sec),
                dict(row.pad_ratio),
            )
            for row in charts.itertuples()
        ]
        self._plays = {
            user: rows
            for user, rows in train.sort_values("played_at", kind="stable").groupby(
                "user_key", sort=False
            )
        }

    def rank(self, user_key: str, k: int, exclude: Collection[int] = ()) -> list[int]:
        if k < 1:
            raise ValueError("k는 1 이상이어야 합니다.")
        plays = self._plays.get(user_key)
        if plays is None:
            return self._top_k(self.popularity_counts, k, exclude)
        profile = r1.build_profile(plays, self.density_of, self.pads_of, self.now)
        blocked = set(exclude)
        # 서비스처럼 곡당 하나를 `size=k`개까지 돌려주되, 제외할 곡은 후보에서 먼저 뺀다.
        candidates = [c for c in self.candidates if c.song_id not in blocked]
        picked = [s.candidate.song_id for s in r1.rank(candidates, profile, self.now, k)]
        if len(picked) < k:
            # 규칙이 비운 자리(기준 밀도의 1.5배 초과로 제외된 곡이 많은 경우)는 인기 순서로 채운다.
            # 하니스가 항상 k개를 받게 하는 처리이며, 채운 만큼은 규칙의 성능이 아니라 인기의 성능이다.
            extra = self._top_k(self.popularity_counts, k + len(picked), blocked | set(picked))
            picked += extra[: k - len(picked)]
        return picked
