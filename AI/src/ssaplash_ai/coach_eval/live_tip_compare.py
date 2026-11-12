"""연주 중 LLM 구간 코칭 평가 (설계 COACH-001 연주 중 LLM 코칭 4.5절, L8).

골든 구간 사실(늦음·빠름·흔들림·패드 놓침·원인별·키보드·잘 친 구간 등)을 모델에 여러 번 쓰게 해서
가드레일 통과율, 첫 시도 통과율, 거절 이유, 지연 중앙값·95백분위를 잰다. 연주 중에는 응답이 다음 구간 안에 와야 해서
지연 95백분위가 통과율만큼 중요하다. **문구가 코치다운지, 사실과 맞는지는 사람이 읽어서 본다.** 그래서 문구 전체를 남긴다.

모델 서버(Ollama 또는 OpenAI 호환 서버)가 이 PC(GPU 서버)에서 떠 있어야 한다. 외부 서비스·유료 API는 부르지 않는다.

```
uv run python -m ssaplash_ai.coach_eval.live_tip_compare --model gemma3:4b --repeat 10 --out data/results/live-tip-compare.md
# 여러 모델을 같은 사실로 비교(모델마다 <out>-<모델>.md), MLflow에 기록(실험 coach-live-tip)
uv run python -m ssaplash_ai.coach_eval.live_tip_compare --model gemma3:4b gemma3:12b --mlflow
```

모델 서버 주소 기본값은 우리 Ollama(`127.0.0.1:11435`)다. GPU 서버 기본 포트 11434에는 다른 사용자의 Ollama가 떠 있다.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import statistics
import time
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path

from ssaplash_ai.coach.live_narrative import (
    SYSTEM_PROMPT,
    LiveSegmentFacts,
    TextGenerator,
    build_user_prompt,
    write_live_tip,
)
from ssaplash_ai.coach.llm_local import SUPPORTED_APIS, LocalServerGenerator

EXPERIMENT_NAME = "coach-live-tip"
DEFAULT_OUT = Path("data/results/live-tip-compare.md")
# 연주 중 목표(설계 6절, 확정 전): 통과 90% 이상, 지연 95백분위 4초 이하
TARGET_PASS = 0.9
TARGET_P95_MS = 4000
# 통과 문구 중 서로 다른 제목 비율. 같은 구령만 반복하지 않는지 본다(설계 COACH-001 각도·실측평가 6절)
TARGET_TITLE_VARIETY = 0.5
DEFAULT_URL = "http://127.0.0.1:11435"


def _facts(**over) -> LiveSegmentFacts:
    base = {
        "segment": {"index": 1, "fromBar": 5, "toBar": 8},
        "input": "stick",
        "counts": {"perfect": 14, "good": 10, "miss": 2},
        "timing": {"meanDeltaMs": 5.0, "stdDeltaMs": 15.0, "sameSignRatio": 0.5},
        "pads": [],
        "hands": {},
        "ruleCoach": {},
        "previous": {"counts": {"perfect": 14, "good": 10, "miss": 2}},
        "stage": 2,
    }
    base.update(over)
    return LiveSegmentFacts.model_validate(base)


def build_cases() -> dict[str, LiveSegmentFacts]:
    """골든 구간 사실 10가지. 같은 입력이면 같은 사실이다."""
    return {
        "늦음": _facts(
            timing={"meanDeltaMs": 32.0, "stdDeltaMs": 14.0, "sameSignRatio": 0.85},
            ruleCoach={"tags": ["LIVE_LATE"]},
        ),
        "빠름": _facts(
            timing={"meanDeltaMs": -30.0, "stdDeltaMs": 14.0, "sameSignRatio": 0.85},
            ruleCoach={"tags": ["LIVE_EARLY"]},
        ),
        "흔들림": _facts(
            timing={"meanDeltaMs": 4.0, "stdDeltaMs": 38.0, "sameSignRatio": 0.5},
            ruleCoach={"tags": ["LIVE_UNSTEADY"]},
        ),
        "패드 놓침": _facts(
            counts={"perfect": 12, "good": 6, "miss": 8},
            pads=[{"pad": "SMALL_TOM", "notes": 8, "misses": 6, "meanDeltaMs": None}],
            ruleCoach={"tags": ["LIVE_PAD_MISS"], "causes": ["WRONG_PAD"]},
            stage=3,
        ),
        "패드 이동": _facts(
            counts={"perfect": 12, "good": 8, "miss": 6},
            pads=[{"pad": "SNARE", "notes": 8, "misses": 5, "meanDeltaMs": 20.0}],
            ruleCoach={"tags": ["LIVE_PAD_MISS"], "causes": ["TRANSITION"]},
            stage=3,
        ),
        "빠른 구간": _facts(
            counts={"perfect": 10, "good": 8, "miss": 8},
            pads=[{"pad": "HIHAT", "notes": 14, "misses": 6, "meanDeltaMs": 10.0}],
            ruleCoach={"tags": ["LIVE_MISS_STREAK"], "causes": ["DENSE"]},
            stage=3,
        ),
        "늦어지다 놓침": _facts(
            timing={"meanDeltaMs": 28.0, "stdDeltaMs": 22.0, "sameSignRatio": 0.8},
            counts={"perfect": 10, "good": 10, "miss": 6},
            ruleCoach={"tags": ["LIVE_MISS_STREAK"], "causes": ["DRIFT_LATE"]},
            stage=3,
        ),
        "약한 손": _facts(
            hands={"weakHand": "LEFT", "ratio": 0.62}, ruleCoach={"tags": ["LIVE_HAND_WEAK"]}
        ),
        "키보드 늦음": _facts(
            input="keyboard",
            timing={"meanDeltaMs": 30.0, "stdDeltaMs": 12.0, "sameSignRatio": 0.85},
            ruleCoach={"tags": ["LIVE_LATE"]},
        ),
        "잘 친 구간": _facts(
            counts={"perfect": 24, "good": 4, "miss": 0},
            timing={"meanDeltaMs": 3.0, "stdDeltaMs": 9.0, "sameSignRatio": 0.5},
            previous={
                "counts": {"perfect": 18, "good": 8, "miss": 2},
                "lastTip": {"title": "스틱을 낮게", "sub": "높이는 주먹 하나만큼"},
            },
        ),
    }


@dataclass
class Trial:
    case: str
    passed: bool
    attempts: int
    ms: int
    title: str | None
    sub: str | None
    violations: list[str] = field(default_factory=list)
    # 거절됐을 때 마지막으로 거절된 문구. 왜 걸렸는지 사람이 읽어 보려고 남긴다
    rejectedTitle: str | None = None
    rejectedSub: str | None = None


@dataclass
class Summary:
    model: str
    trials: int
    passRate: float
    firstTryRate: float
    medianMs: float
    p95Ms: float
    violations: dict[str, int]
    titleVariety: float
    meetsTarget: bool


def percentile(xs: list[float], q: float) -> float:
    """최근접 순위 백분위. 빈 목록이면 nan"""
    if not xs:
        return math.nan
    s = sorted(xs)
    return float(s[max(0, math.ceil(q * len(s)) - 1)])


def run(
    generator: TextGenerator, repeat: int, cases: dict[str, LiveSegmentFacts] | None = None
) -> list[Trial]:
    trials: list[Trial] = []
    for name, facts in (cases or build_cases()).items():
        for _ in range(repeat):
            started = time.perf_counter()
            out = write_live_tip(facts, generator)
            ms = round((time.perf_counter() - started) * 1000)
            trials.append(
                Trial(
                    name,
                    out.tip is not None,
                    out.attempts,
                    ms,
                    out.tip.title if out.tip else None,
                    out.tip.sub if out.tip else None,
                    list(out.violations),
                    out.rejected.title if out.rejected else None,
                    out.rejected.sub if out.rejected else None,
                )
            )
    return trials


def summarize(model: str, trials: list[Trial]) -> Summary:
    n = len(trials)
    passed = [t for t in trials if t.passed]
    ms = [float(t.ms) for t in trials]
    reasons: Counter[str] = Counter()
    for t in trials:
        for v in t.violations:
            reasons[v.split(":")[0]] += 1
    pass_rate = len(passed) / n if n else 0.0
    p95 = percentile(ms, 0.95)
    variety = len({t.title for t in passed}) / len(passed) if passed else 0.0
    return Summary(
        model=model,
        trials=n,
        passRate=round(pass_rate, 4),
        firstTryRate=round(sum(t.attempts == 1 for t in passed) / n, 4) if n else 0.0,
        medianMs=float(statistics.median(ms)) if ms else math.nan,
        p95Ms=p95,
        violations=dict(reasons.most_common()),
        titleVariety=round(variety, 4),
        meetsTarget=pass_rate >= TARGET_PASS
        and p95 <= TARGET_P95_MS
        and variety >= TARGET_TITLE_VARIETY,
    )


def facts_brief(facts: LiveSegmentFacts) -> str:
    """보고서 표에 넣는 사실 한 줄(모델에 준 말 그대로). 사람이 문구가 사실과 맞는지 판정할 때 본다"""
    body = build_user_prompt(facts).removeprefix("사실:\n")
    return " / ".join(line.removeprefix("- ") for line in body.splitlines())


def markdown(
    summary: Summary, trials: list[Trial], cases: dict[str, LiveSegmentFacts] | None = None
) -> str:
    """`cases`를 주면(실제 기록 세트) 표에 사실 열과 사람 판정 빈칸을 더한다"""
    lines = [
        f"# 연주 중 LLM 구간 코칭 평가: {summary.model}",
        "",
        f"- 시도 {summary.trials}번, 통과 {summary.passRate:.0%}, 첫 시도 통과 {summary.firstTryRate:.0%}",
        f"- 지연 중앙값 {summary.medianMs:.0f} ms, 95백분위 {summary.p95Ms:.0f} ms",
        f"- 통과 문구의 서로 다른 제목 비율 {summary.titleVariety:.0%}",
        f"- 목표(통과 {TARGET_PASS:.0%} 이상, 95백분위 {TARGET_P95_MS} ms 이하, 제목 다양성 "
        f"{TARGET_TITLE_VARIETY:.0%} 이상): {'충족' if summary.meetsTarget else '미달'}",
        f"- 거절 이유: {summary.violations or '없음'}",
        "",
        "통과하지 못한 행의 제목·보조는 마지막으로 거절된 문구다(괄호 안은 공백 포함 글자 수).",
        "",
    ]
    if cases is None:
        lines += [
            "| 상황 | 통과 | 시도 | ms | 제목 | 보조 | 거절 이유 |",
            "| --- | --- | --- | --- | --- | --- | --- |",
        ]
    else:
        lines += [
            "사람 판정 칸: 맞음(사실과 맞음) · 쓸모(다음 마디에 따라 할 수 있음) · 반복(같은 말 되풀이)에 O/X를 적는다.",
            "",
            "| 구간 | 사실 | 통과 | 시도 | ms | 제목 | 보조 | 거절 이유 | 맞음 | 쓸모 | 반복 |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
    for t in trials:
        title = t.title if t.passed else t.rejectedTitle
        sub = t.sub if t.passed else t.rejectedSub
        shown_sub = f"{sub} ({len(sub)})" if sub and not t.passed else (sub or "")
        reasons = "; ".join(v.split(":")[0] for v in t.violations)
        row = (
            f"{'O' if t.passed else 'X'} | {t.attempts} | {t.ms} | {title or ''} | "
            f"{shown_sub} | {reasons}"
        )
        if cases is None:
            lines.append(f"| {t.case} | {row} |")
        else:
            lines.append(f"| {t.case} | {facts_brief(cases[t.case])} | {row} |  |  |  |")
    return "\n".join(lines) + "\n"


def log_mlflow(summary: Summary, trials: list[Trial], out: Path, tracking_uri: str | None) -> str:
    import os

    os.environ.setdefault("MLFLOW_DISABLE_AGENT_HINT", "1")
    import hashlib

    import mlflow

    from ssaplash_ai.coach_calibration.register import resolve_tracking_uri

    mlflow.set_tracking_uri(resolve_tracking_uri(tracking_uri))
    mlflow.set_experiment(EXPERIMENT_NAME)
    with mlflow.start_run(run_name=f"live-tip-{summary.model}") as r:
        mlflow.log_params(
            {
                "model": summary.model,
                "trials": summary.trials,
                "promptHash": hashlib.sha256(SYSTEM_PROMPT.encode("utf-8")).hexdigest()[:12],
            }
        )
        mlflow.log_metrics(
            {
                "passRate": summary.passRate,
                "firstTryRate": summary.firstTryRate,
                "titleVariety": summary.titleVariety,
                "medianMs": summary.medianMs,
                "p95Ms": summary.p95Ms,
            }
        )
        mlflow.set_tag("meetsTarget", str(summary.meetsTarget))
        mlflow.log_artifact(str(out))
        return r.info.run_id


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="연주 중 LLM 구간 코칭 평가")
    p.add_argument(
        "--model",
        required=True,
        nargs="+",
        help="모델 서버의 모델 이름(여러 개면 모델마다 따로 잰다)",
    )
    p.add_argument("--url", default=DEFAULT_URL, help="모델 서버 주소(기본: 우리 Ollama 11435)")
    p.add_argument("--api", choices=SUPPORTED_APIS, default="ollama")
    p.add_argument("--repeat", type=int, default=10, help="상황마다 몇 번 쓰게 할지")
    p.add_argument("--timeout", type=float, default=8.0, help="모델 한 번 호출의 시간 제한(초)")
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    p.add_argument(
        "--facts",
        type=Path,
        help="실제 기록 세트(live_real_set이 만든 real.jsonl·real-aim.jsonl). 없으면 골든 10가지",
    )
    p.add_argument("--sample", type=int, help="실제 기록 세트에서 무작위로 고를 구간 수")
    p.add_argument(
        "--seed", type=int, default=0, help="--sample의 난수 씨앗(세트끼리 같은 구간을 고른다)"
    )
    p.add_argument("--mlflow", action="store_true", help="MLflow 실험 coach-live-tip에 기록")
    p.add_argument("--tracking-uri")
    args = p.parse_args(argv)

    cases = None
    if args.facts is not None:
        from ssaplash_ai.coach_eval.live_real_set import load_cases

        cases = sample_cases(load_cases(args.facts), args.sample, args.seed)
    for model in args.model:
        # 운영 워커(`ssaplash-worker live-run`)와 같은 설정: 토큰 상한 80, JSON 출력
        generator = LocalServerGenerator(
            args.url, model, args.api, timeout_sec=args.timeout, max_tokens=80, json_output=True
        )
        trials = run(generator, args.repeat, cases)
        summary = summarize(model, trials)
        out = out_path(args.out, model, len(args.model))
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(markdown(summary, trials, cases), encoding="utf-8")
        out.with_suffix(".jsonl").write_text(
            "\n".join(json.dumps(asdict(t), ensure_ascii=False) for t in trials) + "\n",
            encoding="utf-8",
        )
        print(json.dumps(asdict(summary), ensure_ascii=False))
        if args.mlflow:
            print("MLflow run:", log_mlflow(summary, trials, out, args.tracking_uri))
    return 0


def sample_cases(
    cases: dict[str, LiveSegmentFacts], n: int | None, seed: int
) -> dict[str, LiveSegmentFacts]:
    """이름을 정렬한 뒤 씨앗으로 고른다. real과 real-aim은 이름이 같아서 같은 씨앗이면 같은 구간이 뽑힌다"""
    if n is None or n >= len(cases):
        return cases
    names = sorted(random.Random(seed).sample(sorted(cases), n))
    return {k: cases[k] for k in names}


def out_path(out: Path, model: str, models: int) -> Path:
    """모델이 하나면 그대로, 여럿이면 `<이름>-<모델>.md`. 모델 이름의 `:`·`/`는 `-`로 바꾼다"""
    if models == 1:
        return out
    safe = model.replace(":", "-").replace("/", "-")
    return out.with_name(f"{out.stem}-{safe}{out.suffix}")


if __name__ == "__main__":
    raise SystemExit(main())
