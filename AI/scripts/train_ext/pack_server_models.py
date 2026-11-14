"""STRUM CRNN의 공개 가중치와 모델 코드를 GPU 서버에 올릴 zip 하나로 묶음 (11/11).

서버에서 저장소를 받거나 패키지를 깔지 않도록, 학습 스크립트가 실제로 읽는 파일만 담음.
- strum/: `drums_v13.py`(모델 정의, MIT), phase3.pt(모델 가중치와 모델 설정만 남긴 것), LICENSE

  uv run python scripts/train_ext/pack_server_models.py
  → data/upload/ext_ft/ext_ft_models.zip, md5_models.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import zipfile
from pathlib import Path

import numpy as np


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--stage", type=Path, default=Path("data/ext_train/pack/ext_ft_models"))
    ap.add_argument("--out", type=Path, default=Path("data/upload/ext_ft"))
    args = ap.parse_args()

    import torch

    stage = args.stage
    if stage.exists():
        shutil.rmtree(stage)
    strum = stage / "strum"
    strum.mkdir(parents=True)
    shutil.copy2("ext/strum/src/models/drums_v13.py", strum / "drums_v13.py")
    for name in ("LICENSE", "LICENSE.md", "LICENSE.txt"):
        if Path("ext/strum", name).is_file():
            shutil.copy2(Path("ext/strum", name), strum / "LICENSE")
    safe = [np.dtype, np._core.multiarray.scalar]
    safe += [type(np.dtype(t)) for t in ("float64", "float32", "int64", "int32", "bool")]
    torch.serialization.add_safe_globals(safe)
    ckpt = torch.load(
        "data/models/strum/drums/drums_phase3/best.pt", map_location="cpu", weights_only=True
    )
    slim = {"model_state_dict": ckpt["model_state_dict"]}
    slim["config"] = {"model": (ckpt.get("config") or {}).get("model", {})}
    torch.save(slim, strum / "phase3.pt")

    args.out.mkdir(parents=True, exist_ok=True)
    dest = args.out / "ext_ft_models.zip"
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_STORED) as zf:
        for path in sorted(p for p in stage.rglob("*") if p.is_file()):
            zf.write(path, f"ext_ft_models/{path.relative_to(stage).as_posix()}")
    h = hashlib.md5()
    with open(dest, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 22), b""):
            h.update(block)
    info = {dest.name: {"md5": h.hexdigest(), "bytes": dest.stat().st_size}}
    (args.out / "md5_models.json").write_text(json.dumps(info, indent=1), encoding="utf-8")
    print(f"[pack] {dest} {dest.stat().st_size / 1e6:.0f}MB {h.hexdigest()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
