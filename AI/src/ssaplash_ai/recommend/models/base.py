"""모든 추천 방법의 공통 인터페이스.

`fit(train, data)`로 학습 구간의 연주만 보고, `rank(user, k, exclude)`로 곡 id를 순위대로 돌려준다.
- 후보 전체는 `data.songs`의 모든 공용 곡이다(학습 구간에 없던 새 곡 포함). 새 곡을 순위에 올릴 수 있는지가 방법마다 다르다.
- `exclude`는 순위에서 뺄 곡(보통 그 사용자가 이미 친 곡). 평가 하니스가 정한다.
- 점수가 같으면 곡 id 오름차순이다(결정적).
- 학습 구간에 연주가 없는 사용자는 인기 순서로 대체한다(모든 방법이 같은 규칙).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Collection
from dataclasses import dataclass

import numpy as np
import pandas as pd

from ssaplash_ai.recommend.data import Dataset


@dataclass(frozen=True)
class History:
    """사용자 한 명의 학습 구간 연주(시간 오름차순)."""

    song_ids: tuple[int, ...]
    chart_ids: tuple[int, ...]
    played_at: tuple[pd.Timestamp, ...]
    accuracy: tuple[float, ...]

    def __len__(self) -> int:
        return len(self.song_ids)


def build_histories(train: pd.DataFrame) -> dict[str, History]:
    """학습 구간 연주를 사용자별로 묶는다. 입력이 시간순이 아니어도 시간순으로 정렬한다."""
    ordered = train.sort_values("played_at", kind="stable")
    out: dict[str, History] = {}
    for user, rows in ordered.groupby("user_key", sort=True):
        out[str(user)] = History(
            tuple(int(v) for v in rows["song_id"]),
            tuple(int(v) for v in rows["chart_id"]),
            tuple(rows["played_at"]),
            tuple(float(v) for v in rows["accuracy"]),
        )
    return out


class Recommender(ABC):
    """추천 방법. 서브클래스는 `_fit`과 `rank`를 구현한다."""

    name: str = "base"

    def fit(
        self, train: pd.DataFrame, data: Dataset, *, now: pd.Timestamp | None = None
    ) -> Recommender:
        """`train`은 학습 구간 연주만. `now`는 "지금" 시각(기본은 학습 구간의 마지막 연주 시각)."""
        if train.empty:
            raise ValueError("학습 구간 연주가 비어 있습니다.")
        self.data = data
        self.histories = build_histories(train)
        self.now = pd.Timestamp(now) if now is not None else train["played_at"].max()
        self.song_ids = np.sort(data.songs["song_id"].to_numpy(dtype="int64"))
        self.song_index = {int(s): i for i, s in enumerate(self.song_ids)}
        counts = train.groupby("song_id").size()
        self.popularity_counts = np.array(
            [int(counts.get(int(s), 0)) for s in self.song_ids], dtype="float64"
        )
        self._fit(train)
        return self

    def _fit(self, train: pd.DataFrame) -> None:  # noqa: B027 - 준비할 것이 없는 방법은 비워 둔다
        """서브클래스가 학습 구간 연주로 준비할 것이 있으면 구현한다."""

    @abstractmethod
    def rank(self, user_key: str, k: int, exclude: Collection[int] = ()) -> list[int]:
        """상위 `k`개 곡 id."""

    def params(self) -> dict[str, object]:
        """보고서·MLflow에 남길 하이퍼파라미터. 없는 방법은 비어 있다."""
        return {}

    def seen_songs(self, user_key: str) -> frozenset[int]:
        """그 사용자가 학습 구간에서 친 곡(평가에서 `exclude`로 쓴다)."""
        history = self.histories.get(user_key)
        return frozenset(history.song_ids) if history else frozenset()

    def _top_k(self, scores: np.ndarray, k: int, exclude: Collection[int]) -> list[int]:
        """점수 내림차순, 같으면 곡 id 오름차순으로 `exclude`를 뺀 상위 `k`개."""
        if k < 1:
            raise ValueError("k는 1 이상이어야 합니다.")
        order = np.lexsort((self.song_ids, -scores))  # 마지막 키가 우선: 점수, 같으면 곡 id
        blocked = {self.song_index[s] for s in exclude if s in self.song_index}
        picked: list[int] = []
        for index in order:
            if int(index) in blocked:
                continue
            picked.append(int(self.song_ids[index]))
            if len(picked) == k:
                break
        return picked


class ScoreRecommender(Recommender):
    """곡마다 점수를 매겨 순위를 만드는 방법의 공통 구현. 서브클래스는 `scores`만 구현한다."""

    @abstractmethod
    def scores(self, user_key: str) -> np.ndarray:
        """`self.song_ids`와 같은 순서의 점수. 큰 쪽이 먼저."""

    def rank(self, user_key: str, k: int, exclude: Collection[int] = ()) -> list[int]:
        history = self.histories.get(user_key)
        scores = self.scores(user_key) if history else self.popularity_counts
        return self._top_k(scores, k, exclude)
