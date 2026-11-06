from __future__ import annotations

import numpy as np
import pytest

from ssaplash_ai.coach_live_model.dataset import (
    FEATURE_NAMES,
    TAGS,
    Row,
    build_rows,
    features,
    is_ambiguous,
)
from ssaplash_ai.coach_live_model.replay import JudgedNote, JudgedWindow
from ssaplash_ai.coach_live_model.train import Gate, threshold_for


def test_features_have_one_tag_set_and_match_names() -> None:
    window = JudgedWindow()
    for i in range(12):
        window.push(JudgedNote(i * 500.0, "GOOD", 30.0, "SNARE", i % 2, 90))
    f = features(window.metrics(), "LIVE_LATE")
    assert len(f) == len(FEATURE_NAMES)
    assert f[0] == pytest.approx(0.5)
    assert sum(f[-len(TAGS) :]) == 1


def test_ambiguous_firings_are_left_out() -> None:
    assert is_ambiguous("TRANSITION_LATE", "LIVE_LATE")
    assert is_ambiguous("CLEAN_NOVICE", "LIVE_MISS_STREAK")
    assert not is_ambiguous("CLEAN_NOVICE", "LIVE_LATE")
    assert not is_ambiguous("CLEAN_AVERAGE", "LIVE_MISS_STREAK")


def test_rows_are_reproducible_and_labelled() -> None:
    rows = build_rows(1)
    assert rows == build_rows(1)
    assert {r.label for r in rows} == {0, 1}
    assert all(r.label == 0 for r in rows if r.scenario.startswith("CLEAN"))


def test_threshold_keeps_the_requested_recall() -> None:
    p = np.linspace(0, 1, 100)
    y = np.ones(100, dtype=int)
    assert (p >= threshold_for(p, y, 0.95)).mean() >= 0.95


def small_gate() -> Gate:
    n = len(FEATURE_NAMES)
    rng = np.random.default_rng(0)
    return Gate(
        [0.0] * n,
        [1.0] * n,
        rng.normal(size=(n, 16)).tolist(),
        rng.normal(size=16).tolist(),
        rng.normal(size=(16, 1)).tolist(),
        [0.1],
        0.5,
    )


def test_onnx_matches_the_json_gate() -> None:
    pytest.importorskip("onnx")
    pytest.importorskip("onnxruntime")
    from ssaplash_ai.coach_live_model.train import PARITY_LIMIT, onnx_diff, to_onnx

    gate = small_gate()
    x = np.random.default_rng(1).random((50, len(FEATURE_NAMES)))
    assert onnx_diff(gate, to_onnx(gate), x) <= PARITY_LIMIT


def test_comparing_models_splits_by_play() -> None:
    pytest.importorskip("sklearn")
    from ssaplash_ai.coach_live_model.train import compare

    rows: list[Row] = build_rows(3)
    scores = compare(rows)
    assert set(scores) == {"logistic", "mlp16", "mlp32x16"}
    assert scores["mlp16"].recall >= 0.9
