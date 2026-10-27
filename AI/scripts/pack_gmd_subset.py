"""채보 평가용 GMD 연주 묶음만 뽑아 복사하는 스크립트. AI/ 폴더에서 실행.

코랩 드라이브에 GMD 전체(11GB)를 올리는 대신, 데이터셋 yaml의 songs 목록에 있는 연주(45개, 약 560MB)와
info.csv만 원본과 같은 상대 경로로 복사한다. 복사한 폴더를 드라이브 `data/gmd/`에 올리면
`configs/bench/datasets/gmd_test.yaml`의 root(`data/gmd/groove`)가 그대로 맞는다.

  uv run python scripts/pack_gmd_subset.py configs/bench/datasets/gmd_test.yaml data/upload/gmd
  → data/upload/gmd/groove/info.csv + 연주별 wav·mid. 끝나면 복사본으로 check-data와 같은 점검을 한 번 한다.

로직은 ssaplash_ai.bench.datasets.gmd.export_subset에, 여기서는 인자 처리만.
"""

from __future__ import annotations

import argparse
import dataclasses
import sys
from pathlib import Path

from ssaplash_ai.bench.datasets import DatasetConfig, GmdDataset
from ssaplash_ai.bench.datasets.gmd import export_subset


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("config", type=Path, help="songs 목록이 있는 GMD 데이터셋 yaml")
    p.add_argument("out", type=Path, help="출력 폴더. 아래에 groove/ 생성")
    args = p.parse_args(argv)

    cfg = DatasetConfig.from_yaml(args.config)
    if cfg.kind != "gmd" or not cfg.songs:
        print("kind가 gmd이고 songs 목록이 있는 yaml이어야 함")
        return 1
    out_root = args.out / cfg.root.name
    copied = export_subset(GmdDataset(cfg), out_root)
    size_mb = sum(f.stat().st_size for f in copied) / 1e6
    print(f"복사 {len(copied)}개 파일, {size_mb:.0f}MB → {out_root}")

    report = GmdDataset(dataclasses.replace(cfg, root=out_root)).check()
    print(
        f"복사본 점검: 곡 {report.song_count}개, 길이 {report.total_duration_sec / 60:.1f}분, "
        f"누락 {len(report.missing)}개"
    )
    for m in report.missing:
        print(f"  누락: {m}")
    return 1 if report.missing else 0


if __name__ == "__main__":
    sys.exit(main())
