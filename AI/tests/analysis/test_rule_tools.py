"""규칙 분석 도구 테스트. 실제 모델 없이, 저장 특징을 직접 만들어 돌림."""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import yaml

from helpers import SR, make_synth_song, make_tone
from ssaplash_ai.bench.analysis import (
    RuleCandidate,
    band_accuracy,
    collect_true_tom_f0,
    eval_candidate,
    feature_path,
    load_candidates,
    load_features,
    predict_hits,
    save_features,
    search_bands,
)
from ssaplash_ai.bench.analysis.rule_eval import NONE_LABEL, group_confusion
from ssaplash_ai.bench.analysis.rule_features import input_as_feature, make_features
from ssaplash_ai.bench.analysis.tom_pitch import leave_one_song_out, pitch_stats
from ssaplash_ai.bench.cli import main, rules_params
from ssaplash_ai.bench.datasets.pads import PADS, SCORED_PADS, make_hits
from ssaplash_ai.bench.report import transcription_summary as ts

IDENTITY = {p: p for p in PADS}
# (시각, 패드, 탐이면 음높이 Hz)
HITS = [
    (0.1, "KICK", None),
    (0.3, "SNARE", None),
    (0.5, "HIHAT", None),
    (0.7, "FLOOR_TOM", 80.0),
    (0.9, "MID_TOM", 130.0),
    (1.1, "SMALL_TOM", 200.0),
    (1.3, "CRASH", None),
    (1.5, "RIDE", None),
]
PITCH_OF = {"KICK": 35, "SNARE": 38, "HIHAT": 42}
SECONDS = 2.0


def _burst(freq: float) -> np.ndarray:
    return make_tone(0.1, SR, freq)


def synthetic_features(hits=HITS, extra_tom_times: list[float] | None = None):
    """정답 타격대로 toms·crash·ride 트랙과 ADTOF 피치별 시각을 만듦. extra_tom_times는 정답 없는 탐 타격."""
    n = int(SECONDS * SR)
    toms = np.zeros((2, n), np.float32)
    crash = np.zeros((2, n), np.float32)
    ride = np.zeros((2, n), np.float32)
    peaks: dict[int, list[float]] = {35: [], 38: [], 42: [], 47: [], 49: []}
    for t, pad, freq in hits:
        s = int(t * SR)
        if pad in PITCH_OF:
            peaks[PITCH_OF[pad]].append(t)
        elif pad.endswith("TOM"):
            toms[:, s : s + int(0.1 * SR)] = _burst(freq)
            peaks[47].append(t)
        elif pad == "CRASH":
            crash[:, s : s + int(0.1 * SR)] = _burst(400.0)
            peaks[49].append(t)
        elif pad == "RIDE":
            ride[:, s : s + int(0.1 * SR)] = _burst(400.0)
            peaks[49].append(t)
    for t in extra_tom_times or []:
        s = int(t * SR)
        toms[:, s : s + int(0.1 * SR)] = _burst(250.0)
        peaks[47].append(t)
    f = make_features(
        peaks, {"toms": toms, "crash": crash, "ride": ride}, SR, SECONDS, {"model": "fake"}
    )
    hits_true, _ = make_hits([t for t, _, _ in hits], [p for _, p, _ in hits], None, IDENTITY)
    return f, hits_true


def _reload(tmp_path: Path, f):
    path = save_features(tmp_path / "a.npz", f)
    return load_features(path)


def test_특징은_저장하고_읽어도_같다(tmp_path: Path):
    f, _ = synthetic_features()
    g = _reload(tmp_path, f)
    assert g.sample_rate == SR and g.duration_sec == SECONDS and g.meta == {"model": "fake"}
    assert sorted(g.peaks) == [35, 38, 42, 47, 49]
    assert g.peaks[47].tolist() == [0.7, 0.9, 1.1]
    assert set(g.stems) == {"toms", "crash", "ride"}
    assert g.stems["toms"].shape == (1, int(SECONDS * SR)) and g.stems["toms"].dtype == np.float32
    # float16 저장: 진폭 0.25 사인파가 1e-3 안에서 같음
    assert np.max(np.abs(g.stems["toms"][0] - f.stems["toms"].astype(np.float32))) < 1e-3


