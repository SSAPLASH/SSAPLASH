"""채보 보고서 집계 테스트 (인수 조건 8의 SUM 규칙·10의 변화 열)."""

from __future__ import annotations

import csv
import math
from pathlib import Path

import pytest

from ssaplash_ai.bench.report import transcription_summary as ts
from ssaplash_ai.bench.report import write_transcription_report
from ssaplash_ai.bench.runner.transcription_runner import CSV_COLUMNS, HITS_BY_CLASS_COLUMNS

BASE = {c: "" for c in CSV_COLUMNS}


def _row(**kw) -> dict:
    row = {
        **BASE,
        "runId": "r",
        "device": "cpu",
        "host": "local",
        "adapter": "mock",
        "licenseCode": "x",
        "licenseWeights": "y",
        "eightPad": "True",
        "hasVelocity": "False",
        "input": "drums",
        "separator": "",
        "dataset": "ds",
        "durationSec": "2.0",
        "error": "",
        "rtf": "0.1",
        "peakVramMb": "nan",
        "f1Any50": "1.0",
    }
    row.update({k: str(v) for k, v in kw.items()})
    return row


def _counts(prefix: str, tp: int, fp: int, fn: int, tp25: int | None = None) -> dict:
    tp25 = tp if tp25 is None else tp25
    return {
        f"tp{prefix}50": tp,
        f"fp{prefix}50": fp,
        f"fn{prefix}50": fn,
        f"tp{prefix}25": tp25,
        f"fp{prefix}25": fp + (tp - tp25),
        f"fn{prefix}25": fn + (tp - tp25),
    }


def _write(path: Path, rows: list[dict], columns=CSV_COLUMNS) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=columns)
        w.writeheader()
        w.writerows(rows)
    return path


def test_묶음_F1은_개수_합산이지_곡_평균이_아니다(tmp_path: Path):
    # 곡 A: 1/1 맞힘(F1 1.0), 곡 B: 9개 중 3개(F1 0.5). 합산 F1 = 2·4/(2·4+0+6) = 0.571
    rows = [
        _row(model="m", songId="a", **_counts("Five", 1, 0, 0), **_counts("Pads", 1, 0, 0)),
        _row(model="m", songId="b", **_counts("Five", 3, 0, 6), **_counts("Pads", 3, 0, 6)),
    ]
    csv_path = _write(tmp_path / "r" / "results.csv", rows)
    summary = ts.summarize(ts.load_results([csv_path]))
    assert len(summary) == 1
    r = summary.iloc[0]
    assert r["f1Pads50"] == pytest.approx(8 / 14) and r["f1Five50"] == pytest.approx(8 / 14)
    assert r["tpPads50"] == 4 and r["fnPads50"] == 6 and r["nSongs"] == 2 and r["nErrors"] == 0
    assert r["perfectRatio"] == pytest.approx(1.0)


def test_실패한_곡은_빼고_eightPad_거짓이면_8패드가_nan(tmp_path: Path):
    rows = [
        _row(model="c", songId="a", eightPad="False", **_counts("Five", 4, 1, 1)),
        _row(model="c", songId="b", eightPad="False", error="RuntimeError: x"),
    ]
    csv_path = _write(tmp_path / "r" / "results.csv", rows)
    summary = ts.summarize(ts.load_results([csv_path]))
    r = summary.iloc[0]
    assert r["nErrors"] == 1 and math.isnan(r["f1Pads50"]) and r["f1Five50"] == pytest.approx(0.8)
    assert r["f1Main50"] == pytest.approx(0.8)  # 주 F1은 5가지


def test_분리_후_변화는_같은_모델의_drums_대비(tmp_path: Path):
    rows = [
        _row(model="m", songId="a", **_counts("Five", 10, 0, 0), **_counts("Pads", 10, 0, 0)),
        _row(
            model="m",
            songId="a",
            input="separated",
            separator="sep",
            **_counts("Five", 8, 2, 2),
            **_counts("Pads", 8, 2, 2),
        ),
        _row(
            model="m",
            songId="a",
            input="mixture",
            **_counts("Five", 9, 1, 1),
            **_counts("Pads", 9, 1, 1),
        ),
        _row(
            model="x",
            songId="a",
            input="mixture",
            **_counts("Five", 5, 5, 5),
            **_counts("Pads", 5, 5, 5),
        ),
    ]
    csv_path = _write(tmp_path / "r" / "results.csv", rows)
    summary = ts.summarize(ts.load_results([csv_path]))
    by = {(r["model"], r["input"]): r for _, r in summary.iterrows()}
    assert math.isnan(by[("m", "drums")]["deltaF1VsDrums"])
    assert by[("m", "separated")]["deltaF1VsDrums"] == pytest.approx(0.8 - 1.0)
    assert by[("m", "mixture")]["deltaF1VsDrums"] == pytest.approx(0.9 - 1.0)
    assert math.isnan(by[("x", "mixture")]["deltaF1VsDrums"])  # drums 행 없음
    assert by[("m", "separated")]["inputLabel"] == "separated(sep)"
    # 순서: 주 F1 내림차순
    assert list(summary["f1Main50"]) == sorted(summary["f1Main50"], reverse=True)

    # 입력이 둘 이상인 묶음이 있으면 입력별 비교 그림이 하나 더 생김
    paths = write_transcription_report([csv_path], tmp_path / "out")
    assert [p.name for p in paths.extra_pngs] == ["separation_effect.png"]
    assert all(p.is_file() for p in paths.all())


