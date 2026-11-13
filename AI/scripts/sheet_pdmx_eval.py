"""MusicXML 드럼 악보 변환 정확도 측정.

PDMX 공개 악보(MuseScore)를 곡마다 `convert_sheet`로 바꾸고, MuseScore가 같은 악보를 재생해 내보낸 MIDI의 드럼(채널 10)
노트와 비교함. 반복 펼치기·템포 해석이 맞는지 보는 기준.
- gm: 같은 GM 번호 노트를 ±30ms 안에서 1:1로 짝지은 F1 (가능 여부 시험과 같은 채점)
- pad: 양쪽을 패드 표(BE GmDrumMapping과 같음)로 바꾼 뒤 같은 패드끼리 짝지은 F1. 페달은 HIHAT으로 합침(채보 출력과 같음)
곡 목록 CSV는 `file` 열(PDMX 루트 기준 `./mxl/…/*.mxl`)을 씀. `error` 열이 비어 있지 않은 줄은 건너뜀.
MIDI는 같은 경로에서 `mxl/`→`mid/`, `.mxl`→`.mid`. 악보·MIDI는 저장소에 넣지 않음.

  uv run python scripts/sheet_pdmx_eval.py --list <곡 목록.csv> --pdmx <PDMX 압축 푼 폴더> --out data/results/sheet_pdmx
"""

from __future__ import annotations

import argparse
import csv
import sys
from collections import defaultdict
from pathlib import Path

import mido

from ssaplash_ai.chart.errors import ChartError
from ssaplash_ai.chart.sheet import SheetConfig, convert_sheet, pad_of, parse_musicxml

TOL_SEC = 0.03
GOOD_F1 = 0.95


def midi_drums(path: Path) -> list[tuple[float, int]]:
    out, t = [], 0.0
    for msg in mido.MidiFile(str(path)):
        t += msg.time
        if msg.type == "note_on" and msg.velocity > 0 and msg.channel == 9:
            out.append((t, msg.note))
    return out


def keyed_f1(ours: list[tuple[float, object]], ref: list[tuple[float, object]]) -> float:
    """같은 키끼리 시각을 앞에서부터 TOL_SEC 안 1:1로 짝지은 F1. 둘 다 비면 1."""
    a, b = defaultdict(list), defaultdict(list)
    for t, k in ours:
        a[k].append(t)
    for t, k in ref:
        b[k].append(t)
    tp = 0
    for k in set(a) & set(b):
        x, y = sorted(a[k]), sorted(b[k])
        i = j = 0
        while i < len(x) and j < len(y):
            d = x[i] - y[j]
            if abs(d) <= TOL_SEC:
                tp += 1
                i += 1
                j += 1
            elif d < 0:
                i += 1
            else:
                j += 1
    if not ours and not ref:
        return 1.0
    p = tp / len(ours) if ours else 0.0
    r = tp / len(ref) if ref else 0.0
    return 2 * p * r / (p + r) if p + r else 0.0


def to_pads(notes: list[tuple[float, int]]) -> list[tuple[float, str]]:
    out = []
    for t, gm in notes:
        pad = pad_of(gm)
        if pad is not None:
            out.append((t, "HIHAT" if pad == "HIHAT_PEDAL" else pad))
    return out


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--list", type=Path, required=True, help="곡 목록 CSV (file 열)")
    ap.add_argument("--pdmx", type=Path, required=True, help="PDMX 압축 푼 폴더 (mxl/·mid/)")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    config = SheetConfig()
    rows = []
    with open(args.list, encoding="utf-8-sig", newline="") as f:
        items = [r for r in csv.DictReader(f) if not r.get("error")]
    for item in items:
        rel = item["file"].lstrip("./")
        mxl = args.pdmx / rel
        mid = args.pdmx / rel.replace("mxl/", "mid/", 1).replace(".mxl", ".mid")
        row = {"file": item["file"], "song": item.get("song", "")}
        if not mid.is_file():
            continue
        ref = midi_drums(mid)
        try:
            score = parse_musicxml(mxl, config.default_bpm)
            out = convert_sheet(mxl, config)
        except ChartError as e:
            row |= {"error": f"[{e.code}] {e.message}"[:200], "gm_f1": 0.0, "pad_f1": 0.0}
            rows.append(row)
            print(row["song"][:30].ljust(30), "실패", row["error"], flush=True)
            continue
        ours = [(n.onset_sec, n.gm) for n in score.drum_notes]
        row |= {
            "error": "",
            "measures": f"{out.measures_written}→{out.measures_played}",
            "ours": len(ours),
            "ref": len(ref),
            "notes": out.n_notes,
            "gm_f1": round(keyed_f1(ours, ref), 4),
            "pad_f1": round(keyed_f1(to_pads(ours), to_pads(ref)), 4),
            "open_hihat": out.n_open_hihat,
            "pedal": out.n_hihat_pedal,
            "convert_ms": out.convert_ms,
        }
        rows.append(row)
        print(
            row["song"][:30].ljust(30),
            row["measures"].ljust(9),
            f"gm {row['gm_f1']:.3f} pad {row['pad_f1']:.3f}",
            flush=True,
        )
    args.out.mkdir(parents=True, exist_ok=True)
    keys = list(dict.fromkeys(k for r in rows for k in r))
    with open(args.out / "per_song.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        w.writerows(rows)
    gm = sorted(r["gm_f1"] for r in rows)
    pad = sorted(r["pad_f1"] for r in rows)
    ms = sorted(r["convert_ms"] for r in rows if not r["error"])
    n_err = sum(1 for r in rows if r["error"])
    print(
        f"곡 {len(rows)}, 변환 실패 {n_err}, GM 기준 F1≥{GOOD_F1} {sum(x >= GOOD_F1 for x in gm)}곡 "
        f"(중앙값 {gm[len(gm) // 2]:.3f}), 패드 기준 F1≥{GOOD_F1} {sum(x >= GOOD_F1 for x in pad)}곡 "
        f"(중앙값 {pad[len(pad) // 2]:.3f}), 변환 시간 중앙값 {ms[len(ms) // 2]}ms 최대 {ms[-1]}ms",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
