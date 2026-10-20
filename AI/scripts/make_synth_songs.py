"""자체 합성곡(synth_v1) 제작 스크립트. AI/ 폴더에서 실행.

후보 고르기:
  uv run python scripts/make_synth_songs.py list-gmd data/gmd/groove --style rock --bpm-min 80 --bpm-max 100 --min-sec 30
만들기:
  uv run python scripts/make_synth_songs.py build configs/bench/datasets/synth_v1_recipe.yaml [--only 곡이름]

로직은 ssaplash_ai.bench.datasets.synth_build에, 여기서는 인자 처리만.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from ssaplash_ai.bench.datasets.synth_build import Recipe, build_all, list_gmd


def cmd_list_gmd(args: argparse.Namespace) -> int:
    rows = list_gmd(
        args.gmd_root,
        style=args.style,
        bpm_min=args.bpm_min,
        bpm_max=args.bpm_max,
        min_sec=args.min_sec,
        beat_type=None if args.all_types else "beat",
    )
    print(f"{'id':<40} {'style':<24} {'bpm':>4} {'초':>7} split")
    for r in rows:
        print(
            f"{r['id']:<40} {r['style']:<24} {r['bpm']:>4} {float(r['duration']):>7.1f} {r['split']}"
        )
    print(f"총 {len(rows)}개")
    return 0


def cmd_build(args: argparse.Namespace) -> int:
    recipe = Recipe.from_yaml(args.recipe)
    if not recipe.songs:
        print("레시피에 곡이 없음. songs 목록을 채운 뒤 다시 실행.")
        return 1
    for out in build_all(recipe, only=args.only):
        print(f"생성: {out}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="GMD 드럼 + MUSDB 반주로 합성곡 생성")
    sub = parser.add_subparsers(dest="command", required=True)

    ls = sub.add_parser("list-gmd", help="조건에 맞는 GMD 연주 목록 출력")
    ls.add_argument("gmd_root", type=Path, help="info.csv가 있는 GMD 폴더")
    ls.add_argument("--style", help="스타일 부분 일치 (rock, funk, jazz, latin, hiphop …)")
    ls.add_argument("--bpm-min", type=int)
    ls.add_argument("--bpm-max", type=int)
    ls.add_argument("--min-sec", type=float, default=0.0, help="최소 길이(초)")
    ls.add_argument("--all-types", action="store_true", help="fill도 포함 (기본은 beat만)")
    ls.set_defaults(func=cmd_list_gmd)

    bd = sub.add_parser("build", help="레시피대로 합성곡 생성")
    bd.add_argument("recipe", type=Path)
    bd.add_argument("--only", help="이 이름의 곡만 생성")
    bd.set_defaults(func=cmd_build)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
