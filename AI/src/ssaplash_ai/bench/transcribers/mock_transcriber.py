"""테스트용 mock 채보 어댑터. 모델 없이 러너·CSV·보고서 파이프라인을 돌림.

mock_mode
- truth: `truth_dir/<song_id>.csv`(열 time_sec,label,velocity)를 그대로 돌려줌. 정답을 넣어 두면 F1 1.0.
  shift_ms만큼 시각을 밀 수 있음(창 검증용). 파일이 없으면 오류(예외 격리 테스트용)
- clicks: librosa 온셋 검출기로 시각만 찾고 라벨은 전부 "kick". 정답 파일 없이 아무 곡에나 돌릴 때
- empty: 타격 없음
fail_on_call: n번째 transcribe 호출에서 RuntimeError
"""

from __future__ import annotations

import csv
from collections.abc import Sequence
from pathlib import Path

import numpy as np

from ssaplash_ai.bench.transcribers.transcriber_base import BaseTranscriber, RawHit

MODES = ("truth", "clicks", "empty")


def read_truth_csv(path: Path) -> list[RawHit]:
    with open(path, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    out: list[RawHit] = []
    for r in rows:
        vel = r.get("velocity", "")
        out.append((float(r["time_sec"]), r["label"], int(vel) if vel not in ("", "-1") else None))
    return out


def write_truth_csv(path: Path, hits: np.ndarray) -> Path:
    """정답 타격 표를 mock truth 파일로. 테스트와 동작 확인용."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["time_sec", "label", "velocity"])
        for row in hits:
            w.writerow([f"{float(row['time_sec']):.6f}", str(row["pad"]), int(row["velocity"])])
    return path


class MockTranscriber(BaseTranscriber):
    adapter = "mock"

    def __init__(self, config, device: str = "cpu") -> None:
        super().__init__(config, device)
        if config.mock_mode not in MODES:
            raise ValueError(f"mock_mode는 {MODES} 중 하나: {config.mock_mode}")
        if config.mock_mode == "truth" and not config.truth_dir:
            raise ValueError("mock_mode truth에는 truth_dir가 필요")
        self.calls = 0

    def _load(self) -> None:
        pass

    def _transcribe(
        self, audio: np.ndarray, sample_rate: int, song_id: str | None
    ) -> Sequence[RawHit]:
        self.calls += 1
        if self.config.fail_on_call is not None and self.calls == self.config.fail_on_call:
            raise RuntimeError(f"모의 실패 (호출 {self.calls})")
        mode = self.config.mock_mode
        if mode == "empty":
            return []
        if mode == "clicks":
            from ssaplash_ai.bench.metrics.onset_preservation import detect_onsets

            return [(float(t), "kick", None) for t in detect_onsets(audio, sample_rate)]
        if song_id is None:
            raise ValueError("mock truth 모드에는 song_id가 필요")
        rows = read_truth_csv(Path(self.config.truth_dir) / f"{song_id}.csv")
        shift = self.config.shift_ms / 1000.0
        return [(t + shift, label, vel) for t, label, vel in rows]

    def _checkpoint_id(self) -> str:
        return f"mock:{self.config.mock_mode}"

    def _n_params(self) -> int | None:
        return 0
