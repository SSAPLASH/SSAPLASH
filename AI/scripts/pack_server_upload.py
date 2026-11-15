"""GPU 서버(JupyterHub)에 올릴 zip을 만드는 스크립트. AI/ 폴더에서 실행 (채보 설계 #11).

서버에는 구글 드라이브가 없어서, 코랩 때 드라이브에 두었던 것을 zip 5개로 묶어 JupyterHub 홈 폴더에 올림.
zip 안 경로는 AI/ 기준이라 서버의 AI/ 폴더에서 풀면 제자리에 놓임.

  uv run python scripts/pack_server_upload.py
  → data/upload/server/ 에 S15P31A307_code.zip, data_synth_v1.zip, data_gmd.zip, data_mdb_drums.zip,
    results_separated.zip

- 코드 zip: git이 추적하는 파일 + 아직 커밋하지 않은 새 파일(무시 규칙에 걸린 것은 뺌). 커밋 전에도 서버에서 시험 가능
- data_gmd.zip: scripts/pack_gmd_subset.py로 뽑은 data/upload/gmd/groove/를 data/gmd/groove/로 담음
- results_separated.zip: 코랩 분리 드럼 입력 run 4개의 separated/ 폴더. 곡이 빠져 있으면 목록을 찍고 멈춤
- wav는 압축해도 거의 안 줄어서 압축 없이(ZIP_STORED) 담음
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import zipfile
from pathlib import Path

from ssaplash_ai.bench.datasets import load_dataset

DATASETS = Path("configs/bench/datasets")
# 코랩 분리 드럼 입력 run 폴더 → 그 run의 데이터셋 yaml. 캐시는 <run>/separated/<분리 모델>/<곡>/drums.wav
SEPARATED_RUNS = {
    "data/results/sep-sw-synth/separated/bs_roformer_sw": "synth_v1.yaml",
    "data/results/sep-sw-mdbu/separated/bs_roformer_sw": "mdb_drums_unseen.yaml",
    "data/results/sep-musdb-synth/separated/bs_roformer_musdb": "synth_v1.yaml",
    "data/results/sep-musdb-mdbu/separated/bs_roformer_musdb": "mdb_drums_unseen.yaml",
}


def code_files(repo_root: Path) -> list[Path]:
    """git 추적 파일 + 무시되지 않은 새 파일 (저장소 루트 기준 상대 경로)."""
    out = subprocess.run(
        ["git", "ls-files", "-co", "--exclude-standard", "-z"],
        cwd=repo_root,
        capture_output=True,
        check=True,
    ).stdout.decode("utf-8")
    return [Path(p) for p in out.split("\0") if p and (repo_root / p).is_file()]


def missing_separated(ai_root: Path) -> list[str]:
    """분리 드럼 캐시에서 빠진 곡. '폴더/곡' 문자열 목록."""
    missing = []
    for folder, dataset_yaml in SEPARATED_RUNS.items():
        for song_id in load_dataset(ai_root / DATASETS / dataset_yaml).song_ids():
            if not (ai_root / folder / song_id / "drums.wav").is_file():
                missing.append(f"{folder}/{song_id}")
    return missing


def write_zip(path: Path, files: list[tuple[Path, str]]) -> None:
    """(원본 파일, zip 안 경로) 목록을 압축 없이 담음."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as zf:
        for src, arcname in files:
            zf.write(src, arcname)
    size_mb = path.stat().st_size / 1e6
    print(f"{path.name}: 파일 {len(files)}개, {size_mb:.0f}MB")


def folder_files(src_root: Path, arc_root: str) -> list[tuple[Path, str]]:
    """폴더 안 파일 전부 → zip 안 경로는 arc_root 아래 같은 상대 경로."""
    return [
        (f, f"{arc_root}/{f.relative_to(src_root).as_posix()}")
        for f in sorted(src_root.rglob("*"))
        if f.is_file()
    ]


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--out", type=Path, default=Path("data/upload/server"), help="zip을 둘 폴더")
    p.add_argument(
        "--code-only",
        action="store_true",
        help="코드 zip만 만듦 (데이터·분리 결과는 서버에 이미 있을 때. S15P31A307-164 재연구)",
    )
    args = p.parse_args(argv)
    ai_root = Path.cwd()
    repo_root = ai_root.parent

    if args.code_only:
        write_zip(
            args.out / "S15P31A307_code.zip",
            [(repo_root / f, f"S15P31A307/{f.as_posix()}") for f in code_files(repo_root)],
        )
        return 0

    missing = missing_separated(ai_root)
    if missing:
        print(
            f"분리 드럼 캐시에 빠진 곡 {len(missing)}개 (드라이브 results/에서 받아 같은 자리에 둠):"
        )
        for m in missing:
            print(f"  {m}/drums.wav")
        return 1
    gmd_root = ai_root / "data/upload/gmd/groove"
    if not (gmd_root / "info.csv").is_file():
        print("data/upload/gmd/groove/ 가 없음. 먼저 scripts/pack_gmd_subset.py 실행")
        return 1

    write_zip(
        args.out / "S15P31A307_code.zip",
        [(repo_root / f, f"S15P31A307/{f.as_posix()}") for f in code_files(repo_root)],
    )
    write_zip(
        args.out / "data_synth_v1.zip", folder_files(ai_root / "data/synth_v1", "data/synth_v1")
    )
    write_zip(args.out / "data_gmd.zip", folder_files(gmd_root, "data/gmd/groove"))
    write_zip(
        args.out / "data_mdb_drums.zip", folder_files(ai_root / "data/mdb_drums", "data/mdb_drums")
    )
    separated = []
    for folder in SEPARATED_RUNS:
        separated += folder_files(ai_root / folder, folder)
    write_zip(args.out / "results_separated.zip", separated)
    return 0


if __name__ == "__main__":
    sys.exit(main())
