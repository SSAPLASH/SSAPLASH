"""보고서 생성 진입점. CSV 1개 이상 → summary.md, per_song.csv, PNG 2~3종.

- write_report: 분리 벤치마크 (작업 #6)
- write_transcription_report: 채보 벤치마크. 같은 폴더의 hits_by_class.csv도 읽음
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

from ssaplash_ai.bench.report import transcription_summary as ts
from ssaplash_ai.bench.report.charts import plot_metric_bars, plot_rtf_vs_sdr
from ssaplash_ai.bench.report.summary_table import load_results, summarize, summary_markdown
from ssaplash_ai.bench.report.transcription_charts import (
    plot_f1_bars,
    plot_rtf_vs_f1,
    plot_separation_effect,
)

SUMMARY_MD = "summary.md"
PER_SONG_CSV = "per_song.csv"
BARS_PNG = "metrics_by_model.png"
SCATTER_PNG = "rtf_vs_sdr.png"
F1_BARS_PNG = "f1_by_model.png"
RTF_F1_PNG = "rtf_vs_f1.png"
SEPARATION_PNG = "separation_effect.png"


@dataclass
class ReportPaths:
    summary_md: Path
    per_song_csv: Path
    bars_png: Path
    scatter_png: Path
    extra_pngs: list[Path] = field(default_factory=list)  # 채보 보고서의 분리 후 변화 그림 등

    def all(self) -> list[Path]:
        return [
            self.summary_md,
            self.per_song_csv,
            self.bars_png,
            self.scatter_png,
            *self.extra_pngs,
        ]


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


def write_transcription_report(csv_paths: Sequence[Path | str], out_dir: Path | str) -> ReportPaths:
    """채보 results.csv(+hits_by_class.csv) → summary.md, per_song.csv, f1_by_model.png, rtf_vs_f1.png.

    입력이 둘 이상인 묶음이 있으면 separation_effect.png도 만듦.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    df = ts.load_results(csv_paths)
    hits = ts.load_hits_by_class(csv_paths)
    summary = ts.summarize(df)
    paths = ReportPaths(
        summary_md=out_dir / SUMMARY_MD,
        per_song_csv=out_dir / PER_SONG_CSV,
        bars_png=out_dir / F1_BARS_PNG,
        scatter_png=out_dir / RTF_F1_PNG,
    )
    paths.summary_md.write_text(ts.summary_markdown(summary, df, hits), encoding="utf-8")
    df.to_csv(paths.per_song_csv, index=False, encoding="utf-8")
    plot_f1_bars(summary, paths.bars_png)
    plot_rtf_vs_f1(summary, paths.scatter_png)
    sep = plot_separation_effect(summary, out_dir / SEPARATION_PNG)
    if sep is not None:
        paths.extra_pngs.append(sep)
    return paths
