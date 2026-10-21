"""external 어댑터(가짜 스크립트)와 ADTOF+드럼 킷 분리 규칙 테스트 (채보 설계 3-10절, U8, 인수 조건 13)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

from helpers import SR, make_synth_song, make_tone
from ssaplash_ai.bench.datasets import DatasetConfig, SynthDataset
from ssaplash_ai.bench.metrics import score_hits
from ssaplash_ai.bench.runner.transcription_runner import TranscriptionRunOptions, run_transcription
from ssaplash_ai.bench.transcribers import (
    BatchItem,
    TranscriberConfig,
    create_transcriber,
    write_truth_csv,
)
from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import (
    assign_pads,
    cymbal_pad,
    estimate_f0,
    rules_with_defaults,
    tom_pad,
)

ROOT = Path(__file__).resolve().parents[2]
CONFIGS_DIR = ROOT / "configs" / "bench" / "transcribers"
IDENTITY = {
    p: p for p in ("KICK", "SNARE", "HIHAT", "HI_TOM", "MID_TOM", "FLOOR_TOM", "CRASH", "RIDE")
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
    with pytest.raises(FileNotFoundError, match="별도 환경 python"):
        tr.load()


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
    for freq, pad in ((80.0, "FLOOR_TOM"), (140.0, "MID_TOM"), (220.0, "HI_TOM")):
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
        (0.6, "HI_TOM"),
        (0.8, "CRASH"),
    ]
    assert seconds == 1.0


def test_저장소의_실제_모델_yaml이_전부_읽힌다():
    names = []
    for path in sorted(CONFIGS_DIR.rglob("*.yaml")):
        cfg = TranscriberConfig.from_yaml(path)
        names.append(cfg.name)
        if cfg.adapter == "external":
            assert cfg.python_exe and cfg.script
    assert {"adtof", "adtof_drumsep", "adt_str_tau08", "idm", "omnizart"} <= set(names)
    assert TranscriberConfig.from_yaml(CONFIGS_DIR / "adtof" / "adtof.yaml").eight_pad is False
    assert (
        TranscriberConfig.from_yaml(CONFIGS_DIR / "external" / "adt_str_tau08.yaml").eight_pad
        is True
    )
    assert (
        TranscriberConfig.from_yaml(CONFIGS_DIR / "external" / "omnizart.yaml").eight_pad is False
    )
