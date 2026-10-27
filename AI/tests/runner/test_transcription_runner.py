"""채보 러너·CLI·보고서 테스트 (채보 설계 인수 조건 7·10·11). mock 어댑터·테스트용 합성곡만."""

from __future__ import annotations

import csv
import math
from pathlib import Path

import pytest

from helpers import make_synth_song
from ssaplash_ai.bench.cli import main
from ssaplash_ai.bench.datasets import DatasetConfig, SynthDataset
from ssaplash_ai.bench.runner.transcription_runner import (
    CSV_COLUMNS,
    HITS_BY_CLASS_COLUMNS,
    METRIC_COLUMNS,
    TranscriptionRunOptions,
    run_transcription,
)
from ssaplash_ai.bench.transcribers import write_truth_csv

ROOT = Path(__file__).resolve().parents[2]
MOCK_DIR = ROOT / "configs" / "bench" / "transcribers" / "mock"
SEP_MOCK_DIR = ROOT / "configs" / "bench" / "models" / "mock"
IDENTITY = {
    p: p for p in ("KICK", "SNARE", "HIHAT", "HI_TOM", "MID_TOM", "FLOOR_TOM", "CRASH", "RIDE")
}

# 곡마다 다른 타격: 탐·심벌이 들어가야 8패드·5가지 차이가 보임
SONG_A = (
    [0.1, 0.5, 0.9, 1.3],
    [(36, "kick", 100), (38, "snare", 90), (48, "tom_high", 80), (49, "crash", 110)],
)
SONG_B = (
    [0.2, 0.6, 1.0, 1.4, 1.7],
    [
        (36, "kick", 100),
        (42, "hihat_closed", 70),
        (45, "tom_mid", 80),
        (51, "ride", 60),
        (56, "other", 50),
    ],
)


def _read_csv(path: Path) -> list[dict]:
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def _write_model_yaml(path: Path, name: str, labels: dict | None = None, **extra) -> Path:
    lines = [f"name: {name}", "adapter: mock", "license_code: x", "license_weights: y"]
    lines += [f"{k}: {v}" for k, v in extra.items()]
    lines.append("labels:")
    lines += [f"  {k}: {v}" for k, v in (labels or IDENTITY).items()]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


@pytest.fixture
def synth(tmp_path: Path) -> dict:
    """합성곡 2곡 + 데이터셋 yaml + mock truth 폴더 + mock 모델 yaml 3개."""
    root = tmp_path / "synth"
    make_synth_song(root / "song_a", 2.0, *SONG_A)
    make_synth_song(root / "song_b", 2.0, *SONG_B)
    ds_yaml = tmp_path / "ds.yaml"
    ds_yaml.write_text(
        f"name: fake_synth\nkind: synth\nroot: {root.as_posix()}\nexpected_songs: 2\n",
        encoding="utf-8",
    )
    ds = SynthDataset(DatasetConfig.from_yaml(ds_yaml))
    truth = tmp_path / "truth"
    for song_id in ds.song_ids():
        write_truth_csv(truth / f"{song_id}.csv", ds.load(song_id).hits_true)
    models = {
        "truth": _write_model_yaml(
            tmp_path / "truth.yaml",
            "mock_truth",
            mock_mode="truth",
            truth_dir=truth.as_posix(),
            velocity="true",
        ),
        "shift": _write_model_yaml(
            tmp_path / "shift.yaml",
            "mock_shift30",
            mock_mode="truth",
            truth_dir=truth.as_posix(),
            shift_ms=30,
        ),
        "coarse": _write_model_yaml(
            tmp_path / "coarse.yaml",
            "mock_coarse",
            labels={
                **IDENTITY,
                "HI_TOM": "tom",
                "MID_TOM": "tom",
                "FLOOR_TOM": "tom",
                "CRASH": "cymbal",
                "RIDE": "cymbal",
            },
            mock_mode="truth",
            truth_dir=truth.as_posix(),
        ),
        "empty": MOCK_DIR / "mock_empty.yaml",
    }
    return {"ds": ds_yaml, "truth": truth, "models": models, "root": root}


def _run(synth: dict, out: Path, models: list[Path], **kw):
    return run_transcription(
        TranscriptionRunOptions(
            model_configs=models, dataset_config=synth["ds"], out_dir=out, device="cpu", **kw
        ),
        log=lambda _: None,
    )


