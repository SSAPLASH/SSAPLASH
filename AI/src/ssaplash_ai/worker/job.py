"""작업 실행기.

JobRunner.run(배정)이 작업 하나를 끝까지 처리함.
SEPARATING: 원곡 내려받기 → 음악 여부 검사(켜져 있을 때) → 분리 모듈 → flac 두 개 올리기 → 분리 결과 제출
  → 같은 claim 재조회 → TRANSCRIBING
TRANSCRIBING: 드럼 트랙 준비(로컬 파일 sha256이 같으면 그대로, 아니면 내려받기) → 채보 모듈 → 채보 결과 제출

끝나는 방식 세 가지(JobOutcome.status):
- DONE: 채보 결과가 인수됨
- FAILED_REPORTED: ChartError·워커 내부 예외를 `POST /failure`로 보고함. 사유는 예외의 reason
- ABANDONED: 임대 상실·409·422·전송 계층 실패·크기·sha256 불일치 재시도 소진. 보고 없이 놓음.
  임대가 끝나면 BE가 다시 배정함
401은 설정 오류라 밖(loop)으로 올림.
"""

from __future__ import annotations

import json
import logging
import shutil
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import requests

from ssaplash_ai.chart.errors import (
    REASON_INTERNAL_ERROR,
    ChartError,
    ChartInputError,
    ChartModelError,
    ChartOutputError,
)
from ssaplash_ai.chart.music_check import MusicCheckModule
from ssaplash_ai.chart.separation import SeparationModule, SeparationOutput
from ssaplash_ai.chart.transcription import TranscriptionModule, TranscriptionOutput
from ssaplash_ai.worker.api import (
    ROLE_ACCOMPANIMENT,
    ROLE_DRUM_STEM,
    ROLE_SOURCE_AUDIO,
    STAGE_SEPARATING,
    STAGE_TRANSCRIBING,
    ApiError,
    Assignment,
    FileGrant,
    WorkerApi,
)
from ssaplash_ai.worker.config import WorkerSettings
from ssaplash_ai.worker.heartbeat import EventSeq, Heartbeat
from ssaplash_ai.worker.payload import make_envelope
from ssaplash_ai.worker.transfer import (
    FLAC_CONTENT_TYPE,
    IntegrityError,
    TransferError,
    download,
    sha256_of,
    upload,
)

logger = logging.getLogger("ssaplash_ai.worker.job")

# 단계별 진행률 범위
PROGRESS_SOURCE_READY = 5
PROGRESS_UPLOADED = 47
PROGRESS_SEPARATION_SUBMIT = 48
PROGRESS_SEPARATION_ACCEPTED = 50
PROGRESS_DRUM_READY = 55
PROGRESS_TRANSCRIPTION_SUBMIT = 99
SEPARATION_STAGE_PROGRESS = {"LOAD_INPUT": 8, "SEPARATE": 40, "WRITE": 42}
TRANSCRIPTION_STAGE_PROGRESS = {"LOAD_INPUT": 58, "TRANSCRIBE": 90, "JSON": 95}

CONTRACT_VERSION = 1
CHART_SCHEMA_VERSION = 1
MAX_DURATION_MS = 600_000
# BE README: 분리 파일 한 개 상한 128MiB
MAX_OUTPUT_BYTES = 128 * 1024 * 1024
# 모듈은 MiB(resource_usage.MB = 1024²)로 재고 BE는 MB = 1,000,000바이트
MIB_TO_MB = 1.048576
# 서명 URL 재발급·재전송 횟수. 크기·sha256 불일치 다시 받기도 이 횟수 안에서
URL_RETRIES = 3
EXTENSIONS = {
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/wave": ".wav",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/flac": ".flac",
    "audio/x-flac": ".flac",
    # BE가 받는 MPEG-4 오디오(AAC·ALAC)와 Ogg Opus
    "audio/mp4": ".m4a",
    "audio/ogg": ".ogg",
}
STATUS_DONE = "DONE"
STATUS_FAILED_REPORTED = "FAILED_REPORTED"
STATUS_ABANDONED = "ABANDONED"
# 작업 폴더에 남기는 결과 메타(ssaplash-chart와 같은 이름). 시간·메모리 기록용, KEEP_FILES일 때 남음
SEPARATION_META = "separation.json"
TRANSCRIPTION_META = "transcription.json"


