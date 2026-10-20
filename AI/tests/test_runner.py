"""러너·CLI run·MLflow 기록 테스트 (설계 6장 인수 조건 2·3·6·7·8). 가짜 어댑터 + 가짜 wav만."""

from __future__ import annotations

import csv
import math
from pathlib import Path

import pytest

from helpers import make_musdb_song
from ssaplash_ai.bench.cli import main
from ssaplash_ai.bench.runner import CSV_COLUMNS, METRIC_COLUMNS, RunOptions, run_benchmark

MODELS_DIR = Path(__file__).resolve().parents[1] / "configs" / "bench" / "models"


def _write_dataset_yaml(path: Path, root: Path, clip: str = "null") -> Path:
    path.write_text(
        f"name: fake_musdb\nkind: musdb\nroot: {root.as_posix()}\nsubset: test\n"
        f"expected_songs: 2\nclip: {clip}\n",
        encoding="utf-8",
    )
    return path


def _write_model_yaml(path: Path, name: str, **extra) -> Path:
    lines = [f"name: {name}", "adapter: fake", "license_code: x", "license_weights: y"]
    lines += [f"{k}: {v}" for k, v in extra.items()]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


@pytest.fixture
def small_musdb(tmp_path: Path) -> Path:
    """2초짜리 곡 2개. museval이 1초 프레임을 2개 만들 수 있는 최소 길이."""
    root = tmp_path / "musdb18hq"
    make_musdb_song(root / "test" / "Song A", 2.0)
    make_musdb_song(root / "test" / "Song B", 2.0)
    return root


def _read_csv(path: Path) -> list[dict]:
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def test_가짜_어댑터_3개로_csv_필드가_모두_찬다(small_musdb: Path, tmp_path: Path):
    ds = _write_dataset_yaml(tmp_path / "ds.yaml", small_musdb)
    models = [MODELS_DIR / f"fake_{m}.yaml" for m in ("mixture", "half", "silence")]
    result = run_benchmark(
        RunOptions(model_configs=models, dataset_config=ds, out_dir=tmp_path / "out", device="cpu"),
        log=lambda _: None,
    )
    assert result.n_songs == 2 and result.models == ["fake_mixture", "fake_half", "fake_silence"]
    rows = _read_csv(result.csv_path)
    assert len(rows) == 6 and result.n_errors == 0
    assert list(rows[0].keys()) == list(CSV_COLUMNS)
    for row in rows:
        assert row["error"] == ""
        assert row["runId"] == result.run_id and row["host"] in ("local", "colab")
        assert row["device"] == "cpu" and row["configHash"]
        for col in METRIC_COLUMNS:
            if col == "peakVramMb":
                assert row[col] in ("nan", "") or math.isnan(float(row[col]))  # CPU 실행
                continue
            assert row[col] not in ("", "nan"), col
    half = next(r for r in rows if r["model"] == "fake_half")
    # 원곡 × 0.5 는 배율 불변 지표에서 드럼과의 차이가 반주뿐이라 유한한 값
    assert math.isfinite(float(half["sdrDrums"]))
    assert float(half["rtf"]) > 0 and float(half["loadSec"]) >= 0
    silence = next(r for r in rows if r["model"] == "fake_silence")
    assert float(silence["sdrDrums"]) == -math.inf
    assert float(silence["onsetF1"]) == 0.0


def test_곡_하나가_실패해도_error_행이_남고_계속_돈다(small_musdb: Path, tmp_path: Path):
    ds = _write_dataset_yaml(tmp_path / "ds.yaml", small_musdb)
    # 로드 직후 첫 곡 워밍업이 1번째 separate 호출이므로 2번째가 첫 곡 본 측정
    model = _write_model_yaml(tmp_path / "flaky.yaml", "flaky", fail_on_call=2)
    result = run_benchmark(
        RunOptions(
            model_configs=[model], dataset_config=ds, out_dir=tmp_path / "out", device="cpu"
        ),
        log=lambda _: None,
    )
    rows = _read_csv(result.csv_path)
    assert len(rows) == 2 and result.n_errors == 1
    assert rows[0]["error"].startswith("RuntimeError: 가짜 실패")
    assert rows[0]["sdrDrums"] == "nan"
    assert rows[1]["error"] == "" and rows[1]["sdrDrums"] != "nan"


def test_모델_로드가_실패하면_모든_곡에_같은_error(small_musdb: Path, tmp_path: Path):
    ds = _write_dataset_yaml(tmp_path / "ds.yaml", small_musdb)
    model = _write_model_yaml(tmp_path / "bad.yaml", "bad", fake_mode="nope")
    # fake_mode 검증은 어댑터 생성 시점이라 create_separator에서 바로 실패해야 하는데,
    # 러너는 생성 실패를 곡 단위 error로 바꾸지 않으므로 ValueError가 그대로 올라옴
    with pytest.raises(ValueError, match="fake_mode"):
        run_benchmark(
            RunOptions(
                model_configs=[model], dataset_config=ds, out_dir=tmp_path / "out", device="cpu"
            ),
            log=lambda _: None,
        )