def test_mock_어댑터로_결과_CSV와_라벨별_CSV가_찬다(synth: dict, tmp_path: Path):
    m = synth["models"]
    result = _run(synth, tmp_path / "out", [m["truth"], m["shift"], m["coarse"], m["empty"]])
    assert result.n_songs == 2 and result.n_errors == 0 and result.input == "drums"
    rows = _read_csv(result.csv_path)
    assert len(rows) == 8 and list(rows[0].keys()) == list(CSV_COLUMNS)
    by_model = {}
    for r in rows:
        assert r["error"] == "" and r["input"] == "drums" and r["separator"] == ""
        assert r["runId"] == result.run_id and r["device"] == "cpu" and r["configHash"]
        by_model.setdefault(r["model"], []).append(r)
    # 정답 그대로: 전부 1.0, 세기 상관은 쌍이 10개 미만이라 nan
    for r in by_model["mock_truth"]:
        assert r["eightPad"] == "True" and r["hasVelocity"] == "True"
        assert (
            float(r["f1Five50"]) == 1.0
            and float(r["f1Pads50"]) == 1.0
            and float(r["f1Any50"]) == 1.0
        )
        assert float(r["perfectRatio"]) == 1.0 and float(r["meanAbsErrMs"]) == 0.0
        assert int(r["fnPads50"]) == 0 and int(r["hitsPredDropped"]) == 0
        assert float(r["rtf"]) > 0 and float(r["loadSec"]) >= 0 and r["separateSec"] == "nan"
        assert r["vramMethod"] == "" and math.isnan(float(r["peakVramMb"]))
    # 30ms 밀림: 50ms는 1.0, 25ms는 0, Perfect 적중률 0
    for r in by_model["mock_shift30"]:
        assert float(r["f1Pads50"]) == 1.0 and float(r["f1Pads25"]) == 0.0
        assert float(r["perfectRatio"]) == 0.0 and abs(float(r["meanErrMs"]) - 30) < 1e-6
    # 거친 라벨: 8패드 열은 nan, 5가지는 1.0
    for r in by_model["mock_coarse"]:
        assert r["eightPad"] == "False"
        assert float(r["f1Five50"]) == 1.0 and r["f1Pads50"] == "nan" and r["tpPads50"] == "nan"
    # 빈 예측: F1 0, fn = 정답 수
    for r in by_model["mock_empty"]:
        assert float(r["f1Five50"]) == 0.0 and int(r["fnFive50"]) == int(r["hitsTrue"])
        assert r["perfectRatio"] == "nan"
    for r in rows:
        for col in METRIC_COLUMNS:
            assert r[col] != "", col

    hits = _read_csv(result.hits_csv_path)
    assert list(hits[0].keys()) == list(HITS_BY_CLASS_COLUMNS)
    schemes = {(h["model"], h["scheme"]) for h in hits}
    assert ("mock_truth", "pads") in schemes and ("mock_truth", "five") in schemes
    assert ("mock_coarse", "pads") not in schemes and ("mock_coarse", "five") in schemes
    truth_a_pads = [
        h
        for h in hits
        if h["model"] == "mock_truth"
        and h["songId"] == "song_a"
        and h["scheme"] == "pads"
        and h["windowMs"] == "50"
    ]
    assert {h["label"] for h in truth_a_pads} == {"KICK", "SNARE", "HI_TOM", "CRASH"}
    assert all(h["tp"] == "1" and h["fp"] == "0" and h["fn"] == "0" for h in truth_a_pads)


def test_곡_하나가_실패해도_error_행이_남고_계속_돈다(synth: dict, tmp_path: Path):
    m = _write_model_yaml(
        tmp_path / "flaky.yaml",
        "flaky",
        mock_mode="truth",
        truth_dir=synth["truth"].as_posix(),
        fail_on_call=2,
    )
    result = _run(synth, tmp_path / "out", [m])  # 워밍업이 1번째 호출, 첫 곡 본 측정이 2번째
    rows = _read_csv(result.csv_path)
    assert len(rows) == 2 and result.n_errors == 1
    assert rows[0]["error"].startswith("RuntimeError: 모의 실패") and rows[0]["f1Five50"] == "nan"
    assert rows[1]["error"] == "" and float(rows[1]["f1Five50"]) == 1.0


