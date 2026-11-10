"""모델을 비교하고 MLP를 JSON·ONNX로 내보낸다.

판 단위로 나눠 평가한다. 같은 판의 지적이 학습과 시험에 함께 들어가면 성능이 부풀려진다.
기준값은 탐지율 하락이 `MAX_RECALL_DROP` 안에 드는 값 중 오탐이 가장 적은 값이다.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np

from ssaplash_ai.coach_live_model.dataset import FEATURE_NAMES, FEATURE_VERSION, Row

MODEL_VERSION = "coach-gate-0.1"
MAX_RECALL_DROP = 0.05
FOLDS = 5
PARITY_LIMIT = 1e-5

# 브라우저가 받는 파일. MLflow 레지스트리에는 이 셋만 모델로 올린다(게시 도구가 모델 폴더를 그대로 복사한다)
GATE_JSON = "coachGate.json"
GATE_ONNX = "coachGate.onnx"
META_JSON = "meta.json"
MODEL_FILES = (GATE_JSON, GATE_ONNX, META_JSON)
REPORT_JSON = "report.json"
EXPERIMENT_NAME = "coach-live-gate"
DEFAULT_MODEL_NAME = "coach-gate-mlp16"


@dataclass(frozen=True)
class Score:
    name: str
    auc: float
    threshold: float
    recall: float
    false_kept: float
    false_kept_at_98: float


@dataclass(frozen=True)
class Gate:
    """표준화와 은닉층 하나짜리 MLP. FE가 같은 값으로 계산한다."""

    mean: list[float]
    scale: list[float]
    w1: list[list[float]]
    b1: list[float]
    w2: list[list[float]]
    b2: list[float]
    threshold: float

    def score(self, x: np.ndarray) -> np.ndarray:
        n = (x - np.array(self.mean)) / np.array(self.scale)
        h = np.maximum(n @ np.array(self.w1) + np.array(self.b1), 0.0)
        return 1.0 / (1.0 + np.exp(-(h @ np.array(self.w2) + np.array(self.b2))))[:, 0]


def _models() -> dict[str, Any]:
    from sklearn.linear_model import LogisticRegression
    from sklearn.neural_network import MLPClassifier

    return {
        "logistic": LogisticRegression(max_iter=2000, class_weight="balanced"),
        "mlp16": MLPClassifier((16,), max_iter=800, random_state=0, alpha=1e-3),
        "mlp32x16": MLPClassifier((32, 16), max_iter=800, random_state=0, alpha=1e-3),
    }


def threshold_for(p: np.ndarray, y: np.ndarray, recall: float) -> float:
    """진짜 지적의 `recall` 비율이 남는 가장 높은 기준값."""
    positives = np.sort(p[y == 1])
    return float(positives[int((1 - recall) * len(positives))])


def score_of(name: str, p: np.ndarray, y: np.ndarray) -> Score:
    from sklearn.metrics import roc_auc_score

    th = threshold_for(p, y, 1 - MAX_RECALL_DROP)
    th98 = threshold_for(p, y, 0.98)
    keep = p >= th
    return Score(
        name,
        float(roc_auc_score(y, p)),
        th,
        float(keep[y == 1].mean()),
        float(keep[y == 0].mean()),
        float((p >= th98)[y == 0].mean()),
    )


def arrays(rows: list[Row]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    x = np.array([r.features for r in rows], dtype=np.float64)
    y = np.array([r.label for r in rows])
    g = np.array([r.play_id for r in rows])
    return x, y, g


def compare(rows: list[Row]) -> dict[str, Score]:
    from sklearn.model_selection import GroupKFold
    from sklearn.preprocessing import StandardScaler

    x, y, g = arrays(rows)
    out = {name: np.zeros(len(y)) for name in _models()}
    for train, test in GroupKFold(FOLDS).split(x, y, g):
        scaler = StandardScaler().fit(x[train])
        for name, model in _models().items():
            model.fit(scaler.transform(x[train]), y[train])
            out[name][test] = model.predict_proba(scaler.transform(x[test]))[:, 1]
    return {name: score_of(name, p, y) for name, p in out.items()}


def fit_gate(rows: list[Row], threshold: float) -> Gate:
    from sklearn.preprocessing import StandardScaler

    x, y, _ = arrays(rows)
    scaler = StandardScaler().fit(x)
    model = _models()["mlp16"].fit(scaler.transform(x), y)
    w1, w2 = model.coefs_
    b1, b2 = model.intercepts_
    return Gate(
        scaler.mean_.tolist(),
        scaler.scale_.tolist(),
        w1.tolist(),
        b1.tolist(),
        w2.tolist(),
        b2.tolist(),
        threshold,
    )


def to_onnx(gate: Gate) -> bytes:
    """입력 `x`(N×특징 수), 출력 `score`(N×1). 표준화까지 그래프에 넣는다."""
    import onnx
    from onnx import TensorProto, helper, numpy_helper

    names = ("mean", "scale", "w1", "b1", "w2", "b2")
    values = (gate.mean, gate.scale, gate.w1, gate.b1, gate.w2, gate.b2)
    init = [
        numpy_helper.from_array(np.array(v, dtype=np.float32), n)
        for n, v in zip(names, values, strict=True)
    ]
    nodes = [
        helper.make_node("Sub", ["x", "mean"], ["centered"]),
        helper.make_node("Div", ["centered", "scale"], ["normal"]),
        helper.make_node("Gemm", ["normal", "w1", "b1"], ["hidden"]),
        helper.make_node("Relu", ["hidden"], ["active"]),
        helper.make_node("Gemm", ["active", "w2", "b2"], ["logit"]),
        helper.make_node("Sigmoid", ["logit"], ["score"]),
    ]
    graph = helper.make_graph(
        nodes,
        "coach_gate",
        [helper.make_tensor_value_info("x", TensorProto.FLOAT, [None, len(gate.mean)])],
        [helper.make_tensor_value_info("score", TensorProto.FLOAT, [None, 1])],
        init,
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    model.ir_version = 9
    onnx.checker.check_model(model)
    return model.SerializeToString()


def onnx_diff(gate: Gate, model: bytes, x: np.ndarray) -> float:
    """JSON 계산과 ONNX 계산의 최대 차이."""
    import onnxruntime as ort

    session = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
    out = session.run(None, {"x": x.astype(np.float32)})[0][:, 0]
    return float(np.abs(out - gate.score(x.astype(np.float32).astype(np.float64))).max())


def gate_json(gate: Gate) -> dict[str, Any]:
    return {"modelVersion": MODEL_VERSION, "inputNames": list(FEATURE_NAMES), **asdict(gate)}


def model_meta(gate: Gate, trained_on: str = "SYNTHETIC") -> dict[str, Any]:
    """모델 메타 파일(설계 3.4). FE는 `featureVersion`이 자기 값과 다르면 이 모델을 쓰지 않는다.

    `runtime`은 이 버전에 들어 있는 실행 파일 목록이다. 같은 모델을 JSON과 ONNX 두 가지로 내보낸다.
    """
    return {
        "task": "gate",
        "modelVersion": MODEL_VERSION,
        "featureVersion": FEATURE_VERSION,
        "inputNames": list(FEATURE_NAMES),
        "runtime": [{"kind": "json", "path": GATE_JSON}, {"kind": "onnx", "path": GATE_ONNX}],
        "threshold": gate.threshold,
        "trainedOn": trained_on,
    }


def write_outputs(out: Path, gate: Gate, model: bytes, report: dict[str, Any]) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / GATE_JSON).write_text(json.dumps(gate_json(gate), ensure_ascii=False), encoding="utf-8")
    (out / GATE_ONNX).write_bytes(model)
    (out / META_JSON).write_text(
        json.dumps(
            model_meta(gate, report.get("dataSource", "SYNTHETIC")), ensure_ascii=False, indent=2
        ),
        encoding="utf-8",
    )
    (out / REPORT_JSON).write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def register(
    out: Path,
    report: dict[str, Any],
    chosen: Score,
    model_name: str = DEFAULT_MODEL_NAME,
    tracking_uri: str | None = None,
) -> str:
    """`write_outputs`로 만든 폴더를 MLflow에 기록하고 레지스트리에 새 버전으로 등록한다. 등록한 버전을 돌려준다.

    모델로는 `MODEL_FILES`만 올리고 `report.json`은 실행(run)의 산출물로만 남긴다. 게시는 서버에서
    `publish-model publish <모델 이름> <버전>`으로 따로 한다(이 함수는 게시하지 않는다).
    """
    from ssaplash_ai.coach_live_model.registry import register_model_files

    if not (out / META_JSON).is_file():
        raise FileNotFoundError(f"등록할 파일이 없습니다: {META_JSON}")
    meta = json.loads((out / META_JSON).read_text(encoding="utf-8"))
    return register_model_files(
        out,
        MODEL_FILES,
        experiment=EXPERIMENT_NAME,
        model_name=model_name,
        run_name=f"{MODEL_VERSION}-{model_name}",
        params={
            "modelName": model_name,
            "modelVersion": MODEL_VERSION,
            "featureVersion": meta["featureVersion"],
            "threshold": round(chosen.threshold, 6),
            "rows": report.get("rows"),
            "perCell": report.get("perCell"),
        },
        metrics={
            "auc": chosen.auc,
            "recall": chosen.recall,
            "falseKept": chosen.false_kept,
            "falseKeptAt98": chosen.false_kept_at_98,
            "onnxMaxDiff": float(report.get("onnxMaxDiff", 0.0)),
        },
        tags={
            "task": "gate",
            "featureVersion": str(meta["featureVersion"]),
            "trainedOn": meta["trainedOn"],
        },
        report_file=REPORT_JSON,
        tracking_uri=tracking_uri,
    )
