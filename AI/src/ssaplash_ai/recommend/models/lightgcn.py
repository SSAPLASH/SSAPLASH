"""M5 LightGCN(He et al., 2020): 사용자-곡 이분 그래프(+곡 특징 노드)의 임베딩을 이웃 평균으로 전파해 학습한다.

LightGCN에는 비선형도 특징 변환도 없어서 최종 임베딩이 초기 임베딩의 **선형 함수** `E = P · E0`이다
(`P = 1/(L+1) · Σ Â^l`). 그래서 BPR 손실의 기울기를 손으로 정확히 쓸 수 있고, PyTorch 없이 numpy와 scipy.sparse만으로
구현한다(새 의존성 없음, CI에서도 시험이 돈다). 기울기는 `∂L/∂E0 = Pᵀ · ∂L/∂E`이고 `Â`가 대칭이라 같은 전파를 한 번 더 적용하면 된다.

- 변형: 특징 없음(`none`) / 곡 특징 노드(`chart`) / 곡 특징 + 메타데이터(`chart+meta`). 특징 노드의 효과를 분리해 본다.
- 음성 표본은 **학습 구간에 연주가 있는 곡**에서만 뽑는다. 한 번도 연주되지 않은 새 곡을 음성으로 뽑으면 새 곡을 일부러 밀어내기 때문이다.
- 사용자 임베딩은 학습·추론 중 메모리에만 있고 파일로 저장하지 않는다(설계 B.3).
- 시드가 같으면 결과가 같다.
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
    Graph,
    build_graph,
)
from ssaplash_ai.recommend.models.base import ScoreRecommender

_SUFFIX = {FEATURES_NONE: "", FEATURES_CHART: "_feat", FEATURES_CHART_META: "_feat_meta"}


def propagate(adjacency: sp.csr_matrix, x: np.ndarray, layers: int) -> np.ndarray:
    """`1/(L+1) · Σ_{l=0..L} Â^l · x`. 최종 임베딩과 기울기 역전파에 같은 함수를 쓴다(Â 대칭)."""
    total = x.copy()
    layer = x
    for _ in range(layers):
        layer = adjacency @ layer
        total = total + layer
    return total / (layers + 1)


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(x, -30, 30)))


class LightGCN(ScoreRecommender):
    def __init__(
        self,
        features: str = FEATURES_NONE,
        *,
        dim: int = 32,
        layers: int = 3,
        epochs: int = 40,
        lr: float = 0.02,
        reg: float = 3e-3,
        batch_size: int = 4096,
        feature_weight: float = 4.0,
        rhythm_clusters: int = 8,
        init_std: float = 0.05,
        cold_norm: bool = True,
        seed: int = 0,
    ):
        if features not in FEATURE_MODES:
            raise ValueError(f"features는 {FEATURE_MODES} 중 하나여야 합니다: {features!r}")
        self.features = features
        self.dim, self.layers, self.epochs, self.lr, self.reg = dim, layers, epochs, lr, reg
        self.batch_size, self.feature_weight, self.rhythm_clusters = (
            batch_size,
            feature_weight,
            rhythm_clusters,
        )
        self.init_std, self.seed, self.cold_norm = init_std, seed, cold_norm
        self.name = f"M5_lightgcn{_SUFFIX[features]}"
        self.loss_history: list[float] = []

    def params(self) -> dict[str, object]:
        return {
            "features": self.features,
            "dim": self.dim,
            "layers": self.layers,
            "epochs": self.epochs,
            "lr": self.lr,
            "reg": self.reg,
            "batch_size": self.batch_size,
            "feature_weight": self.feature_weight,
            "rhythm_clusters": self.rhythm_clusters,
            "init_std": self.init_std,
            "cold_norm": self.cold_norm,
            "seed": self.seed,
        }

    # ------------------------------------------------------------ 학습

    def _fit(self, train: pd.DataFrame) -> None:
        self.graph = build_graph(
            train,
            self.data,
            features=self.features,
            feature_weight=self.feature_weight,
            rhythm_clusters=self.rhythm_clusters,
            seed=self.seed,
        )
        e0 = self._train(self.graph)
        self.final = propagate(self.graph.adjacency, e0, self.layers)
        # 곡 블록의 순서는 곡 id 오름차순이라 `self.song_ids`와 같다
        block = self.final[self.graph.n_users : self.graph.n_users + self.graph.n_songs].copy()
        if self.features != FEATURES_NONE and self.cold_norm:
            block = self._match_cold_norm(block)
        self.song_block = block

    def _match_cold_norm(self, block: np.ndarray) -> np.ndarray:
        """연주 기록이 없는 곡의 임베딩 크기를 학습된 곡의 평균 크기에 맞춘다.

        특징 노드를 통해서만 임베딩을 받는 새 곡은 크기가 작아 내적 점수에서 항상 밀린다(이웃 평균과 차수 정규화 때문).
        방향(어떤 사용자와 맞는지)은 그대로 두고 크기만 맞춰 새 곡이 순위 경쟁에 들어가게 한다. 특징이 없는 변형에는 쓰지 않는다
        (그 곡의 임베딩은 학습되지 않은 무작위 값이라 방향에 뜻이 없다).
        """
        known = np.zeros(len(block), dtype=bool)
        known[self.graph.known_songs] = True
        if not known.any() or known.all():
            return block
        norms = np.linalg.norm(block, axis=1)
        scale = norms[known].mean() / np.maximum(norms[~known], 1e-12)
        block[~known] *= scale[:, None]
        return block

    def _train(self, g: Graph) -> np.ndarray:
        rng = np.random.default_rng(self.seed)
        e0 = rng.normal(0.0, self.init_std, size=(g.n_nodes, self.dim))
        m, v = np.zeros_like(e0), np.zeros_like(e0)
        step = 0
        pairs, known, offset = g.pairs, g.known_songs, g.n_users
        self.loss_history = []
        for _ in range(self.epochs):
            order = rng.permutation(len(pairs))
            total, count = 0.0, 0
            for start in range(0, len(order), self.batch_size):
                batch = pairs[order[start : start + self.batch_size]]
                u, i = batch[:, 0], batch[:, 1]
                j = self._negatives(g, u, known, rng)
                loss, grad = self._gradient(g, e0, u, i, j, offset)
                step += 1
                m = 0.9 * m + 0.1 * grad
                v = 0.999 * v + 0.001 * grad**2
                e0 -= self.lr * (m / (1 - 0.9**step)) / (np.sqrt(v / (1 - 0.999**step)) + 1e-8)
                total += loss * len(batch)
                count += len(batch)
            self.loss_history.append(total / max(count, 1))
        return e0

    @staticmethod
    def _negatives(
        g: Graph, u: np.ndarray, known: np.ndarray, rng: np.random.Generator
    ) -> np.ndarray:
        """사용자가 친 적 없는 곡 중에서 뽑는다. 몇 번 다시 뽑아도 친 곡이면 그대로 둔다(드문 경우)."""
        j = rng.choice(known, size=len(u))
        for _ in range(5):
            clash = g.positive[u, j]
            if not clash.any():
                break
            j[clash] = rng.choice(known, size=int(clash.sum()))
        return j

    def _gradient(self, g, e0, u, i, j, offset) -> tuple[float, np.ndarray]:
        e = propagate(g.adjacency, e0, self.layers)
        n = len(u)
        eu, ei, ej = e[u], e[offset + i], e[offset + j]
        x = (eu * (ei - ej)).sum(axis=1)
        loss = float(np.mean(np.log1p(np.exp(-np.clip(x, -30, 30)))))  # -log σ(x)
        coef = (-_sigmoid(-x) / n)[:, None]  # d(-log σ(x))/dx / n
        grad_e = np.zeros_like(e)
        np.add.at(grad_e, u, coef * (ei - ej))
        np.add.at(grad_e, offset + i, coef * eu)
        np.add.at(grad_e, offset + j, -coef * eu)
        grad = propagate(g.adjacency, grad_e, self.layers)  # Pᵀ · ∂L/∂E, Â 대칭
        if self.reg:
            # 초기 임베딩의 L2: 배치에 나온 노드만 (He et al.과 같다)
            for nodes in (u, offset + i, offset + j):
                np.add.at(grad, nodes, 2 * self.reg * e0[nodes] / n)
            loss += (
                self.reg
                * float(
                    (e0[u] ** 2).sum() + (e0[offset + i] ** 2).sum() + (e0[offset + j] ** 2).sum()
                )
                / n
            )
        return loss, grad

    # ------------------------------------------------------------ 추론

    def scores(self, user_key: str) -> np.ndarray:
        return self.song_block @ self.final[self.graph.user_index[user_key]]