def test_기본_규칙이면_합성_정답을_전부_맞힌다(tmp_path: Path):
    f, hits_true = synthetic_features()
    g = _reload(tmp_path, f)
    pred = predict_hits(g, {})
    assert [str(p) for p in pred["pad"]] == [p for _, p, _ in HITS]
    res = eval_candidate(RuleCandidate("base"), "ds", [("s", g, hits_true)])
    m = res.metrics()
    assert all(m[f"f1{p}"] == 1.0 for p in SCORED_PADS)
    # 정답에 페달이 없고 예측도 안 내면 페달 개수 0, 혼동 0
    assert m["pedalAsHihat"] == 0.0 and m["hihatAsPedal"] == 0.0
    assert m["tomAssignAcc"] == 1.0 and m["cymbalAssignAcc"] == 1.0
    assert m["tomFalseKept"] == 0 and m["tomMissed"] == 0
    assert res.tom.confusion == {
        ("FLOOR_TOM", "FLOOR_TOM"): 1,
        ("MID_TOM", "MID_TOM"): 1,
        ("SMALL_TOM", "SMALL_TOM"): 1,
    }


def test_경계를_올리면_탐이_전부_플로어가_되고_혼동표에_남는다(tmp_path: Path):
    f, hits_true = synthetic_features(extra_tom_times=[1.7])
    g = _reload(tmp_path, f)
    res = eval_candidate(
        RuleCandidate("high", {"tom_bands": [300, 350]}), "ds", [("s", g, hits_true)]
    )
    m = res.metrics()
    assert m["tomAssignAcc"] == pytest.approx(1 / 3)
    assert m["f1FLOOR_TOM"] < 1.0 and m["f1SMALL_TOM"] == 0.0 and m["f1CRASH"] == 1.0
    assert m["tomFalseKept"] == 1  # 1.7초 탐은 정답이 없음
    assert res.tom.confusion[("MID_TOM", "FLOOR_TOM")] == 1
    assert res.tom.confusion[(NONE_LABEL, "FLOOR_TOM")] == 1
    # 심벌은 그대로
    assert res.cymbal.confusion == {("CRASH", "CRASH"): 1, ("RIDE", "RIDE"): 1}


def test_group_confusion은_묶음_안에서만_짝짓는다():
    true, _ = make_hits([0.5, 1.0], ["SMALL_TOM", "CRASH"], None, IDENTITY)
    pred, _ = make_hits([0.51, 1.5], ["MID_TOM", "RIDE"], None, IDENTITY)
    g = group_confusion(true, pred, ("SMALL_TOM", "MID_TOM", "FLOOR_TOM"))
    assert g.matched == 1 and g.correct == 0 and g.false_kept == 0 and g.missed == 0
    c = group_confusion(true, pred, ("CRASH", "RIDE"))
    assert c.matched == 0 and c.false_kept == 1 and c.missed == 1
    assert math.isnan(c.assign_acc)


def test_후보_yaml은_여러_개와_하나를_다_읽고_이름이_겹치면_오류(tmp_path: Path):
    multi = tmp_path / "multi.yaml"
    multi.write_text(
        yaml.safe_dump(
            {"candidates": [{"name": "a", "rules": {"tom_bands": [100, 150]}}, {"rules": {}}]}
        ),
        encoding="utf-8",
    )
    single = tmp_path / "single.yaml"
    single.write_text("rules:\n  window_ms: 60\n", encoding="utf-8")
    cands = load_candidates([multi, single])
    assert [c.name for c in cands] == ["a", "multi-1", "single"]
    assert cands[0].full_rules["tom_bands"] == [100, 150] and cands[2].full_rules["window_ms"] == 60
    dup = tmp_path / "a.yaml"
    dup.write_text("rules: {}\n", encoding="utf-8")
    with pytest.raises(ValueError, match="겹침"):
        load_candidates([multi, dup])


# ---- 탐 음높이 분석 ----


