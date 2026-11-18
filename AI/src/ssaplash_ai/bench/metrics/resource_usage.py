"""처리 시간·메모리 측정.

- 시간: 벽시계(perf_counter). RTF = 처리 시간 / 곡 길이는 runner가 계산.
- RAM: 측정 구간 동안 별도 스레드가 50ms마다 프로세스 RSS를 읽어 최댓값. psutil.
- GPU 이름: torch.cuda.get_device_name. 이어하기 중 다른 GPU가 배정됐는지 확인하는 용도.
- VRAM: torch.cuda.max_memory_allocated. 구간 시작에 peak 통계를 초기화하고 끝에 읽음.
  torch가 없거나 CUDA를 못 쓰면 nan.
- VRAM(nvidia-smi): 다른 프로세스(별도 환경 채보 스크립트)의 GPU 메모리는 torch로 못 읽으므로
  nvidia-smi를 주기적으로 읽어 "측정 중 최댓값 − 시작값"을 씀. 프로세스 전체 값이라
  곡별이 아니고 다른 프로세스 사용량이 섞일 수 있음.
"""

from __future__ import annotations

import contextlib
import shutil
import subprocess
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass

import psutil

SAMPLE_INTERVAL_SEC = 0.05
NVIDIA_SMI_INTERVAL_SEC = 0.25
MB = 1024 * 1024


@dataclass
class ResourceUsage:
    """measure_resources 구간의 측정값. with 블록이 끝나야 값이 채워짐."""

    device: str = "cpu"
    elapsed_sec: float = 0.0
    peak_ram_mb: float = 0.0
    peak_vram_mb: float = float("nan")


class _RssSampler(threading.Thread):
    """측정 구간 동안 RSS를 주기적으로 읽는 데몬 스레드."""

    def __init__(self, interval: float) -> None:
        super().__init__(daemon=True)
        self.interval = interval
        self.process = psutil.Process()
        self.peak = 0.0
        self._stop_event = threading.Event()

    def sample(self) -> None:
        self.peak = max(self.peak, float(self.process.memory_info().rss))

    def run(self) -> None:
        while not self._stop_event.is_set():
            self.sample()
            self._stop_event.wait(self.interval)

    def stop(self) -> None:
        self._stop_event.set()
        self.join()
        self.sample()


def nvidia_smi_used_mb(index: int = 0) -> float | None:
    """nvidia-smi가 알려주는 GPU 사용 메모리(MB). 없거나 실패하면 None."""
    exe = shutil.which("nvidia-smi")
    if exe is None:
        return None
    try:
        out = subprocess.run(
            [exe, f"--id={index}", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    line = out.stdout.strip().splitlines()[0] if out.stdout.strip() else ""
    try:
        return float(line)
    except ValueError:
        return None


class _NvidiaSmiSampler(threading.Thread):
    """측정 구간 동안 nvidia-smi를 주기적으로 읽는 데몬 스레드. 시작값과 최댓값을 가짐."""

    def __init__(self, interval: float, index: int = 0) -> None:
        super().__init__(daemon=True)
        self.interval = interval
        self.index = index
        self.start_mb: float | None = None
        self.peak_mb: float | None = None
        self._stop_event = threading.Event()

    def sample(self) -> None:
        v = nvidia_smi_used_mb(self.index)
        if v is None:
            return
        if self.start_mb is None:
            self.start_mb = v
        self.peak_mb = v if self.peak_mb is None else max(self.peak_mb, v)

    def run(self) -> None:
        while not self._stop_event.is_set():
            self.sample()
            self._stop_event.wait(self.interval)

    def stop(self) -> None:
        self._stop_event.set()
        self.join()
        self.sample()

    @property
    def delta_mb(self) -> float:
        if self.start_mb is None or self.peak_mb is None:
            return float("nan")
        return self.peak_mb - self.start_mb


def cuda_available(device: str) -> bool:
    """device 문자열이 cuda이고 torch가 CUDA를 쓸 수 있는지."""
    if not device.startswith("cuda"):
        return False
    try:
        import torch
    except ImportError:
        return False
    return bool(torch.cuda.is_available())


def gpu_name(device: str) -> str:
    """cuda 장치의 이름(예: NVIDIA A100-SXM4-40GB). CUDA를 못 쓰면 빈 문자열."""
    if not cuda_available(device):
        return ""
    import torch

    index = torch.device(device).index or 0
    return str(torch.cuda.get_device_name(index))


@contextlib.contextmanager
def measure_resources(
    device: str = "cpu",
    interval_sec: float = SAMPLE_INTERVAL_SEC,
    vram_probe: str = "torch",
) -> Iterator[ResourceUsage]:
    """`with measure_resources("cuda") as usage:` 블록의 시간·피크 RAM·피크 VRAM.

    vram_probe가 "nvidia-smi"면 torch 대신 nvidia-smi 폴링(자식 프로세스 측정용). cuda 장치가 아니면 nan.
    """
    usage = ResourceUsage(device=device)
    smi: _NvidiaSmiSampler | None = None
    if vram_probe == "nvidia-smi":
        if device.startswith("cuda"):
            smi = _NvidiaSmiSampler(NVIDIA_SMI_INTERVAL_SEC)
            smi.sample()
            smi.start()
        use_cuda = False
    else:
        use_cuda = cuda_available(device)
    if use_cuda:
        import torch

        torch.cuda.synchronize()
        torch.cuda.reset_peak_memory_stats()
    sampler = _RssSampler(interval_sec)
    sampler.sample()
    sampler.start()
    start = time.perf_counter()
    try:
        yield usage
    finally:
        if use_cuda:
            torch.cuda.synchronize()
        usage.elapsed_sec = time.perf_counter() - start
        sampler.stop()
        usage.peak_ram_mb = sampler.peak / MB
        if use_cuda:
            usage.peak_vram_mb = torch.cuda.max_memory_allocated() / MB
        if smi is not None:
            smi.stop()
            usage.peak_vram_mb = smi.delta_mb
