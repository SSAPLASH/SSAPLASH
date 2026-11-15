"""결과 폴더 MLflow 재기록 테스트. 파일 저장소 mlruns만 씀."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
from test_benchmark_runner import MODELS_DIR, _write_dataset_yaml, small_musdb  # noqa: F401
from test_transcription_runner import synth  # noqa: F401

from ssaplash_ai.bench.cli import main
from ssaplash_ai.bench.runner.relog import copy_mlruns, detect_kind, relog

mlflow = pytest.importorskip("mlflow")


def _runs(store: Path, experiment: str):
    mlflow.set_tracking_uri(store.resolve().as_uri())
    exp = mlflow.get_experiment_by_name(experiment)
    if exp is None:
        return []
    return mlflow.search_runs(experiment_ids=[exp.experiment_id], output_format="list")


def _digest(folder: Path) -> dict[str, str]:
    return {
        p.relative_to(folder).as_posix(): hashlib.md5(p.read_bytes()).hexdigest()
        for p in sorted(folder.rglob("*"))
        if p.is_file()
    }


def _artifacts(run) -> set[str]:
    return {a.path for a in mlflow.artifacts.list_artifacts(run_id=run.info.run_id)}


@pytest.fixture
def trans_run(synth: dict, tmp_path: Path, monkeypatch) -> tuple[Path, Path]:  # noqa: F811
    """run-transcription을 mlruns_orig에 기록하며 돌린 결과 폴더."""
    monkeypatch.chdir(tmp_path)
    orig = tmp_path / "mlruns_orig"
    code = main(
        ["run-transcription", "--models", str(synth["models"]["truth"]),
         str(synth["models"]["coarse"]), "--dataset", str(synth["ds"]), "--out",
         str(tmp_path / "results"), "--device", "cpu", "--run-id", "trun", "--mlflow-uri", str(orig)]
    )  # fmt: skip
    assert code == 0
    return tmp_path / "results" / "trun", orig


def test_채보_폴더_재기록_지표가_원래_실행과_같고_두번_올려도_하나(trans_run, tmp_path: Path):
    folder, orig = trans_run
    before = _digest(folder)
    store = tmp_path / "mlruns_new"
    out = relog([folder], str(store), log=lambda _: None)
    assert [o.status for o in out] == ["기록"] and detect_kind(folder) == "transcription"
    (a,) = _runs(orig, "transcription-bench")
    (b,) = _runs(store, "transcription-bench")
    assert b.data.metrics == a.data.metrics
    for k in ("models", "input", "nSongs", "nModels", "nErrors", "device"):
        assert b.data.params[k] == a.data.params[k], k
    assert b.data.params["dataset"] == "fake_synth"  # 원래는 yaml 이름(ds), 재기록은 CSV 값
    assert b.data.tags["runId"] == "trun" and b.data.tags["relogged"] == "true"
    assert b.data.tags["config_hash.mock_truth"] == a.data.tags["config_hash.mock_truth"]
    assert {"results.csv", "hits_by_class.csv", "summary.md", "f1_by_model.png"} <= _artifacts(b)

    again = relog([folder], str(store), log=lambda _: None)
    assert [o.status for o in again] == ["건너뜀(중복)"] and len(
        _runs(store, "transcription-bench")
    ) == 1
    relog([folder], str(store), force=True, log=lambda _: None)
    assert len(_runs(store, "transcription-bench")) == 2
    assert _digest(folder) == before  # 결과 폴더 파일은 그대로


def test_CSV를_복사한_폴더는_폴더_이름을_runId로(trans_run, tmp_path: Path):
    folder, _ = trans_run
    copy = folder.parent / "trun-merged"
    copy.mkdir()
    (copy / "results.csv").write_text((folder / "results.csv").read_text("utf-8"), "utf-8")
    store = tmp_path / "mlruns_new"
    out = relog([folder, copy], str(store), log=lambda _: None)
    assert [(o.run_id, o.status) for o in out] == [("trun", "기록"), ("trun-merged", "기록")]
    merged = [
        r for r in _runs(store, "transcription-bench") if r.data.tags["runId"] == "trun-merged"
    ]
    assert merged[0].data.tags["csvRunId"] == "trun"


def test_분리_폴더_재기록_지표가_원래_실행과_같다(
    small_musdb: Path,  # noqa: F811
    tmp_path: Path,
    monkeypatch,
):
    monkeypatch.chdir(tmp_path)
    ds = _write_dataset_yaml(tmp_path / "ds.yaml", small_musdb)
    orig = tmp_path / "mlruns_orig"
    code = main(
        ["run", "--models", str(MODELS_DIR / "mock_mixture.yaml"), str(MODELS_DIR / "mock_half.yaml"),
         "--dataset", str(ds), "--out", str(tmp_path / "results"), "--device", "cpu",
         "--run-id", "srun", "--mlflow-uri", str(orig)]
    )  # fmt: skip
    assert code == 0
    store = tmp_path / "mlruns_new"
    out = relog([tmp_path / "results" / "srun"], str(store), log=lambda _: None)
    assert [o.status for o in out] == ["기록"]
    (a,) = _runs(orig, "separation-bench")
    (b,) = _runs(store, "separation-bench")
    assert b.data.metrics == a.data.metrics and b.data.params["nModels"] == "2"
    assert {"results.csv", "summary.md", "metrics_by_model.png"} <= _artifacts(b)


def test_규칙_채점_폴더는_후보마다_run(tmp_path: Path):
    folder = tmp_path / "rule-eval-x"
    folder.mkdir()
    (folder / "candidates.csv").write_text(
        "candidate,dataset,f1Tom,f1Pads,nSongs\n"
        "pk_gap30,mdb_drums,0.671,0.854,23\npk_gap30,gmd_test,0.901,0.797,45\n"
        "fixed,mdb_drums,0.213,0.841,23\nfixed,gmd_test,0.880,nan,45\n",
        encoding="utf-8",
    )
    (folder / "summary.md").write_text("# 표\n", encoding="utf-8")
    (folder / "candidates.yaml").write_text(
        "candidates:\n- name: pk_gap30\n  rules: {tom_relative_min_gap: 3.0}\n- name: fixed\n  rules: {}\n",
        encoding="utf-8",
    )
    store = tmp_path / "mlruns"
    out = relog([folder], str(store), log=lambda _: None)
    assert sorted(o.run_id for o in out) == ["rule-eval-x/fixed", "rule-eval-x/pk_gap30"]
    runs = {r.data.tags["runId"]: r for r in _runs(store, "chart-rules")}
    pk = runs["rule-eval-x/pk_gap30"]
    assert pk.data.metrics["mdb_drums/f1Tom"] == pytest.approx(0.671)
    assert pk.data.metrics["gmd_test/nSongs"] == 45
    assert pk.data.params["rules.tom_relative_min_gap"] == "3.0"
    assert pk.data.params["datasets"] == "mdb_drums,gmd_test"
    assert "gmd_test/f1Pads" not in runs["rule-eval-x/fixed"].data.metrics  # nan은 안 올림
    assert {"candidates.csv", "summary.md", "candidates.yaml"} <= _artifacts(pk)


def test_파인튜닝_폴더는_에폭을_step으로(tmp_path: Path):
    folder = tmp_path / "tom_5cls"
    folder.mkdir()
    (folder / "log.csv").write_text(
        "epoch,step,lr,loss,sec,val_f1,val_tom_f1,guard,best\n"
        "-1,0,0.0001,nan,0,0.80,0.407,1,1\n"
        "0,2000,0.0001,0.086,270,0.85,0.60,1,1\n"
        "1,4000,0.0001,0.069,540,0.86,0.58,1,0\n",
        encoding="utf-8",
    )
    (folder / "config.yaml").write_text(
        "classes: five\nselect_metric: tom_f1\ntrain_datasets:\n- {path: a.yaml, weight: 0.5}\n"
        "_songs_digest: abc\n_reference: {f1_kick: 0.952, pedal_f1: 0.0}\n"
        "_resumed:\n- {from_epoch: 1, at: '2026-10-30T14:00:00'}\n",
        encoding="utf-8",
    )
    (folder / "best.pth").write_bytes(b"x")
    store = tmp_path / "mlruns"
    assert [o.status for o in relog([folder], str(store), log=lambda _: None)] == ["기록"]
    (run,) = _runs(store, "adtof-finetune")
    client = mlflow.tracking.MlflowClient(tracking_uri=store.resolve().as_uri())
    history = client.get_metric_history(run.info.run_id, "val_tom_f1")
    assert [(m.step, m.value) for m in history] == [(0, 0.407), (1, 0.60), (2, 0.58)]
    assert len(client.get_metric_history(run.info.run_id, "loss")) == 2  # 에폭 -1 nan은 빠짐
    assert run.data.metrics["best/tom_f1"] == pytest.approx(0.60)
    assert run.data.metrics["best/epoch"] == 0
    assert [m.value for m in client.get_metric_history(run.info.run_id, "is_best")] == [1, 1, 0]
    assert run.data.metrics["reference/f1_kick"] == pytest.approx(0.952)
    assert run.data.params["classes"] == "five" and run.data.params["songsDigest"] == "abc"
    assert run.data.tags["runId"] == "tom_5cls" and run.data.tags["resumed"] == "1"
    assert {"best.pth", "config.yaml", "log.csv"} <= _artifacts(run)


def test_체크포인트_평가는_같은_이름을_순서로_가른다(tmp_path: Path):
    folder = tmp_path / "adtof-eval-ft"
    folder.mkdir()
    (folder / "summary.csv").write_text(
        "checkpoint,dataset,n_songs,f1,tom_f1\n"
        "best.pth,mdb_drums,23,0.80,0.50\nbest.pth,mdb_drums,23,0.81,0.55\n"
        "best.pth,gmd_test,45,0.90,0.85\nbest.pth,gmd_test,45,0.91,0.86\n",
        encoding="utf-8",
    )
    store = tmp_path / "mlruns"
    relog([folder], str(store), log=lambda _: None)
    (run,) = _runs(store, "adtof-eval")
    assert run.data.metrics["best.pth_2/mdb_drums/tom_f1"] == pytest.approx(0.55)
    assert run.data.metrics["best.pth_1/gmd_test/f1"] == pytest.approx(0.90)
    assert run.data.params["checkpoints"] == "best.pth_1,best.pth_2"


def test_판별_못하는_폴더와_runId_여러개는_건너뛰고_recursive는_확인용을_뺀다(
    trans_run, tmp_path: Path
):
    folder, _ = trans_run
    root = tmp_path / "results"
    (root / "notes").mkdir()
    (root / "notes" / "a.md").write_text("x", encoding="utf-8")
    two = root / "two-ids"
    two.mkdir()
    lines = (folder / "results.csv").read_text(encoding="utf-8").splitlines()
    head, first = lines[0], lines[1]
    (two / "results.csv").write_text(
        "\n".join([head, first, first.replace("trun", "other", 1)]) + "\n", encoding="utf-8"
    )
    check = root / "check-x"
    check.mkdir()
    (check / "results.csv").write_text((folder / "results.csv").read_text("utf-8"), "utf-8")

    store = tmp_path / "mlruns"
    out = relog([root / "notes", two], str(store), log=lambda _: None)
    assert [o.status for o in out] == ["건너뜀", "건너뜀"]
    assert "종류를 판별" in out[0].detail and "runId가 2개" in out[1].detail

    found = relog([root], str(store), dry_run=True, recursive=True, log=lambda _: None)
    assert {o.folder.name for o in found} == {"trun", "two-ids"}  # check-x·notes는 안 봄
    assert [o.status for o in found if o.folder.name == "trun"] == ["기록 예정"]
    assert _runs(store, "transcription-bench") == []  # dry-run은 기록 안 함


def test_mlruns_복사는_지표_이력과_산출물을_옮기고_확인용은_뺀다(trans_run, tmp_path: Path):
    _, orig = trans_run
    src = mlflow.tracking.MlflowClient(tracking_uri=orig.resolve().as_uri())
    trans_id = src.get_experiment_by_name("transcription-bench").experiment_id
    check = src.create_run(trans_id, run_name="local-check", tags={"runId": "local-check"})
    src.set_terminated(check.info.run_id)
    ft = src.create_run(src.create_experiment("adtof-finetune"), run_name="tom_x")
    src.set_tag(ft.info.run_id, "runId", "tom_x")
    for step, v in enumerate((0.4, 0.6, 0.7)):
        src.log_metric(ft.info.run_id, "val_tom_f1", v, step=step)
    src.set_terminated(ft.info.run_id)

    store = tmp_path / "mlruns_team"
    out = copy_mlruns(orig, str(store), log=lambda _: None)
    assert sorted((o.run_id, o.status) for o in out) == [
        ("local-check", "건너뜀"), ("tom_x", "기록"), ("trun", "기록")
    ]  # fmt: skip
    (a,) = [r for r in _runs(orig, "transcription-bench") if r.data.tags["runId"] == "trun"]
    art_a = _artifacts(a)  # 지금 기록 주소가 orig일 때 읽음
    (b,) = _runs(store, "transcription-bench")
    assert b.data.metrics == a.data.metrics and b.data.params == a.data.params
    assert b.data.tags["source"] == "mlruns" and b.info.run_name == "trun"
    assert _artifacts(b) == art_a and "results.csv" in art_a
    (t,) = _runs(store, "adtof-finetune")
    client = mlflow.tracking.MlflowClient(tracking_uri=store.resolve().as_uri())
    hist = client.get_metric_history(t.info.run_id, "val_tom_f1")
    assert [(m.step, m.value) for m in hist] == [(0, 0.4), (1, 0.6), (2, 0.7)]
    again = copy_mlruns(orig, str(store), log=lambda _: None)
    assert {o.status for o in again} == {"건너뜀", "건너뜀(중복)"}


def test_relog_명령은_표를_찍는다(trans_run, tmp_path: Path, capsys):
    folder, _ = trans_run
    code = main(["relog", str(folder), "--mlflow-uri", str(tmp_path / "m"), "--dry-run"])
    assert code == 0
    out = capsys.readouterr().out
    assert "| 결과 |" in out and "기록 예정" in out
    assert main(["relog"]) == 2