def test_정답_탐_음높이를_뽑고_경계를_찾는다(tmp_path: Path):
    f, hits_true = synthetic_features()
    g = _reload(tmp_path, f)
    table = collect_true_tom_f0("ds", [("s1", g, hits_true), ("s2", g, hits_true)])
    assert len(table) == 6 and set(table["pad"]) == {"FLOOR_TOM", "MID_TOM", "SMALL_TOM"}
    by_pad = table.groupby("pad")["f0"].median()
    assert abs(by_pad["FLOOR_TOM"] - 80) < 6 and abs(by_pad["SMALL_TOM"] - 200) < 6
    assert band_accuracy(table["f0"].to_numpy(), table["pad"].tolist(), [113, 142]) == 1.0
    assert band_accuracy(
        table["f0"].to_numpy(), table["pad"].tolist(), [300, 350]
    ) == pytest.approx(1 / 3)
    bands, acc = search_bands([table], lo_range=(60, 300), step=5.0)
    assert acc == 1.0 and 80 < bands[0] <= 130 and 125 <= bands[1] <= 200  # 동률이면 작은 값
    loo = leave_one_song_out(table, step=5.0)
    assert len(loo) == 2 and loo["acc"].tolist() == [1.0, 1.0]
    stats = pitch_stats(table)
    assert list(stats["pad"]) == ["FLOOR_TOM", "MID_TOM", "SMALL_TOM"]
    assert stats["nSongs"].tolist() == [2, 2, 2] and stats["songMedianStd"].tolist() == [
        0.0,
        0.0,
        0.0,
    ]


def _mix_of(f, extra: list[tuple[float, float]] | None = None) -> np.ndarray:
    """저장 특징의 세 트랙 합 = 어댑터 입력 드럼. extra는 (시각, 진폭)으로 toms에 없는 큰 소리를 더함."""
    mix = sum(f.stems[n].astype(np.float32) for n in ("toms", "crash", "ride"))
    for t, amp in extra or []:
        s = int(t * SR)
        mix[s : s + int(0.1 * SR)] += make_tone(0.1, SR, 180.0)[0] * (amp / 0.25)
    return mix


def test_거르기와_상대_방식이_점수와_by_song_통계에_남는다(tmp_path: Path):
    from ssaplash_ai.bench.analysis import tom_summary
    from ssaplash_ai.bench.analysis.rule_features import input_as_feature

    # 1.7초 탐은 정답이 없고, 입력에는 그 자리에 큰 다른 소리가 있음 → toms 에너지 비율이 작음
    f, hits_true = synthetic_features(extra_tom_times=[1.7])
    g = _reload(tmp_path, f)
    g.input_audio = input_as_feature(_mix_of(f, extra=[(1.7, 2.5)]))
    songs = [("s", g, hits_true)]
    base = eval_candidate(RuleCandidate("base"), "ds", songs).metrics()
    assert base["tomFalseKept"] == 1 and base["tomDropped"] == 0
    gated = eval_candidate(RuleCandidate("gate", {"tom_gate_ratio": 0.1}), "ds", songs)
    m = gated.metrics()
    assert m["tomDropped"] == 1 and m["tomFalseKept"] == 0 and m["tomAssignAcc"] == 1.0
    assert all(m[f"f1{p}"] == 1.0 for p in ("FLOOR_TOM", "MID_TOM", "SMALL_TOM"))
    assert gated.songs[0].tom_dropped == 1 and gated.songs[0].tom_clusters == 0
    # 상대 방식: 80·130·200(·250 거짓 탐) 한 번씩이라 min_hits=1로 3묶음
    rel = eval_candidate(
        RuleCandidate("rel", {"tom_mode": "relative", "tom_relative_min_hits": 1}), "ds", songs
    )
    assert rel.metrics()["tomAssignAcc"] == 1.0
    assert rel.songs[0].tom_clusters == 3 and rel.songs[0].tom_cluster_hz.count("/") == 2
    summary = tom_summary(g, {"tom_mode": "relative", "tom_relative_min_hits": 1})
    assert summary.cluster_names == ["FLOOR_TOM", "MID_TOM", "SMALL_TOM"]
    # 거르기를 켰는데 입력이 없으면 오류
    g.input_audio = None
    with pytest.raises(ValueError, match="mixture"):
        predict_hits(g, {"tom_gate_ratio": 0.1})