class JobAbandoned(Exception):
    """작업을 놓음. 실패 보고 없이 heartbeat를 멈추고 다음 claim으로."""


@dataclass
class JobOutcome:
    """작업 하나의 결과 요약(로그·테스트용)."""

    job_id: int
    attempt_id: str
    status: str
    detail: str = ""
    separate_ms: int | None = None
    transcribe_ms: int | None = None
    n_notes: int | None = None
    elapsed_sec: float = 0.0
    failure_code: str | None = None
    failure_reason: str | None = None
    progress_sent: list[int] = field(default_factory=list)


class JobRunner:
    """배정 하나를 끝까지 처리. 분리·채보 모델과 음악 여부 검사 모델은 밖(loop)에서 올려서 넘김.

    music_check를 주면 원곡을 내려받은 직후 분리 전에 음악 여부 검사를 함. 걸린 파일은 분리를 돌리지 않고
    NOT_TRANSCRIBABLE로 보고함. 검사 모델 자체가 실패하면 경고 로그만 남기고 분리로 넘어감.
    """

    def __init__(
        self,
        settings: WorkerSettings,
        api: WorkerApi,
        separation: SeparationModule,
        transcription: TranscriptionModule,
        session: requests.Session | None = None,
        heartbeat_factory: Callable[..., Heartbeat] = Heartbeat,
        music_check: MusicCheckModule | None = None,
        music_check_error: str | None = None,
    ) -> None:
        self.settings = settings
        self.api = api
        self.separation = separation
        self.transcription = transcription
        self.music_check = music_check
        # 워커 시작 때 검사 모델을 못 올린 사유. 있으면 작업마다 검사 없이 넘어간다는 경고를 남김
        self.music_check_error = music_check_error
        self.session = session or api.session
        self._heartbeat_factory = heartbeat_factory

    def run(self, assignment: Assignment, claim_request_id: str) -> JobOutcome:
        """배정 하나 처리. 401(ApiError)만 밖으로 올리고 나머지는 JobOutcome으로 정리."""
        started = time.perf_counter()
        job_id, attempt_id = assignment.job_id, assignment.attempt_id
        job_dir = self.settings.jobs_dir / f"{job_id}-{attempt_id[:8]}"
        job_dir.mkdir(parents=True, exist_ok=True)
        seq = EventSeq()
        stage = assignment.resume_stage
        initial = PROGRESS_SEPARATION_ACCEPTED if stage == STAGE_TRANSCRIBING else 0
        hb = self._heartbeat_factory(
            self.api, job_id, attempt_id, seq, self.settings.heartbeat_sec, initial
        )
        outcome = JobOutcome(job_id=job_id, attempt_id=attempt_id, status=STATUS_ABANDONED)
        logger.info(
            "작업 %d 시작 (attempt %s, %s, 곡 %d)",
            job_id,
            attempt_id[:8],
            stage,
            assignment.song_id,
        )
        hb.start()
        try:
            _check_contract(assignment)
            if stage == STAGE_SEPARATING:
                sep = self._separate(assignment, job_dir, hb)
                outcome.separate_ms = sep.separate_ms
                hb.set_progress(PROGRESS_SEPARATION_ACCEPTED)
                assignment = self._reclaim(claim_request_id, assignment)
                stage = STAGE_TRANSCRIBING
            elif stage != STAGE_TRANSCRIBING:
                raise JobAbandoned(f"모르는 resumeStage: {stage}")
            tr = self._transcribe(assignment, job_dir, hb)
            outcome.transcribe_ms = tr.transcribe_ms
            outcome.n_notes = tr.n_notes
            outcome.status = STATUS_DONE
        except ChartError as e:
            hb.stop()
            outcome.status = STATUS_FAILED_REPORTED
            outcome.failure_code = e.code
            outcome.failure_reason = e.reason
            outcome.detail = e.message
            self._report(assignment, seq, stage, e.code, e.retryable, e.message, e.reason)
        except JobAbandoned as e:
            outcome.detail = str(e)
            logger.warning("작업 %d 놓음: %s", job_id, e)
        except TransferError as e:
            outcome.detail = f"전송 실패: {e}"
            logger.warning("작업 %d 놓음 (전송 계층): %s", job_id, e)
        except ApiError as e:
            if e.status == 401:
                raise
            outcome.detail = f"BE 응답: {e}"
            logger.warning("작업 %d 놓음 (BE 응답): %s", job_id, e)
        except Exception as e:  # 워커 버그. 실패로 보고하고 루프는 계속
            hb.stop()
            logger.exception("작업 %d 처리 중 예외", job_id)
            summary = f"워커 내부 오류: {type(e).__name__}"
            outcome.status = STATUS_FAILED_REPORTED
            outcome.failure_code = "MODEL_FAILED"
            outcome.failure_reason = REASON_INTERNAL_ERROR
            outcome.detail = summary
            self._report(
                assignment, seq, stage, "MODEL_FAILED", False, summary, REASON_INTERNAL_ERROR
            )
        finally:
            hb.stop()
            outcome.progress_sent = list(hb.sent)
            outcome.elapsed_sec = time.perf_counter() - started
            self._cleanup(job_dir, outcome)
        logger.info(
            "작업 %d 끝: %s%s (%.1f초, 분리 %s ms, 채보 %s ms, 노트 %s)",
            job_id,
            outcome.status,
            f" ({outcome.detail})" if outcome.detail else "",
            outcome.elapsed_sec,
            outcome.separate_ms,
            outcome.transcribe_ms,
            outcome.n_notes,
        )
        return outcome

    # ---- SEPARATING ----

    def _separate(self, a: Assignment, job_dir: Path, hb: Heartbeat) -> SeparationOutput:
        inp = a.input
        if inp.role != ROLE_SOURCE_AUDIO:
            raise JobAbandoned(f"SEPARATING 배정의 입력 역할이 {inp.role}")
        duration = _check_duration(inp.duration_ms)
        source = job_dir / f"source{EXTENSIONS.get(inp.content_type.lower(), '.audio')}"
        self._download_with_reissue(
            a, ROLE_SOURCE_AUDIO, inp.file_id, source, inp.size_bytes, inp.sha256
        )
        hb.set_progress(PROGRESS_SOURCE_READY)
        _check_lease(hb)
        self._check_music(a, source)
        _check_lease(hb)

        out = self.separation.separate_file(
            source,
            job_dir,
            on_progress=_progress_callback(hb, SEPARATION_STAGE_PROGRESS),
            duration_ms=duration,
        )
        _write_meta(job_dir / SEPARATION_META, out.to_dict())
        _check_lease(hb)

        sizes = {
            ROLE_DRUM_STEM: out.drum_stem_path.stat().st_size,
            ROLE_ACCOMPANIMENT: out.accompaniment_path.stat().st_size,
        }
        for role, size in sizes.items():
            if size > MAX_OUTPUT_BYTES:
                raise ChartOutputError(f"{role} 파일이 상한 128MiB를 넘음: {size}바이트")
        hashes = {
            ROLE_DRUM_STEM: sha256_of(out.drum_stem_path),
            ROLE_ACCOMPANIMENT: sha256_of(out.accompaniment_path),
        }
        grants = self._upload_outputs(a, out, sizes)
        hb.set_progress(PROGRESS_UPLOADED)

        result = build_separation_result(out, duration, grants, sizes, hashes)
        hb.set_progress(PROGRESS_SEPARATION_SUBMIT)
        _check_lease(hb)
        envelope = make_envelope(a.job_id, a.attempt_id, str(uuid.uuid4()), result)
        receipt = self.api.submit_separation(a.job_id, envelope)
        if not receipt.accepted:
            raise JobAbandoned(f"분리 결과가 인수되지 않음 (jobStatus {receipt.job_status})")
        logger.info("작업 %d 분리 결과 인수 (revision %d)", a.job_id, receipt.revision)
        return out

    def _check_music(self, a: Assignment, source: Path) -> None:
        """분리 전 음악 여부 검사. 걸리면 ChartNotTranscribableError가 올라가 실패 보고로 끝남.

        원곡을 못 읽는 경우의 ChartInputError도 그대로 올림(분리 모듈이 같은 파일을 읽어도 같은 오류).
        분류 모델 실행이 실패하면(ChartModelError) 검사를 건너뛰고 분리로 넘어감.
        """
        if self.music_check is None or not self.music_check.enabled:
            if self.music_check_error:
                logger.warning(
                    "작업 %d 음악 여부 검사 없이 분리로 넘어감: 워커 시작 때 검사 모델을 올리지 못함 (%s)",
                    a.job_id,
                    self.music_check_error,
                )
            return
        try:
            result = self.music_check.check_file(source)
        except ChartModelError as e:
            logger.warning(
                "작업 %d 음악 여부 검사를 건너뛰고 분리로 넘어감: %s", a.job_id, e.message
            )
            return
        if result is not None:
            logger.info(
                "작업 %d 음악 여부 검사 통과: 음악 확률 %.2f, 말소리 확률 %.2f, %d ms",
                a.job_id,
                result.music_prob,
                result.speech_prob,
                result.check_ms,
            )

    def _upload_outputs(
        self, a: Assignment, out: SeparationOutput, sizes: dict[str, int]
    ) -> dict[str, FileGrant]:
        requested = [
            {"role": ROLE_DRUM_STEM, "sizeBytes": sizes[ROLE_DRUM_STEM]},
            {"role": ROLE_ACCOMPANIMENT, "sizeBytes": sizes[ROLE_ACCOMPANIMENT]},
        ]
        grants = {g.role: g for g in self.api.file_access(a.job_id, a.attempt_id, requested)}
        for role in (ROLE_DRUM_STEM, ROLE_ACCOMPANIMENT):
            if role not in grants or grants[role].method != "PUT":
                raise JobAbandoned(f"file-access 응답에 {role} PUT URL이 없음")
        paths = {ROLE_DRUM_STEM: out.drum_stem_path, ROLE_ACCOMPANIMENT: out.accompaniment_path}
        for role, path in paths.items():
            for attempt in range(URL_RETRIES):
                grant = grants[role]
                try:
                    upload(
                        self.session,
                        grant.url,
                        path,
                        content_type=FLAC_CONTENT_TYPE,
                        timeout_sec=self.settings.upload_timeout_sec,
                    )
                    break
                except TransferError as e:
                    if attempt == URL_RETRIES - 1:
                        raise
                    logger.warning(
                        "%s 올리기 실패(%s), 다시 시도 %d/%d", role, e, attempt + 2, URL_RETRIES
                    )
                    if e.needs_new_url:
                        # 같은 role·fileId·sizeBytes로 URL 재발급. 모델은 다시 돌리지 않음
                        reissued = self.api.file_access(
                            a.job_id,
                            a.attempt_id,
                            [{"role": role, "fileId": grant.file_id, "sizeBytes": sizes[role]}],
                        )
                        if not reissued:
                            raise JobAbandoned(f"{role} URL 재발급 응답이 비어 있음") from e
                        grants[role] = reissued[0]
        return grants

    def _reclaim(self, claim_request_id: str, previous: Assignment) -> Assignment:
        """분리 ACK 뒤 같은 claimRequestId로 재조회해 TRANSCRIBING 배정(드럼 체크포인트 fileId)을 받음."""
        current = self.api.claim(claim_request_id)
        if current is None or current.job_id != previous.job_id:
            raise JobAbandoned("분리 ACK 뒤 재조회에서 같은 작업이 오지 않음")
        if current.resume_stage != STAGE_TRANSCRIBING:
            raise JobAbandoned(f"재조회 resumeStage가 {current.resume_stage}")
        if current.attempt_id != previous.attempt_id:
            raise JobAbandoned("재조회 attempt가 바뀜")
        return current

    # ---- TRANSCRIBING ----

    def _transcribe(self, a: Assignment, job_dir: Path, hb: Heartbeat) -> TranscriptionOutput:
        inp = a.input
        if inp.role != ROLE_DRUM_STEM:
            raise JobAbandoned(f"TRANSCRIBING 배정의 입력 역할이 {inp.role}")
        duration = _check_duration(inp.duration_ms)
        drum = job_dir / "drums.flac"
        if _matches(drum, inp.size_bytes, inp.sha256):
            logger.info("작업 %d 로컬 드럼 트랙 재사용 (sha256 일치)", a.job_id)
        else:
            self._download_with_reissue(
                a, ROLE_DRUM_STEM, inp.file_id, drum, inp.size_bytes, inp.sha256
            )
        hb.set_progress(PROGRESS_DRUM_READY)
        _check_lease(hb)

        # 같은 작업에서 분리를 했으면 원곡이 작업 폴더에 남아 있어 박 추정에 씀. 채보만 다시 배정받았으면 없음
        sources = sorted(job_dir.glob("source.*"))
        beat_audio = sources[0] if sources else None
        out = self.transcription.transcribe_file(
            drum,
            job_dir,
            on_progress=_progress_callback(hb, TRANSCRIPTION_STAGE_PROGRESS),
            duration_ms=duration,
            beat_audio_path=beat_audio,
        )
        _write_meta(job_dir / TRANSCRIPTION_META, out.to_dict())
        hb.set_progress(PROGRESS_TRANSCRIPTION_SUBMIT)
        _check_lease(hb)
        envelope = make_envelope(a.job_id, a.attempt_id, str(uuid.uuid4()), out.chart)
        receipt = self.api.submit_transcription(a.job_id, envelope)
        if not receipt.accepted:
            raise JobAbandoned(f"채보 결과가 인수되지 않음 (jobStatus {receipt.job_status})")
        logger.info(
            "작업 %d 채보 결과 인수 (jobStatus %s, chartVersionIds %s)",
            a.job_id,
            receipt.job_status,
            list(receipt.chart_version_ids),
        )
        return out

    # ---- 공통 ----

    def _download_with_reissue(
        self, a: Assignment, role: str, file_id: str, dest: Path, size: int, sha256: str
    ) -> None:
        grant: FileGrant | None = None
        for attempt in range(URL_RETRIES):
            if grant is None:
                grants = self.api.file_access(
                    a.job_id, a.attempt_id, [{"role": role, "fileId": file_id}]
                )
                grant = next((g for g in grants if g.role == role and g.method == "GET"), None)
                if grant is None:
                    raise JobAbandoned(f"file-access 응답에 {role} GET URL이 없음")
            try:
                download(
                    self.session,
                    grant.url,
                    dest,
                    expected_size=size,
                    expected_sha256=sha256,
                    timeout_sec=self.settings.download_timeout_sec,
                )
                return
            except IntegrityError as e:
                # 다운로드가 잘렸거나 스토리지 파일이 바뀐 경우. 같은 URL로 다시 받음
                logger.warning(
                    "작업 %d 파일 불일치 %d/%d: attempt %s, %s, 크기 %d (배정 %d), "
                    "sha256 %s (배정 %s)",
                    a.job_id,
                    attempt + 1,
                    URL_RETRIES,
                    a.attempt_id,
                    role,
                    e.actual_size,
                    e.expected_size,
                    e.actual_sha256[:12],
                    e.expected_sha256[:12],
                )
                if attempt == URL_RETRIES - 1:
                    logger.error(
                        "작업 %d %s 파일이 %d번 다 배정과 달라 작업을 놓음 (attempt %s)",
                        a.job_id,
                        role,
                        URL_RETRIES,
                        a.attempt_id,
                    )
                    raise JobAbandoned(f"{role} 파일 불일치 {URL_RETRIES}번") from e
            except TransferError as e:
                if attempt == URL_RETRIES - 1:
                    raise
                logger.warning(
                    "%s 내려받기 실패(%s), 다시 시도 %d/%d", role, e, attempt + 2, URL_RETRIES
                )
                if e.needs_new_url:
                    grant = None

    def _report(
        self,
        a: Assignment,
        seq: EventSeq,
        stage: str,
        code: str,
        retryable: bool,
        summary: str,
        reason: str,
    ) -> None:
        try:
            outcome = self.api.report_failure(
                a.job_id, a.attempt_id, seq.next(), stage, code, retryable, summary, reason
            )
            logger.warning(
                "작업 %d 실패 보고: %s %s %s retryable=%s → BE %s",
                a.job_id,
                stage,
                code,
                reason,
                retryable,
                outcome.status,
            )
        except ApiError as e:
            if e.status == 401:
                raise
            logger.warning("작업 %d 실패 보고가 거절됨: %s", a.job_id, e)

    def _cleanup(self, job_dir: Path, outcome: JobOutcome) -> None:
        if self.settings.keep_files:
            logger.info("작업 폴더 유지: %s", job_dir)
            return
        shutil.rmtree(job_dir, ignore_errors=True)


