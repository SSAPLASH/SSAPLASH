"""채보 워커 명령줄 (설계 3-1절 명령 표). AI/ 폴더에서 실행.

- run: 모델 올리기 → BE claim 폴링 → 작업 처리 반복. 환경 변수 SSAPLASH_WORKER_* 필요
- check: 환경 변수·설정 yaml 검사, 모델 두 개 올려 보고 시간 출력. BE는 부르지 않음
- fake-be: 테스트·로컬 확인용 BE 대역을 띄우고 곡을 작업으로 넣음 (개발용)

예
  uv run ssaplash-worker check
  uv run ssaplash-worker run --once
  uv run ssaplash-worker fake-be --song data/synth_v1/funk_108/mixture.wav --out data/fake_be

종료 코드: 0 정상, 1 설정·모델 오류, 2 인증 실패(401). 로그는 표준 오류.
로그 설정은 이 파일에서만 함(패키지 안 모듈은 logging.getLogger만 씀).
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections.abc import Sequence

from ssaplash_ai.chart.config import DEFAULT_SEPARATION_CONFIG, DEFAULT_TRANSCRIPTION_CONFIG
from ssaplash_ai.chart.errors import ChartModelError
from ssaplash_ai.coach.llm_local import LocalServerGenerator
from ssaplash_ai.worker.config import WorkerSettings
from ssaplash_ai.worker.loop import EXIT_CONFIG, EXIT_OK, WorkerLoop
from ssaplash_ai.worker.narrative_job import NarrativeApi, NarrativeRunner

logger = logging.getLogger("ssaplash_ai.worker.cli")

LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"


def setup_logging(verbose: bool = False) -> None:
    """root 로거를 표준 오류로. 워커 패키지 로거가 INFO를 내보내게 함."""
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO, format=LOG_FORMAT, stream=sys.stderr
    )
    # 서명 URL이 들어갈 수 있는 urllib3 연결 로그는 끔
    logging.getLogger("urllib3").setLevel(logging.WARNING)


def _settings(args: argparse.Namespace) -> WorkerSettings | None:
    try:
        return WorkerSettings.from_env(
            separation_config=args.separation_config,
            transcription_config=args.transcription_config,
        )
    except ValueError as e:
        logger.error("설정 오류: %s", e)
        return None


def _narrative_runner(settings: WorkerSettings) -> NarrativeRunner | None:
    """LLM 총평 작업이 켜져 있으면 로컬 모델 서버를 부르는 실행기를 만든다. 꺼져 있으면 None."""
    if not settings.narrative_enabled:
        return None
    generator = LocalServerGenerator(
        settings.narrative_llm_url, settings.narrative_model, settings.narrative_llm_api
    )
    return NarrativeRunner(NarrativeApi(settings), generator, settings.narrative_model)


def _make_loop(settings: WorkerSettings) -> WorkerLoop | None:
    try:
        return WorkerLoop(settings, narrative=_narrative_runner(settings))
    except ValueError as e:
        logger.error("총평 작업 설정 오류: %s", e)
        return None


def _load(loop: WorkerLoop) -> bool:
    try:
        loop.load_models()
    except (OSError, ValueError) as e:
        logger.error("설정을 읽지 못함: %s", e)
        return False
    except ChartModelError as e:
        logger.error("모델을 올리지 못함: %s", e.message)
        return False
    return True


def run_cmd(args: argparse.Namespace) -> int:
    settings = _settings(args)
    if settings is None:
        return EXIT_CONFIG
    loop = _make_loop(settings)
    if loop is None or not _load(loop):
        return EXIT_CONFIG
    return loop.run(once=args.once, max_jobs=args.max_jobs)


def check_cmd(args: argparse.Namespace) -> int:
    settings = _settings(args)
    if settings is None:
        return EXIT_CONFIG
    loop = _make_loop(settings)
    if loop is None or not _load(loop):
        return EXIT_CONFIG
    try:
        assert loop.separation is not None and loop.transcription is not None
        print(f"BE 주소: {settings.api_url}")
        print(f"workerId: {settings.worker_id}, 작업 폴더: {settings.jobs_dir}")
        print(
            f"분리 모델: {loop.separation.model_name} ({loop.separation.model_version}), 장치 {loop.separation.device}"
        )
        print(
            f"채보 모델: {loop.transcription.model_name} ({loop.transcription.model_version}), "
            f"장치 {loop.transcription.device}"
        )
        print(
            f"모델 올리기: 분리 {loop.separation.load_sec:.1f}초, 채보 {loop.transcription.load_sec:.1f}초"
        )
        print("설정 정상. BE 연결은 run에서 첫 claim으로 확인")
    finally:
        loop.close()
    return EXIT_OK


def fake_be_cmd(args: argparse.Namespace) -> int:
    from ssaplash_ai.worker.fake_be import serve

    return serve(
        songs=args.song,
        host=args.host,
        port=args.port,
        out_dir=args.out,
        duration_ms=args.duration_ms,
    )


def _add_config_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--separation-config",
        default=str(DEFAULT_SEPARATION_CONFIG),
        help=f"분리 설정 yaml (기본 {DEFAULT_SEPARATION_CONFIG.as_posix()})",
    )
    parser.add_argument(
        "--transcription-config",
        default=str(DEFAULT_TRANSCRIPTION_CONFIG),
        help=f"채보 설정 yaml (기본 {DEFAULT_TRANSCRIPTION_CONFIG.as_posix()})",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ssaplash-worker", description="채보 워커")
    parser.add_argument("-v", "--verbose", action="store_true", help="DEBUG 로그")
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="모델 올리기 → claim 폴링 → 작업 처리 반복")
    _add_config_args(run)
    run.add_argument("--once", action="store_true", help="작업 하나를 끝내면 종료")
    run.add_argument("--max-jobs", type=int, help="이 수만큼 처리하면 종료")
    run.set_defaults(func=run_cmd)

    check = sub.add_parser("check", help="환경 변수·설정 검사, 모델 올려 보기. BE는 부르지 않음")
    _add_config_args(check)
    check.set_defaults(func=check_cmd)

    fake = sub.add_parser("fake-be", help="테스트용 BE 대역 띄우기 (개발용)")
    fake.add_argument(
        "--song", action="append", default=[], help="작업으로 넣을 원곡 파일. 여러 번 가능"
    )
    fake.add_argument("--host", default="127.0.0.1")
    fake.add_argument("--port", type=int, default=8800)
    fake.add_argument("--out", default="data/fake_be", help="받은 파일·결과를 둘 폴더")
    fake.add_argument(
        "--duration-ms", type=int, help="배정에 넣을 원곡 길이. 없으면 파일 길이를 ms로 올림"
    )
    fake.set_defaults(func=fake_be_cmd)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    setup_logging(args.verbose)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
