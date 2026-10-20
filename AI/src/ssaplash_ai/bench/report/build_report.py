"""보고서 생성 진입점 (설계 3-6절, 작업 #6). CSV 1개 이상 → summary.md, per_song.csv, PNG 2종."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from ssaplash_ai.bench.report.charts import plot_metric_bars, plot_rtf_vs_sdr
from ssaplash_ai.bench.report.summary_table import load_results, summarize, summary_markdown

SUMMARY_MD = "summary.md"
PER_SONG_CSV = "per_song.csv"
BARS_PNG = "metrics_by_model.png"
SCATTER_PNG = "rtf_vs_sdr.png"


@dataclass
class ReportPaths:
    summary_md: Path
    per_song_csv: Path
    bars_png: Path
    scatter_png: Path

    def all(self) -> list[Path]:
        return [self.summary_md, self.per_song_csv, self.bars_png, self.scatter_png]


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
