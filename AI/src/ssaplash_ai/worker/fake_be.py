"""테스트·로컬 확인용 BE 대역. 개발용이며 운영 코드가 아님.

BE 워커 API 6개와 저장소 GET/PUT을 FastAPI 앱 하나로 흉내 냄. 상태는 메모리.
토큰·attempt·임대·eventSeq·payloadHash·flac 형식과 길이·채보 JSON을 BE처럼 검사하고 고장 주입(Faults)을 지원함.
실제 BE의 DB 잠금·탈퇴·정리는 재현하지 않음.
"""

from __future__ import annotations

import dataclasses
import io
import json
import logging
import math
import socket
import sys
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import soundfile as sf
import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from ssaplash_ai.chart.audio_io import probe
from ssaplash_ai.chart.chart_json import validate_chart
from ssaplash_ai.chart.errors import REASONS, ChartError
from ssaplash_ai.worker.payload import payload_hash

logger = logging.getLogger("ssaplash_ai.worker.fake_be")

FAKE_TOKEN = "fake-be-token-0123456789abcdef0123456789abcdef"
API_PREFIX = "/internal/v1/chart-jobs"
STORAGE_PREFIX = "/storage"
DEFAULT_WORKER_ID = "worker1"
LEASE_SEC = 60.0
SAMPLE_RATE = 44100
STATUS_QUEUED = "QUEUED"
STATUS_SEPARATING = "SEPARATING"
STATUS_TRANSCRIBING = "TRANSCRIBING"
STATUS_DONE = "DONE"
STATUS_FAILED = "FAILED"
FINISHED = (STATUS_DONE, STATUS_FAILED)
MAX_RETRIES_PER_STAGE = 2


