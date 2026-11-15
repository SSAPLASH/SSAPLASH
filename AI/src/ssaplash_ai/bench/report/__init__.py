"""결과 보고서. CSV만 읽고 모델·지표 코드는 모름.

- summary_table: CSV 집계, 모델별 요약 표(md), MLflow용 요약 dict
- charts: 지표 막대·RTF 대 SDR 산점도 PNG
- build_report: 위 둘을 묶어 summary.md·per_song.csv·PNG 2종 생성
- transcription_summary·transcription_charts: 채보 결과 집계(개수 합산 F1)·그래프. 진입점은 build_report.write_transcription_report
"""

from ssaplash_ai.bench.report.build_report import (
    ReportPaths,
    write_report,
    write_transcription_report,
)
from ssaplash_ai.bench.report.charts import plot_metric_bars, plot_rtf_vs_sdr
from ssaplash_ai.bench.report.summary_table import (
    AUXILIARY_METRICS,
    COMPARISON_METRICS,
    load_results,
    summarize,
    summary_markdown,
    summary_metrics_by_model,
)

__all__ = [
    "AUXILIARY_METRICS",
    "COMPARISON_METRICS",
    "ReportPaths",
    "load_results",
    "plot_metric_bars",
    "plot_rtf_vs_sdr",
    "summarize",
    "summary_markdown",
    "summary_metrics_by_model",
    "write_report",
    "write_transcription_report",
]
