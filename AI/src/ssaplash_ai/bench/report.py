"""보고서 생성 (설계 3-6절, 작업 #6). 결과 CSV 1개 이상 → 모델별 요약 표(md)·곡별 CSV·그래프 PNG 2종.

CSV만 읽고 모델·지표 코드는 모름 (설계 2장 의존 방향).
모델 단위 값은 곡 값들의 중앙값 (MUSDB 관례, 설계 3-5절). 실패한 곡(error 열)은 집계에서 뺌.
비교표 지표는 ADR-011의 6개(드럼 SDR, 타격 보존율, 어택 기울기 왜곡, 반주 SIR, RTF, 피크 GPU 메모리)
+ 가중치 라이선스. 나머지 열은 보조값 표에 둠.
합성곡(synth)은 정답 온셋이 MIDI라 MUSDB(검출기)와 온셋 지표 의미가 달라 데이터셋별 표도 따로 냄.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

# (CSV 열, 표 제목, 높을수록 좋은지)
COMPARISON_METRICS: tuple[tuple[str, str, bool], ...] = (
    ("sdrDrums", "드럼 SDR (dB)", True),
    ("onsetF1", "타격 보존율 F1 (±50ms)", True),
    ("attackSlopeDistortion", "어택 기울기 왜곡", False),
    ("sirAccomp", "반주 SIR (dB)", True),
    ("rtf", "RTF", False),
    ("peakVramMb", "피크 GPU 메모리 (MB)", False),
)
AUXILIARY_METRICS: tuple[tuple[str, str], ...] = (
    ("onsetF1Tight", "F1 (±25ms)"),
    ("onsetPrecision", "온셋 정밀도"),
    ("onsetRecall", "온셋 재현율"),
    ("siSdrDrums", "드럼 SI-SDR (dB)"),
    ("sdrAccomp", "반주 SDR (dB)"),
    ("sarAccomp", "반주 SAR (dB)"),
    ("sirDrums", "드럼 SIR (dB)"),
    ("sarDrums", "드럼 SAR (dB)"),
    ("separateSec", "분리 시간 (s)"),
    ("loadSec", "로드 시간 (s)"),
    ("peakRamMb", "피크 RAM (MB)"),
)
TIER_ORDER = {"1": 0, "2": 1, "baseline": 2}

SUMMARY_MD = "summary.md"
PER_SONG_CSV = "per_song.csv"
BARS_PNG = "metrics_by_model.png"
SCATTER_PNG = "rtf_vs_sdr.png"

# dataviz 기본 팔레트(검증된 범주형 8색, 라이트 모드). 모델 순서대로 고정 배정, 순환 없음.
PALETTE = ("#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948")
TEXT_PRIMARY = "#0b0b0b"
TEXT_SECONDARY = "#52514e"
GRID = "#e4e3df"
# 한글 제목용 글꼴 후보. 앞에서부터 설치된 것을 씀. 코랩은 노트북이 fonts-nanum을 설치.
KOREAN_FONTS = ("Malgun Gothic", "NanumGothic", "Noto Sans CJK KR", "Noto Sans KR", "AppleGothic")


@dataclass
class ReportPaths:
    summary_md: Path
    per_song_csv: Path
    bars_png: Path
    scatter_png: Path

    def all(self) -> list[Path]:
        return [self.summary_md, self.per_song_csv, self.bars_png, self.scatter_png]


def load_results(csv_paths: Sequence[Path | str]) -> pd.DataFrame:
    """결과 CSV 여러 개를 이어 붙임. 숫자 열은 float로 (inf·-inf 유지)."""
    frames = [pd.read_csv(p, encoding="utf-8") for p in csv_paths]
    df = pd.concat(frames, ignore_index=True)
    if "error" in df:
        df["error"] = df["error"].fillna("").astype(str)
    for col in [c for c, _, _ in COMPARISON_METRICS] + [c for c, _ in AUXILIARY_METRICS]:
        if col in df:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def _model_order(df: pd.DataFrame) -> list[str]:
    """tier(1 → 2 → baseline) 다음 이름순. 보고서 정렬 (설계 3-4절 tier)."""
    tiers = df.groupby("model")["tier"].first().astype(str) if "tier" in df else {}
    return sorted(df["model"].unique(), key=lambda m: (TIER_ORDER.get(str(tiers.get(m, "")), 9), m))


def summarize(df: pd.DataFrame) -> pd.DataFrame:
    """모델별 한 행: tier·곡 수·실패 수·지표 중앙값·라이선스·파라미터 수."""
    ok = df[df["error"] == ""] if "error" in df else df
    metric_cols = [c for c, _, _ in COMPARISON_METRICS] + [c for c, _ in AUXILIARY_METRICS]
    metric_cols = [c for c in metric_cols if c in df]
    rows = []
    for model in _model_order(df):
        all_rows = df[df["model"] == model]
        good = ok[ok["model"] == model]
        row: dict[str, object] = {
            "model": model,
            "tier": str(all_rows["tier"].iloc[0]) if "tier" in all_rows else "",
            "nSongs": int(len(all_rows)),
            "nErrors": int((all_rows["error"] != "").sum()) if "error" in all_rows else 0,
        }
        for col in metric_cols:
            row[col] = float(good[col].median()) if len(good) else math.nan
        for col in ("licenseWeights", "licenseCode", "checkpoint", "nParams", "device"):
            row[col] = all_rows[col].iloc[0] if col in all_rows else ""
        rows.append(row)
    return pd.DataFrame(rows)


def _fmt(value: object, digits: int = 2) -> str:
    if isinstance(value, float):
        if math.isnan(value):
            return "—"
        if math.isinf(value):
            return "−∞" if value < 0 else "+∞"
        return f"{value:.{digits}f}"
    if value is None or value == "":
        return "—"
    return str(value)


def _md_table(headers: Sequence[str], rows: Sequence[Sequence[str]]) -> str:
    lines = ["| " + " | ".join(headers) + " |", "| " + " | ".join("---" for _ in headers) + " |"]
    lines += ["| " + " | ".join(r) + " |" for r in rows]
    return "\n".join(lines)


def summary_markdown(summary: pd.DataFrame, df: pd.DataFrame) -> str:
    """비교표 + 보조값 표 + 데이터셋별 표. 값은 곡 중앙값."""
    parts = ["# 드럼 분리 벤치마크 요약", ""]
    run_ids = sorted(df["runId"].astype(str).unique()) if "runId" in df else []
    datasets = sorted(df["dataset"].astype(str).unique()) if "dataset" in df else []
    parts.append(
        f"run: {', '.join(run_ids) or '—'} · 데이터셋: {', '.join(datasets) or '—'} · "
        f"행 {len(df)}개. 값은 실패한 곡을 뺀 곡별 값의 중앙값. "
        "RTF는 분리 시간 / 곡 길이(모델 로드 제외). 어택 기울기 왜곡은 0이 원음 그대로."
    )
    parts.append("")
    parts.append("## 비교표")
    parts.append("")
    headers = (
        ["모델", "등급", "곡/실패"] + [t for _, t, _ in COMPARISON_METRICS] + ["가중치 라이선스"]
    )
    rows = []
    for _, r in summary.iterrows():
        cells = [str(r["model"]), str(r["tier"]), f"{r['nSongs']}/{r['nErrors']}"]
        cells += [
            _fmt(r.get(c, math.nan), 3 if c in ("onsetF1", "rtf") else 2)
            for c, _, _ in COMPARISON_METRICS
        ]
        cells.append(_fmt(r.get("licenseWeights", "")))
        rows.append(cells)
    parts.append(_md_table(headers, rows))
    parts.append("")
    parts.append("## 보조값")
    parts.append("")
    headers = ["모델", "체크포인트", "파라미터 수", "장치"] + [t for _, t in AUXILIARY_METRICS]
    rows = []
    for _, r in summary.iterrows():
        n_params = r.get("nParams", "")
        n_params_str = (
            f"{int(n_params) / 1e6:.1f}M"
            if isinstance(n_params, int | float) and not math.isnan(float(n_params))
            else "—"
        )
        cells = [
            str(r["model"]),
            _fmt(r.get("checkpoint", "")),
            n_params_str,
            _fmt(r.get("device", "")),
        ]
        cells += [
            _fmt(r.get(c, math.nan), 3 if c.startswith("onset") else 2)
            for c, _ in AUXILIARY_METRICS
        ]
        rows.append(cells)
    parts.append(_md_table(headers, rows))
    if len(datasets) > 1:
        parts.append("")
        parts.append("## 데이터셋별")
        parts.append("")
        parts.append(
            "합성곡(synth)은 정답 온셋이 MIDI이고 MUSDB는 정답 스템 검출 온셋이라 온셋 지표를 섞어 읽지 않는다."
        )
        for ds in datasets:
            sub = summarize(df[df["dataset"].astype(str) == ds])
            parts.append("")
            parts.append(f"### {ds}")
            parts.append("")
            headers = ["모델", "곡/실패"] + [t for _, t, _ in COMPARISON_METRICS]
            rows = [
                [str(r["model"]), f"{r['nSongs']}/{r['nErrors']}"]
                + [
                    _fmt(r.get(c, math.nan), 3 if c in ("onsetF1", "rtf") else 2)
                    for c, _, _ in COMPARISON_METRICS
                ]
                for _, r in sub.iterrows()
            ]
            parts.append(_md_table(headers, rows))
    errors = df[df["error"] != ""] if "error" in df else df.iloc[0:0]
    if len(errors):
        parts.append("")
        parts.append("## 실패한 곡")
        parts.append("")
        rows = [
            [str(r["model"]), str(r["songId"]), str(r["error"])[:120]] for _, r in errors.iterrows()
        ]
        parts.append(_md_table(["모델", "곡", "오류"], rows))
    parts.append("")
    return "\n".join(parts)


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


def write_report(csv_paths: Sequence[Path | str], out_dir: Path | str) -> ReportPaths:
    """CSV → summary.md, per_song.csv, metrics_by_model.png, rtf_vs_sdr.png."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    df = load_results(csv_paths)
    summary = summarize(df)
    paths = ReportPaths(
        summary_md=out_dir / SUMMARY_MD,
        per_song_csv=out_dir / PER_SONG_CSV,
        bars_png=out_dir / BARS_PNG,
        scatter_png=out_dir / SCATTER_PNG,
    )
    paths.summary_md.write_text(summary_markdown(summary, df), encoding="utf-8")
    df.to_csv(paths.per_song_csv, index=False, encoding="utf-8")
    plot_metric_bars(summary, paths.bars_png)
    plot_rtf_vs_sdr(summary, paths.scatter_png)
    return paths


def summary_metrics_by_model(summary: pd.DataFrame) -> dict[str, dict[str, float]]:
    """tracking.log_run에 넘길 {모델: {열: 중앙값}}."""
    metric_cols = [c for c, _, _ in COMPARISON_METRICS] + [c for c, _ in AUXILIARY_METRICS]
    out: dict[str, dict[str, float]] = {}
    for _, r in summary.iterrows():
        out[str(r["model"])] = {c: float(r[c]) for c in metric_cols if c in summary}
        out[str(r["model"])]["nErrors"] = float(r["nErrors"])
    return out
