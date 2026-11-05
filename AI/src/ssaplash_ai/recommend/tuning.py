"""하이퍼파라미터 선택(설계 문서 부록 B.7 "민감도"와 시험 누수 방지).

**시험 구간을 보고 값을 고르면 누수다.** 학습 구간 안에서 다시 시간순으로 나눈 검증 구간으로 고르고, 시험 구간은 고른 뒤 한 번만 본다.
`tune`은 후보 설정마다 검증 구간의 Recall@k를 재서 가장 좋은 설정을 돌려준다.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import pandas as pd

from ssaplash_ai.recommend.data import Dataset, Split, temporal_split
from ssaplash_ai.recommend.models.base import Recommender


@dataclass(frozen=True)
class TuneResult:
    best: dict[str, object]
    table: pd.DataFrame  # 후보마다 params와 validation_recall
    n_targets: int


def validation_split(train: pd.DataFrame, cutoff_quantile: float = 0.8) -> Split:
    """학습 구간만으로 만든 시간순 분할. 시험 구간의 연주는 들어가지 않는다."""
    return temporal_split(train, cutoff_quantile=cutoff_quantile)


def tune(
    build: Callable[[dict[str, object]], Recommender],
    candidates: list[dict[str, object]],
    train: pd.DataFrame,
    data: Dataset,
    *,
    k: int = 10,
    cutoff_quantile: float = 0.8,
) -> TuneResult:
    """`build(params)`가 만든 방법을 검증 분할로 평가해 Recall@k(일반 목표)가 가장 높은 설정을 고른다.

    값이 같으면 앞선 후보를 고른다. 검증 구간에 평가할 목표가 없으면 오류다.
    """
    if not candidates:
        raise ValueError("후보 설정이 비어 있습니다.")
    inner = validation_split(train, cutoff_quantile)
    targets = inner.warm_test[~inner.warm_test["repeat"]]
    if targets.empty:
        raise ValueError("검증 구간에 평가할 목표가 없습니다.")
    rows = []
    for params in candidates:
        model = build(params).fit(inner.train, data, now=inner.cutoff)
        hits = sum(
            r.song_id in model.rank(r.user_key, k, exclude=model.seen_songs(r.user_key))
            for r in targets.itertuples()
        )
        rows.append(
            {
                **{f"param.{key}": value for key, value in params.items()},
                "validation_recall": hits / len(targets),
            }
        )
    table = pd.DataFrame(rows)
    best_index = int(table["validation_recall"].to_numpy().argmax())  # 같으면 앞선 후보
    return TuneResult(dict(candidates[best_index]), table, len(targets))
