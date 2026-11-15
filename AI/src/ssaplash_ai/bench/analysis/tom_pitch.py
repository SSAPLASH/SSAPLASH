"""정답 탐 타격의 음높이 분석과 고정 경계 후보.

저장 특징의 toms 트랙에서 정답 탐 타격(SMALL_TOM·MID_TOM·FLOOR_TOM) 직후 구간의 음높이(스펙트럼 최대 피크,
규칙 함수 tom_f0_at 그대로)를 뽑아
- 데이터셋별·탐별 분포(중앙값·사분위), 곡별 중앙값의 편차(드럼 세트마다 얼마나 다른지)
- 고정 경계 후보: 현재값, 묶음 하나에 맞춘 값, 여러 묶음 절충값. 경계 둘(lo < hi)을 격자로 훑어
  "정답 음높이를 경계로 나눴을 때 정답 탐과 같은 비율"(bandAcc)이 가장 높은 쌍
- 과적합 확인: 곡 하나 빼고 맞춘 뒤 뺀 곡에서 재기(leave-one-song-out)
를 냄. 결과는 CSV·md 표·그림과 rule-eval에 바로 넣을 후보 yaml.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

from ssaplash_ai.bench.analysis.rule_eval import NONE_LABEL, TOM_PADS, load_dataset_songs
from ssaplash_ai.bench.analysis.rule_features import RuleFeatures
from ssaplash_ai.bench.metrics.hit_f1 import WINDOW_SEC
from ssaplash_ai.bench.runner.run_support import Logger
from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import (
    ADTOF_TOM,
    rules_with_defaults,
    tom_f0_at,
    tom_gate_ratios,
    tom_pad,
)

PAD_ORDER: tuple[str, ...] = ("FLOOR_TOM", "MID_TOM", "SMALL_TOM")  # 음높이 낮은 순
# 거르기 문턱값 후보. 문턱값마다 버려지는 정답 탐·정답 없는 탐 수를 셈
GATE_THRESHOLDS: tuple[float, ...] = (0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5)
PRED_COLUMNS = [
    "dataset",
    "songId",
    "timeSec",
    "f0",
    "gateRatio",
    "truePad",
    "nearestPad",
    "nearestMs",
]


def true_tom_f0(
    features: RuleFeatures, hits_true: np.ndarray, rules: dict
) -> list[tuple[str, float, float]]:
    """정답 탐 타격마다 (패드, 시각, 음높이 Hz). 무음 구간이면 nan."""
    r = rules_with_defaults(rules)
    toms = features.stems.get(r["stems"]["toms"])
    if toms is None:
        raise KeyError(f"특징에 toms 트랙이 없음 (있는 것: {sorted(features.stems)})")
    out = []
    for row in hits_true[np.isin(hits_true["pad"], list(TOM_PADS))]:
        t = float(row["time_sec"])
        out.append((str(row["pad"]), t, tom_f0_at(toms, features.sample_rate, t, r)))
    return out


def collect_true_tom_f0(
    dataset_name: str,
    songs: Sequence[tuple[str, RuleFeatures, np.ndarray]],
    rules: dict | None = None,
) -> pd.DataFrame:
    """곡 목록 → 표(dataset, songId, pad, timeSec, f0)."""
    rows = []
    for song_id, features, hits_true in songs:
        for pad, t, f0 in true_tom_f0(features, hits_true, rules or {}):
            rows.append(
                {"dataset": dataset_name, "songId": song_id, "pad": pad, "timeSec": t, "f0": f0}
            )
    return pd.DataFrame(rows, columns=["dataset", "songId", "pad", "timeSec", "f0"])


# ---------- 경계 후보 ----------


def band_accuracy(f0: np.ndarray, pads: Sequence[str], bands: Sequence[float]) -> float:
    """음높이를 경계로 나눠 붙인 탐이 정답 탐과 같은 비율. nan 음높이는 뺌."""
    f0 = np.asarray(f0, dtype=np.float64)
    pads = np.asarray(list(pads))
    ok = ~np.isnan(f0)
    if not np.any(ok):
        return math.nan
    pred = np.array([tom_pad(float(v), bands) for v in f0[ok]])
    return float(np.mean(pred == pads[ok]))


def _acc_grid(f0: np.ndarray, pads: Sequence[str], los: np.ndarray, his: np.ndarray) -> np.ndarray:
    """(lo, hi) 격자 전체의 bandAcc. nan 음높이는 뺌. 벡터 연산으로 한 번에."""
    f0 = np.asarray(f0, dtype=np.float64)
    pads = np.asarray(list(pads))
    ok = ~np.isnan(f0)
    f0, pads = f0[ok], pads[ok]
    if f0.size == 0:
        return np.full((len(los), len(his)), math.nan)
    # 타격마다 경계 lo·hi에 대해 어느 패드가 되는지: f0 < lo → FLOOR, f0 < hi → MID, 그 외 SMALL
    below_lo = f0[None, :] < los[:, None]  # (lo, n)
    below_hi = f0[None, :] < his[:, None]  # (hi, n)
    is_floor = pads == "FLOOR_TOM"
    is_mid = pads == "MID_TOM"
    is_small = pads == "SMALL_TOM"
    # 맞힌 수 = FLOOR이면서 f0<lo + MID이면서 lo<=f0<hi + SMALL이면서 f0>=hi
    floor_hit = (below_lo & is_floor[None, :]).sum(axis=1)  # (lo,)
    small_hit = (~below_hi & is_small[None, :]).sum(axis=1)  # (hi,)
    mid_below_hi = (below_hi & is_mid[None, :]).astype(np.int64)  # (hi, n)
    mid_below_lo = (below_lo & is_mid[None, :]).astype(np.int64)  # (lo, n)
    mid_hit = mid_below_hi.sum(axis=1)[None, :] - mid_below_lo.sum(axis=1)[:, None]  # (lo, hi)
    total = floor_hit[:, None] + small_hit[None, :] + mid_hit
    acc = total / f0.size
    invalid = los[:, None] >= his[None, :]
    return np.where(invalid, -1.0, acc)


def search_bands(
    tables: Sequence[pd.DataFrame],
    weights: Sequence[float] | None = None,
    lo_range: tuple[float, float] = (60.0, 300.0),
    step: float = 1.0,
) -> tuple[list[float], float]:
    """표 여러 개(데이터셋별)의 bandAcc 가중 평균이 가장 높은 경계 (lo, hi). 동률이면 지금 값과 가깝지 않아도 lo·hi가 작은 쪽.

    반환: ([lo, hi], 가중 평균 bandAcc)
    """
    grid = np.arange(lo_range[0], lo_range[1] + step / 2, step, dtype=np.float64)
    weights = list(weights) if weights is not None else [1.0] * len(tables)
    total = np.zeros((len(grid), len(grid)))
    wsum = 0.0
    for table, w in zip(tables, weights, strict=True):
        if table.empty:
            continue
        acc = _acc_grid(table["f0"].to_numpy(), table["pad"].tolist(), grid, grid)
        total += w * np.where(acc < 0, -1e9, acc)
        wsum += w
    if wsum == 0:
        return [math.nan, math.nan], math.nan
    mean = total / wsum
    idx = int(np.argmax(mean))
    i, j = divmod(idx, len(grid))
    return [float(grid[i]), float(grid[j])], float(mean[i, j])


def leave_one_song_out(
    table: pd.DataFrame, lo_range=(60.0, 300.0), step: float = 1.0
) -> pd.DataFrame:
    """곡 하나 빼고 경계를 맞춘 뒤 뺀 곡에서 bandAcc. 표(songId, nHits, lo, hi, acc)."""
    rows = []
    for song_id, part in table.groupby("songId", sort=True):
        rest = table[table["songId"] != song_id]
        bands, _ = search_bands([rest], lo_range=lo_range, step=step)
        acc = band_accuracy(part["f0"].to_numpy(), part["pad"].tolist(), bands)
        rows.append(
            {"songId": song_id, "nHits": int(len(part)), "lo": bands[0], "hi": bands[1], "acc": acc}
        )
    return pd.DataFrame(rows, columns=["songId", "nHits", "lo", "hi", "acc"])


# ---------- 예측 탐 분석: 거르기 비율·근처 정답 ----------


def predicted_tom_table(
    dataset_name: str,
    songs: Sequence[tuple[str, RuleFeatures, np.ndarray]],
    rules: dict | None = None,
    window_sec: float = WINDOW_SEC,
) -> pd.DataFrame:
    """ADTOF가 탐으로 잡은 타격마다 음높이·거르기 비율·짝지은 정답 탐·근처 정답 패드.

    열: dataset, songId, timeSec, f0(Hz), gateRatio(toms 트랙 에너지 / 입력 드럼 에너지. 입력이 없으면 nan),
    truePad(window_sec 안에 짝지은 정답 탐 패드, 없으면 (없음)), nearestPad(정답 전체 중 가장 가까운 패드,
    window_sec 밖이면 (없음)), nearestMs.
    """
    import mir_eval

    r = rules_with_defaults(rules)
    gate_window = r["tom_gate_window_ms"] if r.get("tom_gate_window_ms") else r["window_ms"]
    rows = []
    for song_id, features, hits_true in songs:
        times = [float(t) for t in features.peaks_as_lists().get(ADTOF_TOM, [])]
        if not times:
            continue
        sr = features.sample_rate
        toms = features.stems.get(r["stems"]["toms"])
        f0 = [tom_f0_at(toms, sr, t, r) for t in times]
        if features.input_audio is not None:
            ratios = tom_gate_ratios(times, toms, features.input_audio, sr, gate_window)
        else:
            ratios = np.full(len(times), math.nan)
        tom_truth = hits_true[np.isin(hits_true["pad"], list(TOM_PADS))]
        pairs = mir_eval.util.match_events(
            np.asarray(tom_truth["time_sec"], dtype=np.float64),
            np.asarray(times, dtype=np.float64),
            window_sec,
        )
        true_pad = {j: str(tom_truth["pad"][i]) for i, j in pairs}
        all_times = np.asarray(hits_true["time_sec"], dtype=np.float64)
        for j, t in enumerate(times):
            nearest, nearest_ms = NONE_LABEL, math.nan
            if all_times.size:
                k = int(np.argmin(np.abs(all_times - t)))
                dist = float(abs(all_times[k] - t))
                nearest_ms = dist * 1000
                if dist <= window_sec:
                    nearest = str(hits_true["pad"][k])
            rows.append(
                {
                    "dataset": dataset_name,
                    "songId": song_id,
                    "timeSec": t,
                    "f0": f0[j],
                    "gateRatio": float(ratios[j]),
                    "truePad": true_pad.get(j, NONE_LABEL),
                    "nearestPad": nearest,
                    "nearestMs": nearest_ms,
                }
            )
    return pd.DataFrame(rows, columns=PRED_COLUMNS)


def _split_pred(part: pd.DataFrame) -> list[tuple[str, pd.DataFrame]]:
    return [
        ("정답 탐", part[part["truePad"] != NONE_LABEL]),
        ("정답 없음", part[part["truePad"] == NONE_LABEL]),
    ]


def gate_ratio_stats(pred: pd.DataFrame) -> pd.DataFrame:
    """데이터셋 × (정답 탐 / 정답 없음): 타격 수와 거르기 비율의 10·25·50·75·90 백분위."""
    rows = []
    for ds, part in pred.groupby("dataset", sort=False):
        for kind, sub in _split_pred(part):
            v = sub["gateRatio"].dropna()
            q = v.quantile([0.1, 0.25, 0.5, 0.75, 0.9]) if len(v) else None
            rows.append(
                {
                    "dataset": ds,
                    "kind": kind,
                    "nHits": int(len(sub)),
                    "p10": float(q.iloc[0]) if q is not None else math.nan,
                    "p25": float(q.iloc[1]) if q is not None else math.nan,
                    "median": float(q.iloc[2]) if q is not None else math.nan,
                    "p75": float(q.iloc[3]) if q is not None else math.nan,
                    "p90": float(q.iloc[4]) if q is not None else math.nan,
                }
            )
    return pd.DataFrame(
        rows, columns=["dataset", "kind", "nHits", "p10", "p25", "median", "p75", "p90"]
    )


def gate_sweep(pred: pd.DataFrame, thresholds: Sequence[float] = GATE_THRESHOLDS) -> pd.DataFrame:
    """문턱값마다 데이터셋별로 버려지는 정답 탐 수와 정답 없는 탐 수."""
    rows = []
    for ds, part in pred.groupby("dataset", sort=False):
        (_, matched), (_, none) = _split_pred(part)
        m = matched["gateRatio"].dropna()
        n = none["gateRatio"].dropna()
        for th in thresholds:
            rows.append(
                {
                    "dataset": ds,
                    "threshold": float(th),
                    "trueDropped": int((m < th).sum()),
                    "trueTotal": int(len(m)),
                    "falseDropped": int((n < th).sum()),
                    "falseTotal": int(len(n)),
                }
            )
    return pd.DataFrame(
        rows,
        columns=["dataset", "threshold", "trueDropped", "trueTotal", "falseDropped", "falseTotal"],
    )


def false_tom_nearest(pred: pd.DataFrame) -> pd.DataFrame:
    """정답 없는 탐이 실제로 무슨 소리 근처였는지: 데이터셋 × 가장 가까운 정답 패드 개수."""
    part = pred[pred["truePad"] == NONE_LABEL]
    if part.empty:
        return pd.DataFrame(columns=["dataset", "nearestPad", "count"])
    out = part.groupby(["dataset", "nearestPad"], sort=False).size().reset_index(name="count")
    return out.sort_values(["dataset", "count"], ascending=[True, False]).reset_index(drop=True)


def plot_gate_ratio(pred: pd.DataFrame, out_png: Path) -> Path:
    """데이터셋별 거르기 비율 히스토그램. 정답 탐과 정답 없는 탐을 겹쳐 그림."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    datasets = list(dict.fromkeys(pred["dataset"].tolist()))
    fig, axes = plt.subplots(1, max(len(datasets), 1), figsize=(5 * max(len(datasets), 1), 4))
    axes = np.atleast_1d(axes)
    bins = np.linspace(0.0, 1.0, 21)
    # 범례는 영어 (기본 글꼴에 한글이 없음. 표는 summary.md에 한글로)
    legend = {"정답 탐": "true tom", "정답 없음": "no truth"}
    for ax, ds in zip(axes, datasets, strict=False):
        part = pred[pred["dataset"] == ds]
        for kind, sub in _split_pred(part):
            v = sub["gateRatio"].dropna().clip(0.0, 1.0)
            ax.hist(v, bins=bins, alpha=0.5, label=f"{legend.get(kind, kind)} (n={len(v)})")
        ax.set_title(ds)
        ax.set_xlabel("toms energy / input energy")
        ax.set_ylabel("hits")
        ax.legend(fontsize=8)
        ax.grid(alpha=0.3)
    fig.tight_layout()
    out_png.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_png, dpi=120)
    plt.close(fig)
    return out_png


