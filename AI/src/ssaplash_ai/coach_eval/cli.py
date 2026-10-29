"""약점 분석 합성 평가 실행 명령.

    python -m ssaplash_ai.coach_eval.cli --out docs/coach-eval/weak-segments-2026-10-30

결과 표(`results.md`)·집계(`results.json`)·그림·예시 데이터를 `--out` 폴더에 쓴다.
`--mlflow`를 주면 MLflow에도 기록한다(주소는 `--tracking-uri` 또는 환경 변수 `MLFLOW_TRACKING_URI`, 없으면 로컬 `mlruns/`).
"""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

from ssaplash_ai.coach_eval import report
from ssaplash_ai.coach_eval.runner import RunConfig, measure_performance, run_all, server_smoke


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="약점 분석 합성 평가")
    parser.add_argument(
        "--seeds", type=int, default=RunConfig.seeds, help="시나리오·강도마다 시험 횟수"
    )
    parser.add_argument("--base-seed", type=int, default=RunConfig.base_seed)
    parser.add_argument("--out", type=Path, required=True, help="결과를 쓸 폴더")
    parser.add_argument("--skip-perf", action="store_true", help="응답 시간 측정을 건너뛴다")
    parser.add_argument("--mlflow", action="store_true", help="MLflow에 기록한다")
    parser.add_argument("--tracking-uri", default=None)
    args = parser.parse_args(argv)

    config = RunConfig(seeds=args.seeds, base_seed=args.base_seed)
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)

    print(f"평가 실행: 시험 {config.seeds}회씩 ...")
    result = run_all(config)
    perf = None if args.skip_perf else measure_performance()
    smoke = server_smoke(report.write_samples(out / "samples"))

    (out / "results.md").write_text(
        report.render_markdown(result, perf, smoke, date.today().isoformat()), encoding="utf-8"
    )
    (out / "results.json").write_text(
        json.dumps(report.results_dict(result, perf, smoke), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    report.write_sensitivity_plot(result, out / "sensitivity.png")
    print(f"시험 {len(result.trials)}건, {result.elapsed_sec:.1f}초 → {out}")

    if args.mlflow:
        artifacts = [out / "results.md", out / "results.json", out / "sensitivity.png"]
        run_id = report.log_to_mlflow(
            result, perf, artifacts, run_name=out.name, tracking_uri=args.tracking_uri
        )
        print(f"MLflow 기록: 실험 {report.EXPERIMENT_NAME}, run {run_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