def build_separation_result(
    out: SeparationOutput,
    duration_ms: int,
    grants: dict[str, FileGrant],
    sizes: dict[str, int],
    hashes: dict[str, str],
) -> dict:
    """SeparationOutput → BE SeparationResult. 메모리는 MiB → MB."""
    return {
        "drumStem": _manifest(
            grants[ROLE_DRUM_STEM], sizes[ROLE_DRUM_STEM], hashes[ROLE_DRUM_STEM]
        ),
        "accompaniment": _manifest(
            grants[ROLE_ACCOMPANIMENT], sizes[ROLE_ACCOMPANIMENT], hashes[ROLE_ACCOMPANIMENT]
        ),
        "durationMs": int(duration_ms),
        "audioTimeOrigin": out.audio_time_origin,
        "model": {"name": out.model_name, "version": out.model_version},
        "metrics": {
            "loadMs": int(out.load_ms),
            "separateMs": int(out.separate_ms),
            "peakVramMb": mib_to_mb(out.peak_vram_mb),
            "peakRamMb": mib_to_mb(out.peak_ram_mb),
        },
    }


def mib_to_mb(value: float | None) -> float | None:
    """모듈이 잰 MiB → BE가 요구하는 MB(1,000,000바이트). 소수 첫째 자리."""
    return None if value is None else round(float(value) * MIB_TO_MB, 1)


