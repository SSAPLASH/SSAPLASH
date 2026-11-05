"""평가 하니스(설계 문서 부록 B.7).

모든 방법을 같은 분할·같은 사용자·같은 규칙으로 평가한다. 지표는 사용자 단위로 계산하고, 사용자를 다시 뽑는
부트스트랩(시드 고정)으로 신뢰구간을 낸다. 같은 입력이면 같은 결과가 나온다.

- **일반(warm):** 목표 곡이 학습 구간에 있던 곡. Recall@k, NDCG@k(목표가 하나라 Recall은 적중률과 같다).
- **새 곡(cold):** 목표 곡이 학습 구간에 한 번도 없던 곡. 같은 지표.
- **안전성:** 추천 곡이 사용자의 기준 밀도(최근 85% 이상 연주의 최대 밀도)의 1.5배를 넘는 곡뿐인 비율(하드 제외 위반율).
- **도달·다양성:** 추천에 한 번이라도 나온 곡 비율(커버리지), 추천 중 새 곡의 비중, 목록 안의 장르·곡 난이도 종류 수.

평가에서 사용자가 학습 구간에 이미 친 곡은 순위에서 뺀다(`exclude`). 그래서 `repeat` 목표(이미 친 곡을 다시 친 경우)는
맞힐 수 없으므로 기본으로 평가에서 제외한다(`exclude_repeat_targets`).
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ssaplash_ai.recommend import r1
from ssaplash_ai.recommend.data import Dataset, Split
from ssaplash_ai.recommend.models.base import Recommender

PER_USER_METRICS = ("recall", "ndcg")


@dataclass(frozen=True)
class EvalConfig:
    k: int = 10
    bootstrap: int = 1000
    seed: int = 0
    hard_limit: float = r1.HARD_LIMIT
    exclude_repeat_targets: bool = True


@dataclass(frozen=True)
class ModelResult:
    """한 방법의 결과. `per_user`는 메모리에서 비교(`compare`)에만 쓰고 보고서에는 넣지 않는다."""

    name: str
    metrics: dict[str, float]
    per_user: pd.DataFrame = field(repr=False)  # user_key, kind(warm|cold), recall, ndcg


@dataclass(frozen=True)
class Report:
    config: EvalConfig
    stage: str
    data_hash: str
    cutoff: str
    n_songs: int
    n_cold_songs: int
    results: dict[str, ModelResult]
    model_params: dict[str, dict[str, object]] = field(default_factory=dict)

    def table(self) -> pd.DataFrame:
        """행은 방법, 열은 지표. 신뢰구간 열은 뺀다."""
        rows = {
            n: {k: v for k, v in r.metrics.items() if "_ci_" not in k}
            for n, r in self.results.items()
        }
        return pd.DataFrame.from_dict(rows, orient="index")

    def to_dict(self) -> dict:
        """JSON으로 쓸 수 있는 요약. 사용자 키·연주 같은 개인 단위 값은 담지 않는다."""
        return {
            "stage": self.stage,
            "data_hash": self.data_hash,
            "cutoff": self.cutoff,
            "k": self.config.k,
            "seed": self.config.seed,
            "bootstrap": self.config.bootstrap,
            "hard_limit": self.config.hard_limit,
            "n_songs": self.n_songs,
            "n_cold_songs": self.n_cold_songs,
            "models": {n: _clean(r.metrics) for n, r in self.results.items()},
            "params": {
                n: {k: _plain(v) for k, v in p.items()} for n, p in self.model_params.items()
            },
        }

    def digest(self) -> str:
        """같은 입력이면 같은 값. 재현성 검사에 쓴다."""
        return hashlib.sha256(
            json.dumps(self.to_dict(), sort_keys=True).encode("utf-8")
        ).hexdigest()


def _plain(value: object) -> object:
    """하이퍼파라미터를 JSON으로 쓸 수 있는 값으로."""
    return value if isinstance(value, str | int | float | bool) or value is None else str(value)


def ranking_stability(
    a: Recommender, b: Recommender, users: list[str], k: int = 10
) -> dict[str, float]:
    """두 설정(시드·차원·가중치만 다른 같은 방법)의 상위 k 목록이 얼마나 같은지(설계 B.7 민감도).

    사용자별 겹친 곡 비율(자카드)의 평균과, 두 목록의 순위 상관(스피어만; 공통 곡만)의 평균을 돌려준다.
    각 방법은 그 사용자가 이미 친 곡을 뺀 순위를 쓴다(평가와 같은 규칙).
    """
    jaccard, spearman = [], []
    for user in users:
        la = a.rank(user, k, exclude=a.seen_songs(user))
        lb = b.rank(user, k, exclude=b.seen_songs(user))
        jaccard.append(len(set(la) & set(lb)) / len(set(la) | set(lb)))
        common = [s for s in la if s in set(lb)]
        if len(common) >= 3:
            ra = [la.index(s) for s in common]
            rb = [lb.index(s) for s in common]
            # 공통 곡만으로 다시 매긴 순위의 스피어만 상관
            ra_rank = np.argsort(np.argsort(ra))
            rb_rank = np.argsort(np.argsort(rb))
            n = len(common)
            spearman.append(1 - 6 * float(((ra_rank - rb_rank) ** 2).sum()) / (n * (n * n - 1)))
    return {
        "jaccard": float(np.mean(jaccard)) if jaccard else math.nan,
        "spearman": float(np.mean(spearman)) if spearman else math.nan,
        "n_users": float(len(jaccard)),
    }


def _clean(metrics: dict[str, float]) -> dict[str, float | None]:
    return {
        k: (None if isinstance(v, float) and not math.isfinite(v) else v)
        for k, v in metrics.items()
    }


def user_baselines(train: pd.DataFrame, density_of: dict[int, float]) -> dict[str, float | None]:
    """사용자별 기준 밀도: 학습 구간 최근 10판 중 정확도 85% 이상인 판의 채보 밀도 최댓값(없으면 None)."""
    out: dict[str, float | None] = {}
    ordered = train.sort_values("played_at", kind="stable")
    for user, rows in ordered.groupby("user_key", sort=True):
        recent = rows.iloc[::-1].head(r1.RECENT_PLAYS)
        qualified = [
            density_of[int(c)]
            for c, a in zip(recent["chart_id"], recent["accuracy"], strict=True)
            if a >= r1.TARGET_ACCURACY and int(c) in density_of
        ]
        out[str(user)] = max(qualified) if qualified else None
    return out


def _bootstrap_ci(values: np.ndarray, B: int, seed: int) -> tuple[float, float]:
    if len(values) == 0:
        return (math.nan, math.nan)
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(values), size=(B, len(values)))
    means = values[idx].mean(axis=1)
    return float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


def evaluate(
    models: list[Recommender], split: Split, data: Dataset, cfg: EvalConfig | None = None
) -> Report:
    """학습이 끝난(`fit`한) 방법들을 시험 목표로 평가한다. 입력 분할은 바꾸지 않는다."""
    cfg = cfg or EvalConfig()
    if cfg.k < 1:
        raise ValueError("k는 1 이상이어야 합니다.")
    names = [m.name for m in models]
    if len(set(names)) != len(names):
        raise ValueError(f"방법 이름이 겹칩니다: {names}")

    targets = pd.concat(
        [split.warm_test.assign(kind="warm"), split.cold_test.assign(kind="cold")],
        ignore_index=True,
    )
    if cfg.exclude_repeat_targets:
        targets = targets[~targets["repeat"]].reset_index(drop=True)
    if targets.empty:
        raise ValueError("평가할 시험 목표가 없습니다.")

    train_songs = set(split.train["song_id"])
    all_songs = [int(s) for s in data.songs["song_id"]]
    cold_songs = set(all_songs) - train_songs
    density_of = {
        int(c): float(d)
        for c, d in zip(
            data.chart_features["chart_id"], data.chart_features["avg_notes_per_sec"], strict=True
        )
    }
    min_density = data.chart_features.groupby("song_id")["avg_notes_per_sec"].min().to_dict()
    baselines = user_baselines(split.train, density_of)
    level_of = dict(zip(data.songs["song_id"], data.songs["song_level"], strict=True))
    genre_of = {}
    if not data.song_meta.empty:
        genre_of = {
            int(s): g
            for s, g in zip(data.song_meta["song_id"], data.song_meta["genre"], strict=True)
            if g
        }

    results: dict[str, ModelResult] = {}
    model_params: dict[str, dict[str, object]] = {}
    for model in models:
        rows = []
        recommended: list[list[int]] = []
        for r in targets.itertuples():
            top = model.rank(r.user_key, cfg.k, exclude=model.seen_songs(r.user_key))
            recommended.append(top)
            hit = r.song_id in top
            rows.append(
                {
                    "user_key": r.user_key,
                    "kind": r.kind,
                    "recall": float(hit),
                    "ndcg": 1.0 / math.log2(top.index(r.song_id) + 2) if hit else 0.0,
                }
            )
        per_user = pd.DataFrame(rows)
        metrics = _metrics(
            per_user,
            recommended,
            targets["user_key"].tolist(),
            baselines,
            min_density,
            level_of,
            genre_of,
            cold_songs,
            len(all_songs),
            cfg,
        )
        results[model.name] = ModelResult(model.name, metrics, per_user)
        model_params[model.name] = model.params()
    return Report(
        cfg,
        data.stage,
        data.data_hash,
        split.cutoff.isoformat(),
        len(all_songs),
        len(cold_songs),
        results,
        model_params,
    )


def _metrics(
    per_user,
    recommended,
    users,
    baselines,
    min_density,
    level_of,
    genre_of,
    cold_songs,
    n_songs,
    cfg,
) -> dict[str, float]:
    out: dict[str, float] = {"k": float(cfg.k)}
    for kind in ("warm", "cold"):
        subset = per_user[per_user["kind"] == kind]
        out[f"n_{kind}"] = float(len(subset))
        for i, metric in enumerate(PER_USER_METRICS):
            values = subset[metric].to_numpy(dtype="float64")
            out[f"{metric}_{kind}"] = float(values.mean()) if len(values) else math.nan
            low, high = _bootstrap_ci(values, cfg.bootstrap, cfg.seed + i)
            out[f"{metric}_{kind}_ci_low"], out[f"{metric}_{kind}_ci_high"] = low, high

    flat = [s for top in recommended for s in top]
    out["coverage"] = len(set(flat)) / n_songs
    out["cold_item_share"] = sum(s in cold_songs for s in flat) / len(flat) if flat else math.nan

    checked = violations = 0
    for user, top in zip(users, recommended, strict=True):
        base = baselines.get(user)
        if base is None:
            continue
        for s in top:
            checked += 1
            violations += min_density[s] / base > cfg.hard_limit
    out["violation_rate"] = violations / checked if checked else math.nan
    out["violation_checked_items"] = float(checked)

    out["diversity_levels"] = float(
        np.mean([len({level_of[s] for s in top}) for top in recommended])
    )
    genres = [len({genre_of[s] for s in top if s in genre_of}) for top in recommended]
    out["diversity_genres"] = float(np.mean(genres)) if genre_of else math.nan
    return out


# ---------------------------------------------------------------- 방법끼리 비교와 진입 판단


def compare(
    report: Report, a: str, b: str, *, metric: str = "ndcg", kind: str = "warm"
) -> dict[str, float]:
    """같은 사용자에 대한 짝 비교: `a`가 `b`보다 평균 `metric`이 상대적으로 얼마나 높은지와 부트스트랩 신뢰구간.

    `relative`는 (a - b) / b다. b의 평균이 0이면 정의되지 않아 NaN이다.
    """
    cfg = report.config
    left = report.results[a].per_user.query("kind == @kind").set_index("user_key")[metric]
    right = report.results[b].per_user.query("kind == @kind").set_index("user_key")[metric]
    if not left.index.equals(right.index):
        raise ValueError("두 방법이 같은 사용자로 평가되지 않았습니다.")
    x, y = left.to_numpy(dtype="float64"), right.to_numpy(dtype="float64")
    if len(x) == 0:
        return {
            "a": math.nan,
            "b": math.nan,
            "relative": math.nan,
            "ci_low": math.nan,
            "ci_high": math.nan,
            "n": 0.0,
        }
    rng = np.random.default_rng(cfg.seed)
    idx = rng.integers(0, len(x), size=(cfg.bootstrap, len(x)))
    mean_a, mean_b = x[idx].mean(axis=1), y[idx].mean(axis=1)
    with np.errstate(divide="ignore", invalid="ignore"):
        rel = np.where(mean_b > 0, (mean_a - mean_b) / mean_b, np.nan)
    finite = rel[np.isfinite(rel)]
    low, high = (
        (float(np.percentile(finite, 2.5)), float(np.percentile(finite, 97.5)))
        if len(finite)
        else (math.nan, math.nan)
    )
    point = (x.mean() - y.mean()) / y.mean() if y.mean() > 0 else math.nan
    return {
        "a": float(x.mean()),
        "b": float(y.mean()),
        "relative": float(point),
        "ci_low": low,
        "ci_high": high,
        "n": float(len(x)),
    }


@dataclass(frozen=True)
class GateConfig:
    """진입 판단 기준(가정값, 설계 미결 U21). 첫 결과를 본 뒤 확정한다."""

    min_relative_gain: float = 0.10  # 가장 좋은 기준선 대비 warm NDCG 상대 개선
    require_significant: bool = True  # 신뢰구간 하한이 0보다 커야 한다
    max_violation_rate: float = 0.01


def entry_gate(
    report: Report,
    candidate: str,
    baselines: list[str],
    *,
    cold_reference: str,
    cfg: GateConfig | None = None,
) -> dict:
    """후보 방법이 R3 진입 기준(부록 B.7)을 넘는지 판단한다. 모든 항목을 근거 값과 함께 돌려준다.

    1. warm NDCG가 가장 좋은 기준선 대비 `min_relative_gain` 이상 높고(신뢰구간 하한 > 0)
    2. cold Recall이 `cold_reference`(M2) 이상이고
    3. 하드 제외 위반율이 `max_violation_rate` 이하(측정할 수 없으면 통과하지 못한 것으로 본다).
    재현성(같은 시드 → 같은 결과)은 호출하는 쪽이 `Report.digest`로 따로 확인한다.
    """
    gate = cfg or GateConfig()
    best = max(baselines, key=lambda n: _nan_to(report.results[n].metrics["ndcg_warm"], -1.0))
    warm = compare(report, candidate, best, metric="ndcg", kind="warm")
    significant = math.isfinite(warm["ci_low"]) and warm["ci_low"] > 0
    warm_ok = (
        math.isfinite(warm["relative"])
        and warm["relative"] >= gate.min_relative_gain
        and (significant or not gate.require_significant)
    )

    cold_value = report.results[candidate].metrics["recall_cold"]
    cold_ref = report.results[cold_reference].metrics["recall_cold"]
    cold_ok = math.isfinite(cold_value) and math.isfinite(cold_ref) and cold_value >= cold_ref

    violation = report.results[candidate].metrics["violation_rate"]
    safe_ok = math.isfinite(violation) and violation <= gate.max_violation_rate

    checks = {
        "warm_ndcg_gain": {
            "passed": warm_ok,
            "best_baseline": best,
            **warm,
            "threshold": gate.min_relative_gain,
        },
        "cold_recall": {
            "passed": cold_ok,
            "candidate": cold_value,
            "reference": cold_ref,
            "reference_name": cold_reference,
        },
        "violation_rate": {
            "passed": safe_ok,
            "value": violation,
            "threshold": gate.max_violation_rate,
        },
    }
    return {
        "candidate": candidate,
        "passed": all(c["passed"] for c in checks.values()),
        "checks": checks,
    }


def _nan_to(value: float, default: float) -> float:
    return value if math.isfinite(value) else default