# ---------- 통계·출력 ----------


def pitch_stats(table: pd.DataFrame) -> pd.DataFrame:
    """데이터셋 × 패드: 타격 수, 무음(nan) 수, 중앙값, 사분위, 곡별 중앙값의 표준편차·범위."""
    rows = []
    for (ds, pad), part in table.groupby(["dataset", "pad"], sort=False):
        f0 = part["f0"].dropna()
        by_song = part.dropna(subset=["f0"]).groupby("songId")["f0"].median()
        rows.append(
            {
                "dataset": ds,
                "pad": pad,
                "nHits": int(len(part)),
                "nNan": int(part["f0"].isna().sum()),
                "median": float(f0.median()) if len(f0) else math.nan,
                "q1": float(f0.quantile(0.25)) if len(f0) else math.nan,
                "q3": float(f0.quantile(0.75)) if len(f0) else math.nan,
                "nSongs": int(len(by_song)),
                "songMedianStd": float(by_song.std(ddof=0)) if len(by_song) > 1 else math.nan,
                "songMedianMin": float(by_song.min()) if len(by_song) else math.nan,
                "songMedianMax": float(by_song.max()) if len(by_song) else math.nan,
            }
        )
    out = pd.DataFrame(rows)
    if out.empty:
        return out
    out["padOrder"] = out["pad"].map({p: i for i, p in enumerate(PAD_ORDER)})
    return out.sort_values(["dataset", "padOrder"]).drop(columns="padOrder").reset_index(drop=True)


