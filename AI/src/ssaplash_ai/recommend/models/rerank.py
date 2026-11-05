"""M6 후보 + 규칙 재정렬: 후보 생성 방법(예: LightGCN)의 상위 후보를 R1 규칙으로 걸러 다시 세운다(설계 문서 부록 B.6).

R3의 후보 생성은 "무엇을 좋아할지"는 잘 맞혀도 "지금 칠 수 있는 난이도인지"는 모른다. 규칙 단계가 그것을 보장한다.

- **하드 제외:** 사용자의 기준 밀도(최근 85% 이상 연주의 최대 밀도)의 1.5배를 넘는 채보만 있는 곡은 후보 점수와 무관하게 뺀다.
  서비스의 R1과 같은 규칙이라 평가의 하드 제외 위반율은 0이어야 한다.
- **재정렬 점수:** `(1 - w) · R1 점수 + w · 후보 순위 점수`. 후보 순위 점수는 후보 목록의 순위로 정한 0~1 값(1위가 1)이다.
  `w = 0`이면 최종 순서가 전부 규칙 점수다(설계의 R3 원칙 "최종 순서는 규칙 점수"). 합성 데이터에서 이 설정은 위반율을 0으로 만들지만
  맞히는 성능이 크게 떨어졌다(warm Recall 0.191 → 0.109). `w`는 검증 구간으로 고르며(`tuning.tune`) 기본값 0.75도 그렇게 골랐다.
- **기준 밀도를 모르는 사용자**(연주가 적거나 85% 이상이 없음)는 거를 근거가 없으므로 후보 순서를 그대로 쓴다.
- 안전한 후보가 `k`개보다 적으면 후보 풀을 전체 곡까지 넓힌다. 그래도 모자라면 모자란 대로 돌려준다(안전하지 않은 곡으로 채우지 않는다).
"""

from __future__ import annotations

from collections.abc import Collection

import pandas as pd

from ssaplash_ai.recommend import r1
from ssaplash_ai.recommend.models.base import Recommender


class Reranked(Recommender):
    def __init__(
        self, generator: Recommender, *, candidate_k: int = 50, relevance_weight: float = 0.75
    ):
        if candidate_k < 1:
            raise ValueError("candidate_k는 1 이상이어야 합니다.")
        if not 0.0 <= relevance_weight <= 1.0:
            raise ValueError("relevance_weight는 0과 1 사이여야 합니다.")
        self.generator = generator
        self.candidate_k = candidate_k
        self.relevance_weight = relevance_weight
        self.name = f"M6_rerank_{generator.name.removeprefix('M5_').removeprefix('M4_')}"

    def params(self) -> dict[str, object]:
        generated = {f"generator.{k}": v for k, v in self.generator.params().items()}
        return {
            "generator": self.generator.name,
            "candidate_k": self.candidate_k,
            "relevance_weight": self.relevance_weight,
            **generated,
        }

    def _fit(self, train: pd.DataFrame) -> None:
        self.generator.fit(train, self.data, now=self.now)
        charts = self.data.chart_features
        songs = self.data.songs.set_index("song_id")
        self.density_of = {
            int(c): float(d)
            for c, d in zip(charts["chart_id"], charts["avg_notes_per_sec"], strict=True)
        }
        self.pads_of = {
            int(c): dict(p) for c, p in zip(charts["chart_id"], charts["pad_ratio"], strict=True)
        }
        self.charts_of: dict[int, list[r1.Candidate]] = {}
        for row in charts.itertuples():
            self.charts_of.setdefault(int(row.song_id), []).append(
                r1.Candidate(
                    int(row.song_id),
                    int(row.chart_id),
                    str(row.difficulty),
                    str(songs.loc[row.song_id, "song_level"]),
                    float(row.avg_notes_per_sec),
                    dict(row.pad_ratio),
                )
            )
        self._plays = dict(
            iter(train.sort_values("played_at", kind="stable").groupby("user_key", sort=False))
        )

    def rank(self, user_key: str, k: int, exclude: Collection[int] = ()) -> list[int]:
        if k < 1:
            raise ValueError("k는 1 이상이어야 합니다.")
        plays = self._plays.get(user_key)
        if plays is None:
            return self.generator.rank(user_key, k, exclude)
        profile = r1.build_profile(plays, self.density_of, self.pads_of, self.now)
        if profile.baseline_density is None:
            return self.generator.rank(user_key, k, exclude)

        n_songs = len(self.song_ids)
        for pool in dict.fromkeys((max(self.candidate_k, k), n_songs)):
            ordered = self.generator.rank(user_key, pool, exclude)
            scored = self._rerank(ordered, profile)
            if len(scored) >= k or pool >= n_songs:
                break
        return scored[:k]

    def _rerank(self, ordered: list[int], profile: r1.Profile) -> list[int]:
        """후보 순서(`ordered`)를 규칙으로 걸러 다시 세운다."""
        candidates = [c for song in ordered for c in self.charts_of.get(song, ())]
        best = r1.score_songs(candidates, profile, self.now)
        n = len(ordered)
        w = self.relevance_weight
        keyed = []
        for position, song in enumerate(ordered):
            if song not in best:  # 하드 제외
                continue
            relevance = 1.0 - position / (n - 1) if n > 1 else 1.0
            keyed.append((-((1 - w) * best[song].total + w * relevance), position, song))
        keyed.sort()
        return [song for _, _, song in keyed]
