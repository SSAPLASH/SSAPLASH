"""놓침 원인 모델: 학습·내보내기·고르기·등록."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

pytest.importorskip("sklearn")

from ssaplash_ai.coach_live_model.cause_model import (  # noqa: E402
    CauseNet,
    Layer,
    allowed_mask,
    cause_json,
    cause_meta,
    compare,
    fit_cause,
    main,
    parity_fixture,
    pick,
)
from ssaplash_ai.coach_live_model.dataset import (  # noqa: E402
    CAUSE_FEATURE_NAMES,
    CAUSE_FEATURE_VERSION,
    CauseRow,
    build_cause_rows,
)
from ssaplash_ai.coach_live_model.replay import CAUSES  # noqa: E402

ROWS = build_cause_rows(4)


def row(cands: tuple[str, ...], label: str = "UNKNOWN") -> CauseRow:
    return CauseRow(0, "X", 0.5, "LIVE_PAD_MISS", 3, "UNKNOWN", cands, (0.0,) * 6, label)


def test_pick_only_chooses_candidates_or_unknown() -> None:
    rows = [row(("DENSE",)), row(())]
    probs = np.array([[0.9, 0.05, 0.03, 0.01, 0.01], [0.9, 0.05, 0.03, 0.01, 0.01]])
    # WRONG_PAD 확률이 가장 높아도 후보가 아니면 고르지 않는다
    assert [CAUSES[i] for i in pick(probs, allowed_mask(rows))] == ["DENSE", "UNKNOWN"]


def test_compare_reports_rule_and_models() -> None:
    scores = compare(ROWS)
    assert set(scores) == {"rule", "logistic", "mlp16"}
    assert scores["rule"].accuracy > 0.8
    # 모델은 규칙보다 크게 나빠지지 않아야 한다
    assert scores["logistic"].accuracy >= scores["rule"].accuracy - 0.02


@pytest.mark.parametrize("name", ["logistic", "mlp16"])
def test_exported_net_matches_sklearn(name: str) -> None:
    from sklearn.preprocessing import StandardScaler

    from ssaplash_ai.coach_live_model.cause_model import _full_probs, _models, arrays

    net = fit_cause(ROWS, name)
    x, y, _ = arrays(ROWS)
    scaler = StandardScaler().fit(x)
    model = _models()[name].fit(scaler.transform(x), y)
    assert np.abs(net.probs(x) - _full_probs(model, scaler.transform(x))).max() < 1e-9


def test_json_and_meta_describe_the_model() -> None:
    net = CauseNet([0.0] * 6, [1.0] * 6, [Layer([[0.0] * 5] * 6, [0.0] * 5, "none")])
    j = cause_json(net)
    assert j["classes"] == list(CAUSES)
    assert j["layers"][0]["act"] == "none"
    meta = cause_meta()
    assert meta["task"] == "cause"
    assert meta["featureVersion"] == CAUSE_FEATURE_VERSION
    assert meta["inputNames"] == list(CAUSE_FEATURE_NAMES)
    assert meta["runtime"] == [{"kind": "json", "path": "coachCause.json"}]


def test_parity_fixture_picks_agree_with_probs() -> None:
    net = fit_cause(ROWS, "logistic")
    for s in parity_fixture(net, ROWS, 20):
        allowed = set(s["candidates"]) | {"UNKNOWN"}
        best = max(allowed, key=lambda c: s["probs"][CAUSES.index(c)])
        assert s["picked"] == best
        assert abs(sum(s["probs"]) - 1) < 1e-9


def test_cli_writes_outputs_and_registers(tmp_path: Path) -> None:
    import mlflow

    out = tmp_path / "out"
    fixture = tmp_path / "fixture.json"
    uri = (tmp_path / "mlruns").as_uri()
    assert (
        main(
            [
                "--out",
                str(out),
                "--per-cell",
                "3",
                "--fixture",
                str(fixture),
                "--register",
                "--tracking-uri",
                uri,
            ]
        )
        == 0
    )
    assert sorted(p.name for p in out.iterdir()) == ["coachCause.json", "meta.json", "report.json"]
    assert json.loads(fixture.read_text(encoding="utf-8"))["samples"]
    report = json.loads((out / "report.json").read_text(encoding="utf-8"))
    name = f"coach-cause-{report['chosen']}"
    got = mlflow.artifacts.download_artifacts(
        artifact_uri=f"models:/{name}/1", dst_path=str(tmp_path / "dl")
    )
    assert sorted(p.name for p in Path(got).rglob("*") if p.is_file()) == [
        "coachCause.json",
        "meta.json",
    ]
