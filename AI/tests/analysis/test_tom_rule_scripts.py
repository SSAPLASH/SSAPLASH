"""탐 그룹 규칙 다시 고르기 스크립트 테스트."""

from __future__ import annotations

import csv
import importlib.util
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import yaml

from ssaplash_ai.bench.analysis import feature_path, save_features
from ssaplash_ai.bench.cli import main as bench_main

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_rule_tools import _synth_dataset, synthetic_features  # noqa: E402

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
SERVICE = (
    Path(__file__).resolve().parents[2]
    / "configs/bench/transcribers/adtof_drumsep/adtof_drumsep.yaml"
)


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_current는_서비스_규칙_그대로이고_current_order는_이름_규칙만_다르다():
    g = _load("tom_rule_grid")
    base = g.service_rules(SERVICE)
    cands = g.build_candidates(base)
    by = {c["name"]: c["rules"] for c in cands}
    assert by["current"] == base
    diff = {k for k in by["current_order"] if by["current_order"][k] != base.get(k)}
    assert diff == {"tom_relative_naming"} and by["current_order"]["tom_relative_naming"] == "order"
    assert len(cands) == 2 + 5 * 3 * 3 * 2
    assert all(c["rules"]["tom_relative_naming"] == "order" for c in cands[1:])
    parts = g.split(cands, 4)
    assert len(parts) == 4 and sum(parts, []) == cands


def _features_and_cands(tmp_path: Path) -> tuple[Path, Path, Path]:
    ds_yaml, ds_name = _synth_dataset(tmp_path)
    feats = tmp_path / "features"
    f, _ = synthetic_features()
    for song in ("song_a", "song_b"):
        save_features(feature_path(feats, ds_name, song), f)
    cands = tmp_path / "cands.yaml"
    cands.write_text(
        yaml.safe_dump(
            {
                "candidates": [
                    {"name": "current", "rules": {}},
                    {"name": "high", "rules": {"tom_bands": [300, 350]}},
                ]
            }
        ),
        encoding="utf-8",
    )
    return ds_yaml, feats, cands


def test_곡_하나씩_채점해도_rule_eval_곡별_개수와_같다(tmp_path: Path, monkeypatch):
    ds_yaml, feats, cands = _features_and_cands(tmp_path)
    out_eval = tmp_path / "eval"
    assert (
        bench_main(
            [
                "rule-eval",
                "--features",
                str(feats),
                "--dataset",
                str(ds_yaml),
                "--candidates",
                str(cands),
                "--out",
                str(out_eval),
            ]
        )
        == 0
    )
    m = _load("tom_rule_eval_stream")
    out_csv = tmp_path / "stream.csv"
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "x",
            "--dataset",
            str(ds_yaml),
            "--features",
            str(feats),
            "--candidates",
            str(cands),
            "--workers",
            "1",
            "--out",
            str(out_csv),
        ],
    )
    assert m.main() == 0
    ref = pd.read_csv(out_eval / "by_song.csv").set_index(["candidate", "songId"]).sort_index()
    got = pd.read_csv(out_csv).set_index(["candidate", "songId"]).sort_index()
    cols = ["tomMatched", "tomCorrect", "tomFalseKept", "tomClusters"] + [
        c for c in got.columns if c[:2] in ("tp", "fp", "fn")
    ]
    pd.testing.assert_frame_equal(got[cols], ref[cols], check_dtype=False)
    assert (got["tomTrueKinds"] == 3).all()


def _rows(cands_acc: dict[str, dict[str, tuple[int, int]]]) -> pd.DataFrame:
    rows = []
    for cand, kits in cands_acc.items():
        for kit, (correct, matched) in kits.items():
            rows.append(
                {"candidate": cand, "kit": kit, "tomCorrect": correct, "tomMatched": matched}
            )
    return pd.DataFrame(rows)


def test_고르기는_키트_평균으로_하고_비슷하면_바뀐_키가_적은_후보():
    p = _load("tom_rule_pick")
    cands = {
        "current": {"a": 1, "b": 1},
        "one": {"a": 2, "b": 1},
        "two": {"a": 2, "b": 2},
    }
    df = _rows(
        {
            "current": {"k1": (5, 10), "k2": (5, 10)},
            "one": {"k1": (8, 10), "k2": (8, 10)},
            "two": {"k1": (9, 10), "k2": (7, 10)},  # 평균 같음 → 바뀐 키가 적은 one
        }
    )
    acc = p.kit_accuracy(df)
    assert p.choose(acc, ["k1", "k2"], cands) == "one"
    assert p.choose(acc, ["k1"], cands) == "two"
    loko = p.leave_one_kit_out(acc, cands).set_index("kit")
    assert loko.loc["k2", "chosen"] == "two" and loko.loc["k2", "diff"] == pytest.approx(0.2)
    assert loko.loc["k1", "chosen"] == "one" and loko.loc["k1", "diff"] == pytest.approx(0.3)


