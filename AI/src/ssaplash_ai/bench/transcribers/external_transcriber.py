"""별도 가상환경 스크립트로 도는 채보 모델 어댑터.

TensorFlow(Omnizart)·torch 2.8 고정(ADT_STR)·numpy<2(Inverse Drum Machine)처럼 지금 환경에 같이
설치할 수 없는 모델용. yaml에 적힌 python_exe로 script를 한 번 띄워 곡 목록을 통째로 넘기고,
스크립트가 모델을 한 번 올린 뒤 곡마다 (시각, 원래 라벨, 세기)와 채보 시간·GPU 메모리를 재서
JSON으로 돌려줌. 곡마다 프로세스를 새로 띄우면 로드 시간이 RTF에 섞이기 때문.

요청 JSON: model, songs[{song_id, wav_path}], device, warmup, options
응답 JSON: load_sec, checkpoint, n_params, songs[{song_id, hits[[t, label, vel|null]], elapsed_sec,
  peak_vram_mb|null, error|null}], note|null
스크립트가 GPU 메모리를 못 읽으면(TensorFlow 등) 러너가 nvidia-smi 폴링 값을 쓰고 vramMethod에 적음.
러너는 batch 모드로 호출함(transcribe_files). transcribe()는 곡 하나짜리 batch.
"""

from __future__ import annotations

import json
import subprocess
import sys
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from ssaplash_ai.bench.metrics.resource_usage import measure_resources
from ssaplash_ai.bench.transcribers.transcriber_base import (
    BaseTranscriber,
    RawHit,
    TranscriptionResult,
    apply_labels,
    write_temp_wav,
)

REQUEST_JSON = "request.json"
RESPONSE_JSON = "response.json"
STDERR_TAIL = 2000


@dataclass
class BatchItem:
    song_id: str
    wav_path: Path
    duration_sec: float | None = None


@dataclass
class BatchOutput:
    """transcribe_files 결과. results 값은 TranscriptionResult 또는 오류 문자열."""

    load_sec: float | None
    checkpoint: str
    n_params: int | None
    results: dict[str, TranscriptionResult | str] = field(default_factory=dict)
    vram_method: str = ""
    note: str | None = None


