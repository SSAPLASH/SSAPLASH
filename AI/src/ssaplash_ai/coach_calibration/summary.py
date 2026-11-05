"""사람이 MLflow에서 검토할 요약(`summary.md`). 가려진 기록값만 쓰므로 개인 단위 값이 들어가지 않는다."""

from __future__ import annotations

from typing import Any

from ssaplash_ai.coach_calibration.candidates import (
    CHANGE,
    INSUFFICIENT_SAMPLE,
    KEEP,
    NO_TARGET,
    OUT_OF_REACH,
)

_STATUS_TEXT = {
    NO_TARGET: "정책에 목표 범위 없음(분포만 기록)",
    KEEP: "현재 값 유지(이미 목표 범위 안)",
    CHANGE: "변경 후보 있음",
    OUT_OF_REACH: "허용 변경 폭 안에서는 목표에 닿지 못함",
}


def _fmt_rate(record: dict[str, Any]) -> str:
    if record["rate"] is None:
        upper = record.get("upperBound")
        return f"가림(5건 미만, {upper * 100:.0f}% 이하)" if upper is not None else "—"
    lo, hi = record["ci"]
    return f"{record['rate'] * 100:.0f}% ({lo * 100:.0f}–{hi * 100:.0f})"


def render_summary(
    *,
    date: str,
    decision_reason: str,
    new_sessions: int,
    view_sessions: int,
    counts: dict[str, int],
    profiles: dict[str, dict[str, Any]],
    candidates: dict[str, Any],
    reeval: dict[str, Any] | None,
    policy_targets: dict[str, Any],
    approval: str,
    since: str | None = None,
    modes: frozenset[str] | None = None,
) -> str:
    out = [
        f"# 약점 분석 실측 보정 요약 ({date})",
        "",
        "이 기록은 **제안**입니다. 임계값은 자동으로 바뀌지 않고, 아래 승인 절차를 거친 뒤 MR로만 바뀝니다.",
        "집계만 담았고 개인 단위 값은 없습니다. 5건 미만의 작은 집계는 가렸습니다.",
        "",
        "## 실행 정보",
        "",
        "| 항목 | 값 |",
        "| --- | --- |",
        f"| 실행 이유 | {decision_reason} (새로 쌓인 세션 {new_sessions}) |",
        f"| 뷰의 세션 수 | {view_sessions} |",
        f"| 기간 | {f'{since} 이후' if since else '전체'} |",
        f"| 모드 | {', '.join(sorted(modes)) if modes else '전체'} |",
        f"| 표본 상태 | {candidates['status']} |",
        f"| 승인 상태 | `{approval}` |",
        "",
        "## 제외 현황",
        "",
        "| 이유 | 건수 |",
        "| --- | --- |",
    ]
    for key, value in counts.items():
        out.append(f"| {key} | {value} |")

    for group, rec in profiles.items():
        out += ["", f"## 걸림 비율: {group}", ""]
        if rec["nSessions"] == 0:
            out.append("해당하는 세션이 없습니다.")
            continue
        out.append(
            f"세션 {rec['nSessions']}개, 노트 {rec['nNotes']}개, 세션당 평균 구간 {rec['meanSegments']}개."
        )
        out += ["", "| pattern | 걸린 세션 비율 (95% 구간) |", "| --- | --- |"]
        out.append(f"| (하나라도) | {_fmt_rate(rec['anyFlag'])} |")
        for pattern, fr in rec["flagRates"].items():
            out.append(f"| `{pattern}` | {_fmt_rate(fr)} |")

    out += ["", "## 임계값 후보", ""]
    if candidates["status"] == INSUFFICIENT_SAMPLE:
        out.append(
            "표본이 `min_sample`보다 적어 후보도 what-if도 만들지 않았습니다. 세션이 더 쌓이면 다시 실행됩니다."
        )
    else:
        out += [
            f"정책 목표: {policy_targets or '없음(첫 실행은 분포만 보고 담당자가 정합니다)'}",
            "",
            "| 그룹 | 임계값 | 현재 걸림 | 목표 | 상태 | 후보 값 | 후보 걸림 |",
            "| --- | --- | --- | --- | --- | --- | --- |",
        ]
        for group, rec in candidates["groups"].items():
            target = f"{rec['target'][0]:.2f}–{rec['target'][1]:.2f}" if rec["target"] else "—"
            cand_value = rec["candidateValue"] if rec["candidateValue"] is not None else "—"
            cand_rate = _fmt_rate(rec["candidate"]) if rec["candidate"] else "—"
            out.append(
                f"| {group} | `{rec['field']}` {rec['currentValue']} | {_fmt_rate(rec['current'])} | {target} "
                f"| {_STATUS_TEXT[rec['status']]} | {cand_value} | {cand_rate} |"
            )
        out += ["", "what-if 표(임계값을 바꿨을 때 걸림 비율)는 `candidates.json`에 있습니다."]

    if reeval is not None:
        out += [
            "",
            "## 합성 평가(139 도구)로 후보 재평가",
            "",
            f"- 탐지율이 가장 많이 떨어진 크기: {reeval['worstRecallDrop'] * 100:.0f}%p",
            f"- 정상 로그 오탐률이 가장 많이 오른 크기: {reeval['worstFpRise'] * 100:.0f}%p",
            "- 세부는 `reeval.json`에 있습니다. 실측 걸림이 좋아져도 합성 탐지율이 크게 떨어지면 후보를 조정하세요.",
        ]

    out += [
        "",
        "## 승인 절차",
        "",
        "1. 위 표와 `profile.json`, `candidates.json`을 보고 후보를 채택할지 정합니다. 표본이 작으면 구간(괄호)이 넓다는 점을 감안합니다.",
        "2. MLflow에서 이 실행의 태그 `approval`을 `approved` 또는 `rejected`로 바꾸고, 이유를 태그 `approvalNote`에 적습니다.",
        "3. 승인했다면 `AI/src/ssaplash_ai/coach/config.py`의 임계값을 고치고 `ANALYZER_VERSION`을 올리는 MR을 올립니다. "
        "MR 본문에 이 실행의 링크와 `reeval.json` 결과를 붙입니다.",
        "4. 정책(`AI/configs/coach/calibration_policy.yaml`)의 목표 범위는 사람이 이 기록의 분포를 보고 정합니다.",
    ]
    return "\n".join(out) + "\n"
