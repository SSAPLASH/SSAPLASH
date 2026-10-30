"""보정 한 번의 실행 순서.

뷰 읽기(허용 필드 검증) → 새로 쌓였는지 판단 → 이상치 제외 → 분포·걸림 비율 → 후보·what-if → (후보가 있으면) 합성 재평가
→ MLflow 기록. 임계값을 바꾸는 단계는 없다.
"""

from __future__ import annotations

import json
import tempfile
from dataclasses import dataclass, fields, replace
from datetime import date as date_type
from pathlib import Path
from typing import Any

from ssaplash_ai.coach.config import ANALYZER_VERSION, DEFAULT_THRESHOLDS, Thresholds
from ssaplash_ai.coach_calibration import filters, profile, register
from ssaplash_ai.coach_calibration.candidates import (
    CANDIDATES_VERSION,
    INSUFFICIENT_SAMPLE,
    OK,
    REEVAL_CONFIG,
    build_report,
    reevaluate,
)
from ssaplash_ai.coach_calibration.policy import Policy
from ssaplash_ai.coach_calibration.source import RowSource, read_sessions
from ssaplash_ai.coach_calibration.summary import render_summary
from ssaplash_ai.coach_eval.runner import RunConfig

DEFAULT_MIN_NEW = 50

STATUS_OK = "OK"
STATUS_SKIPPED = "SKIPPED"


@dataclass(frozen=True)
class RunOutcome:
    status: str  # OK | SKIPPED
    reason: str
    view_sessions: int
    new_sessions: int
    valid_sessions: int = 0
    candidates: int = 0
    sample_status: str | None = None
    approval: str | None = None
    run_id: str | None = None


def run_calibration(
    source: RowSource,
    policy: Policy,
    *,
    tracking_uri: str | None = None,
    min_new: int = DEFAULT_MIN_NEW,
    skip_reeval: bool = False,
    force: bool = False,
    reeval_config: RunConfig = REEVAL_CONFIG,
    base: Thresholds = DEFAULT_THRESHOLDS,
    today: str | None = None,
) -> RunOutcome:
    # 열 검사를 통과해야만 행을 읽는다. 허용 밖 열이 있으면 여기서 예외가 나고 아무것도 기록하지 않는다.
    sessions = read_sessions(source)
    view_count = len(sessions)
    played = [str(s.played_date) for s in sessions if s.played_date is not None]
    data_max_date = max(played) if played else None

    decision = register.decide(register.find_last_run(tracking_uri), view_count, min_new)
    if force and not decision.run and view_count > 0:
        decision = replace(decision, run=True, reason=register.RUN_FORCED)
    if not decision.run:
        return RunOutcome(STATUS_SKIPPED, decision.reason, view_count, decision.new_sessions)

    filtered = filters.filter_sessions(sessions)
    profiles = profile.build_profiles(filtered)
    report = build_report(filtered.drum, policy, base)

    reeval = None
    if report.thresholds is not None and not skip_reeval:
        reeval = reevaluate(report.thresholds, reeval_config, base)

    profile_records = {name: p.to_record() for name, p in profiles.items()}
    candidate_record = report.to_record()
    reeval_record = reeval.to_record() if reeval else None

    changed = len(report.changed())
    approval = register.APPROVAL_PENDING if changed else register.APPROVAL_NOT_APPLICABLE
    sample_status = INSUFFICIENT_SAMPLE if report.status == INSUFFICIENT_SAMPLE else OK
    day = today or date_type.today().isoformat()
    counts = filtered.counts()

    metrics = register.metrics_from_records(profile_records, candidate_record)
    for key, value in counts.items():
        metrics[f"excluded/{key}" if key in filters.EXCLUDE_REASONS else f"count/{key}"] = float(
            value
        )
    if reeval is not None:
        metrics["reeval/worstRecallDrop"] = reeval.worst_recall_drop()
        metrics["reeval/worstFpRise"] = reeval.worst_fp_rise()

    params = {
        "dataMaxDate": data_max_date or "",
        "viewSessionCount": view_count,
        "newSessions": decision.new_sessions,
        "minNew": min_new,
        "validDrumSessions": len(filtered.drum),
        "validKeyboardSessions": len(filtered.keyboard),
        "maxChange": policy.max_change,
        "minSample": policy.min_sample,
        "policyTargets": json.dumps(
            {k: list(v) for k, v in policy.targets.items()}, sort_keys=True
        ),
        "thresholds": json.dumps(_threshold_values(base), sort_keys=True),
        "countDecreased": decision.decreased,
    }
    tags = {
        "approval": approval,
        "sampleStatus": sample_status,
        "runDecision": decision.reason,
        "analyzerVersion": ANALYZER_VERSION,
        "filterVersion": filters.FILTER_VERSION,
        "profileVersion": profile.PROFILE_VERSION,
        "candidatesVersion": CANDIDATES_VERSION,
        "dataSnapshot": f"{data_max_date}:{view_count}",
    }

    with tempfile.TemporaryDirectory() as tmp:
        artifacts = _write_artifacts(
            Path(tmp),
            summary=render_summary(
                date=day,
                decision_reason=decision.reason,
                new_sessions=decision.new_sessions,
                view_sessions=view_count,
                counts=counts,
                profiles=profile_records,
                candidates=candidate_record,
                reeval=reeval_record,
                policy_targets={k: list(v) for k, v in policy.targets.items()},
                approval=approval,
            ),
            profile_records=profile_records,
            candidate_record=candidate_record,
            reeval_record=reeval_record,
        )
        run_id = register.record_run(
            run_name=f"calib-{day}-n{len(filtered.drum)}",
            params=params,
            tags=tags,
            metrics=metrics,
            artifacts=artifacts,
            tracking_uri=tracking_uri,
        )
    return RunOutcome(
        STATUS_OK,
        decision.reason,
        view_count,
        decision.new_sessions,
        valid_sessions=len(filtered.drum),
        candidates=changed,
        sample_status=sample_status,
        approval=approval,
        run_id=run_id,
    )


def _threshold_values(base: Thresholds) -> dict[str, Any]:
    return {f.name: getattr(base, f.name) for f in fields(base)}


def _write_artifacts(
    directory: Path,
    *,
    summary: str,
    profile_records: dict[str, Any],
    candidate_record: dict[str, Any],
    reeval_record: dict[str, Any] | None,
) -> list[Path]:
    files = {
        "summary.md": summary,
        "profile.json": json.dumps(profile_records, ensure_ascii=False, indent=2),
        "candidates.json": json.dumps(candidate_record, ensure_ascii=False, indent=2),
    }
    if reeval_record is not None:
        files["reeval.json"] = json.dumps(reeval_record, ensure_ascii=False, indent=2)
    paths = []
    for name, text in files.items():
        path = directory / name
        path.write_text(
            text + ("" if text.endswith("\n") else "\n"), encoding="utf-8", newline="\n"
        )
        paths.append(path)
    return paths
