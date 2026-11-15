"""타격 기록 → 노트 표. 모든 통계의 바탕이다.

분석 단위는 타격 한 줄이 아니라 **채보의 노트 한 개**다.
- `PERFECT`/`GOOD`: 노트를 맞춤. 노트 시각 = `tMs − deltaMs × playbackRate`
  (`tMs`는 곡 시각, `deltaMs`는 실제 시간이라 배율을 곱해 곡 시각으로 맞춘다)
- `MISS`: 노트를 놓침. 노트 시각 = `tMs` (BE 확인: 놓친 채보 노트의 시각)
- `judgement`가 null인 행(여분의 타격, stray)은 노트가 아니라서 여기에 들어오지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ssaplash_ai.coach.config import Thresholds
from ssaplash_ai.coach.schema import AnalysisRequest


@dataclass(frozen=True)
class NoteTable:
    """노트 시각 순으로 정렬된 노트 표. 모든 배열의 길이가 같다."""

    time: np.ndarray  # 노트 시각(ms, 곡 시각)
    pad: list[str]  # 노트 패드 (정식 이름)
    miss: np.ndarray  # 놓친 노트면 True
    perfect: np.ndarray  # PERFECT 판정이면 True
    delta: np.ndarray  # 오차(ms, 양수 늦음). 놓친 노트는 NaN
    velocity: np.ndarray  # 세기(0~127). 없으면 NaN
    stick: np.ndarray  # 스틱 번호(0/1). 없으면 -1
    good_ms: float  # 이 플레이의 판정 폭(게임 난이도. 임계값 기준은 `basis`)

    def basis(self, th: Thresholds) -> float:
        """임계값에 곱하는 ms 기준. 설정이 고정 기준 폭이면 그 값, 아니면 이 플레이의 판정 폭."""
        return th.basis_ms if th.basis_ms is not None else self.good_ms

    @property
    def size(self) -> int:
        return len(self.pad)

    @property
    def valid(self) -> np.ndarray:
        """PERFECT/GOOD(오차가 있는 노트)인 위치."""
        return ~self.miss


def build_notes(request: AnalysisRequest) -> NoteTable:
    seq: list[int] = []
    time: list[float] = []
    pad: list[str] = []
    miss: list[bool] = []
    perfect: list[bool] = []
    delta: list[float] = []
    velocity: list[float] = []
    stick: list[int] = []

    for hit in request.hits:
        if hit.judgement is None:
            continue  # 여분의 타격(stray)은 노트가 아니다
        is_miss = hit.judgement == "MISS"
        seq.append(hit.seq)
        # 검증에서 PERFECT/GOOD은 deltaMs가 있음을 보장한다
        time.append(hit.tMs if is_miss else hit.tMs - (hit.deltaMs or 0.0) * request.playbackRate)
        pad.append(hit.pad)
        miss.append(is_miss)
        perfect.append(hit.judgement == "PERFECT")
        delta.append(np.nan if is_miss or hit.deltaMs is None else hit.deltaMs)
        velocity.append(np.nan if is_miss or hit.velocity is None else hit.velocity)
        stick.append(hit.stickId if hit.stickId in (0, 1) and not is_miss else -1)

    time_arr = np.asarray(time, dtype=float)
    # 노트 시각 순서로 정렬한다. 같은 시각이면 저장 순서(seq)를 따른다.
    order = np.lexsort((np.asarray(seq, dtype=float), time_arr)) if time else np.empty(0, int)
    return NoteTable(
        time=time_arr[order],
        pad=[pad[i] for i in order],
        miss=np.asarray(miss, dtype=bool)[order],
        perfect=np.asarray(perfect, dtype=bool)[order],
        delta=np.asarray(delta, dtype=float)[order],
        velocity=np.asarray(velocity, dtype=float)[order],
        stick=np.asarray(stick, dtype=int)[order],
        good_ms=request.timingWindows.goodMs,
    )
