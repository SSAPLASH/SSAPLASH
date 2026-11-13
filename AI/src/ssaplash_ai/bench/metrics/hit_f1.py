"""채보 타격 F1. 정답 타격 표와 예측 타격 표를 라벨별로 짝지어 점수를 냄.

짝짓기: 라벨(기준에 따라 패드 8종·9종, 5가지 묶음, 라벨 무시)별로 나눠 각 라벨 안에서 mir_eval.util.match_events로
±창 안에서 1:1(짝 수가 최대가 되는 매칭. 둘 다 창 안이면 어느 쪽과 짝지을지는 보장하지 않음). 짝 = 맞힌 것(tp), 예측에만 있으면 헛것(fp), 정답에만 있으면
놓친 것(fn). 창은 50ms(기본)와 25ms(Perfect 폭).
집계: 모든 라벨의 tp·fp·fn을 더해 F1 (논문 표의 SUM). 곡 단위 값은 보조이고 묶음 단위
F1은 보고서가 곡별 개수를 다시 더해 계산하므로 개수를 그대로 돌려줌.
기준(scheme): five = 양쪽을 5가지 묶음으로(거친 라벨 tom·cymbal 포함), pads = 패드 8종(양쪽의 HIHAT_PEDAL을
HIHAT으로 합침. 지난 결과와 같은 조건, 예측에 거친 라벨이 있으면 못 씀), pads9 = 패드 9종 그대로(페달 점수용),
any = 라벨 무시(시각만, 보조).
페달 혼동 수(pedal_confusion): 정답 HIHAT_PEDAL과 예측 HIHAT, 정답 HIHAT과 예측 HIHAT_PEDAL을 각각 같은 창으로 1:1 짝지은 수.
세기 상관: 50ms 창 짝 중 양쪽 세기가 있는 쌍이 MIN_VELOCITY_PAIRS개 이상일 때 피어슨 상관.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from ssaplash_ai.bench.datasets.pads import (
    HITS_DTYPE,
    NO_VELOCITY,
    PEDAL,
    has_coarse,
    merge_pedal,
    to_five_groups,
)

WINDOW_SEC = 0.05
WINDOW_TIGHT_SEC = 0.025
MIN_VELOCITY_PAIRS = 10
SCHEMES = ("five", "pads", "pads9", "any")
ANY_LABEL = "any"


@dataclass
class MatchCounts:
    """맞힌·헛것·놓친 개수. 더할 수 있고, 개수에서 정밀도·재현율·F1을 냄."""

    tp: int = 0
    fp: int = 0
    fn: int = 0

    def __add__(self, other: MatchCounts) -> MatchCounts:
        return MatchCounts(self.tp + other.tp, self.fp + other.fp, self.fn + other.fn)

    @property
    def precision(self) -> float:
        return self.tp / (self.tp + self.fp) if self.tp + self.fp else 0.0

    @property
    def recall(self) -> float:
        return self.tp / (self.tp + self.fn) if self.tp + self.fn else 0.0

    @property
    def f1(self) -> float:
        """정답·예측이 모두 비면 1.0, 한쪽만 비면 0.0 (mir_eval 규칙과 같음)."""
        if self.tp + self.fp + self.fn == 0:
            return 1.0
        p, r = self.precision, self.recall
        return 2 * p * r / (p + r) if p + r else 0.0


def f1_from_counts(tp: int, fp: int, fn: int) -> float:
    return MatchCounts(int(tp), int(fp), int(fn)).f1


@dataclass
class LabelMatch:
    """라벨 하나의 짝짓기 결과. errors는 짝마다 (예측 − 정답) 초."""

    counts: MatchCounts
    errors_sec: np.ndarray
    velocity_pairs: np.ndarray  # (n, 2) 정답·예측 세기. 양쪽 다 있는 쌍만


def _relabel(hits: np.ndarray, scheme: str) -> np.ndarray:
    if scheme == "five":
        return to_five_groups(hits)
    if scheme in ("pads", "pads9"):
        if has_coarse(hits):
            raise ValueError(f"{scheme} 기준은 거친 라벨(tom·cymbal)이 있는 예측에 쓸 수 없음")
        return merge_pedal(hits) if scheme == "pads" else hits
    if scheme == "any":
        out = hits.copy()
        out["pad"] = ANY_LABEL
        return out
    raise ValueError(f"모르는 기준: {scheme} (가능: {SCHEMES})")


def match_by_label(
    hits_true: np.ndarray, hits_pred: np.ndarray, window_sec: float
) -> dict[str, LabelMatch]:
    """라벨별 짝짓기. 정답이나 예측 어느 쪽에든 나온 라벨은 전부 키로 들어감."""
    import mir_eval

    labels = sorted(set(hits_true["pad"].tolist()) | set(hits_pred["pad"].tolist()))
    out: dict[str, LabelMatch] = {}
    for label in labels:
        t = hits_true[hits_true["pad"] == label]
        p = hits_pred[hits_pred["pad"] == label]
        t_times = np.asarray(t["time_sec"], dtype=np.float64)
        p_times = np.asarray(p["time_sec"], dtype=np.float64)
        pairs = mir_eval.util.match_events(t_times, p_times, window_sec)
        tp = len(pairs)
        errors = np.array([p_times[j] - t_times[i] for i, j in pairs], dtype=np.float64)
        vel = [
            (int(t["velocity"][i]), int(p["velocity"][j]))
            for i, j in pairs
            if t["velocity"][i] != NO_VELOCITY and p["velocity"][j] != NO_VELOCITY
        ]
        out[label] = LabelMatch(
            counts=MatchCounts(tp=tp, fp=len(p_times) - tp, fn=len(t_times) - tp),
            errors_sec=errors,
            velocity_pairs=np.array(vel, dtype=np.float64).reshape(-1, 2),
        )
    return out


def sum_counts(matches: dict[str, LabelMatch]) -> MatchCounts:
    total = MatchCounts()
    for m in matches.values():
        total = total + m.counts
    return total


def velocity_correlation(pairs: np.ndarray, min_pairs: int = MIN_VELOCITY_PAIRS) -> float:
    """(n, 2) 세기 쌍의 피어슨 상관. 쌍이 적거나 한쪽이 상수면 nan."""
    if len(pairs) < min_pairs:
        return math.nan
    a, b = pairs[:, 0], pairs[:, 1]
    if np.std(a) == 0 or np.std(b) == 0:
        return math.nan
    return float(np.corrcoef(a, b)[0, 1])


@dataclass
class HitScores:
    """기준 하나(five / pads / pads9 / any)의 곡 단위 점수. 개수가 원본이고 F1은 개수에서 나옴."""

    scheme: str
    counts: MatchCounts  # 50ms
    counts_tight: MatchCounts  # 25ms
    by_label: dict[str, MatchCounts] = field(default_factory=dict)
    by_label_tight: dict[str, MatchCounts] = field(default_factory=dict)
    mean_err_ms: float = math.nan
    mean_abs_err_ms: float = math.nan
    velocity_corr: float = math.nan
    n_true: int = 0
    n_pred: int = 0

    @property
    def f1(self) -> float:
        return self.counts.f1

    @property
    def f1_tight(self) -> float:
        return self.counts_tight.f1

    @property
    def perfect_ratio(self) -> float:
        """F1(25ms) ÷ F1(50ms). 50ms F1이 0이면 nan."""
        return self.f1_tight / self.f1 if self.f1 > 0 else math.nan


def score_hits(
    hits_true: np.ndarray,
    hits_pred: np.ndarray,
    scheme: str = "five",
    window_sec: float = WINDOW_SEC,
    window_tight_sec: float = WINDOW_TIGHT_SEC,
) -> HitScores:
    """정답·예측 타격 표 → 기준 하나의 점수. 표는 pads.HITS_DTYPE."""
    if hits_true.dtype != HITS_DTYPE or hits_pred.dtype != HITS_DTYPE:
        raise ValueError("타격 표 dtype이 HITS_DTYPE이 아님")
    t = _relabel(hits_true, scheme)
    p = _relabel(hits_pred, scheme)
    wide = match_by_label(t, p, window_sec)
    tight = match_by_label(t, p, window_tight_sec)
    errors = (
        np.concatenate([m.errors_sec for m in wide.values()])
        if wide
        else np.zeros(0, dtype=np.float64)
    )
    vel = (
        np.concatenate([m.velocity_pairs for m in wide.values()])
        if wide
        else np.zeros((0, 2), dtype=np.float64)
    )
    return HitScores(
        scheme=scheme,
        counts=sum_counts(wide),
        counts_tight=sum_counts(tight),
        by_label={k: m.counts for k, m in wide.items()},
        by_label_tight={k: m.counts for k, m in tight.items()},
        mean_err_ms=float(np.mean(errors) * 1000) if len(errors) else math.nan,
        mean_abs_err_ms=float(np.mean(np.abs(errors)) * 1000) if len(errors) else math.nan,
        velocity_corr=velocity_correlation(vel),
        n_true=int(len(hits_true)),
        n_pred=int(len(hits_pred)),
    )


def _pair_count(t: np.ndarray, p: np.ndarray, window_sec: float) -> int:
    import mir_eval

    t_times = np.asarray(t["time_sec"], dtype=np.float64)
    p_times = np.asarray(p["time_sec"], dtype=np.float64)
    return len(mir_eval.util.match_events(t_times, p_times, window_sec))


@dataclass
class PedalConfusion:
    """하이햇과 페달 하이햇 사이 혼동 수. 각각 1:1 짝지은 수."""

    pedal_as_hihat: int = 0  # 정답 HIHAT_PEDAL을 HIHAT으로 냄
    hihat_as_pedal: int = 0  # 정답 HIHAT을 HIHAT_PEDAL로 냄

    def __add__(self, other: PedalConfusion) -> PedalConfusion:
        return PedalConfusion(
            self.pedal_as_hihat + other.pedal_as_hihat, self.hihat_as_pedal + other.hihat_as_pedal
        )


def pedal_confusion(
    hits_true: np.ndarray, hits_pred: np.ndarray, window_sec: float = WINDOW_SEC
) -> PedalConfusion:
    """정답 페달 ↔ 예측 HIHAT, 정답 HIHAT ↔ 예측 페달 짝 수 (패드 9종 기준)."""
    t_pedal = hits_true[hits_true["pad"] == PEDAL]
    t_hihat = hits_true[hits_true["pad"] == "HIHAT"]
    p_pedal = hits_pred[hits_pred["pad"] == PEDAL]
    p_hihat = hits_pred[hits_pred["pad"] == "HIHAT"]
    return PedalConfusion(
        pedal_as_hihat=_pair_count(t_pedal, p_hihat, window_sec),
        hihat_as_pedal=_pair_count(t_hihat, p_pedal, window_sec),
    )


@dataclass
class HitEvaluation:
    """곡 하나의 기준별 점수. pads·pads9·pedal은 예측이 8패드를 다 낼 때만 (아니면 None)."""

    five: HitScores
    pads: HitScores | None
    any: HitScores
    pads9: HitScores | None = None
    pedal: PedalConfusion | None = None


def evaluate_hits(hits_true: np.ndarray, hits_pred: np.ndarray, eight_pad: bool) -> HitEvaluation:
    """five·any는 항상, pads·pads9·pedal은 eight_pad가 참이고 예측에 거친 라벨이 없을 때만."""
    pads = pads9 = pedal = None
    if eight_pad and not has_coarse(hits_pred):
        pads = score_hits(hits_true, hits_pred, "pads")
        pads9 = score_hits(hits_true, hits_pred, "pads9")
        pedal = pedal_confusion(hits_true, hits_pred)
    return HitEvaluation(
        five=score_hits(hits_true, hits_pred, "five"),
        pads=pads,
        any=score_hits(hits_true, hits_pred, "any"),
        pads9=pads9,
        pedal=pedal,
    )
