"""지난 결과 폴더를 MLflow에 다시 기록.

결과 파일이 원본이고 MLflow 기록은 거기서 만듦. 폴더 종류는 파일·열로 판별:
- separation: results.csv에 sdrDrums 열 → 실험 separation-bench, run 1개
- transcription: results.csv에 f1Five50 열 → 실험 transcription-bench, run 1개
- rules: candidates.csv → 실험 chart-rules, 후보마다 run 1개 (runId `폴더 이름/후보 이름`)
- finetune: log.csv + config.yaml + best.pth → 실험 adtof-finetune, 에폭을 step으로 둔 지표
- adtof_eval: summary.csv가 checkpoint·dataset 열로 시작 → 실험 adtof-eval
같은 실험에 같은 runId 태그가 있으면 건너뜀(force 제외). 결과 폴더의 파일은 바꾸지 않고, 요약 표·그래프는
임시 폴더에 다시 만들어 올림. 이관한 run에는 relogged=true, sourceDir 태그.

copy_mlruns는 로컬 파일 저장소(mlruns/)의 run을 다른 저장소로 그대로 복사 (지표 이력·산출물 포함).
"""

from __future__ import annotations

import csv
import json
import math
import tempfile
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from ssaplash_ai.bench.runner.mlflow_tracking import (
    EXPERIMENT_NAME,
    TRANSCRIPTION_EXPERIMENT,
    _as_uri,
    default_tracking_uri,
    find_run,
    log_run,
)

RULES_EXPERIMENT = "chart-rules"  # bench.analysis.rule_eval과 같은 이름
FINETUNE_EXPERIMENT = "adtof-finetune"
ADTOF_EVAL_EXPERIMENT = "adtof-eval"

# 확인용·합본·분석 그림 폴더와 큰 하위 폴더. --recursive에서 들어가지 않음
SKIP_PREFIXES = ("check-", "local-", "combined", "tom-pitch", "tom-detect-", "smoke_")
SKIP_SUFFIXES = ("-check",)
SKIP_NAMES = {"separation_demo", "separated", "midi", "inputs", "mlruns", ".git", "__pycache__"}
# mlruns 복사에서 뺄 run 이름
SKIP_RUN_PREFIXES = ("check-", "local-")


@dataclass
class RunPlan:
    """MLflow run 1개로 올릴 내용."""

    run_id: str
    params: dict[str, object]
    metrics: dict[str, dict[str, float]]
    artifacts: list[Path]
    tags: dict[str, str] = field(default_factory=dict)
    step_metrics: list[tuple[int, dict[str, float]]] = field(default_factory=list)
    # 임시 폴더를 받아 요약 표·그래프를 만들고 그 경로를 돌려줌. dry-run에서는 안 부름
    make_reports: Callable[[Path], list[Path]] | None = None


@dataclass
class FolderPlan:
    folder: Path
    kind: str | None
    experiment: str = ""
    runs: list[RunPlan] = field(default_factory=list)
    skip_reason: str = ""


@dataclass
class RelogOutcome:
    folder: Path
    kind: str | None
    experiment: str
    run_id: str
    status: str  # 기록 / 기록 예정(dry-run) / 건너뜀(중복) / 건너뜀 / 실패
    mlflow_run_id: str = ""
    detail: str = ""


def _header(path: Path) -> list[str]:
    with path.open(encoding="utf-8", newline="") as f:
        return next(csv.reader(f), [])


def _rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def _num(value: str | None) -> float | None:
    try:
        x = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def detect_kind(folder: Path) -> str | None:
    """폴더 종류. 판별 못 하면 None."""
    results = folder / "results.csv"
    if results.is_file():
        head = _header(results)
        if "sdrDrums" in head:
            return "separation"
        if "f1Five50" in head:
            return "transcription"
    if (folder / "candidates.csv").is_file() and "candidate" in _header(folder / "candidates.csv"):
        return "rules"
    if all((folder / n).is_file() for n in ("log.csv", "config.yaml", "best.pth")):
        return "finetune"
    summary = folder / "summary.csv"
    if summary.is_file() and _header(summary)[:2] == ["checkpoint", "dataset"]:
        return "adtof_eval"
    return None


def skipped_name(name: str) -> bool:
    return name in SKIP_NAMES or name.startswith(SKIP_PREFIXES) or name.endswith(SKIP_SUFFIXES)


