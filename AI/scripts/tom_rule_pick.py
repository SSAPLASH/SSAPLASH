"""탐 그룹 규칙 후보 고르기와 ENST 확인.

입력은 `scripts/tom_rule_eval_stream.py`가 낸 곡별 csv (한 줄 = 후보 × 곡).

- select: E-GMD 결과에서 키트마다 탐 이름 정확도(탐 자리를 맞힌 타격 중 이름이 맞은 비율)를 내고, 26킷 평균이 가장 높은
  후보를 고름. 1등과 0.005 안에 여럿이면 current(`adtof_drumsep.yaml` 규칙)에서 바꾼 키가 적은 쪽.
  키트 하나를 빼고 고른 뒤 뺀 키트에서 current 대비 차이를 측정하는 것을 키트마다 반복함. ENST·MDB는 읽지 않음
- enst: ENST 드럼 단독·분리 입력 결과에서 current와 고른 후보의 차이를 64곡 전체·드러머 1·드러머 2·3으로
  나눠 냄. 같은 곡끼리 다시 뽑는 부트스트랩 95% 구간

  uv run python scripts/tom_rule_pick.py select --egmd egmd.csv --candidates cands.yaml --out pick.json
  uv run python scripts/tom_rule_pick.py enst --pick pick.json --set enst_drums=a.csv:0.828 \
      --set enst_mix_g100=b.csv:0.782 --out summary.md
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

TOM_PADS = ("SMALL_TOM", "MID_TOM", "FLOOR_TOM")
SCORED = ("KICK", "SNARE", "HIHAT", "SMALL_TOM", "MID_TOM", "FLOOR_TOM", "CRASH", "RIDE")
CURRENT = "current"
TIE = 0.005
GROUPS = {
    "전체": lambda s: True,
    "드러머 1": lambda s: s.startswith("drummer_1/"),
    "드러머 2·3": lambda s: not s.startswith("drummer_1/"),
}


def f1(tp: float, fp: float, fn: float) -> float:
    d = 2 * tp + fp + fn
    return 2 * tp / d if d else float("nan")


def kit_accuracy(df: pd.DataFrame) -> pd.DataFrame:
    """(후보 × 키트) 탐 이름 정확도 = 합친 tomCorrect / 합친 tomMatched"""
    g = df.groupby(["candidate", "kit"])[["tomCorrect", "tomMatched"]].sum()
    return (g["tomCorrect"] / g["tomMatched"]).unstack("kit")


def changed_keys(cands: dict[str, dict], name: str) -> int:
    """current 규칙에서 바뀐 키 수"""
    base, rules = cands[CURRENT], cands[name]
    keys = set(base) | set(rules)
    return sum(base.get(k) != rules.get(k) for k in keys)


def choose(acc: pd.DataFrame, kits: list[str], cands: dict[str, dict]) -> str:
    """kits 평균 정확도 1등 후보. 1등과 TIE 안이면 바뀐 키가 적은 쪽, 그다음 이름 순"""
    mean = acc[kits].mean(axis=1)
    top = mean.max()
    near = [c for c in mean.index if mean[c] >= top - TIE]
    return min(near, key=lambda c: (changed_keys(cands, c), -mean[c], c))


def leave_one_kit_out(acc: pd.DataFrame, cands: dict[str, dict]) -> pd.DataFrame:
    """키트마다: 나머지로 고른 후보, 뺀 키트에서 current 대비 정확도 차이"""
    kits = list(acc.columns)
    rows = []
    for k in kits:
        rest = [x for x in kits if x != k]
        c = choose(acc, rest, cands)
        rows.append(
            {
                "kit": k,
                "chosen": c,
                "acc_current": acc.loc[CURRENT, k],
                "acc_chosen": acc.loc[c, k],
                "diff": acc.loc[c, k] - acc.loc[CURRENT, k],
            }
        )
    return pd.DataFrame(rows)


def song_matrix(df: pd.DataFrame, cand: str, songs: list[str]) -> dict[str, np.ndarray]:
    """후보 하나의 곡별 개수 배열 (songs 순서). tom3·pads8은 [곡, tp/fp/fn]"""
    d = df[df["candidate"] == cand].set_index("songId").loc[songs]
    tom = np.stack([d[[f"{k}{p}" for p in TOM_PADS]].sum(axis=1) for k in ("tp", "fp", "fn")], 1)
    pads = np.stack([d[[f"{k}{p}" for p in SCORED]].sum(axis=1) for k in ("tp", "fp", "fn")], 1)
    return {
        "tom3": tom.astype(float),
        "pads8": pads.astype(float),
        "name": np.stack([d["tomCorrect"], d["tomMatched"]], 1).astype(float),
        "kinds": d["tomTrueKinds"].to_numpy(),
        "clusters": d["tomClusters"].to_numpy(),
    }


def _metric(m: dict[str, np.ndarray], idx: np.ndarray, key: str) -> float:
    s = m[key][idx].sum(axis=0)
    if key == "name":
        return s[0] / s[1] if s[1] else float("nan")
    return f1(*s)


def paired_bootstrap(
    a: dict, b: dict, key: str, n_boot: int = 2000, seed: int = 0
) -> tuple[float, float, float]:
    """b − a 차이와 같은 곡끼리 다시 뽑은 95% 구간"""
    n = a[key].shape[0]
    full = np.arange(n)
    diff = _metric(b, full, key) - _metric(a, full, key)
    rng = np.random.default_rng(seed)
    boots = []
    for _ in range(n_boot):
        idx = rng.integers(0, n, n)
        boots.append(_metric(b, idx, key) - _metric(a, idx, key))
    lo, hi = np.nanpercentile(boots, [2.5, 97.5])
    return float(diff), float(lo), float(hi)


def enst_table(df: pd.DataFrame, others: list[str], baseline8: float) -> list[dict]:
    """ENST 결과 하나 → 곡 그룹 × 후보 줄"""
    rows = []
    for gname, keep in GROUPS.items():
        songs = sorted(s for s in df["songId"].unique() if keep(s))
        base = song_matrix(df, CURRENT, songs)
        full = np.arange(len(songs))
        for cand in [CURRENT, *others]:
            m = song_matrix(df, cand, songs)
            has = m["kinds"] > 0
            row = {
                "group": gname,
                "songs": len(songs),
                "candidate": cand,
                "tom3": _metric(m, full, "tom3"),
                "name_acc": _metric(m, full, "name"),
                "pads8_diff": _metric(m, full, "pads8") - _metric(base, full, "pads8"),
                "kinds_match": float(np.mean(m["kinds"][has] == m["clusters"][has]))
                if has.any()
                else float("nan"),
            }
            row["pads8_rideref"] = (
                (baseline8 + row["pads8_diff"]) if gname == "전체" else float("nan")
            )
            if cand != CURRENT:
                for key in ("tom3", "pads8", "name"):
                    d, lo, hi = paired_bootstrap(base, m, key)
                    row[f"{key}_d"], row[f"{key}_lo"], row[f"{key}_hi"] = d, lo, hi
            rows.append(row)
    return rows


def read_candidates(paths: list[Path]) -> dict[str, dict]:
    out = {}
    for p in paths:
        for c in yaml.safe_load(p.read_text(encoding="utf-8"))["candidates"]:
            out[c["name"]] = c["rules"]
    return out


def cmd_select(args) -> int:
    df = pd.concat([pd.read_csv(p) for p in args.egmd])
    cands = read_candidates(args.candidates)
    acc = kit_accuracy(df)
    kits = list(acc.columns)
    chosen = choose(acc, kits, cands)
    loko = leave_one_kit_out(acc, cands)
    mean = acc.mean(axis=1).sort_values(ascending=False)
    one = df[df["tomTrueKinds"] == 1].groupby("candidate")[["tomCorrect", "tomMatched"]].sum()
    out = {
        "chosen": chosen,
        "kits": len(kits),
        "mean_acc": {c: round(float(v), 4) for c, v in mean.items()},
        "chosen_rules": cands[chosen],
        "loko": loko.round(4).to_dict(orient="records"),
        "one_tom_acc": {
            c: round(float(r.tomCorrect / r.tomMatched), 4)
            for c, r in one.iterrows()
            if r.tomMatched
        },
    }
    args.out.write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n"
    )
    acc.round(4).to_csv(args.out.with_suffix(".kits.csv"), encoding="utf-8", lineterminator="\n")
    print(f"고른 후보 {chosen} (26킷 평균 {mean[chosen]:.4f}, current {mean[CURRENT]:.4f})")
    print(
        f"키트 하나 빼기: 차이 중앙값 {loko['diff'].median():.4f}, 최솟값 {loko['diff'].min():.4f}"
    )
    print("키트 하나 빼기에서 고른 후보:", loko["chosen"].value_counts().to_dict())
    return 0


def _fmt(v) -> str:
    return "—" if v is None or (isinstance(v, float) and np.isnan(v)) else f"{v:.3f}"


def cmd_enst(args) -> int:
    pick = json.loads(args.pick.read_text(encoding="utf-8"))
    others = [c for c in dict.fromkeys(["current_order", pick["chosen"]]) if c != CURRENT]
    lines = [
        "# ENST 확인 채점 (탐 그룹 규칙)",
        "",
        f"고른 후보 `{pick['chosen']}`. current는 adtof_drumsep.yaml 규칙, current_order는 이름 규칙만 order. "
        "차이는 current 대비, 괄호는 같은 곡끼리 2,000번 다시 뽑은 95% 구간. 8패드는 페달을 하이햇에 합친 값이고 "
        "RIDE 기준 값은 `분리와 채보` 베이스라인에 차이를 더한 것",
        "",
    ]
    for spec in args.set:
        name, rest = spec.split("=", 1)
        path, base8 = rest.rsplit(":", 1)
        df = pd.read_csv(path)
        present = set(df["candidate"].unique())
        rows = enst_table(df, [c for c in others if c in present], float(base8))
        lines += [
            f"## {name}",
            "",
            "| 곡 | 후보 | 탐 3종 F1 | 차이 | 탐 이름 정확도 | 차이 | 8패드 차이 | 8패드 (RIDE 기준) | 탐 종류 수 = 그룹 수 |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
        for r in rows:

            def ci(k, r=r):
                if f"{k}_d" not in r:
                    return "—"
                return f"{r[f'{k}_d']:+.3f} ({r[f'{k}_lo']:+.3f} ~ {r[f'{k}_hi']:+.3f})"

            lines.append(
                f"| {r['group']} ({r['songs']}) | {r['candidate']} | {_fmt(r['tom3'])} | {ci('tom3')} | "
                f"{_fmt(r['name_acc'])} | {ci('name')} | {ci('pads8')} | {_fmt(r['pads8_rideref'])} | "
                f"{_fmt(r['kinds_match'])} |"
            )
        lines.append("")
    args.out.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print("\n".join(lines))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("select")
    s.add_argument("--egmd", nargs="+", type=Path, required=True)
    s.add_argument("--candidates", nargs="+", type=Path, required=True)
    s.add_argument("--out", type=Path, required=True)
    e = sub.add_parser("enst")
    e.add_argument("--pick", type=Path, required=True)
    e.add_argument("--set", action="append", required=True, help="이름=곡별csv:베이스라인8패드")
    e.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    return cmd_select(args) if args.cmd == "select" else cmd_enst(args)


if __name__ == "__main__":
    raise SystemExit(main())
