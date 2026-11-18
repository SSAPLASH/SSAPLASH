"""STRUM CRNN 학습용 데이터를 GPU 서버에 올릴 zip으로 묶음 (11/11).

`export_manifest.py`가 만든 곡 목록을 읽어 드럼 음원을 모노 16비트 FLAC으로 다시 쓰고(스테레오 원본의 절반 크기),
정답 npz와 함께 `ext_ft_data/` 아래 상대 경로로 담음. 목록 json의 경로도 상대 경로로 바꿔 서버에서 그대로 읽힘.
반주(drumless)는 담지 않음. zip은 --chunk-mb 크기로 나누고 압축하지 않음(FLAC은 더 안 줄어듦).

  uv run python scripts/train_ext/pack_server_data.py --name train457 --name val10 --name test31 --name holdout38 --name mdb --name enst --name enst_sep
  → data/upload/ext_ft/ext_ft_data_01.zip ..., md5.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--name", action="append", required=True, help="목록 이름 (여러 번)")
    ap.add_argument("--src", type=Path, default=Path("data/ext_train"))
    ap.add_argument("--stage", type=Path, default=Path("data/ext_train/pack/ext_ft_data"))
    ap.add_argument("--out", type=Path, default=Path("data/upload/ext_ft"))
    ap.add_argument("--chunk-mb", type=int, default=900)
    args = ap.parse_args()

    import soundfile as sf

    files: list[Path] = []
    seen: dict[str, str] = {}  # 원본 음원 경로 → 담은 상대 경로 (목록끼리 같은 곡은 한 번만)
    for name in args.name:
        meta = json.loads((args.src / f"{name}.json").read_text(encoding="utf-8"))
        for song in meta["songs"]:
            safe = song["song_id"].replace("/", "__")
            if song["drums"] not in seen:
                rel = f"audio/{name}/{safe}.flac"
                dst = args.stage / rel
                if not dst.is_file():
                    audio, sr = sf.read(song["drums"], dtype="float32", always_2d=True)
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    sf.write(dst, audio.mean(axis=1), sr, subtype="PCM_16")
                seen[song["drums"]] = rel
                files.append(dst)
            label_rel = f"labels/{name}/{safe}.npz"
            label_dst = args.stage / label_rel
            label_dst.parent.mkdir(parents=True, exist_ok=True)
            label_dst.write_bytes(Path(song["labels"]).read_bytes())
            files.append(label_dst)
            song["drums"], song["labels"], song["accomp"] = seen[song["drums"]], label_rel, None
        out_json = args.stage / f"{name}.json"
        out_json.write_text(json.dumps(meta, indent=1), encoding="utf-8")
        files.append(out_json)
        print(f"[pack] {name} 곡 {len(meta['songs'])}", flush=True)

    args.out.mkdir(parents=True, exist_ok=True)
    for old in args.out.glob("ext_ft_data_*.zip"):
        old.unlink()
    limit = args.chunk_mb * 1024 * 1024
    part, size, zf, md5 = 0, 0, None, {}
    for path in files:
        n = path.stat().st_size
        if zf is None or size + n > limit:
            if zf is not None:
                zf.close()
            part, size = part + 1, 0
            zf = zipfile.ZipFile(args.out / f"ext_ft_data_{part:02d}.zip", "w", zipfile.ZIP_STORED)
        zf.write(path, f"ext_ft_data/{path.relative_to(args.stage).as_posix()}")
        size += n
    if zf is not None:
        zf.close()
    for z in sorted(args.out.glob("ext_ft_data_*.zip")):
        h = hashlib.md5()
        with open(z, "rb") as fh:
            for block in iter(lambda: fh.read(1 << 22), b""):
                h.update(block)
        md5[z.name] = {"md5": h.hexdigest(), "bytes": z.stat().st_size}
        print(f"[pack] {z.name} {z.stat().st_size / 1e6:.0f}MB {h.hexdigest()}", flush=True)
    (args.out / "md5.json").write_text(json.dumps(md5, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
