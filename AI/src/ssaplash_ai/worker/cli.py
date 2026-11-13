"""채보 워커 명령줄. AI/ 폴더에서 실행.

- run: 모델 올리기 → BE claim 폴링 → 작업 처리 반복
- check: 환경 변수·설정 yaml 검사, 모델을 올려 보고 시간·음악 여부 검사 상태 출력. BE는 부르지 않음
- live-run: 연주 중 LLM 구간 코칭 워커
- fake-be: 테스트·로컬 확인용 BE 대역 (개발용)

종료 코드: 0 정상, 1 설정·모델 오류, 2 인증 실패(401). 로그는 표준 오류.
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections.abc import Sequence

from ssaplash_ai.chart.config import (
    DEFAULT_MUSIC_CHECK_CONFIG,
    DEFAULT_SEPARATION_CONFIG,
    DEFAULT_TRANSCRIPTION_CONFIG,
)
from ssaplash_ai.chart.errors import ChartModelError
from ssaplash_ai.coach.llm_local import LocalServerGenerator
from ssaplash_ai.worker.config import WorkerSettings
from ssaplash_ai.worker.live_coach_job import LiveCoachApi, LiveCoachRunner, run_live_loop
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
            music_check_config=getattr(args, "music_check_config", None),
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


def _music_check_line(loop: WorkerLoop) -> str:
    """분리 전 음악 여부 검사 상태 한 줄. 켜짐·꺼짐·올리기 실패를 구분해 보여 줌."""
    if loop.music_check is not None:
        config = loop.music_check.config
        return (
            f"음악 여부 검사: 켜짐 ({config.model}, 장치 {config.device}, "
            f"음악 확률 기준 {config.min_music_prob}, 말소리 확률 기준 {config.max_speech_prob}), "
            f"올리기 {loop.music_check.load_sec:.1f}초"
        )
    if loop.music_check_error:
        return (
            f"음악 여부 검사: [주의] 모델을 올리지 못해 검사 없이 돎 ({loop.music_check_error}). "
            "uv sync --extra music-check와 가중치 내려받기를 확인"
        )
    return "음악 여부 검사: 꺼짐"


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
        print(_music_check_line(loop))
        print("설정 정상. BE 연결은 run에서 첫 claim으로 확인")
    finally:
        loop.close()
    return EXIT_OK


def live_run_cmd(args: argparse.Namespace) -> int:
    """연주 중 LLM 구간 코칭 워커. 채보 모델을 올리지 않고 연주 코칭 큐만 짧은 주기로 본다."""
    import threading

    from ssaplash_ai.worker.api import ApiError
    from ssaplash_ai.worker.loop import EXIT_AUTH

    settings = _settings(args)
    if settings is None:
        return EXIT_CONFIG
    if not settings.narrative_model:
        logger.error("모델 이름이 없음: SSAPLASH_NARRATIVE_MODEL (총평과 같은 모델을 쓴다)")
        return EXIT_CONFIG
    generator = LocalServerGenerator(
        settings.narrative_llm_url,
        settings.narrative_model,
        settings.narrative_llm_api,
        timeout_sec=settings.live_llm_timeout_sec,
        max_tokens=80,
        json_output=True,
    )
    runner = LiveCoachRunner(LiveCoachApi(settings), generator, settings.narrative_model)
    stop = threading.Event()
    logger.info(
        "연주 코칭 워커 시작: 모델 %s, %.1f초 주기",
        settings.narrative_model,
        settings.live_poll_sec,
    )
    try:
        run_live_loop(runner, settings.live_poll_sec, stop, max_jobs=args.max_jobs)
    except ApiError as e:
        if e.status == 401:
            logger.error("인증 실패(401). 토큰·workerId 설정 확인: %s", e)
            return EXIT_AUTH
        raise
    except KeyboardInterrupt:
        stop.set()
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
    parser.add_argument(
        "--music-check-config",
        default=str(DEFAULT_MUSIC_CHECK_CONFIG),
        help=f"분리 전 음악 여부 검사 설정 yaml (기본 {DEFAULT_MUSIC_CHECK_CONFIG.as_posix()}). "
        "빈 문자열이면 검사 안 함",
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

    live = sub.add_parser(
        "live-run", help="연주 중 LLM 구간 코칭 워커(채보 모델 없이, 연주 코칭 큐만)"
    )
    _add_config_args(live)
    live.add_argument("--max-jobs", type=int, default=None, help="이만큼 처리하고 끝냄(시험용)")
    live.set_defaults(func=live_run_cmd)

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