def _fmt(v: object) -> str:
    if isinstance(v, float):
        return "—" if math.isnan(v) else (f"{v:.3f}" if abs(v) < 2 else f"{v:.1f}")
    return str(v)


def _md(df: pd.DataFrame, cols: Sequence[str]) -> str:
    lines = ["| " + " | ".join(cols) + " |", "| " + " | ".join("---" for _ in cols) + " |"]
    for _, r in df.iterrows():
        lines.append("| " + " | ".join(_fmt(r[c]) for c in cols) + " |")
    return "\n".join(lines)


@dataclass
class TomPitchOptions:
    features_root: Path
    dataset_configs: Sequence[Path]
    out_dir: Path
    rules: dict = field(default_factory=dict)  # window_ms·tom_fmin·tom_fmax. 비우면 기본값
    current_bands: Sequence[float] = (113.0, 142.0)
    lo_range: tuple[float, float] = (60.0, 300.0)
    step: float = 1.0
    loo_dataset: str | None = None  # 곡 하나 빼고 확인할 데이터셋 이름. None이면 첫 번째


@dataclass
class TomPitchResult:
    table: pd.DataFrame
    stats: pd.DataFrame
    candidates: list[dict]
    loo: pd.DataFrame
    out_dir: Path
    files: list[Path] = field(default_factory=list)
    pred: pd.DataFrame = field(default_factory=pd.DataFrame)  # 예측 탐 표


