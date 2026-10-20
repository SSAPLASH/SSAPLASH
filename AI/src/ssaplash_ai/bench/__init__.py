"""분리·채보 모델 벤치마크 하네스.

- datasets: 평가 데이터셋 로더 (MUSDB18-HQ, 자체 합성곡)
- separators: 분리 모델 어댑터 (fake, msst, demucs, openunmix, spleeter)
- metrics: 지표 (bss, onset, transient, resource)
- runner: 모델 × 곡 실행과 결과 CSV
- report: CSV → 요약 표·그래프
- tracking: MLflow 기록
- cli: 명령줄 진입점 (`uv run ssaplash-bench check-data | run | report`)
"""
