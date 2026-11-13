"""격자 원점을 킥·스네어 노트에 맞추는 규칙 측정 (설계 v0.5 인수 조건 19·20·21).

같은 Beat This! 박으로 원점 두 방식을 비교함. downbeat는 `grid_origin_ms` 그대로, notes는 `align_origin_to_notes`로
보정한 값. 노트는 다시 만들지 않음.

- 채보 곡(--song 이름=chart.json,drums.flac): 킥·스네어와 클릭 차이 중앙값(노트 − 클릭, 음수면 클릭이 늦음,
  격자 박에서 60ms 안 노트만), 16분 격자 밖 노트 비율
- MDB Drums: 정답 킥·스네어 타격을 노트로 넣고 같은 값, 원점이 정답 첫 마디 첫 박과 한 마디 안에서 떨어진 거리

Beat This! 박 시각은 chart_timing_eval.py와 같은 캐시(--beats/<이름>.npz)를 씀.

  uv run python scripts/origin_alignment_eval.py --out data/results/origin-notes \\
      --beats data/results/chart-timing-242/beats \\
      --song demo_tbh=data/chart_timing/demo/tbh/chart.json,data/chart_timing/demo/tbh/drums.flac \\
      --mdb "data/mdb_drums/MDB Drums" --mdb-drums data/chart_timing/mdb_sep
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from chart_timing_eval import BeatCache, off_grid_ratio, write_csv

from ssaplash_ai.chart.chart_json import (
    ORIGIN_ALIGN_PADS,
    ORIGIN_ALIGN_WINDOW_MS,
    align_origin_to_notes,
    grid_origin_ms,
)
from ssaplash_ai.chart.config import TempoConfig
from ssaplash_ai.chart.tempo import TempoEstimate, estimate_from_beats

# MDB class 주석 → 패드. 원점 보정에 쓰는 두 패드만
MDB_CLASS_PAD = {"KD": "KICK", "SD": "SNARE"}
MDB_TOLERANCE_MS = 50.0


def _fold(x: np.ndarray | float, period: float) -> np.ndarray | float:
    """period로 나눈 나머지를 −period/2 ~ period/2로 접음"""
    return (np.asarray(x) + period / 2) % period - period / 2


def click_note_ms(notes: list[dict], origin_ms: float, bpm: float) -> tuple[float | None, int]:
    """킥·스네어 노트 − 가장 가까운 클릭 시각의 중앙값과 쓴 노트 수. 창 밖 노트는 뺌"""
    times = np.array([n["timeMs"] for n in notes if n["pad"] in ORIGIN_ALIGN_PADS], dtype=float)
    d = _fold(times - origin_ms, 60_000.0 / bpm)
    d = d[np.abs(d) <= ORIGIN_ALIGN_WINDOW_MS]
    return (round(float(np.median(d)), 1) if d.size else None), int(d.size)


def measure(name: str, notes: list[dict], est: TempoEstimate) -> dict:
    all_times = np.array([n["timeMs"] for n in notes], dtype=float)
    row: dict = {"song": name, "bpm": est.bpm, "notes": len(notes)}
    origins = {"downbeat": grid_origin_ms(est)}
    origins["notes"] = align_origin_to_notes(origins["downbeat"], est, notes)
    for mode, origin in origins.items():
        median, used = click_note_ms(notes, origin, est.bpm)
        row[f"{mode}_offset_ms"] = origin
        row[f"{mode}_note_minus_click_ms"] = median
        row[f"{mode}_off_grid"] = round(off_grid_ratio(all_times, origin, est.bpm), 4)
    row["notes_used"] = used
    return row


def eval_songs(specs: list[str], beats: BeatCache, tempo: TempoConfig) -> list[dict]:
    rows = []
    for spec in specs:
        name, paths = spec.split("=", 1)
        chart_path, drums_path = (Path(p) for p in paths.split(","))
        chart = json.loads(chart_path.read_text(encoding="utf-8"))
        b, d = beats.get(name, drums_path)
        rows.append(
            measure(
                name, chart["charts"][0]["notes"], estimate_from_beats(b, d, tempo, "beat_this")
            )
        )
    return rows


def eval_mdb(mdb: Path, drums: Path, beats: BeatCache, tempo: TempoConfig) -> list[dict]:
    rows = []
    for ann in sorted((mdb / "annotations" / "beats").glob("*.beats")):
        drum_path = drums / ann.stem / "drums.flac"
        song = ann.stem.removesuffix("_MIX")
        hits_path = mdb / "annotations" / "class" / f"{song}_class.txt"
        if not drum_path.is_file() or not hits_path.is_file():
            print(f"건너뜀 (드럼 트랙·정답 없음): {ann.stem}")
            continue
        gt = np.loadtxt(ann)
        downs = gt[gt[:, 1] == 1, 0]
        truth_down_ms = float(downs[0] if downs.size else gt[0, 0]) * 1000
        notes = []
        for line in hits_path.read_text(encoding="utf-8").splitlines():
            parts = line.split()
            if len(parts) == 2 and parts[1] in MDB_CLASS_PAD:
                notes.append(
                    {"timeMs": round(float(parts[0]) * 1000), "pad": MDB_CLASS_PAD[parts[1]]}
                )
        b, d = beats.get(f"mdb_{ann.stem}", drum_path)
        est = estimate_from_beats(b, d, tempo, "beat_this")
        row = measure(ann.stem, notes, est)
        bar_ms = 60_000.0 / est.bpm * int(est.time_signature.split("/")[0])
        for mode in ("downbeat", "notes"):
            row[f"{mode}_downbeat_err_ms"] = round(
                float(_fold(row[f"{mode}_offset_ms"] - truth_down_ms, bar_ms)), 1
            )
        rows.append(row)
    return rows


def _median_abs(values: list[float | None]) -> float | None:
    kept = [abs(v) for v in values if v is not None]
    return round(float(np.median(kept)), 1) if kept else None


def summarize(songs: list[dict], mdb: list[dict]) -> list[str]:
    lines = []
    for r in songs + mdb:
        lines.append(
            f"{r['song']}: offsetMs {r['downbeat_offset_ms']} → {r['notes_offset_ms']}, "
            f"노트−클릭 {r['downbeat_note_minus_click_ms']} → {r['notes_note_minus_click_ms']} ms "
            f"(노트 {r['notes_used']}개), 격자 밖 {r['downbeat_off_grid']:.1%} → {r['notes_off_grid']:.1%}"
            + (
                f", 정답 첫 마디 첫 박과 {r['downbeat_downbeat_err_ms']} → {r['notes_downbeat_err_ms']} ms"
                if "notes_downbeat_err_ms" in r
                else ""
            )
        )
    if mdb:
        for mode in ("downbeat", "notes"):
            errs = [r[f"{mode}_downbeat_err_ms"] for r in mdb]
            near = sum(abs(e) <= MDB_TOLERANCE_MS for e in errs)
            lines.append(
                f"MDB {mode}: 정답 첫 마디 첫 박과 {MDB_TOLERANCE_MS:g}ms 안 {near}/{len(mdb)}곡, "
                f"차이 절댓값 중앙값 {_median_abs(errs)} ms, "
                f"노트−클릭 절댓값 중앙값 {_median_abs([r[f'{mode}_note_minus_click_ms'] for r in mdb])} ms"
            )
    return lines


def main() -> None:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--beats", type=Path, required=True, help="Beat This! 박 캐시 폴더")
    p.add_argument("--song", action="append", default=[], help="이름=chart.json,drums.flac")
    p.add_argument("--mdb", type=Path, help="MDB Drums 폴더 (annotations/beats·class)")
    p.add_argument("--mdb-drums", type=Path, help="곡별 분리 드럼 폴더 (<곡>/drums.flac)")
    p.add_argument("--device", default="cpu")
    args = p.parse_args()

    tempo = TempoConfig()
    beats = BeatCache(args.beats, args.device)
    songs = eval_songs(args.song, beats, tempo)
    mdb = eval_mdb(args.mdb, args.mdb_drums, beats, tempo) if args.mdb else []
    args.out.mkdir(parents=True, exist_ok=True)
    if songs:
        write_csv(args.out / "songs.csv", songs)
    if mdb:
        write_csv(args.out / "mdb.csv", mdb)
    lines = summarize(songs, mdb)
    (args.out / "summary.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
