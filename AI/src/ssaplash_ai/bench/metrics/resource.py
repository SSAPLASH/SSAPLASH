"""처리 시간·메모리 측정 (설계 3-5절).

- 시간: 벽시계(perf_counter). RTF = 처리 시간 / 곡 길이는 runner가 계산.
- RAM: 측정 구간 동안 별도 스레드가 50ms마다 프로세스 RSS를 읽어 최댓값. psutil.
- VRAM: torch.cuda.max_memory_allocated. 구간 시작에 peak 통계를 초기화하고 끝에 읽음.
  torch가 없거나 CUDA를 못 쓰면 nan. (ADR-011: 본측정은 GPU, RAM은 CSV 보조값)
"""

from __future__ import annotations

import contextlib
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass

import psutil

SAMPLE_INTERVAL_SEC = 0.05
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


def cuda_available(device: str) -> bool:
    """device 문자열이 cuda이고 torch가 CUDA를 쓸 수 있는지."""
    if not device.startswith("cuda"):
        return False
    try:
        import torch
    except ImportError:
        return False
    return bool(torch.cuda.is_available())


@contextlib.contextmanager
def measure_resources(
    device: str = "cpu", interval_sec: float = SAMPLE_INTERVAL_SEC
) -> Iterator[ResourceUsage]:
    """`with measure_resources("cuda") as usage:` 블록의 시간·피크 RAM·피크 VRAM."""
    usage = ResourceUsage(device=device)
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
