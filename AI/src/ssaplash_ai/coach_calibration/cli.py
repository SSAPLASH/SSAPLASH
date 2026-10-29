"""보정 배치 진입점. 예약 실행이 호출한다.

    python -m ssaplash_ai.coach_calibration.cli

접속 문자열은 환경 변수 `SSAPLASH_COACH_EXPORT_DSN`, MLflow 주소는 `MLFLOW_TRACKING_URI`로 받는다(명령줄에 두지 않는다).
끝에 **한 줄 상태**를 표준 출력에 남긴다(Grafana 알림이 이 줄을 본다):

    coach-calibration status=OK|SKIPPED|FAIL ...

종료 코드: OK·SKIPPED는 0, FAIL은 1. 오류 줄에는 예외 종류와 열 이름만 담고 메시지·접속 정보·값은 담지 않는다.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from ssaplash_ai.coach_calibration.candidates import GROUPS
from ssaplash_ai.coach_calibration.pipeline import (
    DEFAULT_MIN_NEW,
    STATUS_OK,
    STATUS_SKIPPED,
    run_calibration,
)
from ssaplash_ai.coach_calibration.policy import load_policy
from ssaplash_ai.coach_calibration.source import (
    DEFAULT_VIEW,
    ExportSchemaError,
    PostgresViewSource,
    RowSource,
)

POLICY_ENV = "SSAPLASH_CALIBRATION_POLICY"
PREFIX = "coach-calibration"


def _line(status: str, **fields: object) -> str:
    parts = " ".join(f"{k}={v}" for k, v in fields.items())
    return f"{PREFIX} status={status} {parts}".rstrip()


def main(argv: list[str] | None = None, source: RowSource | None = None) -> int:
    parser = argparse.ArgumentParser(description="약점 분석 실측 보정 배치")
    parser.add_argument(
        "--policy", type=Path, default=None, help=f"정책 파일(없으면 {POLICY_ENV} 또는 기본 파일)"
    )
    parser.add_argument(
        "--min-new", type=int, default=DEFAULT_MIN_NEW, help="다시 돌릴 최소 신규 세션 수"
    )
    parser.add_argument(
        "--tracking-uri", default=None, help="MLflow 주소(없으면 MLFLOW_TRACKING_URI)"
    )
    parser.add_argument("--view", default=DEFAULT_VIEW)
    parser.add_argument("--skip-reeval", action="store_true", help="후보의 합성 재평가를 건너뛴다")
    parser.add_argument(
        "--force", action="store_true", help="새 세션이 모자라도 돌린다(정책을 바꾼 뒤 등)"
    )
    args = parser.parse_args(argv)

    try:
        policy_path = args.policy or (
            Path(os.environ[POLICY_ENV]) if os.environ.get(POLICY_ENV) else None
        )
        policy = load_policy(policy_path, GROUPS)
        outcome = run_calibration(
            source or PostgresViewSource(view=args.view),
            policy,
            tracking_uri=args.tracking_uri,
            min_new=args.min_new,
            skip_reeval=args.skip_reeval,
            force=args.force,
        )
    except ExportSchemaError as exc:
        print(_line("FAIL", error=type(exc).__name__, columns=",".join(exc.columns)), flush=True)
        return 1
    except Exception as exc:  # 메시지에는 접속 정보나 값이 들어 있을 수 있어 종류만 남긴다
        print(_line("FAIL", error=type(exc).__name__), flush=True)
        return 1

    if outcome.status == STATUS_SKIPPED:
        print(
            _line(
                STATUS_SKIPPED,
                reason=outcome.reason,
                sessions=outcome.view_sessions,
                new=outcome.new_sessions,
            ),
            flush=True,
        )
    else:
        print(
            _line(
                STATUS_OK,
                sessions=outcome.view_sessions,
                valid=outcome.valid_sessions,
                candidates=outcome.candidates,
                sample=outcome.sample_status,
                approval=outcome.approval,
                run=outcome.run_id,
            ),
            flush=True,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
