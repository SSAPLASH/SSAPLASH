"""평가 결과 출력: 표(`results.md`), 집계(`results.json`), 그림, 예시 데이터, MLflow 기록."""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

from ssaplash_ai.coach import ANALYZER_VERSION, AnalysisRequest, analyze
from ssaplash_ai.coach_eval.chart import make_chart
from ssaplash_ai.coach_eval.metrics import (
    Cell,
    false_positive_by_pattern,
    summarize,
    summarize_by,
    wilson,
)
from ssaplash_ai.coach_eval.player import simulate
from ssaplash_ai.coach_eval.runner import RunResult
from ssaplash_ai.coach_eval.scenarios import SCENARIOS_BY_NAME

EXPERIMENT_NAME = "coach-weak-segments-eval"

# 예시 데이터: (시나리오, 강도 번호). 노트 60개라 요청 한 건이 수십 KB 이하다.
SAMPLE_PICKS = (
    ("TIMING_LATE", 2),
    ("PAD_LATE", 2),
    ("TRANSITION_MISS", 2),
    ("HAND_WEAK", 2),
    ("MISS_CLUSTER", 2),
    ("CLEAN_AVERAGE", 0),
)

LIMITS = """\
- 합성 분포는 실제 사용자와 다르다. 이 결과는 "규칙이 설계대로 동작하는가"의 근거이고 정확도·효과 주장이 아니다.
- 연주 모델이 정규분포 중심이라 실제 사용자의 비정규 패턴(손 떨림, 곡별 습관)은 반영되지 않았다.
- 판정 폭 안에 갇힌 오차는 평균·표준편차를 작게 만든다(판정 폭 밖 타격은 놓침과 여분 타격으로 기록되므로).
  큰 오차를 심어도 `UNSTEADY`·`TIMING_*`의 탐지율이 낮게 나올 수 있고, 놓침 계열 패턴이 이를 보완한다.
- 정상 로그에서 오탐이 적어도 "실제 약점이 있는 사용자를 잘 찾는다"가 입증된 것은 아니다.
- 키보드 입력(`stickId`가 null)에서는 `HAND_WEAK`을 평가하지 않았다.
- 정상 숙련도 3단계와 연주 모델 기본값은 가정값이며 실제 로그가 모이면 보정한다.
- 강도 단계는 규칙 임계값을 코드에서 읽지 않고 정했다. 임계값과의 관계는 사람이 표를 보고 해석한다.
"""


def _pct(rate: float, ci: tuple[float, float]) -> str:
    return f"{rate * 100:.0f}% ({ci[0] * 100:.0f}–{ci[1] * 100:.0f})"


def _ratio(ok: int, n: int) -> str:
    return f"{ok / n * 100:.0f}% ({ok}/{n})" if n else "—"


def _group_table(cells: list[Cell], unit: str) -> list[str]:
    """강도 행 × 조건(판정 폭·노트 수) 열의 탐지 횟수 표. 칸마다 시험 수가 작아 비율 대신 횟수를 쓴다."""
    groups = sorted({c.group for c in cells if c.group is not None})
    out = ["| 시나리오 | 강도 | " + " | ".join(f"{g:g}{unit}" for g in groups) + " |"]
    out.append("| --- | --- | " + " | ".join("---" for _ in groups) + " |")
    grid: dict[tuple[str, float], dict[float, Cell]] = defaultdict(dict)
    for c in cells:
        if c.kind == "PLANTED":
            grid[(c.scenario, c.strength)][c.group] = c
    for (name, strength), row in grid.items():
        cols = [f"{row[g].detected}/{row[g].n}" if g in row else "—" for g in groups]
        out.append(f"| `{name}` | {strength:g} | " + " | ".join(cols) + " |")
    return out


