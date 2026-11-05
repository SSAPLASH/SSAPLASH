"""평가 결과를 R3 진입 판단 보고서로 정리한다(설계 문서 부록 B.7·B.10, 작업 8).

보고서는 진입 판단표를 채우고 **계속 / 중단 / 판단 보류 / 판단하지 않음** 중 하나를 권고한다. 표본이 작거나 합성 데이터인데
기준을 넘었다고 "계속"이라고 말하지 않도록 데이터가 충분한지부터 따진다.

| 권고 | 언제 |
| --- | --- |
| `HARNESS_ONLY` | 출처 단계가 P0(합성)이다. 합성 데이터의 점수는 모델의 실제 성능이 아니라 판단하지 않는다 |
| `INSUFFICIENT_DATA` | 일반(warm) 시험 목표나 새 곡(cold) 시험 목표가 기준 건수보다 적다 |
| `CONTINUE` | 데이터가 충분하고 후보 중 하나 이상이 진입 기준을 모두 넘는다 |
| `STOP` | 데이터가 충분한데 어떤 후보도 기준을 넘지 못한다. R1+R2로 간다 |

보고서에는 집계 값만 담는다(사용자 키·연주 단위 값 없음).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from ssaplash_ai.recommend import schema as S
from ssaplash_ai.recommend.evaluate import GateConfig, Report, entry_gate
from ssaplash_ai.recommend.mlflow_log import git_commit

CANDIDATE_PREFIXES = ("M4", "M5", "M6")
BASELINE_PREFIXES = ("M0", "M1", "M2", "M3")
HARNESS_ONLY, INSUFFICIENT_DATA, CONTINUE, STOP = (
    "HARNESS_ONLY",
    "INSUFFICIENT_DATA",
    "CONTINUE",
    "STOP",
)
VERDICT_KO = {
    HARNESS_ONLY: "판단하지 않음(합성 데이터)",
    INSUFFICIENT_DATA: "판단 보류(시험 표본 부족)",
    CONTINUE: "R3 계속",
    STOP: "R3 중단 권고(R1+R2로 진행)",
}


@dataclass(frozen=True)
class DecisionConfig:
    """판단 기준. 수치는 가정값이며 설계 미결 U21에서 확정한다."""

    min_warm_targets: int = 500
    min_cold_targets: int = 30
    gate: GateConfig = field(default_factory=GateConfig)


@dataclass(frozen=True)
class Decision:
    verdict: str
    reasons: list[str]
    gates: dict[str, dict]  # 후보 이름 → entry_gate 결과(참고용으로 항상 계산)
    candidates: list[str]
    baselines: list[str]
    cold_reference: str


def _names(report: Report, prefixes: tuple[str, ...]) -> list[str]:
    return [n for n in report.results if n.startswith(prefixes)]


def decide(report: Report, cfg: DecisionConfig | None = None) -> Decision:
    cfg = cfg or DecisionConfig()
    candidates, baselines = _names(report, CANDIDATE_PREFIXES), _names(report, BASELINE_PREFIXES)
    cold_reference = next((n for n in baselines if n.startswith("M2")), None)
    if not candidates or not baselines or cold_reference is None:
        raise ValueError(
            "보고서에는 기준선(M0~M3 중 M2 포함)과 후보(M4·M5·M6)가 모두 있어야 합니다."
        )
    gates = {
        c: entry_gate(report, c, baselines, cold_reference=cold_reference, cfg=cfg.gate)
        for c in candidates
    }

    reference = report.results[baselines[0]].metrics
    n_warm, n_cold = int(reference["n_warm"]), int(reference["n_cold"])
    reasons: list[str] = []
    if report.stage == S.STAGE_SYNTHETIC:
        reasons.append(
            "출처 단계가 P0(합성)라 점수는 모델의 실제 성능이 아니다. 하니스가 맞게 도는지만 확인한 결과다."
        )
        verdict = HARNESS_ONLY
    else:
        if n_warm < cfg.min_warm_targets:
            reasons.append(
                f"일반 시험 목표 {n_warm}건 < 기준 {cfg.min_warm_targets}건: 신뢰구간이 너무 넓어 판단할 수 없다."
            )
        if n_cold < cfg.min_cold_targets:
            reasons.append(
                f"새 곡 시험 목표 {n_cold}건 < 기준 {cfg.min_cold_targets}건: 새 곡 기준을 판단할 수 없다."
            )
        passed = [c for c, g in gates.items() if g["passed"]]
        if reasons:
            verdict = INSUFFICIENT_DATA
        elif passed:
            verdict = CONTINUE
            reasons.append(f"진입 기준을 모두 넘은 후보: {', '.join(passed)}")
        else:
            verdict = STOP
            reasons.append("데이터는 충분하지만 어떤 후보도 진입 기준을 모두 넘지 못했다.")
            reasons += [
                f"{c}: 탈락 항목 {', '.join(k for k, v in g['checks'].items() if not v['passed'])}"
                for c, g in gates.items()
            ]
    return Decision(verdict, reasons, gates, candidates, baselines, cold_reference)


# ---------------------------------------------------------------- Markdown


def _pct(value: float | None, digits: int = 1) -> str:
    return "-" if value is None or not math.isfinite(value) else f"{value * 100:.{digits}f}%"


def _num(value: float | None, digits: int = 3) -> str:
    return "-" if value is None or not math.isfinite(value) else f"{value:.{digits}f}"


def _ci(m: dict[str, float], key: str) -> str:
    return f"{_num(m[key])} [{_num(m[key + '_ci_low'])}, {_num(m[key + '_ci_high'])}]"


def _table(header: list[str], rows: list[list[str]]) -> list[str]:
    lines = ["| " + " | ".join(header) + " |", "| " + " | ".join("---" for _ in header) + " |"]
    return lines + ["| " + " | ".join(r) + " |" for r in rows]


def to_markdown(report: Report, decision: Decision, cfg: DecisionConfig | None = None) -> str:
    cfg = cfg or DecisionConfig()
    d = report.data_summary
    ref = report.results[decision.baselines[0]].metrics
    out = ["# 곡 추천 R3 PoC 결과 보고서", ""]
    out += (
        ["## 권고", "", f"**{VERDICT_KO[decision.verdict]}**", ""]
        + [f"- {r}" for r in decision.reasons]
        + [""]
    )

    out += ["## 데이터", ""]
    out += _table(
        ["항목", "값"],
        [
            ["출처 단계", report.stage],
            ["데이터 해시", str(report.data_hash)[:12]],
            ["분할 기준 시각(cutoff)", report.cutoff],
            [
                "사용자 / 곡 / 채보",
                f"{d.get('users', '-')} / {d.get('songs', '-')} / {d.get('charts', '-')}",
            ],
            ["연주 기록", str(d.get("interactions", "-"))],
            ["시험 목표 일반(warm) / 새 곡(cold)", f"{int(ref['n_warm'])} / {int(ref['n_cold'])}"],
            ["학습 구간에 없던 새 곡 수", str(report.n_cold_songs)],
            [
                "판단에 필요한 최소 시험 목표",
                f"warm {cfg.min_warm_targets} / cold {cfg.min_cold_targets}",
            ],
        ],
    ) + [""]

    k = report.config.k
    out += [f"## 방법별 결과 (k={k}, 95% 부트스트랩 신뢰구간)", ""]
    rows = []
    for name, r in report.results.items():
        m = r.metrics
        rows.append(
            [
                name,
                _ci(m, "recall_warm"),
                _num(m["ndcg_warm"]),
                _ci(m, "recall_cold"),
                _num(m["coverage"], 2),
                _pct(m["cold_item_share"]),
                _pct(m["violation_rate"]),
            ]
        )
    out += _table(
        [
            "방법",
            f"Recall@{k} 일반",
            f"NDCG@{k} 일반",
            f"Recall@{k} 새 곡",
            "커버리지",
            "새 곡 비중",
            "하드 제외 위반율",
        ],
        rows,
    ) + [""]

    out += [
        "## 진입 판단",
        "",
        f"기준(가정값): warm NDCG가 가장 좋은 기준선보다 상대 +{cfg.gate.min_relative_gain:.0%} 이상(신뢰구간 하한 > 0), "
        f"새 곡 Recall이 {decision.cold_reference} 이상, 하드 제외 위반율 {cfg.gate.max_violation_rate:.0%} 이하.",
        "",
    ]
    for name, gate in decision.gates.items():
        c = gate["checks"]
        w, cold, safe = c["warm_ndcg_gain"], c["cold_recall"], c["violation_rate"]
        out += [f"### {name}: {'통과' if gate['passed'] else '탈락'}", ""]
        out += _table(
            ["항목", "값", "통과"],
            [
                [
                    f"warm NDCG 상대 개선(vs {w['best_baseline']})",
                    f"{_pct(w['relative'])} [{_pct(w['ci_low'])}, {_pct(w['ci_high'])}]",
                    "예" if w["passed"] else "아니오",
                ],
                [
                    f"새 곡 Recall(vs {cold['reference_name']})",
                    f"{_num(cold['candidate'])} vs {_num(cold['reference'])}",
                    "예" if cold["passed"] else "아니오",
                ],
                ["하드 제외 위반율", _pct(safe["value"], 2), "예" if safe["passed"] else "아니오"],
            ],
        ) + [""]

    out += ["## 해석할 때 주의", ""]
    notes = [
        "분할은 시간순 한 번이고 실행도 한 번이다. 다른 분할·시드에서는 값이 흔들릴 수 있다(합성 데이터 3개 시드에서 상대 개선이 +2%에서 +39%까지 움직였다).",
        f"새 곡 시험은 {int(ref['n_cold'])}건이라 한두 건 차이로 기준 통과 여부가 바뀐다. 신뢰구간을 함께 보라.",
        "기본 하이퍼파라미터는 합성 데이터의 검증 구간에서 골랐다. 실데이터에서는 `tuning.tune`으로 다시 골라야 한다(시험 구간으로 고르면 누수).",
        "R1 규칙(M1)은 서비스와 달리 리포트의 약점 구간이 아니라 정확도와 패드 비율로 약한 패드를 근사한다(docs/recommend-poc.md).",
    ]
    if report.stage == S.STAGE_SYNTHETIC:
        notes.insert(
            0,
            "**합성 데이터의 점수는 모델의 실제 성능이 아니다.** 합성 세계는 취향·실력 적합도·인기 세 요인으로 만들어, 그 구조를 잘 잡는 방법이 좋게 나온다.",
        )
    out += [f"- {n}" for n in notes] + [""]

    out += [
        "## 재현 정보",
        "",
        f"- 코드 커밋 {git_commit()}, 시드 {report.config.seed}, 부트스트랩 {report.config.bootstrap}회, 보고서 해시 {report.digest()[:12]}",
        "",
    ]
    params = [
        [n, ", ".join(f"{k}={v}" for k, v in p.items())]
        for n, p in report.model_params.items()
        if p
    ]
    if params:
        out += ["### 방법별 하이퍼파라미터", ""] + _table(["방법", "설정"], params) + [""]
    return "\n".join(out)