def plot_distribution(
    table: pd.DataFrame, bands_by_name: dict[str, Sequence[float]], out_png: Path
) -> Path:
    """데이터셋별로 탐 3종 음높이 분포(상자 + 점)와 경계선."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    datasets = list(dict.fromkeys(table["dataset"].tolist()))
    fig, axes = plt.subplots(
        1, max(len(datasets), 1), figsize=(5 * max(len(datasets), 1), 4.5), sharey=True
    )
    axes = np.atleast_1d(axes)
    rng = np.random.default_rng(0)
    for ax, ds in zip(axes, datasets, strict=False):
        part = table[(table["dataset"] == ds)].dropna(subset=["f0"])
        data = [part[part["pad"] == p]["f0"].to_numpy() for p in PAD_ORDER]
        ax.boxplot(data, positions=range(len(PAD_ORDER)), widths=0.5, showfliers=False)
        for i, d in enumerate(data):
            ax.scatter(i + rng.uniform(-0.18, 0.18, len(d)), d, s=6, alpha=0.35)
        for k, (name, (lo, hi)) in enumerate(bands_by_name.items()):
            color = f"C{(k + 3) % 10}"
            ax.axhline(
                lo, ls="--", lw=0.9, alpha=0.8, color=color, label=f"{name} {lo:.0f}·{hi:.0f}"
            )
            ax.axhline(hi, ls="--", lw=0.9, alpha=0.8, color=color)
        if bands_by_name:
            ax.legend(fontsize=7, loc="upper left")
        ax.set_xticks(range(len(PAD_ORDER)))
        ax.set_xticklabels(["floor", "mid", "small"])
        ax.set_title(f"{ds} (n={len(part)})")
        ax.set_ylabel("f0 (Hz)")
        ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    out_png.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_png, dpi=120)
    plt.close(fig)
    return out_png


def run_tom_pitch(opts: TomPitchOptions, log: Logger = print) -> TomPitchResult:
    datasets = [load_dataset_songs(p, Path(opts.features_root), log) for p in opts.dataset_configs]
    tables = [collect_true_tom_f0(name, songs, opts.rules) for name, songs in datasets]
    table = pd.concat(tables, ignore_index=True) if tables else pd.DataFrame()
    out_dir = Path(opts.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    files: list[Path] = []

    stats = pitch_stats(table)
    current = [float(b) for b in opts.current_bands]
    candidates: list[dict] = []

    def add(name: str, bands: Sequence[float], note: str) -> None:
        row = {"name": name, "lo": float(bands[0]), "hi": float(bands[1]), "note": note}
        for t in tables:
            ds = t["dataset"].iloc[0] if not t.empty else "?"
            row[f"acc_{ds}"] = band_accuracy(t["f0"].to_numpy(), t["pad"].tolist(), bands)
        candidates.append(row)

    add("current", current, "지금 기본값")
    for t in tables:
        if t.empty:
            continue
        ds = t["dataset"].iloc[0]
        bands, acc = search_bands([t], lo_range=opts.lo_range, step=opts.step)
        add(f"fit_{ds}", bands, f"{ds}에만 맞춤 (bandAcc {acc:.3f})")
    if len(tables) > 1:
        bands, acc = search_bands(tables, lo_range=opts.lo_range, step=opts.step)
        add("fit_all", bands, f"묶음 전부 같은 비중으로 절충 (평균 bandAcc {acc:.3f})")

    loo_name = opts.loo_dataset or (
        tables[0]["dataset"].iloc[0] if tables and not tables[0].empty else None
    )
    loo = pd.DataFrame()
    if loo_name is not None:
        loo_table = table[table["dataset"] == loo_name]
        loo = leave_one_song_out(loo_table, opts.lo_range, opts.step)
        log(f"[tom-pitch] {loo_name} 곡 하나 빼고 확인: 평균 bandAcc {loo['acc'].mean():.3f}")

    pred_tables = [predicted_tom_table(name, songs, opts.rules) for name, songs in datasets]
    pred = pd.concat(pred_tables, ignore_index=True) if pred_tables else pd.DataFrame()
    gate_stats = gate_ratio_stats(pred) if not pred.empty else pd.DataFrame()
    sweep = gate_sweep(pred) if not pred.empty else pd.DataFrame()
    nearest = false_tom_nearest(pred) if not pred.empty else pd.DataFrame()
    if not pred.empty:
        n_matched = int((pred["truePad"] != NONE_LABEL).sum())
        log(
            f"[tom-pitch] 예측 탐 {len(pred)}개: 정답 탐과 짝 {n_matched}, 정답 없음 {len(pred) - n_matched}"
        )

    csv_path = out_dir / "tom_f0.csv"
    table.to_csv(csv_path, index=False)
    files.append(csv_path)
    pred_path = out_dir / "pred_tom.csv"
    pred.to_csv(pred_path, index=False)
    files.append(pred_path)
    if not pred.empty and pred["gateRatio"].notna().any():
        files.append(plot_gate_ratio(pred, out_dir / "tom_gate_ratio.png"))
    stats_path = out_dir / "tom_f0_stats.csv"
    stats.to_csv(stats_path, index=False)
    files.append(stats_path)
    loo_path = out_dir / "leave_one_song_out.csv"
    loo.to_csv(loo_path, index=False)
    files.append(loo_path)
    cand_yaml = out_dir / "candidates.yaml"
    cand_yaml.write_text(
        yaml.safe_dump(
            {
                "candidates": [
                    {"name": c["name"], "rules": {"tom_bands": [c["lo"], c["hi"]]}}
                    for c in candidates
                ]
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    files.append(cand_yaml)
    png = plot_distribution(
        table,
        {c["name"]: (c["lo"], c["hi"]) for c in candidates},
        out_dir / "tom_f0_distribution.png",
    )
    files.append(png)

    acc_cols = [c for c in candidates[0] if c.startswith("acc_")] if candidates else []
    md = ["# 정답 탐 음높이 분석", ""]
    md.append(
        f"규칙: 창 {rules_with_defaults(opts.rules)['window_ms']}ms, 범위 {rules_with_defaults(opts.rules)['tom_fmin']}~{rules_with_defaults(opts.rules)['tom_fmax']}Hz, 경계 탐색 {opts.lo_range[0]}~{opts.lo_range[1]}Hz 간격 {opts.step}"
    )
    md.append("")
    md.append("## 데이터셋 × 탐별 음높이")
    md.append("")
    md.append(
        _md(
            stats,
            [
                "dataset",
                "pad",
                "nHits",
                "nNan",
                "median",
                "q1",
                "q3",
                "nSongs",
                "songMedianStd",
                "songMedianMin",
                "songMedianMax",
            ],
        )
    )
    md.append("")
    md.append(
        "median·q1·q3는 타격 전체의 Hz. songMedian*는 곡별 중앙값의 표준편차·최소·최대(드럼 세트마다 얼마나 다른지)."
    )
    md.append("")
    md.append("## 경계 후보")
    md.append("")
    md.append(_md(pd.DataFrame(candidates), ["name", "lo", "hi", *acc_cols, "note"]))
    md.append("")
    md.append(
        "acc_*는 정답 음높이를 그 경계로 나눴을 때 정답 탐과 같은 비율(bandAcc). 실제 F1은 rule-eval로 다시 잼."
    )
    if not loo.empty:
        md.append("")
        md.append(f"## 곡 하나 빼고 확인 ({loo_name})")
        md.append("")
        md.append(
            f"평균 bandAcc {loo['acc'].mean():.3f} (곡 {len(loo)}개). 곡마다 뺀 뒤 나머지로 맞춘 경계와 그 곡의 점수:"
        )
        md.append("")
        md.append(_md(loo, ["songId", "nHits", "lo", "hi", "acc"]))
    if not pred.empty:
        md.append("")
        md.append("## 예측 탐의 거르기 비율과 근처 정답 (S15P31A307-164)")
        md.append("")
        md.append(
            "ADTOF가 탐으로 잡은 타격마다 toms 트랙 에너지 / 입력 드럼 에너지(거르기 비율)를 재고 50ms 안의 정답 탐과 짝지음. "
            "정답 탐과 짝이 없는 타격은 가장 가까운 정답 패드를 적음."
        )
        md.append("")
        md.append(
            _md(gate_stats, ["dataset", "kind", "nHits", "p10", "p25", "median", "p75", "p90"])
        )
        md.append("")
        md.append("문턱값별로 버려지는 타격 수 (정답 탐 / 정답 없음)")
        md.append("")
        md.append(
            _md(
                sweep,
                ["dataset", "threshold", "trueDropped", "trueTotal", "falseDropped", "falseTotal"],
            )
        )
        md.append("")
        md.append("정답 없는 탐이 실제로 무슨 소리 근처였는지 (50ms 안 가장 가까운 정답 패드)")
        md.append("")
        md.append(_md(nearest, ["dataset", "nearestPad", "count"]))
    md_path = out_dir / "summary.md"
    md_path.write_text("\n".join(md) + "\n", encoding="utf-8")
    files.append(md_path)
    log(f"[tom-pitch] 결과 → {md_path}")
    return TomPitchResult(table, stats, candidates, loo, out_dir, files, pred)


__all__ = [
    "GATE_THRESHOLDS",
    "PAD_ORDER",
    "TomPitchOptions",
    "TomPitchResult",
    "band_accuracy",
    "collect_true_tom_f0",
    "false_tom_nearest",
    "gate_ratio_stats",
    "gate_sweep",
    "leave_one_song_out",
    "pitch_stats",
    "plot_distribution",
    "plot_gate_ratio",
    "predicted_tom_table",
    "run_tom_pitch",
    "search_bands",
    "true_tom_f0",
]
