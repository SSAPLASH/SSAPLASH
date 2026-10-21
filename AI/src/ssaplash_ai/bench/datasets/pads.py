"""패드 어휘와 타격 정답 표 (채보 벤치마크 설계 3-2절).

패드 8종은 공통 명세서 채보 pad enum 7종 + MID_TOM. 이름이 확정되면 PADS만 수정.
타격 표는 numpy 구조화 배열: time_sec(초), pad(8종 중 하나), velocity(1~127, 없으면 -1).
데이터셋별 라벨 → 패드 대응표는 각 로더가 가지고, 여기서는 표를 만들고 검사하는 함수만 제공.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping

import numpy as np

PADS: tuple[str, ...] = (
    "KICK",
    "SNARE",
    "HIHAT",
    "HI_TOM",
    "MID_TOM",
    "FLOOR_TOM",
    "CRASH",
    "RIDE",
)

# 5가지 묶음 (-107 공통 규칙): 논문 수치와 비교하는 용도
FIVE_GROUPS: dict[str, str] = {
    "KICK": "kick",
    "SNARE": "snare",
    "HIHAT": "hihat",
    "HI_TOM": "tom",
    "MID_TOM": "tom",
    "FLOOR_TOM": "tom",
    "CRASH": "cymbal",
    "RIDE": "cymbal",
}

# 대응표에서 "패드에 없는 타격"을 뜻하는 값. 이 라벨은 표에서 빼고 개수만 셈
DROP = "__drop__"

NO_VELOCITY = -1

HITS_DTYPE = np.dtype([("time_sec", np.float64), ("pad", "U9"), ("velocity", np.int16)])


def empty_hits() -> np.ndarray:
    return np.zeros(0, dtype=HITS_DTYPE)


def make_hits(
    times: Iterable[float],
    labels: Iterable[object],
    velocities: Iterable[int | None] | None,
    label_to_pad: Mapping[object, str],
) -> tuple[np.ndarray, int]:
    """(시각, 라벨, 세기) 목록을 타격 표로 변환.

    label_to_pad 값이 DROP인 라벨은 빼고 개수만 셈. 표에 없는 라벨은 오류
    (조용히 버리면 대응표 누락을 못 잡음). 반환은 시각 오름차순 정렬된 (표, 뺀 개수).
    """
    times = list(times)
    labels = list(labels)
    vels = list(velocities) if velocities is not None else [None] * len(times)
    if not (len(times) == len(labels) == len(vels)):
        raise ValueError(f"길이 불일치: 시각 {len(times)}, 라벨 {len(labels)}, 세기 {len(vels)}")

    rows: list[tuple[float, str, int]] = []
    dropped = 0
    unknown: set[str] = set()
    for t, label, v in zip(times, labels, vels, strict=True):
        pad = label_to_pad.get(label)
        if pad is None:
            unknown.add(str(label))
            continue
        if pad == DROP:
            dropped += 1
            continue
        if pad not in PADS:
            raise ValueError(f"대응표의 패드 이름이 어휘에 없음: {pad!r}")
        vel = NO_VELOCITY if v is None else int(v)
        rows.append((float(t), pad, vel))
    if unknown:
        raise ValueError(f"대응표에 없는 라벨: {sorted(unknown)}")

    hits = np.array(rows, dtype=HITS_DTYPE) if rows else empty_hits()
    order = np.argsort(hits["time_sec"], kind="stable")
    return hits[order], dropped


def validate_hits(hits: np.ndarray) -> None:
    """dtype·정렬·패드 값 검사. 로더 테스트와 러너 입력 검사에 사용."""
    if hits.dtype != HITS_DTYPE:
        raise ValueError(f"타격 표 dtype이 다름: {hits.dtype}")
    if len(hits) > 1 and np.any(np.diff(hits["time_sec"]) < 0):
        raise ValueError("타격 표가 시각 오름차순이 아님")
    bad = set(np.unique(hits["pad"]).tolist()) - set(PADS)
    if bad:
        raise ValueError(f"어휘에 없는 패드: {sorted(bad)}")


def clip_hits(hits: np.ndarray, start_sec: float, end_sec: float) -> np.ndarray:
    """[start, end) 구간만 남기고 시각을 start 기준 0으로 이동."""
    t = hits["time_sec"]
    out = hits[(t >= start_sec) & (t < end_sec)].copy()
    out["time_sec"] -= start_sec
    return out


def count_by_pad(hits: np.ndarray) -> dict[str, int]:
    """패드 8종 전부를 키로 하는 개수 dict (없는 패드는 0)."""
    counts = dict.fromkeys(PADS, 0)
    pads, n = np.unique(hits["pad"], return_counts=True)
    for pad, k in zip(pads.tolist(), n.tolist(), strict=True):
        counts[pad] = k
    return counts


def to_five_groups(hits: np.ndarray) -> np.ndarray:
    """pad 열을 5가지 묶음 이름으로 바꾼 복사본. 5가지 F1 계산용 (-109)."""
    out = hits.copy()
    out["pad"] = [FIVE_GROUPS[p] for p in hits["pad"].tolist()]
    return out