class ExternalTranscriber(BaseTranscriber):
    adapter = "external"
    batch = True

    def __init__(self, config, device: str = "cuda") -> None:
        super().__init__(config, device)
        if not config.python_exe or not config.script:
            raise ValueError(f"{config.name}: external 어댑터에는 python_exe와 script가 필요")
        self.python_exe = resolve_python_exe(config.python_exe, config.env_name)
        self.script = Path(config.script)
        self.work_dir: Path | None = None  # 러너가 run 폴더를 넣어 줌. 없으면 임시 폴더
        self._checkpoint = ""
        self._n_params_value: int | None = None
        self.last_output: BatchOutput | None = None

    def _load(self) -> None:
        """실제 로드는 스크립트 안에서. 여기서는 실행 파일·스크립트 존재만 확인."""
        if not self.python_exe.is_file():
            tried = str(self.python_exe)
            if self.config.env_name:
                tried += f" 또는 {venv_python('.venv-' + self.config.env_name)}"
            raise FileNotFoundError(
                f"{self.name}: 별도 환경 python이 없음: {tried} (README '별도 환경' 절)"
            )
        if not self.script.is_file():
            raise FileNotFoundError(f"{self.name}: 스크립트가 없음: {self.script}")

    def _transcribe(
        self, audio: np.ndarray, sample_rate: int, song_id: str | None
    ) -> Sequence[RawHit]:
        raise NotImplementedError("external 어댑터는 transcribe_files로 호출")

    def transcribe(
        self, audio: np.ndarray, sample_rate: int, song_id: str | None = None
    ) -> TranscriptionResult:
        """곡 하나짜리 batch. 러너는 쓰지 않고 수동 확인용."""
        if not self.loaded:
            raise RuntimeError(f"{self.name}: load()를 먼저 호출")
        path = write_temp_wav(audio, sample_rate)
        try:
            out = self.transcribe_files(
                [BatchItem(song_id or "song", path, audio.shape[1] / sample_rate)], warmup=False
            )
        finally:
            path.unlink(missing_ok=True)
        res = out.results[song_id or "song"]
        if isinstance(res, str):
            raise RuntimeError(res)
        return res

    def _request(self, items: Sequence[BatchItem], warmup: bool) -> dict:
        return {
            "model": self.name,
            "songs": [
                {"song_id": it.song_id, "wav_path": str(it.wav_path.resolve())} for it in items
            ],
            "device": self.device,
            "warmup": bool(warmup),
            "options": {
                **self.config.options,
                "variant": self.config.variant,
                "checkpoint_path": self.config.checkpoint_path,
                "checkpoint_url": self.config.checkpoint_url,
                "input_sample_rate": self.config.input_sample_rate,
            },
        }

    def transcribe_files(self, items: Sequence[BatchItem], warmup: bool = True) -> BatchOutput:
        """곡 wav 목록 → 스크립트 1회 실행 → 곡별 결과. 스크립트가 죽으면 모든 곡이 같은 오류."""
        if not self.loaded:
            raise RuntimeError(f"{self.name}: load()를 먼저 호출")
        work = self.work_dir or Path(write_temp_wav(np.zeros((2, 1), np.float32), 44100)).parent
        work.mkdir(parents=True, exist_ok=True)
        req_path = work / f"{self.name}.{REQUEST_JSON}"
        res_path = work / f"{self.name}.{RESPONSE_JSON}"
        res_path.unlink(missing_ok=True)
        req_path.write_text(
            json.dumps(self._request(items, warmup), ensure_ascii=False, indent=1), encoding="utf-8"
        )
        cmd = [
            str(self.python_exe),
            "-I",
            str(self.script.resolve()),
            "--request",
            str(req_path),
            "--response",
            str(res_path),
        ]
        with measure_resources(self.device, vram_probe="nvidia-smi") as usage:
            proc = subprocess.run(
                cmd, capture_output=True, text=True, encoding="utf-8", errors="replace"
            )
        if proc.returncode != 0 or not res_path.is_file():
            tail = (proc.stderr or proc.stdout or "")[-STDERR_TAIL:]
            err = f"외부 스크립트 실패 (exit {proc.returncode}): {tail.strip()}"
            return BatchOutput(
                load_sec=None,
                checkpoint="",
                n_params=None,
                results={it.song_id: err for it in items},
            )
        resp = json.loads(res_path.read_text(encoding="utf-8"))
        self._checkpoint = str(resp.get("checkpoint") or "")
        self._n_params_value = resp.get("n_params")
        smi_vram = usage.peak_vram_mb
        out = BatchOutput(
            load_sec=resp.get("load_sec"),
            checkpoint=self._checkpoint,
            n_params=self._n_params_value,
            note=resp.get("note"),
        )
        by_id = {s.get("song_id"): s for s in resp.get("songs", [])}
        for it in items:
            s = by_id.get(it.song_id)
            if s is None:
                out.results[it.song_id] = "응답에 곡이 없음"
                continue
            if s.get("error"):
                out.results[it.song_id] = f"외부 스크립트 오류: {s['error']}"[:300]
                continue
            try:
                raw: list[RawHit] = [
                    (float(h[0]), h[1], None if h[2] is None else int(h[2]))
                    for h in s.get("hits", [])
                ]
                result = apply_labels(raw, self.config.labels, it.duration_sec)
            except Exception as exc:
                out.results[it.song_id] = f"{type(exc).__name__}: {exc}"[:300]
                continue
            result.elapsed_sec = s.get("elapsed_sec")
            if s.get("peak_vram_mb") is not None:
                result.peak_vram_mb = float(s["peak_vram_mb"])
                result.vram_method = "script"
            else:
                result.peak_vram_mb = smi_vram
                result.vram_method = "nvidia-smi" if self.device.startswith("cuda") else ""
            out.results[it.song_id] = result
        out.vram_method = (
            "script"
            if any(
                isinstance(r, TranscriptionResult) and r.vram_method == "script"
                for r in out.results.values()
            )
            else ("nvidia-smi" if self.device.startswith("cuda") else "")
        )
        self.last_output = out
        return out

    def _checkpoint_id(self) -> str:
        return self._checkpoint or (self.config.variant or self.config.env_name or "external")

    def _n_params(self) -> int | None:
        return self._n_params_value


def venv_python(env_dir: str | Path) -> Path:
    """가상환경 폴더 → python 실행 파일 경로 (Windows / Linux)."""
    env_dir = Path(env_dir)
    if sys.platform == "win32":
        return env_dir / "Scripts" / "python.exe"
    return env_dir / "bin" / "python"


def resolve_python_exe(python_exe: str, env_name: str | None) -> Path:
    """yaml의 python_exe가 없으면(다른 OS에서 만든 경로 등) `.venv-<env_name>`의 이 OS python으로 대체.

    yaml은 Windows 경로 한 벌만 두고, Linux·코랩에서는 같은 폴더의 bin/python을 찾게 하려는 것.
    둘 다 없으면 yaml 경로를 그대로 돌려주고 load()가 오류를 냄.
    """
    path = Path(python_exe)
    if path.is_file() or not env_name:
        return path
    alt = venv_python(f".venv-{env_name}")
    return alt if alt.is_file() else path