def test_예측_탐_표는_정답_탐과_짝짓고_근처_패드를_적는다(tmp_path: Path):
    from ssaplash_ai.bench.analysis import predicted_tom_table
    from ssaplash_ai.bench.analysis.rule_eval import NONE_LABEL as NONE
    from ssaplash_ai.bench.analysis.rule_features import input_as_feature
    from ssaplash_ai.bench.analysis.tom_pitch import false_tom_nearest, gate_ratio_stats, gate_sweep

    f, hits_true = synthetic_features(extra_tom_times=[1.31])  # 1.3초 크래시 옆 10ms
    g = _reload(tmp_path, f)
    g.input_audio = input_as_feature(_mix_of(f))
    table = predicted_tom_table("ds", [("s", g, hits_true)])
    assert len(table) == 4
    assert table["truePad"].tolist() == ["FLOOR_TOM", "MID_TOM", "SMALL_TOM", NONE]
    assert table["nearestPad"].tolist() == ["FLOOR_TOM", "MID_TOM", "SMALL_TOM", "CRASH"]
    assert table["nearestMs"].iloc[3] == pytest.approx(10.0, abs=0.5)
    assert table["gateRatio"].between(0.0, 1.01).all()
    stats = gate_ratio_stats(table)
    assert stats["kind"].tolist() == ["정답 탐", "정답 없음"] and stats["nHits"].tolist() == [3, 1]
    sweep = gate_sweep(table, thresholds=[0.5])
    assert sweep.iloc[0]["trueTotal"] == 3 and sweep.iloc[0]["falseTotal"] == 1
    nearest = false_tom_nearest(table)
    assert nearest.iloc[0].tolist() == ["ds", "CRASH", 1]
    # 입력이 없으면 비율은 nan
    g.input_audio = None
    assert predicted_tom_table("ds", [("s", g, hits_true)])["gateRatio"].isna().all()


def test_band_accuracy는_무음_타격을_빼고_전부_무음이면_nan():
    assert band_accuracy(np.array([80.0, math.nan]), ["FLOOR_TOM", "SMALL_TOM"], [113, 142]) == 1.0
    assert math.isnan(band_accuracy(np.array([math.nan]), ["FLOOR_TOM"], [113, 142]))


# ---- 명령줄 (합성곡 데이터셋 + 직접 만든 특징) ----


def _synth_dataset(tmp_path: Path) -> tuple[Path, str]:
    root = tmp_path / "synth"
    onsets = [t for t, _, _ in HITS]
    classes = [
        (36, "kick", 100),
        (38, "snare", 90),
        (42, "hihat_closed", 70),
        (43, "tom_low", 80),
        (47, "tom_mid", 80),
        (50, "tom_high", 80),
        (49, "crash", 90),
        (51, "ride", 90),
    ]
    for song in ("song_a", "song_b"):
        make_synth_song(root / song, seconds=SECONDS, onsets=onsets, classes=classes)
    ds_yaml = tmp_path / "ds.yaml"
    ds_yaml.write_text(
        f"name: rule_synth\nkind: synth\nroot: {root.as_posix()}\nexpected_songs: 2\n",
        encoding="utf-8",
    )
    return ds_yaml, "rule_synth"