def render_markdown(
    result: RunResult, perf: list[dict] | None, smoke: list[dict] | None, date: str
) -> str:
    cfg = result.config
    cells = summarize(result.trials)
    by_good = summarize_by(result.trials, "good_ms")
    out = [
        "# 약점 분석 합성 평가 결과 (표)",
        "",
        "이 파일은 `python -m ssaplash_ai.coach_eval.cli`가 만든다. 해석은 같은 폴더의 `summary.md`에 있다.",
        "",
        "| 항목 | 값 |",
        "| --- | --- |",
        f"| 실행일 | {date} |",
        f"| `analyzerVersion` | `{ANALYZER_VERSION}` |",
        f"| 시나리오·강도마다 시험 횟수 | {cfg.seeds} |",
        f"| 노트 수(시험마다 번갈아) | {', '.join(map(str, cfg.note_counts))} |",
        f"| `goodMs`(시험마다 번갈아) | {', '.join(f'{g:g}' for g in cfg.good_ms_values)} |",
        f"| 기본 시드 | {cfg.base_seed} |",
        f"| 총 시험 수 | {len(result.trials)} |",
        f"| 소요 시간 | {result.elapsed_sec:.1f}초 |",
        "",
        "신뢰구간은 95% 윌슨 구간이다. 위치는 구간형 패턴만, 패드는 기대 패드가 있는 패턴만 센다(탐지된 시험 중 비율).",
        "",
        "## 1. 약점을 심은 로그의 탐지율",
        "",
        "| 시나리오 | 강도 | 탐지율 (95% 구간) | 위치 일치 | 패드 일치 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for c in cells:
        if c.kind != "PLANTED":
            continue
        unit = SCENARIOS_BY_NAME[c.scenario].strength_unit
        loc = _ratio(c.location_ok, c.location_n) if c.location_n else "—"
        pads = _ratio(c.pads_ok, c.pads_n) if c.pads_n else "—"
        out.append(
            f"| `{c.scenario}` | {c.strength:g} ({unit}) | {_pct(c.detection_rate, c.detection_ci)}"
            f" | {loc} | {pads} |"
        )

    out += ["", "## 2. 판정 폭(`goodMs`)별 탐지율", ""]
    out.append(
        "같은 강도(× `goodMs`)에서 `goodMs`가 달라도 탐지율이 비슷해야 임계값이 `goodMs`에 비례해 동작한다는 뜻이다."
    )
    out.append("")
    out += _group_table(by_good, "ms")

    out += ["", "## 3. 노트 수별 탐지율", ""]
    out.append(
        "노트가 적으면 패드·전환마다 유효 타격이 모자라 조건을 못 채우고, 많으면 후보가 늘어 최대 5개 선택에서 밀릴 수 있다."
    )
    out.append("")
    out += _group_table(summarize_by(result.trials, "n_notes"), "개")

    out += ["", "## 4. 교차 반응 (기대 밖 pattern이 함께 나온 비율)", ""]
    out.append("| 시나리오 | 강도 | 함께 나온 pattern (시험 수 기준) | 허용 목록 |")
    out.append("| --- | --- | --- | --- |")
    for c in cells:
        if c.kind != "PLANTED" or not (c.cross_counts or c.allowed_counts):
            continue
        cross = ", ".join(f"`{p}` {k}/{c.n}" for p, k in sorted(c.cross_counts.items())) or "—"
        allowed = ", ".join(f"`{p}` {k}/{c.n}" for p, k in sorted(c.allowed_counts.items())) or "—"
        out.append(f"| `{c.scenario}` | {c.strength:g} | {cross} | {allowed} |")

    out += ["", "## 5. 정상 로그의 오탐", ""]
    out.append("| 숙련도 | 오탐률 (95% 구간) | 나온 pattern |")
    out.append("| --- | --- | --- |")
    clean = [c for c in cells if c.kind == "CLEAN"]
    for c in clean:
        pats = ", ".join(f"`{p}` {k}/{c.n}" for p, k in sorted(c.pattern_counts.items())) or "—"
        out.append(f"| `{c.scenario}` | {_pct(c.fp_rate, c.fp_ci)} | {pats} |")
    total_n = sum(c.n for c in clean)
    total_fp = sum(c.false_positive for c in clean)
    out.append(
        f"| 합계 | {_pct(total_fp / total_n if total_n else 0, wilson(total_fp, total_n))} | |"
    )
    out += ["", "pattern별 오탐(정상 로그 전체 기준):", ""]
    for p, (k, n) in false_positive_by_pattern(cells).items():
        out.append(f"- `{p}`: {k}/{n}")

    if perf:
        out += ["", "## 6. 응답 시간", ""]
        out.append("목표는 5,000건 1초, 50,000건 3초이고 BE 응답 제한은 3초다.")
        out.append("")
        out.append("| 타격 행 수 | 검증(초) | 분석(초) |")
        out.append("| --- | --- | --- |")
        for row in perf:
            out.append(f"| {row['hits']:,} | {row['validateSec']} | {row['analyzeSec']} |")

    if smoke:
        out += ["", "## 7. 서버 처리 함수 경유 확인", ""]
        out.append("| playId | 상태 | 직접 호출과 같음 |")
        out.append("| --- | --- | --- |")
        for row in smoke:
            out.append(
                f"| `{row['playId']}` | {row['status']} | {'예' if row['same'] else '아니오'} |"
            )

    out += ["", "## 한계", "", LIMITS]
    return "\n".join(out) + "\n"


def results_dict(result: RunResult, perf, smoke) -> dict:
    cells = summarize(result.trials)

    def cell_row(c: Cell) -> dict:
        row = {
            "scenario": c.scenario,
            "kind": c.kind,
            "strength": c.strength,
            "n": c.n,
        }
        if c.kind == "CLEAN":
            row |= {"falsePositive": c.false_positive, "fpRate": round(c.fp_rate, 4)}
            row["patterns"] = dict(c.pattern_counts)
        else:
            row |= {
                "detected": c.detected,
                "detectionRate": round(c.detection_rate, 4),
                "detectionCi": [round(v, 4) for v in c.detection_ci],
                "locationOk": [c.location_ok, c.location_n],
                "padsOk": [c.pads_ok, c.pads_n],
                "cross": dict(c.cross_counts),
                "allowed": dict(c.allowed_counts),
            }
        return row

    return {
        "analyzerVersion": ANALYZER_VERSION,
        "config": {
            "seeds": result.config.seeds,
            "noteCounts": list(result.config.note_counts),
            "goodMsValues": list(result.config.good_ms_values),
            "baseSeed": result.config.base_seed,
        },
        "trials": len(result.trials),
        "cells": [cell_row(c) for c in cells],
        "falsePositiveByPattern": {
            p: {"count": k, "trials": n} for p, (k, n) in false_positive_by_pattern(cells).items()
        },
        "performance": perf,
        "serverSmoke": smoke,
    }


def write_sensitivity_plot(result: RunResult, path: Path) -> None:
    """강도 단계별 탐지율 곡선. 글꼴 문제를 피해 영문 이름만 쓴다."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    cells = [c for c in summarize(result.trials) if c.kind == "PLANTED"]
    names = list(dict.fromkeys(c.scenario for c in cells))
    cols = 3
    rows = -(-len(names) // cols)
    fig, axes = plt.subplots(rows, cols, figsize=(11, 2.6 * rows), sharey=True)
    for ax, name in zip(axes.flat, names, strict=False):
        mine = [c for c in cells if c.scenario == name]
        xs = list(range(1, len(mine) + 1))
        ys = [c.detection_rate for c in mine]
        lo = [max(0.0, c.detection_rate - c.detection_ci[0]) for c in mine]
        hi = [max(0.0, c.detection_ci[1] - c.detection_rate) for c in mine]
        ax.errorbar(xs, ys, yerr=[lo, hi], marker="o", capsize=3)
        ax.set_title(name, fontsize=9)
        ax.set_xticks(xs, [f"{c.strength:g}" for c in mine])
        ax.set_ylim(-0.05, 1.05)
        ax.grid(alpha=0.3)
    for ax in list(axes.flat)[len(names) :]:
        ax.axis("off")
    fig.supxlabel("planted strength (scenario-specific unit)")
    fig.supylabel("detection rate (95% Wilson)")
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)


def write_samples(out_dir: Path) -> list[dict]:
    """예시 요청·응답 쌍을 저장하고 요청 목록을 돌려준다(서버 경유 확인에 쓴다)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    requests = []
    for name, strength_index in SAMPLE_PICKS:
        scenario = SCENARIOS_BY_NAME[name]
        strength = scenario.strengths[strength_index]
        chart = make_chart(60, scenario.layout, seed=7)
        play = simulate(chart, scenario.build(strength, chart), good_ms=50.0, seed=7)
        play.request["playId"] = f"sample-{name.lower().replace('_', '-')}"
        response = analyze(AnalysisRequest.model_validate(play.request))
        payload = {
            "scenario": name,
            "strength": strength,
            "strengthUnit": scenario.strength_unit,
            "request": play.request,
            "response": response.model_dump(exclude_none=True),
        }
        (out_dir / f"{name.lower()}.json").write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
        )
        requests.append(play.request)
    return requests


