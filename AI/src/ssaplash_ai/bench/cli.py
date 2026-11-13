"""벤치마크 명령줄 진입점. AI/ 폴더에서 실행.

- check-data: 데이터셋 yaml → 곡 수·길이 합·누락 파일·패드별 타격 수
- run: 모델 yaml 목록 × 데이터셋 yaml → 결과 CSV, 보고서, 분리 wav(선택), MLflow run
- report: 결과 CSV 1개 이상 → 모델별 요약 표(md), 곡별 CSV, 그래프 PNG 2종
- run-transcription: 채보 모델 yaml 목록 × 데이터셋 yaml(타격 정답 있는 것) × 입력 1가지 → 결과 CSV,
  라벨별 개수 CSV, 보고서, 예측 MIDI(선택), MLflow run
- report-transcription: 채보 결과 CSV 1개 이상 → 묶음별 요약 표(md), 곡별 CSV, 그래프 PNG 2~3종
- rule-features: ADTOF + 드럼 킷 분리 특징(타격 시각·분리 트랙)을 곡마다 npz로 저장
- rule-eval: 저장한 특징 + 규칙 후보 yaml → 패드별 F1·탐/심벌 배정 정확도·혼동표, MLflow run
- tom-pitch: 정답 탐 타격의 음높이 분포와 고정 경계 후보, 곡 하나 빼고 확인
- relog: 지난 결과 폴더(벤치마크·규칙 채점·파인튜닝·체크포인트 평가)나 로컬 mlruns를 MLflow에 다시 기록
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Sequence
from pathlib import Path

# 코랩·주피터 커널이 자식 프로세스에 MPLBACKEND=module://matplotlib_inline.backend_inline을 넘기는데
# uv 가상환경에는 그 모듈이 없어 matplotlib import(모델 로드·그래프)가 실패함. 명령줄 도구는 화면이 없으므로
# 항상 Agg. matplotlib을 처음 import하기 전에 덮어써야 해서 모듈 맨 위에 둠.
os.environ["MPLBACKEND"] = "Agg"

from ssaplash_ai.bench.datasets import CheckReport, load_dataset  # noqa: E402


def format_report(report: CheckReport) -> str:
    expected = f" (기대 {report.expected_songs})" if report.expected_songs is not None else ""
    minutes = report.total_duration_sec / 60
    lines = [
        f"[{report.dataset}] 곡 {report.song_count}개{expected}, "
        f"길이 합 {minutes:.1f}분, 누락 {len(report.missing)}건"
    ]
    lines.extend(f"  누락: {m}" for m in report.missing)
    if report.hits_by_pad is None:
        lines.append("  타격 정답: 없음 (정답 드럼 스템에 검출기 적용)")
    else:
        total = sum(report.hits_by_pad.values())
        pads = ", ".join(f"{pad} {n}" for pad, n in report.hits_by_pad.items())
        lines.append(f"  타격 정답: {total}개 ({pads}), 패드 밖 제외 {report.hits_dropped}개")
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
    """벤치마크 실행 → 보고서 → MLflow 기록."""
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
                "gpuName": result.gpu_name,
                "host": result.host,
                "clip": opts.clip or "",
                "nSongs": result.n_songs,
                "nModels": len(result.models),
                "nErrors": result.n_errors,
                "nSkipped": result.n_skipped,
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


def run_transcription_cmd(args: argparse.Namespace) -> int:
    """채보 벤치마크 실행 → 보고서 → MLflow 기록."""
    from ssaplash_ai.bench.report import transcription_summary as ts
    from ssaplash_ai.bench.report import write_transcription_report
    from ssaplash_ai.bench.runner import (
        TRANSCRIPTION_EXPERIMENT,
        TranscriptionRunOptions,
        log_run,
        run_transcription,
    )

    opts = TranscriptionRunOptions(
        model_configs=[Path(p) for p in args.models],
        dataset_config=Path(args.dataset),
        out_dir=Path(args.out),
        device=args.device,
        input=args.input,
        separator_config=Path(args.separator) if args.separator else None,
        separated_dir=Path(args.separated_dir) if args.separated_dir else None,
        clip=tuple(args.clip) if args.clip else None,
        save_midi=args.save_midi,
        run_id=args.run_id,
        warmup=not args.no_warmup,
    )
    result = run_transcription(opts)
    paths = write_transcription_report([result.csv_path], result.run_dir)
    print(f"보고서: {paths.summary_md}")
    if args.mlflow_uri.lower() == "none":
        print("MLflow 기록 생략 (--mlflow-uri none)")
    else:
        summary = ts.summarize(ts.load_results([result.csv_path]))
        summary_metrics = ts.summary_metrics_by_model(summary)
        # 패드별 F1: 규칙을 바꾼 run끼리 MLflow에서 패드 단위로 비교
        hits = ts.load_hits_by_class([result.csv_path])
        for model, values in ts.label_f1_metrics(hits).items():
            summary_metrics.setdefault(model, {}).update(values)
        params: dict[str, object] = {
            "dataset": Path(args.dataset).stem,
            "models": ",".join(result.models),
            "input": result.input,
            "separator": result.separator,
            "device": result.device,
            "gpuName": result.gpu_name,
            "host": result.host,
            "clip": opts.clip or "",
            "nSongs": result.n_songs,
            "nModels": len(result.models),
            "nErrors": result.n_errors,
            "nSkipped": result.n_skipped,
        }
        params.update(rules_params(opts.model_configs))
        mlflow_run_id = log_run(
            run_id=result.run_id,
            params=params,
            summary_metrics=summary_metrics,
            artifacts=[result.csv_path, result.hits_csv_path, *paths.all()],
            tags={f"config_hash.{r['model']}": str(r["configHash"]) for r in result.rows},
            tracking_uri=args.mlflow_uri,
            experiment_name=TRANSCRIPTION_EXPERIMENT,
        )
        print(f"MLflow run: {mlflow_run_id} ({args.mlflow_uri})")
    return 1 if result.n_errors and result.n_errors == len(result.rows) else 0


def rules_params(model_configs: Sequence[Path]) -> dict[str, object]:
    """채보 모델 yaml의 규칙값(탐 경계 등)을 MLflow 파라미터로. 모델이 하나면 `rules.{키}`, 여럿이면
    `rules.{모델}.{키}`. rules가 없는 다른 어댑터 모델은 건너뜀. 빠진 키는 adtof_drumsep 기본값으로 채움
    (strum_crnn rules에도 같은 기본값이 붙음)."""
    from ssaplash_ai.bench.transcribers import TranscriberConfig
    from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import rules_with_defaults

    configs = [TranscriberConfig.from_yaml(p) for p in model_configs]
    out: dict[str, object] = {}
    for cfg in configs:
        if cfg.adapter != "adtof_drumsep" and not cfg.rules:
            continue
        prefix = "rules" if len(configs) == 1 else f"rules.{cfg.name}"
        for key, value in rules_with_defaults(cfg.rules).items():
            out[f"{prefix}.{key}"] = value
    return out


def rule_features_cmd(args: argparse.Namespace) -> int:
    from ssaplash_ai.bench.analysis import build_features

    failed = 0
    for dataset in args.dataset:
        result = build_features(
            model_config=Path(args.model),
            dataset_config=Path(dataset),
            root=Path(args.out),
            device=args.device,
            overwrite=args.overwrite,
            stems_from=Path(args.stems_from) if args.stems_from else None,
        )
        print(
            f"{Path(dataset).stem}: 저장 {len(result.paths)}개, 건너뜀 {result.n_skipped}개, "
            f"실패 {result.n_failed}개"
        )
        failed += result.n_failed
    return 1 if failed else 0


def rule_eval_cmd(args: argparse.Namespace) -> int:
    from ssaplash_ai.bench.analysis.rule_eval import RuleEvalOptions, run_rule_eval

    result = run_rule_eval(
        RuleEvalOptions(
            features_root=Path(args.features),
            dataset_configs=[Path(p) for p in args.dataset],
            candidate_configs=[Path(p) for p in args.candidates],
            out_dir=Path(args.out),
            mlflow_uri=args.mlflow_uri,
            two_tom_upper=args.two_tom_upper,
        )
    )
    print(f"후보 {len(result.candidates)}개 × 묶음 {len(args.dataset)}개 → {result.summary_md}")
    return 0


def tom_pitch_cmd(args: argparse.Namespace) -> int:
    from ssaplash_ai.bench.analysis.tom_pitch import TomPitchOptions, run_tom_pitch

    rules: dict = {}
    if args.window_ms is not None:
        rules["window_ms"] = args.window_ms
    if args.fmin is not None:
        rules["tom_fmin"] = args.fmin
    if args.fmax is not None:
        rules["tom_fmax"] = args.fmax
    result = run_tom_pitch(
        TomPitchOptions(
            features_root=Path(args.features),
            dataset_configs=[Path(p) for p in args.dataset],
            out_dir=Path(args.out),
            rules=rules,
            current_bands=tuple(args.current_bands),
            lo_range=tuple(args.search_range),
            step=args.step,
            loo_dataset=args.loo_dataset,
        )
    )
    for c in result.candidates:
        accs = ", ".join(f"{k[4:]} {v:.3f}" for k, v in c.items() if k.startswith("acc_"))
        print(f"{c['name']}: {c['lo']:.0f}·{c['hi']:.0f}Hz ({accs})")
    for p in result.files:
        print(p)
    return 0


def report_transcription(args: argparse.Namespace) -> int:
    from ssaplash_ai.bench.report import write_transcription_report

    out_dir = Path(args.out) if args.out else Path(args.csvs[0]).parent
    paths = write_transcription_report([Path(p) for p in args.csvs], out_dir)
    for p in paths.all():
        print(p)
    return 0


def relog_cmd(args: argparse.Namespace) -> int:
    from ssaplash_ai.bench.runner.relog import copy_mlruns, outcome_table, relog

    if not args.folders and not args.from_mlruns:
        print("결과 폴더나 --from-mlruns 중 하나는 있어야 함")
        return 2
    outcomes = []
    if args.from_mlruns:
        outcomes += copy_mlruns(
            Path(args.from_mlruns), args.mlflow_uri, dry_run=args.dry_run, force=args.force
        )
    if args.folders:
        outcomes += relog(
            [Path(f) for f in args.folders],
            args.mlflow_uri,
            dry_run=args.dry_run,
            force=args.force,
            recursive=args.recursive,
        )
    print(outcome_table(outcomes))
    return 1 if any(o.status == "실패" for o in outcomes) else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ssaplash-bench", description="드럼 분리·채보 벤치마크 하네스"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    check = sub.add_parser(
        "check-data", help="데이터셋 yaml을 읽어 곡 수·길이·누락 파일·패드별 타격 수 출력"
    )
    check.add_argument("configs", nargs="+", type=Path, help="configs/bench/datasets/*.yaml")

    run_p = sub.add_parser("run", help="모델 × 데이터셋 벤치마크 실행, 보고서·MLflow 기록까지")
    run_p.add_argument(
        "--models", nargs="+", required=True, help="configs/bench/models/<어댑터>/*.yaml"
    )
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
    run_p.add_argument(
        "--run-id",
        default=None,
        help="runId 지정. 기본은 시각+난수. 같은 runId의 results.csv가 있으면 이어하기"
        "(성공한 곡은 건너뛰고 실패한 곡만 다시 실행)",
    )
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

    tr = sub.add_parser(
        "run-transcription", help="채보 모델 × 데이터셋 벤치마크 실행, 보고서·MLflow 기록까지"
    )
    tr.add_argument(
        "--models", nargs="+", required=True, help="configs/bench/transcribers/<어댑터>/*.yaml"
    )
    tr.add_argument("--dataset", required=True, help="타격 정답이 있는 데이터셋 yaml")
    tr.add_argument(
        "--input",
        default="drums",
        choices=("drums", "mixture", "separated"),
        help="모델에 넣는 소리: drums(정답 드럼 트랙), mixture(원곡), separated(분리 모델이 뽑은 드럼)",
    )
    tr.add_argument(
        "--separator", default=None, help="separated일 때 분리 모델 yaml (configs/bench/models/...)"
    )
    tr.add_argument(
        "--separated-dir",
        default=None,
        help="이미 분리된 드럼 wav 폴더(<폴더>/<곡>/drums.wav). 있으면 분리를 건너뜀",
    )
    tr.add_argument("--out", default="data/results", help="결과 폴더. 아래에 runId 폴더 생성")
    tr.add_argument("--device", default="cuda", help="cuda 또는 cpu (기본 cuda, 없으면 cpu)")
    tr.add_argument(
        "--clip", nargs=2, type=float, metavar=("START", "END"), help="곡마다 쓸 구간(초)"
    )
    tr.add_argument(
        "--save-midi", type=int, default=0, help="모델당 예측 타격을 MIDI로 저장할 곡 수"
    )
    tr.add_argument(
        "--run-id",
        default=None,
        help="runId 지정. 같은 runId의 results.csv가 있으면 이어하기(성공한 곡은 건너뜀)",
    )
    tr.add_argument("--no-warmup", action="store_true", help="로드 뒤 첫 곡 워밍업을 생략")
    tr.add_argument(
        "--mlflow-uri",
        default=None,
        help="MLflow tracking URI. 기본 mlruns (환경 변수 MLFLOW_TRACKING_URI). none이면 기록 안 함",
    )

    trep = sub.add_parser("report-transcription", help="채보 결과 CSV에서 요약 표·그래프 생성")
    trep.add_argument(
        "csvs", nargs="+", help="채보 results.csv 1개 이상 (hits_by_class.csv는 같은 폴더)"
    )
    trep.add_argument("--out", default=None, help="출력 폴더. 기본은 첫 CSV의 폴더")

    rf = sub.add_parser(
        "rule-features",
        help="ADTOF + 드럼 킷 분리 특징(타격 시각·분리 트랙)을 곡마다 npz로 저장 (규칙 분석 준비, GPU)",
    )
    rf.add_argument(
        "--model",
        default="configs/bench/transcribers/adtof_drumsep/adtof_drumsep.yaml",
        help="adtof_drumsep 어댑터 yaml",
    )
    rf.add_argument("--dataset", nargs="+", required=True, help="타격 정답이 있는 데이터셋 yaml")
    rf.add_argument("--out", default="data/rule_features", help="특징 폴더. 아래에 데이터셋 폴더")
    rf.add_argument("--device", default="cuda", help="cuda 또는 cpu")
    rf.add_argument("--overwrite", action="store_true", help="이미 있는 npz도 다시 계산")
    rf.add_argument(
        "--stems-from",
        default=None,
        help="이 폴더의 같은 곡 특징에서 분리 트랙을 복사하고 채보 모델만 다시 돌림 (파인튜닝 가중치 평가용)",
    )

    re_p = sub.add_parser(
        "rule-eval", help="저장한 특징 + 규칙 후보 yaml → 패드별 F1·배정 정확도·혼동표 (CPU)"
    )
    re_p.add_argument("--features", default="data/rule_features", help="rule-features 출력 폴더")
    re_p.add_argument("--dataset", nargs="+", required=True, help="데이터셋 yaml (정답용)")
    re_p.add_argument(
        "--candidates",
        nargs="+",
        required=True,
        help="후보 yaml. `candidates: [{name, rules}]` 또는 `{name, rules}` 하나",
    )
    re_p.add_argument(
        "--out",
        required=True,
        help="결과 폴더 (candidates.csv·confusion.csv·by_song.csv·summary.md·candidates.yaml)",
    )
    re_p.add_argument(
        "--two-tom-upper",
        choices=["MID_TOM", "SMALL_TOM"],
        default=None,
        help="탐 둘만 쓴 곡의 위쪽 탐 정답 이름을 이걸로 통일 (기본은 정답 그대로)",
    )
    re_p.add_argument(
        "--mlflow-uri",
        default="none",
        help="MLflow tracking URI. 후보 하나 = run 하나(실험 chart-rules). 기본 none(기록 안 함)",
    )

    tp = sub.add_parser(
        "tom-pitch", help="정답 탐 타격의 음높이 분포·고정 경계 후보·곡 하나 빼고 확인 (CPU)"
    )
    tp.add_argument("--features", default="data/rule_features", help="rule-features 출력 폴더")
    tp.add_argument("--dataset", nargs="+", required=True, help="데이터셋 yaml (정답용)")
    tp.add_argument("--out", required=True, help="결과 폴더")
    tp.add_argument(
        "--window-ms", type=float, default=None, help="음높이 구간 길이 (기본 규칙값 80)"
    )
    tp.add_argument("--fmin", type=float, default=None, help="음높이 하한 Hz (기본 50)")
    tp.add_argument("--fmax", type=float, default=None, help="음높이 상한 Hz (기본 400)")
    tp.add_argument(
        "--current-bands", nargs=2, type=float, default=[113.0, 142.0], metavar=("LO", "HI")
    )
    tp.add_argument(
        "--search-range", nargs=2, type=float, default=[60.0, 300.0], metavar=("LO", "HI")
    )
    tp.add_argument("--step", type=float, default=1.0, help="경계 탐색 간격 Hz")
    tp.add_argument(
        "--loo-dataset", default=None, help="곡 하나 빼고 확인할 데이터셋 이름. 기본은 첫 번째"
    )

    rl = sub.add_parser(
        "relog", help="지난 결과 폴더나 로컬 mlruns를 MLflow에 다시 기록 (같은 runId는 건너뜀)"
    )
    rl.add_argument("folders", nargs="*", help="결과 폴더 (여러 개)")
    rl.add_argument(
        "--recursive",
        action="store_true",
        help="준 폴더 아래에서 결과 폴더를 찾음(확인용 폴더 제외)",
    )
    rl.add_argument("--from-mlruns", default=None, help="run을 그대로 복사할 로컬 파일 저장소 폴더")
    rl.add_argument(
        "--mlflow-uri",
        default=None,
        help="기록할 주소. 팀 서버는 터널을 열고 http://localhost:5000. 생략하면 MLFLOW_TRACKING_URI → mlruns",
    )
    rl.add_argument("--dry-run", action="store_true", help="기록하지 않고 목록·개수·중복만 출력")
    rl.add_argument("--force", action="store_true", help="같은 runId가 있어도 새로 기록")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "check-data":
        return check_data(args.configs)
    if args.command in ("run", "run-transcription"):
        if args.mlflow_uri is None:
            from ssaplash_ai.bench.runner import default_tracking_uri

            args.mlflow_uri = default_tracking_uri()
        return run(args) if args.command == "run" else run_transcription_cmd(args)
    if args.command == "report":
        return report(args)
    if args.command == "report-transcription":
        return report_transcription(args)
    if args.command == "rule-features":
        return rule_features_cmd(args)
    if args.command == "rule-eval":
        return rule_eval_cmd(args)
    if args.command == "tom-pitch":
        return tom_pitch_cmd(args)
    if args.command == "relog":
        return relog_cmd(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())
