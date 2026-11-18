"""노래 파일 채보에 하이햇 페달을 붙이는 방법 비교.

GPU 서버에서 run-transcription `--save-midi`로 남긴 곡별 예측 MIDI(서비스와 같은 BS-Roformer SW 드럼 입력)를 읽어,
현재 사용 중 모델(원래 ADTOF + 드럼 킷 분리, 2026-11-05 당시 서비스 모델)의 HIHAT 노트에 실제 녹음 학습 모델의 HIHAT_PEDAL 예측을 붙이는 방법들을 같은 곡·같은 기준
(9패드, ±50ms)으로 채점함. 실제 녹음 학습 모델은 곡마다 그 곡을 학습에 안 쓴 버전(`realrec_*_d1~3`)만 씀.

- 현재 사용 중 모델: 페달을 내지 않음
- 이름 바꾸기: 현재 모델 HIHAT 노트에서 window 안에 실제 녹음 학습 모델 페달 예측이 있으면 HIHAT_PEDAL로 바꿈
- 이름 바꾸기 + 하이햇 확인: 위에서 실제 녹음 학습 모델도 그 근처에 HIHAT을 안 냈을 때만 바꿈
- 페달 넣고 하이햇 지우기: 실제 녹음 학습 모델 페달 예측을 넣고 window 안의 현재 모델 HIHAT을 지움

ENST는 페달만 밟은 하이햇도 닫힌 하이햇과 같은 chh로 적어서 정답에 페달이 없음. ENST에서 나온 페달은 모두 틀린
것으로 세지만 실제 페달 소리일 수 있어 참고용. 페달 점수는 MDB로만 봄.

  uv run python scripts/score_pedal_relabel.py --results data/results/sep_compare --out data/results/pedal-relabel.md
"""

from __future__ import annotations

import argparse
from collections.abc import Callable
from pathlib import Path

import numpy as np
from score_sep_compare import DATASETS, held_out_songs, read_midi_hits, song_midis

from ssaplash_ai.bench.datasets import load_dataset
from ssaplash_ai.bench.datasets.pads import PADS, PEDAL
from ssaplash_ai.bench.metrics.hit_f1 import f1_from_counts, score_hits

HIHAT = "HIHAT"
DATASET_KO = {"mdb_drums": "MDB Drums", "enst_minus_one": "ENST 반주 곡"}

Method = Callable[[np.ndarray, np.ndarray], tuple[np.ndarray, int]]


def _times(hits: np.ndarray, pad: str) -> np.ndarray:
    return np.sort(hits["time_sec"][hits["pad"] == pad])


def near(t: float, times: np.ndarray, window: float) -> bool:
    """정렬된 times에 t와 window초 안인 값이 있으면 참"""
    i = int(np.searchsorted(times, t))
    return any(0 <= j < times.size and abs(times[j] - t) <= window for j in (i - 1, i))


def relabel(
    current: np.ndarray, realrec: np.ndarray, window: float, check_hihat: bool
) -> tuple[np.ndarray, int]:
    """현재 모델 HIHAT 중 페달 예측이 가까운 것을 HIHAT_PEDAL로 바꾼 복사본과 바꾼 수"""
    pedal, hihat = _times(realrec, PEDAL), _times(realrec, HIHAT)
    out = current.copy()
    n = 0
    for i in np.flatnonzero(out["pad"] == HIHAT):
        t = float(out["time_sec"][i])
        if near(t, pedal, window) and not (check_hihat and near(t, hihat, window)):
            out["pad"][i] = PEDAL
            n += 1
    return out, n


def add_and_remove(
    current: np.ndarray, realrec: np.ndarray, window: float
) -> tuple[np.ndarray, int]:
    """페달 예측을 넣고 그 근처 현재 모델 HIHAT을 지운 표와 지운 수"""
    pedal_hits = realrec[realrec["pad"] == PEDAL]
    pedal = np.sort(pedal_hits["time_sec"])
    drop = np.array(
        [
            p == HIHAT and near(float(t), pedal, window)
            for t, p in zip(current["time_sec"], current["pad"], strict=True)
        ],
        dtype=bool,
    )
    out = np.sort(np.concatenate([current[~drop], pedal_hits]), order="time_sec")
    return out, int(drop.sum())


