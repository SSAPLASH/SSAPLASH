"""벤치마크 실행.

- benchmark_runner: 모델 × 곡 반복, 예외 격리, 결과 CSV
- mlflow_tracking: MLflow run 기록
"""

from ssaplash_ai.bench.runner.benchmark_runner import (
    CSV_COLUMNS,
    METRIC_COLUMNS,
    RunOptions,
    RunResult,
    run_benchmark,
)
from ssaplash_ai.bench.runner.mlflow_tracking import default_tracking_uri, log_run

__all__ = [
    "CSV_COLUMNS",
    "METRIC_COLUMNS",
    "RunOptions",
    "RunResult",
    "default_tracking_uri",
    "log_run",
    "run_benchmark",
]