def find_folders(roots: Sequence[Path], recursive: bool) -> Iterator[Path]:
    """결과 폴더 목록. recursive면 종류가 판별되는 폴더를 찾을 때까지 내려감(찾은 폴더 안으로는 안 들어감)."""
    for root in roots:
        root = Path(root)
        if not recursive:
            yield root
            continue
        stack = [root]
        while stack:
            d = stack.pop()
            if d != root and skipped_name(d.name):
                continue
            if detect_kind(d):
                yield d
                continue
            stack.extend(sorted((p for p in d.iterdir() if p.is_dir()), reverse=True))


def _base_tags(folder: Path) -> dict[str, str]:
    return {"relogged": "true", "sourceDir": folder.as_posix()}


def _first(rows: list[dict[str, str]], key: str) -> str:
    return next((r[key] for r in rows if r.get(key)), "")


def _unique(rows: list[dict[str, str]], key: str) -> list[str]:
    return list(dict.fromkeys(r[key] for r in rows if r.get(key)))


def _bench_params(rows: list[dict[str, str]], transcription: bool) -> dict[str, object]:
    """run_* 명령이 기록하던 파라미터와 같은 이름. CSV에 없는 clip·nSkipped는 빈 값."""
    models = _unique(rows, "model")
    params: dict[str, object] = {"dataset": _first(rows, "dataset"), "models": ",".join(models)}
    if transcription:
        params["input"] = _first(rows, "input")
        params["separator"] = _first(rows, "separator")
    params.update(
        {
            "device": _first(rows, "device"),
            "gpuName": _first(rows, "gpuName"),
            "host": _first(rows, "host"),
            "clip": "",
            "nSongs": len(_unique(rows, "songId")),
            "nModels": len(models),
            "nErrors": sum(1 for r in rows if r.get("error")),
            "nSkipped": "",
        }
    )
    return params


def plan_benchmark(folder: Path, kind: str) -> FolderPlan:
    from ssaplash_ai.bench import report as sep_report
    from ssaplash_ai.bench.report import transcription_summary as ts
    from ssaplash_ai.bench.report import write_report, write_transcription_report

    transcription = kind == "transcription"
    experiment = TRANSCRIPTION_EXPERIMENT if transcription else EXPERIMENT_NAME
    plan = FolderPlan(folder, kind, experiment)
    csv_path = folder / "results.csv"
    rows = _rows(csv_path)
    run_ids = _unique(rows, "runId")
    if len(run_ids) != 1:
        plan.skip_reason = f"results.csv의 runId가 {len(run_ids)}개 (1개여야 함)"
        return plan
    artifacts = [csv_path]
    if transcription:
        summary = ts.summarize(ts.load_results([csv_path]))
        metrics = ts.summary_metrics_by_model(summary)
        hits_csv = folder / "hits_by_class.csv"
        if hits_csv.is_file():
            for model, values in ts.label_f1_metrics(ts.load_hits_by_class([csv_path])).items():
                metrics.setdefault(model, {}).update(values)
            artifacts.append(hits_csv)

        def make_reports(tmp: Path) -> list[Path]:
            return write_transcription_report([csv_path], tmp).all()

    else:
        summary = sep_report.summarize(sep_report.load_results([csv_path]))
        metrics = sep_report.summary_metrics_by_model(summary)

        def make_reports(tmp: Path) -> list[Path]:
            return write_report([csv_path], tmp).all()

    tags = _base_tags(folder)
    for r in rows:
        if r.get("model") and r.get("configHash"):
            tags[f"config_hash.{r['model']}"] = r["configHash"]
    # 결과 CSV를 복사해 지표를 다시 계산한 폴더(sep-quality-mdb-merged 등)는 CSV runId가 원본과 같음.
    # 원본과 다른 run이므로 폴더 이름을 runId로 쓰고 CSV 값은 태그로 남김
    run_id = run_ids[0]
    if folder.name != run_id:
        tags["csvRunId"] = run_id
        run_id = folder.name
    plan.runs.append(
        RunPlan(
            run_id=run_id,
            params=_bench_params(rows, transcription),
            metrics=metrics,
            artifacts=artifacts,
            tags=tags,
            make_reports=make_reports,
        )
    )
    return plan


RULES_ID_COLUMNS = ("candidate", "dataset")


