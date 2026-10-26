"""서비스 추론 명령줄 진입점 (설계 3장 "명령줄"). AI/ 폴더에서 실행.

- separate: 원곡(mp3·wav) → 드럼 트랙·반주 파일 + separation.json(결과 메타) (S15P31A307-167)
- transcribe·run: 채보 모듈(S15P31A307-169)에서 추가

예
  uv run ssaplash-chart separate data/synth_v1/funk_108/mixture.wav --out data/chart/funk_108
  uv run ssaplash-chart separate song.mp3 --out out/song --device cpu --config configs/chart/separation.yaml

종료 코드: 0 정상, 1 설정·인자 오류, 2 입력 오류(INPUT_INVALID), 3 모델 오류(MODEL_FAILED),
4 출력 오류(OUTPUT_INVALID). 진행 상황은 표준 오류, 결과 요약은 표준 출력.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from ssaplash_ai.chart.config import DEFAULT_SEPARATION_CONFIG, SeparationConfig, work_dir_from_env
from ssaplash_ai.chart.errors import ChartError
from ssaplash_ai.chart.separation import SeparationModule, SeparationOutput

EXIT_CODES = {"INPUT_INVALID": 2, "MODEL_FAILED": 3, "OUTPUT_INVALID": 4}
META_FILENAME = "separation.json"


def _log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def _progress(stage: str, fraction: float) -> None:
    _log(f"[{stage}] {'시작' if fraction < 1.0 else '끝'}")


def _resolve_out_dir(out: str | None, input_path: Path) -> Path | None:
    """--out이 있으면 그대로, 없으면 SSAPLASH_WORK_DIR/<원곡 파일 이름>/."""
    if out:
        return Path(out)
    work_dir = work_dir_from_env()
    if work_dir is None:
        return None
    return work_dir / input_path.stem


def write_meta(path: Path, output: SeparationOutput) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(output.to_dict(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return path


def format_summary(output: SeparationOutput) -> str:
    vram = "-" if output.peak_vram_mb is None else f"{output.peak_vram_mb:.0f}"
    ram = "-" if output.peak_ram_mb is None else f"{output.peak_ram_mb:.0f}"
    lines = [
        f"드럼 트랙: {output.drum_stem_path}",
        f"반주: {output.accompaniment_path}",
        f"길이 {output.duration_ms} ms, 샘플레이트 {output.sample_rate} Hz",
        f"모델 {output.model_name} ({output.model_version})",
        f"올리기 {output.load_ms} ms, 분리 {output.separate_ms} ms, "
        f"최대 GPU 메모리 {vram} MB, 최대 RAM {ram} MB",
    ]
    return "\n".join(lines)


def separate_cmd(args: argparse.Namespace) -> int:
    input_path = Path(args.input)
    out_dir = _resolve_out_dir(args.out, input_path)
    if out_dir is None:
        _log("--out 또는 환경 변수 SSAPLASH_WORK_DIR이 필요")
        return 1
    try:
        config = SeparationConfig.from_yaml(args.config)
    except (OSError, ValueError) as e:
        _log(f"설정을 읽지 못함: {args.config} ({e})")
        return 1

    module = SeparationModule(config, device=args.device)
    _log(f"입력: {input_path}")
    _log(f"장치: {module.device}, 모델 설정: {config.model_config}")
    try:
        load_sec = module.load()
        _log(f"모델 올리기 {load_sec:.1f}초")
        output = module.separate_file(input_path, out_dir, on_progress=_progress)
    except ChartError as e:
        retry = "가능" if e.retryable else "불가"
        _log(f"[{e.code}] {e.message} (재시도 {retry})")
        return EXIT_CODES.get(e.code, 1)
    finally:
        module.close()

    meta_path = write_meta(out_dir / META_FILENAME, output)
    print(format_summary(output))
    print(f"결과 메타: {meta_path}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ssaplash-chart", description="서비스 추론 모듈 명령줄")
    sub = parser.add_subparsers(dest="command", required=True)

    sep = sub.add_parser("separate", help="원곡 → 드럼 트랙·반주 파일 + separation.json")
    sep.add_argument("input", help="원곡 파일 (mp3·wav)")
    sep.add_argument("--out", help="출력 폴더. 없으면 SSAPLASH_WORK_DIR/<원곡 파일 이름>/")
    sep.add_argument(
        "--config",
        default=str(DEFAULT_SEPARATION_CONFIG),
        help=f"분리 설정 yaml (기본 {DEFAULT_SEPARATION_CONFIG.as_posix()})",
    )
    sep.add_argument("--device", help="cuda 또는 cpu. 없으면 설정값(없으면 cpu로 내려감)")
    sep.set_defaults(func=separate_cmd)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
