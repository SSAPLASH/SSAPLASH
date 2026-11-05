"""평가 결과를 팀 MLflow(실험 `song-recommend`)에 기록한다(설계 문서 부록 B.7·B.10).

방법마다 run 하나를 만들고, 시드·데이터 해시·코드 커밋·출처 단계·하이퍼파라미터를 함께 남긴다.
**집계 값만 기록한다.** 사용자 키·연주 같은 개인 단위 값은 파라미터·태그·지표·산출물 어디에도 넣지 않는다.
"""

from __future__ import annotations

import json
import subprocess
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from ssaplash_ai.recommend.evaluate import Report

EXPERIMENT_NAME = "song-recommend"


def git_commit() -> str:
    """현재 코드 커밋(짧은 해시). 저장소가 아니거나 git이 없으면 `unknown`."""
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        )
        return out.stdout.strip() or "unknown"
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def log_report(
    report: Report,
    *,
    tracking_uri: str | None = None,
    experiment: str = EXPERIMENT_NAME,
    extra_params: dict[str, object] | None = None,
    stamp: str | None = None,
) -> list[str]:
    """방법마다 run을 기록하고 MLflow run id 목록을 돌려준다."""
    from ssaplash_ai.bench.runner.mlflow_tracking import log_run

    stamp = stamp or datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    commit = git_commit()
    summary = report.to_dict()
    run_ids: list[str] = []
    with tempfile.TemporaryDirectory(prefix="recommend-report-") as tmp:
        artifact = Path(tmp) / "report.json"
        artifact.write_text(
            json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8"
        )
        for name, result in report.results.items():
            params: dict[str, object] = {
                "model": name,
                "stage": report.stage,
                "dataHash": report.data_hash,
                "k": report.config.k,
                "seed": report.config.seed,
                "bootstrap": report.config.bootstrap,
                "hardLimit": report.config.hard_limit,
                "cutoff": report.cutoff,
                "nSongs": report.n_songs,
                "nColdSongs": report.n_cold_songs,
                "reportDigest": report.digest(),
            }
            params.update({f"hp.{k}": v for k, v in report.model_params.get(name, {}).items()})
            params.update(extra_params or {})
            run_ids.append(
                log_run(
                    run_id=f"{name}-{stamp}",
                    params=params,
                    summary_metrics={
                        name: {
                            k: v for k, v in result.metrics.items() if isinstance(v, int | float)
                        }
                    },
                    artifacts=[artifact],
                    tags={"gitCommit": commit, "stage": report.stage, "dataHash": report.data_hash},
                    tracking_uri=tracking_uri,
                    experiment_name=experiment,
                )
            )
    return run_ids