def plan_rules(folder: Path) -> FolderPlan:
    """후보마다 run 1개. 지표는 데이터셋별 candidates.csv 한 줄. candidates.yaml이 있으면 규칙값도."""
    plan = FolderPlan(folder, "rules", RULES_EXPERIMENT)
    rows = _rows(folder / "candidates.csv")
    rules: dict[str, dict] = {}
    cand_yaml = folder / "candidates.yaml"
    if cand_yaml.is_file():
        from ssaplash_ai.bench.analysis.rule_eval import load_candidates

        rules = {c.name: c.full_rules for c in load_candidates([cand_yaml])}
    artifacts = [
        p
        for p in (folder / n for n in ("candidates.csv", "confusion.csv", "summary.md"))
        if p.is_file()
    ]
    if cand_yaml.is_file():
        artifacts.append(cand_yaml)
    for cand in _unique(rows, "candidate"):
        per_dataset: dict[str, dict[str, float]] = {}
        for r in rows:
            if r["candidate"] != cand:
                continue
            values = {k: _num(v) for k, v in r.items() if k not in RULES_ID_COLUMNS}
            per_dataset[r["dataset"]] = {k: v for k, v in values.items() if v is not None}
        params: dict[str, object] = {f"rules.{k}": v for k, v in rules.get(cand, {}).items()}
        params["candidate"] = cand
        params["datasets"] = ",".join(per_dataset)
        plan.runs.append(
            RunPlan(
                run_id=f"{folder.name}/{cand}",
                params=params,
                metrics=per_dataset,
                artifacts=artifacts,
                tags={**_base_tags(folder), "candidate": cand},
            )
        )
    return plan


def _param_value(value: object) -> object:
    if isinstance(value, list | dict):
        return json.dumps(value, ensure_ascii=False)
    return value


def plan_finetune(folder: Path) -> FolderPlan:
    """학습 폴더 하나 = run 하나. log.csv 한 줄 = step 하나(에폭 + 1, 학습 전 에폭 -1은 step 0)."""
    plan = FolderPlan(folder, "finetune", FINETUNE_EXPERIMENT)
    config = yaml.safe_load((folder / "config.yaml").read_text(encoding="utf-8")) or {}
    rows = _rows(folder / "log.csv")
    params: dict[str, object] = {
        k: _param_value(v) for k, v in config.items() if not str(k).startswith("_")
    }
    params["songsDigest"] = config.get("_songs_digest", "")
    params["baseCheckpoint"] = Path(str(config.get("_base_checkpoint", ""))).name
    select = str(config.get("select_metric", "tom_f1"))
    steps: list[tuple[int, dict[str, float]]] = []
    best: dict[str, float] = {}
    for r in rows:
        epoch = int(r["epoch"])
        values = {
            k: v
            for k, v in (
                (k, _num(r.get(k))) for k in r if k not in ("epoch", "step", "sec", "best")
            )
            if v is not None
        }
        values["train_step"] = float(r["step"])
        # best 열은 요약 지표 best/*와 이름이 겹쳐(파일 저장소에서 폴더·파일 충돌) is_best로
        values["is_best"] = 1.0 if r.get("best") == "1" else 0.0
        steps.append((epoch + 1, values))
        if r.get("best") == "1":
            best = {"epoch": float(epoch), select: values.get(f"val_{select}", math.nan)}
    metrics: dict[str, dict[str, float]] = {}
    if best:
        metrics["best"] = best
    reference = config.get("_reference") or {}
    if reference:
        metrics["reference"] = {k: float(v) for k, v in reference.items()}
    tags = _base_tags(folder)
    resumed = config.get("_resumed") or []
    if resumed:
        tags["resumed"] = ",".join(str(x.get("from_epoch")) for x in resumed)
    plan.runs.append(
        RunPlan(
            run_id=folder.name,
            params=params,
            metrics=metrics,
            artifacts=[folder / "best.pth", folder / "config.yaml", folder / "log.csv"],
            tags=tags,
            step_metrics=steps,
        )
    )
    return plan


