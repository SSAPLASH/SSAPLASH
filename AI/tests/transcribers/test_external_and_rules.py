"""external 어댑터(가짜 스크립트), ADTOF+드럼 킷 분리 규칙·가중치 조합, 저장소 모델 yaml 읽기,
YourMT3·drum2midi 스크립트 테스트."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from helpers import SR, make_synth_song, make_tone
from ssaplash_ai.bench.datasets import DatasetConfig, SynthDataset
from ssaplash_ai.bench.datasets.gmd import GMD_PITCH_PAD
from ssaplash_ai.bench.metrics import score_hits
from ssaplash_ai.bench.runner.transcription_runner import TranscriptionRunOptions, run_transcription
from ssaplash_ai.bench.transcribers import (
    BatchItem,
    TranscriberConfig,
    create_transcriber,
    venv_python,
    write_truth_csv,
)
from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import (
    AdtofDrumsepTranscriber,
    assign_pads,
    cymbal_pad,
    estimate_f0,
    merge_pad_hits,
    merge_tom_hits,
    rules_with_defaults,
    tom_pad,
)

ROOT = Path(__file__).resolve().parents[2]
CONFIGS_DIR = ROOT / "configs" / "bench" / "transcribers"
IDENTITY = {
    p: p for p in ("KICK", "SNARE", "HIHAT", "SMALL_TOM", "MID_TOM", "FLOOR_TOM", "CRASH", "RIDE")
}

# 가짜 외부 스크립트: 요청의 options.truth_dir에서 <song_id>.csv를 읽어 그대로 돌려줌. 프로토콜만 검증.
FAKE_SCRIPT = """
import argparse, csv, json, sys, time
from pathlib import Path
p = argparse.ArgumentParser(); p.add_argument("--request"); p.add_argument("--response")
a = p.parse_args()
req = json.loads(Path(a.request).read_text(encoding="utf-8"))
opts = req["options"]
resp = {"load_sec": 0.01, "checkpoint": "fake:v1", "n_params": 12, "songs": [], "note": opts.get("note")}
for s in req["songs"]:
    e = {"song_id": s["song_id"], "hits": [], "elapsed_sec": 0.02, "peak_vram_mb": opts.get("vram"), "error": None}
    if s["song_id"] == opts.get("fail_song"):
        e["error"] = "모의 실패"
    else:
        path = Path(opts["truth_dir"]) / (s["song_id"] + ".csv")
        with open(path, encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                v = int(r["velocity"]); e["hits"].append([float(r["time_sec"]), r["label"], None if v < 0 else v])
    resp["songs"].append(e)
if opts.get("crash"):
    sys.exit(3)
Path(a.response).write_text(json.dumps(resp), encoding="utf-8")
"""


def _cfg(script: Path, **options) -> TranscriberConfig:
    return TranscriberConfig.from_dict(
        {
            "name": "fake_ext",
            "adapter": "external",
            "python_exe": sys.executable,
            "script": str(script),
            "env_name": "fake",
            "license_code": "x",
            "license_weights": "y",
            "labels": dict(IDENTITY),
            "options": options,
        }
    )


@pytest.fixture
def ext(tmp_path: Path) -> dict:
    root = tmp_path / "synth"
    make_synth_song(root / "song_a")
    make_synth_song(root / "song_b")
    ds_yaml = tmp_path / "ds.yaml"
    ds_yaml.write_text(f"name: s\nkind: synth\nroot: {root.as_posix()}\n", encoding="utf-8")
    ds = SynthDataset(DatasetConfig.from_yaml(ds_yaml))
    truth = tmp_path / "truth"
    for sid in ds.song_ids():
        write_truth_csv(truth / f"{sid}.csv", ds.load(sid).hits_true)
    script = tmp_path / "fake_script.py"
    script.write_text(FAKE_SCRIPT, encoding="utf-8")
    return {"ds": ds, "ds_yaml": ds_yaml, "truth": truth, "script": script}


def test_external_단일_곡_프로토콜(ext: dict, tmp_path: Path):
    tr = create_transcriber(
        _cfg(ext["script"], truth_dir=ext["truth"].as_posix(), vram=123.0), "cpu"
    )
    tr.load()
    item = ext["ds"].load("song_a")
    out = tr.transcribe(item.drums_true, SR, "song_a")
    assert score_hits(item.hits_true, out.hits_pred, "pads").f1 == 1.0
    assert out.elapsed_sec == 0.02 and out.peak_vram_mb == 123.0 and out.vram_method == "script"
    assert tr.info().checkpoint == "fake:v1" and tr.info().n_params == 12


def test_external_batch_곡_실패와_스크립트_죽음(ext: dict, tmp_path: Path):
    tr = create_transcriber(
        _cfg(ext["script"], truth_dir=ext["truth"].as_posix(), fail_song="song_b"), "cpu"
    )
    tr.load()
    tr.work_dir = tmp_path / "work"
    items = [BatchItem(sid, tmp_path / f"{sid}.wav", 2.0) for sid in ("song_a", "song_b")]
    out = tr.transcribe_files(items, warmup=False)
    assert out.load_sec == 0.01 and isinstance(out.results["song_b"], str)
    assert "모의 실패" in out.results["song_b"] and not isinstance(out.results["song_a"], str)
    assert (tmp_path / "work" / "fake_ext.request.json").is_file()
    req = json.loads((tmp_path / "work" / "fake_ext.request.json").read_text(encoding="utf-8"))
    assert [s["song_id"] for s in req["songs"]] == ["song_a", "song_b"] and req["device"] == "cpu"

    dead = create_transcriber(
        _cfg(ext["script"], truth_dir=ext["truth"].as_posix(), crash=True), "cpu"
    )
    dead.load()
    out = dead.transcribe_files(items, warmup=False)
    assert all(isinstance(r, str) and "exit 3" in r for r in out.results.values())


def test_external_python이_없으면_load_실패(ext: dict, tmp_path: Path):
    cfg = _cfg(ext["script"])
    cfg.python_exe = str(tmp_path / "nope" / "python.exe")
    tr = create_transcriber(cfg, "cpu")
    with pytest.raises(FileNotFoundError, match=r"별도 환경 python.*또는 .*\.venv-fake"):
        tr.load()


def test_external_python_경로가_없으면_env_name_폴더에서_찾는다(
    ext: dict, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    # yaml에 적힌 Windows 경로가 없는 OS(코랩)라도 .venv-<env_name>의 이 OS python을 쓴다
    monkeypatch.chdir(tmp_path)
    alt = venv_python(".venv-fake")
    alt.parent.mkdir(parents=True)
    alt.write_text("", encoding="utf-8")
    cfg = _cfg(ext["script"])
    cfg.python_exe = (
        ".venv-fake/Scripts/python.exe" if alt.name != "python.exe" else ".venv-fake/bin/python"
    )
    tr = create_transcriber(cfg, "cpu")
    assert tr.python_exe == alt
    tr.load()  # 실행 파일·스크립트 존재 확인만 통과하면 됨


def test_러너는_external을_batch로_돌린다(ext: dict, tmp_path: Path):
    yaml = tmp_path / "ext.yaml"
    yaml.write_text(
        "\n".join(
            [
                "name: fake_ext",
                "adapter: external",
                f"python_exe: {Path(sys.executable).as_posix()}",
                f"script: {ext['script'].as_posix()}",
                "env_name: fake",
                "license_code: x",
                "license_weights: y",
                "options:",
                f"  truth_dir: {ext['truth'].as_posix()}",
                "  fail_song: song_b",
                "  note: 안내문",
                "labels:",
            ]
            + [f"  {k}: {v}" for k, v in IDENTITY.items()]
        )
        + "\n",
        encoding="utf-8",
    )
    logs: list[str] = []
    result = run_transcription(
        TranscriptionRunOptions(
            model_configs=[yaml],
            dataset_config=ext["ds_yaml"],
            out_dir=tmp_path / "out",
            device="cpu",
            save_midi=1,
        ),
        log=logs.append,
    )
    rows = {r["songId"]: r for r in result.rows}
    assert rows["song_a"]["error"] == "" and rows["song_a"]["f1Pads50"] == 1.0
    assert rows["song_a"]["rtf"] == pytest.approx(0.02 / 2.0) and rows["song_a"]["loadSec"] == 0.01
    assert rows["song_a"]["vramMethod"] == ""  # cpu 실행: nvidia-smi 안 씀
    assert "모의 실패" in rows["song_b"]["error"]
    assert (result.run_dir / "inputs" / "fake_ext" / "song_a.wav").is_file()
    assert (result.run_dir / "midi" / "fake_ext" / "song_a.mid").is_file()
    assert any("안내문" in line for line in logs)


# ---- ADTOF + 드럼 킷 분리 규칙 ----


def _sine(freq: float, seconds: float = 0.1) -> np.ndarray:
    return make_tone(seconds, SR, freq)


def test_탐_음높이로_패드를_나눈다():
    r = rules_with_defaults(None)
    for freq, pad in ((80.0, "FLOOR_TOM"), (140.0, "MID_TOM"), (220.0, "SMALL_TOM")):
        f0 = estimate_f0(_sine(freq)[0], SR, r["tom_fmin"], r["tom_fmax"])
        assert abs(f0 - freq) < 6.0, (freq, f0)
        assert tom_pad(f0, r["tom_bands"]) == pad
    assert tom_pad(float("nan"), r["tom_bands"]) == "MID_TOM"
    assert np.isnan(estimate_f0(np.zeros(100, np.float32), SR, 50, 400))


def test_심벌은_스템_에너지로_나눈다():
    loud = _sine(300.0)[0]
    quiet = loud * 0.1
    assert cymbal_pad(loud, quiet, 1e-8) == "CRASH"
    assert cymbal_pad(quiet, loud, 1e-8) == "RIDE"
    assert cymbal_pad(np.zeros(10, np.float32), np.zeros(10, np.float32), 1e-8) == "CRASH"


def test_assign_pads는_ADTOF_피치를_패드_이름으로():
    seconds = 1.0
    toms = np.zeros((2, SR), np.float32)
    toms[:, int(0.2 * SR) : int(0.2 * SR) + int(0.1 * SR)] = _sine(80.0)  # 플로어
    toms[:, int(0.6 * SR) : int(0.6 * SR) + int(0.1 * SR)] = _sine(230.0)  # 하이
    crash = np.zeros((2, SR), np.float32)
    ride = np.zeros((2, SR), np.float32)
    ride[:, int(0.4 * SR) : int(0.4 * SR) + int(0.1 * SR)] = _sine(400.0)
    crash[:, int(0.8 * SR) : int(0.8 * SR) + int(0.1 * SR)] = _sine(400.0)
    peaks = {35: [0.1], 38: [0.3], 42: [0.5], 47: [0.2, 0.6], 49: [0.4, 0.8]}
    hits = assign_pads(peaks, {"toms": toms, "crash": crash, "ride": ride}, SR, {"window_ms": 80})
    assert [(round(t, 2), p) for t, p, _ in hits] == [
        (0.1, "KICK"),
        (0.2, "FLOOR_TOM"),
        (0.3, "SNARE"),
        (0.4, "RIDE"),
        (0.5, "HIHAT"),
        (0.6, "SMALL_TOM"),
        (0.8, "CRASH"),
    ]
    assert seconds == 1.0


def test_merge_pad_hits는_고른_패드만_다른_결과로_바꾼다():
    hits = [(0.1, "KICK", None), (0.2, "CRASH", None), (0.3, "MID_TOM", None)]
    other = [(0.1, "KICK", None), (0.2, "RIDE", None), (0.5, "CRASH", None)]
    out = merge_pad_hits(hits, other, ("CRASH", "RIDE"))
    assert [(t, p) for t, p, _ in out] == [
        (0.1, "KICK"),
        (0.2, "RIDE"),
        (0.3, "MID_TOM"),
        (0.5, "CRASH"),
    ]


def test_merge_tom_hits는_탐_3종만_탐_전용_결과로_바꾼다():
    hits = [(0.1, "KICK", None), (0.2, "FLOOR_TOM", None), (0.3, "HIHAT_PEDAL", None)]
    tom_hits = [(0.1, "KICK", None), (0.25, "MID_TOM", None), (0.4, "SMALL_TOM", None)]
    assert [(t, p) for t, p, _ in merge_tom_hits(hits, tom_hits)] == [
        (0.1, "KICK"),
        (0.25, "MID_TOM"),
        (0.3, "HIHAT_PEDAL"),
        (0.4, "SMALL_TOM"),
    ]


def test_서비스_조합_어댑터는_탐_전용_ADTOF는_기본_가중치로_심벌_전용은_7클래스로_만든다():
    cfg = TranscriberConfig.from_yaml(CONFIGS_DIR / "adtof_drumsep" / "adtof_drumsep_realrec.yaml")
    tr = AdtofDrumsepTranscriber(cfg, device="cpu")
    assert cfg.checkpoint_path == "data/models/adtof_ft/tom_6cls_real_full/best.pth"
    assert tr._tom_adtof is not None and tr._tom_adtof.config.checkpoint_path is None
    assert tr._cym_adtof is not None
    assert (
        tr._cym_adtof.config.checkpoint_path == "data/models/adtof_ft/tom_7cls_real_full/best.pth"
    )
    assert [pads for _, pads in tr._extras()] == [
        ("SMALL_TOM", "MID_TOM", "FLOOR_TOM"),
        ("CRASH", "RIDE"),
    ]
    assert tr._adtof.config.checkpoint_path == cfg.checkpoint_path
    assert cfg.labels["HIHAT_PEDAL"] == "HIHAT"  # 채보 JSON 8패드 유지
    plain = TranscriberConfig.from_yaml(CONFIGS_DIR / "adtof_drumsep" / "adtof_drumsep.yaml")
    assert AdtofDrumsepTranscriber(plain, device="cpu")._tom_adtof is None


def _yaml_dict(cfg: TranscriberConfig) -> dict:
    import yaml

    return yaml.safe_load(cfg.source_path.read_text(encoding="utf-8"))


def test_실제_곡_평균_조합은_탐_열을_빼고_평균하고_심벌은_이름만_가져온다():
    cfg = TranscriberConfig.from_yaml(
        CONFIGS_DIR / "adtof_drumsep" / "adtof_drumsep_songsterr_avg.yaml"
    )
    tr = AdtofDrumsepTranscriber(cfg, device="cpu")
    assert cfg.cymbal_mode == "name"
    assert [(a.config.checkpoint_path, cols) for a, cols in tr._avg_adtofs] == [
        ("data/models/songsterr_ft/five_all/last.pth", "kshc")
    ]
    plain = TranscriberConfig.from_yaml(CONFIGS_DIR / "adtof_drumsep" / "adtof_drumsep.yaml")
    assert plain.cymbal_mode == "take" and plain.average_checkpoints == []
    with pytest.raises(ValueError, match="cymbal_mode"):
        bad = {**_yaml_dict(plain), "cymbal_mode": "x"}
        AdtofDrumsepTranscriber(TranscriberConfig.from_dict(bad), device="cpu")
    with pytest.raises(ValueError, match="columns"):
        bad = {**_yaml_dict(plain), "average_checkpoints": [{"path": "default", "columns": "kz"}]}
        AdtofDrumsepTranscriber(TranscriberConfig.from_dict(bad), device="cpu")


def test_점수_평균은_적은_열만_평균하고_짧은_길이에_맞춘다():
    from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import average_activations

    main = np.full((4, 5), 0.2, dtype=np.float32)
    other = np.full((3, 5), 0.6, dtype=np.float32)
    out = average_activations(main, [(other, "kshc")])
    assert out.shape == (3, 5)
    np.testing.assert_allclose(out[:, [0, 1, 3, 4]], 0.4)
    np.testing.assert_allclose(out[:, 2], 0.2)  # 탐 열은 주 가중치 그대로


def test_심벌_이름만_가져오기는_시각은_두고_50ms_안_이름만_바꾼다():
    from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import rename_pad_hits

    hits = [(1.0, "CRASH", None), (2.0, "RIDE", None), (3.0, "KICK", None)]
    other = [(1.03, "RIDE", None), (2.2, "CRASH", None), (3.0, "SNARE", None)]
    assert rename_pad_hits(hits, other, ("CRASH", "RIDE")) == [
        (1.0, "RIDE", None),
        (2.0, "RIDE", None),
        (3.0, "KICK", None),
    ]


def test_파인튜닝_가중치_상대_경로는_SSAPLASH_MODELS_DIR_기준으로_찾는다(
    monkeypatch, tmp_path: Path
):
    from ssaplash_ai.bench.transcribers.adtof_transcriber import resolve_checkpoint

    path = "data/models/adtof_ft/x/best.pth"
    monkeypatch.delenv("SSAPLASH_MODELS_DIR", raising=False)
    assert resolve_checkpoint(path) == Path(path)
    monkeypatch.setenv("SSAPLASH_MODELS_DIR", str(tmp_path))
    assert resolve_checkpoint(path) == tmp_path / "adtof_ft" / "x" / "best.pth"
    assert resolve_checkpoint("other/best.pth") == Path("other/best.pth")


def test_cluster_pitches는_큰_틈에서_자르고_작은_묶음은_합친다():
    from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import cluster_pitches

    # 94·96 / 129·131 / 160·162 Hz: 반음 틈 5.1·3.5 → 3묶음
    assert cluster_pitches([94, 96, 129, 131, 160, 162]).tolist() == [0, 0, 1, 1, 2, 2]
    # 틈이 2반음 미만이면 한 묶음
    assert cluster_pitches([100, 103, 106]).tolist() == [0, 0, 0]
    # 한 번 튄 값(300)은 min_hits=2라 이웃 묶음에 합침. min_hits=1이면 따로
    assert cluster_pitches([94, 96, 129, 131, 300]).tolist() == [0, 0, 1, 1, 1]
    assert cluster_pitches([94, 96, 129, 131, 300], min_hits=1).tolist() == [0, 0, 1, 1, 2]
    # k=2면 가장 큰 틈 한 곳만 자름
    assert cluster_pitches([94, 96, 129, 131, 160, 162], k=2).tolist() == [0, 0, 1, 1, 1, 1]
    # 정렬돼 있지 않아도 번호는 음높이 낮은 순
    assert cluster_pitches([160, 94, 129, 162, 96, 131]).tolist() == [2, 0, 1, 2, 0, 1]
    # 무음(nan)은 -1
    assert cluster_pitches([float("nan"), 100, 102]).tolist() == [-1, 0, 0]
    assert cluster_pitches([float("nan")]).tolist() == [-1]
    assert cluster_pitches([]).tolist() == []


def test_name_clusters는_3개면_순서_그보다_적으면_naming대로():
    from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import name_clusters

    assert name_clusters([94, 129, 162]) == ["FLOOR_TOM", "MID_TOM", "SMALL_TOM"]
    assert name_clusters([200, 250, 300]) == ["FLOOR_TOM", "MID_TOM", "SMALL_TOM"]  # 순서만
    # bands: 묶음 중앙값을 고정 경계로. 둘이 같은 이름이면 그 안에서 벌림
    assert name_clusters([100]) == ["FLOOR_TOM"]
    assert name_clusters([130]) == ["MID_TOM"]
    assert name_clusters([200]) == ["SMALL_TOM"]
    assert name_clusters([100, 200]) == ["FLOOR_TOM", "SMALL_TOM"]
    assert name_clusters([80, 100]) == ["FLOOR_TOM", "MID_TOM"]
    assert name_clusters([160, 200]) == ["MID_TOM", "SMALL_TOM"]
    assert name_clusters([115, 140]) == [
        "FLOOR_TOM",
        "MID_TOM",
    ]  # 둘 다 미드, 아래가 경계에 더 가까움
    assert name_clusters([120, 141]) == [
        "MID_TOM",
        "SMALL_TOM",
    ]  # 둘 다 미드, 위가 경계에 더 가까움
    # order: 순서만. 1개 MID, 2개 FLOOR·MID
    assert name_clusters([200], naming="order") == ["MID_TOM"]
    assert name_clusters([200, 300], naming="order") == ["FLOOR_TOM", "MID_TOM"]
    assert name_clusters([]) == []


def _toms_track(bursts: list[tuple[float, float, float]], seconds: float = 2.0) -> np.ndarray:
    """(시각, Hz, 진폭 배수) 목록 → (2, 샘플) toms 트랙."""
    toms = np.zeros((2, int(seconds * SR)), np.float32)
    for t, freq, scale in bursts:
        s = int(t * SR)
        toms[:, s : s + int(0.1 * SR)] = _sine(freq) * scale
    return toms


def test_relative_모드는_곡_안_순서로_탐을_나눈다():
    from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import assign_toms

    # 세 탐이 70·100·140Hz, 각 2번. 고정 경계면 FLOOR·FLOOR·MID, 상대 방식이면 FLOOR·MID·SMALL
    times = [0.2, 0.5, 0.8, 1.1, 1.4, 1.7]
    toms = _toms_track(
        [(0.2, 70, 1), (0.5, 70, 1), (0.8, 100, 1), (1.1, 100, 1), (1.4, 140, 1), (1.7, 140, 1)]
    )
    fixed = assign_toms(times, toms, SR, {})
    assert fixed.pads == ["FLOOR_TOM"] * 4 + ["MID_TOM"] * 2
    assert fixed.n_clusters == 0 and fixed.n_dropped == 0 and fixed.gate_ratio is None
    rel = assign_toms(times, toms, SR, {"tom_mode": "relative"})
    assert rel.pads == ["FLOOR_TOM", "FLOOR_TOM", "MID_TOM", "MID_TOM", "SMALL_TOM", "SMALL_TOM"]
    assert rel.n_clusters == 3 and rel.labels.tolist() == [0, 0, 1, 1, 2, 2]
    assert [round(m) for m in rel.cluster_medians] == pytest.approx([70, 100, 140], abs=6)
    assert rel.cluster_names == ["FLOOR_TOM", "MID_TOM", "SMALL_TOM"]
    # 탐이 둘뿐이고 둘 다 높으면(150·200): bands는 MID·SMALL, order는 FLOOR·MID
    two = _toms_track([(0.2, 150, 1), (0.5, 150, 1), (0.8, 200, 1), (1.1, 200, 1)])
    bands = assign_toms(times[:4], two, SR, {"tom_mode": "relative"})
    assert bands.pads == ["MID_TOM", "MID_TOM", "SMALL_TOM", "SMALL_TOM"]
    order = assign_toms(
        times[:4], two, SR, {"tom_mode": "relative", "tom_relative_naming": "order"}
    )
    assert order.pads == ["FLOOR_TOM", "FLOOR_TOM", "MID_TOM", "MID_TOM"]
    # assign_pads도 같은 결과. 모르는 방식 이름은 오류
    hits = assign_pads({47: times}, {"toms": toms}, SR, {"tom_mode": "relative"})
    assert [p for _, p, _ in hits] == rel.pads
    with pytest.raises(ValueError, match="tom_mode"):
        assign_pads({47: times}, {"toms": toms}, SR, {"tom_mode": "kmeans"})


def test_거르기는_toms_에너지가_약한_탐을_버린다():
    from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import (
        assign_toms,
        tom_gate_ratios,
    )

    # 0.2초는 진짜 탐(toms 트랙에 소리), 0.6초는 toms가 거의 없고 입력에만 큰 소리(스네어를 탐으로 잡은 경우)
    toms = _toms_track([(0.2, 100, 1), (0.6, 100, 0.05)])
    mixture = _toms_track([(0.2, 300, 1), (0.6, 300, 1)])
    ratios = tom_gate_ratios([0.2, 0.6], toms, mixture, SR, 80)
    assert ratios[0] == pytest.approx(1.0, abs=0.05) and ratios[1] < 0.01
    gated = assign_toms([0.2, 0.6], toms, SR, {"tom_gate_ratio": 0.1}, mixture)
    assert gated.kept.tolist() == [True, False] and gated.pads == ["FLOOR_TOM", None]
    assert gated.n_dropped == 1 and gated.gate_ratio is not None
    hits = assign_pads(
        {47: [0.2, 0.6], 35: [0.1]}, {"toms": toms}, SR, {"tom_gate_ratio": 0.1}, mixture
    )
    assert [(round(t, 1), p) for t, p, _ in hits] == [(0.1, "KICK"), (0.2, "FLOOR_TOM")]
    # 거르기를 안 켜면 둘 다 남고, 켰는데 입력이 없으면 오류
    assert assign_toms([0.2, 0.6], toms, SR, {}, mixture).kept.tolist() == [True, True]
    with pytest.raises(ValueError, match="mixture"):
        assign_toms([0.2, 0.6], toms, SR, {"tom_gate_ratio": 0.1})
    # 입력이 무음이면 비율 0이라 버림
    silent = np.zeros_like(mixture)
    assert tom_gate_ratios([0.2], toms, silent, SR, 80).tolist() == [0.0]
    # 거른 탐을 스네어로 돌리기: 50ms 안에 ADTOF 스네어 타격이 없을 때만
    snare_rules = {"tom_gate_ratio": 0.1, "tom_gate_action": "snare"}
    turned = assign_toms([0.2, 0.6], toms, SR, snare_rules, mixture)
    assert turned.pads == ["FLOOR_TOM", "SNARE"] and turned.kept.tolist() == [True, False]
    assert turned.n_dropped == 0 and turned.n_relabeled == 1
    already = assign_toms([0.2, 0.6], toms, SR, snare_rules, mixture, snare_times=[0.62])
    assert (
        already.pads == ["FLOOR_TOM", None] and already.n_dropped == 1 and already.n_relabeled == 0
    )
    hits = assign_pads({47: [0.2, 0.6], 38: [0.9]}, {"toms": toms}, SR, snare_rules, mixture)
    assert [(round(t, 1), p) for t, p, _ in hits] == [
        (0.2, "FLOOR_TOM"),
        (0.6, "SNARE"),
        (0.9, "SNARE"),
    ]
    with pytest.raises(ValueError, match="tom_gate_action"):
        rules_with_defaults({"tom_gate_action": "hihat"})


def test_심벌_구간은_cymbal_window_ms로_따로_둔다():
    # 라이드 소리가 타격 50ms 뒤에 시작: 구간 80ms면 잡히고 40ms면 둘 다 무음이라 CRASH
    crash = np.zeros((2, SR), np.float32)
    ride = np.zeros((2, SR), np.float32)
    ride[:, int(0.25 * SR) : int(0.25 * SR) + int(0.1 * SR)] = _sine(400.0)
    stems = {"toms": np.zeros((2, SR), np.float32), "crash": crash, "ride": ride}
    peaks = {49: [0.2]}
    assert assign_pads(peaks, stems, SR, {"window_ms": 80})[0][1] == "RIDE"
    assert assign_pads(peaks, stems, SR, {"window_ms": 80, "cymbal_window_ms": 40})[0][1] == "CRASH"
    assert assign_pads(peaks, stems, SR, {"window_ms": 40, "cymbal_window_ms": 80})[0][1] == "RIDE"
    assert rules_with_defaults(None)["cymbal_window_ms"] is None  # 없으면 window_ms와 같음


def test_저장소의_실제_모델_yaml이_전부_읽힌다():
    names = []
    for path in sorted(CONFIGS_DIR.rglob("*.yaml")):
        cfg = TranscriberConfig.from_yaml(path)
        names.append(cfg.name)
        if cfg.adapter == "external":
            assert cfg.python_exe and cfg.script
            assert (ROOT / cfg.script).is_file(), cfg.script
    assert {"adtof", "adtof_drumsep", "adt_str_tau08", "idm", "omnizart", "yourmt3"} <= set(names)
    assert "yourmt3_ps" in names
    assert TranscriberConfig.from_yaml(CONFIGS_DIR / "adtof" / "adtof.yaml").eight_pad is False
    assert (
        TranscriberConfig.from_yaml(CONFIGS_DIR / "external" / "adt_str_tau08.yaml").eight_pad
        is True
    )
    assert (
        TranscriberConfig.from_yaml(CONFIGS_DIR / "external" / "omnizart.yaml").eight_pad is False
    )


def _load_yourmt3_script():
    """별도 환경 스크립트를 모듈로 읽음. YourMT3+ 코드는 load() 안에서만 import하므로 여기선 없어도 됨."""
    path = ROOT / "scripts" / "transcribers_ext" / "yourmt3_transcribe.py"
    spec = importlib.util.spec_from_file_location("yourmt3_transcribe", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_YourMT3_대응표는_0부터_127까지_전부이고_GMD_정답과_같다():
    # 드럼 토큰 범위 전부가 키라 표에 없는 피치로 곡이 실패하지 않음 (설계 1-3절·U20)
    for name in ("yourmt3", "yourmt3_ps"):
        cfg = TranscriberConfig.from_yaml(CONFIGS_DIR / "external" / f"{name}.yaml")
        assert cfg.eight_pad is True
        assert set(cfg.labels) == set(range(128))
        for pitch, pad in GMD_PITCH_PAD.items():
            assert cfg.labels[pitch] == pad, (name, pitch)
        assert cfg.labels[41] == "FLOOR_TOM" and cfg.labels[3] == "CRASH"


def test_YourMT3_다악기_노트에서_드럼만_시각순으로_고른다():
    def note(t: float, pitch: int, drum: bool) -> SimpleNamespace:
        return SimpleNamespace(onset=t, offset=t + 0.01, pitch=pitch, is_drum=drum, velocity=1)

    script = _load_yourmt3_script()
    notes = [note(0.5, 38, True), note(0.1, 60, False), note(0.1, 42, True), note(0.1, 36, True)]
    assert script.drum_hits(notes) == [[0.1, 36, None], [0.1, 42, None], [0.5, 38, None]]
    assert script.drum_hits([note(0.2, 40, False)]) == []
    assert set(script.MODELS) == {"YPTF.MoE+Multi (noPS)", "YPTF+Multi (PS)"}


# ---- 탐 타격 시각 고르기·거르기 분모·낮은 탐 되살리기 (S15P31A307-164 재연구) ----


def _activations(peaks: list[tuple[float, float]], seconds: float = 2.0) -> np.ndarray:
    """(시각, 높이) 목록 → ADTOF 모양 (프레임, 5) 점수. 탐 열(2)에 폭 30ms 삼각 피크."""
    n = int(seconds * 100)
    act = np.zeros((n, 5), np.float32)
    for t, h in peaks:
        c = int(round(t * 100))
        for k, w in ((-1, 0.5), (0, 1.0), (1, 0.5)):
            if 0 <= c + k < n:
                act[c + k, 2] = max(act[c + k, 2], h * w)
    return act


def test_피크_고르기는_이동평균을_빼면_더블의_두_번째를_잃는다():
    from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import (
        pick_peaks,
        pick_tom_times,
        tom_scores,
        uses_custom_tom_peaks,
    )

    # 0.5초 큰 타격, 0.55초 작은 두 번째 타격(더블), 1.0초 작은 타격
    act = _activations([(0.5, 0.9), (0.55, 0.45), (1.0, 0.25)])
    tom = act[:, 2]
    madmom = pick_peaks(tom, 0.32)
    raw = pick_peaks(tom, 0.32, pre_avg=0.0, post_avg=0.0)
    assert madmom == [0.5] and raw == [0.5, 0.55]
    # 기준값을 낮추면 1.0초 작은 타격도 잡힘
    assert pick_peaks(tom, 0.2, pre_avg=0.0, post_avg=0.0) == [0.5, 0.55, 1.0]
    assert tom_scores(tom, [0.5, 0.55, 1.0]).tolist() == pytest.approx([0.9, 0.45, 0.25])
    # 규칙으로 같은 결과. 기본 규칙이면 저장소 기준값 0.32·madmom
    assert not uses_custom_tom_peaks({}) and uses_custom_tom_peaks({"tom_peak_mode": "raw"})
    times, scores = pick_tom_times(act, {})
    assert times == [0.5] and scores.tolist() == pytest.approx([0.9])
    times, scores = pick_tom_times(act, {"tom_peak_mode": "raw", "tom_threshold": 0.2})
    assert times == [0.5, 0.55, 1.0]
    with pytest.raises(ValueError, match="tom_peak_mode"):
        rules_with_defaults({"tom_peak_mode": "x"})
    with pytest.raises(ValueError, match="프레임, 5"):
        pick_tom_times(act[:, :3], {})


def test_assign_pads는_활성값이_있으면_규칙대로_탐_시각을_다시_고른다():
    act = _activations([(0.5, 0.9), (0.55, 0.45)])
    toms = _toms_track([(0.5, 100, 1), (0.55, 100, 1)])
    peaks = {47: [0.5], 35: [0.1]}
    # 활성값이 없거나 기본 규칙이면 ADTOF가 낸 시각 그대로
    assert [round(t, 2) for t, _, _ in assign_pads(peaks, {"toms": toms}, SR, {})] == [0.1, 0.5]
    same = assign_pads(peaks, {"toms": toms}, SR, {}, activations=act)
    assert [round(t, 2) for t, _, _ in same] == [0.1, 0.5]
    more = assign_pads(peaks, {"toms": toms}, SR, {"tom_peak_mode": "raw"}, activations=act)
    assert [(round(t, 2), p) for t, p, _ in more] == [
        (0.1, "KICK"),
        (0.5, "FLOOR_TOM"),
        (0.55, "FLOOR_TOM"),
    ]


def test_거르기_분모를_다른_트랙_합으로_바꾸고_낮은_탐을_되살린다():
    from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import (
        assign_toms,
        gate_energies,
    )

    # 0.2초: 80Hz 플로어탐인데 분리 모델이 kick 트랙에 넣음(toms 거의 없음). 0.6초: 스네어를 탐으로 잡음
    toms = _toms_track([(0.2, 80, 0.05), (0.6, 100, 0.02)])
    kick = _toms_track([(0.2, 80, 1)])
    snare = _toms_track([(0.6, 300, 1)])
    mixture = kick + snare + toms
    stems = {"toms": toms, "kick": kick, "snare": snare}
    rules = {"tom_gate_ratio": 0.1}
    ratio, tomkick = gate_energies([0.2, 0.6], stems, mixture, SR, 80, rules)
    assert ratio[0] < 0.01 and ratio[1] < 0.01
    assert tomkick[0] == pytest.approx(1.0, abs=0.15) and tomkick[1] < 0.01
    # 분모를 다른 트랙 합으로: 0.2초는 snare·hh·심벌이 없어 분모 0 → 비율 0 (그대로 버림)
    ratio2, _ = gate_energies([0.2, 0.6], stems, None, SR, 80, {**rules, "tom_gate_mode": "others"})
    assert ratio2.tolist() == [0.0, pytest.approx(0.0004, abs=0.001)]
    with pytest.raises(ValueError, match="others"):
        gate_energies([0.2], {"toms": toms}, None, SR, 80, {**rules, "tom_gate_mode": "others"})
    # 되살리기: 탐+킥 비율이 높고 점수가 0.5 이상이며 음높이 60~130Hz인 0.2초만 돌아옴
    plain = assign_toms([0.2, 0.6], toms, SR, rules, mixture, stems=stems, scores=[0.8, 0.9])
    assert plain.kept.tolist() == [False, False] and plain.n_rescued == 0
    rescue = {**rules, "tom_gate_low_rescue": 0.5}
    back = assign_toms([0.2, 0.6], toms, SR, rescue, mixture, stems=stems, scores=[0.8, 0.9])
    assert back.kept.tolist() == [True, False] and back.rescued.tolist() == [True, False]
    assert back.pads == ["FLOOR_TOM", None] and back.n_rescued == 1
    # 점수가 낮으면 안 돌아옴. 점수를 안 주면 점수 조건은 통과로 봄
    low = assign_toms([0.2, 0.6], toms, SR, rescue, mixture, stems=stems, scores=[0.3, 0.9])
    assert low.kept.tolist() == [False, False]
    noscore = assign_toms([0.2, 0.6], toms, SR, rescue, mixture, stems=stems)
    assert noscore.kept.tolist() == [True, False]
    # 음높이 범위 밖이면 안 돌아옴
    narrow = {**rescue, "tom_low_hz": [90, 130]}
    assert assign_toms([0.2, 0.6], toms, SR, narrow, mixture, stems=stems).kept.tolist() == [
        False,
        False,
    ]
    with pytest.raises(ValueError, match="tom_gate_mode"):
        rules_with_defaults({"tom_gate_mode": "x"})


def test_hybrid_이름은_묶음_수와_절대_음높이를_같이_본다():
    from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import assign_toms, name_clusters

    h = "hybrid"
    # 1묶음: 120 아래 플로어, 200 위 스몰, 사이 미드
    assert name_clusters([95], h) == ["FLOOR_TOM"]
    assert name_clusters([165], h) == ["MID_TOM"]
    assert name_clusters([230], h) == ["SMALL_TOM"]
    # 2묶음: 재즈 킷처럼 90·170이면 플로어·미드, 둘 다 높으면(165·180) 미드·스몰, 양 끝이면 플로어·스몰
    assert name_clusters([90, 170], h) == ["FLOOR_TOM", "MID_TOM"]
    assert name_clusters([165, 180], h) == ["MID_TOM", "SMALL_TOM"]
    assert name_clusters([90, 230], h) == ["FLOOR_TOM", "SMALL_TOM"]
    # 기준값을 바꾸면 따라감. 3묶음은 순서
    assert name_clusters([90, 170], h, floor_max_hz=80) == ["MID_TOM", "SMALL_TOM"]
    assert name_clusters([70, 100, 140], h) == ["FLOOR_TOM", "MID_TOM", "SMALL_TOM"]
    # 규칙으로: 탐이 둘뿐인 킷(90·170Hz)을 고정 경계는 FLOOR·SMALL, hybrid는 FLOOR·MID
    times = [0.2, 0.5, 0.8, 1.1]
    toms = _toms_track([(0.2, 90, 1), (0.5, 90, 1), (0.8, 170, 1), (1.1, 170, 1)])
    assert assign_toms(times, toms, SR, {}).pads == ["FLOOR_TOM"] * 2 + ["SMALL_TOM"] * 2
    rel = assign_toms(times, toms, SR, {"tom_mode": "relative", "tom_relative_naming": h})
    assert rel.pads == ["FLOOR_TOM"] * 2 + ["MID_TOM"] * 2 and rel.n_clusters == 2


def test_median_음높이는_앞부분_킥_겹침에_흔들리지_않는다():
    from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import (
        estimate_f0_median,
        tom_f0_at,
    )

    # 120ms 구간. 앞 30ms는 60Hz 큰 소리(킥 겹침), 전체는 150Hz 탐 울림
    sr = SR
    n = int(0.12 * sr)
    t = np.arange(n) / sr
    seg = (0.3 * np.sin(2 * np.pi * 150 * t)).astype(np.float32)
    seg[: int(0.03 * sr)] += (8.0 * np.sin(2 * np.pi * 60 * t[: int(0.03 * sr)])).astype(np.float32)
    assert abs(estimate_f0(seg, sr, 50, 400) - 60) < 8  # 피크 하나는 킥을 잡음
    assert abs(estimate_f0_median(seg, sr, 50, 400, 40, 20) - 150) < 8
    # 규칙으로. 구간이 너무 짧아 프레임이 없으면 구간 전체로 잼
    toms = np.stack([np.zeros(int(0.5 * sr), np.float32)] * 2)
    toms[:, int(0.2 * sr) : int(0.2 * sr) + n] = seg
    assert abs(tom_f0_at(toms, sr, 0.2, {"window_ms": 120}) - 60) < 8
    assert abs(tom_f0_at(toms, sr, 0.2, {"window_ms": 120, "tom_f0_method": "median"}) - 150) < 8
    assert abs(tom_f0_at(toms, sr, 0.2, {"window_ms": 120, "tom_f0_start_ms": 40}) - 150) < 8
    assert abs(estimate_f0_median(seg[: int(0.02 * sr)], sr, 50, 400, 40, 20) - 60) < 30
    assert tom_f0_at(None, sr, 0.2, {}) != tom_f0_at(None, sr, 0.2, {})  # nan
    with pytest.raises(ValueError, match="tom_f0_method"):
        rules_with_defaults({"tom_f0_method": "x"})


def test_히스토그램_피크_묶기는_타격이_많아_틈이_없어도_탐_셋을_가른다():
    from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import (
        assign_toms,
        cluster_pitches,
        cluster_pitches_peaks,
    )

    rng = np.random.default_rng(0)
    # 94·127·159Hz 탐 세 개를 각 200번, 음높이가 표준편차 0.6반음으로 흔들려 이웃 사이 틈이 없음
    f0 = np.concatenate([c * 2 ** (rng.normal(0, 0.6, 200) / 12) for c in (94.0, 127.0, 159.0)])
    truth = np.repeat([0, 1, 2], 200)
    gap = cluster_pitches(f0, 3, 2.0, 2)
    assert gap.max() == 0  # 틈 방식은 한 묶음으로 뭉침
    pk = cluster_pitches_peaks(f0, 3, 2.0, 2)
    assert pk.max() == 2 and np.mean(pk == truth) > 0.9
    # nan은 -1, 피크 사이 최소 거리를 크게 잡으면 묶음이 줄어듦
    assert cluster_pitches_peaks([float("nan"), 100.0], 3, 2.0, 1).tolist() == [-1, 0]
    assert cluster_pitches_peaks(f0, 3, 8.0, 2).max() < 2
    # 작은 묶음은 비율(tom_relative_min_frac)로 이웃에 합쳐짐: 100Hz 20번 + 106Hz 2번 → 한 묶음
    times = [0.1 * i for i in range(1, 23)]
    bursts = [(t, 100.0, 1.0) for t in times[:20]] + [(t, 160.0, 1.0) for t in times[20:]]
    toms = _toms_track(bursts, seconds=2.5)
    base = {"tom_mode": "relative", "tom_relative_naming": "hybrid", "tom_relative_method": "peaks"}
    two = assign_toms(times, toms, SR, base)
    assert two.n_clusters == 2
    one = assign_toms(times, toms, SR, {**base, "tom_relative_min_frac": 0.15})
    assert one.n_clusters == 1 and set(one.pads) == {"FLOOR_TOM"}
    with pytest.raises(ValueError, match="tom_relative_method"):
        rules_with_defaults({"tom_relative_method": "x"})


# ---- drum2midi 원본 비교 ----

# 가짜 drum2midi.py: 받은 인자를 args.json에 적고 -o 경로에 노트 세 개짜리 MIDI를 씀. FAIL 인자면 실패
FAKE_DRUM2MIDI = """
import json, sys
from pathlib import Path
import pretty_midi
args = sys.argv[1:]
Path("args.json").write_text(json.dumps(args))
if "FAIL" in args:
    print("boom", file=sys.stderr)
    sys.exit(3)
out = Path(args[args.index("-o") + 1])
pm = pretty_midi.PrettyMIDI()
kit = pretty_midi.Instrument(program=0, is_drum=True)
for t, p, v in [(0.5, 43, 90), (0.1, 36, 100), (0.3, 50, 70)]:
    kit.notes.append(pretty_midi.Note(velocity=v, pitch=p, start=t, end=t + 0.06))
pm.instruments.append(kit)
pm.write(str(out))
"""


def _load_drum2midi_script():
    path = ROOT / "scripts" / "transcribers_ext" / "drum2midi_transcribe.py"
    spec = importlib.util.spec_from_file_location("drum2midi_transcribe", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_drum2midi_스크립트는_저장소_폴더에서_곡마다_부르고_MIDI를_읽는다(tmp_path: Path):
    script = _load_drum2midi_script()
    repo = tmp_path / "drum2midi"
    with pytest.raises(FileNotFoundError, match="drum2midi"):
        script.load({"repo_dir": str(repo)}, "cpu")
    repo.mkdir()
    (repo / "drum2midi.py").write_text(FAKE_DRUM2MIDI, encoding="utf-8")
    handle, checkpoint, _ = script.load({"repo_dir": str(repo)}, "cpu")
    assert checkpoint.startswith("drum2midi@")
    wav = tmp_path / "song.wav"
    wav.write_bytes(b"")
    hits = script.transcribe(handle, str(wav), "cuda:0", {})
    assert [[round(t, 3), p, v] for t, p, v in hits] == [
        [0.1, 36, 100],
        [0.3, 50, 70],
        [0.5, 43, 90],
    ]
    # 저장소 폴더에서 실행되고, 기본 옵션은 --no-learned, 장치는 cuda로 넘어감
    args = json.loads((repo / "args.json").read_text(encoding="utf-8"))
    assert args[0] == str(wav) and args[args.index("--device") + 1] == "cuda"
    assert args[-1] == "--no-learned"
    script.transcribe(handle, str(wav), "cpu", {"args": []})
    assert "--no-learned" not in json.loads((repo / "args.json").read_text(encoding="utf-8"))
    with pytest.raises(RuntimeError, match="boom"):
        script.transcribe(handle, str(wav), "cpu", {"args": ["FAIL"]})


def test_drum2midi_대응표는_탐_묶음_음번호를_플로어_미드_스몰로():
    for name in ("drum2midi", "drum2midi_learned"):
        cfg = TranscriberConfig.from_yaml(CONFIGS_DIR / "external" / f"{name}.yaml")
        assert cfg.eight_pad is True and cfg.velocity is True
        # 원본 TOM_LADDER: 1묶음 47, 2묶음 43·47, 3묶음 43·47·50
        assert [cfg.labels[p] for p in (43, 47, 50)] == ["FLOOR_TOM", "MID_TOM", "SMALL_TOM"]
        assert cfg.labels[36] == "KICK" and cfg.labels[49] == "CRASH" and cfg.labels[51] == "RIDE"
        assert {cfg.labels[p] for p in (42, 46)} == {"HIHAT"}
        assert cfg.labels[44] == "HIHAT_PEDAL"


def test_킥과_겹친_플로어탐만_지운다():
    from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import assign_pads, assign_toms

    # 0.2·0.5초는 90Hz 플로어탐, 0.8초는 170Hz 하이탐. ADTOF 킥은 0.21·0.81초
    times = [0.2, 0.5, 0.8]
    toms = _toms_track([(0.2, 90, 1), (0.5, 90, 1), (0.8, 170, 1)])
    kicks = [0.21, 0.81]
    off = assign_toms(times, toms, SR, {}, kick_times=kicks)
    assert off.pads == ["FLOOR_TOM", "FLOOR_TOM", "SMALL_TOM"] and off.n_kick_dropped == 0
    rules = {"tom_kick_drop_ms": 30}
    on = assign_toms(times, toms, SR, rules, kick_times=kicks)
    # 킥과 겹친 플로어탐만 버리고, 킥과 겹쳐도 하이탐은 남김
    assert on.pads == [None, "FLOOR_TOM", "SMALL_TOM"]
    assert on.kick_dropped.tolist() == [True, False, False] and on.n_dropped == 1
    # 거리가 기준보다 멀면 안 지움
    assert (
        assign_toms(times, toms, SR, {"tom_kick_drop_ms": 5}, kick_times=kicks).n_kick_dropped == 0
    )
    # 지울 패드를 넓히면 하이탐도 지움
    both = {"tom_kick_drop_ms": 30, "tom_kick_drop_pads": ["FLOOR_TOM", "SMALL_TOM"]}
    assert assign_toms(times, toms, SR, both, kick_times=kicks).pads == [None, "FLOOR_TOM", None]
    # 점수 조건: 확신 점수가 기준 미만인 것만 지움
    scored = {"tom_kick_drop_ms": 30, "tom_kick_drop_max_score": 0.9}
    high = assign_toms(times, toms, SR, scored, kick_times=kicks, scores=[0.95, 0.5, 0.5])
    low = assign_toms(times, toms, SR, scored, kick_times=kicks, scores=[0.85, 0.5, 0.5])
    assert high.n_kick_dropped == 0 and low.n_kick_dropped == 1
    # assign_pads는 ADTOF 35번 시각을 킥으로 넘기고, 킥 타격 자체는 그대로 둠
    hits = assign_pads({47: times, 35: kicks}, {"toms": toms}, SR, rules)
    assert [(round(t, 2), p) for t, p, _ in hits] == [
        (0.21, "KICK"),
        (0.5, "FLOOR_TOM"),
        (0.8, "SMALL_TOM"),
        (0.81, "KICK"),
    ]


def test_킥_울림_빼기는_킥_음높이_근처_피크_대신_다음_피크를_쓴다():
    from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import assign_toms, song_kick_hz

    # 100Hz 킥 울림(진폭 1)에 200Hz 탐(진폭 0.5)이 섞인 구간
    seg = (_sine(100) + 0.5 * _sine(200))[0]
    assert abs(estimate_f0(seg, SR, 50, 400) - 100) < 6
    assert abs(estimate_f0(seg, SR, 50, 400, 100.0, 3.0, 0.2) - 200) < 6
    # 다음 피크가 기준 비율보다 작으면 원래 피크 그대로
    assert abs(estimate_f0(seg, SR, 50, 400, 100.0, 3.0, 0.8) - 100) < 6
    # 최대 피크가 킥 음높이에서 멀면 그대로
    assert abs(estimate_f0(_sine(150)[0], SR, 50, 400, 100.0, 3.0, 0.2) - 150) < 6

    # 곡: 킥은 100Hz(0.1·0.4·1.0초), 탐은 150Hz 플로어탐과 200Hz 미드탐. 미드탐 두 번에 킥 울림이 더 크게 섞임
    kick = _toms_track([(0.1, 100, 1), (0.4, 100, 1), (1.0, 100, 1)])
    toms = _toms_track([(0.2, 150, 1), (0.5, 150, 1), (0.7, 200, 1), (1.3, 200, 1)])
    for t in (0.7, 1.3):
        s = int(t * SR)
        toms[:, s : s + int(0.1 * SR)] += _sine(100) * 2
    times = [0.2, 0.5, 0.7, 1.3]
    kicks = [0.1, 0.4, 1.0]
    stems = {"kick": kick, "toms": toms}
    assert abs(song_kick_hz(kicks, stems, None, SR, {}) - 100) < 6
    assert np.isnan(song_kick_hz([], stems, None, SR, {}))
    rel = {
        "tom_mode": "relative",
        "tom_relative_naming": "hybrid",
        "tom_hybrid_floor_max_hz": 160.0,
    }
    off = assign_toms(times, toms, SR, rel, stems=stems, kick_times=kicks)
    # 끄면 미드탐이 100Hz로 재져 플로어탐보다 낮은 묶음이 됨
    assert off.pads == ["MID_TOM", "MID_TOM", "FLOOR_TOM", "FLOOR_TOM"] and np.isnan(off.kick_hz)
    on = assign_toms(
        times, toms, SR, {**rel, "tom_kick_exclude_st": 3.0}, stems=stems, kick_times=kicks
    )
    assert on.pads == ["FLOOR_TOM", "FLOOR_TOM", "MID_TOM", "MID_TOM"]
    assert abs(on.kick_hz - 100) < 6
    # 킥 시각이 없으면 킥 음높이를 못 재서 끈 것과 같음
    none = assign_toms(times, toms, SR, {**rel, "tom_kick_exclude_st": 3.0}, stems=stems)
    assert none.pads == off.pads
    # 모든 타격에서 빼도(tom_kick_cluster_st None) 이 곡은 같음
    every = {**rel, "tom_kick_exclude_st": 3.0, "tom_kick_cluster_st": None}
    assert assign_toms(times, toms, SR, every, stems=stems, kick_times=kicks).pads == on.pads
    # 킥 음높이(113Hz)에 앉은 묶음이 없으면 묶음 단위는 음높이를 안 바꿈. 모든 타격에서 빼면 97·129Hz 탐 음높이가 바뀜
    kick2 = _toms_track([(0.1, 113, 1), (0.4, 113, 1), (1.0, 113, 1)])
    toms2 = _toms_track([(0.2, 97, 1), (0.5, 97, 1), (0.7, 129, 1), (1.3, 129, 1)])
    for t, f in ((0.2, 154), (0.5, 154), (0.7, 205), (1.3, 205)):
        s = int(t * SR)
        toms2[:, s : s + int(0.1 * SR)] += _sine(f) * 0.5
    stems2 = {"kick": kick2, "toms": toms2}
    base2 = assign_toms(times, toms2, SR, rel, stems=stems2, kick_times=kicks)
    kx2 = {**rel, "tom_kick_exclude_st": 3.0}
    same = assign_toms(times, toms2, SR, kx2, stems=stems2, kick_times=kicks)
    assert np.allclose(same.f0, base2.f0) and abs(same.kick_hz - 113) < 6
    every2 = {**kx2, "tom_kick_cluster_st": None}
    moved = assign_toms(times, toms2, SR, every2, stems=stems2, kick_times=kicks)
    assert np.max(np.abs(moved.f0 - base2.f0)) > 3
    with pytest.raises(ValueError, match="tom_kick_pitch_source"):
        rules_with_defaults({"tom_kick_pitch_source": "toms"})
