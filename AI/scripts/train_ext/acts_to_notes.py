"""프레임별 점수(acts)를 봉우리 찾기로 노트로 바꿔 ext_notes 형식으로 저장 (11/11).

`strum_crnn.py dump`가 `data/ext_train/acts/<태그>/<목록>/<곡>.npz`를 남김(_common.save_acts).
이 스크립트는 점수 종류(acts_<종류>)마다 분류별 봉우리를 찾아 `<out>/<이름>/<데이터셋>/<곡>.npz`에
onset·label(`<종류>/<분류 이름>`)·velocity(봉우리 점수 × 1000)를 씀. 그 뒤 채점은 ext_rule_eval.py.
낮은 점수(--floor)까지 남겨 두고 문턱값은 ext_rule_eval fit이 고름.

  uv run python scripts/train_ext/acts_to_notes.py --tag strum_p3 --manifest data/ext_train/val10.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from scipy.signal import find_peaks


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--tag", required=True, help="acts 폴더 이름")
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--name", default=None, help="노트 폴더 이름(모델 yaml의 name). 기본은 태그")
    ap.add_argument("--acts", type=Path, default=Path("data/ext_train/acts"))
    ap.add_argument("--out", type=Path, default=Path("data/results/ext_notes"))
    ap.add_argument("--floor", type=float, default=0.1, help="이 점수 미만 봉우리는 버림")
    ap.add_argument("--gap-ms", type=float, default=30.0, help="같은 분류 봉우리 최소 간격")
    args = ap.parse_args()

    meta = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    name = args.name or args.tag
    done = 0
    for song in meta["songs"]:
        file = f"{song['song_id'].replace('/', '__')}.npz"
        src = args.acts / args.tag / meta["name"] / file
        if not src.is_file():
            continue
        z = np.load(src)
        fps = float(z["fps"])
        names = [str(x) for x in z["names"]]
        gap = max(1, int(round(args.gap_ms / 1000 * fps)))
        onset, label, score = [], [], []
        for key in z.files:
            if not key.startswith("acts_"):
                continue
            acts = z[key].astype(np.float32)
            for ci, cname in enumerate(names):
                peaks, props = find_peaks(acts[:, ci], height=args.floor, distance=gap)
                onset.extend((peaks / fps).tolist())
                label.extend([f"{key[5:]}/{cname}"] * len(peaks))
                score.extend(np.rint(props["peak_heights"] * 1000).astype(int).tolist())
        order = np.argsort(onset, kind="stable")
        dst = args.out / name / meta["dataset"] / file
        dst.parent.mkdir(parents=True, exist_ok=True)
        np.savez(
            dst,
            onset=np.array(onset, dtype=np.float64)[order],
            label=np.array(label, dtype="U24")[order],
            velocity=np.array(score, dtype=np.int32)[order],
            seconds=float(z["seconds"]) if "seconds" in z.files else 0.0,
            duration=float(song["duration"]),
            checkpoint=str(z["checkpoint"]) if "checkpoint" in z.files else "",
        )
        done += 1
    print(f"[acts_to_notes] {name} {meta['name']} 곡 {done}/{len(meta['songs'])}")
    return 0 if done else 1


if __name__ == "__main__":
    raise SystemExit(main())