def plan_adtof_eval(folder: Path) -> FolderPlan:
    """평가 폴더 하나 = run 하나. 지표 `{체크포인트}/{데이터셋}/{열}`. 같은 데이터셋에 같은 체크포인트
    이름이 여러 번 나오면(모두 best.pth 등) 나온 순서대로 `_1`, `_2`를 붙임 (지표 이름에 # 불가)."""
    plan = FolderPlan(folder, "adtof_eval", ADTOF_EVAL_EXPERIMENT)
    rows = _rows(folder / "summary.csv")
    metrics: dict[str, dict[str, float]] = {}
    seen: dict[tuple[str, str], int] = {}
    counts: dict[tuple[str, str], int] = {}
    for r in rows:
        key = (r["checkpoint"], r["dataset"])
        counts[key] = counts.get(key, 0) + 1
    labels: list[str] = []
    for r in rows:
        key = (r["checkpoint"], r["dataset"])
        seen[key] = seen.get(key, 0) + 1
        label = r["checkpoint"] if counts[key] == 1 else f"{r['checkpoint']}_{seen[key]}"
        labels.append(label)
        values = {k: _num(v) for k, v in r.items() if k not in ("checkpoint", "dataset")}
        metrics[f"{label}/{r['dataset']}"] = {k: v for k, v in values.items() if v is not None}
    artifacts = [p for p in (folder / "summary.csv", folder / "summary.md") if p.is_file()]
    plan.runs.append(
        RunPlan(
            run_id=folder.name,
            params={
                "checkpoints": ",".join(dict.fromkeys(labels)),
                "datasets": ",".join(_unique(rows, "dataset")),
                "nSongs": sum(int(_num(r.get("n_songs")) or 0) for r in rows),
            },
            metrics=metrics,
            artifacts=artifacts,
            tags=_base_tags(folder),
        )
    )
    return plan


def plan_folder(folder: Path) -> FolderPlan:
    folder = Path(folder)
    if not folder.is_dir():
        return FolderPlan(folder, None, skip_reason="폴더가 없음")
    kind = detect_kind(folder)
    if kind in ("separation", "transcription"):
        return plan_benchmark(folder, kind)
    if kind == "rules":
        return plan_rules(folder)
    if kind == "finetune":
        return plan_finetune(folder)
    if kind == "adtof_eval":
        return plan_adtof_eval(folder)
    return FolderPlan(
        folder, None, skip_reason="종류를 판별 못 함 (results.csv·candidates.csv 등 없음)"
    )


def relog(
    folders: Sequence[Path],
    tracking_uri: str | None = None,
    dry_run: bool = False,
    force: bool = False,
    recursive: bool = False,
    log: Callable[[str], None] = print,
) -> list[RelogOutcome]:
    """폴더들을 MLflow에 다시 기록. 폴더·run마다 결과를 돌려줌."""
    uri = tracking_uri or default_tracking_uri()
    outcomes: list[RelogOutcome] = []
    for folder in find_folders([Path(f) for f in folders], recursive):
        try:
            plan = plan_folder(folder)
        except Exception as e:  # 폴더 하나가 깨져도 나머지는 계속
            outcomes.append(RelogOutcome(folder, None, "", "", "실패", detail=f"읽기 오류: {e}"))
            log(f"[relog] {folder}: 읽기 오류 {e}")
            continue
        if plan.skip_reason:
            outcomes.append(
                RelogOutcome(
                    folder, plan.kind, plan.experiment, "", "건너뜀", detail=plan.skip_reason
                )
            )
            log(f"[relog] {folder}: 건너뜀 ({plan.skip_reason})")
            continue
        for run in plan.runs:
            n_metrics = sum(len(v) for v in run.metrics.values()) + sum(
                len(v) for _, v in run.step_metrics
            )
            detail = f"파라미터 {len(run.params)}개, 지표 {n_metrics}개"
            existing = None if force else find_run(run.run_id, plan.experiment, uri)
            if existing:
                outcomes.append(
                    RelogOutcome(
                        folder, plan.kind, plan.experiment, run.run_id, "건너뜀(중복)", existing
                    )
                )
                log(f"[relog] {plan.experiment} · {run.run_id}: 이미 있음 ({existing}), 건너뜀")
                continue
            if dry_run:
                outcomes.append(
                    RelogOutcome(
                        folder, plan.kind, plan.experiment, run.run_id, "기록 예정", "", detail
                    )
                )
                log(f"[relog] {plan.experiment} · {run.run_id}: 기록 예정 ({detail})")
                continue
            try:
                with tempfile.TemporaryDirectory() as tmp:
                    reports = run.make_reports(Path(tmp)) if run.make_reports else []
                    mlflow_id = log_run(
                        run_id=run.run_id,
                        params=run.params,
                        summary_metrics=run.metrics,
                        artifacts=[*run.artifacts, *reports],
                        tags=run.tags,
                        tracking_uri=uri,
                        experiment_name=plan.experiment,
                        step_metrics=run.step_metrics,
                    )
            except Exception as e:
                outcomes.append(
                    RelogOutcome(
                        folder, plan.kind, plan.experiment, run.run_id, "실패", detail=str(e)
                    )
                )
                log(f"[relog] {plan.experiment} · {run.run_id}: 실패 {e}")
                continue
            outcomes.append(
                RelogOutcome(
                    folder, plan.kind, plan.experiment, run.run_id, "기록", mlflow_id, detail
                )
            )
            log(f"[relog] {plan.experiment} · {run.run_id}: 기록 {mlflow_id} ({detail})")
    return outcomes


