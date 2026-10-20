"""벤치마크 명령줄 진입점 (설계 3-6절). AI/ 폴더에서 실행.

- check-data: 데이터셋 yaml → 곡 수·길이 합·누락 파일 (S15P31A307-103)
- run: 모델 yaml 목록 × 데이터셋 yaml → 결과 CSV, 보고서, 분리 wav(선택), MLflow run
- report: 결과 CSV 1개 이상 → 모델별 요약 표(md), 곡별 CSV, 그래프 PNG 2종

예
  uv run ssaplash-bench check-data configs/bench/datasets/musdb18hq_test.yaml
  uv run ssaplash-bench run --models configs/bench/models/msst/scnet_large.yaml \\
      --dataset configs/bench/datasets/musdb18hq_test_clip30.yaml --out data/results
  uv run ssaplash-bench report data/results/<runId>/results.csv --out data/results/<runId>
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from ssaplash_ai.bench.datasets import CheckReport, load_dataset


def format_report(report: CheckReport) -> str:
    expected = f" (기대 {report.expected_songs})" if report.expected_songs is not None else ""
    minutes = report.total_duration_sec / 60
    lines = [
        f"[{report.dataset}] 곡 {report.song_count}개{expected}, "
        f"길이 합 {minutes:.1f}분, 누락 {len(report.missing)}건"
    ]
    lines.extend(f"  누락: {m}" for m in report.missing)
    lines.append("  상태: 정상" if report.ok else "  상태: 문제 있음")
    return "\n".join(lines)


def check_data(config_paths: Sequence[Path]) -> int:
    exit_code = 0
    for path in config_paths:
        report = load_dataset(path).check()
        print(format_report(report))
        if not report.ok:
            exit_code = 1
    return exit_code


def run(args: argparse.Namespace) -> int:
    """벤치마크 실행 → 보고서 → MLflow 기록 (설계 4-1절)."""
    from ssaplash_ai.bench import report as report_mod
    from ssaplash_ai.bench.runner import RunOptions, log_run, run_benchmark

    opts = RunOptions(
        model_configs=[Path(p) for p in args.models],
        dataset_config=Path(args.dataset),
        out_dir=Path(args.out),
        device=args.device,
        clip=tuple(args.clip) if args.clip else None,
        save_wav=args.save_wav,
        run_id=args.run_id,
        warmup=not args.no_warmup,
    )
    result = run_benchmark(opts)
    paths = report_mod.write_report([result.csv_path], result.run_dir)
    print(f"보고서: {paths.summary_md}")
    if args.mlflow_uri.lower() == "none":
        print("MLflow 기록 생략 (--mlflow-uri none)")
    else:
        summary = report_mod.summarize(report_mod.load_results([result.csv_path]))
        mlflow_run_id = log_run(
            run_id=result.run_id,
            params={
                "dataset": Path(args.dataset).stem,
                "models": ",".join(result.models),
                "device": result.device,
                "host": result.host,
                "clip": opts.clip or "",
                "nSongs": result.n_songs,
                "nModels": len(result.models),
                "nErrors": result.n_errors,
            },
            summary_metrics=report_mod.summary_metrics_by_model(summary),
            artifacts=[result.csv_path, *paths.all()],
            tags={f"config_hash.{r['model']}": str(r["configHash"]) for r in result.rows},
            tracking_uri=args.mlflow_uri,
        )
        print(f"MLflow run: {mlflow_run_id} ({args.mlflow_uri})")
    return 1 if result.n_errors and result.n_errors == len(result.rows) else 0


def report(args: argparse.Namespace) -> int:
    from ssaplash_ai.bench.report import write_report

    out_dir = Path(args.out) if args.out else Path(args.csvs[0]).parent
    paths = write_report([Path(p) for p in args.csvs], out_dir)
    for p in paths.all():
        print(p)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ssaplash-bench", description="드럼 분리 벤치마크 하네스")
    sub = parser.add_subparsers(dest="command", required=True)

    check = sub.add_parser("check-data", help="데이터셋 yaml을 읽어 곡 수·길이·누락 파일 출력")
    check.add_argument("configs", nargs="+", type=Path, help="configs/bench/datasets/*.yaml")

    run_p = sub.add_parser("run", help="모델 × 데이터셋 벤치마크 실행, 보고서·MLflow 기록까지")
    run_p.add_argument("--models", nargs="+", required=True, help="configs/bench/models/<어댑터>/*.yaml")
    run_p.add_argument("--dataset", required=True, help="configs/bench/datasets/*.yaml")
    run_p.add_argument("--out", default="data/results", help="결과 폴더. 아래에 runId 폴더 생성")
    run_p.add_argument("--device", default="cuda", help="cuda 또는 cpu (기본 cuda, 없으면 cpu)")
    run_p.add_argument(
        "--clip",
        nargs=2,
        type=float,
        metavar=("START", "END"),
        help="곡마다 쓸 구간(초). 데이터셋 yaml의 clip보다 우선",
    )
    run_p.add_argument(
        "--save-wav", type=int, default=0, help="모델당 분리 결과 wav를 저장할 곡 수 (설계 U8: 3)"
    )
    run_p.add_argument("--run-id", default=None, help="runId 지정. 기본은 시각+난수")
    run_p.add_argument(
        "--no-warmup",
        action="store_true",
        help="모델 로드 뒤 첫 곡 워밍업 분리를 생략 (RTF가 첫 곡에서 커질 수 있음)",
    )
    run_p.add_argument(
        "--mlflow-uri",
        default=None,
        help="MLflow tracking URI. 기본 mlruns (환경 변수 MLFLOW_TRACKING_URI). none이면 기록 안 함",
    )

    rep = sub.add_parser("report", help="결과 CSV에서 요약 표·곡별 CSV·그래프 생성")
    rep.add_argument("csvs", nargs="+", help="results.csv 1개 이상")
    rep.add_argument("--out", default=None, help="출력 폴더. 기본은 첫 CSV의 폴더")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "check-data":
        return check_data(args.configs)
    if args.command == "run":
        if args.mlflow_uri is None:
            from ssaplash_ai.bench.runner import default_tracking_uri

            args.mlflow_uri = default_tracking_uri()
        return run(args)
    if args.command == "report":
        return report(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())
