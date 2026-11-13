"""벤치마크 실행.

- run_support: runId·host·장치·CSV 쓰기·이어하기 (분리·채보 공용)
- benchmark_runner: 분리 모델 × 곡 반복, 예외 격리, 결과 CSV
- transcription_runner: 채보 모델 × 곡 반복, 입력 3가지, 결과 CSV + 라벨별 개수 CSV
- mlflow_tracking: MLflow run 기록
- relog: 지난 결과 폴더·로컬 mlruns를 MLflow에 다시 기록
"""

from ssaplash_ai.bench.runner.benchmark_runner import (
    CSV_COLUMNS,
    METRIC_COLUMNS,
    RunOptions,
    RunResult,
    run_benchmark,
)
from ssaplash_ai.bench.runner.mlflow_tracking import (
    EXPERIMENT_NAME,
    TRANSCRIPTION_EXPERIMENT,
    default_tracking_uri,
    log_run,
)
from ssaplash_ai.bench.runner.transcription_runner import CSV_COLUMNS as TRANSCRIPTION_CSV_COLUMNS
from ssaplash_ai.bench.runner.transcription_runner import (
    HITS_BY_CLASS_COLUMNS,
    INPUTS,
    TranscriptionRunOptions,
    TranscriptionRunResult,
    run_transcription,
)

__all__ = [
    "CSV_COLUMNS",
    "EXPERIMENT_NAME",
    "HITS_BY_CLASS_COLUMNS",
    "INPUTS",
    "METRIC_COLUMNS",
    "TRANSCRIPTION_CSV_COLUMNS",
    "TRANSCRIPTION_EXPERIMENT",
    "RunOptions",
    "RunResult",
    "TranscriptionRunOptions",
    "TranscriptionRunResult",
    "default_tracking_uri",
    "log_run",
    "run_benchmark",
    "run_transcription",
]
