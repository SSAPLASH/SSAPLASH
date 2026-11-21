"""LLM 총평 후보 모델 비교와 MLflow 기록 (설계 v0.6, U19).

같은 사실(합의 샘플 A·B와 이전 플레이 비교가 있는 경우)을 후보 모델마다 여러 번 쓰게 해서 가드레일 통과율,
첫 시도 통과율, 걸린 시간을 표로 만든다. 통과율과 속도는 숫자로 비교할 수 있지만 **한국어 자연스러움과 코치다움은
사람이 문장을 읽어서 정해야 한다.** 그래서 문장 전체를 표와 JSONL로 남긴다.

모델 서버(Ollama 또는 OpenAI 호환 서버)가 이 PC(GPU 서버)에서 떠 있어야 한다. 외부 서비스·유료 API는 부르지 않는다.

MLflow(`--mlflow`): 모델 하나 = run 하나, 실험 이름 `coach-narrative`. bench와 같은 `log_run` 규약을 쓴다.
`--tracking-uri`를 주지 않으면 로컬 `mlruns/`에 쌓이고, 팀 서버에는 터널을 연 PC에서 `ssaplash-bench relog --from-mlruns`로 올린다
(`AI/README.md` "팀 MLflow에 기록하기"). 파라미터·태그에 프롬프트 해시와 분석기 버전, git 커밋을 남겨 같은 조건에서 다시 잴 수 있게 한다.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import statistics
import subprocess
import sys
import time
from collections import Counter
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

from ssaplash_ai.coach import AnalysisRequest, analyze
from ssaplash_ai.coach.config import ANALYZER_VERSION
from ssaplash_ai.coach.llm_local import SUPPORTED_APIS, LocalServerGenerator
from ssaplash_ai.coach.narrative import (
    SYSTEM_PROMPT,
    Counts,
    History,
    NarrativeFacts,
    PreviousPlay,
    TextGenerator,
    facts_from_analysis,
    write_narrative,
)

EXPERIMENT_NAME = "coach-narrative"
SAMPLES = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "coach" / "samples.json"
DEFAULT_OUT = Path("data/results/narrative-compare.md")


def build_cases() -> dict[str, NarrativeFacts]:
    """비교에 쓰는 사실 4개: 약점 있음, 약점 없음, 이전보다 좋아짐, 이전보다 나빠짐."""
    samples = json.loads(SAMPLES.read_text(encoding="utf-8"))
    a = analyze(AnalysisRequest.model_validate(samples["A"]["request"]))
    b = analyze(AnalysisRequest.model_validate(samples["B"]["request"]))
    counts_a, counts_b = Counts(perfect=14, good=8, miss=4), Counts(perfect=36, good=4, miss=0)

    def history(miss: int, perfect: int = 14, good: int = 8) -> History:
        return History(
            sameSongPlays=3,
            previous=PreviousPlay(
                counts=Counts(perfect=perfect, good=good, miss=miss), topPatterns=["TIMING_LATE"]
            ),
        )

    cases = {
        "약점 있음(이전 기록 없음)": facts_from_analysis(a, counts_a),
        "약점 없음(이전 기록 없음)": facts_from_analysis(b, counts_b),
        "이전보다 좋아짐": facts_from_analysis(a, counts_a, history(miss=12)),
        "이전보다 나빠짐": facts_from_analysis(a, counts_a, history(miss=1)),
    }
    return {name: facts for name, facts in cases.items() if facts is not None}


def run_model(
    model: str,
    cases: dict[str, NarrativeFacts],
    repeats: int,
    generator: TextGenerator,
) -> dict:
    rows: list[dict] = []
    times: list[float] = []
    violations: Counter[str] = Counter()
    passed = first_try = repaired = punctuated = errors = 0
    first_lengths: list[int] = []
    for case, facts in cases.items():
        for i in range(repeats):
            started = time.perf_counter()
            outcome = write_narrative(facts, generator)
            elapsed = time.perf_counter() - started
            times.append(elapsed)
            ok = outcome.text is not None
            passed += ok
            first_try += ok and outcome.attempts == 1 and not outcome.repaired
            repaired += outcome.repaired
            punctuated += outcome.punctuated
            if outcome.text:
                first_lengths.append(len(re.split(r"(?<=[.!?])\s+", outcome.text)[0]))
            errors += bool(outcome.violations) and outcome.violations[0].startswith("생성기 오류")
            for v in outcome.violations:
                violations[re.sub(r"['\d].*", "", v).strip()] += 1
            rows.append(
                {
                    "model": model,
                    "case": case,
                    "repeat": i + 1,
                    "ok": ok,
                    "repaired": outcome.repaired,
                    "punctuated": outcome.punctuated,
                    "attempts": outcome.attempts,
                    "seconds": round(elapsed, 3),
                    "text": outcome.text,
                    "violations": outcome.violations,
                    # 거절된 문장도 눈으로 볼 수 있게 마지막 시도의 원문을 남긴다
                    "lastText": outcome.last_text,
                }
            )
    total = len(cases) * repeats
    return {
        "model": model,
        "total": total,
        "passed": passed,
        "first_try": first_try,
        "repaired": repaired,
        "punctuated": punctuated,
        "first_len_median": statistics.median(first_lengths) if first_lengths else 0,
        "first_len_max": max(first_lengths) if first_lengths else 0,
        "errors": errors,
        "median_sec": statistics.median(times) if times else 0.0,
        "max_sec": max(times) if times else 0.0,
        "violations": violations.most_common(5),
        "n_violations": sum(violations.values()),
        "rows": rows,
    }


def render(results: list[dict]) -> str:
    lines = [
        "# LLM 총평 후보 모델 비교",
        "",
        "| 모델 | 통과 | 그대로 통과 | 문장 덜어내고 통과 | 마침표 붙임 | 첫 문장 글자 수(중앙값/최대) "
        "| 시간 중앙값(초) | 최대(초) | 가장 흔한 위반 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for r in results:
        top = ", ".join(f"{v}({n})" for v, n in r["violations"]) or "-"
        lines.append(
            f"| {r['model']} | {r['passed']}/{r['total']} | {r['first_try']}/{r['total']} "
            f"| {r['repaired']}/{r['total']} | {r['punctuated']}/{r['total']} "
            f"| {r['first_len_median']:.0f}/{r['first_len_max']} "
            f"| {r['median_sec']:.1f} | {r['max_sec']:.1f} | {top} |"
        )
    lines += [
        "",
        "통과율과 속도는 숫자로 보고, **문장의 자연스러움은 아래 문장을 직접 읽어서** 판단한다.",
        "",
    ]
    for r in results:
        lines += [f"## {r['model']}", ""]
        for row in r["rows"]:
            mark = ("덜어내고 통과" if row["repaired"] else "통과") if row["ok"] else "거절"
            lines.append(
                f"- **{row['case']} #{row['repeat']}** "
                f"({mark}, 시도 {row['attempts']}, {row['seconds']:.1f}초)"
            )
            lines.append(f"  - {row['text'] if row['ok'] else '; '.join(row['violations'])}")
            if not row["ok"] and row.get("lastText"):
                lines.append(f"  - (거절된 원문) {row['lastText']}")
        lines.append("")
    return "\n".join(lines)


def write_rows(results: list[dict], path: Path) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as f:
        for r in results:
            for row in r["rows"]:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")


def prompt_hash() -> str:
    return hashlib.sha256(SYSTEM_PROMPT.encode("utf-8")).hexdigest()[:12]


def _git_commit() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
            cwd=Path(__file__).resolve().parent,
        )
        return out.stdout.strip() or "unknown"
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def metric_key(model: str) -> str:
    """MLflow 지표 이름에 쓸 수 없는 글자(콜론 등)를 밑줄로 바꾼다."""
    return re.sub(r"[^A-Za-z0-9_.\-]", "_", model)


def log_to_mlflow(
    results: list[dict],
    args: argparse.Namespace,
    artifacts: list[Path],
    stamp: str,
    tracking_uri: str | None = None,
    experiment: str = EXPERIMENT_NAME,
) -> list[str]:
    """모델마다 run 하나를 기록하고 MLflow run id 목록을 돌려준다."""
    from ssaplash_ai.bench.runner.mlflow_tracking import log_run

    run_ids = []
    for r in results:
        total = max(r["total"], 1)
        key = metric_key(r["model"])
        metrics = {
            key: {
                "passRate": r["passed"] / total,
                "firstTryRate": r["first_try"] / total,
                "repairedRate": r["repaired"] / total,
                "punctuatedRate": r["punctuated"] / total,
                "firstSentenceMedianChars": float(r["first_len_median"]),
                "medianSec": r["median_sec"],
                "maxSec": r["max_sec"],
                "nViolations": float(r["n_violations"]),
            }
        }
        params = {
            "model": r["model"],
            "api": args.api,
            "temperature": args.temperature,
            "repeats": args.repeats,
            "nCases": r["total"] // max(args.repeats, 1),
            "analyzerVersion": ANALYZER_VERSION,
            "promptHash": prompt_hash(),
        }
        run_ids.append(
            log_run(
                run_id=f"{key}-{stamp}",
                params=params,
                summary_metrics=metrics,
                artifacts=artifacts,
                tags={
                    "gitCommit": _git_commit(),
                    "promptHash": prompt_hash(),
                    "analyzerVersion": ANALYZER_VERSION,
                },
                tracking_uri=tracking_uri,
                experiment_name=experiment,
            )
        )
    return run_ids


def main(
    argv: list[str] | None = None,
    generator_factory: Callable[..., TextGenerator] = LocalServerGenerator,
) -> int:
    parser = argparse.ArgumentParser(description="LLM 총평 후보 모델 비교")
    parser.add_argument(
        "--model", action="append", required=True, help="후보 모델 이름(여러 번 지정)"
    )
    parser.add_argument("--url", default="http://127.0.0.1:11434")
    parser.add_argument("--api", choices=SUPPORTED_APIS, default="ollama")
    parser.add_argument("--repeats", type=int, default=5)
    parser.add_argument("--temperature", type=float, default=0.3)
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--out", type=Path, help="표를 저장할 .md (문장은 같은 이름 .jsonl)")
    parser.add_argument("--mlflow", action="store_true", help="MLflow에도 기록한다")
    parser.add_argument(
        "--tracking-uri", help="MLflow 주소(없으면 MLFLOW_TRACKING_URI, 그것도 없으면 mlruns/)"
    )
    parser.add_argument("--experiment", default=EXPERIMENT_NAME)
    args = parser.parse_args(argv)

    out = args.out or (DEFAULT_OUT if args.mlflow else None)
    cases = build_cases()
    results = []
    for model in args.model:
        generator = generator_factory(
            args.url, model, api=args.api, timeout_sec=args.timeout, temperature=args.temperature
        )
        results.append(run_model(model, cases, args.repeats, generator))
    # 모델 서버가 꺼져 있거나 이름이 틀려 한 건도 못 쓴 모델이 있으면 표나 MLflow에 0%를 남기지 않고 멈춘다.
    # 쓰레기 기록이 팀 서버에 쌓이는 것을 막는다
    dead = [r["model"] for r in results if r["total"] and r["errors"] == r["total"]]
    if dead:
        print(
            f"모델 서버 오류로 한 건도 쓰지 못함: {', '.join(dead)}. 서버 주소({args.url})와 "
            "모델 이름, 서버가 켜져 있는지 확인하세요. 표와 MLflow에는 기록하지 않았습니다.",
            file=sys.stderr,
        )
        return 2
    text = render(results)
    artifacts: list[Path] = []
    if out:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text, encoding="utf-8")
        rows_path = out.with_suffix(".jsonl")
        write_rows(results, rows_path)
        artifacts = [out, rows_path]
        print(f"저장: {out}, {rows_path}")
    print(text.split("\n\n")[1] if "\n\n" in text else text)
    if args.mlflow:
        stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
        run_ids = log_to_mlflow(results, args, artifacts, stamp, args.tracking_uri, args.experiment)
        print(f"MLflow 기록: 실험 {args.experiment}, run {len(run_ids)}개")
    return 0
