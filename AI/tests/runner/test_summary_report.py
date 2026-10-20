"""보고서 생성 테스트. 손으로 만든 결과 CSV만 사용 (모델·지표 코드 없음)."""

from __future__ import annotations

import csv
import math
from pathlib import Path

from ssaplash_ai.bench.cli import main
from ssaplash_ai.bench.report import (
    load_results,
    summarize,
    summary_markdown,
    summary_metrics_by_model,
    write_report,
)
from ssaplash_ai.bench.runner.benchmark_runner import CSV_COLUMNS


def _row(model: str, song: str, dataset: str = "musdb", error: str = "", **vals) -> dict:
    row = {c: "" for c in CSV_COLUMNS}
    row.update(
        runId="r1",
        timestamp="2026-10-20T00:00:00",
        device="cuda",
        host="local",
        model=model,
        checkpoint=f"{model}.ckpt",
        configHash="abc",
        adapter="mock",
        nParams=41200000,
        licenseCode="MIT",
        licenseWeights="연구 전용",
        dataset=dataset,
        songId=song,
        durationSec=30.0,
        error=error,
    )
    defaults = dict(
        sdrDrums=10.0,
        sdrAccomp=12.0,
        siSdrDrums=9.5,
        siSdrAccomp=11.0,
        sirDrums=15.0,
        sirAccomp=16.0,
        sarDrums=11.0,
        sarAccomp=12.5,
        onsetF1=0.9,
        onsetPrecision=0.92,
        onsetRecall=0.88,
        onsetF1Tight=0.8,
        onsetTrueCount=100,
        onsetPredCount=98,
        attackSlopeDistortion=0.5,
        attackOnsetsUsed=95,
        separateSec=3.0,
        rtf=0.1,
        loadSec=2.0,
        peakRamMb=1500.0,
        peakVramMb=3000.0,
    )
    defaults.update(vals)
    row.update(defaults)
    if error:
        for k in defaults:
            row[k] = "nan"
    return row


def _write_csv(path: Path, rows: list[dict]) -> Path:
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        w.writeheader()
        w.writerows(rows)
    return path


def _sample_csv(tmp_path: Path) -> Path:
    rows = [
        _row("b_model", "s1", sdrDrums=8.0, rtf=0.05),
        _row("b_model", "s2", sdrDrums=9.0, rtf=0.07),
        _row("b_model", "s3", error="RuntimeError: x"),
        _row("a_model", "s1", sdrDrums=11.0, rtf=0.4),
        _row("a_model", "s2", sdrDrums=12.0, rtf=0.5),
        _row("a_model", "s3", sdrDrums=13.0, rtf=0.6),
        _row("c_model", "s1", sdrDrums=-math.inf, rtf=0.01, dataset="synth"),
        _row("c_model", "s2", sdrDrums=4.0, rtf=0.01, dataset="synth"),
    ]
    return _write_csv(tmp_path / "results.csv", rows)


def test_summarize는_드럼_sdr_내림차순으로_정렬하고_실패를_뺀_중앙값을_낸다(tmp_path: Path):
    df = load_results([_sample_csv(tmp_path)])
    s = summarize(df)
    assert list(s["model"]) == ["a_model", "b_model", "c_model"]
    a = s[s["model"] == "a_model"].iloc[0]
    assert a["nSongs"] == 3 and a["nErrors"] == 0 and a["sdrDrums"] == 12.0 and a["rtf"] == 0.5
    b = s[s["model"] == "b_model"].iloc[0]
    assert b["nSongs"] == 3 and b["nErrors"] == 1 and b["sdrDrums"] == 8.5
    c = s[s["model"] == "c_model"].iloc[0]
    assert c["sdrDrums"] == -math.inf  # -inf도 중앙값 계산에 들어간다 (무음 모델은 최하위)


def test_summary_markdown에_비교표_보조값_데이터셋별_실패가_있다(tmp_path: Path):
    df = load_results([_sample_csv(tmp_path)])
    md = summary_markdown(summarize(df), df)
    assert (
        "## 비교표" in md and "## 보조값" in md and "## 데이터셋별" in md and "## 실패한 곡" in md
    )
    assert "| 모델 | 곡/실패 | 드럼 SDR (dB) |" in md and "등급" not in md
    assert "| a_model | 3/0 | 12.00 | 0.900 | 0.50 | 16.00 | 0.500 | 3000.00 | 연구 전용 |" in md
    assert "−∞" in md
    assert "41.2M" in md
    assert "RuntimeError: x" in md


def test_write_report는_파일_4개를_만든다(tmp_path: Path):
    paths = write_report([_sample_csv(tmp_path)], tmp_path / "rep")
    for p in paths.all():
        assert p.is_file() and p.stat().st_size > 0
    assert paths.bars_png.suffix == ".png" and paths.scatter_png.suffix == ".png"


def test_csv_여러_개를_합친다(tmp_path: Path):
    a = _write_csv(tmp_path / "a.csv", [_row("m1", "s1")])
    b = _write_csv(tmp_path / "b.csv", [_row("m2", "s1")])
    df = load_results([a, b])
    assert len(df) == 2 and set(df["model"]) == {"m1", "m2"}


def test_summary_metrics_by_model은_mlflow용_dict를_만든다(tmp_path: Path):
    s = summarize(load_results([_sample_csv(tmp_path)]))
    m = summary_metrics_by_model(s)
    assert m["a_model"]["sdrDrums"] == 12.0 and m["b_model"]["nErrors"] == 1.0


def test_cli_report(tmp_path: Path, capsys):
    csv_path = _sample_csv(tmp_path)
    assert main(["report", str(csv_path), "--out", str(tmp_path / "out")]) == 0
    out = capsys.readouterr().out
    assert "summary.md" in out and (tmp_path / "out" / "summary.md").is_file()
    # --out 없으면 CSV 폴더에
    assert main(["report", str(csv_path)]) == 0
    assert (tmp_path / "summary.md").is_file()
