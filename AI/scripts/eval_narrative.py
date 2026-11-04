"""LLM 총평 후보 모델 비교표 (설계 v0.6, U19).

같은 사실(골든 샘플 A·B와 이전 플레이 비교가 있는 경우)을 후보 모델마다 여러 번 쓰게 해서
가드레일 통과율, 재시도 필요 비율, 걸린 시간, 가장 흔한 위반을 표로 만들고 문장도 함께 남긴다.
통과율과 속도는 숫자로 비교할 수 있지만 **한국어 자연스러움과 코치다움은 사람이 문장을 읽어서 정해야 한다.**

모델 서버(Ollama 또는 OpenAI 호환 서버)가 이 PC(GPU 서버)에서 떠 있어야 한다. 외부 서비스·유료 API는 부르지 않는다.
모델 이름은 서버에 올라와 있는 이름이다(Ollama는 `ollama list`).

  uv run python scripts/eval_narrative.py --model <후보1> --model <후보2> --repeats 5 \\
      --url http://127.0.0.1:11434 --api ollama --out data/results/narrative-compare.md
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
import time
from collections import Counter
from pathlib import Path

from ssaplash_ai.coach import AnalysisRequest, analyze
from ssaplash_ai.coach.llm_local import SUPPORTED_APIS, LocalServerGenerator
from ssaplash_ai.coach.narrative import (
    Counts,
    History,
    NarrativeFacts,
    PreviousPlay,
    facts_from_analysis,
    write_narrative,
)

SAMPLES = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "coach" / "samples.json"


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
    model: str, cases: dict[str, NarrativeFacts], repeats: int, args: argparse.Namespace
) -> dict:
    generator = LocalServerGenerator(
        args.url, model, api=args.api, timeout_sec=args.timeout, temperature=args.temperature
    )
    rows, times, violations = [], [], Counter()
    passed = first_try = 0
    for case, facts in cases.items():
        for i in range(repeats):
            started = time.perf_counter()
            outcome = write_narrative(facts, generator)
            elapsed = time.perf_counter() - started
            times.append(elapsed)
            ok = outcome.text is not None
            passed += ok
            first_try += ok and outcome.attempts == 1
            for v in outcome.violations:
                violations[re.sub(r"['\d].*", "", v).strip()] += 1
            rows.append(
                (case, i + 1, ok, outcome.attempts, elapsed, outcome.text, outcome.violations)
            )
    total = len(cases) * repeats
    return {
        "model": model,
        "total": total,
        "passed": passed,
        "first_try": first_try,
        "median_sec": statistics.median(times) if times else 0.0,
        "max_sec": max(times) if times else 0.0,
        "violations": violations.most_common(5),
        "rows": rows,
    }


def render(results: list[dict]) -> str:
    lines = [
        "# LLM 총평 후보 모델 비교",
        "",
        "| 모델 | 통과 | 첫 시도 통과 | 시간 중앙값(초) | 최대(초) | 가장 흔한 위반 |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for r in results:
        top = ", ".join(f"{v}({n})" for v, n in r["violations"]) or "-"
        lines.append(
            f"| {r['model']} | {r['passed']}/{r['total']} | {r['first_try']}/{r['total']} "
            f"| {r['median_sec']:.1f} | {r['max_sec']:.1f} | {top} |"
        )
    lines += [
        "",
        "통과율과 속도는 숫자로 보고, **문장의 자연스러움은 아래 문장을 직접 읽어서** 판단한다.",
        "",
    ]
    for r in results:
        lines += [f"## {r['model']}", ""]
        for case, i, ok, attempts, elapsed, text, violations in r["rows"]:
            mark = "통과" if ok else "거절"
            lines.append(f"- **{case} #{i}** ({mark}, 시도 {attempts}, {elapsed:.1f}초)")
            lines.append(f"  - {text if ok else '; '.join(violations)}")
        lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "--model", action="append", required=True, help="후보 모델 이름(여러 번 지정)"
    )
    parser.add_argument("--url", default="http://127.0.0.1:11434")
    parser.add_argument("--api", choices=SUPPORTED_APIS, default="ollama")
    parser.add_argument("--repeats", type=int, default=5)
    parser.add_argument("--temperature", type=float, default=0.3)
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--out", type=Path, help="표를 저장할 .md (없으면 화면에만 출력)")
    args = parser.parse_args(argv)

    cases = build_cases()
    results = [run_model(model, cases, args.repeats, args) for model in args.model]
    text = render(results)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text, encoding="utf-8")
        print(f"저장: {args.out}")
    print(text.split("\n\n")[1] if "\n\n" in text else text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
