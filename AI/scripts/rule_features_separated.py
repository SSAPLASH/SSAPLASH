"""원곡을 분리 모델로 나눈 드럼을 입력으로 채보 특징을 저장.

`ssaplash-bench rule-features`는 데이터셋의 정답 드럼 트랙을 입력으로 씀. 서비스처럼 반주가 섞인 원곡에서 시작한
경우를 보려고, 원곡(mixture)을 분리 모델로 나눈 드럼을 채보 모델에 넣고 같은 특징 파일을 만듦. 채보에 넣은 분리
드럼은 `stem_input`(모노 float16)으로 같이 저장하고, `tom_rule_eval_stream.py`·`adtof_ckpt_eval.py`는 이 트랙을
거르기 입력으로 씀. 이미 있는 곡은 건너뜀. 서버 운영 코드에 `rule-features --separator`가 없어 스크립트로 둠.

  uv run python scripts/rule_features_separated.py --separator configs/bench/models/msst/bs_roformer_sw.yaml \
      --dataset configs/bench/datasets/enst_minus_one_gain1.yaml --out data/rule_features_sep
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import numpy as np

INPUT_STEM = "input"
TRANSCRIBER = "configs/bench/transcribers/adtof_drumsep/adtof_drumsep.yaml"


def build(dataset, separator, transcriber, root: Path, log=print) -> tuple[int, int, int]:
    """곡마다 분리 → 특징 → 저장. (저장, 건너뜀, 실패) 개수."""
    from ssaplash_ai.bench.analysis import rule_features as rf
    from ssaplash_ai.bench.transcribers.transcriber_base import to_mono

    saved = failed = 0
    songs = dataset.song_ids()
    todo = [s for s in songs if not rf.feature_path(root, dataset.name, s).is_file()]
    for song_id in todo:
        start = time.perf_counter()
        try:
            song = dataset.load(song_id)
            drums = separator.separate(song.mixture, song.sample_rate).drums
            f = rf.features_from_adapter(transcriber, drums, song.sample_rate)
            f.stems[INPUT_STEM] = to_mono(np.asarray(drums)).astype(rf.STEM_DTYPE)
            rf.save_features(rf.feature_path(root, dataset.name, song_id), f)
            saved += 1
            log(f"[rule-features] {song_id} ({time.perf_counter() - start:.1f}s)")
        except Exception as exc:  # 곡 하나 실패는 기록하고 다음 곡
            failed += 1
            log(f"[rule-features] {song_id}: 실패 {type(exc).__name__}: {exc}")
    return saved, len(songs) - len(todo), failed


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--separator", required=True, help="분리 모델 yaml (configs/bench/models/...)")
    ap.add_argument("--dataset", required=True, help="데이터셋 yaml (원곡과 정답이 있는 것)")
    ap.add_argument("--out", required=True, type=Path, help="특징 폴더. 아래에 데이터셋 폴더")
    ap.add_argument("--model", default=TRANSCRIBER, help="채보 모델 yaml (adtof_drumsep)")
    ap.add_argument("--device", default="cuda")
    args = ap.parse_args()
    from ssaplash_ai.bench.datasets import DatasetConfig, load_dataset
    from ssaplash_ai.bench.separators import SeparatorConfig, create_separator
    from ssaplash_ai.bench.transcribers import TranscriberConfig, create_transcriber

    ds = load_dataset(DatasetConfig.from_yaml(args.dataset))
    tr = create_transcriber(TranscriberConfig.from_yaml(args.model), args.device)
    sep = create_separator(SeparatorConfig.from_yaml(args.separator), args.device)
    try:
        print(
            f"[rule-features] 채보 로드 {tr.load():.1f}s, 분리 {sep.name} 로드 {sep.load():.1f}s",
            flush=True,
        )
        saved, skipped, failed = build(ds, sep, tr, args.out, log=lambda m: print(m, flush=True))
    finally:
        tr.close()
        sep.close()
    # ssaplash-bench rule-features와 같은 끝 줄 (서버 노트북 진행 확인이 이 줄을 셈)
    print(
        f"{Path(args.dataset).stem}: 저장 {saved}개, 건너뜀 {skipped}개, 실패 {failed}개",
        flush=True,
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
