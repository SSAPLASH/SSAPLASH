"""이종 그래프 구성(설계 문서 부록 B.5). 사용자-곡 이분 그래프에 곡 특징 노드를 더할 수 있다.

노드 순서는 `사용자 | 곡 | 특징`이다. 곡 노드는 `Dataset.songs`의 모든 공용 곡(학습 구간에 없던 새 곡 포함)이고 곡 id 오름차순이라
`Recommender.song_ids`와 같은 순서다.

연결과 가중치:
- 사용자 - 곡: 한 번이라도 친 곡이면 1, 완주한 적이 있으면 +0.5, 정확도 85 이상이 있으면 +0.5, 다시 칠 때마다 +0.25(최대 +0.5)
  - 합쳐 최대 2.5. 단순 반복 횟수만으로 가중치가 커지지 않게 상한을 둔다.
- 곡 - 특징: 묶음마다 합이 `feature_weight`가 되도록 나눈다. 묶음은 패드 구성, 패드 전환, 리듬 격자 군집, 노트 밀도 구간, 곡 난이도,
  BPM 구간이고 `meta` 옵션을 켜면 장르·분위기·드럼 스타일·에너지·언어가 더해진다.

특징 노드가 있으면 연주 기록이 없는 새 곡도 특징을 통해 다른 곡과 이어진다(콜드 스타트).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pandas as pd
import scipy.sparse as sp

from ssaplash_ai.recommend.data import Dataset

FEATURES_NONE = "none"
FEATURES_CHART = "chart"
FEATURES_CHART_META = "chart+meta"
FEATURE_MODES = (FEATURES_NONE, FEATURES_CHART, FEATURES_CHART_META)

COMPLETED_BONUS, ACCURATE_BONUS, REVISIT_BONUS, REVISIT_CAP = 0.5, 0.5, 0.25, 2
ACCURATE = 85.0
TOP_PADS = 6  # 곡마다 비율이 큰 패드 상위 몇 개를 노드로 잇는지
TOP_TRANSITIONS = 4
DENSITY_STEP = 0.5  # 노트 밀도 구간 폭(log2)
BPM_STEP = 20.0


@dataclass(frozen=True)
class Graph:
    """정규화된 대칭 인접 행렬과 색인."""

    adjacency: sp.csr_matrix  # D^-1/2 A D^-1/2 (LightGCN 전파용)
    weights: sp.csr_matrix  # 정규화 전 대칭 가중치 A (랜덤 워크의 전이 확률용)
    n_users: int
    n_songs: int
    feature_names: tuple[str, ...]
    user_index: dict[str, int]
    pairs: np.ndarray  # 학습 구간의 (사용자, 곡) 양성 쌍. 곡 번호는 곡 블록 안의 번호
    known_songs: np.ndarray  # 학습 구간에 연주가 한 번이라도 있는 곡 번호
    positive: np.ndarray  # (n_users, n_songs) bool

    @property
    def n_features(self) -> int:
        return len(self.feature_names)

    @property
    def n_nodes(self) -> int:
        return self.n_users + self.n_songs + self.n_features

    def edge_counts(self) -> dict[str, int]:
        """진단용 간선 수(방향 없는 간선 기준)."""
        coo = sp.triu(self.adjacency, k=1).tocoo()
        user_song = int(
            (
                (coo.row < self.n_users)
                & (coo.col >= self.n_users)
                & (coo.col < self.n_users + self.n_songs)
            ).sum()
        )
        return {"user_song": user_song, "song_feature": int(coo.nnz) - user_song}


def interaction_weights(train: pd.DataFrame) -> pd.DataFrame:
    """(사용자, 곡)별 연결 가중치. 열: user_key, song_id, weight."""
    g = train.groupby(["user_key", "song_id"], sort=True)
    stats = g.agg(
        plays=("accuracy", "size"), best=("accuracy", "max"), completed=("completed", "max")
    ).reset_index()
    stats["weight"] = (
        1.0
        + COMPLETED_BONUS * stats["completed"].astype(float)
        + ACCURATE_BONUS * (stats["best"] >= ACCURATE).astype(float)
        + REVISIT_BONUS * np.minimum(stats["plays"] - 1, REVISIT_CAP)
    )
    return stats[["user_key", "song_id", "weight"]]


def _kmeans(x: np.ndarray, k: int, seed: int, iters: int = 25) -> np.ndarray:
    """시드 고정 k-means(k-means++ 초기화). 군집 번호를 돌려준다. 점이 k개보다 적으면 점마다 군집이다."""
    n = len(x)
    if n <= k:
        return np.arange(n)
    rng = np.random.default_rng(seed)
    centers = [x[int(rng.integers(n))]]
    for _ in range(k - 1):
        dist = np.min([((x - c) ** 2).sum(axis=1) for c in centers], axis=0)
        total = dist.sum()
        probs = dist / total if total > 0 else np.full(n, 1.0 / n)
        centers.append(x[int(rng.choice(n, p=probs))])
    centers = np.array(centers)
    labels = np.zeros(n, dtype="int64")
    for _ in range(iters):
        labels = ((x[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2).argmin(axis=1)
        for c in range(k):
            members = x[labels == c]
            if len(members):
                centers[c] = members.mean(axis=0)
    return labels


def _split(prefix: str, names: dict[str, float], total: float) -> dict[str, float]:
    """한 묶음의 특징들에 합이 `total`이 되도록 가중치를 나눈다."""
    s = sum(names.values())
    return {f"{prefix}:{n}": total * v / s for n, v in names.items()} if s > 0 else {}


def song_features(
    data: Dataset, *, meta: bool, rhythm_clusters: int, seed: int, total: float
) -> dict[int, dict[str, float]]:
    """곡마다 {특징 이름: 가중치}. 곡에 속한 채보들의 평균을 쓴다."""
    charts = data.chart_features
    levels = dict(zip(data.songs["song_id"], data.songs["song_level"], strict=True))
    bpm = dict(zip(data.songs["song_id"], data.songs["bpm"], strict=True))
    groups_order = ("KICK", "SNARE", "HAT", "CYMBAL", "TOM")

    rhythm_vec: dict[int, np.ndarray] = {}
    pads: dict[int, dict[str, float]] = {}
    transitions: dict[int, dict[str, float]] = {}
    density: dict[int, float] = {}
    for song, rows in charts.groupby("song_id", sort=True):
        song = int(song)
        density[song] = float(rows["avg_notes_per_sec"].mean())
        for source, target in ((rows["pad_ratio"], pads), (rows["transition_ratio"], transitions)):
            acc: dict[str, float] = {}
            for m in source:
                for k, v in m.items():
                    acc[k] = acc.get(k, 0.0) + v / len(rows)
            target[song] = acc
        vectors = [
            np.concatenate(
                [
                    np.asarray(g["groups"].get(name, [0.0] * 12), dtype="float64")
                    for name in groups_order
                ]
            )
            for g in rows["rhythm_grid"]
            if "groups" in g
        ]
        if vectors:
            rhythm_vec[song] = np.mean(vectors, axis=0)

    clusters: dict[int, int] = {}
    if rhythm_vec:
        ids = sorted(rhythm_vec)
        labels = _kmeans(np.vstack([rhythm_vec[s] for s in ids]), rhythm_clusters, seed)
        clusters = {s: int(labels[i]) for i, s in enumerate(ids)}

    meta_rows: dict[int, pd.Series] = {}
    if meta and not data.song_meta.empty:
        meta_rows = {int(r.song_id): r for r in data.song_meta.itertuples()}

    out: dict[int, dict[str, float]] = {}
    for song in (int(s) for s in data.songs["song_id"]):
        f: dict[str, float] = {}
        top_pads = dict(
            sorted(pads.get(song, {}).items(), key=lambda kv: (-kv[1], kv[0]))[:TOP_PADS]
        )
        f.update(_split("pad", top_pads, total))
        top_trans = dict(
            sorted(transitions.get(song, {}).items(), key=lambda kv: (-kv[1], kv[0]))[
                :TOP_TRANSITIONS
            ]
        )
        f.update(_split("transition", top_trans, total))
        if song in clusters:
            f[f"rhythm:{clusters[song]}"] = total
        if song in density:
            f[f"density:{math.floor(math.log2(max(density[song], 1e-6)) / DENSITY_STEP)}"] = total
        f[f"level:{levels[song]}"] = total
        f[f"bpm:{int(bpm[song] // BPM_STEP)}"] = total
        row = meta_rows.get(song)
        if row is not None:
            if row.genre:
                f[f"genre:{row.genre}"] = total
            if row.mood:
                f.update(_split("mood", dict.fromkeys(row.mood, 1.0), total))
            if row.drum_style:
                f.update(_split("drum", dict.fromkeys(row.drum_style, 1.0), total))
            if row.language:
                f[f"language:{row.language}"] = total
            if not pd.isna(row.energy):
                f[f"energy:{int(row.energy)}"] = total
        out[song] = f
    return out


def build_graph(
    train: pd.DataFrame,
    data: Dataset,
    *,
    features: str = FEATURES_NONE,
    feature_weight: float = 1.0,
    rhythm_clusters: int = 8,
    seed: int = 0,
) -> Graph:
    """학습 구간 연주(와 선택한 곡 특징)로 그래프를 만든다. 시험 구간의 연주는 들어가지 않는다."""
    if features not in FEATURE_MODES:
        raise ValueError(f"features는 {FEATURE_MODES} 중 하나여야 합니다: {features!r}")
    song_ids = np.sort(data.songs["song_id"].to_numpy(dtype="int64"))
    song_index = {int(s): i for i, s in enumerate(song_ids)}
    users = sorted(set(train["user_key"]))
    user_index = {u: i for i, u in enumerate(users)}
    n_users, n_songs = len(users), len(song_ids)

    weights = interaction_weights(train)
    u = weights["user_key"].map(user_index).to_numpy(dtype="int64")
    s = weights["song_id"].map(song_index).to_numpy(dtype="int64")
    w = weights["weight"].to_numpy(dtype="float64")

    feature_names: list[str] = []
    rows, cols, vals = [u], [n_users + s], [w]
    if features != FEATURES_NONE:
        per_song = song_features(
            data,
            meta=features == FEATURES_CHART_META,
            rhythm_clusters=rhythm_clusters,
            seed=seed,
            total=feature_weight,
        )
        feature_names = sorted({name for f in per_song.values() for name in f})
        feature_index = {name: i for i, name in enumerate(feature_names)}
        fr, fc, fv = [], [], []
        for song, mapping in per_song.items():
            for name, weight in mapping.items():
                fr.append(n_users + song_index[song])
                fc.append(n_users + n_songs + feature_index[name])
                fv.append(weight)
        rows.append(np.array(fr, dtype="int64"))
        cols.append(np.array(fc, dtype="int64"))
        vals.append(np.array(fv, dtype="float64"))

    n = n_users + n_songs + len(feature_names)
    r, c, v = np.concatenate(rows), np.concatenate(cols), np.concatenate(vals)
    upper = sp.coo_matrix((v, (r, c)), shape=(n, n))
    a = (upper + upper.T).tocsr()
    degree = np.asarray(a.sum(axis=1)).ravel()
    inv_sqrt = np.divide(1.0, np.sqrt(degree), out=np.zeros_like(degree), where=degree > 0)
    adjacency = (sp.diags(inv_sqrt) @ a @ sp.diags(inv_sqrt)).tocsr()

    positive = np.zeros((n_users, n_songs), dtype=bool)
    positive[u, s] = True
    return Graph(
        adjacency=adjacency,
        weights=a,
        n_users=n_users,
        n_songs=n_songs,
        feature_names=tuple(feature_names),
        user_index=user_index,
        pairs=np.column_stack([u, s]),
        known_songs=np.unique(s),
        positive=positive,
    )
