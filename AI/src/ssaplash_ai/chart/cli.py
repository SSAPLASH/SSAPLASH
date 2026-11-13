"""서비스 추론 명령줄 진입점. AI/ 폴더에서 실행.

- separate: 원곡 → 드럼 트랙·반주 파일 + separation.json
- transcribe: 드럼 트랙 → chart.json + transcription.json
- run: separate와 transcribe를 이어서
- sheet: MusicXML 드럼 악보 → chart.json + sheet.json
- music-check: 원곡 → 음악 확률·말소리 확률과 판정

예
  uv run ssaplash-chart run song.mp3 --out out/song
  uv run ssaplash-chart sheet score.mxl --out out/score

종료 코드: 0 정상, 1 설정·인자 오류, 2 입력 오류, 3 모델 오류, 4 출력 오류. music-check는 기준에 걸려도 2.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from ssaplash_ai.chart.config import (
    DEFAULT_MUSIC_CHECK_CONFIG,
    DEFAULT_SEPARATION_CONFIG,
    DEFAULT_TRANSCRIPTION_CONFIG,
    MusicCheckConfig,
    SeparationConfig,
    TranscriptionConfig,
    work_dir_from_env,
)
from ssaplash_ai.chart.errors import ChartError
from ssaplash_ai.chart.music_check import MusicCheckModule, MusicCheckOutput, failure_message
from ssaplash_ai.chart.separation import SeparationModule, SeparationOutput
from ssaplash_ai.chart.sheet import DEFAULT_SHEET_CONFIG, SheetConfig, SheetOutput, convert_sheet
from ssaplash_ai.chart.transcription import TranscriptionModule, TranscriptionOutput

EXIT_CODES = {"INPUT_INVALID": 2, "MODEL_FAILED": 3, "OUTPUT_INVALID": 4}
META_FILENAME = "separation.json"
TRANSCRIPTION_META_FILENAME = "transcription.json"
SHEET_META_FILENAME = "sheet.json"


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


def write_meta(path: Path, output: SeparationOutput | TranscriptionOutput | SheetOutput) -> Path:
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


def format_transcription_summary(output: TranscriptionOutput) -> str:
    vram = "-" if output.peak_vram_mb is None else f"{output.peak_vram_mb:.0f}"
    ram = "-" if output.peak_ram_mb is None else f"{output.peak_ram_mb:.0f}"
    pads = ", ".join(f"{pad} {n}" for pad, n in output.notes_by_pad.items() if n)
    bpm = f"{output.bpm:.2f}" if output.bpm_estimated else f"{output.bpm:.2f} (추정 실패, 기본값)"
    lines = [
        f"채보: {output.chart_json_path}",
        f"노트 {output.n_notes}개 ({pads or '없음'})",
        f"길이 {output.duration_ms} ms, bpm {bpm}, "
        f"첫 마디 첫 박(offsetMs) {output.chart['charts'][0]['timing']['offsetMs']} ms",
        f"모델 {output.model_name} ({output.model_version})",
        f"올리기 {output.load_ms} ms, 채보 {output.transcribe_ms} ms, "
        f"최대 GPU 메모리 {vram} MB, 최대 RAM {ram} MB",
    ]
    return "\n".join(lines)


def format_sheet_summary(output: SheetOutput) -> str:
    pads = ", ".join(f"{pad} {n}" for pad, n in output.notes_by_pad.items() if n)
    bpm = (
        f"{output.bpm:.2f}"
        if output.tempo_found
        else f"{output.bpm:.2f} (악보에 템포 없음, 기본값)"
    )
    dropped = ", ".join(f"GM {k} {v}개" for k, v in output.dropped.items()) or "없음"
    lines = [
        f"채보: {output.chart_json_path}",
        f"노트 {output.n_notes}개 ({pads or '없음'})",
        f"길이 {output.duration_ms} ms, bpm {bpm}, 박자 {output.time_signature}, "
        f"첫 마디 첫 박(offsetMs) {output.offset_ms} ms",
        f"마디 {output.measures_written} → 반복 펼쳐 {output.measures_played}",
        f"열린 하이햇 {output.n_open_hihat}개, 하이햇 페달 {output.n_hihat_pedal}개, "
        f"패드에 없어 뺀 타악기: {dropped}",
        f"변환 {output.convert_ms} ms ({output.generator_version})",
    ]
    return "\n".join(lines)


def _report_error(e: ChartError) -> int:
    retry = "가능" if e.retryable else "불가"
    _log(f"[{e.code}] {e.message} (재시도 {retry})")
    return EXIT_CODES.get(e.code, 1)


def _run_separation(
    config: SeparationConfig,
    device: str | None,
    input_path: Path,
    out_dir: Path,
    duration_ms: int | None = None,
) -> SeparationOutput:
    module = SeparationModule(config, device=device)
    _log(f"장치: {module.device}, 분리 모델 설정: {config.model_config}")
    try:
        load_sec = module.load()
        _log(f"분리 모델 올리기 {load_sec:.1f}초")
        return module.separate_file(
            input_path, out_dir, on_progress=_progress, duration_ms=duration_ms
        )
    finally:
        module.close()


def _run_transcription(
    config: TranscriptionConfig,
    device: str | None,
    drum_path: Path,
    out_dir: Path,
    duration_ms: int | None = None,
    beat_audio_path: Path | None = None,
) -> TranscriptionOutput:
    module = TranscriptionModule(config, device=device)
    _log(f"장치: {module.device}, 채보 모델 설정: {config.model_config}")
    try:
        load_sec = module.load()
        _log(f"채보 모델 올리기 {load_sec:.1f}초")
        return module.transcribe_file(
            drum_path,
            out_dir,
            on_progress=_progress,
            duration_ms=duration_ms,
            beat_audio_path=beat_audio_path,
        )
    finally:
        module.close()


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

    _log(f"입력: {input_path}")
    try:
        output = _run_separation(config, args.device, input_path, out_dir, args.duration_ms)
    except ChartError as e:
        return _report_error(e)

    meta_path = write_meta(out_dir / META_FILENAME, output)
    print(format_summary(output))
    print(f"결과 메타: {meta_path}")
    return 0


def transcribe_cmd(args: argparse.Namespace) -> int:
    input_path = Path(args.input)
    out_dir = _resolve_out_dir(args.out, input_path)
    if out_dir is None:
        _log("--out 또는 환경 변수 SSAPLASH_WORK_DIR이 필요")
        return 1
    try:
        config = TranscriptionConfig.from_yaml(args.config)
    except (OSError, ValueError) as e:
        _log(f"설정을 읽지 못함: {args.config} ({e})")
        return 1

    _log(f"입력: {input_path}")
    beat_audio = Path(args.beat_audio) if args.beat_audio else None
    try:
        output = _run_transcription(
            config, args.device, input_path, out_dir, args.duration_ms, beat_audio
        )
    except ChartError as e:
        return _report_error(e)

    meta_path = write_meta(out_dir / TRANSCRIPTION_META_FILENAME, output)
    print(format_transcription_summary(output))
    print(f"결과 메타: {meta_path}")
    return 0


def run_cmd(args: argparse.Namespace) -> int:
    input_path = Path(args.input)
    out_dir = _resolve_out_dir(args.out, input_path)
    if out_dir is None:
        _log("--out 또는 환경 변수 SSAPLASH_WORK_DIR이 필요")
        return 1
    try:
        sep_config = SeparationConfig.from_yaml(args.separation_config)
        tr_config = TranscriptionConfig.from_yaml(args.transcription_config)
    except (OSError, ValueError) as e:
        _log(f"설정을 읽지 못함: {e}")
        return 1

    _log(f"입력: {input_path}")
    try:
        sep = _run_separation(sep_config, args.device, input_path, out_dir, args.duration_ms)
        write_meta(out_dir / META_FILENAME, sep)
        # 박은 원곡으로 찾음
        tr = _run_transcription(
            tr_config, args.device, sep.drum_stem_path, out_dir, args.duration_ms, input_path
        )
        write_meta(out_dir / TRANSCRIPTION_META_FILENAME, tr)
    except ChartError as e:
        return _report_error(e)

    print(format_summary(sep))
    print(format_transcription_summary(tr))
    total_ms = sep.separate_ms + tr.transcribe_ms
    print(
        f"합계: 분리 {sep.separate_ms} ms + 채보 {tr.transcribe_ms} ms = {total_ms} ms "
        f"(모델 올리기 제외, 곡 길이 {sep.duration_ms} ms)"
    )
    return 0


def sheet_cmd(args: argparse.Namespace) -> int:
    input_path = Path(args.input)
    out_dir = _resolve_out_dir(args.out, input_path)
    if out_dir is None:
        _log("--out 또는 환경 변수 SSAPLASH_WORK_DIR이 필요")
        return 1
    try:
        config = SheetConfig.from_yaml(args.config)
    except (OSError, ValueError, TypeError) as e:
        _log(f"설정을 읽지 못함: {args.config} ({e})")
        return 1

    _log(f"입력: {input_path}")
    try:
        output = convert_sheet(input_path, config, out_dir)
    except ChartError as e:
        return _report_error(e)

    meta_path = write_meta(out_dir / SHEET_META_FILENAME, output)
    print(format_sheet_summary(output))
    print(f"결과 메타: {meta_path}")
    return 0


def format_music_check_summary(
    output: MusicCheckOutput, config: MusicCheckConfig, failed: str | None
) -> str:
    def limit(value: float | None) -> str:
        return "없음" if value is None else f"{value:.2f}"

    windows = ", ".join(f"{w['music']:.2f}/{w['speech']:.2f}" for w in output.window_probs)
    lines = [
        f"음악 확률 {output.music_prob:.4f} (기준 {limit(config.min_music_prob)} 이상이어야 통과)",
        f"말소리 확률 {output.speech_prob:.4f} (기준 {limit(config.max_speech_prob)} 미만이어야 통과)",
        f"구간별 음악/말소리: {windows}",
        f"모델 {output.model_name} ({output.model_version}), 검사 {output.check_ms} ms",
        f"판정: {'실패 - ' + failed if failed else '통과'}",
    ]
    return "\n".join(lines)


def music_check_cmd(args: argparse.Namespace) -> int:
    input_path = Path(args.input)
    try:
        config = MusicCheckConfig.from_yaml(args.config)
    except (OSError, ValueError, TypeError) as e:
        _log(f"설정을 읽지 못함: {args.config} ({e})")
        return 1

    _log(f"입력: {input_path}")
    module = MusicCheckModule(config)
    try:
        # 기준값이 비어 있어도 확률은 구해서 보여 줌
        load_sec = module.load(force=True)
        _log(f"분류 모델 올리기 {load_sec:.1f}초 ({config.model}, 장치 {config.device})")
        output = module.measure_file(input_path)
    except ChartError as e:
        return _report_error(e)
    finally:
        module.close()

    failed = failure_message(output, config)
    print(format_music_check_summary(output, config, failed))
    return EXIT_CODES["INPUT_INVALID"] if failed else 0


def _add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--out", help="출력 폴더. 없으면 SSAPLASH_WORK_DIR/<입력 파일 이름>/")
    parser.add_argument("--device", help="cuda 또는 cpu. 없으면 설정값(없으면 cpu로 내려감)")
    parser.add_argument(
        "--duration-ms",
        type=int,
        help="BE가 준 원곡 길이(ms). 분리 출력 두 파일의 끝을 이 길이에 맞추고 채보 노트 시각 상한에 씀. "
        "없으면 파일 길이 그대로",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ssaplash-chart", description="서비스 추론 모듈 명령줄")
    sub = parser.add_subparsers(dest="command", required=True)

    sep = sub.add_parser("separate", help="원곡 → 드럼 트랙·반주 파일 + separation.json")
    sep.add_argument("input", help="원곡 파일 (mp3·wav·flac·opus·m4a)")
    _add_common(sep)
    sep.add_argument(
        "--config",
        default=str(DEFAULT_SEPARATION_CONFIG),
        help=f"분리 설정 yaml (기본 {DEFAULT_SEPARATION_CONFIG.as_posix()})",
    )
    sep.set_defaults(func=separate_cmd)

    tr = sub.add_parser("transcribe", help="드럼 트랙 → chart.json + transcription.json")
    tr.add_argument("input", help="드럼 트랙 파일 (flac·wav)")
    _add_common(tr)
    tr.add_argument(
        "--beat-audio",
        help="박 추정용 원곡 (드럼 트랙과 같은 시간축). 없으면 드럼 트랙으로 박을 찾음",
    )
    tr.add_argument(
        "--config",
        default=str(DEFAULT_TRANSCRIPTION_CONFIG),
        help=f"채보 설정 yaml (기본 {DEFAULT_TRANSCRIPTION_CONFIG.as_posix()})",
    )
    tr.set_defaults(func=transcribe_cmd)

    run = sub.add_parser("run", help="원곡 → 분리 → 채보. 단계별 시간·메모리 요약")
    run.add_argument("input", help="원곡 파일 (mp3·wav·flac·opus·m4a)")
    _add_common(run)
    run.add_argument(
        "--separation-config",
        default=str(DEFAULT_SEPARATION_CONFIG),
        help=f"분리 설정 yaml (기본 {DEFAULT_SEPARATION_CONFIG.as_posix()})",
    )
    run.add_argument(
        "--transcription-config",
        default=str(DEFAULT_TRANSCRIPTION_CONFIG),
        help=f"채보 설정 yaml (기본 {DEFAULT_TRANSCRIPTION_CONFIG.as_posix()})",
    )
    run.set_defaults(func=run_cmd)

    sh = sub.add_parser("sheet", help="MusicXML 드럼 악보 → chart.json + sheet.json")
    sh.add_argument("input", help="MusicXML 파일 (.musicxml·.xml·.mxl)")
    sh.add_argument("--out", help="출력 폴더. 없으면 SSAPLASH_WORK_DIR/<파일 이름>")
    sh.add_argument(
        "--config",
        default=str(DEFAULT_SHEET_CONFIG),
        help=f"악보 설정 yaml (기본 {DEFAULT_SHEET_CONFIG.as_posix()})",
    )
    sh.set_defaults(func=sheet_cmd)

    mc = sub.add_parser("music-check", help="원곡 → 음악 확률·말소리 확률과 분리 전 검사 판정")
    mc.add_argument("input", help="원곡 파일 (mp3·wav·flac·opus·m4a)")
    mc.add_argument(
        "--config",
        default=str(DEFAULT_MUSIC_CHECK_CONFIG),
        help=f"음악 여부 검사 설정 yaml (기본 {DEFAULT_MUSIC_CHECK_CONFIG.as_posix()})",
    )
    mc.set_defaults(func=music_check_cmd)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
