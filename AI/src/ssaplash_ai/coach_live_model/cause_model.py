"""놓침 원인 모델: 규칙이 낸 원인 후보 중 무엇이 진짜 원인인지 고른다(설계 COACH-001 3.1, 4.4).

- 입력은 후보별 강도와 단계·지적 종류(`dataset.cause_features`). 출력은 원인 5종(`replay.CAUSES`)의 확률이다.
- 고를 때는 규칙이 낸 후보와 `UNKNOWN`(근거 없음)만 남기고 그중 가장 높은 것을 고른다. 없는 원인을 만들지 않고,
  후보가 하나뿐이어도 근거가 약하면 `UNKNOWN`을 고를 수 있다.
- 합성 연주로 학습한다. 판 단위로 나눠 규칙 순서(`pick_cause_by_rule`)와 정확도를 비교한다. 합성 성능은 실제 성능이 아니다.

```
uv run --extra coach-live python -m ssaplash_ai.coach_live_model.cause_model --out runs/coach-cause
MLFLOW_TRACKING_URI=http://localhost:5000 uv run --extra coach-live python -m ssaplash_ai.coach_live_model.cause_model --out runs/coach-cause --register
```
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np

from ssaplash_ai.coach_live_model.dataset import (
    CAUSE_FEATURE_NAMES,
    CAUSE_FEATURE_VERSION,
    CauseRow,
    build_cause_rows,
)
from ssaplash_ai.coach_live_model.replay import CAUSES

MODEL_VERSION = "coach-cause-0.1"
FOLDS = 5
CAUSE_JSON = "coachCause.json"
META_JSON = "meta.json"
REPORT_JSON = "report.json"
MODEL_FILES = (CAUSE_JSON, META_JSON)
EXPERIMENT_NAME = "coach-live-cause"
UNKNOWN_INDEX = CAUSES.index("UNKNOWN")


@dataclass(frozen=True)
class Layer:
    """y = act(x @ w + b). w는 입력 수 × 출력 수"""

    w: list[list[float]]
    b: list[float]
    act: str  # "relu" | "none"


@dataclass(frozen=True)
class CauseNet:
    """표준화 뒤 층을 차례로 지나고 마지막에 softmax. FE가 같은 값으로 계산한다."""

    mean: list[float]
    scale: list[float]
    layers: list[Layer]

    def probs(self, x: np.ndarray) -> np.ndarray:
        h = (x - np.array(self.mean)) / np.array(self.scale)
        for layer in self.layers:
            h = h @ np.array(layer.w) + np.array(layer.b)
            if layer.act == "relu":
                h = np.maximum(h, 0.0)
        h = h - h.max(axis=1, keepdims=True)
        e = np.exp(h)
        return e / e.sum(axis=1, keepdims=True)


@dataclass(frozen=True)
class CauseScore:
    name: str
    accuracy: float
    # 후보가 둘 이상 겹친 행의 정확도. 모델이 규칙 순서를 대신하는 곳이다
    overlap_accuracy: float
    # 원인을 심지 않은 대조군에서 UNKNOWN을 고른 비율
    none_unknown: float
    by_scenario: dict[str, float]


def arrays(rows: list[CauseRow]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    x = np.array([r.features for r in rows], dtype=np.float64)
    y = np.array([CAUSES.index(r.label) for r in rows])
    g = np.array([r.play_id for r in rows])
    return x, y, g


def allowed_mask(rows: list[CauseRow]) -> np.ndarray:
    """행마다 고를 수 있는 원인: 규칙 후보와 UNKNOWN"""
    m = np.zeros((len(rows), len(CAUSES)), dtype=bool)
    m[:, UNKNOWN_INDEX] = True
    for i, r in enumerate(rows):
        for c in r.candidates:
            m[i, CAUSES.index(c)] = True
    return m


def pick(probs: np.ndarray, mask: np.ndarray) -> np.ndarray:
    return np.where(mask, probs, -1.0).argmax(axis=1)


def score_of(name: str, rows: list[CauseRow], picked: list[str]) -> CauseScore:
    ok = [p == r.label for p, r in zip(picked, rows, strict=True)]
    overlap = [o for o, r in zip(ok, rows, strict=True) if len(r.candidates) >= 2]
    none = [p == "UNKNOWN" for p, r in zip(picked, rows, strict=True) if r.scenario == "NONE"]
    by: dict[str, list[bool]] = defaultdict(list)
    for o, r in zip(ok, rows, strict=True):
        by[r.scenario].append(o)
    mean = lambda xs: float(np.mean(xs)) if xs else float("nan")  # noqa: E731
    return CauseScore(
        name,
        mean(ok),
        mean(overlap),
        mean(none),
        {k: round(mean(v), 4) for k, v in sorted(by.items())},
    )


def _models() -> dict[str, Any]:
    from sklearn.linear_model import LogisticRegression
    from sklearn.neural_network import MLPClassifier

    return {
        "logistic": LogisticRegression(max_iter=4000),
        "mlp16": MLPClassifier((16,), max_iter=1500, random_state=0, alpha=1e-3),
    }


def _full_probs(model: Any, x: np.ndarray) -> np.ndarray:
    """학습에 없던 클래스가 있어도 원인 5종 순서로 맞춘다"""
    p = np.zeros((len(x), len(CAUSES)))
    p[:, model.classes_] = model.predict_proba(x)
    return p


def compare(rows: list[CauseRow]) -> dict[str, CauseScore]:
    from sklearn.model_selection import GroupKFold
    from sklearn.preprocessing import StandardScaler

    x, y, g = arrays(rows)
    mask = allowed_mask(rows)
    out = {name: np.zeros((len(y), len(CAUSES))) for name in _models()}
    for train, test in GroupKFold(FOLDS).split(x, y, g):
        scaler = StandardScaler().fit(x[train])
        for name, model in _models().items():
            model.fit(scaler.transform(x[train]), y[train])
            out[name][test] = _full_probs(model, scaler.transform(x[test]))
    scores = {"rule": score_of("rule", rows, [r.picked for r in rows])}
    for name, p in out.items():
        scores[name] = score_of(name, rows, [CAUSES[i] for i in pick(p, mask)])
    return scores


def fit_cause(rows: list[CauseRow], name: str) -> CauseNet:
    from sklearn.preprocessing import StandardScaler

    x, y, _ = arrays(rows)
    missing = set(range(len(CAUSES))) - set(y.tolist())
    if missing:
        raise ValueError(
            f"학습 데이터에 없는 원인이 있습니다: {[CAUSES[i] for i in sorted(missing)]}"
        )
    scaler = StandardScaler().fit(x)
    model = _models()[name].fit(scaler.transform(x), y)
    mean, scale = scaler.mean_.tolist(), scaler.scale_.tolist()
    if name == "logistic":
        return CauseNet(
            mean, scale, [Layer(model.coef_.T.tolist(), model.intercept_.tolist(), "none")]
        )
    w1, w2 = model.coefs_
    b1, b2 = model.intercepts_
    return CauseNet(
        mean,
        scale,
        [Layer(w1.tolist(), b1.tolist(), "relu"), Layer(w2.tolist(), b2.tolist(), "none")],
    )


def cause_json(net: CauseNet) -> dict[str, Any]:
    return {
        "modelVersion": MODEL_VERSION,
        "classes": list(CAUSES),
        "inputNames": list(CAUSE_FEATURE_NAMES),
        "mean": net.mean,
        "scale": net.scale,
        "layers": [asdict(layer) for layer in net.layers],
    }


def cause_meta(trained_on: str = "SYNTHETIC") -> dict[str, Any]:
    """모델 메타(설계 3.4). FE는 task·featureVersion·classes가 맞지 않으면 이 모델을 쓰지 않는다."""
    return {
        "task": "cause",
        "modelVersion": MODEL_VERSION,
        "featureVersion": CAUSE_FEATURE_VERSION,
        "inputNames": list(CAUSE_FEATURE_NAMES),
        "runtime": [{"kind": "json", "path": CAUSE_JSON}],
        "classes": list(CAUSES),
        "trainedOn": trained_on,
    }


def parity_fixture(net: CauseNet, rows: list[CauseRow], n: int = 60) -> list[dict[str, Any]]:
    """FE 계산이 같은지 볼 표본: 입력, 후보, 확률, 고른 원인"""
    rng = np.random.default_rng(0)
    idx = rng.choice(len(rows), size=min(n, len(rows)), replace=False)
    chosen = [rows[i] for i in sorted(idx)]
    x, _, _ = arrays(chosen)
    p = net.probs(x)
    picked = pick(p, allowed_mask(chosen))
    return [
        {
            "input": list(r.features),
            "candidates": list(r.candidates),
            "probs": p[i].tolist(),
            "picked": CAUSES[picked[i]],
        }
        for i, r in enumerate(chosen)
    ]


def write_outputs(out: Path, net: CauseNet, report: dict[str, Any]) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / CAUSE_JSON).write_text(json.dumps(cause_json(net), ensure_ascii=False), encoding="utf-8")
    (out / META_JSON).write_text(
        json.dumps(cause_meta(report.get("dataSource", "SYNTHETIC")), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (out / REPORT_JSON).write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def register(
    out: Path, report: dict[str, Any], model_name: str, tracking_uri: str | None = None
) -> str:
    from ssaplash_ai.coach_live_model.registry import register_model_files

    chosen = report["scores"][report["chosen"]]
    return register_model_files(
        out,
        MODEL_FILES,
        experiment=EXPERIMENT_NAME,
        model_name=model_name,
        run_name=f"{MODEL_VERSION}-{model_name}",
        params={
            "modelName": model_name,
            "modelVersion": MODEL_VERSION,
            "featureVersion": CAUSE_FEATURE_VERSION,
            "architecture": report["chosen"],
            "rows": report.get("rows"),
            "perCell": report.get("perCell"),
        },
        metrics={
            "accuracy": chosen["accuracy"],
            "overlapAccuracy": chosen["overlap_accuracy"],
            "noneUnknown": chosen["none_unknown"],
            "ruleAccuracy": report["scores"]["rule"]["accuracy"],
        },
        tags={
            "task": "cause",
            "featureVersion": str(CAUSE_FEATURE_VERSION),
            "trainedOn": report.get("dataSource", "SYNTHETIC"),
        },
        report_file=REPORT_JSON,
        tracking_uri=tracking_uri,
    )


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="놓침 원인 모델 학습")
    p.add_argument("--out", type=Path, required=True, help="산출물 폴더")
    p.add_argument("--per-cell", type=int, default=40, help="시나리오·강도마다 만들 판 수")
    p.add_argument("--model", choices=("auto", "logistic", "mlp16"), default="auto")
    p.add_argument("--fixture", type=Path, help="FE 계산 비교용 표본을 쓸 경로")
    p.add_argument(
        "--register", action="store_true", help="MLflow에 기록하고 레지스트리에 등록한다"
    )
    p.add_argument("--model-name", help="레지스트리 모델 이름. 없으면 coach-cause-<구조>")
    p.add_argument("--tracking-uri")
    args = p.parse_args(argv)

    rows = build_cause_rows(args.per_cell)
    scores = compare(rows)
    # 정확도가 같으면 단순한 로지스틱을 고른다
    chosen = args.model
    if chosen == "auto":
        chosen = max(
            ("logistic", "mlp16"), key=lambda k: (round(scores[k].accuracy, 3), k == "logistic")
        )
    net = fit_cause(rows, chosen)
    report = {
        "modelVersion": MODEL_VERSION,
        "featureVersion": CAUSE_FEATURE_VERSION,
        "dataSource": "SYNTHETIC",
        "perCell": args.per_cell,
        "rows": len(rows),
        "overlapRows": sum(len(r.candidates) >= 2 for r in rows),
        "byLabel": dict(Counter(r.label for r in rows)),
        "chosen": chosen,
        "scores": {k: asdict(v) for k, v in scores.items()},
    }
    write_outputs(args.out, net, report)
    if args.fixture:
        args.fixture.write_text(
            json.dumps(
                {"model": cause_json(net), "samples": parity_fixture(net, rows)}, ensure_ascii=False
            ),
            encoding="utf-8",
        )

    print(f"원인 지적 {len(rows)}건 · 후보 겹침 {report['overlapRows']}건 · 고른 구조 {chosen}")
    for s in scores.values():
        print(
            f"{s.name}: 정확도 {s.accuracy:.3f} · 겹친 행 {s.overlap_accuracy:.3f} · 대조군 UNKNOWN {s.none_unknown:.3f}"
        )
    if scores[chosen].accuracy <= scores["rule"].accuracy:
        print("모델이 규칙 순서보다 낫지 않습니다. 등록 전에 확인하세요.")
    if args.register:
        name = args.model_name or f"coach-cause-{chosen}"
        version = register(args.out, report, name, args.tracking_uri)
        print(f"MLflow 등록: {name} 버전 {version}")
        print(
            f"게시(서버): docker compose -p infra exec mlflow publish-model publish {name} {version}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
