"""채보 보고서 그래프 PNG 3종.

- f1_by_model.png: 정답 드럼(drums) 입력만. 묶음마다 칸 하나, 모델별 5가지 F1·8패드 F1 가로 막대
- separation_effect.png: 입력이 둘 이상인 묶음만. 모델별로 정답 드럼·분리 드럼·원곡 입력의 주 F1 가로 막대
- rtf_vs_f1.png: 정답 드럼 입력만. 묶음마다 칸 하나, RTF(로그 축) 대 주 F1 산점도

입력 3가지 × 분리 모델을 한 그림에 모두 늘어놓으면 막대가 수십 개라 읽을 수 없어 그림을 나눔.
색·글꼴 규칙은 charts.py(분리)와 같음. 색은 모델·입력 이름에 고정(순위로 바꾸지 않음).
값은 막대 끝·점 옆에 직접 적음(대비가 낮은 색 보완).
"""

from __future__ import annotations

import math
from pathlib import Path

import pandas as pd

from ssaplash_ai.bench.report.charts import (
    GRID,
    PALETTE,
    TEXT_PRIMARY,
    TEXT_SECONDARY,
    _finite,
    _style_axis,
    log_axis_ticks,
    setup_fonts,
)

FIVE_COLOR = PALETTE[0]
PADS_COLOR = PALETTE[1]
DRUMS_INPUT = "drums"
RTF_TARGET = 0.15  # 채보 RTF 기준 (-107 지표 정의)


def _datasets(summary: pd.DataFrame) -> list[str]:
    return list(dict.fromkeys(summary["dataset"].astype(str))) if len(summary) else []


def _drums_rows(summary: pd.DataFrame, ds: str) -> pd.DataFrame:
    """묶음의 정답 드럼 입력 행. 없으면(다른 입력만 돌린 경우) 그 묶음 전체."""
    sub = summary[summary["dataset"].astype(str) == ds]
    drums = sub[sub["inputLabel"].astype(str) == DRUMS_INPUT]
    return drums if len(drums) else sub


def _row_label(r: pd.Series) -> str:
    inp = str(r["inputLabel"])
    return str(r["model"]) if inp == DRUMS_INPUT else f"{r['model']} [{inp}]"


def _grid(n: int, cell_w: float, cell_h: float):
    import matplotlib.pyplot as plt

    ncols = 1 if n <= 1 else 2
    nrows = max(1, math.ceil(n / ncols))
    fig, axes = plt.subplots(nrows, ncols, figsize=(cell_w * ncols, cell_h * nrows), squeeze=False)
    flat = list(axes.flat)
    for ax in flat[n:]:
        ax.set_visible(False)
    return fig, flat[:n] if n else flat[:1]


def _value_text(ax, x: float, y: float, value: float, empty: str) -> None:
    text = empty if math.isnan(value) else f"{value:.3f}"
    ax.annotate(
        text,
        (0 if math.isnan(value) else value, y),
        xytext=(4, 0),
        textcoords="offset points",
        ha="left",
        va="center",
        fontsize=7.5,
        color=TEXT_SECONDARY if math.isnan(value) else TEXT_PRIMARY,
    )


def _style_hbar(ax, labels: list[str]) -> None:
    ax.set_yticks(range(len(labels)))
    ax.set_yticklabels(labels, fontsize=8.5, color=TEXT_PRIMARY)
    ax.invert_yaxis()  # 위에서부터 높은 순
    ax.set_xlim(0, 1.12)
    _style_axis(ax)
    ax.yaxis.grid(False)
    ax.xaxis.grid(True, color=GRID, linewidth=0.6)


def _save(fig, out_png: Path) -> Path:
    import matplotlib.pyplot as plt

    fig.tight_layout(rect=(0, 0, 1, 0.95))
    out_png.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_png, dpi=130)
    plt.close(fig)
    return out_png


