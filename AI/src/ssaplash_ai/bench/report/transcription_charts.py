"""채보 보고서 그래프 PNG 2종. 묶음별 모델 F1 막대(5가지·8패드)와 RTF 대 주 F1 산점도.

색·글꼴 규칙은 charts.py(분리)와 같음. 막대 라벨은 "모델 [입력]".
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


def _bar_labels(sub: pd.DataFrame) -> list[str]:
    return [
        f"{m}\n[{i}]" if i != "drums" else str(m)
        for m, i in zip(sub["model"], sub["inputLabel"], strict=True)
    ]


def plot_f1_bars(summary: pd.DataFrame, out_png: Path) -> Path:
    """묶음마다 축 하나. 모델(입력)별로 5가지 F1·8패드 F1 막대 두 개. 8패드가 없으면 한 개."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    setup_fonts()
    datasets = list(dict.fromkeys(summary["dataset"].astype(str))) if len(summary) else []
    n = max(len(datasets), 1)
    fig, axes = plt.subplots(n, 1, figsize=(max(7, 1.2 * len(summary) + 3), 3.6 * n), squeeze=False)
    for ax, ds in zip(axes[:, 0], datasets or [""], strict=False):
        sub = summary[summary["dataset"].astype(str) == ds] if ds else summary
        labels = _bar_labels(sub)
        x = np.arange(len(sub))
        five = _finite(sub["f1Five50"].tolist())
        pads = _finite(sub["f1Pads50"].tolist())
        width = 0.38
        b1 = ax.bar(
            x - width / 2,
            [0 if math.isnan(v) else v for v in five],
            width,
            color=FIVE_COLOR,
            label="5가지 F1",
        )
        b2 = ax.bar(
            x + width / 2,
            [0 if math.isnan(v) else v for v in pads],
            width,
            color=PADS_COLOR,
            label="8패드 F1",
        )
        for bars, values in ((b1, five), (b2, pads)):
            for bar, v in zip(bars, values, strict=True):
                ax.annotate(
                    "—" if math.isnan(v) else f"{v:.3f}",
                    (bar.get_x() + bar.get_width() / 2, bar.get_height()),
                    xytext=(0, 3),
                    textcoords="offset points",
                    ha="center",
                    va="bottom",
                    fontsize=7,
                    color=TEXT_PRIMARY,
                )
        ax.set_xticks(x)
        ax.set_xticklabels(labels, fontsize=8)
        ax.set_ylim(0, 1.08)
        ax.set_title(f"{ds} 온셋 F1 (±50ms, 묶음 합산)", fontsize=9, color=TEXT_PRIMARY)
        ax.legend(fontsize=8, frameon=False)
        _style_axis(ax)
    fig.suptitle("채보 모델별 F1", fontsize=11, color=TEXT_PRIMARY)
    fig.tight_layout()
    out_png.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_png, dpi=130)
    plt.close(fig)
    return out_png


def plot_rtf_vs_f1(summary: pd.DataFrame, out_png: Path) -> Path:
    """RTF(로그 축) 대 주 F1(8패드가 있으면 8패드, 없으면 5가지) 산점도. 점마다 모델 이름."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.ticker import FuncFormatter

    setup_fonts()
    fig, ax = plt.subplots(figsize=(7, 5))
    rtf = _finite(summary["rtf"].tolist()) if "rtf" in summary else []
    f1 = _finite(summary["f1Main50"].tolist()) if "f1Main50" in summary else []
    labels = _bar_labels(summary) if len(summary) else []
    for i, (label, x, y) in enumerate(zip(labels, rtf, f1, strict=True)):
        if math.isnan(x) or math.isnan(y) or x <= 0:
            continue
        ax.scatter(
            [x],
            [y],
            s=60,
            color=PALETTE[i % len(PALETTE)],
            edgecolor="white",
            linewidth=1.5,
            zorder=3,
        )
        ax.annotate(
            label.replace("\n", " "),
            (x, y),
            xytext=(6, 4),
            textcoords="offset points",
            fontsize=8,
            color=TEXT_PRIMARY,
        )
    ax.set_xscale("log")
    ax.set_xticks(log_axis_ticks([x for x in rtf if x > 0]))
    ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:g}"))
    ax.xaxis.set_minor_formatter(FuncFormatter(lambda v, _: ""))
    ax.set_xlabel(
        "RTF (채보 시간 / 곡 길이, 로그 축, 낮을수록 빠름)", color=TEXT_SECONDARY, fontsize=9
    )
    ax.set_ylabel("주 F1 (8패드, 없으면 5가지. 높을수록 좋음)", color=TEXT_SECONDARY, fontsize=9)
    ax.set_ylim(0, 1.05)
    ax.set_title("속도 대 품질", fontsize=11, color=TEXT_PRIMARY)
    _style_axis(ax)
    ax.xaxis.grid(True, color=GRID, linewidth=0.6)
    fig.tight_layout()
    out_png.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_png, dpi=130)
    plt.close(fig)
    return out_png