def test_rule_eval과_tom_pitch_명령이_끝까지_돈다(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
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
                    {"name": "base", "rules": {}},
                    {"name": "high", "rules": {"tom_bands": [300, 350]}},
                ]
            }
        ),
        encoding="utf-8",
    )
    out = tmp_path / "eval"
    code = main(
        [
            "rule-eval",
            "--features",
            str(feats),
            "--dataset",
            str(ds_yaml),
            "--candidates",
            str(cands),
            "--out",
            str(out),
            "--mlflow-uri",
            str(tmp_path / "mlruns"),
        ]
    )
    assert code == 0
    # 후보 yaml을 결과 폴더에 남기고, MLflow runId는 `폴더 이름/후보 이름` (relog 설계 3장)
    saved = yaml.safe_load((out / "candidates.yaml").read_text(encoding="utf-8"))
    assert saved["candidates"][1] == {"name": "high", "rules": {"tom_bands": [300, 350]}}
    import mlflow

    mlflow.set_tracking_uri((tmp_path / "mlruns").resolve().as_uri())
    exp = mlflow.get_experiment_by_name("chart-rules")
    runs = mlflow.search_runs(experiment_ids=[exp.experiment_id], output_format="list")
    assert sorted(r.data.tags["runId"] for r in runs) == ["eval/base", "eval/high"]
    df = pd.read_csv(out / "candidates.csv")
    assert df["candidate"].tolist() == ["base", "high"]
    base, high = df.iloc[0], df.iloc[1]
    assert base["f1Pads"] == 1.0 and base["tomAssignAcc"] == 1.0 and base["nSongs"] == 2
    assert high["tomAssignAcc"] == pytest.approx(1 / 3) and high["f1CRASH"] == 1.0
    conf = pd.read_csv(out / "confusion.csv")
    assert (conf[(conf.candidate == "high") & (conf.group == "tom")]["count"].sum()) == 6
    assert "규칙 후보 비교" in (out / "summary.md").read_text(encoding="utf-8")
    by_song = pd.read_csv(out / "by_song.csv")
    assert len(by_song) == 4 and {"tomDropped", "tomClusters", "tomClusterHz"} <= set(by_song)

    out2 = tmp_path / "pitch"
    code = main(
        [
            "tom-pitch",
            "--features",
            str(feats),
            "--dataset",
            str(ds_yaml),
            "--out",
            str(out2),
            "--step",
            "5",
        ]
    )
    assert code == 0
    printed = capsys.readouterr().out
    assert "current: 113·142Hz" in printed
    cand = yaml.safe_load((out2 / "candidates.yaml").read_text(encoding="utf-8"))
    names = [c["name"] for c in cand["candidates"]]
    assert names == ["current", f"fit_{ds_name}"]
    assert (out2 / "tom_f0_distribution.png").is_file()
    summary = (out2 / "summary.md").read_text(encoding="utf-8")
    assert "곡 하나 빼고 확인" in summary and "거르기 비율" in summary
    assert len(pd.read_csv(out2 / "tom_f0.csv")) == 6
    pred = pd.read_csv(out2 / "pred_tom.csv")
    assert len(pred) == 6 and pred["gateRatio"].notna().all()  # 합성곡 입력을 읽어 비율을 잼
    assert (out2 / "tom_gate_ratio.png").is_file()


def test_특징이_없는_곡이_있으면_먼저_만들라고_한다(tmp_path: Path):
    ds_yaml, ds_name = _synth_dataset(tmp_path)
    feats = tmp_path / "features"
    f, _ = synthetic_features()
    save_features(feature_path(feats, ds_name, "song_a"), f)
    cands = tmp_path / "c.yaml"
    cands.write_text("rules: {}\n", encoding="utf-8")
    with pytest.raises(FileNotFoundError, match="rule-features"):
        main(
            [
                "rule-eval",
                "--features",
                str(feats),
                "--dataset",
                str(ds_yaml),
                "--candidates",
                str(cands),
                "--out",
                str(tmp_path / "o"),
            ]
        )


# ---- MLflow에 더하는 패드별 F1·규칙값 ----


def test_패드별_F1과_tom_cymbal이_모델별로_나온다():
    rows = []
    for label, tp, fp, fn in (("KICK", 10, 0, 0), ("SMALL_TOM", 1, 1, 0), ("RIDE", 4, 0, 4)):
        rows.append(
            {
                "runId": "r",
                "model": "m",
                "input": "drums",
                "separator": "",
                "dataset": "d",
                "songId": "s",
                "scheme": "pads",
                "label": label,
                "windowMs": 50,
                "tp": tp,
                "fp": fp,
                "fn": fn,
            }
        )
    rows.append({**rows[0], "scheme": "five", "label": "tom", "tp": 1, "fp": 1, "fn": 0})
    rows.append({**rows[0], "scheme": "five", "label": "kick", "tp": 10, "fp": 0, "fn": 0})
    metrics = ts.label_f1_metrics(pd.DataFrame(rows))
    assert metrics == {
        "m": {
            "f1_KICK": 1.0,
            "f1_SMALL_TOM": pytest.approx(2 / 3),
            "f1_RIDE": pytest.approx(2 / 3),
            "f1_tom": pytest.approx(2 / 3),
        }
    }
    assert ts.label_f1_metrics(pd.DataFrame(columns=rows[0].keys())) == {}


