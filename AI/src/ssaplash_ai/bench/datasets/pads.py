"""패드 어휘와 타격 정답 표.

패드 9종은 스틱 통신 프로토콜 패드와 같음. 8패드 점수(SCORED_PADS)는 HIHAT_PEDAL을 HIHAT에 합쳐 냄.
타격 표는 numpy 구조화 배열: time_sec(초), pad, velocity(1~127, 없으면 -1).
모델 예측 표는 pad 자리에 거친 라벨 COARSE(tom·cymbal)도 올 수 있고, 그러면 8패드 점수는 매기지 않음.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping

import numpy as np

PADS: tuple[str, ...] = (
    "KICK",
    "SNARE",
    "HIHAT",
    "SMALL_TOM",
    "MID_TOM",
    "FLOOR_TOM",
    "CRASH",
    "RIDE",
    "HIHAT_PEDAL",
)

# 8패드 점수에 쓰는 패드. HIHAT_PEDAL은 HIHAT에 합쳐 채점 (지난 결과와 같은 조건)
SCORED_PADS: tuple[str, ...] = PADS[:8]
PEDAL = "HIHAT_PEDAL"

# 5가지 묶음 (-107 공통 규칙): 논문 수치와 비교하는 용도
FIVE_GROUPS: dict[str, str] = {
    "KICK": "kick",
    "SNARE": "snare",
    "HIHAT": "hihat",
    "SMALL_TOM": "tom",
    "MID_TOM": "tom",
    "FLOOR_TOM": "tom",
    "CRASH": "cymbal",
    "RIDE": "cymbal",
    "HIHAT_PEDAL": "hihat",
}

# 모델 예측에만 쓰는 거친 라벨. 탐 3종을 못 나누면 tom, 크래시·라이드를 못 나누면 cymbal
COARSE: tuple[str, ...] = ("tom", "cymbal")
PRED_LABELS: tuple[str, ...] = PADS + COARSE

# 거친 라벨은 5가지 묶음에서 이름이 그대로
FIVE_GROUPS_PRED: dict[str, str] = {**FIVE_GROUPS, "tom": "tom", "cymbal": "cymbal"}

# 대응표에서 "패드에 없는 타격"을 뜻하는 값. 이 라벨은 표에서 빼고 개수만 셈
DROP = "__drop__"

NO_VELOCITY = -1

HITS_DTYPE = np.dtype([("time_sec", np.float64), ("pad", "U11"), ("velocity", np.int16)])


def empty_hits() -> np.ndarray:
    return np.zeros(0, dtype=HITS_DTYPE)


def make_hits(
    times: Iterable[float],
    labels: Iterable[object],
    velocities: Iterable[int | None] | None,
    label_to_pad: Mapping[object, str],
    allow_coarse: bool = False,
) -> tuple[np.ndarray, int]:
    """(시각, 라벨, 세기) 목록을 타격 표로 변환.

    label_to_pad 값이 DROP인 라벨은 빼고 개수만 셈. 표에 없는 라벨은 오류
    (조용히 버리면 대응표 누락을 못 잡음). 반환은 시각 오름차순 정렬된 (표, 뺀 개수).
    allow_coarse가 참이면(모델 예측) 대응표 값에 거친 라벨 tom·cymbal도 허용.
    """
    allowed = PRED_LABELS if allow_coarse else PADS
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
        if pad not in allowed:
            raise ValueError(f"대응표의 패드 이름이 어휘에 없음: {pad!r} (가능: {allowed})")
        vel = NO_VELOCITY if v is None else int(v)
        rows.append((float(t), pad, vel))
    if unknown:
        raise ValueError(f"대응표에 없는 라벨: {sorted(unknown)}")

    hits = np.array(rows, dtype=HITS_DTYPE) if rows else empty_hits()
    order = np.argsort(hits["time_sec"], kind="stable")
    return hits[order], dropped


def validate_hits(hits: np.ndarray, allowed: tuple[str, ...] = PADS) -> None:
    """dtype·정렬·패드 값 검사. 로더 테스트와 러너 입력 검사에 사용."""
    if hits.dtype != HITS_DTYPE:
        raise ValueError(f"타격 표 dtype이 다름: {hits.dtype}")
    if len(hits) > 1 and np.any(np.diff(hits["time_sec"]) < 0):
        raise ValueError("타격 표가 시각 오름차순이 아님")
    bad = set(np.unique(hits["pad"]).tolist()) - set(allowed)
    if bad:
        raise ValueError(f"어휘에 없는 패드: {sorted(bad)}")


def validate_pred_hits(hits: np.ndarray) -> None:
    """모델 예측 표 검사. 패드 9종에 더해 거친 라벨 tom·cymbal 허용."""
    validate_hits(hits, PRED_LABELS)


def has_coarse(hits: np.ndarray) -> bool:
    """예측 표에 거친 라벨이 하나라도 있는지."""
    return bool(np.isin(hits["pad"], COARSE).any())


def clip_hits(hits: np.ndarray, start_sec: float, end_sec: float) -> np.ndarray:
    """[start, end) 구간만 남기고 시각을 start 기준 0으로 이동."""
    t = hits["time_sec"]
    out = hits[(t >= start_sec) & (t < end_sec)].copy()
    out["time_sec"] -= start_sec
    return out


def count_by_pad(hits: np.ndarray) -> dict[str, int]:
    """패드 9종 전부를 키로 하는 개수 dict (없는 패드는 0)."""
    counts = dict.fromkeys(PADS, 0)
    pads, n = np.unique(hits["pad"], return_counts=True)
    for pad, k in zip(pads.tolist(), n.tolist(), strict=True):
        counts[pad] = k
    return counts


def merge_pedal(hits: np.ndarray) -> np.ndarray:
    """HIHAT_PEDAL을 HIHAT으로 바꾼 복사본. 8패드 점수용."""
    out = hits.copy()
    out["pad"][out["pad"] == PEDAL] = "HIHAT"
    return out


def to_five_groups(hits: np.ndarray) -> np.ndarray:
    """pad 열을 5가지 묶음 이름으로 바꾼 복사본. 거친 라벨은 그대로. 5가지 F1 계산용."""
    out = hits.copy()
    out["pad"] = [FIVE_GROUPS_PRED[p] for p in hits["pad"].tolist()]
    return out