def test_로드_예외는_곡마다_error_행으로(synth: dict, tmp_path: Path, monkeypatch):
    from ssaplash_ai.bench.transcribers import mock_transcriber

    def boom(self):
        raise RuntimeError("가중치 없음")

    monkeypatch.setattr(mock_transcriber.MockTranscriber, "_load", boom)
    result = _run(synth, tmp_path / "out", [synth["models"]["truth"]])
    rows = _read_csv(result.csv_path)
    assert len(rows) == 2 and all(r["error"] == "RuntimeError: 가중치 없음" for r in rows)


def test_타격_정답이_없는_데이터셋은_시작_전에_막는다(tmp_path: Path, musdb_root: Path):
    ds = tmp_path / "musdb.yaml"
    ds.write_text(
        f"name: m\nkind: musdb\nroot: {musdb_root.as_posix()}\nsubset: test\n", encoding="utf-8"
    )
    with pytest.raises(ValueError, match="타격 정답이 없는"):
        run_transcription(
            TranscriptionRunOptions(
                model_configs=[MOCK_DIR / "mock_empty.yaml"],
                dataset_config=ds,
                out_dir=tmp_path / "o",
                device="cpu",
            ),
            log=lambda _: None,
        )


def test_입력_3가지와_분리_캐시(synth: dict, tmp_path: Path):
    m = [synth["models"]["truth"]]
    out = tmp_path / "out"
    r_drums = _run(synth, out, m, input="drums", run_id="d")
    r_mix = _run(synth, out, m, input="mixture", run_id="m")
    sep_yaml = SEP_MOCK_DIR / "mock_half.yaml"
    r_sep = _run(synth, out, m, input="separated", separator_config=sep_yaml, run_id="s")
    assert r_sep.separator == "mock_half"
    rows = _read_csv(r_sep.csv_path)
    assert all(r["input"] == "separated" and r["separator"] == "mock_half" for r in rows)
    # 첫 곡은 워밍업 때 분리돼 캐시됐으므로 본 측정에서는 nan, 둘째 곡은 본 측정에서 분리
    by_song = {r["songId"]: r["separateSec"] for r in rows}
    assert by_song["song_a"] == "nan" and float(by_song["song_b"]) > 0
    cache = r_sep.run_dir / "separated" / "mock_half"
    assert (cache / "song_a" / "drums.wav").is_file() and (cache / "song_b" / "drums.wav").is_file()
    # 다시 돌리면 캐시를 읽어 분리를 건너뜀 (separateSec nan). 다른 runId라도 --separated-dir로 재사용
    r_again = _run(synth, out, m, input="separated", separated_dir=cache, run_id="s2")
    assert r_again.separator == "mock_half"
    assert all(r["separateSec"] == "nan" and r["error"] == "" for r in _read_csv(r_again.csv_path))
    # 분리 없이 separated만 주면 오류
    with pytest.raises(ValueError, match="--separator"):
        _run(synth, out, m, input="separated", run_id="bad")
    # 보고서: 세 run을 합치면 drums 대비 변화 열이 나온다
    from ssaplash_ai.bench.report import transcription_summary as ts

    df = ts.load_results([r_drums.csv_path, r_mix.csv_path, r_sep.csv_path])
    summary = ts.summarize(df)
    assert len(summary) == 3
    by_input = {r["input"]: r for _, r in summary.iterrows()}
    assert math.isnan(by_input["drums"]["deltaF1VsDrums"])
    assert by_input["mixture"]["deltaF1VsDrums"] == pytest.approx(0.0)  # mock은 입력과 무관
    assert by_input["separated"]["deltaF1VsDrums"] == pytest.approx(0.0)
    assert by_input["separated"]["inputLabel"] == "separated(mock_half)"