def plot_f1_bars(summary: pd.DataFrame, out_png: Path) -> Path:
    """정답 드럼 입력의 모델별 5가지 F1·8패드 F1. 묶음마다 칸 하나, 주 F1 높은 순."""
    import matplotlib

    matplotlib.use("Agg")

    setup_fonts()
    datasets = _datasets(summary)
    fig, axes = _grid(len(datasets), 6.2, 0.55 * _max_models(summary, datasets) + 1.4)
    for ax, ds in zip(axes, datasets, strict=False):
        sub = _drums_rows(summary, ds).sort_values("f1Main50", ascending=False, na_position="last")
        labels = [_row_label(r) for _, r in sub.iterrows()]
        five = _finite(sub["f1Five50"].tolist())
        pads = _finite(sub["f1Pads50"].tolist())
        h = 0.38
        for i, (f, p) in enumerate(zip(five, pads, strict=True)):
            ax.barh(i - h / 2, 0 if math.isnan(f) else f, h, color=FIVE_COLOR, edgecolor="white")
            ax.barh(i + h / 2, 0 if math.isnan(p) else p, h, color=PADS_COLOR, edgecolor="white")
            _value_text(ax, f, i - h / 2, f, "—")
            _value_text(ax, p, i + h / 2, p, "8패드 없음")
        _style_hbar(ax, labels)
        ax.set_title(f"{ds} · 정답 드럼 입력", fontsize=9.5, color=TEXT_PRIMARY, loc="left")
    _legend(fig, [(FIVE_COLOR, "5가지 F1"), (PADS_COLOR, "8패드 F1")])
    _title(fig, "채보 모델별 온셋 F1 (±50ms, 묶음 안 타격 수 합산)")
    return _save(fig, out_png)


def _max_models(summary: pd.DataFrame, datasets: list[str]) -> int:
    return max((len(_drums_rows(summary, ds)) for ds in datasets), default=1)


def _input_order(labels: list[str]) -> list[str]:
    """정답 드럼 → 분리 드럼(이름순) → 원곡 → 그 밖."""
    seps = sorted(x for x in labels if x.startswith("separated"))
    rest = sorted(x for x in labels if x not in seps and x not in (DRUMS_INPUT, "mixture"))
    order = [DRUMS_INPUT] if DRUMS_INPUT in labels else []
    return order + seps + (["mixture"] if "mixture" in labels else []) + rest


def plot_separation_effect(summary: pd.DataFrame, out_png: Path) -> Path | None:
    """입력이 둘 이상인 묶음에서 모델별 입력에 따른 주 F1. 해당 묶음이 없으면 그리지 않고 None."""
    import matplotlib

    matplotlib.use("Agg")

    datasets = [
        ds
        for ds in _datasets(summary)
        if summary[summary["dataset"].astype(str) == ds]["inputLabel"].nunique() > 1
    ]
    if not datasets:
        return None
    setup_fonts()
    all_inputs = _input_order(sorted(set(summary["inputLabel"].astype(str))))
    color = {inp: PALETTE[i % len(PALETTE)] for i, inp in enumerate(all_inputs)}
    n_models = max(
        summary[summary["dataset"].astype(str) == ds]["model"].nunique() for ds in datasets
    )
    fig, axes = _grid(len(datasets), 6.2, 1.15 * n_models + 1.4)
    for ax, ds in zip(axes, datasets, strict=False):
        sub = summary[summary["dataset"].astype(str) == ds]
        inputs = [x for x in all_inputs if x in set(sub["inputLabel"].astype(str))]
        base = sub[sub["inputLabel"].astype(str) == DRUMS_INPUT]
        models = list(
            base.sort_values("f1Main50", ascending=False)["model"].astype(str)
            if len(base)
            else dict.fromkeys(sub["model"].astype(str))
        )
        h = 0.8 / len(inputs)
        for i, model in enumerate(models):
            for j, inp in enumerate(inputs):
                hit = sub[(sub["model"].astype(str) == model) & (sub["inputLabel"] == inp)]
                v = _finite(hit["f1Main50"].tolist())[0] if len(hit) else math.nan
                y = i - 0.4 + h * (j + 0.5)
                ax.barh(y, 0 if math.isnan(v) else v, h, color=color[inp], edgecolor="white")
                _value_text(ax, v, y, v, "—")
        _style_hbar(ax, models)
        ax.set_title(f"{ds} · 입력에 따른 주 F1", fontsize=9.5, color=TEXT_PRIMARY, loc="left")
    _legend(fig, [(color[x], _input_name(x)) for x in all_inputs])
    _title(fig, "입력에 따른 주 F1 (8패드, 없으면 5가지)")
    return _save(fig, out_png)


