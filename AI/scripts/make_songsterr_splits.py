"""11/08 추가 공용 곡을 검증·학습 목록으로 나누고 학습 설정을 만듦.

- 시험 곡: configs/bench/datasets/public_songs.yaml(31곡)과 public_songs_holdout38.yaml(38곡).
  두 목록의 곡은 학습·검증에 넣지 않음
- 추가 곡 중 정렬 결과가 나쁜 곡(마디 시작을 실제 박에 붙인 비율 < 0.85)과 노트 < 300곡은 뺌
- 곡 폴더 이름의 sha1 순서로 앞 10곡은 검증, 나머지는 학습. 학습 곡 수 25·50·전부는 같은 순서의 앞부분이라 겹침
- 학습 설정: 5종 출력(25·50·전부), 8패드 출력(전부)

  uv run python scripts/make_songsterr_splits.py
  uv run python scripts/make_songsterr_splits.py --grow   # 11/09: 검증·기존 83곡 고정, 새 곡만 덧붙임
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import yaml

ROOT = Path("data/songsterr")
DS = Path("configs/bench/datasets")
TRAIN = Path("configs/train")
N_VAL = 10
MIN_BAR_SNAP = 0.85
MIN_NOTES = 300

TRAIN_BASE = {
    "base_checkpoint": None,
    "window_frames": 412,
    "batch_size": 32,
    "steps_per_epoch": 1000,
    "max_epochs": 6,
    "learning_rate": 0.0001,
    "lr_reduce_patience": 2,
    "early_stop_patience": 3,
    "label_radiation": 1,
    "class_weights": None,
    "tom_weight_mult": 2.0,
    "tom_window_frac": 0.5,
    "accomp_mix_prob": 0.3,
    "accomp_gain_range": [0.05, 0.3],
    "gain_db_range": [-6, 6],
    "freeze_cnn": False,
    "eval_every": 1,
    "select_metric": "f1",
    "guard_drop": 0.02,
    "fit_thresholds": True,
    # 곡 하나를 읽을 때마다 창을 많이 뽑아 flac 디코딩 시간을 줄임
    "windows_per_song": 64,
    "seed": 0,
    "num_workers": 4,
    "device": "cuda",
}


def final_dir(d: Path) -> Path:
    tm = d / "final_tempomap"
    return tm if (tm / "chart.json").is_file() else d / "final"


def usable(d: Path) -> tuple[bool, str]:
    f = final_dir(d)
    if not (f / "chart.json").is_file():
        return False, "정렬 없음"
    rep = (
        json.loads((f / "report.json").read_text(encoding="utf-8"))
        if (f / "report.json").is_file()
        else {}
    )
    snap = rep.get("마디 시작을 실제 박에 붙인 비율", 0.0)
    notes = len(json.loads((f / "chart.json").read_text(encoding="utf-8"))["charts"][0]["notes"])
    if snap < MIN_BAR_SNAP:
        return False, f"마디 정렬 {snap}"
    if notes < MIN_NOTES:
        return False, f"노트 {notes}"
    return True, ""


def write_ds(name: str, songs: list[str], note: str) -> Path:
    path = DS / f"{name}.yaml"
    body = {"name": name, "kind": "songsterr", "root": str(ROOT).replace("\\", "/"), "sample_rate": 44100,
            "clip": None, "songs": songs}  # fmt: skip
    path.write_text(
        f"# {note}\n" + yaml.safe_dump(body, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
        newline="\n",
    )
    return path


def read_songs(name: str) -> list[str]:
    return yaml.safe_load((DS / name).read_text(encoding="utf-8"))["songs"]


def grow() -> int:
    """11/09 새 곡 추가: 검증 10곡·기존 학습 83곡은 그대로 두고 새 곡만 덧붙임.

    새 곡은 폴더 이름 sha1 순서. 학습 150곡 = 기존 83곡 + 새 곡 앞부분, full = 기존 83곡 + 새 곡 전부.
    기존 25·50·all 목록과 설정은 건드리지 않음.
    """
    test = set(read_songs("public_songs.yaml")) | set(read_songs("public_songs_holdout38.yaml"))
    val = read_songs("public_songs_val.yaml")
    base = read_songs("public_songs_train_all.yaml")
    fixed = test | set(val) | set(base)
    cands = sorted(
        p.name
        for p in ROOT.iterdir()
        if p.is_dir() and (p / "raw/meta.json").is_file() and p.name not in fixed
    )
    ok, dropped = [], {}
    for name in cands:
        good, why = usable(ROOT / name)
        (ok.append(name) if good else dropped.__setitem__(name, why))
    ok.sort(key=lambda s: hashlib.sha1(s.encode()).hexdigest())
    sizes = {"150": base + ok[: max(0, 150 - len(base))], "full": base + ok}
    head = "# 11/09 새 곡 추가 학습. 검증 10곡은 11/08 것 그대로. scripts/make_songsterr_splits.py --grow가 만듦\n"
    for k, songs in sizes.items():
        write_ds(
            f"public_songs_train_{k}",
            sorted(songs),
            f"11/09 학습 {len(songs)}곡 = 11/08 학습 {len(base)}곡 + 11/09 새 곡 {len(songs) - len(base)}곡(sha1 순서). scripts/make_songsterr_splits.py --grow",
        )
        for classes, guard in (("five", 0.02), ("pads", 1.0)):
            cfg = {"classes": classes, **TRAIN_BASE, "guard_drop": guard,
                   "train_datasets": [{"path": f"configs/bench/datasets/public_songs_train_{k}.yaml", "weight": 1.0}],
                   "val_datasets": [{"path": "configs/bench/datasets/public_songs_val.yaml", "n_songs": N_VAL}]}  # fmt: skip
            note = (
                "# guard_drop 1.0: 8패드 출력은 5종 기준 안전장치에 걸려서 끔 (11/08과 같음)\n"
                if classes == "pads"
                else ""
            )
            suffix = "_noguard" if classes == "pads" else ""
            (TRAIN / f"songsterr_{classes}_{k}{suffix}.yaml").write_text(
                head + note + yaml.safe_dump(cfg, allow_unicode=True, sort_keys=False),
                encoding="utf-8",
                newline="\n",
            )
    print(json.dumps({"새 후보": len(cands), "새로 쓸 곡": len(ok), "학습": {k: len(v) for k, v in sizes.items()},
                      "뺀 곡": dropped}, ensure_ascii=False, indent=1))  # fmt: skip
    return 0


def main() -> int:
    if "--grow" in sys.argv[1:]:
        return grow()
    # 시험 31곡과 확인용 처음 보는 곡은 학습·검증에 넣지 않음
    test = set()
    for name in ("public_songs.yaml", "public_songs_holdout38.yaml"):
        test |= set(yaml.safe_load((DS / name).read_text(encoding="utf-8"))["songs"])
    cands = sorted(
        p.name
        for p in ROOT.iterdir()
        if p.is_dir() and (p / "raw/meta.json").is_file() and p.name not in test
    )
    ok, dropped = [], {}
    for name in cands:
        good, why = usable(ROOT / name)
        (ok.append(name) if good else dropped.__setitem__(name, why))
    ok.sort(key=lambda s: hashlib.sha1(s.encode()).hexdigest())
    val, train = ok[:N_VAL], ok[N_VAL:]
    write_ds(
        "public_songs_val",
        sorted(val),
        "11/08 추가 공용 곡 중 검증 10곡 (에폭 고르기·문턱값). scripts/make_songsterr_splits.py",
    )
    sizes = {"25": train[:25], "50": train[:50], "all": train}
    for k, songs in sizes.items():
        write_ds(
            f"public_songs_train_{k}",
            sorted(songs),
            f"11/08 추가 공용 곡 학습 {len(songs)}곡. scripts/make_songsterr_splits.py",
        )
    head = "# 11/08 실제 곡(Songsterr 인기곡) 학습. scripts/make_songsterr_splits.py가 만듦 (설계 CHART-003-songsterr-expand-train)\n"
    for classes, keys in (("five", ("25", "50", "all")), ("pads", ("all",))):
        for k in keys:
            cfg = {"classes": classes, **TRAIN_BASE,
                   "train_datasets": [{"path": f"configs/bench/datasets/public_songs_train_{k}.yaml", "weight": 1.0}],
                   "val_datasets": [{"path": "configs/bench/datasets/public_songs_val.yaml", "n_songs": N_VAL}]}  # fmt: skip
            (TRAIN / f"songsterr_{classes}_{k}.yaml").write_text(
                head + yaml.safe_dump(cfg, allow_unicode=True, sort_keys=False),
                encoding="utf-8",
                newline="\n",
            )
    print(json.dumps({"추가 곡": len(cands), "쓸 곡": len(ok), "검증": len(val), "학습": len(train),
                      "뺀 곡": dropped}, ensure_ascii=False, indent=1))  # fmt: skip
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