def copy_mlruns(
    source: Path,
    tracking_uri: str | None = None,
    dry_run: bool = False,
    force: bool = False,
    log: Callable[[str], None] = print,
) -> list[RelogOutcome]:
    """파일 저장소(source)의 run을 tracking_uri로 복사. 파라미터·지표 이력·태그·산출물·시각을 그대로 옮김."""
    from mlflow.entities import Metric, Param
    from mlflow.tracking import MlflowClient

    uri = tracking_uri or default_tracking_uri()
    src = MlflowClient(tracking_uri=_as_uri(str(source)))
    dst = MlflowClient(tracking_uri=_as_uri(uri))
    outcomes: list[RelogOutcome] = []
    for exp in src.search_experiments():
        for run in src.search_runs([exp.experiment_id], max_results=10000):
            name = run.info.run_name or run.info.run_id
            run_id = run.data.tags.get("runId", name)
            folder = Path(source)
            if name.startswith(SKIP_RUN_PREFIXES) or name.endswith(SKIP_SUFFIXES):
                outcomes.append(
                    RelogOutcome(folder, "mlruns", exp.name, run_id, "건너뜀", detail="확인용 run")
                )
                log(f"[relog] mlruns {exp.name} · {name}: 확인용이라 건너뜀")
                continue
            existing = None if force else find_run(run_id, exp.name, uri)
            if existing:
                outcomes.append(
                    RelogOutcome(folder, "mlruns", exp.name, run_id, "건너뜀(중복)", existing)
                )
                log(f"[relog] mlruns {exp.name} · {run_id}: 이미 있음 ({existing}), 건너뜀")
                continue
            detail = f"파라미터 {len(run.data.params)}개, 지표 {len(run.data.metrics)}종"
            if dry_run:
                outcomes.append(
                    RelogOutcome(folder, "mlruns", exp.name, run_id, "기록 예정", "", detail)
                )
                log(f"[relog] mlruns {exp.name} · {run_id}: 기록 예정 ({detail})")
                continue
            dst_exp = dst.get_experiment_by_name(exp.name)
            exp_id = dst_exp.experiment_id if dst_exp else dst.create_experiment(exp.name)
            tags = {k: v for k, v in run.data.tags.items() if not k.startswith("mlflow.")}
            tags.update({"runId": run_id, "relogged": "true", "source": "mlruns"})
            new = dst.create_run(exp_id, start_time=run.info.start_time, tags=tags, run_name=name)
            new_id = new.info.run_id
            metrics = [
                Metric(m.key, m.value, m.timestamp, m.step)
                for key in run.data.metrics
                for m in src.get_metric_history(run.info.run_id, key)
            ]
            params = [Param(k, v) for k, v in run.data.params.items()]
            dst.log_batch(new_id, metrics=metrics, params=params)
            with tempfile.TemporaryDirectory() as tmp:
                local = src.download_artifacts(run.info.run_id, "", tmp)
                if any(Path(local).iterdir()):
                    dst.log_artifacts(new_id, local)
            dst.set_terminated(new_id, end_time=run.info.end_time)
            outcomes.append(
                RelogOutcome(folder, "mlruns", exp.name, run_id, "기록", new_id, detail)
            )
            log(f"[relog] mlruns {exp.name} · {run_id}: 기록 {new_id} ({detail})")
    return outcomes


def outcome_table(outcomes: Sequence[RelogOutcome]) -> str:
    """끝에 찍는 표 (md)."""
    lines = [
        "| 폴더 | 실험 | runId | 결과 | MLflow run | 내용 |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for o in outcomes:
        lines.append(
            f"| {o.folder.as_posix()} | {o.experiment} | {o.run_id} | {o.status} | "
            f"{o.mlflow_run_id} | {o.detail} |"
        )
    counts: dict[str, int] = {}
    for o in outcomes:
        counts[o.status] = counts.get(o.status, 0) + 1
    lines.append("")
    lines.append(", ".join(f"{k} {v}" for k, v in counts.items()))
    return "\n".join(lines)