def test_로드_예외는_곡마다_error_행으로_남는다(small_musdb: Path, tmp_path: Path, monkeypatch):
    from ssaplash_ai.bench.separators import fake

    def boom(self):
        raise RuntimeError("가중치 없음")

    monkeypatch.setattr(fake.FakeSeparator, "_load", boom)
    ds = _write_dataset_yaml(tmp_path / "ds.yaml", small_musdb)
    result = run_benchmark(
        RunOptions(
            model_configs=[MODELS_DIR / "fake_mixture.yaml"],
            dataset_config=ds,
            out_dir=tmp_path / "out",
            device="cpu",
        ),
        log=lambda _: None,
    )
    rows = _read_csv(result.csv_path)
    assert len(rows) == 2
    assert all(r["error"] == "RuntimeError: 가중치 없음" for r in rows)


def test_warmup을_끄면_첫_호출이_첫_곡이다(small_musdb: Path, tmp_path: Path):
    ds = _write_dataset_yaml(tmp_path / "ds.yaml", small_musdb)
    model = _write_model_yaml(tmp_path / "flaky.yaml", "flaky", fail_on_call=1)
    result = run_benchmark(
        RunOptions(
            model_configs=[model],
            dataset_config=ds,
            out_dir=tmp_path / "out",
            device="cpu",
            warmup=False,
        ),
        log=lambda _: None,
    )
    rows = _read_csv(result.csv_path)
    assert rows[0]["error"].startswith("RuntimeError") and rows[1]["error"] == ""


def test_save_wav과_clip_옵션(small_musdb: Path, tmp_path: Path):
    ds = _write_dataset_yaml(tmp_path / "ds.yaml", small_musdb)
    result = run_benchmark(
        RunOptions(
            model_configs=[MODELS_DIR / "fake_half.yaml"],
            dataset_config=ds,
            out_dir=tmp_path / "out",
            device="cpu",
            clip=(0.0, 1.0),
            save_wav=1,
        ),
        log=lambda _: None,
    )
    rows = _read_csv(result.csv_path)
    assert all(abs(float(r["durationSec"]) - 1.0) < 1e-3 for r in rows)
    saved = result.run_dir / "separated" / "fake_half"
    assert sorted(p.name for p in saved.iterdir()) == ["Song A"]
    assert (saved / "Song A" / "drums.wav").is_file() and (
        saved / "Song A" / "accomp.wav"
    ).is_file()


def test_cli_run은_csv_보고서_mlflow_run을_만든다(small_musdb: Path, tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    ds = _write_dataset_yaml(tmp_path / "ds.yaml", small_musdb)
    out = tmp_path / "results"
    mlruns = tmp_path / "mlruns"
    code = main(
        [
            "run",
            "--models",
            str(MODELS_DIR / "fake_mixture.yaml"),
            str(MODELS_DIR / "fake_half.yaml"),
            str(MODELS_DIR / "fake_silence.yaml"),
            "--dataset",
            str(ds),
            "--out",
            str(out),
            "--device",
            "cpu",
            "--run-id",
            "testrun",
            "--mlflow-uri",
            str(mlruns),
        ]
    )
    assert code == 0
    run_dir = out / "testrun"
    assert (run_dir / "results.csv").is_file()
    assert (run_dir / "summary.md").is_file() and (run_dir / "per_song.csv").is_file()
    assert (run_dir / "metrics_by_model.png").is_file() and (run_dir / "rtf_vs_sdr.png").is_file()

    import mlflow

    mlflow.set_tracking_uri(mlruns.resolve().as_uri())
    exp = mlflow.get_experiment_by_name("separation-bench")
    assert exp is not None
    runs = mlflow.search_runs(experiment_ids=[exp.experiment_id])
    assert len(runs) == 1
    r = runs.iloc[0]
    assert r["tags.runId"] == "testrun" and r["params.nModels"] == "3"
    assert "metrics.fake_half/sdrDrums" in runs.columns
    artifacts = {a.path for a in mlflow.artifacts.list_artifacts(run_id=r["run_id"])}
    assert {"results.csv", "summary.md", "metrics_by_model.png", "rtf_vs_sdr.png"} <= artifacts


def test_cli_run_mlflow_none이면_기록을_건너뛴다(small_musdb: Path, tmp_path: Path, capsys):
    ds = _write_dataset_yaml(tmp_path / "ds.yaml", small_musdb)
    code = main(
        [
            "run",
            "--models",
            str(MODELS_DIR / "fake_half.yaml"),
            "--dataset",
            str(ds),
            "--out",
            str(tmp_path / "results"),
            "--device",
            "cpu",
            "--mlflow-uri",
            "none",
        ]
    )
    assert code == 0
    assert "MLflow 기록 생략" in capsys.readouterr().out
    assert not (tmp_path / "mlruns").exists()
