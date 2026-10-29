"""보정 정책: 사람이 정하는 값.

정답 라벨이 없는 실제 로그에서는 "패턴이 전체 플레이의 몇 %에게 걸리는 것이 적당한가"가 정책 결정이다.
이 파일의 `targets`가 비어 있으면(처음 상태) 후보를 만들지 않고 분포와 what-if 표만 기록한다.
정책을 바꾸는 일은 사람이 하며, 자동으로 바뀌지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

POLICY_VERSION = 1
DEFAULT_PATH = Path(__file__).resolve().parents[3] / "configs" / "coach" / "calibration_policy.yaml"


class PolicyError(ValueError):
    """정책 파일이 형식에 맞지 않는다."""


@dataclass(frozen=True)
class Policy:
    max_change: float = 0.25  # 한 번에 현재 값에서 움직일 수 있는 비율(±)
    min_sample: int = 50  # 이보다 적은 세션이면 후보를 만들지 않는다
    targets: dict[str, tuple[float, float]] = field(
        default_factory=dict
    )  # 그룹 → (최소, 최대) 걸림 비율

    def target_of(self, group: str) -> tuple[float, float] | None:
        return self.targets.get(group)


def load_policy(path: Path | str | None = None, groups: frozenset[str] | None = None) -> Policy:
    """정책 파일을 읽는다.

    경로를 **명시했는데 파일이 없으면 실패**한다(컨테이너에서 정책 파일 마운트를 빠뜨렸는데 조용히 빈 정책으로
    도는 일을 막는다). 경로를 주지 않았고 기본 파일도 없으면 빈 정책(분포만 기록)이다.
    `groups`는 허용하는 그룹 이름이다(모르는 이름은 오타일 수 있어 거부한다).
    """
    p = Path(path) if path else DEFAULT_PATH
    if not p.exists():
        if path:
            raise PolicyError("정책 파일이 없다")
        return Policy()
    raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    if not isinstance(raw, dict):
        raise PolicyError("정책 파일의 최상위는 매핑이어야 한다")
    return _parse(raw, groups)


def _parse(raw: dict[str, Any], groups: frozenset[str] | None) -> Policy:
    unknown = set(raw) - {"version", "max_change", "min_sample", "targets"}
    if unknown:
        raise PolicyError(f"모르는 키: {', '.join(sorted(unknown))}")
    if raw.get("version", POLICY_VERSION) != POLICY_VERSION:
        raise PolicyError("지원하지 않는 정책 버전이다")

    max_change = raw.get("max_change", Policy.max_change)
    if not _is_number(max_change) or not 0 < max_change <= 0.5:
        raise PolicyError("max_change는 0 초과 0.5 이하의 수여야 한다")
    min_sample = raw.get("min_sample", Policy.min_sample)
    if not isinstance(min_sample, int) or isinstance(min_sample, bool) or min_sample < 1:
        raise PolicyError("min_sample은 1 이상의 정수여야 한다")

    targets: dict[str, tuple[float, float]] = {}
    for group, value in (raw.get("targets") or {}).items():
        if groups is not None and group not in groups:
            raise PolicyError(f"모르는 그룹: {group}")
        if (
            not isinstance(value, list | tuple)
            or len(value) != 2
            or not all(_is_number(v) for v in value)
        ):
            raise PolicyError(f"{group}: [최소, 최대] 두 수여야 한다")
        low, high = float(value[0]), float(value[1])
        if not 0 <= low < high <= 1:
            raise PolicyError(f"{group}: 0 ≤ 최소 < 최대 ≤ 1 이어야 한다")
        targets[group] = (low, high)
    return Policy(max_change=float(max_change), min_sample=min_sample, targets=targets)


def _is_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)