def log_to_mlflow(
    result: RunResult,
    perf: list[dict] | None,
    artifacts: list[Path],
    run_name: str,
    tracking_uri: str | None = None,
) -> str:
    """실행 1회를 MLflow run 하나로 기록한다. 기록 방식은 bench와 같은 `log_run`을 쓴다."""
    from ssaplash_ai.bench.runner.mlflow_tracking import log_run

    cells = summarize(result.trials)
    recall = {
        f"{c.scenario}/{c.strength:g}": c.detection_rate for c in cells if c.kind == "PLANTED"
    }
    fp = {c.scenario: c.fp_rate for c in cells if c.kind == "CLEAN"}
    metrics: dict[str, dict[str, float]] = {"recall": recall, "fpRate": fp}
    if perf:
        metrics["analyzeSec"] = {f"hits{r['hits']}": r["analyzeSec"] for r in perf}
    params = {
        "analyzerVersion": ANALYZER_VERSION,
        "seeds": result.config.seeds,
        "noteCounts": ",".join(map(str, result.config.note_counts)),
        "goodMsValues": ",".join(f"{g:g}" for g in result.config.good_ms_values),
        "baseSeed": result.config.base_seed,
        "trials": len(result.trials),
    }
    return log_run(
        run_id=run_name,
        params=params,
        summary_metrics=metrics,
        artifacts=artifacts,
        tracking_uri=tracking_uri,
        experiment_name=EXPERIMENT_NAME,
    )
