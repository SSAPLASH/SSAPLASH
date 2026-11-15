"""탐 그룹 규칙 후보 yaml 만들기.

ADTOF + 드럼 킷 분리 규칙(`adtof_drumsep.yaml` rules, 되돌리기용 모델)에서 곡 안 탐 그룹 나누기·이름 붙이기
키만 바꾼 후보를 만듦.
- current: `adtof_drumsep.yaml` 규칙 그대로
- current_order: 이름 규칙만 order(그룹 1개면 미드, 2개면 플로어·미드, Hz 기준 없음)
- 나머지: order + 그룹 사이 최소 반음·히스토그램 폭·작은 그룹 비율·음높이 재는 방식 조합

  uv run python scripts/tom_rule_grid.py --out docs/chart-rules/tom-rule-retune-2026-11 --parts 1
"""

from __future__ import annotations

import argparse
import copy
import itertools
from pathlib import Path

import yaml

SERVICE_YAML = Path("configs/bench/transcribers/adtof_drumsep/adtof_drumsep.yaml")
GAPS = (1.5, 2.0, 2.5, 3.0, 3.5)
SMOOTHS = (0.25, 0.5, 0.75)
FRACS = (0.0, 0.05, 0.1)
F0_METHODS = ("peak", "median")


def service_rules(path: Path = SERVICE_YAML) -> dict:
    """ADTOF + 드럼 킷 분리 모델 yaml의 rules (stems 포함)"""
    return dict(yaml.safe_load(path.read_text(encoding="utf-8"))["rules"])


def candidate_name(gap: float, smooth: float, frac: float, f0: str) -> str:
    """예: order_gap25_sm050_fr05_peak"""
    return (
        f"order_gap{round(gap * 10):02d}_sm{round(smooth * 100):03d}_fr{round(frac * 100):02d}_{f0}"
    )


def build_candidates(base: dict) -> list[dict]:
    """[{name, rules}]. current·current_order가 앞, 나머지는 조합 순서. 이름이 겹치면 오류"""
    out = [
        {"name": "current", "rules": copy.deepcopy(base)},
        {"name": "current_order", "rules": {**copy.deepcopy(base), "tom_relative_naming": "order"}},
    ]
    for gap, smooth, frac, f0 in itertools.product(GAPS, SMOOTHS, FRACS, F0_METHODS):
        rules = {
            **copy.deepcopy(base),
            "tom_relative_naming": "order",
            "tom_relative_min_gap": gap,
            "tom_relative_smooth": smooth,
            "tom_relative_min_frac": frac,
            "tom_f0_method": f0,
        }
        out.append({"name": candidate_name(gap, smooth, frac, f0), "rules": rules})
    names = [c["name"] for c in out]
    if len(set(names)) != len(names):
        raise ValueError("후보 이름이 겹침")
    return out


def split(cands: list[dict], parts: int) -> list[list[dict]]:
    """후보를 parts개로 고르게 나눔 (순서 유지)"""
    if parts < 1:
        raise ValueError("parts는 1 이상")
    size = -(-len(cands) // parts)
    return [cands[i : i + size] for i in range(0, len(cands), size)]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--service",
        type=Path,
        default=SERVICE_YAML,
        help="규칙을 읽을 ADTOF + 드럼 킷 분리 모델 yaml",
    )
    ap.add_argument("--out", type=Path, required=True, help="후보 yaml 폴더")
    ap.add_argument("--parts", type=int, default=1, help="후보 yaml 개수 (서버에서 동시에 돌릴 때)")
    args = ap.parse_args()
    cands = build_candidates(service_rules(args.service))
    args.out.mkdir(parents=True, exist_ok=True)
    for k, part in enumerate(split(cands, args.parts), 1):
        path = args.out / f"candidates_part{k}.yaml"
        path.write_text(
            yaml.safe_dump({"candidates": part}, allow_unicode=True, sort_keys=False),
            encoding="utf-8",
            newline="\n",
        )
        print(f"{path}: 후보 {len(part)}개")
    print(f"후보 전체 {len(cands)}개")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
