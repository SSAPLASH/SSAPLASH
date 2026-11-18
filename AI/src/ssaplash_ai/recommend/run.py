"""곡 추천 PoC 실행기: 데이터를 읽거나 합성으로 만들고, 방법들을 학습·평가해 표와 보고서를 남긴다.

```
uv run python scripts/run_recommend_poc.py --synthetic --stage P0 --out runs/recommend/p0
uv run python scripts/run_recommend_poc.py --data data/recommend/internal --stage P1 --mlflow
```

데이터 출처 단계(`--stage`)는 꼭 지정해야 한다. 일반 사용자 데이터(P2)는 `--p2-approval`에 동의 범위 승인 근거를 적어야 한다.
합성 데이터의 점수는 모델의 실제 성능이 아니다(하니스 점검용).
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path

from ssaplash_ai.recommend import schema as S
from ssaplash_ai.recommend.data import (
    DataError,
    Dataset,
    dataset_from_frames,
    load_dataset,
    temporal_split,
)
from ssaplash_ai.recommend.evaluate import EvalConfig, Report, evaluate
from ssaplash_ai.recommend.models import (
    CoPlay,
    LightGCN,
    Node2Vec,
    Popularity,
    R1Rules,
    Recommender,
    Reranked,
    SimilarToRecent,
)
from ssaplash_ai.recommend.simulate import SimConfig, generate
from ssaplash_ai.recommend.source import ExportSource, PostgresExportSource, require_views

# 이름 → 방법. M5: LightGCN(특징 없음), M5F: +곡 특징 노드, M5FM: +메타데이터. M6*: 각 LightGCN 상위 50을 R1 규칙으로 재정렬. M4*: Node2Vec(같은 세 변형).
MODEL_FACTORIES: dict[str, Callable[[], Recommender]] = {
    "M0": Popularity,
    "M1": R1Rules,
    "M2": SimilarToRecent,
    "M3": CoPlay,
    "M4": lambda: Node2Vec("none"),
    "M4F": lambda: Node2Vec("chart"),
    "M4FM": lambda: Node2Vec("chart+meta"),
    "M5": lambda: LightGCN("none"),
    "M5F": lambda: LightGCN("chart"),
    "M5FM": lambda: LightGCN("chart+meta"),
    "M6": lambda: Reranked(LightGCN("none")),
    "M6F": lambda: Reranked(LightGCN("chart")),
    "M6FM": lambda: Reranked(LightGCN("chart+meta")),
}


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="곡 추천 PoC 학습·평가")
    source = p.add_mutually_exclusive_group(required=True)
    source.add_argument("--data", type=Path, help="입력 CSV 폴더(docs/recommend-poc.md의 규격)")
    source.add_argument(
        "--synthetic", action="store_true", help="합성 데이터를 만들어 쓴다(출처 단계 P0)"
    )
    source.add_argument(
        "--from-views",
        action="store_true",
        help="BE 읽기 뷰에서 메모리로 읽는다(파일을 만들지 않음)",
    )
    p.add_argument("--stage", required=True, choices=S.STAGES, help="데이터 출처 단계")
    p.add_argument("--p2-approval", help="P2 사용 승인 근거(동의 범위 결정 문서·번호)")
    p.add_argument(
        "--models",
        default=",".join(MODEL_FACTORIES),
        help=f"쉼표로 구분한 방법 이름 {list(MODEL_FACTORIES)}",
    )
    p.add_argument("-k", type=int, default=10)
    p.add_argument("--cutoff-quantile", type=float, default=0.8)
    p.add_argument("--seed", type=int, default=0, help="합성 데이터·부트스트랩 시드")
    p.add_argument("--bootstrap", type=int, default=1000)
    p.add_argument("--synthetic-users", type=int, default=2000)
    p.add_argument("--synthetic-songs", type=int, default=300)
    p.add_argument("--out", type=Path, help="report.json과 table.csv를 쓸 폴더")
    p.add_argument(
        "--report",
        type=Path,
        help="진입 판단 보고서(Markdown)를 쓸 파일. 기준선 M0~M3와 후보(M4·M5·M6)가 모두 필요하다",
    )
    p.add_argument(
        "--min-warm-targets", type=int, default=500, help="판단에 필요한 최소 일반 시험 목표 수"
    )
    p.add_argument(
        "--min-cold-targets", type=int, default=30, help="판단에 필요한 최소 새 곡 시험 목표 수"
    )
    p.add_argument("--mlflow", action="store_true", help="MLflow에 기록(집계 값만)")
    p.add_argument("--tracking-uri")
    p.add_argument("--experiment", default="song-recommend")
    return p


def run(args: argparse.Namespace, source: ExportSource | None = None) -> Report:
    names = [n.strip() for n in args.models.split(",") if n.strip()]
    unknown = [n for n in names if n not in MODEL_FACTORIES]
    if unknown:
        raise DataError(f"알 수 없는 방법: {unknown}. 사용 가능: {list(MODEL_FACTORIES)}")
    if args.stage == S.STAGE_PRODUCTION and not args.from_views:
        raise DataError("일반 사용자 데이터는 파일로 두지 않습니다. --from-views로 읽으세요.")
    if args.from_views:
        if args.stage == S.STAGE_SYNTHETIC:
            raise DataError("뷰에서 읽은 입력은 출처 단계 P0로 쓸 수 없습니다.")
        frames = (source or PostgresExportSource()).frames()
        require_views(frames)
        return evaluate_all(
            dataset_from_frames(frames, args.stage, p2_approval=args.p2_approval), names, args
        )
    with tempfile.TemporaryDirectory(prefix="recommend-synthetic-") as tmp:
        if args.synthetic:
            if args.stage != S.STAGE_SYNTHETIC:
                raise DataError("합성 데이터는 출처 단계 P0로만 쓸 수 있습니다.")
            synthetic = generate(
                SimConfig(
                    seed=args.seed, n_users=args.synthetic_users, n_songs=args.synthetic_songs
                )
            )
            data = load_dataset(synthetic.write(Path(tmp) / "data"), args.stage)
        else:
            data = load_dataset(args.data, args.stage, p2_approval=args.p2_approval)
        return evaluate_all(data, names, args)


def evaluate_all(data: Dataset, names: list[str], args: argparse.Namespace) -> Report:
    split = temporal_split(data.interactions, cutoff_quantile=args.cutoff_quantile)
    models = [MODEL_FACTORIES[n]().fit(split.train, data, now=split.cutoff) for n in names]
    return evaluate(
        models, split, data, EvalConfig(k=args.k, bootstrap=args.bootstrap, seed=args.seed)
    )


def main(argv: list[str] | None = None, *, source: ExportSource | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        report = run(args, source)
    except DataError as ex:
        print(f"데이터 오류: {ex}", file=sys.stderr)
        return 2
    except Exception as ex:
        if not args.from_views:
            raise
        # DB 오류 메시지에 접속 정보가 섞일 수 있어 종류만 남긴다
        print(f"평가 중단: {type(ex).__name__}", file=sys.stderr)
        return 2
    table = report.table()
    print(
        f"단계 {report.stage} · 데이터 {report.data_hash[:12]} · cutoff {report.cutoff} · k={report.config.k}"
    )
    print(table.round(4).to_string())
    if report.stage == S.STAGE_SYNTHETIC:
        print("※ 합성 데이터의 점수는 모델의 실제 성능이 아닙니다(하니스 점검용).")
    if args.out:
        args.out.mkdir(parents=True, exist_ok=True)
        (args.out / "report.json").write_text(
            json.dumps(report.to_dict(), ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        table.to_csv(args.out / "table.csv", encoding="utf-8")
    if args.report:
        from ssaplash_ai.recommend.report import VERDICT_KO, DecisionConfig, decide, to_markdown

        cfg = DecisionConfig(args.min_warm_targets, args.min_cold_targets)
        try:
            decision = decide(report, cfg)
        except ValueError as ex:
            print(f"보고서 오류: {ex}", file=sys.stderr)
            return 2
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(to_markdown(report, decision, cfg), encoding="utf-8")
        print(f"진입 판단: {VERDICT_KO[decision.verdict]} → {args.report}")
    if args.mlflow:
        from ssaplash_ai.recommend.mlflow_log import log_report

        ids = log_report(report, tracking_uri=args.tracking_uri, experiment=args.experiment)
        print(f"MLflow run {len(ids)}개 기록: {args.experiment}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
