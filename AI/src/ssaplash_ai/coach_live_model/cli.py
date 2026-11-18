"""실시간 코칭 거름 모델을 합성 연주로 학습해 평가하고 내보낸다.

```
uv run --extra coach-live python -m ssaplash_ai.coach_live_model.cli --out runs/coach-live
# MLflow에 기록하고 레지스트리에 등록까지(서버 MLflow는 SSH 터널 뒤 MLFLOW_TRACKING_URI=http://localhost:5000)
uv run --extra coach-live python -m ssaplash_ai.coach_live_model.cli --out runs/coach-live --register
```
"""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import asdict
from pathlib import Path

from ssaplash_ai.coach_live_model.dataset import FEATURE_NAMES, FEATURE_VERSION, build_rows
from ssaplash_ai.coach_live_model.train import (
    DEFAULT_MODEL_NAME,
    MAX_RECALL_DROP,
    MODEL_VERSION,
    PARITY_LIMIT,
    arrays,
    compare,
    fit_gate,
    onnx_diff,
    register,
    to_onnx,
    write_outputs,
)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="실시간 코칭 거름 모델 학습")
    p.add_argument("--out", type=Path, required=True, help="산출물 폴더")
    p.add_argument("--per-cell", type=int, default=60, help="시나리오·강도마다 만들 판 수")
    p.add_argument(
        "--register", action="store_true", help="MLflow에 기록하고 레지스트리에 등록한다"
    )
    p.add_argument("--model-name", default=DEFAULT_MODEL_NAME, help="레지스트리 모델 이름")
    p.add_argument(
        "--tracking-uri", help="MLflow 주소. 없으면 MLFLOW_TRACKING_URI, 그것도 없으면 로컬 mlruns/"
    )
    args = p.parse_args(argv)

    rows = build_rows(args.per_cell)
    scores = compare(rows)
    chosen = scores["mlp16"]
    gate = fit_gate(rows, chosen.threshold)
    model = to_onnx(gate)
    x, y, _ = arrays(rows)
    diff = onnx_diff(gate, model, x[:2000])
    report = {
        "modelVersion": MODEL_VERSION,
        "featureVersion": FEATURE_VERSION,
        "dataSource": "SYNTHETIC",
        "perCell": args.per_cell,
        "rows": len(rows),
        "positives": int(y.sum()),
        "negatives": int((1 - y).sum()),
        "inputs": len(FEATURE_NAMES),
        "byTag": dict(Counter(r.tag for r in rows)),
        "maxRecallDrop": MAX_RECALL_DROP,
        "scores": {k: asdict(v) for k, v in scores.items()},
        "onnxMaxDiff": diff,
    }
    write_outputs(args.out, gate, model, report)

    print(
        f"지적 {len(rows)}건 · 진짜 {int(y.sum())} · 오탐 {int((1 - y).sum())} · 입력 {len(FEATURE_NAMES)}개"
    )
    for s in scores.values():
        print(
            f"{s.name}: AUC {s.auc:.3f} · 탐지 {s.recall:.3f}에서 오탐 {s.false_kept:.3f} · 탐지 98%에서 오탐 {s.false_kept_at_98:.3f}"
        )
    print(f"ONNX 최대 차이 {diff:.2e}")
    if diff > PARITY_LIMIT:
        print(f"ONNX 출력이 한도 {PARITY_LIMIT}를 넘었습니다.")
        return 1
    if args.register:
        version = register(args.out, report, chosen, args.model_name, args.tracking_uri)
        print(f"MLflow 등록: {args.model_name} 버전 {version}")
        print(
            f"게시(서버): docker compose -p infra exec mlflow publish-model publish {args.model_name} {version}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
