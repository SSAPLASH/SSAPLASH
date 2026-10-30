"""분리·채보 모델 벤치마크 하네스.

- datasets: 평가 데이터셋 로더 (MUSDB18-HQ, 자체 합성곡)
- separators: 분리 모델 어댑터 (mock, msst, demucs, openunmix)
- metrics: 지표 (bss_eval_metrics, onset_preservation, attack_slope_distortion, resource_usage)
- runner: 모델 × 곡 실행과 결과 CSV (benchmark_runner), MLflow 기록 (mlflow_tracking)
- report: CSV → 요약 표 (summary_table)·그래프 (charts)·파일 생성 (build_report)
- cli: 명령줄 진입점 (`uv run ssaplash-bench check-data | run | report`)
"""
