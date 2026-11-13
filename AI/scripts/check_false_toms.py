"""정답 없는 탐 자리 확인 (파인튜닝 뒤 ENST 탐 하락 원인 찾기).

rule-eval과 같은 특징 파일·규칙 후보로 곡마다 탐 예측을 다시 만들고, 정답 탐과 50ms 안에서 짝이 안 된 탐
(rule-eval의 tomFalseKept)마다 그 자리 ±50ms 안에 정답 주석이 무엇이었는지 셈. ENST는 원래 주석 라벨
(bd·sd·chh·sweep 등)을, 다른 데이터는 정답 패드 이름을 씀. 같은 자리에 ADTOF 킥 피크가 있었는지,
탐 점수가 얼마였는지도 같이 적음. 특징 폴더를 여럿 주면 같은 곡끼리 나란히 비교.

  uv run python scripts/check_false_toms.py \\
      --features base=data/rule_features --features tom_6cls=data/rule_features_ft_tom_6cls \\
      --dataset configs/bench/datasets/enst_minus_one.yaml --song-prefix drummer_1 \\
      --candidates docs/chart-rules/tom-newkits-2026-10-29/candidates.yaml --candidate pk_gap30 \\
      --two-tom-upper MID_TOM --out data/results/false-toms-enst-drummer_1.md
"""

from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

import numpy as np

from ssaplash_ai.bench.analysis.rule_eval import (
    TOM_PADS,
    load_candidates,
    predict_hits,
    rename_two_tom_upper,
)
from ssaplash_ai.bench.analysis.rule_features import feature_path, input_as_feature, load_features
from ssaplash_ai.bench.datasets import DatasetConfig, load_dataset
from ssaplash_ai.bench.datasets.enst import parse_song_id, read_annotation
from ssaplash_ai.bench.metrics.hit_f1 import WINDOW_SEC
from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import (
    ADTOF_LABELS,
    ADTOF_TOM,
    tom_scores,
)

ADTOF_KICK = 35
KICK_PEAK_SEC = 0.03  # ADTOF 킥 피크가 같은 자리라고 볼 거리
NONE = "(없음)"
TOP_COMBOS = 12
TOP_SONGS = 8


