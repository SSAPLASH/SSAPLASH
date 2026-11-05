"""M4 Node2Vec 계열(Grover & Leskovec, 2016): 이종 그래프 위 편향 랜덤 워크 + 스킵그램(음성 표본)으로 노드 임베딩을 배운다.

PyTorch 없이 numpy·scipy.sparse로 직접 구현한다(LightGCN과 같은 이유: 새 의존성 없음, CI에서 시험이 돈다).

- **그래프:** `graph.build_graph`와 같다(사용자-곡 + 선택한 곡 특징 노드). 전이 확률은 정규화 전 연결 가중치에 비례한다.
- **랜덤 워크:** 모든 걷는 이를 한 번에 벡터로 움직인다. `p`(되돌아감), `q`(바깥으로 나감)가 1이 아니면 2차 편향을 거절 표집으로 적용한다.
- **학습:** 윈도 안의 (중심, 문맥) 쌍을 양성으로, 빈도^0.75로 뽑은 노드를 음성으로 두는 SGNS 손실. 기울기는 손으로 쓰고(수치 미분으로 시험),
  배치 안에서 같은 노드의 기울기는 평균을 내 Adam으로 갱신한다(자주 나오는 노드가 과하게 움직이지 않게).
- **점수:** 사용자와 곡 임베딩의 **코사인 유사도**. 크기에 영향을 받지 않아 특징 노드로만 이어진 새 곡도 비교할 수 있다.
  연결이 하나도 없는 곡(특징이 없는 변형의 새 곡)은 학습되지 않으므로 점수 0이다.
- 사용자 임베딩은 메모리에만 있고 저장하지 않는다. 시드가 같으면 결과가 같다.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import scipy.sparse as sp

from ssaplash_ai.recommend.graph import (
    FEATURE_MODES,
    FEATURES_CHART,
    FEATURES_CHART_META,
    FEATURES_NONE,
    build_graph,
)
from ssaplash_ai.recommend.models.base import ScoreRecommender

_SUFFIX = {FEATURES_NONE: "", FEATURES_CHART: "_feat", FEATURES_CHART_META: "_feat_meta"}


# ---------------------------------------------------------------- 랜덤 워크


class _Walker:
    """가중 인접 행렬 위의 벡터화된 1차·2차 편향 랜덤 워크."""

    def __init__(self, weights: sp.csr_matrix):
        w = weights.tocsr()
        self.n = w.shape[0]
        self.indptr, self.indices, self.data = w.indptr, w.indices, w.data.astype("float64")
        self.cum = np.cumsum(self.data)
        self.base = np.where(
            self.indptr[:-1] > 0, self.cum[np.maximum(self.indptr[:-1] - 1, 0)], 0.0
        )
        ends = self.indptr[1:] - 1
        self.total = (
            np.where(self.indptr[1:] > self.indptr[:-1], self.cum[np.maximum(ends, 0)], 0.0)
            - self.base
        )
        rows = np.repeat(np.arange(self.n), np.diff(self.indptr))
        self.edge_keys = np.sort(rows.astype("int64") * self.n + self.indices)  # 간선 존재 확인용

    def degree(self, node: np.ndarray) -> np.ndarray:
        return self.indptr[node + 1] - self.indptr[node]

    def step(self, current: np.ndarray, rng: np.random.Generator) -> np.ndarray:
        """각 노드의 이웃 중 하나를 연결 가중치에 비례해 뽑는다(1차)."""
        threshold = self.base[current] + rng.random(len(current)) * self.total[current]
        pos = np.searchsorted(self.cum, threshold, side="right")
        pos = np.clip(pos, self.indptr[current], self.indptr[current + 1] - 1)
        return self.indices[pos]

    def is_edge(self, a: np.ndarray, b: np.ndarray) -> np.ndarray:
        keys = a.astype("int64") * self.n + b
        pos = np.searchsorted(self.edge_keys, keys)
        pos = np.minimum(pos, len(self.edge_keys) - 1)
        return self.edge_keys[pos] == keys

    def walks(
        self, starts: np.ndarray, length: int, p: float, q: float, rng: np.random.Generator
    ) -> np.ndarray:
        """`starts`마다 길이 `length`의 걷기 하나. 모양은 (len(starts), length)."""
        out = np.empty((len(starts), length), dtype="int64")
        out[:, 0] = starts
        if length > 1:
            out[:, 1] = self.step(starts, rng)
        biased = not (p == 1.0 and q == 1.0)
        alpha_max = max(1.0 / p, 1.0, 1.0 / q)
        for t in range(2, length):
            prev, cur = out[:, t - 2], out[:, t - 1]
            nxt = self.step(cur, rng)
            if biased:
                # 거절 표집: 후보를 1차로 뽑고 α/α_max 확률로 받아들이며, 거절된 것만 다시 뽑는다.
                # 64번 안에 못 정하면 마지막 후보를 쓴다(p·q가 극단적일 때만 해당).
                pending = np.ones(len(starts), dtype=bool)
                for _ in range(64):
                    alpha = np.where(
                        nxt == prev, 1.0 / p, np.where(self.is_edge(prev, nxt), 1.0, 1.0 / q)
                    )
                    pending &= ~(rng.random(len(starts)) < alpha / alpha_max)
                    if not pending.any():
                        break
                    nxt[pending] = self.step(cur[pending], rng)
            out[:, t] = nxt
        return out


def context_pairs(walks: np.ndarray, window: int) -> tuple[np.ndarray, np.ndarray]:
    """걷기에서 거리 `window` 이내의 (중심, 문맥) 쌍을 양방향으로 모은다."""
    centers, contexts = [], []
    for d in range(1, min(window, walks.shape[1] - 1) + 1):
        a, b = walks[:, :-d].ravel(), walks[:, d:].ravel()
        centers += [a, b]
        contexts += [b, a]
    return np.concatenate(centers), np.concatenate(contexts)


# ---------------------------------------------------------------- 스킵그램 손실과 기울기


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(x, -30, 30)))


def sgns_loss_and_grads(
    v: np.ndarray, u: np.ndarray, c: np.ndarray, o: np.ndarray, neg: np.ndarray
) -> tuple[float, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """음성 표본 스킵그램의 배치 평균 손실과 쌍별 기울기.

    반환: 손실, ∂L/∂v[c] (B×d), ∂L/∂u[o] (B×d), ∂L/∂u[neg] (B×K×d). 배치 평균(1/B)이 이미 들어 있다.
    """
    vc, uo, un = v[c], u[o], u[neg]
    b = len(c)
    x_pos = (vc * uo).sum(axis=1)
    x_neg = np.einsum("bd,bkd->bk", vc, un)
    loss = float(
        np.mean(
            np.log1p(np.exp(-np.clip(x_pos, -30, 30)))
            + np.log1p(np.exp(np.clip(x_neg, -30, 30))).sum(axis=1)
        )
    )
    s_pos, s_neg = _sigmoid(x_pos), _sigmoid(x_neg)
    g_vc = ((s_pos - 1.0)[:, None] * uo + np.einsum("bk,bkd->bd", s_neg, un)) / b
    g_uo = (s_pos - 1.0)[:, None] * vc / b
    g_un = s_neg[:, :, None] * vc[:, None, :] / b
    return loss, g_vc, g_uo, g_un, vc, uo


def _scatter_mean(index: np.ndarray, grad: np.ndarray, n: int) -> tuple[np.ndarray, np.ndarray]:
    """같은 노드의 기울기를 합해 반환한다. (합, 등장 횟수)."""
    m = sp.csr_matrix((np.ones(len(index)), (index, np.arange(len(index)))), shape=(n, len(index)))
    return m @ grad, np.asarray(m.sum(axis=1)).ravel()


class Node2Vec(ScoreRecommender):
    def __init__(
        self,
        features: str = FEATURES_NONE,
        *,
        dim: int = 32,
        walk_length: int = 20,
        walks_per_node: int = 8,
        window: int = 3,
        p: float = 1.0,
        q: float = 1.0,
        negatives: int = 5,
        epochs: int = 2,
        lr: float = 0.01,
        batch_size: int = 16384,
        feature_weight: float = 4.0,
        rhythm_clusters: int = 8,
        seed: int = 0,
    ):
        if features not in FEATURE_MODES:
            raise ValueError(f"features는 {FEATURE_MODES} 중 하나여야 합니다: {features!r}")
        if p <= 0 or q <= 0:
            raise ValueError("p와 q는 0보다 커야 합니다.")
        self.features = features
        self.dim, self.walk_length, self.walks_per_node, self.window = (
            dim,
            walk_length,
            walks_per_node,
            window,
        )
        self.p, self.q, self.negatives, self.epochs, self.lr = p, q, negatives, epochs, lr
        self.batch_size, self.feature_weight, self.rhythm_clusters, self.seed = (
            batch_size,
            feature_weight,
            rhythm_clusters,
            seed,
        )
        self.name = f"M4_node2vec{_SUFFIX[features]}"
        self.loss_history: list[float] = []

    def params(self) -> dict[str, object]:
        return {
            "features": self.features,
            "dim": self.dim,
            "walk_length": self.walk_length,
            "walks_per_node": self.walks_per_node,
            "window": self.window,
            "p": self.p,
            "q": self.q,
            "negatives": self.negatives,
            "epochs": self.epochs,
            "lr": self.lr,
            "batch_size": self.batch_size,
            "feature_weight": self.feature_weight,
            "rhythm_clusters": self.rhythm_clusters,
            "seed": self.seed,
        }

    # ------------------------------------------------------------ 학습

    def _fit(self, train: pd.DataFrame) -> None:
        self.graph = g = build_graph(
            train,
            self.data,
            features=self.features,
            feature_weight=self.feature_weight,
            rhythm_clusters=self.rhythm_clusters,
            seed=self.seed,
        )
        rng = np.random.default_rng(self.seed)
        walker = _Walker(g.weights)
        connected = np.flatnonzero(walker.degree(np.arange(g.n_nodes)) > 0)
        starts = np.tile(connected, self.walks_per_node)
        walks = walker.walks(starts, self.walk_length, self.p, self.q, rng)
        centers, contexts = context_pairs(walks, self.window)
        self.n_pairs = len(centers)

        counts = np.bincount(walks.ravel(), minlength=g.n_nodes).astype("float64")
        noise = counts**0.75
        noise /= noise.sum()
        noise_cdf = np.cumsum(noise)

        v = rng.normal(0.0, 0.1, (g.n_nodes, self.dim))
        u = np.zeros((g.n_nodes, self.dim))
        self._sgd(v, u, centers, contexts, noise_cdf, rng)
        norms = np.linalg.norm(v, axis=1, keepdims=True)
        unit = v / np.maximum(norms, 1e-12)
        unit[g.weights.getnnz(axis=1) == 0] = 0.0  # 연결이 없는 노드는 학습되지 않았다
        self.unit = unit
        self.song_block = unit[g.n_users : g.n_users + g.n_songs]

    def _sgd(self, v, u, centers, contexts, noise_cdf, rng) -> None:
        n = len(v)
        state = {
            "mv": np.zeros_like(v),
            "vv": np.zeros_like(v),
            "mu": np.zeros_like(u),
            "vu": np.zeros_like(u),
            "t": 0,
        }
        self.loss_history = []
        for _ in range(self.epochs):
            order = rng.permutation(len(centers))
            total, seen = 0.0, 0
            for start in range(0, len(order), self.batch_size):
                idx = order[start : start + self.batch_size]
                c, o = centers[idx], contexts[idx]
                neg = np.searchsorted(noise_cdf, rng.random((len(idx), self.negatives)))
                neg = np.minimum(neg, n - 1)
                loss, g_vc, g_uo, g_un, _, _ = sgns_loss_and_grads(v, u, c, o, neg)
                grad_v, count_v = _scatter_mean(c, g_vc, n)
                u_index = np.concatenate([o, neg.ravel()])
                u_grad = np.concatenate([g_uo, g_un.reshape(-1, self.dim)])
                grad_u, count_u = _scatter_mean(u_index, u_grad, n)
                grad_v /= np.maximum(count_v, 1.0)[:, None]  # 같은 노드의 기울기는 평균
                grad_u /= np.maximum(count_u, 1.0)[:, None]
                state["t"] += 1
                self._adam(v, grad_v, state["mv"], state["vv"], state["t"])
                self._adam(u, grad_u, state["mu"], state["vu"], state["t"])
                total += loss * len(idx)
                seen += len(idx)
            self.loss_history.append(total / max(seen, 1))

    def _adam(self, param, grad, m, s, t) -> None:
        m *= 0.9
        m += 0.1 * grad
        s *= 0.999
        s += 0.001 * grad**2
        param -= self.lr * (m / (1 - 0.9**t)) / (np.sqrt(s / (1 - 0.999**t)) + 1e-8)

    # ------------------------------------------------------------ 추론

    def scores(self, user_key: str) -> np.ndarray:
        return self.song_block @ self.unit[self.graph.user_index[user_key]]