METHODS: dict[str, Method] = {
    "현재 사용 중 모델": lambda a, b: (a, 0),
    "이름 바꾸기 30ms": lambda a, b: relabel(a, b, 0.03, False),
    "이름 바꾸기 50ms": lambda a, b: relabel(a, b, 0.05, False),
    "이름 바꾸기 30ms + 하이햇 확인": lambda a, b: relabel(a, b, 0.03, True),
    "페달 넣고 하이햇 지우기 50ms": lambda a, b: add_and_remove(a, b, 0.05),
}


def score_dataset(results: Path, folds: Path, name: str) -> list[str]:
    """데이터셋 하나의 표 줄"""
    current_run, realrec_tpl, ds_yaml = DATASETS[name]
    ds = load_dataset(ds_yaml)
    current = song_midis(results / current_run)
    realrec: dict[str, Path] = {}
    for k, songs in held_out_songs(folds, name).items():
        midis = song_midis(results / realrec_tpl.format(k=k))
        realrec.update({s: p for s, p in midis.items() if s in songs})
    counts = {m: {p: [0, 0, 0] for p in PADS} for m in METHODS}
    changed = dict.fromkeys(METHODS, 0)
    n_songs = n_truth_pedal = n_current_hihat = 0
    for song in ds.song_ids():
        if song not in current or song not in realrec:
            continue
        truth, _ = ds.hits_of(song)
        a, b = read_midi_hits(current[song]), read_midi_hits(realrec[song])
        n_truth_pedal += int((truth["pad"] == PEDAL).sum())
        n_current_hihat += int((a["pad"] == HIHAT).sum())
        for m, method in METHODS.items():
            pred, k = method(a, b)
            changed[m] += k
            for pad, s in score_hits(truth, pred, "pads9").by_label.items():
                counts[m][pad] = [
                    x + y for x, y in zip(counts[m][pad], (s.tp, s.fp, s.fn), strict=True)
                ]
        n_songs += 1
    lines = [
        f"## {DATASET_KO[name]} ({n_songs}곡, 정답 페달 {n_truth_pedal}타, 현재 모델 HIHAT {n_current_hihat}개)",
        "",
        "| 방법 | 바꾸거나 지운 노트 | 하이햇 F1 | 페달 정밀도 | 페달 재현율 | 페달 F1 | 페달 tp·fp·fn | 9패드 F1 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for m in METHODS:
        tp, fp, fn = counts[m][PEDAL]
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        # 정답·예측 페달이 둘 다 없으면 점수 없음(—)
        pedal_f1 = f"{f1_from_counts(tp, fp, fn):.3f}" if tp + fp + fn else "—"
        total = [sum(counts[m][p][i] for p in PADS) for i in range(3)]
        lines.append(
            f"| {m} | {changed[m]} | {f1_from_counts(*counts[m][HIHAT]):.3f} | {precision:.3f} | "
            f"{recall:.3f} | {pedal_f1} | {tp}·{fp}·{fn} | {f1_from_counts(*total):.3f} |"
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
        "# 노래 파일 채보 하이햇 페달 방법 비교",
        "",
        "입력 BS-Roformer SW로 뽑은 드럼 · F1 ±50ms · 9패드. 실제 녹음 학습 모델은 곡마다 그 곡을 학습에 안 쓴 버전.",
        "ENST는 페달만 밟은 하이햇도 닫힌 하이햇과 같은 chh로 적어서 정답에 페달이 없음. "
        "ENST에서 나온 페달은 모두 틀린 것으로 세지만 실제 페달 소리일 수 있어 참고용.",
        "",
    ]
    for name in DATASETS:
        lines += score_dataset(args.results, args.folds, name)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
