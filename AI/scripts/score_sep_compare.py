"""드럼 분리 입력 채보 모델 비교표.

GPU 서버에서 run-transcription `--save-midi`로 남긴 곡별 예측 MIDI를 읽어
세 후보를 같은 곡 목록·같은 기준(9패드, ±50ms)으로 채점함.

- 현재 사용 중 모델: 원래 ADTOF + 드럼 킷 분리(`adtof_drumsep.yaml`). 2026-11-02 당시 서비스 모델이고
  표의 이름은 그때 것을 그대로 둠
- 실제 녹음 학습 모델: ENST·MDB를 더해 학습한 모델. 학습에 쓴 곡을 채점하면 안 되므로, 드러머·곡 묶음을
  하나씩 빼고 학습한 버전 3개(`realrec_heldout_d1~3`)로 각자 안 본 곡만 채점해 합침
- 조합: 탐 3종은 현재 사용 중 모델, 나머지 패드는 실제 녹음 학습 모델 예측을 씀
- 조합 + 심벌 7클래스: 위 조합에서 크래시·라이드만 7클래스 모델(`adtof_drumsep_ft7.yaml`) 예측으로 바꿈.
  결과 폴더에 `cym7_*` run이 있을 때만 표에 넣음
- 조합 + 심벌 7클래스 실제 녹음: 크래시·라이드만 7클래스에 실제 녹음을 더해 학습한 모델로 바꿈. 곡마다 그 곡을
  학습에 안 쓴 버전(`cym7real_heldout_d1~3`)으로 채점. 결과 폴더에 `cym7real_*` run이 있을 때만 표에 넣음

  uv run python scripts/score_sep_compare.py --results data/results/sep_compare --out data/results/sep_compare/compare.md
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import yaml

from ssaplash_ai.bench.datasets import load_dataset
from ssaplash_ai.bench.datasets.pads import HITS_DTYPE, PADS
from ssaplash_ai.bench.metrics.hit_f1 import f1_from_counts, score_hits
from ssaplash_ai.bench.transcribers.transcriber_base import GM_PAD_PITCH, midi_raw_hits

TOM_PADS = ("SMALL_TOM", "MID_TOM", "FLOOR_TOM")
# 저장 피치 → 패드. 거친 라벨(tom·cymbal)은 8패드 예측에 없으므로 뺌
PITCH_PAD = {p: pad for pad, p in GM_PAD_PITCH.items() if pad in PADS}
CURRENT = "current"
REALREC = "realrec"
COMBO = "combo"
COMBO_CYM = "combo_cym7"
COMBO_CYM_REAL = "combo_cym7real"
CYMBAL_PADS = ("CRASH", "RIDE")
NAMES = {
    CURRENT: "현재 사용 중 모델",
    REALREC: "실제 녹음 학습 모델",
    COMBO: "조합: 탐만 현재 모델",
    COMBO_CYM: "조합 + 심벌 7클래스",
    COMBO_CYM_REAL: "조합 + 심벌 7클래스 실제 녹음",
}
PAD_KO = {
    "KICK": "킥",
    "SNARE": "스네어",
    "HIHAT": "하이햇",
    "HIHAT_PEDAL": "하이햇 페달",
    "SMALL_TOM": "스몰탐",
    "MID_TOM": "미드탐",
    "FLOOR_TOM": "플로어탐",
    "CRASH": "크래시",
    "RIDE": "라이드",
}
# 데이터셋 → (현재 모델 run, 실제 녹음 학습 run 이름 틀, 채점용 데이터셋 yaml)
DATASETS = {
    "mdb_drums": ("current_mdb", "realrec_mdb_d{k}", "configs/bench/datasets/mdb_drums.yaml"),
    "enst_minus_one": (
        "current_enst",
        "realrec_enst_d{k}",
        "configs/bench/datasets/enst_minus_one.yaml",
    ),
}
# 데이터셋 → 7클래스 모델 run
CYM7_RUNS = {"mdb_drums": "cym7_mdb", "enst_minus_one": "cym7_enst"}
# 데이터셋 → 7클래스 실제 녹음 학습 run 이름 틀(묶음 번호 k)
CYM7REAL_TPL = {"mdb_drums": "cym7real_mdb_d{k}", "enst_minus_one": "cym7real_enst_d{k}"}


def read_midi_hits(path: Path) -> np.ndarray:
    """예측 MIDI → 타격 표. 모르는 피치는 오류"""
    rows = []
    for t, pitch, vel in midi_raw_hits(path):
        if pitch not in PITCH_PAD:
            raise ValueError(f"{path}: 모르는 피치 {pitch}")
        rows.append((t, PITCH_PAD[pitch], vel))
    out = np.array(rows, dtype=HITS_DTYPE) if rows else np.zeros(0, dtype=HITS_DTYPE)
    return np.sort(out, order="time_sec")


def combine(current: np.ndarray, realrec: np.ndarray) -> np.ndarray:
    """탐 3종은 현재 모델에서, 나머지는 실제 녹음 학습 모델에서 가져와 합침"""
    out = np.concatenate(
        [current[np.isin(current["pad"], TOM_PADS)], realrec[~np.isin(realrec["pad"], TOM_PADS)]]
    )
    return np.sort(out, order="time_sec")


def replace_cymbals(base: np.ndarray, cym: np.ndarray) -> np.ndarray:
    """base의 크래시·라이드를 지우고 cym의 크래시·라이드로 바꿈"""
    out = np.concatenate(
        [base[~np.isin(base["pad"], CYMBAL_PADS)], cym[np.isin(cym["pad"], CYMBAL_PADS)]]
    )
    return np.sort(out, order="time_sec")


def song_midis(run_dir: Path) -> dict[str, Path]:
    """run 폴더의 midi/<모델>/<곡>.mid → {곡: 경로}. 모델 폴더는 run마다 하나"""
    models = [d for d in (run_dir / "midi").iterdir() if d.is_dir()]
    if len(models) != 1:
        raise ValueError(f"{run_dir}: midi 아래 모델 폴더가 하나가 아님 {models}")
    return {
        p.relative_to(models[0]).with_suffix("").as_posix(): p for p in models[0].rglob("*.mid")
    }


def score_dataset(
    results: Path, name: str, held: dict[int, set[str]]
) -> tuple[dict, int, list[str]]:
    """데이터셋 하나 → {후보: {패드: [tp, fp, fn]}}, 채점한 곡 수, 빠진 곡"""
    current_run, realrec_tpl, ds_yaml = DATASETS[name]
    ds = load_dataset(ds_yaml)
    cur = song_midis(results / current_run)
    real: dict[str, Path] = {}
    for k, songs in held.items():
        midis = song_midis(results / realrec_tpl.format(k=k))
        real.update({s: p for s, p in midis.items() if s in songs})
    cym_dir = results / CYM7_RUNS[name]
    cym = song_midis(cym_dir) if cym_dir.is_dir() else None
    cym_real: dict[str, Path] | None = None
    if all((results / CYM7REAL_TPL[name].format(k=k)).is_dir() for k in held):
        cym_real = {}
        for k, songs in held.items():
            midis = song_midis(results / CYM7REAL_TPL[name].format(k=k))
            cym_real.update({s: p for s, p in midis.items() if s in songs})
    cands = [
        c
        for c in NAMES
        if (c != COMBO_CYM or cym is not None) and (c != COMBO_CYM_REAL or cym_real is not None)
    ]
    counts = {c: {p: [0, 0, 0] for p in PADS} for c in cands}
    missing, n = [], 0
    for song in ds.song_ids():
        if (
            song not in cur
            or song not in real
            or (cym is not None and song not in cym)
            or (cym_real is not None and song not in cym_real)
        ):
            missing.append(song)
            continue
        truth, _ = ds.hits_of(song)
        a, b = read_midi_hits(cur[song]), read_midi_hits(real[song])
        preds = [(CURRENT, a), (REALREC, b), (COMBO, combine(a, b))]
        if cym is not None:
            preds.append((COMBO_CYM, replace_cymbals(combine(a, b), read_midi_hits(cym[song]))))
        if cym_real is not None:
            preds.append(
                (COMBO_CYM_REAL, replace_cymbals(combine(a, b), read_midi_hits(cym_real[song])))
            )
        for cand, pred in preds:
            s = score_hits(truth, pred, "pads9")
            for pad, m in s.by_label.items():
                counts[cand][pad] = [
                    x + y for x, y in zip(counts[cand][pad], (m.tp, m.fp, m.fn), strict=True)
                ]
        n += 1
    return counts, n, missing


def held_out_songs(folds_path: Path, name: str) -> dict[int, set[str]]:
    """묶음 번호 → 그 버전이 학습에 안 쓴 곡. ENST는 드러머 접두어로 고름(곡 목록은 데이터셋에서)"""
    folds = yaml.safe_load(folds_path.read_text(encoding="utf-8"))
    if name == "mdb_drums":
        return {int(k): set(v) for k, v in folds["mdb_folds"].items()}
    ds = load_dataset(DATASETS[name][2])
    return {k: {s for s in ds.song_ids() if s.startswith(f"drummer_{k}/")} for k in (1, 2, 3)}


def cell(tp_fp_fn: list[int]) -> str:
    """정답·예측이 둘 다 없는 패드는 점수 없음(—)"""
    return f"{f1_from_counts(*tp_fp_fn):.3f}" if sum(tp_fp_fn) else "—"


def table(counts: dict, n: int, title: str) -> list[str]:
    names = {c: NAMES[c] for c in counts}
    lines = [
        f"## {title} ({n}곡)",
        "",
        "| 패드 | " + " | ".join(names.values()) + " |",
        "| --- |" + " --- |" * len(names),
    ]
    for pad in PADS:
        lines.append(f"| {PAD_KO[pad]} | " + " | ".join(cell(counts[c][pad]) for c in names) + " |")
    total = {c: [sum(counts[c][p][i] for p in PADS) for i in range(3)] for c in names}
    lines.append(
        "| 9패드 전체 | " + " | ".join(f"**{f1_from_counts(*total[c]):.3f}**" for c in names) + " |"
    )
    lines.append("")
    return lines


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--results", type=Path, required=True, help="서버 결과 폴더(아래에 run 폴더들)")
    ap.add_argument("--folds", type=Path, default=Path("configs/train/real_check/folds.yaml"))
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    lines = [
        "# 드럼 분리 입력 채보 모델 비교",
        "",
        "입력 BS-Roformer SW로 뽑은 드럼 · F1 ±50ms · 9패드(8패드 + 하이햇 페달) · 규칙 pk_gap30 + 크래시 가중치 0.7. "
        "실제 녹음 학습 모델은 곡마다 그 곡을 학습에 안 쓴 버전으로 채점함. ENST 정답에는 하이햇 페달 표시가 없어 "
        "페달 예측은 전부 틀린 것으로 세어짐.",
        "",
    ]
    for name, title in (("mdb_drums", "MDB Drums"), ("enst_minus_one", "ENST 반주 곡")):
        counts, n, missing = score_dataset(args.results, name, held_out_songs(args.folds, name))
        lines += table(counts, n, title)
        if missing:
            lines += [f"예측이 없어 뺀 곡 {len(missing)}개: {', '.join(missing)}", ""]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print("\n".join(lines))
    print(f"결과 → {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
