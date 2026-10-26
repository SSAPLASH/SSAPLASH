"""그래프 PNG 2종. 모델별 지표 막대(COMPARISON_METRICS 6개)와 RTF 대 드럼 SDR 산점도.

색은 dataviz 기본 팔레트(검증된 범주형 8색)를 모델 순서대로 고정 배정하고 순환하지 않음.
글꼴은 설치된 한글 글꼴을 찾아 씀 (코랩은 노트북이 fonts-nanum 설치).
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from pathlib import Path

import pandas as pd

from ssaplash_ai.bench.report.summary_table import COMPARISON_METRICS

PALETTE = ("#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948")
TEXT_PRIMARY = "#0b0b0b"
TEXT_SECONDARY = "#52514e"
GRID = "#e4e3df"
# 한글 제목용 글꼴 후보. 앞에서부터 설치된 것을 씀. 코랩은 노트북이 fonts-nanum을 설치.
KOREAN_FONTS = ("Malgun Gothic", "NanumGothic", "Noto Sans CJK KR", "Noto Sans KR", "AppleGothic")


def _finite(values: Sequence[float]) -> list[float]:
    return [
        float(v) if isinstance(v, int | float) and math.isfinite(float(v)) else math.nan
        for v in values
    ]


def setup_fonts() -> str | None:
    """설치된 한글 글꼴을 matplotlib 기본으로. 없으면 None (제목이 네모로 나옴)."""
    import matplotlib
    from matplotlib import font_manager

    installed = {f.name for f in font_manager.fontManager.ttflist}
    for name in KOREAN_FONTS:
        if name in installed:
            matplotlib.rcParams["font.family"] = name
            matplotlib.rcParams["axes.unicode_minus"] = False
            return name
    return None


def _style_axis(ax) -> None:
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GRID)
    ax.tick_params(colors=TEXT_SECONDARY, labelsize=8)
    ax.yaxis.grid(True, color=GRID, linewidth=0.6)
    ax.set_axisbelow(True)


def plot_metric_bars(summary: pd.DataFrame, out_png: Path) -> Path:
    """비교 지표 6개 × 모델 막대. 지표마다 축 하나, 모델 색은 고정 배정. 값은 막대 위에 직접 표기."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    setup_fonts()
    models = list(summary["model"])
    colors = [PALETTE[i % len(PALETTE)] for i in range(len(models))]
    fig, axes = plt.subplots(2, 3, figsize=(13, 7.5))
    for ax, (col, title, higher_better) in zip(axes.ravel(), COMPARISON_METRICS, strict=True):
        values = _finite(summary[col].tolist()) if col in summary else [math.nan] * len(models)
        bars = ax.bar(models, [0 if math.isnan(v) else v for v in values], color=colors, width=0.6)
        for bar, v in zip(bars, values, strict=True):
            label = "—" if math.isnan(v) else (f"{v:.3f}" if abs(v) < 1 else f"{v:.2f}")
            ax.annotate(
                label,
                (bar.get_x() + bar.get_width() / 2, bar.get_height()),
                xytext=(0, 3),
                textcoords="offset points",
                ha="center",
                va="bottom",
                fontsize=8,
                color=TEXT_PRIMARY,
            )
        ax.set_title(
            f"{title} ({'높을수록 좋음' if higher_better else '낮을수록 좋음'})",
            fontsize=9,
            color=TEXT_PRIMARY,
        )
        ax.tick_params(axis="x", rotation=30)
        _style_axis(ax)
    fig.suptitle("모델별 지표 (곡 중앙값)", fontsize=11, color=TEXT_PRIMARY)
    fig.tight_layout()
    out_png.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_png, dpi=130)
    plt.close(fig)
    return out_png


LOG_TICK_STEPS: tuple[float, ...] = (1.0, 2.0, 3.0, 5.0)


def log_axis_ticks(values: Sequence[float], steps: Sequence[float] = LOG_TICK_STEPS) -> list[float]:
    """로그 축에 찍을 눈금. 각 자릿수의 1·2·3·5배 중 데이터 범위(양끝 20% 여유)에 드는 값.

    값이 없거나 전부 nan·0 이하이면 빈 목록 (matplotlib 기본 눈금 유지).
    """
    finite = [v for v in values if isinstance(v, int | float) and math.isfinite(v) and v > 0]
    if not finite:
        return []
    lo, hi = min(finite) / 1.2, max(finite) * 1.2
    ticks: list[float] = []
    exp = math.floor(math.log10(lo))
    while 10.0**exp <= hi:
        for s in steps:
            v = s * 10.0**exp
            if lo <= v <= hi:
                ticks.append(round(v, 10))
        exp += 1
    return ticks


def plot_rtf_vs_sdr(summary: pd.DataFrame, out_png: Path) -> Path:
    """RTF(로그 축) 대 드럼 SDR 산점도. 점마다 모델 이름을 직접 표기."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.ticker import FuncFormatter

    setup_fonts()
    fig, ax = plt.subplots(figsize=(7, 5))
    rtf = _finite(summary["rtf"].tolist()) if "rtf" in summary else []
    sdr = _finite(summary["sdrDrums"].tolist()) if "sdrDrums" in summary else []
    for i, (model, x, y) in enumerate(zip(summary["model"], rtf, sdr, strict=True)):
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
            model, (x, y), xytext=(6, 4), textcoords="offset points", fontsize=8, color=TEXT_PRIMARY
        )
    ax.set_xscale("log")
    # 로그 축의 기본 큰 눈금은 10의 거듭제곱 자리뿐이라 값이 한 자릿수 구간(예: 0.017~0.078)에
    # 몰리면 눈금이 하나도 안 찍힘. 데이터 범위 안의 눈금을 직접 지정
    ax.set_xticks(log_axis_ticks([x for x in rtf if x > 0]))
    ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:g}"))
    ax.xaxis.set_minor_formatter(FuncFormatter(lambda v, _: ""))
    ax.set_xlabel(
        "RTF (분리 시간 / 곡 길이, 로그 축, 낮을수록 빠름)", color=TEXT_SECONDARY, fontsize=9
    )
    ax.set_ylabel("드럼 SDR (dB, 높을수록 좋음)", color=TEXT_SECONDARY, fontsize=9)
    ax.set_title("속도 대 품질", fontsize=11, color=TEXT_PRIMARY)
    _style_axis(ax)
    ax.xaxis.grid(True, color=GRID, linewidth=0.6)
    fig.tight_layout()
    out_png.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_png, dpi=130)
    plt.close(fig)
    return out_png