def _manifest(grant: FileGrant, size: int, sha256: str) -> dict:
    return {
        "fileId": grant.file_id,
        "contentType": FLAC_CONTENT_TYPE,
        "sizeBytes": int(size),
        "sha256": sha256.lower(),
    }


def _check_contract(a: Assignment) -> None:
    if a.contract_version != CONTRACT_VERSION:
        raise JobAbandoned(f"contractVersion {a.contract_version}은 처리 못 함")
    if (
        a.accepted_chart_schema_versions
        and CHART_SCHEMA_VERSION not in a.accepted_chart_schema_versions
    ):
        raise JobAbandoned(f"BE가 받는 채보 schemaVersion에 {CHART_SCHEMA_VERSION}이 없음")


def _check_duration(duration_ms: int) -> int:
    if duration_ms <= 0 or duration_ms > MAX_DURATION_MS:
        raise ChartInputError(f"배정 원곡 길이가 범위 밖: {duration_ms} ms (1~{MAX_DURATION_MS})")
    return duration_ms


def _check_lease(hb: Heartbeat) -> None:
    if hb.lease_lost:
        raise JobAbandoned("임대 상실 (heartbeat 거절)")


def _write_meta(path: Path, meta: dict) -> None:
    """결과 메타를 작업 폴더에 JSON으로. 실패해도 작업은 계속(로그만)."""
    try:
        path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except OSError as e:
        logger.warning("결과 메타를 쓰지 못함: %s (%s)", path.name, e)


def _matches(path: Path, size: int, sha256: str) -> bool:
    return path.is_file() and path.stat().st_size == size and sha256_of(path) == sha256.lower()


def _progress_callback(hb: Heartbeat, table: dict[str, int]) -> Callable[[str, float], None]:
    def callback(stage: str, fraction: float) -> None:
        if fraction >= 1.0 and stage in table:
            hb.set_progress(table[stage])

    return callback