def test_규칙값은_adtof_drumsep_모델만_기본값을_채워_기록한다(tmp_path: Path):
    configs = Path("configs/bench/transcribers")
    one = rules_params([configs / "adtof_drumsep" / "adtof_drumsep.yaml"])
    assert one["rules.tom_bands"] == [113, 142] and one["rules.window_ms"] == 120
    assert one["rules.cymbal_window_ms"] == 80  # S15P31A307-163 기본값
    assert one["rules.cymbal_min_energy"] == 1e-8  # yaml에 없는 키는 기본값
    assert rules_params([configs / "adtof" / "adtof.yaml"]) == {}
    two = rules_params(
        [configs / "adtof_drumsep" / "adtof_drumsep.yaml", configs / "adtof" / "adtof.yaml"]
    )
    assert "rules.adtof_drumsep.tom_bands" in two and not any(
        k.startswith("rules.adtof.") for k in two
    )


def test_특징에_프레임별_점수와_트랙_전부를_저장하고_규칙이_탐_시각을_다시_고른다(tmp_path: Path):
    # 정답 탐 0.7·0.9·1.1에 더해 0.75초에 작은 더블. ADTOF 기본 피크 고르기는 0.75를 놓침
    act = np.zeros((int(SECONDS * 100), 5), np.float32)
    for t, h in ((0.7, 0.9), (0.75, 0.4), (0.9, 0.9), (1.1, 0.9)):
        act[int(round(t * 100)), 2] = h
    hits = [*HITS, (0.75, "FLOOR_TOM", 80.0)]
    f, hits_true = synthetic_features(hits)
    f.peaks[47] = np.array([0.7, 0.9, 1.1])  # 저장소 기본 피크 고르기가 낸 시각
    f.stems["kick"] = np.zeros_like(f.stems["toms"])
    f.activations = act
    g = _reload(tmp_path, f)
    assert g.activations is not None and g.activations.shape == act.shape
    assert set(g.stems) == {"toms", "crash", "ride", "kick"}
    g.input_audio = input_as_feature(_mix_of(f))
    songs = [("s", g, hits_true)]
    base = eval_candidate(RuleCandidate("base"), "ds", songs).metrics()
    assert base["tomMissed"] == 1 and base["tomRescued"] == 0
    loose = eval_candidate(
        RuleCandidate("loose", {"tom_peak_mode": "raw", "tom_threshold": 0.3}), "ds", songs
    )
    assert loose.metrics()["tomMissed"] == 0 and loose.metrics()["f1FLOOR_TOM"] == 1.0
    assert loose.songs[0].tom_rescued == 0
    # 옛 파일(점수 없음)은 그대로 읽히고 규칙을 넣어도 시각이 안 바뀜
    f.activations = None
    old = _reload(tmp_path, f)
    assert old.activations is None
    old.input_audio = g.input_audio
    res = eval_candidate(
        RuleCandidate("loose", {"tom_peak_mode": "raw"}), "ds", [("s", old, hits_true)]
    )
    assert res.metrics()["tomMissed"] == 1