class Rejected(Exception):
    """HTTP 오류 응답. status와 BE식 오류 코드."""

    def __init__(self, status: int, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.status = status
        self.code = code
        self.message = message or code


@dataclass
class Faults:
    """테스트용 고장 주입. 이름이 _once로 끝나는 것은 한 번 쓰이면 꺼지고 heartbeat_409는 계속 켜져 있음."""

    put_403_once: bool = False
    submit_503_once: bool = False
    heartbeat_409: bool = False
    get_403_once: bool = False
    # 내려받기 응답을 한 번 절반만 줌. 다운로드가 잘린 경우
    get_truncated_once: bool = False


@dataclass
class StoredFile:
    file_id: str
    role: str
    data: bytes | None = None
    expected_size: int | None = None  # PUT 발급 때 워커가 알린 크기
    content_type: str = "audio/flac"

    @property
    def size(self) -> int:
        return len(self.data) if self.data is not None else 0

    @property
    def sha256(self) -> str:
        import hashlib

        return hashlib.sha256(self.data or b"").hexdigest()


@dataclass
class FakeJob:
    job_id: int
    song_id: int
    source: StoredFile
    duration_ms: int
    status: str = STATUS_QUEUED
    attempt_id: str | None = None
    claim_request_id: str | None = None
    lease_until: float = 0.0
    last_seq: int = 0
    progress: int = 0
    revision: int = 0
    attempts_in_stage: int = 0
    drum_checkpoint: StoredFile | None = None
    staging: dict[str, StoredFile] = field(default_factory=dict)
    receipts: dict[str, tuple[str, dict]] = field(default_factory=dict)
    separation_result: dict | None = None
    transcription_result: dict | None = None
    events: list[dict] = field(default_factory=list)
    # 마지막 실패 보고의 reason. 재시도를 다 써 FAILED가 돼도 남김
    failure_reason: str | None = None
    chart_version_ids: list[int] = field(default_factory=list)

    @property
    def stage(self) -> str:
        return STATUS_TRANSCRIBING if self.drum_checkpoint is not None else STATUS_SEPARATING


class FakeBackend:
    """상태와 규칙. FastAPI 앱은 build_app()이 만듦."""

    def __init__(
        self,
        out_dir: Path | None = None,
        worker_id: str = DEFAULT_WORKER_ID,
        token: str = FAKE_TOKEN,
        faults: Faults | None = None,
        lease_sec: float = LEASE_SEC,
        clock=time.monotonic,
    ) -> None:
        self.out_dir = Path(out_dir) if out_dir else None
        self.worker_id = worker_id
        self.token = token
        self.faults = faults or Faults()
        self.lease_sec = lease_sec
        self.clock = clock
        self.jobs: dict[int, FakeJob] = {}
        self.files: dict[str, StoredFile] = {}
        self._lock = threading.RLock()
        self._next_job = 1
        self._next_chart_version = 1
        self.requests: list[tuple[str, int]] = []  # (경로, 상태) 기록

    # ---- 큐 ----

    def enqueue(
        self, path: str | Path, duration_ms: int | None = None, song_id: int | None = None
    ) -> int:
        """원곡 파일을 작업으로 넣음. duration_ms가 없으면 파일 길이를 ms로 올림."""
        path = Path(path)
        data = path.read_bytes()
        if duration_ms is None:
            info = probe(path)  # m4a처럼 soundfile이 못 여는 형식도 길이를 읽음
            duration_ms = -(-info.frames * 1000 // info.sample_rate)
        with self._lock:
            job_id = self._next_job
            self._next_job += 1
            source = StoredFile(
                file_id=str(uuid.uuid4()),
                role="SOURCE_AUDIO",
                data=data,
                content_type=_content_type(path),
            )
            self.files[source.file_id] = source
            self.jobs[job_id] = FakeJob(
                job_id=job_id, song_id=song_id or job_id, source=source, duration_ms=duration_ms
            )
        return job_id

    def all_finished(self) -> bool:
        with self._lock:
            return bool(self.jobs) and all(j.status in FINISHED for j in self.jobs.values())

    def summary_lines(self) -> list[str]:
        lines = []
        for job in self.jobs.values():
            notes = (
                len(job.transcription_result["charts"][0]["notes"])
                if job.transcription_result
                else "-"
            )
            lines.append(
                f"작업 {job.job_id}: {job.status}, 길이 {job.duration_ms} ms, 진행률 {job.progress}, "
                f"노트 {notes}, 이벤트 {len(job.events)}개"
            )
        return lines

    # ---- 공통 검사 ----

    def _auth(self, request: Request) -> None:
        header = request.headers.get("authorization", "")
        if header != f"Bearer {self.token}":
            raise Rejected(401, "UNAUTHORIZED", "토큰 불일치")

    def _job(self, job_id: int) -> FakeJob:
        job = self.jobs.get(job_id)
        if job is None:
            raise Rejected(404, "JOB_NOT_FOUND")
        return job

    def _attempt(self, job: FakeJob, attempt_id: str) -> None:
        if job.attempt_id is None or job.attempt_id != attempt_id:
            raise Rejected(409, "ATTEMPT_MISMATCH", "다른 attempt")
        if self.clock() > job.lease_until:
            raise Rejected(409, "LEASE_EXPIRED", "임대 만료")
        if job.status in FINISHED:
            raise Rejected(409, "JOB_FINISHED")

    def _lease_iso(self, job: FakeJob) -> str:
        remaining = max(0.0, job.lease_until - self.clock())
        return (datetime.now(UTC) + timedelta(seconds=remaining)).strftime("%Y-%m-%dT%H:%M:%SZ")

    # ---- 6개 API ----

    def claim(self, body: dict) -> tuple[int, dict | None]:
        worker_id = body.get("workerId")
        claim_request_id = str(body.get("claimRequestId", ""))
        if worker_id != self.worker_id:
            raise Rejected(400, "WORKER_INVALID", "등록되지 않은 workerId")
        if not claim_request_id:
            raise Rejected(400, "CLAIM_REQUEST_INVALID")
        now = self.clock()
        with self._lock:
            # 같은 요청 ID 재조회: 유효하면 현재 배정, 만료면 409
            for job in self.jobs.values():
                if job.claim_request_id == claim_request_id:
                    if job.status in FINISHED or now > job.lease_until:
                        raise Rejected(409, "CLAIM_EXPIRED")
                    return 200, self._assignment(job)
            # 새 배정: 대기 작업 또는 임대 만료 작업
            for job in self.jobs.values():
                expired = (
                    job.status in (STATUS_SEPARATING, STATUS_TRANSCRIBING) and now > job.lease_until
                )
                if job.status == STATUS_QUEUED or expired:
                    if expired:
                        job.attempts_in_stage += 1
                        if job.attempts_in_stage > MAX_RETRIES_PER_STAGE:
                            job.status = STATUS_FAILED
                            job.events.append({"type": "FAILED", "reason": "RETRY_EXHAUSTED"})
                            continue
                        job.staging.clear()
                    job.attempt_id = str(uuid.uuid4())
                    job.claim_request_id = claim_request_id
                    job.lease_until = now + self.lease_sec
                    job.last_seq = 0
                    job.status = job.stage
                    job.revision += 1
                    job.events.append(
                        {"type": "CLAIM", "attempt": job.attempt_id, "stage": job.status}
                    )
                    return 200, self._assignment(job)
        return 204, None

    def _assignment(self, job: FakeJob) -> dict:
        source = job.drum_checkpoint if job.drum_checkpoint is not None else job.source
        return {
            "contractVersion": 1,
            "jobId": job.job_id,
            "songId": job.song_id,
            "attemptId": job.attempt_id,
            "resumeStage": job.stage,
            "input": {
                "role": source.role,
                "fileId": source.file_id,
                "contentType": source.content_type,
                "sizeBytes": source.size,
                "sha256": source.sha256,
                "durationMs": job.duration_ms,
            },
            "requestedDifficulties": ["NORMAL"],
            "acceptedChartSchemaVersions": [1],
            "leaseExpiresAt": self._lease_iso(job),
            "stageDeadlineAt": (
                datetime.now(UTC) + timedelta(seconds=job.duration_ms / 1000 * 2 + 60)
            ).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }

    def heartbeat(self, job_id: int, body: dict) -> dict:
        with self._lock:
            job = self._job(job_id)
            if self.faults.heartbeat_409:
                raise Rejected(409, "LEASE_EXPIRED", "고장 주입")
            self._attempt(job, str(body.get("attemptId")))
            seq = int(body.get("eventSeq", 0))
            if seq > job.last_seq:
                job.last_seq = seq
                job.progress = int(body.get("progress", job.progress))
                job.lease_until = self.clock() + self.lease_sec
                job.events.append({"type": "HEARTBEAT", "seq": seq, "progress": job.progress})
            return {"leaseExpiresAt": self._lease_iso(job)}

    def file_access(self, job_id: int, body: dict, base_url: str) -> dict:
        with self._lock:
            job = self._job(job_id)
            self._attempt(job, str(body.get("attemptId")))
            grants = []
            for item in body.get("files", []):
                role = str(item.get("role"))
                file_id = item.get("fileId")
                size = item.get("sizeBytes")
                if role == "SOURCE_AUDIO":
                    if file_id != job.source.file_id:
                        raise Rejected(400, "FILE_INVALID", "원곡 fileId 불일치")
                    grants.append(self._grant(job.source, "GET", base_url))
                elif (
                    role == "DRUM_STEM"
                    and file_id is not None
                    and (job.drum_checkpoint is not None and file_id == job.drum_checkpoint.file_id)
                ):
                    grants.append(self._grant(job.drum_checkpoint, "GET", base_url))
                elif role in ("DRUM_STEM", "ACCOMPANIMENT"):
                    if size is None or int(size) <= 0:
                        raise Rejected(400, "SIZE_REQUIRED", f"{role} sizeBytes 필요")
                    if file_id is not None and str(file_id) in job.staging:
                        staged = job.staging[str(file_id)]
                        if staged.expected_size != int(size):
                            raise Rejected(400, "SIZE_MISMATCH")
                    else:
                        staged = StoredFile(
                            file_id=str(uuid.uuid4()), role=role, expected_size=int(size)
                        )
                        job.staging[staged.file_id] = staged
                        self.files[staged.file_id] = staged
                    grants.append(self._grant(staged, "PUT", base_url))
                else:
                    raise Rejected(400, "ROLE_INVALID", f"모르는 역할 {role}")
            job.events.append(
                {"type": "FILE_ACCESS", "files": [g["role"] + ":" + g["method"] for g in grants]}
            )
            return {"files": grants}

    def _grant(self, stored: StoredFile, method: str, base_url: str) -> dict:
        sig = uuid.uuid4().hex
        return {
            "role": stored.role,
            "fileId": stored.file_id,
            "method": method,
            "url": f"{base_url.rstrip('/')}{STORAGE_PREFIX}/{stored.file_id}?X-Amz-Signature={sig}",
            "expiresAt": (datetime.now(UTC) + timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }

    def storage_get(self, file_id: str) -> StoredFile:
        with self._lock:
            if self.faults.get_403_once:
                self.faults.get_403_once = False
                raise Rejected(403, "FORBIDDEN", "고장 주입")
            stored = self.files.get(file_id)
            if stored is None or stored.data is None:
                raise Rejected(404, "NOT_FOUND")
            if self.faults.get_truncated_once:
                self.faults.get_truncated_once = False
                return dataclasses.replace(stored, data=stored.data[: len(stored.data) // 2])
            return stored

    def storage_put(
        self, file_id: str, data: bytes, content_type: str, content_length: str | None
    ) -> None:
        with self._lock:
            if self.faults.put_403_once:
                self.faults.put_403_once = False
                raise Rejected(403, "FORBIDDEN", "고장 주입")
            stored = self.files.get(file_id)
            if stored is None or stored.expected_size is None:
                raise Rejected(404, "NOT_FOUND")
            if content_type.split(";")[0].strip() != "audio/flac":
                raise Rejected(400, "CONTENT_TYPE", f"Content-Type {content_type}")
            if content_length is None or int(content_length) != stored.expected_size:
                raise Rejected(400, "CONTENT_LENGTH", "Content-Length가 발급 때 크기와 다름")
            if len(data) != stored.expected_size:
                raise Rejected(400, "SIZE_MISMATCH")
            stored.data = data

    def submit_separation(self, job_id: int, raw: bytes) -> dict:
        with self._lock:
            job = self._job(job_id)
            if self.faults.submit_503_once:
                self.faults.submit_503_once = False
                raise Rejected(503, "UNAVAILABLE", "고장 주입")
            envelope, result = self._envelope(job, raw)
            cached = self._replay(job, envelope)
            if cached is not None:
                return cached
            if job.stage != STATUS_SEPARATING:
                raise Rejected(409, "STAGE_MISMATCH")
            try:
                drum = self._check_manifest(job, result.get("drumStem"), "DRUM_STEM")
                accomp = self._check_manifest(job, result.get("accompaniment"), "ACCOMPANIMENT")
                _require(int(result.get("durationMs", -1)) == job.duration_ms, "durationMs 불일치")
                _require(result.get("audioTimeOrigin") == "SOURCE_START", "audioTimeOrigin")
                model = result.get("model") or {}
                _require(
                    isinstance(model.get("name"), str) and isinstance(model.get("version"), str),
                    "model",
                )
                metrics = result.get("metrics") or {}
                for key in ("loadMs", "separateMs"):
                    _require(_is_nonneg_int(metrics.get(key)), f"metrics.{key}")
                for key in ("peakVramMb", "peakRamMb"):
                    value = metrics.get(key)
                    _require(
                        value is None or (isinstance(value, (int, Decimal)) and value >= 0),
                        f"metrics.{key}",
                    )
                for stored in (drum, accomp):
                    _check_flac(stored.data or b"", job.duration_ms)
            except Rejected:
                job.status = STATUS_FAILED
                job.events.append({"type": "FAILED", "reason": "SEPARATION_INVALID"})
                raise
            checkpoint = StoredFile(file_id=str(uuid.uuid4()), role="DRUM_STEM", data=drum.data)
            self.files[checkpoint.file_id] = checkpoint
            job.drum_checkpoint = checkpoint
            job.separation_result = _plain(result)
            job.status = STATUS_TRANSCRIBING
            job.attempts_in_stage = 0
            job.progress = max(job.progress, 50)
            job.revision += 1
            job.events.append({"type": "SEPARATION_ACCEPTED"})
            self._save(job, "drums.flac", drum.data)
            self._save(job, "accompaniment.flac", accomp.data)
            self._save_json(job, "separation_result.json", job.separation_result)
            receipt = self._receipt(job, envelope["resultId"], [])
            job.receipts[envelope["resultId"]] = (envelope["payloadHash"], receipt)
            return receipt

    def submit_transcription(self, job_id: int, raw: bytes) -> dict:
        with self._lock:
            job = self._job(job_id)
            if self.faults.submit_503_once:
                self.faults.submit_503_once = False
                raise Rejected(503, "UNAVAILABLE", "고장 주입")
            envelope, result = self._envelope(job, raw)
            cached = self._replay(job, envelope)
            if cached is not None:
                return cached
            if job.stage != STATUS_TRANSCRIBING:
                raise Rejected(409, "STAGE_MISMATCH")
            plain = _plain(result)
            try:
                validate_chart(plain, job.duration_ms)
                _require(plain.get("generator") == "ADT_MODEL", "generator")
                _require(1 <= len(str(plain.get("generatorVersion", ""))) <= 50, "generatorVersion")
                _require(isinstance(plain.get("metrics"), dict), "metrics")
            except ChartError as e:
                job.status = STATUS_FAILED
                job.events.append({"type": "FAILED", "reason": "TRANSCRIPTION_INVALID"})
                raise Rejected(422, "RESULT_INVALID", e.message) from e
            except Rejected:
                job.status = STATUS_FAILED
                job.events.append({"type": "FAILED", "reason": "TRANSCRIPTION_INVALID"})
                raise
            job.transcription_result = plain
            job.status = STATUS_DONE
            job.progress = 100
            job.revision += 1
            version_id = self._next_chart_version
            self._next_chart_version += 1
            job.chart_version_ids = [version_id]
            job.events.append({"type": "TRANSCRIPTION_ACCEPTED", "chartVersionId": version_id})
            self._save_json(job, "chart.json", plain)
            receipt = self._receipt(job, envelope["resultId"], job.chart_version_ids)
            job.receipts[envelope["resultId"]] = (envelope["payloadHash"], receipt)
            return receipt

    def failure(self, job_id: int, body: dict) -> dict:
        with self._lock:
            job = self._job(job_id)
            self._attempt(job, str(body.get("attemptId")))
            seq = int(body.get("eventSeq", 0))
            if seq <= job.last_seq:
                raise Rejected(409, "EVENT_SEQ_STALE")
            job.last_seq = seq
            code = str(body.get("code"))
            retryable = bool(body.get("retryable"))
            summary = str(body.get("summary", ""))
            if code not in ("INPUT_INVALID", "MODEL_FAILED", "OUTPUT_INVALID"):
                raise Rejected(400, "CODE_INVALID")
            if retryable and code != "MODEL_FAILED":
                raise Rejected(400, "RETRYABLE_INVALID")
            if len(summary) > 200 or "\n" in summary:
                raise Rejected(400, "SUMMARY_INVALID")
            reason = body.get("reason")
            if reason is not None and reason not in REASONS:
                raise Rejected(400, "REASON_INVALID")
            job.events.append(
                {
                    "type": "FAILURE",
                    "stage": body.get("stage"),
                    "code": code,
                    "retryable": retryable,
                    "summary": summary,
                    "reason": reason,
                }
            )
            if reason is not None:
                job.failure_reason = reason
            job.attempt_id = None
            job.claim_request_id = None
            job.revision += 1
            if retryable and job.attempts_in_stage < MAX_RETRIES_PER_STAGE:
                job.attempts_in_stage += 1
                job.status = STATUS_QUEUED
            else:
                job.status = STATUS_FAILED
            return {"status": job.status, "revision": job.revision}

    # ---- 결과 공통 ----

    def _envelope(self, job: FakeJob, raw: bytes) -> tuple[dict, dict]:
        try:
            envelope = json.loads(raw.decode("utf-8"), parse_float=Decimal, parse_int=Decimal)
        except (UnicodeDecodeError, ValueError) as e:
            raise Rejected(400, "BODY_INVALID", str(e)) from e
        if not isinstance(envelope, dict):
            raise Rejected(400, "BODY_INVALID")
        _require(int(envelope.get("contractVersion", 0)) == 1, "contractVersion", 400)
        _require(int(envelope.get("jobId", -1)) == job.job_id, "jobId", 400)
        result = envelope.get("result")
        _require(isinstance(result, dict), "result", 400)
        _require(
            isinstance(envelope.get("resultId"), str) and envelope["resultId"], "resultId", 400
        )
        self._attempt(job, str(envelope.get("attemptId")))
        if payload_hash(result) != str(envelope.get("payloadHash", "")).lower():
            raise Rejected(422, "PAYLOAD_HASH_MISMATCH", "payloadHash가 result와 다름")
        return envelope, result

    def _replay(self, job: FakeJob, envelope: dict) -> dict | None:
        seen = job.receipts.get(envelope["resultId"])
        if seen is None:
            return None
        digest, receipt = seen
        if digest != envelope["payloadHash"]:
            raise Rejected(409, "RESULT_CONFLICT", "같은 resultId에 다른 내용")
        return receipt

    def _check_manifest(self, job: FakeJob, manifest: Any, role: str) -> StoredFile:
        _require(isinstance(manifest, dict), f"{role} manifest")
        stored = job.staging.get(str(manifest.get("fileId")))
        _require(
            stored is not None and stored.role == role and stored.data is not None,
            f"{role} 파일이 올라오지 않음",
        )
        assert stored is not None
        _require(manifest.get("contentType") == "audio/flac", f"{role} contentType")
        _require(int(manifest.get("sizeBytes", -1)) == stored.size, f"{role} sizeBytes 불일치")
        _require(str(manifest.get("sha256", "")).lower() == stored.sha256, f"{role} sha256 불일치")
        return stored

    def _receipt(self, job: FakeJob, result_id: str, chart_version_ids: list[int]) -> dict:
        return {
            "resultId": result_id,
            "accepted": True,
            "jobStatus": job.status,
            "revision": job.revision,
            "chartVersionIds": list(chart_version_ids),
        }

    def _save(self, job: FakeJob, name: str, data: bytes | None) -> None:
        if self.out_dir is None or data is None:
            return
        target = self.out_dir / f"job-{job.job_id}" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def _save_json(self, job: FakeJob, name: str, value: dict) -> None:
        if self.out_dir is None:
            return
        target = self.out_dir / f"job-{job.job_id}" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# ---- FastAPI 앱 ----


def build_app(backend: FakeBackend) -> FastAPI:
    app = FastAPI(title="SSAPLASH fake BE")

    def _error(e: Rejected) -> JSONResponse:
        return JSONResponse({"code": e.code, "message": e.message}, status_code=e.status)

    async def _body(request: Request) -> dict:
        raw = await request.body()
        try:
            data = json.loads(raw.decode("utf-8")) if raw else {}
        except (UnicodeDecodeError, ValueError) as e:
            raise Rejected(400, "BODY_INVALID", str(e)) from e
        return data if isinstance(data, dict) else {}

    @app.post(f"{API_PREFIX}/claim")
    async def claim(request: Request):
        try:
            backend._auth(request)
            status, body = backend.claim(await _body(request))
        except Rejected as e:
            return _error(e)
        if status == 204:
            return Response(status_code=204)
        return JSONResponse(body, status_code=200)

    @app.post(f"{API_PREFIX}/{{job_id}}/heartbeat")
    async def heartbeat(job_id: int, request: Request):
        try:
            backend._auth(request)
            return JSONResponse(backend.heartbeat(job_id, await _body(request)))
        except Rejected as e:
            return _error(e)

    @app.post(f"{API_PREFIX}/{{job_id}}/file-access")
    async def file_access(job_id: int, request: Request):
        try:
            backend._auth(request)
            return JSONResponse(
                backend.file_access(job_id, await _body(request), str(request.base_url))
            )
        except Rejected as e:
            return _error(e)

    @app.post(f"{API_PREFIX}/{{job_id}}/results/separation")
    async def results_separation(job_id: int, request: Request):
        try:
            backend._auth(request)
            return JSONResponse(backend.submit_separation(job_id, await request.body()))
        except Rejected as e:
            return _error(e)

    @app.post(f"{API_PREFIX}/{{job_id}}/results/transcription")
    async def results_transcription(job_id: int, request: Request):
        try:
            backend._auth(request)
            return JSONResponse(backend.submit_transcription(job_id, await request.body()))
        except Rejected as e:
            return _error(e)

    @app.post(f"{API_PREFIX}/{{job_id}}/failure")
    async def failure(job_id: int, request: Request):
        try:
            backend._auth(request)
            return JSONResponse(backend.failure(job_id, await _body(request)))
        except Rejected as e:
            return _error(e)

    @app.get(f"{STORAGE_PREFIX}/{{file_id}}")
    async def storage_get(file_id: str):
        try:
            stored = backend.storage_get(file_id)
        except Rejected as e:
            return _error(e)
        return Response(content=stored.data, media_type=stored.content_type)

    @app.put(f"{STORAGE_PREFIX}/{{file_id}}")
    async def storage_put(file_id: str, request: Request):
        data = await request.body()
        try:
            backend.storage_put(
                file_id,
                data,
                request.headers.get("content-type", ""),
                request.headers.get("content-length"),
            )
        except Rejected as e:
            return _error(e)
        return Response(status_code=200)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    return app


class FakeBackendServer:
    """uvicorn을 스레드에 띄움. 테스트와 serve()가 같이 씀."""

    def __init__(
        self, backend: FakeBackend, host: str = "127.0.0.1", port: int | None = None
    ) -> None:
        self.backend = backend
        self.host = host
        self.port = port if port is not None else free_port(host)
        self.app = build_app(backend)
        config = uvicorn.Config(
            self.app, host=host, port=self.port, log_level="warning", access_log=False
        )
        self.server = uvicorn.Server(config)
        self._thread = threading.Thread(target=self.server.run, name="fake-be", daemon=True)

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"

    def start(self, timeout_sec: float = 15.0) -> None:
        self._thread.start()
        deadline = time.monotonic() + timeout_sec
        while not self.server.started:
            if time.monotonic() > deadline:
                raise RuntimeError("fake BE가 시간 안에 뜨지 않음")
            time.sleep(0.02)

    def stop(self) -> None:
        self.server.should_exit = True
        self._thread.join(timeout=10)

    def __enter__(self) -> FakeBackendServer:
        self.start()
        return self

    def __exit__(self, *exc) -> None:
        self.stop()


def free_port(host: str = "127.0.0.1") -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((host, 0))
        return s.getsockname()[1]


def serve(
    songs: list[str],
    host: str = "127.0.0.1",
    port: int = 8800,
    out_dir: str | None = "data/fake_be",
    duration_ms: int | None = None,
    worker_id: str = DEFAULT_WORKER_ID,
) -> int:
    """명령줄용. 곡을 작업으로 넣고 모두 끝날 때까지 띄움. 종료 코드 0이면 전부 DONE."""
    if not songs:
        print("--song으로 원곡 파일을 하나 이상 넘겨야 함", file=sys.stderr)
        return 1
    backend = FakeBackend(out_dir=Path(out_dir) if out_dir else None, worker_id=worker_id)
    for song in songs:
        job_id = backend.enqueue(song, duration_ms)
        print(
            f"작업 {job_id}: {song} (길이 {backend.jobs[job_id].duration_ms} ms)", file=sys.stderr
        )
    server = FakeBackendServer(backend, host=host, port=port)
    server.start()
    print("fake BE 시작. 워커 환경 변수:", file=sys.stderr)
    print(f"  SSAPLASH_WORKER_BASE_URL={server.base_url}", file=sys.stderr)
    print(f"  SSAPLASH_WORKER_ID={worker_id}", file=sys.stderr)
    print(f"  SSAPLASH_WORKER_TOKEN={FAKE_TOKEN}", file=sys.stderr)
    print("작업이 모두 끝나면 종료함. Ctrl+C로 중단", file=sys.stderr)
    try:
        while not backend.all_finished():
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("중단", file=sys.stderr)
    finally:
        server.stop()
    for line in backend.summary_lines():
        print(line)
    return 0 if all(j.status == STATUS_DONE for j in backend.jobs.values()) else 1


# ---- 검사 도구 ----


def _require(condition: bool, what: str, status: int = 422) -> None:
    if not condition:
        raise Rejected(status, "RESULT_INVALID", what)


def _is_nonneg_int(value: Any) -> bool:
    return (
        isinstance(value, (int, Decimal))
        and not isinstance(value, bool)
        and value >= 0
        and value == int(value)
    )


def _check_flac(data: bytes, duration_ms: int) -> None:
    """BE 길이 검사 재현: flac 16비트 44,100Hz 스테레오, 길이를 ms로 올림하면 durationMs."""
    try:
        info = sf.info(io.BytesIO(data))
    except Exception as e:
        raise Rejected(422, "RESULT_INVALID", f"flac을 읽지 못함: {e}") from e
    _require(info.format == "FLAC" and info.subtype == "PCM_16", "flac 16비트가 아님")
    _require(info.samplerate == SAMPLE_RATE and info.channels == 2, "44,100Hz 스테레오가 아님")
    actual_ms = math.ceil(info.frames * 1000 / info.samplerate)
    _require(
        actual_ms == duration_ms, f"flac 길이 {actual_ms} ms가 durationMs {duration_ms}와 다름"
    )


def _plain(value: Any) -> Any:
    """Decimal → int 또는 float. 저장·validate_chart용."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, list):
        return [_plain(v) for v in value]
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    return value


def _content_type(path: Path) -> str:
    return {
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".flac": "audio/flac",
        ".m4a": "audio/mp4",
        ".ogg": "audio/ogg",
        ".opus": "audio/ogg",
    }.get(path.suffix.lower(), "application/octet-stream")