def test_이어하기는_input과_separator를_키에_넣는다(synth: dict, tmp_path: Path):
    m = [synth["models"]["truth"]]
    out = tmp_path / "out"
    first = _run(synth, out, m, input="drums", run_id="r")
    assert first.n_skipped == 0 and len(first.rows) == 2
    # 같은 runId·같은 입력: 전부 건너뜀
    again = _run(synth, out, m, input="drums", run_id="r")
    assert again.n_skipped == 2 and len(_read_csv(again.csv_path)) == 2
    assert len(_read_csv(again.hits_csv_path)) == len(_read_csv(first.hits_csv_path))
    # 같은 runId·다른 입력: 건너뛰지 않고 행이 늘어남
    mixed = _run(synth, out, m, input="mixture", run_id="r")
    assert mixed.n_skipped == 2
    rows = _read_csv(mixed.csv_path)
    assert len(rows) == 4 and {r["input"] for r in rows} == {"drums", "mixture"}
    # 실패 행은 다시 돈다
    flaky = _write_model_yaml(
        tmp_path / "flaky.yaml",
        "flaky",
        mock_mode="truth",
        truth_dir=synth["truth"].as_posix(),
        fail_on_call=2,
    )
    bad = _run(synth, out, [flaky], run_id="r2")
    assert bad.n_errors == 1
    # 같은 모델 이름으로 고친 yaml을 다시 돌리면 실패 행만 다시 돈다
    ok = _write_model_yaml(
        tmp_path / "flaky_ok.yaml", "flaky", mock_mode="truth", truth_dir=synth["truth"].as_posix()
    )
    retried = _run(synth, out, [ok], run_id="r2")
    assert retried.n_retried == 1 and retried.n_errors == 0
    rows = [r for r in _read_csv(retried.csv_path) if r["model"] == "flaky"]
    assert len(rows) == 2 and all(r["error"] == "" for r in rows)


def test_save_midi와_clip(synth: dict, tmp_path: Path):
    result = _run(synth, tmp_path / "out", [synth["models"]["truth"]], clip=(0.0, 1.0), save_midi=1)
    rows = _read_csv(result.csv_path)
    assert all(abs(float(r["durationSec"]) - 1.0) < 1e-3 for r in rows)
    assert int(rows[0]["hitsTrue"]) == 3  # song_a 1초 안 타격 3개
    midi = result.run_dir / "midi" / "mock_truth"
    assert sorted(p.name for p in midi.iterdir()) == ["song_a.mid"]


def test_cli_run_transcription은_csv_보고서_mlflow를_만든다(
    synth: dict, tmp_path: Path, monkeypatch
):
    monkeypatch.chdir(tmp_path)
    out = tmp_path / "results"
    mlruns = tmp_path / "mlruns"
    code = main(
        [
            "run-transcription",
            "--models",
            str(synth["models"]["truth"]),
            str(synth["models"]["coarse"]),
            "--dataset",
            str(synth["ds"]),
            "--out",
            str(out),
            "--device",
            "cpu",
            "--run-id",
            "trun",
            "--mlflow-uri",
            str(mlruns),
        ]
    )
    assert code == 0
    run_dir = out / "trun"
    for name in (
        "results.csv",
        "hits_by_class.csv",
        "summary.md",
        "per_song.csv",
        "f1_by_model.png",
        "rtf_vs_f1.png",
    ):
        assert (run_dir / name).is_file(), name
    md = (run_dir / "summary.md").read_text(encoding="utf-8")
    assert "## fake_synth" in md and "| mock_truth | drums |" in md and "패드별 F1" in md

    import mlflow

    mlflow.set_tracking_uri(mlruns.resolve().as_uri())
    exp = mlflow.get_experiment_by_name("transcription-bench")
    assert exp is not None
    runs = mlflow.search_runs(experiment_ids=[exp.experiment_id])
    assert len(runs) == 1
    r = runs.iloc[0]
    assert r["tags.runId"] == "trun" and r["params.input"] == "drums" and r["params.nModels"] == "2"
    assert "metrics.mock_truth/f1Pads50" in runs.columns
    artifacts = {a.path for a in mlflow.artifacts.list_artifacts(run_id=r["run_id"])}
    assert {"results.csv", "hits_by_class.csv", "summary.md", "f1_by_model.png"} <= artifacts

    # report-transcription으로 다시 만들기
    code = main(
        ["report-transcription", str(run_dir / "results.csv"), "--out", str(tmp_path / "rep")]
    )
    assert code == 0 and (tmp_path / "rep" / "summary.md").is_file()


def test_cli_mlflow_none(synth: dict, tmp_path: Path, capsys):
    code = main(
        [
            "run-transcription",
            "--models",
            str(MOCK_DIR / "mock_empty.yaml"),
            "--dataset",
            str(synth["ds"]),
            "--out",
            str(tmp_path / "results"),
            "--device",
            "cpu",
            "--mlflow-uri",
            "none",
        ]
    )
    assert code == 0 and "MLflow 기록 생략" in capsys.readouterr().out