def true_labels(dataset, song_id: str, hits_true: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """곡의 정답 (시각, 라벨). ENST는 원래 주석 라벨, 다른 데이터는 정답 패드 이름."""
    if dataset.kind == "enst":
        drummer, name = parse_song_id(song_id)
        path = dataset.config.root / f"drummer_{drummer}" / "annotation" / f"{name}.txt"
        rows = read_annotation(path)
        if dataset.config.clip is not None:
            start, end = dataset.config.clip
            rows = [(t - start, lab) for t, lab in rows if start <= t < end]
        return np.array([t for t, _ in rows], dtype=np.float64), np.array([lab for _, lab in rows])
    return (
        np.asarray(hits_true["time_sec"], dtype=np.float64),
        np.array([str(p) for p in hits_true["pad"]]),
    )


def false_tom_index(hits_true: np.ndarray, hits_pred: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """탐 예측 중 정답 탐과 짝이 안 된 것의 위치와, 짝이 된 것의 위치 (rule-eval group_confusion과 같은 짝짓기)."""
    import mir_eval

    t_mask = np.isin(hits_true["pad"], list(TOM_PADS))
    p_idx = np.flatnonzero(np.isin(hits_pred["pad"], list(TOM_PADS)))
    t_times = np.asarray(hits_true["time_sec"][t_mask], dtype=np.float64)
    p_times = np.asarray(hits_pred["time_sec"][p_idx], dtype=np.float64)
    pairs = mir_eval.util.match_events(t_times, p_times, WINDOW_SEC)
    matched = {j for _, j in pairs}
    false = np.array([p_idx[j] for j in range(len(p_idx)) if j not in matched], dtype=int)
    hit = np.array([p_idx[j] for j in sorted(matched)], dtype=int)
    return false, hit


def check_song(dataset, song_id, features, hits_true, rules) -> dict:
    hits_pred = predict_hits(features, rules)
    false, hit = false_tom_index(hits_true, hits_pred)
    times, labels = true_labels(dataset, song_id, hits_true)
    kick_peaks = np.asarray(features.peaks.get(ADTOF_KICK, []), dtype=np.float64)
    act = features.activations
    tom_col = ADTOF_LABELS.index(ADTOF_TOM)
    combos: Counter = Counter()
    single: Counter = Counter()
    nearest_ms: list[float] = []
    n_kick_peak = 0
    pads: Counter = Counter()
    for i in false:
        t = float(hits_pred["time_sec"][i])
        pads[str(hits_pred["pad"][i])] += 1
        near = sorted(set(labels[np.abs(times - t) <= WINDOW_SEC]))
        combos["+".join(near) if near else NONE] += 1
        for lab in near:
            single[lab] += 1
        if times.size:
            nearest_ms.append(float(np.min(np.abs(times - t))) * 1000)
        if kick_peaks.size and np.min(np.abs(kick_peaks - t)) <= KICK_PEAK_SEC:
            n_kick_peak += 1

    def scores(idx):
        if act is None or not len(idx):
            return []
        return list(tom_scores(act[:, tom_col], [float(hits_pred["time_sec"][i]) for i in idx]))

    return {
        "n_false": int(len(false)),
        "n_hit": int(len(hit)),
        "combos": combos,
        "single": single,
        "nearest_ms": nearest_ms,
        "n_kick_peak": n_kick_peak,
        "pads": pads,
        "score_false": scores(false),
        "score_hit": scores(hit),
    }


def merge(results: list[dict]) -> dict:
    out = {
        "n_false": 0,
        "n_hit": 0,
        "n_kick_peak": 0,
        "nearest_ms": [],
        "score_false": [],
        "score_hit": [],
    }
    for key in ("combos", "single", "pads"):
        out[key] = Counter()
    for r in results:
        for key in ("n_false", "n_hit", "n_kick_peak"):
            out[key] += r[key]
        for key in ("nearest_ms", "score_false", "score_hit"):
            out[key] += r[key]
        for key in ("combos", "single", "pads"):
            out[key].update(r[key])
    return out


def _pct(n: int, total: int) -> str:
    return f"{n} ({n / total:.0%})" if total else "0"


def _med(xs: list[float], fmt: str = "{:.2f}") -> str:
    return fmt.format(float(np.median(xs))) if xs else "-"


def section(name: str, total: dict, per_song: dict[str, dict]) -> list[str]:
    n = total["n_false"]
    lines = [
        f"## {name}",
        "",
        f"- 정답 없는 탐 {n}개, 정답 탐과 짝이 된 탐 {total['n_hit']}개",
        f"- 정답 없는 탐에 붙은 패드: {', '.join(f'{p} {c}' for p, c in total['pads'].most_common())}",
        f"- 같은 자리(±{int(KICK_PEAK_SEC * 1000)}ms)에 ADTOF 킥 피크도 있음: {_pct(total['n_kick_peak'], n)}",
        f"- 가장 가까운 정답 주석까지 거리 중앙값 {_med(total['nearest_ms'], '{:.0f}')}ms",
        f"- 탐 점수 중앙값: 정답 없는 탐 {_med(total['score_false'])}, 짝이 된 탐 {_med(total['score_hit'])}",
        "",
        f"±{int(WINDOW_SEC * 1000)}ms 안 정답 주석 조합 (위 {TOP_COMBOS}개)",
        "",
        "| 정답 주석 | 개수 |",
        "| --- | --- |",
    ]
    lines += [f"| {c} | {_pct(k, n)} |" for c, k in total["combos"].most_common(TOP_COMBOS)]
    lines += [
        "",
        "라벨 하나씩: 정답 없는 탐 ±50ms 안에 그 라벨이 있는 개수 (한 자리에 여럿이면 각각 셈)",
        "",
        "| 라벨 | 개수 |",
        "| --- | --- |",
    ]
    lines += [f"| {lab} | {_pct(k, n)} |" for lab, k in total["single"].most_common()]
    lines += [
        "",
        f"정답 없는 탐이 많은 곡 (위 {TOP_SONGS}곡)",
        "",
        "| 곡 | 정답 없는 탐 | 가장 많은 정답 주석 |",
        "| --- | --- | --- |",
    ]
    top = sorted(
        (s for s in per_song if per_song[s]["n_false"]), key=lambda s: -per_song[s]["n_false"]
    )
    top = top[:TOP_SONGS]
    for s in top:
        r = per_song[s]
        common = ", ".join(f"{c} {k}" for c, k in r["combos"].most_common(3))
        lines.append(f"| {s} | {r['n_false']} | {common} |")
    lines.append("")
    return lines


def parse_named(values: list[str]) -> list[tuple[str, Path]]:
    out = []
    for v in values:
        name, sep, path = v.partition("=")
        if not sep:
            raise SystemExit(f"--features는 이름=폴더 형식: {v}")
        out.append((name, Path(path)))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="정답 없는 탐 자리의 정답 주석 세기")
    ap.add_argument("--features", action="append", required=True, help="이름=특징 폴더 (여러 번)")
    ap.add_argument("--dataset", type=Path, required=True, help="데이터셋 yaml")
    ap.add_argument("--song-prefix", default="", help="이 문자열로 시작하는 곡만 (예: drummer_1)")
    ap.add_argument("--candidates", type=Path, required=True, help="규칙 후보 yaml")
    ap.add_argument("--candidate", default="pk_gap30", help="쓸 후보 이름")
    ap.add_argument(
        "--two-tom-upper", default="MID_TOM", help="rule-eval과 같은 값. 빈 문자열이면 안 바꿈"
    )
    ap.add_argument("--out", type=Path, required=True, help="결과 md")
    args = ap.parse_args()

    cand = {c.name: c for c in load_candidates([args.candidates])}
    if args.candidate not in cand:
        raise SystemExit(f"후보 {args.candidate}가 없음: {sorted(cand)}")
    rules = cand[args.candidate].full_rules
    dataset = load_dataset(DatasetConfig.from_yaml(args.dataset))
    songs = [s for s in dataset.song_ids() if s.startswith(args.song_prefix)]
    print(f"[false-toms] {dataset.name}: 곡 {len(songs)}개, 후보 {args.candidate}")

    named = parse_named(args.features)
    per_root: dict[str, dict[str, dict]] = {name: {} for name, _ in named}
    for song_id in songs:
        hits_true, _ = dataset.hits_of(song_id)
        if args.two_tom_upper:
            hits_true = rename_two_tom_upper(hits_true, args.two_tom_upper)
        drums = input_as_feature(dataset.load(song_id).drums_true)
        for name, root in named:
            path = feature_path(root, dataset.name, song_id)
            if not path.is_file():
                raise SystemExit(f"특징 파일이 없음: {path}")
            features = load_features(path)
            features.input_audio = drums
            per_root[name][song_id] = check_song(dataset, song_id, features, hits_true, rules)
        print(
            f"[false-toms] {song_id}: "
            + ", ".join(f"{n} {per_root[n][song_id]['n_false']}" for n, _ in named)
        )

    lines = [
        f"# 정답 없는 탐 자리 확인: {dataset.name} {args.song_prefix or '전체'} ({len(songs)}곡, 후보 {args.candidate})",
        "",
        "정답 없는 탐 = 정답 탐과 50ms 안에서 짝이 안 된 탐 예측 (rule-eval tomFalseKept와 같은 수).",
        "",
    ]
    for name, _ in named:
        lines += section(name, merge(list(per_root[name].values())), per_root[name])
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(lines), encoding="utf-8")
    print(f"[false-toms] 결과 → {args.out}")


if __name__ == "__main__":
    main()
