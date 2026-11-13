"""워커 전체 흐름 테스트: fake BE + mock 모델 (설계 인수 조건 2~8·10).

실제 HTTP로 claim → 내려받기 → 분리 → 올리기 → 분리 결과 → 재조회 → 채보 → 채보 결과까지 돈다.
"""

from __future__ import annotations

import dataclasses
import json
import logging
import time
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
import soxr
from worker_helpers import Rig

from helpers import HITS, SR, make_hits, write_m4a, write_wav
from ssaplash_ai.chart.errors import ChartNotTranscribableError, ChartOutputError
from ssaplash_ai.worker.fake_be import FAKE_TOKEN, FakeBackend, Faults
from ssaplash_ai.worker.job import (
    STATUS_ABANDONED,
    STATUS_DONE,
    STATUS_FAILED_REPORTED,
    JobAbandoned,
    mib_to_mb,
)


def _song(tmp_path: Path, name: str = "song.wav", seconds: float = 2.2) -> Path:
    path = tmp_path / name
    write_wav(path, make_hits(seconds))
    return path


def _events(backend: FakeBackend, job_id: int, kind: str) -> list[dict]:
    return [e for e in backend.jobs[job_id].events if e["type"] == kind]


def _slow(obj, method: str, seconds: float, monkeypatch: pytest.MonkeyPatch) -> None:
    """모델 호출 앞에 잠깐 기다리게 해서 그동안 heartbeat가 가게 함."""
    original = getattr(obj, method)

    def slow(*args, **kwargs):
        time.sleep(seconds)
        return original(*args, **kwargs)

    monkeypatch.setattr(obj, method, slow)


def test_정상_흐름은_DONE이고_파일과_결과가_BE에_남는다(tmp_path: Path):
    with Rig(tmp_path) as rig:
        job_id = rig.backend.enqueue(_song(tmp_path))
        out = rig.run_one()
        assert out.status == STATUS_DONE and out.n_notes == len(HITS)
        assert out.separate_ms is not None and out.transcribe_ms is not None
        job = rig.backend.jobs[job_id]
        assert job.status == "DONE" and job.progress == 100 and job.chart_version_ids == [1]
        sep = job.separation_result
        assert sep["durationMs"] == 2200 and sep["audioTimeOrigin"] == "SOURCE_START"
        assert (
            sep["model"]["name"] == "mock_half" and sep["drumStem"]["contentType"] == "audio/flac"
        )
        assert sep["metrics"]["peakVramMb"] is None and sep["metrics"]["peakRamMb"] > 0
        assert job.transcription_result["metrics"]["durationMs"] == 2200
        assert job.transcription_result["generator"] == "ADT_MODEL"
        be_out = tmp_path / "be_out" / f"job-{job_id}"
        for name in ("drums.flac", "accompaniment.flac", "separation_result.json", "chart.json"):
            assert (be_out / name).is_file()
        # 분리 ACK 뒤 로컬 드럼 트랙을 다시 써서 DRUM_STEM GET이 없음
        accesses = [f for e in _events(rig.backend, job_id, "FILE_ACCESS") for f in e["files"]]
        assert accesses == ["SOURCE_AUDIO:GET", "DRUM_STEM:PUT", "ACCOMPANIMENT:PUT"]
        # 작업 폴더는 지움
        assert not any((tmp_path / "work" / "worker").iterdir())


