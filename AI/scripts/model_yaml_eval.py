"""채보 모델 yaml(서비스 어댑터 그대로)로 데이터셋을 채보해 곡마다 8패드 채점 (11/08).

저장 특징을 거치지 않고 어댑터의 transcribe를 곡마다 그대로 부르므로, 서비스 채보 모듈과 같은 계산임.
입력은 데이터셋의 drums_true(Songsterr·PDO는 서비스 분리 드럼, ENST·MDB는 녹음 드럼).
--separator를 주면 원곡을 그 분리 모델로 나눈 드럼을 입력으로 씀(곡마다 --sep-cache에 저장해 다시 씀).
출력 csv 한 줄 = (모델 이름, 곡): 8패드 tp/fp/fn와 채보 초. postproc_eval.py의 f1_of·bootstrap으로 읽음.
--loader 파일:클래스로 저장소에 없는 데이터셋 로더(예: PDO)를 이번 실행에만 등록할 수 있음.

  uv run python scripts/model_yaml_eval.py --dataset configs/bench/datasets/public_songs.yaml \
      --model configs/bench/transcribers/adtof_drumsep/adtof_drumsep.yaml \
      --model configs/bench/transcribers/adtof_drumsep/adtof_drumsep_songsterr_avg.yaml \
      --out data/results/model_yaml/test31.csv
"""

from __future__ import annotations

import argparse
import csv
import importlib.util
import time
from pathlib import Path

import numpy as np

SCORED = ("KICK", "SNARE", "HIHAT", "SMALL_TOM", "MID_TOM", "FLOOR_TOM", "CRASH", "RIDE")


def register_loader(spec: str) -> None:
    """'파일.py:클래스' 로더를 LOADERS에 등록."""
    from ssaplash_ai.bench.datasets import LOADERS

    path, _, cls_name = spec.rpartition(":")
    mod_spec = importlib.util.spec_from_file_location(Path(path).stem, path)
    mod = importlib.util.module_from_spec(mod_spec)
    mod_spec.loader.exec_module(mod)
    cls = getattr(mod, cls_name)
    LOADERS[cls.kind] = cls


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--model", action="append", required=True, help="채보 모델 yaml")
    ap.add_argument("--loader", action="append", default=[], help="추가 로더 '파일.py:클래스'")
    ap.add_argument("--enst-c1-ride", action="store_true")
    ap.add_argument(
        "--separator", default=None, help="분리 모델 yaml. 주면 원곡을 분리한 드럼을 입력으로 씀"
    )
    ap.add_argument("--sep-cache", type=Path, default=Path("data/results/model_yaml/sep_cache"))
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    if args.enst_c1_ride:
        import ssaplash_ai.bench.datasets.enst as enst

        enst.ENST_LABEL_PAD["c1"] = "RIDE"
        enst.ENST_LABEL_PAD["c4"] = "RIDE"
    for spec in args.loader:
        register_loader(spec)
    from ssaplash_ai.bench.datasets import DatasetConfig, load_dataset
    from ssaplash_ai.bench.metrics.hit_f1 import score_hits
    from ssaplash_ai.bench.transcribers import create_transcriber

    ds = load_dataset(DatasetConfig.from_yaml(args.dataset))
    songs = list(ds.song_ids())
    models = []
    for path in args.model:
        tr = create_transcriber(path, args.device)
        tr.load()
        models.append(tr)
    sep = None
    if args.separator:
        from ssaplash_ai.bench.separators import SeparatorConfig, create_separator

        sep = create_separator(SeparatorConfig.from_yaml(args.separator), args.device)
        sep.load()
        cache = args.sep_cache / sep.name / ds.name
        cache.mkdir(parents=True, exist_ok=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        w = None
        for sid in songs:
            item = ds.load(sid)
            truth = ds.hits_of(sid)[0]
            drums = np.asarray(item.drums_true, dtype=np.float32)
            if sep is not None:
                cpath = cache / f"{sid.replace('/', '__')}.npy"
                if cpath.is_file():
                    drums = np.load(cpath).astype(np.float32)
                else:
                    drums = sep.separate(item.mixture, item.sample_rate).drums.astype(np.float32)
                    np.save(cpath, drums.astype(np.float16))
            for tr in models:
                t0 = time.perf_counter()
                pred = tr.transcribe(drums, item.sample_rate, sid).hits_pred
                sec = time.perf_counter() - t0
                s = score_hits(truth, pred, "pads").by_label
                row = {"candidate": tr.name, "songId": sid}
                for p in SCORED:
                    c = s.get(p)
                    row[f"tp{p}"], row[f"fp{p}"], row[f"fn{p}"] = (
                        (c.tp, c.fp, c.fn) if c else (0, 0, 0)
                    )
                row["seconds"] = round(sec, 3)
                if w is None:
                    w = csv.DictWriter(fh, fieldnames=list(row), lineterminator="\n")
                    w.writeheader()
                w.writerow(row)
            print(f"[model_yaml] {sid}", flush=True)
    for tr in models:
        tr.close()
    if sep is not None:
        sep.close()
    print(f"[model_yaml] 저장 {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