def _input_name(label: str) -> str:
    if label == DRUMS_INPUT:
        return "정답 드럼"
    if label == "mixture":
        return "원곡"
    if label.startswith("separated(") and label.endswith(")"):
        return f"분리 드럼 ({label[len('separated(') : -1]})"
    return label


def _title(fig, text: str) -> None:
    fig.suptitle(text, fontsize=11, color=TEXT_PRIMARY, x=0.01, ha="left")


def _legend(fig, items: list[tuple[str, str]]) -> None:
    from matplotlib.patches import Patch

    fig.legend(
        handles=[Patch(color=c, label=t) for c, t in items],
        loc="upper right",
        ncols=min(len(items), 4),
        fontsize=8.5,
        frameon=False,
        bbox_to_anchor=(1.0, 1.0),
    )


def plot_rtf_vs_f1(summary: pd.DataFrame, out_png: Path) -> Path:
    """정답 드럼 입력의 RTF(로그 축) 대 주 F1. 묶음마다 칸 하나, 점 옆에 모델 이름."""
    import matplotlib

    matplotlib.use("Agg")
    from matplotlib.ticker import FuncFormatter

    setup_fonts()
    datasets = _datasets(summary)
    models = sorted(set(summary["model"].astype(str))) if len(summary) else []
    color = {m: PALETTE[i % len(PALETTE)] for i, m in enumerate(models)}
    all_rtf = [x for x in _finite(summary["rtf"].tolist()) if x > 0] if len(summary) else []
    fig, axes = _grid(len(datasets), 5.6, 4.2)
    for ax, ds in zip(axes, datasets, strict=False):
        sub = _drums_rows(summary, ds)
        placed: list[tuple[float, float]] = []  # 이름이 위에 붙은 점. 가까운 점은 이름을 아래로
        ax.axvline(RTF_TARGET, color=TEXT_SECONDARY, linewidth=1, linestyle=(0, (4, 3)), zorder=1)
        ax.annotate(
            f"기준 {RTF_TARGET:g}",
            (RTF_TARGET, 0.03),
            xytext=(4, 0),
            textcoords="offset points",
            fontsize=7.5,
            color=TEXT_SECONDARY,
        )
        for _, r in sub.sort_values("rtf").iterrows():
            x = _finite([r["rtf"]])[0]
            y = _finite([r["f1Main50"]])[0]
            if math.isnan(x) or math.isnan(y) or x <= 0:
                continue
            close = [
                (px, py)
                for px, py in placed
                if abs(math.log10(x / px)) < 0.35 and abs(y - py) < 0.06
            ]
            # 가까운 점이 있으면 그 점보다 낮을 때 이름을 아래로, 높을 때 위로 더 띄움
            if not close:
                offset = (7, 3)
            elif y < close[0][1]:
                offset = (7, -12)
            else:
                offset = (7, 12)
            placed.append((x, y))
            ax.scatter(
                [x],
                [y],
                s=64,
                color=color[str(r["model"])],
                edgecolor="white",
                linewidth=2,
                zorder=3,
            )
            ax.annotate(
                _row_label(r),
                (x, y),
                xytext=offset,
                textcoords="offset points",
                fontsize=8,
                color=TEXT_PRIMARY,
                bbox={"boxstyle": "round,pad=0.15", "fc": "white", "ec": "none", "alpha": 0.85},
                zorder=4,
            )
        ax.set_xscale("log")
        if all_rtf:
            ax.set_xlim(min(all_rtf) / 1.6, max(all_rtf) * 3.0)
            ax.set_xticks(log_axis_ticks(all_rtf))
        ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:g}"))
        ax.xaxis.set_minor_formatter(FuncFormatter(lambda v, _: ""))
        ax.set_xlabel(
            "RTF (채보 시간 ÷ 곡 길이, 로그 축, 왼쪽이 빠름)", color=TEXT_SECONDARY, fontsize=8.5
        )
        ax.set_ylabel("주 F1 (8패드, 없으면 5가지)", color=TEXT_SECONDARY, fontsize=8.5)
        ax.set_ylim(0, 1.05)
        ax.set_title(f"{ds} · 정답 드럼 입력", fontsize=9.5, color=TEXT_PRIMARY, loc="left")
        _style_axis(ax)
        ax.xaxis.grid(True, color=GRID, linewidth=0.6)
    _title(fig, "속도 대 품질")
    return _save(fig, out_png)
