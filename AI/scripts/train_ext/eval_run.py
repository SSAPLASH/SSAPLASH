"""이어서 학습한 모델 하나를 검증 10곡으로 문턱값을 고른 뒤 시험 곡 다섯 묶음에서 채점 (11/11).

입력은 `strum_crnn.py dump`가 남긴 프레임별 점수(`--acts`의 <태그>/<목록>/<곡>.npz) 또는 이미 노트로 저장된 폴더(--notes-ready).
1. 점수 → 노트(`acts_to_notes.py`). 노트 폴더 이름은 태그
2. 모델 yaml을 `data/results/ext_notes/_models/<태그>.yaml`에 만듦(라벨 `<종류>/<패드>` → 패드)
3. `ext_rule_eval.py fit`: 검증 10곡으로 시각 옮기기·분류별 문턱값만 고름(라벨 대응은 그대로)
4. `ext_rule_eval.py run`: 시험 31곡·처음 보는 38곡·MDB·ENST 두 입력. 모델 혼자(map_off_thr)와 서비스 규칙에 넣은 것(five_rules)

  uv run python scripts/train_ext/eval_run.py --tag strum_p3_real --kind p3
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

import yaml

PADS = ("KICK", "SNARE", "HIHAT", "SMALL_TOM", "MID_TOM", "FLOOR_TOM", "CRASH", "RIDE")
D = "configs/bench/datasets"
# (목록 이름, 데이터셋 yaml, 저장 특징 폴더, ENST 라이드 옵션)
SETS = (
    ("test31", f"{D}/public_songs.yaml", "data/rule_features", False),
    ("holdout38", f"{D}/public_songs_holdout38.yaml", "data/rule_features", False),
    ("mdb", f"{D}/mdb_drums.yaml", "data/rule_features", False),
    ("enst", f"{D}/enst_minus_one.yaml", "data/rule_features", True),
    ("enst_sep", f"{D}/enst_minus_one_gain1.yaml", "data/rule_features_sep", True),
)


def sh(cmd: list[str]) -> str:
    out = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if out.returncode != 0:
        raise SystemExit(f"실패: {' '.join(cmd)}\n{out.stdout[-800:]}\n{out.stderr[-800:]}")
    return out.stdout


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--tag", required=True, help="acts 폴더 이름이자 노트 폴더 이름")
    ap.add_argument("--kind", default="p3", help="점수 종류. STRUM 8종 온셋은 p3")
    ap.add_argument("--acts", default="data/ext_train/acts")
    ap.add_argument("--manifests", default="data/ext_train")
    ap.add_argument("--notes", default="data/results/ext_notes")
    ap.add_argument(
        "--only", action="append", default=[], help="채점할 묶음 이름(여러 번). 비우면 전부"
    )
    ap.add_argument(
        "--notes-ready", action="store_true", help="노트가 이미 있음(점수 → 노트 변환을 건너뜀)"
    )
    args = ap.parse_args()
    py = [sys.executable]
    notes = Path(args.notes)
    model = notes / "_models" / f"{args.tag}.yaml"
    model.parent.mkdir(parents=True, exist_ok=True)
    labels = {f"{args.kind}/{p}": p for p in PADS}
    for name in () if args.notes_ready else ("val10", *(s[0] for s in SETS)):
        cmd = [*py, "scripts/train_ext/acts_to_notes.py", "--tag", args.tag, "--acts", args.acts,
               "--manifest", f"{args.manifests}/{name}.json", "--out", args.notes]  # fmt: skip
        print(sh(cmd).strip())
    model.write_text(
        yaml.safe_dump(
            {"name": args.tag, "notes_dir": args.tag, "labels": labels}, sort_keys=False
        ),
        encoding="utf-8",
    )
    params = notes / f"rules_{args.tag}.json"
    fit = [*py, "scripts/ext_rule_eval.py", "fit", "--dataset", f"{D}/public_songs_val.yaml",
           "--model", str(model), "--notes", args.notes, "--out", str(params), "--no-map"]  # fmt: skip
    print("\n".join(sh(fit).strip().splitlines()[-2:]))
    for name, ds, feats, enst in SETS:
        if args.only and name not in args.only:
            continue
        cmd = [*py, "scripts/ext_rule_eval.py", "run", "--dataset", ds, "--features", feats,
               "--model", str(model), "--notes", args.notes, "--params", str(params),
               "--out", str(notes / f"ft_{args.tag}_{name}.csv")]  # fmt: skip
        if enst:
            cmd.append("--enst-c1-ride")
        lines = sh(cmd).strip().splitlines()
        print(f"== {name}")
        for ln in lines:
            if ln.startswith(("곡 ", "current", "alone", "map_off_thr", "five_rules")):
                print(ln)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
