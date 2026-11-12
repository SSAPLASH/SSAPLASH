"""분리·채보 모델 벤치마크 하네스.

- datasets: 평가·학습 데이터셋 로더 (MUSDB18-HQ·합성곡·GMD·E-GMD·MDB·STAR·ENST·Songsterr 공용 곡)
- separators: 분리 모델 어댑터 (mock, msst, demucs, openunmix, ensemble)
- transcribers: 채보 모델 어댑터 (mock, adtof, adtof_drumsep, external, strum_crnn)
- metrics: 지표 (bss_eval_metrics, onset_preservation, attack_slope_distortion, resource_usage,
  mr_quality, hit_f1)
- analysis: 채보 규칙 분석 도구 (rule_features, rule_eval, tom_pitch)
- runner: 분리·채보 실행과 결과 CSV (benchmark_runner, transcription_runner, run_support),
  MLflow 기록 (mlflow_tracking, relog)
- report: CSV → 요약 표 (summary_table)·그래프 (charts)·파일 생성 (build_report),
  채보 보고서 (transcription_summary, transcription_charts)
- cli: 명령줄 진입점 (`uv run ssaplash-bench check-data | run | report | run-transcription |
  report-transcription | rule-features | rule-eval | tom-pitch | relog`)
"""
