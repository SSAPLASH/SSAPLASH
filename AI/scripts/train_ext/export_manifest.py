"""STRUM CRNN 학습·채보용 곡 목록(manifest) 만들기 (11/11).

STRUM은 가상환경이 달라 `ssaplash_ai`를 못 부르므로, 곡마다 드럼 음원 경로·반주 경로·정답 노트를
파일로 풀어 둠. 학습 스크립트(`scripts/train_ext/strum_crnn.py`)는 이 json만 읽음.

- Songsterr 계열(kind: songsterr)은 곡 폴더의 `drums.flac`(서비스 분리 드럼)·`drumless.flac` 경로를 그대로 적음
- 그 밖(MDB·ENST 등)은 저장 특징의 input 트랙(서비스와 같은 입력)을 flac으로 써서 그 경로를 적음
- `--audio original`이면 데이터셋의 드럼 음원 파일 경로를 그대로 적음(E-GMD 학습 분할처럼 곡이 많을 때)
- 정답은 `<out>/labels/<데이터셋>/<곡>.npz`: time(초), pad(0~7, 아래 PADS 순서), velocity. 페달 하이햇은 하이햇으로 합침

  uv run python scripts/train_ext/export_manifest.py --dataset configs/bench/datasets/public_songs_train_full.yaml --name train457
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

PADS = ("KICK", "SNARE", "HIHAT", "SMALL_TOM", "MID_TOM", "FLOOR_TOM", "CRASH", "RIDE")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--name", required=True, help="목록 이름. <out>/<name>.json으로 저장")
    ap.add_argument("--features", default="data/rule_features", help="Songsterr가 아닌 곡의 입력")
    ap.add_argument("--out", type=Path, default=Path("data/ext_train"))
    ap.add_argument("--enst-c1-ride", action="store_true")
    ap.add_argument(
        "--audio",
        choices=("features", "original"),
        default="features",
        help="Songsterr가 아닌 곡의 음원. original은 데이터셋 드럼 파일 경로(required_files 첫 번째)",
    )
    args = ap.parse_args()

    import soundfile as sf

    if args.enst_c1_ride:
        import ssaplash_ai.bench.datasets.enst as enst

        enst.ENST_LABEL_PAD["c1"] = "RIDE"
        enst.ENST_LABEL_PAD["c4"] = "RIDE"
    # 서버 운영 코드가 오래된 판이어도 돌도록, 쓰는 모듈만 그때그때 불러옴
    from ssaplash_ai.bench.datasets import DatasetConfig, load_dataset

    cfg = DatasetConfig.from_yaml(args.dataset)
    ds = load_dataset(cfg)
    kind = str(cfg.kind)
    index = {p: i for i, p in enumerate(PADS)}
    songs = []
    for sid in ds.song_ids():
        safe = sid.replace("/", "__")
        if args.audio == "original" and kind != "songsterr":
            # 드럼 음원이나 정답 파일(앞의 두 개)이 없는 곡은 뺌. 반주는 쓰지 않으므로 없어도 됨
            if not all(Path(f).is_file() for f in ds.required_files(sid)[:2]):
                continue
        hits = ds.hits_of(sid)[0].copy()
        hits["pad"][hits["pad"] == "HIHAT_PEDAL"] = (
            "HIHAT"  # 8패드 채점과 같이 페달을 하이햇에 합침
        )
        keep = np.isin(hits["pad"], PADS)
        hits = hits[keep]
        label = args.out / "labels" / args.name / f"{safe}.npz"
        label.parent.mkdir(parents=True, exist_ok=True)
        np.savez(
            label,
            time=hits["time_sec"].astype(np.float64),
            pad=np.array([index[p] for p in hits["pad"]], dtype=np.int16),
            velocity=hits["velocity"].astype(np.int16),
        )
        accomp = None
        if kind == "songsterr":
            from ssaplash_ai.bench.datasets.songsterr import final_dir

            f = final_dir(Path(cfg.root) / sid)
            drums, accomp = f / "drums.flac", f / "drumless.flac"
            duration = sf.info(str(drums)).duration
        elif args.audio == "original":
            drums = ds.required_files(sid)[0]
            try:
                info = sf.info(str(drums))
            except Exception:  # 못 여는 파일은 뺌
                continue
            # 표본화 주파수가 달라도 넣음. 읽을 때 _common.read_mono가 바꿈
            duration = info.duration
        else:
            drums = args.out / "audio" / args.name / f"{safe}.flac"
            if not drums.is_file():
                from ssaplash_ai.bench.analysis.rule_features import feature_path, load_features

                feats = load_features(feature_path(Path(args.features), ds.name, sid))
                if "input" in feats.stems:
                    audio = np.atleast_2d(feats.stems["input"].astype(np.float32))
                else:
                    audio = np.atleast_2d(ds.load(sid).drums_true.astype(np.float32))
                drums.parent.mkdir(parents=True, exist_ok=True)
                sf.write(drums, audio.mean(axis=0), feats.sample_rate, subtype="PCM_16")
            duration = sf.info(str(drums)).duration
        songs.append(
            {
                "song_id": sid,
                "drums": str(Path(drums).resolve()),
                "accomp": str(Path(accomp).resolve()) if accomp else None,
                "labels": str(label.resolve()),
                "duration": float(duration),
                "n_hits": int(len(hits)),
            }
        )
    out = args.out / f"{args.name}.json"
    out.write_text(
        json.dumps({"name": args.name, "dataset": ds.name, "pads": PADS, "songs": songs}, indent=1),
        encoding="utf-8",
    )
    hours = sum(s["duration"] for s in songs) / 3600
    print(f"[manifest] {args.name} 곡 {len(songs)} {hours:.1f}시간 → {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