def _enst_df(tmp_path: Path) -> pd.DataFrame:
    rows = []
    for cand, tp in (("current", 1), ("better", 2)):
        for song in ("drummer_1/a", "drummer_2/b", "drummer_3/c"):
            r = {
                "candidate": cand,
                "songId": song,
                "tomCorrect": tp,
                "tomMatched": 2,
                "tomTrueKinds": 2,
                "tomClusters": 2,
            }
            for pad in (
                "KICK",
                "SNARE",
                "HIHAT",
                "SMALL_TOM",
                "MID_TOM",
                "FLOOR_TOM",
                "CRASH",
                "RIDE",
            ):
                r[f"tp{pad}"], r[f"fp{pad}"], r[f"fn{pad}"] = 2, 0, 0
            r["tpMID_TOM"], r["fpMID_TOM"], r["fnMID_TOM"] = tp, 2 - tp, 2 - tp
            rows.append(r)
    return pd.DataFrame(rows)


def test_ENST_표는_드러머별로_나누고_같은_후보는_차이가_0이다(tmp_path: Path):
    p = _load("tom_rule_pick")
    df = _enst_df(tmp_path)
    rows = {(r["group"], r["candidate"]): r for r in p.enst_table(df, ["better"], 0.8)}
    assert (
        rows[("드러머 1", "current")]["songs"] == 1 and rows[("드러머 2·3", "better")]["songs"] == 2
    )
    b = rows[("전체", "better")]
    assert b["tom3_d"] > 0 and b["tom3_lo"] > 0 and b["name_d"] == pytest.approx(0.5)
    assert b["pads8_rideref"] == pytest.approx(0.8 + b["pads8_diff"])
    m = p.song_matrix(df, "current", sorted(df["songId"].unique()))
    d, lo, hi = p.paired_bootstrap(m, m, "tom3", n_boot=50)
    assert d == 0 and lo == 0 and hi == 0


def test_select_명령이_결과_파일을_쓴다(tmp_path: Path, monkeypatch):
    p = _load("tom_rule_pick")
    cands = tmp_path / "c.yaml"
    cands.write_text(
        yaml.safe_dump(
            {
                "candidates": [
                    {"name": "current", "rules": {"a": 1}},
                    {"name": "x", "rules": {"a": 2}},
                ]
            }
        ),
        encoding="utf-8",
    )
    df = _rows({"current": {"k1": (1, 2), "k2": (1, 2)}, "x": {"k1": (2, 2), "k2": (2, 2)}})
    df["tomTrueKinds"] = 1
    egmd = tmp_path / "e.csv"
    df.to_csv(egmd, index=False)
    out = tmp_path / "pick.json"
    monkeypatch.setattr(
        sys,
        "argv",
        ["x", "select", "--egmd", str(egmd), "--candidates", str(cands), "--out", str(out)],
    )
    assert p.main() == 0
    got = yaml.safe_load(out.read_text(encoding="utf-8"))
    assert got["chosen"] == "x" and got["one_tom_acc"]["current"] == 0.5
    assert len(list(csv.reader(open(out.with_suffix(".kits.csv"), encoding="utf-8")))) == 3
    assert np.isclose(got["loko"][0]["diff"], 0.5)


def test_분리_입력_특징은_분리_드럼을_stem_input으로_저장하고_있는_곡은_건너뛴다(
    tmp_path, monkeypatch
):
    from types import SimpleNamespace

    from ssaplash_ai.bench.analysis import rule_features as rf

    sep_feat = _load("rule_features_separated")
    sr = 8000
    mixture = np.ones((2, sr), dtype=np.float32)

    class Ds:
        name = "toy"

        def song_ids(self):
            return ["a/1", "b/2"]

        def load(self, song_id):
            if song_id == "b/2":
                raise RuntimeError("읽기 실패")
            return SimpleNamespace(mixture=mixture, sample_rate=sr)

    sep = SimpleNamespace(separate=lambda mix, rate: SimpleNamespace(drums=mix * 0.5))
    seen = {}

    def fake_features(tr, audio, rate, stems=None):
        seen["audio"] = audio
        return rf.make_features({47: [0.1]}, {"toms": audio}, rate, audio.shape[1] / rate)

    monkeypatch.setattr(rf, "features_from_adapter", fake_features)
    assert sep_feat.build(Ds(), sep, object(), tmp_path, log=lambda m: None) == (1, 0, 1)
    assert np.allclose(seen["audio"], 0.5)  # 채보에 원곡이 아니라 분리 드럼을 넣음
    f = rf.load_features(rf.feature_path(tmp_path, "toy", "a/1"))
    assert np.allclose(f.stems["input"], 0.5, atol=1e-3)
    assert sep_feat.build(Ds(), sep, object(), tmp_path, log=lambda m: None) == (0, 1, 1)
