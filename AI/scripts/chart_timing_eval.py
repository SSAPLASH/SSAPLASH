"""채보 JSON 격자 원점(offsetMs)·bpm 측정 (설계 "격자 원점·bpm 계산 수정" 인수 조건 16·17).

드럼 트랙에 Beat This!만 돌려 서비스와 같은 코드(`estimate_from_beats`, `grid_origin_ms`)로 bpm·offsetMs를 만듦.
서비스가 그 뒤에 하는 노트 기준 원점 보정·DBN 후처리·tempoMap은 넣지 않음.
노트는 다시 만들지 않고 이미 있는 chart.json의 timeMs를 씀. 비교용으로 이전 방식(원점 0, 박 간격 평균 bpm)도 같이 잼.

- 데모 곡: 폴더마다 drums.flac·chart.json(채보 결과 폴더). 16분 격자 밖 노트 비율(칸 중심에서 stepMs/4 초과,
  FE 악보 격자와 같은 기준)과 마지막 30초 박의 격자 어긋남
- MDB Drums: 정답 박으로 bpm 차이, 곡 끝 어긋남(정답 첫 마디 첫 박에서 고정 격자로 센 마지막 박과 정답 마지막 박의
  차이, 허용 폭은 16분 칸의 1/4), 첫 마디 첫 박 차이. 드럼 트랙은 운영 분리 결과 폴더(<곡>/drums.flac)
- GMD test·합성곡 드럼 트랙: 정답 bpm ±2% 안에 든 곡 수 (회귀 확인)

Beat This! 박 시각은 --out/beats/에 저장해 두고 다시 쓰므로 계산 방식만 바꿀 때는 모델을 다시 안 돌림.

  uv run python scripts/chart_timing_eval.py --out data/results/chart-timing \\
      --demo data/chart_timing/demo \\
      --mdb "data/mdb_drums/MDB Drums" --mdb-drums data/chart_timing/mdb_sep \\
      --gmd-root data/gmd/groove --gmd-dataset configs/bench/datasets/gmd_test.yaml \\
      --synth data/synth_v1
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import numpy as np
import yaml

from ssaplash_ai.chart.audio_io import read_audio_file
from ssaplash_ai.chart.chart_json import grid_origin_ms
from ssaplash_ai.chart.config import TempoConfig, TranscriptionConfig
from ssaplash_ai.chart.tempo import (
    INTERVAL_TOLERANCE,
    ensure_beat_this_checkpoint,
    estimate_from_beats,
    fold_bpm,
)

AUDIO_SR = 44100
LAST_SEC = 30.0
BPM_TOLERANCE = 0.02


class BeatCache:
    """Beat This! 박·마디 첫 박 시각(초). 파일마다 --out/beats/<이름>.npz에 저장."""

    def __init__(self, folder: Path, device: str) -> None:
        self.folder = folder
        self.device = device
        self._model = None
        folder.mkdir(parents=True, exist_ok=True)

    def get(self, name: str, audio_path: Path) -> tuple[np.ndarray, np.ndarray]:
        cache = self.folder / f"{name.replace('/', '_')}.npz"
        if cache.is_file():
            z = np.load(cache)
            return z["beats"], z["downbeats"]
        if self._model is None:
            from beat_this.inference import Audio2Beats

            checkpoint = ensure_beat_this_checkpoint()
            self._model = Audio2Beats(
                checkpoint_path=str(checkpoint), device=self.device, dbn=False
            )
        audio = read_audio_file(audio_path, AUDIO_SR)
        beats, downbeats = self._model(audio.mean(axis=0), AUDIO_SR)
        beats = np.asarray(beats, dtype=np.float64)
        downbeats = np.asarray(downbeats, dtype=np.float64)
        np.savez(cache, beats=beats, downbeats=downbeats)
        return beats, downbeats


def mean_interval_bpm(beats: np.ndarray, tempo: TempoConfig) -> float | None:
    """이전 방식(-169): 박 간격 중앙값 ±15% 안 간격의 평균. 비교용."""
    if beats.size < 2:
        return None
    intervals = np.diff(beats)
    median = float(np.median(intervals))
    kept = intervals[np.abs(intervals - median) <= INTERVAL_TOLERANCE * median]
    if kept.size < 3:
        return None
    return round(fold_bpm(60.0 / float(np.mean(kept)), tempo.min_bpm, tempo.max_bpm), 2)


def off_grid_ratio(times_ms: np.ndarray, origin_ms: float, bpm: float) -> float:
    """16분 격자 밖 노트 비율. 칸 = 60000 / bpm / 4, 칸 중심에서 칸의 1/4 넘게 떨어지면 밖."""
    if times_ms.size == 0:
        return 0.0
    step = 60_000.0 / bpm / 4
    pos = (times_ms - origin_ms) / step
    return float(np.mean(np.abs(pos - np.round(pos)) * step > step / 4))


def last_beats_drift_ms(beats_ms: np.ndarray, origin_ms: float, bpm: float) -> float:
    """마지막 30초 박이 고정 박 격자(origin + n × 박 길이)에서 떨어진 거리의 중앙값. +면 실제 박이 늦음."""
    beat = 60_000.0 / bpm
    last = beats_ms[beats_ms >= beats_ms[-1] - LAST_SEC * 1000]
    pos = (last - origin_ms) / beat
    return float(np.median((pos - np.round(pos)) * beat))


def eval_demo(folders: list[Path], beats: BeatCache, tempo: TempoConfig) -> list[dict]:
    rows = []
    for folder in folders:
        chart = json.loads((folder / "chart.json").read_text(encoding="utf-8"))
        times = np.array([n["timeMs"] for n in chart["charts"][0]["notes"]], dtype=np.float64)
        b, d = beats.get(f"demo_{folder.name}", folder / "drums.flac")
        est = estimate_from_beats(b, d, tempo, "beat_this")
        origin = grid_origin_ms(est)
        old_bpm = mean_interval_bpm(b, tempo)
        rows.append(
            {
                "song": folder.name,
                "notes": int(times.size),
                "old_bpm": old_bpm,
                "bpm": est.bpm,
                "offset_ms": origin,
                "first_downbeat_ms": est.first_downbeat_ms,
                "off_grid_old": round(off_grid_ratio(times, 0, old_bpm), 4),
                "off_grid_origin_only": round(off_grid_ratio(times, origin, old_bpm), 4),
                "off_grid": round(off_grid_ratio(times, origin, est.bpm), 4),
                "notes_before_offset": int(np.sum(times < origin)),
                "last30_drift_old_ms": round(last_beats_drift_ms(b * 1000, origin, old_bpm)),
                "last30_drift_ms": round(last_beats_drift_ms(b * 1000, origin, est.bpm)),
            }
        )
    return rows


def _end_drift_ms(truth: np.ndarray, truth_down: float, bpm: float) -> float:
    """정답 첫 마디 첫 박에서 bpm 고정 격자로 센 마지막 박 - 정답 마지막 박 (ms)."""
    first = int(np.argmin(np.abs(truth - truth_down)))
    n = truth.size - 1 - first
    return (truth_down + n * 60.0 / bpm - truth[-1]) * 1000


def eval_mdb(mdb: Path, drums: Path, beats: BeatCache, tempo: TempoConfig) -> list[dict]:
    rows = []
    for ann in sorted((mdb / "annotations" / "beats").glob("*.beats")):
        drum_path = drums / ann.stem / "drums.flac"
        if not drum_path.is_file():
            print(f"건너뜀 (드럼 트랙 없음): {drum_path}")
            continue
        gt = np.loadtxt(ann)
        truth = gt[:, 0]
        ref = 60.0 / float(np.polyfit(np.arange(truth.size), truth, 1)[0])
        downs = truth[gt[:, 1] == 1]
        truth_down = float(downs[0]) if downs.size else float(truth[0])
        b, d = beats.get(f"mdb_{ann.stem}", drum_path)
        est = estimate_from_beats(b, d, tempo, "beat_this")
        row = {
            "song": ann.stem,
            "ref_bpm": round(ref, 2),
            "tol_ms": round(60_000.0 / ref / 16, 1),
            "downbeat_diff_ms": None
            if est.first_downbeat_ms is None
            else round(est.first_downbeat_ms - truth_down * 1000),
        }
        for key, bpm in (("old", mean_interval_bpm(b, tempo)), ("new", est.bpm)):
            ok = bpm is not None and abs(bpm / ref - 1) <= BPM_TOLERANCE
            row[f"{key}_bpm"] = bpm
            row[f"{key}_ok"] = ok
            row[f"{key}_diff"] = round(abs(bpm - ref), 3) if ok else None
            row[f"{key}_end_ms"] = round(_end_drift_ms(truth, truth_down, bpm), 1) if ok else None
        rows.append(row)
    return rows


def eval_regression(
    items: list[tuple[str, str, float, Path]], beats: BeatCache, tempo: TempoConfig
) -> list[dict]:
    rows = []
    for group, name, truth, path in items:
        b, d = beats.get(f"{group}_{name}", path)
        est = estimate_from_beats(b, d, tempo, "beat_this")
        old = mean_interval_bpm(b, tempo)
        rows.append(
            {
                "group": group,
                "song": name,
                "truth": truth,
                "old_bpm": old,
                "old_ok": old is not None and abs(old / truth - 1) <= BPM_TOLERANCE,
                "bpm": est.bpm,
                "ok": abs(est.bpm / truth - 1) <= BPM_TOLERANCE,
            }
        )
    return rows


def regression_items(args: argparse.Namespace) -> list[tuple[str, str, float, Path]]:
    items = []
    if args.gmd_root and args.gmd_dataset:
        songs = yaml.safe_load(args.gmd_dataset.read_text(encoding="utf-8"))["songs"]
        with open(args.gmd_root / "info.csv", encoding="utf-8") as f:
            info = {r["id"]: r for r in csv.DictReader(f)}
        for song_id in songs:
            r = info[song_id]
            items.append(("gmd", song_id, float(r["bpm"]), args.gmd_root / r["audio_filename"]))
    if args.synth:
        for song in sorted(p for p in args.synth.iterdir() if (p / "meta.yaml").is_file()):
            meta = yaml.safe_load((song / "meta.yaml").read_text(encoding="utf-8"))
            items.append(("synth", song.name, float(meta["drums"]["bpm"]), song / "drums.wav"))
    return items


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        return
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def _median(values: list[float]) -> float | None:
    return round(float(np.median(values)), 3) if values else None


def summarize(demo: list[dict], mdb: list[dict], regression: list[dict]) -> list[str]:
    lines = []
    for r in demo:
        lines.append(
            f"데모 {r['song']}: bpm {r['old_bpm']} → {r['bpm']}, offsetMs {r['offset_ms']}, "
            f"격자 밖 {r['off_grid_old']:.1%} (원점 0) → {r['off_grid_origin_only']:.1%} (원점만) "
            f"→ {r['off_grid']:.1%}, 마지막 30초 어긋남 {r['last30_drift_old_ms']:+d} → "
            f"{r['last30_drift_ms']:+d} ms, offsetMs 앞 노트 {r['notes_before_offset']}개"
        )
    if mdb:
        for key, label in (("old", "이전 방식"), ("new", "바꾼 방식")):
            ok = [r for r in mdb if r[f"{key}_ok"]]
            over = [r for r in ok if abs(r[f"{key}_end_ms"]) > r["tol_ms"]]
            lines.append(
                f"MDB {label}: bpm 맞은 곡 {len(ok)}/{len(mdb)}, 정답과 차이 중앙값 "
                f"{_median([r[f'{key}_diff'] for r in ok])}, 곡 끝 어긋남이 허용 폭을 넘은 곡 {len(over)}곡 "
                f"({', '.join(r['song'] for r in over) or '없음'})"
            )
        downs = [abs(r["downbeat_diff_ms"]) for r in mdb if r["downbeat_diff_ms"] is not None]
        lines.append(
            f"MDB 첫 마디 첫 박: 정답과 50ms 안 {sum(d <= 50 for d in downs)}/{len(mdb)}곡, "
            f"차이 중앙값 {_median(downs)} ms"
        )
    for group in dict.fromkeys(r["group"] for r in regression):
        rows = [r for r in regression if r["group"] == group]
        lines.append(
            f"{group} bpm ±2%: 이전 {sum(r['old_ok'] for r in rows)}/{len(rows)}, "
            f"바꾼 방식 {sum(r['ok'] for r in rows)}/{len(rows)}"
        )
    return lines


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", type=Path, required=True, help="결과 csv·요약·박 저장 폴더")
    parser.add_argument("--config", type=Path, default=Path("configs/chart/transcription.yaml"))
    parser.add_argument("--device", default="cpu", help="Beat This! 장치 (기본 cpu)")
    parser.add_argument("--demo", type=Path, help="채보 결과 폴더들의 부모 (drums.flac·chart.json)")
    parser.add_argument("--mdb", type=Path, help="MDB Drums 폴더 (annotations/beats)")
    parser.add_argument("--mdb-drums", type=Path, help="MDB 분리 드럼 폴더 (<곡>/drums.flac)")
    parser.add_argument("--gmd-root", type=Path, help="GMD groove 폴더 (info.csv)")
    parser.add_argument("--gmd-dataset", type=Path, help="GMD 곡 목록 yaml (songs)")
    parser.add_argument("--synth", type=Path, help="합성곡 폴더 (곡마다 meta.yaml·drums.wav)")
    args = parser.parse_args()

    tempo = TranscriptionConfig.from_yaml(args.config).tempo
    args.out.mkdir(parents=True, exist_ok=True)
    beats = BeatCache(args.out / "beats", args.device)

    demo = []
    if args.demo:
        folders = sorted(p for p in args.demo.iterdir() if (p / "chart.json").is_file())
        demo = eval_demo(folders, beats, tempo)
    mdb = eval_mdb(args.mdb, args.mdb_drums, beats, tempo) if args.mdb and args.mdb_drums else []
    regression = eval_regression(regression_items(args), beats, tempo)

    write_csv(args.out / "demo.csv", demo)
    write_csv(args.out / "mdb.csv", mdb)
    write_csv(args.out / "regression.csv", regression)
    lines = summarize(demo, mdb, regression)
    (args.out / "summary.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