def test_라벨별_표와_보고서_파일(tmp_path: Path):
    rows = [
        _row(model="m", songId="a", **_counts("Five", 2, 0, 0), **_counts("Pads", 2, 0, 0)),
        _row(model="m", songId="b", **_counts("Five", 1, 1, 1), **_counts("Pads", 1, 1, 1)),
    ]
    run_dir = tmp_path / "r"
    csv_path = _write(run_dir / "results.csv", rows)
    hits = []
    for song, (k_tp, k_fp, k_fn), (s_tp, s_fp, s_fn) in (
        ("a", (1, 0, 0), (1, 0, 0)),
        ("b", (1, 0, 0), (0, 1, 1)),
    ):
        for window in (50, 25):
            hits.append(
                {
                    "runId": "r",
                    "model": "m",
                    "input": "drums",
                    "separator": "",
                    "dataset": "ds",
                    "songId": song,
                    "scheme": "pads",
                    "label": "KICK",
                    "windowMs": window,
                    "tp": k_tp,
                    "fp": k_fp,
                    "fn": k_fn,
                }
            )
            hits.append(
                {
                    "runId": "r",
                    "model": "m",
                    "input": "drums",
                    "separator": "",
                    "dataset": "ds",
                    "songId": song,
                    "scheme": "pads",
                    "label": "SNARE",
                    "windowMs": window,
                    "tp": s_tp,
                    "fp": s_fp,
                    "fn": s_fn,
                }
            )
    _write(run_dir / "hits_by_class.csv", hits, HITS_BY_CLASS_COLUMNS)
    table = ts.label_f1_table(ts.load_hits_by_class([csv_path]), "pads")
    assert len(table) == 1
    assert table.iloc[0]["KICK"] == pytest.approx(1.0) and table.iloc[0]["SNARE"] == pytest.approx(
        0.5
    )

    paths = write_transcription_report([csv_path], tmp_path / "out")
    md = paths.summary_md.read_text(encoding="utf-8")
    assert "## ds" in md and "패드별 F1" in md and "| KICK | SNARE |" in md
    assert "## 실패한 곡" not in md
    for p in paths.all():
        assert p.is_file()
    assert paths.extra_pngs == []  # 정답 드럼 입력만이면 입력별 비교 그림은 없음


def test_GPU가_섞인_묶음에만_GPU_열이_붙는다(tmp_path: Path):
    # 코랩 run과 서버 run을 합칠 때. 다른 묶음은 GPU 한 종류라 열이 없음
    a100, h200 = "NVIDIA A100-SXM4-40GB", "NVIDIA H200 NVL"
    colab = [
        _row(model="m", songId="a", gpuName=a100, **_counts("Five", 1, 0, 0)),
        _row(model="m", songId="a", dataset="solo", gpuName=a100, **_counts("Five", 1, 0, 0)),
    ]
    server = [_row(model="y", songId="a", gpuName=h200, **_counts("Five", 1, 0, 0))]
    paths = write_transcription_report(
        [
            _write(tmp_path / "c" / "results.csv", colab),
            _write(tmp_path / "s" / "results.csv", server),
        ],
        tmp_path / "out",
    )
    md = paths.summary_md.read_text(encoding="utf-8")
    ds_part, solo_part = md.split("## ds\n")[1].split("## solo\n")
    assert "| 가중치 라이선스 | GPU |" in ds_part and a100 in ds_part and h200 in ds_part
    assert "| GPU |" not in solo_part


def test_빈_hits_파일이_없어도_보고서는_된다(tmp_path: Path):
    rows = [_row(model="m", songId="a", **_counts("Five", 1, 0, 0), **_counts("Pads", 1, 0, 0))]
    csv_path = _write(tmp_path / "r" / "results.csv", rows)
    paths = write_transcription_report([csv_path], tmp_path / "out")
    assert "패드별 F1" not in paths.summary_md.read_text(encoding="utf-8")