def test_곡_안_이름_바뀜을_맞은_것으로_치는_보조_지표(tmp_path: Path):
    from ssaplash_ai.bench.analysis.rule_eval import GroupResult

    g = GroupResult(matched=10, correct=2)
    # 정답 MID를 전부 SMALL로, SMALL을 전부 MID로 붙인 곡: 일대일 대응으로 세면 전부 맞음
    g.confusion = {
        ("FLOOR_TOM", "FLOOR_TOM"): 2,
        ("MID_TOM", "SMALL_TOM"): 5,
        ("SMALL_TOM", "MID_TOM"): 3,
    }
    assert g.consistent_correct(("SMALL_TOM", "MID_TOM", "FLOOR_TOM")) == 10
    g.confusion[("MID_TOM", "MID_TOM")] = 1  # 섞이면 더 좋은 대응을 고름
    assert g.consistent_correct(("SMALL_TOM", "MID_TOM", "FLOOR_TOM")) == 10
    # 후보 평가에 열이 남는다. 합성 정답은 전부 맞으니 1.0
    f, hits_true = synthetic_features()
    res = eval_candidate(RuleCandidate("base"), "ds", [("s", _reload(tmp_path, f), hits_true)])
    m = res.metrics()
    assert m["tomConsistentAcc"] == 1.0 and m["f1TomConsistent"] == 1.0
    assert res.songs[0].tom_consistent == 3


def test_탐_둘인_곡의_위쪽_탐_정답_이름을_통일한다():
    from ssaplash_ai.bench.analysis.rule_eval import rename_two_tom_upper

    two = make_hits(
        [0.1, 0.5, 0.9], ["FLOOR_TOM", "SMALL_TOM", "KICK"], None, {p: p for p in PADS}
    )[0]
    out = rename_two_tom_upper(two, "MID_TOM")
    assert out["pad"].tolist() == ["FLOOR_TOM", "MID_TOM", "KICK"]
    assert two["pad"].tolist()[1] == "SMALL_TOM"  # 원본은 안 건드림
    assert rename_two_tom_upper(two, "SMALL_TOM") is two  # 이미 그 이름이면 그대로
    # 탐 셋이거나 플로어탐이 없으면 그대로
    three = make_hits(
        [0.1, 0.5, 0.9], ["FLOOR_TOM", "SMALL_TOM", "MID_TOM"], None, {p: p for p in PADS}
    )[0]
    assert rename_two_tom_upper(three, "MID_TOM") is three
    no_floor = make_hits([0.1, 0.5], ["SMALL_TOM", "MID_TOM"], None, {p: p for p in PADS})[0]
    assert rename_two_tom_upper(no_floor, "MID_TOM") is no_floor
    with pytest.raises(ValueError, match="two_tom_upper"):
        rename_two_tom_upper(two, "KICK")


def test_분리_트랙을_재사용하면_분리를_부르지_않는다(tmp_path: Path):
    """파인튜닝 가중치 평가용 --stems-from: 기존 특징의 분리 트랙을 복사하고 ADTOF만 다시 돌림 (작업 18)."""
    from types import SimpleNamespace

    from ssaplash_ai.bench.analysis.rule_features import features_from_adapter, reusable_stems
    from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import rules_with_defaults

    old, _ = synthetic_features()
    path = save_features(feature_path(tmp_path, "ds", "song"), old)
    assert reusable_stems(None, "ds", "song") is None
    assert reusable_stems(tmp_path, "ds", "없는곡") is None
    stems = reusable_stems(tmp_path, "ds", "song")
    assert stems is not None and set(stems) == set(old.stems)

    class FakeAdtof:
        def activations(self, audio, sr):
            return np.full((int(SECONDS * 100), 5), 0.1, dtype=np.float32)

        def peaks(self, act):
            return {35: [0.1], 38: [], 42: [], 47: [0.7], 49: []}

    def no_separation(audio, sr):
        raise AssertionError("분리 트랙을 재사용할 때는 분리를 부르면 안 됨")

    tr = SimpleNamespace(
        name="fake",
        rules=rules_with_defaults({}),
        _adtof=FakeAdtof(),
        stems=no_separation,
        config=SimpleNamespace(config_hash="h"),
        _checkpoint_id=lambda: "ck",
    )
    audio = make_tone(SECONDS, SR, 220.0)
    f = features_from_adapter(tr, audio, SR, stems=stems)
    assert f.meta["stemsReused"] is True and f.peaks[47].tolist() == [0.7]
    np.testing.assert_array_equal(f.stems["toms"], old.stems["toms"])
    assert f.activations.shape == (int(SECONDS * 100), 5)
    with pytest.raises(AssertionError, match="분리"):
        features_from_adapter(tr, audio, SR)
    assert path.is_file()