def test_진행률은_줄지_않고_heartbeat가_모델_실행_중에도_온다(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    with Rig(tmp_path) as rig:
        job_id = rig.backend.enqueue(_song(tmp_path))
        _slow(rig.separation, "separate_file", 0.5, monkeypatch)
        _slow(rig.transcription, "transcribe_file", 0.5, monkeypatch)
        out = rig.run_one()
        assert out.status == STATUS_DONE
        sent = out.progress_sent
        assert sent[0] == 0 and sent == sorted(sent) and len(sent) >= 4
        assert any(p == 5 for p in sent)  # 원곡 내려받은 뒤 분리 중
        assert any(50 <= p < 100 for p in sent)  # 분리 인수 뒤 채보 중
        seqs = [e["seq"] for e in _events(rig.backend, job_id, "HEARTBEAT")]
        assert seqs == sorted(seqs) and len(seqs) == len(sent)


def test_TRANSCRIBING_이어받기는_분리를_건너뛰고_드럼_트랙을_내려받는다(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    clock = [1000.0]
    backend = FakeBackend(out_dir=None, clock=lambda: clock[0])
    with Rig(tmp_path, backend=backend) as rig:
        job_id = backend.enqueue(_song(tmp_path))

        def crash(*args, **kwargs):
            raise JobAbandoned("재조회 직전에 워커가 죽은 상황")

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(rig.runner, "_reclaim", crash)
            first = rig.run_one("c-1")
        assert first.status == STATUS_ABANDONED
        job = backend.jobs[job_id]
        assert job.status == "TRANSCRIBING" and job.drum_checkpoint is not None

        clock[0] += 61  # 임대 만료 → 새 attempt로 재배정
        assignment = rig.api.claim("c-2")
        assert assignment is not None
        assert assignment.resume_stage == "TRANSCRIBING" and assignment.input.role == "DRUM_STEM"
        assert assignment.attempt_id != first.attempt_id
        second = rig.runner.run(assignment, "c-2")
        assert second.status == STATUS_DONE and second.separate_ms is None
        assert second.progress_sent[0] == 50
        accesses = [f for e in _events(backend, job_id, "FILE_ACCESS") for f in e["files"]]
        assert accesses[-1] == "DRUM_STEM:GET"  # 새 작업 폴더라 체크포인트를 내려받음
        assert rig.separation._separator.calls == 1  # 분리는 처음 한 번만


def test_입력_오류는_INPUT_INVALID로_보고하고_BE는_FAILED(tmp_path: Path):
    silent = tmp_path / "silent.wav"
    write_wav(silent, np.zeros((2, SR), dtype=np.float32))
    with Rig(tmp_path) as rig:
        job_id = rig.backend.enqueue(silent)
        out = rig.run_one()
        assert out.status == STATUS_FAILED_REPORTED and out.failure_code == "INPUT_INVALID"
        event = _events(rig.backend, job_id, "FAILURE")[0]
        assert event["stage"] == "SEPARATING" and event["retryable"] is False
        assert "무음" in event["summary"] and "\n" not in event["summary"]
        assert len(event["summary"]) <= 200
        assert rig.backend.jobs[job_id].status == "FAILED"
        assert rig.separation._separator.calls == 0


def test_GPU_메모리_부족은_MODEL_FAILED_재시도_가능으로_보고(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    with Rig(tmp_path) as rig:
        job_id = rig.backend.enqueue(_song(tmp_path))

        def boom(mixture, sample_rate):
            raise RuntimeError("CUDA out of memory. Tried to allocate 2.00 GiB")

        monkeypatch.setattr(rig.separation._separator, "_separate", boom)
        out = rig.run_one()
        assert out.status == STATUS_FAILED_REPORTED and out.failure_code == "MODEL_FAILED"
        event = _events(rig.backend, job_id, "FAILURE")[0]
        assert event["code"] == "MODEL_FAILED" and event["retryable"] is True
        assert rig.backend.jobs[job_id].status == "QUEUED"  # BE가 다시 배정


def test_채보_단계_출력_오류는_TRANSCRIBING_OUTPUT_INVALID(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    with Rig(tmp_path) as rig:
        job_id = rig.backend.enqueue(_song(tmp_path))

        def bad(*args, **kwargs):
            raise ChartOutputError("채보 JSON 검증 실패: 패드 이름")

        monkeypatch.setattr(rig.transcription, "transcribe_file", bad)
        out = rig.run_one()
        assert out.status == STATUS_FAILED_REPORTED and out.failure_code == "OUTPUT_INVALID"
        event = _events(rig.backend, job_id, "FAILURE")[0]
        assert event["stage"] == "TRANSCRIBING" and event["retryable"] is False
        job = rig.backend.jobs[job_id]
        assert job.separation_result is not None and job.status == "FAILED"


def test_내려받은_입력의_해시가_3번_다르면_보고_없이_놓고_모델_안_돌림(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
):
    caplog.set_level(logging.WARNING, logger="ssaplash_ai.worker")
    with Rig(tmp_path) as rig:
        job_id = rig.backend.enqueue(_song(tmp_path))
        assignment = rig.api.claim("c-1")
        assert assignment is not None
        wrong = dataclasses.replace(
            assignment, input=dataclasses.replace(assignment.input, sha256="0" * 64)
        )
        out = rig.runner.run(wrong, "c-1")
        assert out.status == STATUS_ABANDONED and out.failure_code is None
        assert "불일치 3번" in out.detail
        assert rig.separation._separator.calls == 0
        assert _events(rig.backend, job_id, "FAILURE") == []
        gets = [f for e in _events(rig.backend, job_id, "FILE_ACCESS") for f in e["files"]]
        assert gets == ["SOURCE_AUDIO:GET"]  # 같은 URL로 3번 받음
        mismatch = [r for r in caplog.records if "/3: attempt" in r.getMessage()]
        assert [r.levelno for r in mismatch] == [logging.WARNING] * 3
        text = mismatch[0].getMessage()
        assert assignment.attempt_id in text and "SOURCE_AUDIO" in text
        assert "sha256 " in text and "(배정 000000000000)" in text and "1/3" in text
        assert any(
            r.levelno == logging.ERROR and "작업을 놓음" in r.getMessage() for r in caplog.records
        )
        assert "storage" not in caplog.text  # 서명 URL 없음


def test_내려받기가_한_번_잘려도_다시_받아_DONE(tmp_path: Path, caplog: pytest.LogCaptureFixture):
    caplog.set_level(logging.WARNING, logger="ssaplash_ai.worker")
    backend = FakeBackend(out_dir=None, faults=Faults(get_truncated_once=True))
    with Rig(tmp_path, backend=backend) as rig:
        job_id = backend.enqueue(_song(tmp_path))
        out = rig.run_one()
        assert out.status == STATUS_DONE
        assert backend.jobs[job_id].status == "DONE"
        mismatch = [r for r in caplog.records if "파일 불일치" in r.getMessage()]
        assert len(mismatch) == 1 and "1/3" in mismatch[0].getMessage()


def _reason_events(rig: Rig, job_id: int) -> list[tuple[str, bool, str | None]]:
    return [
        (e["code"], e["retryable"], e["reason"]) for e in _events(rig.backend, job_id, "FAILURE")
    ]


def test_reason_설정이_꺼져_있으면_본문에_reason이_없다(tmp_path: Path):
    silent = tmp_path / "silent.wav"
    write_wav(silent, np.zeros((2, SR), dtype=np.float32))
    with Rig(tmp_path) as rig:
        assert rig.settings.send_reason is False
        job_id = rig.backend.enqueue(silent)
        out = rig.run_one()
        assert out.failure_reason == "SOURCE_INVALID"  # 워커 안에서는 분류함
        assert _reason_events(rig, job_id) == [("INPUT_INVALID", False, None)]


def test_원곡_입력_오류는_SOURCE_INVALID(tmp_path: Path):
    silent = tmp_path / "silent.wav"
    write_wav(silent, np.zeros((2, SR), dtype=np.float32))
    with Rig(tmp_path, send_reason=True) as rig:
        job_id = rig.backend.enqueue(silent)
        rig.run_one()
        assert _reason_events(rig, job_id) == [("INPUT_INVALID", False, "SOURCE_INVALID")]


def test_채보_불가는_NOT_TRANSCRIBABLE(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    with Rig(tmp_path, send_reason=True) as rig:
        job_id = rig.backend.enqueue(_song(tmp_path))

        def no_beat(*args, **kwargs):
            raise ChartNotTranscribableError("박 추적 실패, 박 0개")

        monkeypatch.setattr(rig.transcription, "transcribe_file", no_beat)
        out = rig.run_one()
        assert out.status == STATUS_FAILED_REPORTED
        assert _reason_events(rig, job_id) == [("INPUT_INVALID", False, "NOT_TRANSCRIBABLE")]
        event = _events(rig.backend, job_id, "FAILURE")[0]
        assert event["stage"] == "TRANSCRIBING" and event["summary"] == "박 추적 실패, 박 0개"
        assert rig.backend.jobs[job_id].status == "FAILED"


def test_GPU_메모리_부족은_GPU_OUT_OF_MEMORY이고_재시도_소진_뒤에도_남는다(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    with Rig(tmp_path, send_reason=True) as rig:
        job_id = rig.backend.enqueue(_song(tmp_path))

        def boom(mixture, sample_rate):
            raise RuntimeError("CUDA out of memory. Tried to allocate 2.00 GiB")

        monkeypatch.setattr(rig.separation._separator, "_separate", boom)
        for i in range(3):  # 처음 1번 + BE 재시도 2번
            rig.run_one(f"c-{i}")
        assert _reason_events(rig, job_id) == [("MODEL_FAILED", True, "GPU_OUT_OF_MEMORY")] * 3
        job = rig.backend.jobs[job_id]
        assert job.status == "FAILED" and job.failure_reason == "GPU_OUT_OF_MEMORY"


def test_출력_오류와_워커_내부_예외는_INTERNAL_ERROR(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    with Rig(tmp_path, send_reason=True) as rig:
        first = rig.backend.enqueue(_song(tmp_path))
        second = rig.backend.enqueue(_song(tmp_path, "song2.wav"))
        errors = iter([ChartOutputError("채보 JSON 검증 실패"), KeyError("버그")])

        def bad(*args, **kwargs):
            raise next(errors)

        monkeypatch.setattr(rig.transcription, "transcribe_file", bad)
        rig.run_one("c-1")
        rig.run_one("c-2")
        assert _reason_events(rig, first) == [("OUTPUT_INVALID", False, "INTERNAL_ERROR")]
        assert _reason_events(rig, second) == [("MODEL_FAILED", False, "INTERNAL_ERROR")]


def test_결과_제출_503은_같은_봉투를_다시_보내_인수된다(tmp_path: Path):
    backend = FakeBackend(out_dir=None, faults=Faults(submit_503_once=True))
    with Rig(tmp_path, backend=backend) as rig:
        job_id = backend.enqueue(_song(tmp_path))
        out = rig.run_one()
        assert out.status == STATUS_DONE
        assert len(_events(backend, job_id, "SEPARATION_ACCEPTED")) == 1
        assert backend.jobs[job_id].status == "DONE"


def test_PUT_403은_URL을_다시_받아_같은_바이트를_올리고_모델은_한_번만(tmp_path: Path):
    backend = FakeBackend(out_dir=None, faults=Faults(put_403_once=True))
    with Rig(tmp_path, backend=backend) as rig:
        job_id = backend.enqueue(_song(tmp_path))
        out = rig.run_one()
        assert out.status == STATUS_DONE
        assert rig.separation._separator.calls == 1
        accesses = [e["files"] for e in _events(backend, job_id, "FILE_ACCESS")]
        assert ["DRUM_STEM:PUT"] in accesses  # 재발급 요청은 그 역할 하나만


def test_heartbeat_409면_결과를_제출하지_않고_놓는다(tmp_path: Path):
    backend = FakeBackend(out_dir=None, faults=Faults(heartbeat_409=True))
    with Rig(tmp_path, backend=backend) as rig:
        job_id = backend.enqueue(_song(tmp_path))
        out = rig.run_one()
        assert out.status == STATUS_ABANDONED and "임대" in out.detail
        job = backend.jobs[job_id]
        assert job.separation_result is None and job.status == "SEPARATING"
        assert not _events(backend, job_id, "FAILURE")


def test_임대가_끝난_뒤_409는_재전송_없이_놓는다(tmp_path: Path):
    clock = [0.0]
    backend = FakeBackend(out_dir=None, clock=lambda: clock[0])
    with Rig(tmp_path, backend=backend) as rig:
        job_id = backend.enqueue(_song(tmp_path))
        assignment = rig.api.claim("c-1")
        clock[0] += 61  # file-access부터 409 LEASE_EXPIRED
        out = rig.runner.run(assignment, "c-1")
        assert out.status == STATUS_ABANDONED and "BE 응답" in out.detail and "409" in out.detail
        assert backend.jobs[job_id].separation_result is None


def test_로그에_토큰과_서명_URL이_없다(tmp_path: Path, caplog: pytest.LogCaptureFixture):
    caplog.set_level(logging.DEBUG)
    backend = FakeBackend(out_dir=None, faults=Faults(put_403_once=True, submit_503_once=True))
    with Rig(tmp_path, backend=backend) as rig:
        backend.enqueue(_song(tmp_path))
        assert rig.run_one().status == STATUS_DONE
    text = caplog.text
    assert text  # 로그가 있긴 함
    assert FAKE_TOKEN not in text
    assert "X-Amz-Signature" not in text and "/storage/" not in text


def test_keep_files면_작업_폴더를_남긴다(tmp_path: Path):
    with Rig(tmp_path, keep_files=True) as rig:
        rig.backend.enqueue(_song(tmp_path))
        assert rig.run_one().status == STATUS_DONE
        dirs = list((tmp_path / "work" / "worker").iterdir())
        assert len(dirs) == 1
        names = {p.name for p in dirs[0].iterdir()}
        assert {"source.wav", "drums.flac", "accompaniment.flac", "chart.json"} <= names
        assert {"separation.json", "transcription.json"} <= names
        sep = json.loads((dirs[0] / "separation.json").read_text(encoding="utf-8"))
        tr = json.loads((dirs[0] / "transcription.json").read_text(encoding="utf-8"))
        assert sep["duration_ms"] == 2200 and "separate_ms" in sep and "peak_vram_mb" in sep
        assert tr["duration_ms"] == 2200 and "transcribe_ms" in tr and "chart" not in tr


@pytest.mark.parametrize(
    ("name", "content_type", "source_name"),
    [("song.m4a", "audio/mp4", "source.m4a"), ("song.opus", "audio/ogg", "source.ogg")],
)
def test_m4a_opus_원곡도_DONE까지_간다(
    tmp_path: Path, name: str, content_type: str, source_name: str
):
    path = tmp_path / name
    if name.endswith(".m4a"):
        write_m4a(path, make_hits(2.2))
    else:
        # Opus는 48kHz 등 몇 가지 샘플레이트만 받음
        audio = soxr.resample(make_hits(2.2).T, SR, 48000)
        sf.write(str(path), audio, 48000, format="OGG", subtype="OPUS")
    with Rig(tmp_path, keep_files=True) as rig:
        job_id = rig.backend.enqueue(path)
        assert rig.backend.jobs[job_id].source.content_type == content_type
        out = rig.run_one()
        assert out.status == STATUS_DONE and out.n_notes == len(HITS)
        assert rig.backend.jobs[job_id].separation_result["durationMs"] == 2200
        dirs = list((tmp_path / "work" / "worker").iterdir())
        assert source_name in {p.name for p in dirs[0].iterdir()}


def test_mib_to_mb():
    assert mib_to_mb(None) is None
    assert mib_to_mb(1024.0) == 1073.7  # 1024 MiB = 1073.7 MB
    assert mib_to_mb(0.0) == 0.0
