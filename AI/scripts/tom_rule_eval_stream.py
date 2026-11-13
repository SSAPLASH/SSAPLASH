"""탐 그룹 규칙 후보를 곡 하나씩 읽어 채점.

rule-eval(`ssaplash-bench rule-eval`)은 데이터셋 특징을 전부 메모리에 올린 뒤 후보를 돌린다. E-GMD test 1,170개는
분리 트랙 6개가 22.7시간 분량이라 로컬 메모리(64GB)에 다 안 올라감. 이 스크립트는 곡마다 특징을 읽고 후보 전부를
같은 rule_eval.eval_song으로 채점한 뒤 버림. 곡별 개수는 rule-eval by_song.csv와 같은 계산이다.

- 분리 입력 특징(`scripts/rule_features_separated.py`로 만든 것, stem_input 있음)은 그 분리 드럼을 거르기 입력으로 씀. 없으면 데이터셋의
  정답 드럼 트랙을 씀(rule-eval과 같음)
- 출력 csv 한 줄 = (후보, 곡). 키트 이름(E-GMD·STAR)과 정답 탐 종류 수를 같이 적음

  uv run python scripts/tom_rule_eval_stream.py --dataset configs/bench/datasets/egmd_test_acoustic.yaml \
      --features data/rule_features --candidates docs/.../candidates_part1.yaml --two-tom-upper MID_TOM \
      --workers 16 --out data/results/tom-rule-retune/egmd_test.csv
"""

from __future__ import annotations

import argparse
import csv
import os
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np

TOM_PADS = ("SMALL_TOM", "MID_TOM", "FLOOR_TOM")
# rule_features.INPUT_STEM과 같은 값. 서버 운영 코드(6023e0e)에는 이 상수가 없어 여기서 정함
INPUT_STEM = "input"
_STATE: dict = {}


def _init(
    dataset_yaml: str, features_root: str, candidates: list, two_tom_upper: str | None
) -> None:
    from ssaplash_ai.bench.datasets import DatasetConfig, load_dataset

    _STATE.update(
        dataset=load_dataset(DatasetConfig.from_yaml(dataset_yaml)),
        features_root=Path(features_root),
        candidates=candidates,
        two_tom_upper=two_tom_upper,
    )


def song_rows(song_id: str) -> list[dict]:
    """곡 하나 × 후보 전부 → csv 줄 목록"""
    from ssaplash_ai.bench.analysis.rule_eval import eval_song, rename_two_tom_upper
    from ssaplash_ai.bench.analysis.rule_features import (
        feature_path,
        input_as_feature,
        load_features,
    )
    from ssaplash_ai.bench.datasets.pads import SCORED_PADS

    ds = _STATE["dataset"]
    path = feature_path(_STATE["features_root"], ds.name, song_id)
    if not path.is_file():
        raise FileNotFoundError(f"특징 파일 없음: {path}")
    hits_true, _ = ds.hits_of(song_id)
    if _STATE["two_tom_upper"]:
        hits_true = rename_two_tom_upper(hits_true, _STATE["two_tom_upper"])
    feats = load_features(path)
    if INPUT_STEM in feats.stems:
        feats.input_audio = feats.stems.pop(INPUT_STEM).astype(np.float16)
    else:
        feats.input_audio = input_as_feature(ds.load(song_id).drums_true)
    kit = ds.kit_of(song_id) if hasattr(ds, "kit_of") else ""
    n_kinds = len({str(p) for p in hits_true["pad"] if str(p) in TOM_PADS})
    rows = []
    for cand in _STATE["candidates"]:
        ev = eval_song(song_id, feats, hits_true, cand["rules"])
        row = {
            "candidate": cand["name"],
            "dataset": ds.name,
            "songId": song_id,
            "kit": kit,
            "tomTrueKinds": n_kinds,
            "tomMatched": ev.tom.matched,
            "tomCorrect": ev.tom.correct,
            "tomFalseKept": ev.tom.false_kept,
            "tomMissed": ev.tom.missed,
            "tomClusters": ev.tom_clusters,
            "tomClusterHz": ev.tom_cluster_hz,
        }
        for p in SCORED_PADS:
            c = ev.pads.get(p)
            row[f"tp{p}"], row[f"fp{p}"], row[f"fn{p}"] = (c.tp, c.fp, c.fn) if c else (0, 0, 0)
        rows.append(row)
    return rows


def load_candidates(paths: list[Path]) -> list[dict]:
    from ssaplash_ai.bench.analysis.rule_eval import load_candidates as _load

    return [{"name": c.name, "rules": c.rules} for c in _load(paths)]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dataset", required=True, help="데이터셋 yaml (정답용)")
    ap.add_argument("--features", default="data/rule_features", help="rule-features 출력 폴더")
    ap.add_argument("--candidates", nargs="+", type=Path, required=True, help="후보 yaml")
    ap.add_argument("--two-tom-upper", choices=["MID_TOM", "SMALL_TOM"], default=None)
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) // 2))
    ap.add_argument("--limit", type=int, default=None, help="앞에서 이만큼 곡만 (확인용)")
    ap.add_argument("--out", type=Path, required=True, help="출력 csv")
    args = ap.parse_args()
    from ssaplash_ai.bench.datasets import DatasetConfig, load_dataset

    cands = load_candidates(args.candidates)
    songs = load_dataset(DatasetConfig.from_yaml(args.dataset)).song_ids()
    if args.limit:
        songs = songs[: args.limit]
    print(f"[tom-rule] 곡 {len(songs)}개 × 후보 {len(cands)}개, 작업 {args.workers}", flush=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    init = (args.dataset, args.features, cands, args.two_tom_upper)
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        writer = None

        def write(i: int, rows: list[dict]) -> None:
            nonlocal writer
            if writer is None:
                writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
                writer.writeheader()
            writer.writerows(rows)
            if i % 50 == 0 or i == len(songs):
                print(f"[tom-rule] {i}/{len(songs)}곡 ({time.time() - t0:.0f}초)", flush=True)

        if args.workers <= 1:
            # 작업 1개면 프로세스를 안 띄움 (테스트처럼 파일 경로로 불러온 모듈도 돌게)
            _init(*init)
            for i, song in enumerate(songs, 1):
                write(i, song_rows(song))
        else:
            with Pool(args.workers, initializer=_init, initargs=init) as pool:
                for i, rows in enumerate(pool.imap_unordered(song_rows, songs), 1):
                    write(i, rows)
    print(f"[tom-rule] 저장 {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
