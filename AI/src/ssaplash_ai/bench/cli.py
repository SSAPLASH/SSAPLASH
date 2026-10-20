"""벤치마크 명령줄 진입점.

지금은 check-data만. run·report는 S15P31A307-104에서 추가.
AI/ 폴더에서 `uv run ssaplash-bench check-data configs/bench/datasets/musdb18hq_test.yaml`.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from ssaplash_ai.bench.datasets import CheckReport, load_dataset


def format_report(report: CheckReport) -> str:
    expected = f" (기대 {report.expected_songs})" if report.expected_songs is not None else ""
    minutes = report.total_duration_sec / 60
    lines = [
        f"[{report.dataset}] 곡 {report.song_count}개{expected}, "
        f"길이 합 {minutes:.1f}분, 누락 {len(report.missing)}건"
    ]
    lines.extend(f"  누락: {m}" for m in report.missing)
    lines.append("  상태: 정상" if report.ok else "  상태: 문제 있음")
    return "\n".join(lines)


def check_data(config_paths: Sequence[Path]) -> int:
    exit_code = 0
    for path in config_paths:
        report = load_dataset(path).check()
        print(format_report(report))
        if not report.ok:
            exit_code = 1
    return exit_code


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ssaplash-bench", description="드럼 분리 벤치마크 하네스")
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("check-data", help="데이터셋 yaml을 읽어 곡 수·길이·누락 파일 출력")
    check.add_argument("configs", nargs="+", type=Path, help="configs/bench/datasets/*.yaml")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "check-data":
        return check_data(args.configs)
    return 2


if __name__ == "__main__":
    sys.exit(main())
