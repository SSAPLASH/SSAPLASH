"""규칙 후보 평가.

저장한 특징(rule_features) + 규칙 설정 → assign_pads로 패드 붙이기 → 정답과 짝지어 점수. 후보 여러 개를
한 번에 비교하고, 후보 하나 = MLflow run 하나(실험 chart-rules)로 기록.

점수
- f1{패드}: 패드별 F1(50ms). 벤치마크 hit_f1과 같은 짝짓기라 기본 규칙으로 돌리면 지난 벤치마크
  hits_by_class.csv와 같은 개수가 나와야 함
- tomAssignAcc / cymbalAssignAcc: 탐(심벌) 정답과 시각이 맞은 타격 중 3종(2종)을 맞게 붙인 비율. ADTOF가
  놓치거나 잘못 잡은 것은 빼고 규칙만의 성능을 봄
- tomFalseKept / cymbalFalseKept: 정답이 근처에 없는데 탐(심벌)으로 남은 타격 수
- 혼동표: 정답 패드(행) × 붙인 패드(열). 정답 없음·예측 없음 행·열 포함
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import yaml

from ssaplash_ai.bench.analysis.rule_features import (
    RuleFeatures,
    feature_path,
    input_as_feature,
    load_features,
)
from ssaplash_ai.bench.datasets import DatasetConfig, load_dataset
from ssaplash_ai.bench.datasets.pads import (
    HITS_DTYPE,
    PADS,
    PEDAL,
    SCORED_PADS,
    make_hits,
    to_five_groups,
)
from ssaplash_ai.bench.metrics.hit_f1 import (
    WINDOW_SEC,
    MatchCounts,
    PedalConfusion,
    f1_from_counts,
    pedal_confusion,
    score_hits,
)
from ssaplash_ai.bench.runner.run_support import Logger
from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import (
    ADTOF_KICK,
    ADTOF_SNARE,
    TomAssignment,
    assign_pads,
    assign_toms,
    rules_with_defaults,
    tom_times_and_scores,
)

TOM_PADS: tuple[str, ...] = ("SMALL_TOM", "MID_TOM", "FLOOR_TOM")
CYMBAL_PADS: tuple[str, ...] = ("CRASH", "RIDE")
NONE_LABEL = "(없음)"
RULES_EXPERIMENT = "chart-rules"
IDENTITY_LABELS = {p: p for p in PADS}


@dataclass
class RuleCandidate:
    """규칙 후보 하나. rules는 yaml `rules`와 같은 키(없는 키는 기본값)."""

    name: str
    rules: dict = field(default_factory=dict)

    @property
    def full_rules(self) -> dict:
        return rules_with_defaults(self.rules)


def load_candidates(paths: Sequence[Path]) -> list[RuleCandidate]:
    """후보 yaml. 한 파일에 `candidates: [{name, rules}, ...]` 또는 `{name, rules}` 하나. name이 없으면 파일 이름."""
    out: list[RuleCandidate] = []
    for path in paths:
        path = Path(path)
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        items = raw.get("candidates") if isinstance(raw, dict) and "candidates" in raw else [raw]
        for i, item in enumerate(items):
            if not isinstance(item, dict):
                raise ValueError(f"{path}: 후보 {i}가 표(dict)가 아님")
            name = str(item.get("name") or (path.stem if len(items) == 1 else f"{path.stem}-{i}"))
            rules = item.get("rules") or {}
            if not isinstance(rules, dict):
                raise ValueError(f"{path}: 후보 {name}의 rules가 표(dict)가 아님")
            out.append(RuleCandidate(name=name, rules=dict(rules)))
    names = [c.name for c in out]
    if len(set(names)) != len(names):
        raise ValueError(f"후보 이름이 겹침: {names}")
    return out


def predict_hits(features: RuleFeatures, rules: dict) -> np.ndarray:
    """저장 특징 + 규칙 → 예측 타격 표(HITS_DTYPE, 패드 9종. 페달은 체크포인트가 낼 때만).

    입력 드럼이 있으면 거르기(tom_gate_ratio)에, 프레임별 점수가 있으면 탐 시각 다시 고르기에 씀.
    """
    raw = assign_pads(
        features.peaks_as_lists(),
        features.stems,
        features.sample_rate,
        rules,
        mixture=features.input_audio,
        activations=features.activations,
    )
    hits, _ = make_hits(
        (t for t, _, _ in raw), (label for _, label, _ in raw), None, IDENTITY_LABELS
    )
    return hits


def tom_summary(features: RuleFeatures, rules: dict) -> TomAssignment:
    """곡 하나의 탐 처리 결과(음높이·거르기·묶음·패드). by_song 통계와 분석 도구용."""
    r = rules_with_defaults(rules)
    toms = features.stems.get(r["stems"]["toms"])
    peaks = features.peaks_as_lists()
    times, scores = tom_times_and_scores(peaks, r, features.activations)
    return assign_toms(
        times,
        toms,
        features.sample_rate,
        r,
        features.input_audio,
        snare_times=peaks.get(ADTOF_SNARE, []),
        stems=features.stems,
        scores=scores,
        kick_times=peaks.get(ADTOF_KICK, []),
    )


@dataclass
class GroupResult:
    """탐 또는 심벌 묶음의 규칙만의 성능. 시각이 맞은 짝 중 패드가 같은 비율과 혼동표."""

    matched: int = 0
    correct: int = 0
    false_kept: int = 0  # 예측에만 있는 타격 (정답 없음)
    missed: int = 0  # 정답에만 있는 타격 (예측 없음)
    confusion: dict[tuple[str, str], int] = field(default_factory=dict)

    @property
    def assign_acc(self) -> float:
        return self.correct / self.matched if self.matched else math.nan

    def consistent_correct(self, pads: Sequence[str]) -> int:
        """짝지어진 타격 중, 이 묶음 안에서 정답 패드와 붙인 패드를 가장 잘 맞춰 주는 일대일 대응으로 셌을 때 맞는 수.

        곡 안에서 이름만 서로 바뀐 경우(실제 킷의 두 번째 탐을 MID로 적을지 SMALL로 적을지)를 맞은 것으로 치는
        보조 지표용. 곡마다 따로 계산해야 뜻이 있다(여러 곡을 합친 뒤 구하면 안 됨).
        """
        from itertools import permutations

        best = 0
        for perm in permutations(pads):
            total = sum(self.confusion.get((t, p), 0) for t, p in zip(pads, perm, strict=True))
            best = max(best, total)
        return best

    def __add__(self, other: GroupResult) -> GroupResult:
        conf = dict(self.confusion)
        for k, v in other.confusion.items():
            conf[k] = conf.get(k, 0) + v
        return GroupResult(
            matched=self.matched + other.matched,
            correct=self.correct + other.correct,
            false_kept=self.false_kept + other.false_kept,
            missed=self.missed + other.missed,
            confusion=conf,
        )


def group_confusion(
    hits_true: np.ndarray,
    hits_pred: np.ndarray,
    group: Sequence[str],
    window_sec: float = WINDOW_SEC,
) -> GroupResult:
    """묶음(탐 3종 또는 심벌 2종) 안에서 시각만으로 짝지은 뒤 패드가 같은지 셈."""
    import mir_eval

    t = hits_true[np.isin(hits_true["pad"], list(group))]
    p = hits_pred[np.isin(hits_pred["pad"], list(group))]
    t_times = np.asarray(t["time_sec"], dtype=np.float64)
    p_times = np.asarray(p["time_sec"], dtype=np.float64)
    pairs = mir_eval.util.match_events(t_times, p_times, window_sec)
    res = GroupResult(matched=len(pairs))
    matched_t = set()
    matched_p = set()
    for i, j in pairs:
        matched_t.add(i)
        matched_p.add(j)
        true_pad, pred_pad = str(t["pad"][i]), str(p["pad"][j])
        if true_pad == pred_pad:
            res.correct += 1
        res.confusion[(true_pad, pred_pad)] = res.confusion.get((true_pad, pred_pad), 0) + 1
    for j in range(len(p)):
        if j not in matched_p:
            key = (NONE_LABEL, str(p["pad"][j]))
            res.confusion[key] = res.confusion.get(key, 0) + 1
            res.false_kept += 1
    for i in range(len(t)):
        if i not in matched_t:
            key = (str(t["pad"][i]), NONE_LABEL)
            res.confusion[key] = res.confusion.get(key, 0) + 1
            res.missed += 1
    return res


@dataclass
class SongEval:
    song_id: str
    pads: dict[str, MatchCounts]
    five: dict[str, MatchCounts]
    tom: GroupResult
    cymbal: GroupResult
    n_true: int
    n_pred: int
    # 탐 거르기로 버린 타격 수, 상대 방식의 묶음 수와 묶음 중앙값 Hz
    tom_dropped: int = 0
    tom_clusters: int = 0
    tom_cluster_hz: str = ""
    # 곡의 킥 음높이(Hz). 킥 울림 빼기(tom_kick_exclude_st)를 껐으면 빈 문자열
    tom_kick_hz: str = ""
    # 거르기 기준 아래였지만 낮은 탐 되살리기로 남긴 수
    tom_rescued: int = 0
    # 이름을 붙인 뒤 킥과 겹쳐 버린 탐 수 (tom_kick_drop_ms)
    tom_kick_dropped: int = 0
    # 곡 안 일대일 대응으로 셌을 때 맞는 탐 수 (이름이 서로 바뀐 것은 맞은 것으로)
    tom_consistent: int = 0
    # 패드 9종 기준(페달을 HIHAT에 안 합침) 개수와 하이햇·페달 혼동 수
    pads9: dict[str, MatchCounts] = field(default_factory=dict)
    pedal: PedalConfusion = field(default_factory=PedalConfusion)


def eval_song(song_id: str, features: RuleFeatures, hits_true: np.ndarray, rules: dict) -> SongEval:
    hits_pred = predict_hits(features, rules)
    pads = score_hits(hits_true, hits_pred, "pads")
    pads9 = score_hits(hits_true, hits_pred, "pads9")
    five = score_hits(hits_true, hits_pred, "five")
    toms = tom_summary(features, rules)
    tom_group = group_confusion(hits_true, hits_pred, TOM_PADS)
    return SongEval(
        song_id=song_id,
        pads=dict(pads.by_label),
        five=dict(five.by_label),
        tom=tom_group,
        tom_consistent=tom_group.consistent_correct(TOM_PADS),
        cymbal=group_confusion(hits_true, hits_pred, CYMBAL_PADS),
        n_true=int(len(hits_true)),
        n_pred=int(len(hits_pred)),
        tom_dropped=toms.n_dropped,
        tom_clusters=toms.n_clusters,
        tom_cluster_hz="/".join(f"{m:.0f}" for m in toms.cluster_medians),
        tom_kick_hz="" if math.isnan(toms.kick_hz) else f"{toms.kick_hz:.0f}",
        tom_rescued=toms.n_rescued,
        tom_kick_dropped=toms.n_kick_dropped,
        pads9=dict(pads9.by_label),
        pedal=pedal_confusion(hits_true, hits_pred),
    )


@dataclass
class CandidateResult:
    """후보 하나 × 데이터셋 하나. 곡별 개수를 더한 값."""

    candidate: str
    dataset: str
    pads: dict[str, MatchCounts] = field(default_factory=dict)
    five: dict[str, MatchCounts] = field(default_factory=dict)
    tom: GroupResult = field(default_factory=GroupResult)
    cymbal: GroupResult = field(default_factory=GroupResult)
    tom_dropped: int = 0
    tom_rescued: int = 0
    tom_kick_dropped: int = 0
    tom_consistent: int = 0
    pads9: dict[str, MatchCounts] = field(default_factory=dict)
    pedal: PedalConfusion = field(default_factory=PedalConfusion)
    songs: list[SongEval] = field(default_factory=list)

    def f1(self, label: str) -> float:
        c = self.pads.get(label)
        return c.f1 if c is not None else math.nan

    @property
    def f1_pads(self) -> float:
        return _sum(self.pads.values()).f1

    @property
    def f1_five(self) -> float:
        return _sum(self.five.values()).f1

    @property
    def f1_tom(self) -> float:
        return _sum(self.pads.get(p, MatchCounts()) for p in TOM_PADS).f1

    @property
    def f1_cymbal(self) -> float:
        return _sum(self.pads.get(p, MatchCounts()) for p in CYMBAL_PADS).f1

    @property
    def f1_tom_consistent(self) -> float:
        """곡 안 이름 바뀜을 맞은 것으로 친 탐 F1. 맞은 수는 곡별 일대일 대응 합, 나머지 예측·정답은 틀린 것."""
        total = _sum(self.pads.get(p, MatchCounts()) for p in TOM_PADS)
        n_pred = total.tp + total.fp
        n_true = total.tp + total.fn
        tp = self.tom_consistent
        return f1_from_counts(tp, n_pred - tp, n_true - tp)

    @property
    def tom_consistent_acc(self) -> float:
        return self.tom_consistent / self.tom.matched if self.tom.matched else math.nan

    def metrics(self) -> dict[str, float]:
        """CSV 한 행 · MLflow 지표."""
        out: dict[str, float] = {f"f1{p}": self.f1(p) for p in SCORED_PADS}
        pedal = self.pads9.get(PEDAL, MatchCounts())
        out.update(
            f1Pedal=pedal.f1,
            precPedal=pedal.precision,
            recPedal=pedal.recall,
            f1HihatSep=self.pads9.get("HIHAT", MatchCounts()).f1,
            pedalAsHihat=float(self.pedal.pedal_as_hihat),
            hihatAsPedal=float(self.pedal.hihat_as_pedal),
        )
        out.update(
            f1Pads=self.f1_pads,
            f1Five=self.f1_five,
            f1Tom=self.f1_tom,
            f1Cymbal=self.f1_cymbal,
            tomAssignAcc=self.tom.assign_acc,
            tomMatched=float(self.tom.matched),
            tomFalseKept=float(self.tom.false_kept),
            tomMissed=float(self.tom.missed),
            tomDropped=float(self.tom_dropped),
            tomRescued=float(self.tom_rescued),
            tomKickDropped=float(self.tom_kick_dropped),
            tomConsistentAcc=self.tom_consistent_acc,
            f1TomConsistent=self.f1_tom_consistent,
            cymbalAssignAcc=self.cymbal.assign_acc,
            cymbalMatched=float(self.cymbal.matched),
            cymbalFalseKept=float(self.cymbal.false_kept),
            cymbalMissed=float(self.cymbal.missed),
            nSongs=float(len(self.songs)),
        )
        return out


def _sum(counts) -> MatchCounts:
    total = MatchCounts()
    for c in counts:
        total = total + c
    return total


def _add_counts(into: dict[str, MatchCounts], add: dict[str, MatchCounts]) -> None:
    for k, v in add.items():
        into[k] = into.get(k, MatchCounts()) + v


def eval_candidate(
    candidate: RuleCandidate,
    dataset_name: str,
    songs: Sequence[tuple[str, RuleFeatures, np.ndarray]],
) -> CandidateResult:
    """후보 하나를 곡 목록(곡 id, 특징, 정답 타격 표)에 돌려 개수를 합침."""
    rules = candidate.full_rules
    res = CandidateResult(candidate=candidate.name, dataset=dataset_name)
    for song_id, features, hits_true in songs:
        s = eval_song(song_id, features, hits_true, rules)
        res.songs.append(s)
        _add_counts(res.pads, s.pads)
        _add_counts(res.five, s.five)
        _add_counts(res.pads9, s.pads9)
        res.pedal = res.pedal + s.pedal
        res.tom = res.tom + s.tom
        res.cymbal = res.cymbal + s.cymbal
        res.tom_dropped += s.tom_dropped
        res.tom_rescued += s.tom_rescued
        res.tom_kick_dropped += s.tom_kick_dropped
        res.tom_consistent += s.tom_consistent
    return res


# ---------- 데이터 읽기 ----------


def rename_two_tom_upper(hits_true: np.ndarray, upper: str) -> np.ndarray:
    """탐 둘만 쓴 곡의 위쪽 탐 이름을 upper(MID_TOM 또는 SMALL_TOM)로 통일한 정답 표.

    정답에 탐 패드가 정확히 둘이고 그중 하나가 FLOOR_TOM일 때만 나머지 하나를 upper로 바꿈. 전자 드럼(GMD)은
    탐 둘 연주의 위쪽 탐을 SMALL_TOM, 실제 킷(MDB)은 MID_TOM으로 적어 같은 소리의 이름이 데이터마다 다른 것을 맞추는 용도.
    """
    if upper not in ("MID_TOM", "SMALL_TOM"):
        raise ValueError(f"two_tom_upper는 MID_TOM 또는 SMALL_TOM: {upper}")
    pads = {str(p) for p in np.unique(hits_true["pad"]) if str(p) in TOM_PADS}
    if len(pads) != 2 or "FLOOR_TOM" not in pads:
        return hits_true
    (other,) = pads - {"FLOOR_TOM"}
    if other == upper:
        return hits_true
    out = hits_true.copy()
    out["pad"][out["pad"] == other] = upper
    return out


def load_dataset_songs(
    dataset_config: Path,
    features_root: Path,
    log: Logger = print,
    with_input: bool = True,
    two_tom_upper: str | None = None,
) -> tuple[str, list[tuple[str, RuleFeatures, np.ndarray]]]:
    """데이터셋 yaml + 특징 폴더 → (데이터셋 이름, [(곡, 특징, 정답)]). 특징이 없는 곡은 오류.

    with_input이면 어댑터에 넣었던 드럼 입력(정답 드럼 트랙)도 데이터셋에서 읽어 특징에 붙임(거르기 규칙용).
    two_tom_upper를 주면 탐 둘만 쓴 곡의 정답을 `rename_two_tom_upper`로 고쳐 읽음.
    """
    dataset = load_dataset(DatasetConfig.from_yaml(dataset_config))
    songs = []
    missing = []
    n_renamed = 0
    for song_id in dataset.song_ids():
        path = feature_path(features_root, dataset.name, song_id)
        if not path.is_file():
            missing.append(song_id)
            continue
        hits = dataset.hits_of(song_id)
        if hits is None:
            raise ValueError(f"{dataset.name}/{song_id}: 타격 정답이 없음")
        hits_true, _ = hits
        if hits_true.dtype != HITS_DTYPE:
            raise ValueError(f"{dataset.name}/{song_id}: 정답 표 dtype이 HITS_DTYPE이 아님")
        if two_tom_upper:
            renamed = rename_two_tom_upper(hits_true, two_tom_upper)
            if renamed is not hits_true:
                n_renamed += 1
            hits_true = renamed
        features = load_features(path)
        if with_input:
            features.input_audio = input_as_feature(dataset.load(song_id).drums_true)
        songs.append((song_id, features, hits_true))
    if missing:
        raise FileNotFoundError(
            f"{dataset.name}: 특징 파일이 없는 곡 {len(missing)}개 (먼저 rule-features 실행): "
            f"{missing[:5]}{'...' if len(missing) > 5 else ''}"
        )
    extra = f", 탐 둘인 곡 {n_renamed}개 위쪽 탐을 {two_tom_upper}로" if two_tom_upper else ""
    log(f"[rule-eval] {dataset.name}: 곡 {len(songs)}개 특징 읽음{extra}")
    return dataset.name, songs


# ---------- 출력 ----------


def _fmt(v: float) -> str:
    if isinstance(v, float) and math.isnan(v):
        return "—"
    if isinstance(v, float) and not float(v).is_integer():
        return f"{v:.3f}"
    return str(int(v))


def confusion_rows(res: CandidateResult) -> list[dict]:
    rows = []
    for group_name, g in (("tom", res.tom), ("cymbal", res.cymbal)):
        for (true_pad, pred_pad), n in sorted(g.confusion.items()):
            rows.append(
                {
                    "candidate": res.candidate,
                    "dataset": res.dataset,
                    "group": group_name,
                    "truePad": true_pad,
                    "predPad": pred_pad,
                    "count": n,
                }
            )
    return rows


def confusion_markdown(g: GroupResult, pads: Sequence[str]) -> str:
    """정답 패드(행) × 붙인 패드(열). 마지막 행·열은 정답 없음·예측 없음."""
    cols = [*pads, NONE_LABEL]
    rows_lbl = [*pads, NONE_LABEL]
    lines = [
        "| 정답 \\ 붙임 | " + " | ".join(cols) + " |",
        "| --- | " + " | ".join("---" for _ in cols) + " |",
    ]
    for r in rows_lbl:
        cells = [
            str(g.confusion.get((r, c), 0)) if not (r == NONE_LABEL and c == NONE_LABEL) else ""
            for c in cols
        ]
        lines.append(f"| {r} | " + " | ".join(cells) + " |")
    return "\n".join(lines)


def summary_markdown(
    results: Sequence[CandidateResult], candidates: Sequence[RuleCandidate]
) -> str:
    cols = ["f1Tom", "f1SMALL_TOM", "f1MID_TOM", "f1FLOOR_TOM", "tomAssignAcc", "tomFalseKept"]
    cols += ["tomMissed", "tomDropped", "tomRescued", "tomKickDropped"]
    cols += ["tomConsistentAcc", "f1TomConsistent"]
    cols += [
        "f1Cymbal",
        "f1CRASH",
        "f1RIDE",
        "cymbalAssignAcc",
        "cymbalFalseKept",
        "f1Pads",
        "f1Five",
    ]
    lines = ["# 규칙 후보 비교", ""]
    lines.append("| 후보 | 규칙 (기본값과 다른 것) |")
    lines.append("| --- | --- |")
    for c in candidates:
        diff = {k: v for k, v in c.rules.items()}
        lines.append(f"| {c.name} | `{diff}` |" if diff else f"| {c.name} | (기본값) |")
    lines.append("")
    lines.append("| 후보 | 묶음 | " + " | ".join(cols) + " |")
    lines.append("| --- | --- | " + " | ".join("---" for _ in cols) + " |")
    for r in results:
        m = r.metrics()
        lines.append(
            f"| {r.candidate} | {r.dataset} | " + " | ".join(_fmt(m[c]) for c in cols) + " |"
        )
    lines.append("")
    lines.append(
        "f1는 50ms 기준 패드별 온셋 F1(개수 합산). AssignAcc는 정답과 시각이 맞은 타격 중 패드를 맞게 붙인 비율."
    )
    lines.append("FalseKept는 정답이 근처에 없는데 그 묶음으로 남은 타격 수.")
    for r in results:
        lines.append("")
        lines.append(f"## {r.candidate} · {r.dataset}")
        lines.append("")
        lines.append("탐 혼동표")
        lines.append("")
        lines.append(confusion_markdown(r.tom, TOM_PADS))
        lines.append("")
        lines.append("심벌 혼동표")
        lines.append("")
        lines.append(confusion_markdown(r.cymbal, CYMBAL_PADS))
    return "\n".join(lines) + "\n"


@dataclass
class RuleEvalOptions:
    features_root: Path
    dataset_configs: Sequence[Path]
    candidate_configs: Sequence[Path]
    out_dir: Path
    mlflow_uri: str | None = None  # None이면 기록 안 함
    two_tom_upper: str | None = None  # 탐 둘인 곡의 위쪽 탐 정답 이름 통일 (MID_TOM·SMALL_TOM)


@dataclass
class RuleEvalResult:
    results: list[CandidateResult]
    candidates: list[RuleCandidate]
    out_dir: Path
    csv_path: Path
    confusion_csv_path: Path
    by_song_csv_path: Path
    summary_md: Path


def run_rule_eval(opts: RuleEvalOptions, log: Logger = print) -> RuleEvalResult:
    from ssaplash_ai.bench.runner.run_support import CsvWriter

    candidates = load_candidates(opts.candidate_configs)
    datasets = [
        load_dataset_songs(p, Path(opts.features_root), log, two_tom_upper=opts.two_tom_upper)
        for p in opts.dataset_configs
    ]
    results: list[CandidateResult] = []
    for cand in candidates:
        for ds_name, songs in datasets:
            res = eval_candidate(cand, ds_name, songs)
            results.append(res)
            m = res.metrics()
            log(
                f"[rule-eval] {cand.name} · {ds_name}: f1Tom={m['f1Tom']:.3f} "
                f"tomAcc={m['tomAssignAcc']:.3f} f1Cymbal={m['f1Cymbal']:.3f} "
                f"cymbalAcc={m['cymbalAssignAcc']:.3f} f1Pads={m['f1Pads']:.3f}"
            )
    out_dir = Path(opts.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    # 나중에 relog가 규칙값을 파라미터로 올릴 수 있게 후보를 결과 폴더에 같이 남김
    (out_dir / "candidates.yaml").write_text(
        yaml.safe_dump(
            {"candidates": [{"name": c.name, "rules": c.rules} for c in candidates]},
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    metric_cols = list(results[0].metrics().keys()) if results else []
    csv_path = out_dir / "candidates.csv"
    w = CsvWriter(csv_path, ["candidate", "dataset", *metric_cols])
    for r in results:
        w.write({"candidate": r.candidate, "dataset": r.dataset, **r.metrics()})
    w.close()
    conf_path = out_dir / "confusion.csv"
    w = CsvWriter(conf_path, ["candidate", "dataset", "group", "truePad", "predPad", "count"])
    for r in results:
        w.write_many(confusion_rows(r))
    w.close()
    by_song_path = out_dir / "by_song.csv"
    song_cols = [
        "candidate",
        "dataset",
        "songId",
        "nTrue",
        "nPred",
        "tomMatched",
        "tomCorrect",
        "tomFalseKept",
        "tomDropped",
        "tomRescued",
        "tomKickDropped",
        "tomConsistent",
        "tomClusters",
        "tomClusterHz",
        "tomKickHz",
        "cymbalMatched",
        "cymbalCorrect",
        "cymbalFalseKept",
    ]
    song_cols += [f"tp{p}" for p in SCORED_PADS] + [f"fp{p}" for p in SCORED_PADS]
    song_cols += [f"fn{p}" for p in SCORED_PADS]
    # 패드 9종 기준 하이햇·페달 개수와 혼동 수 (페달 표·곡 단위 구간용)
    sep_pads = ("HIHAT", PEDAL)
    song_cols += [f"{k}{p}9" for p in sep_pads for k in ("tp", "fp", "fn")]
    song_cols += ["pedalAsHihat", "hihatAsPedal"]
    w = CsvWriter(by_song_path, song_cols)
    for r in results:
        for s in r.songs:
            row = {
                "candidate": r.candidate,
                "dataset": r.dataset,
                "songId": s.song_id,
                "nTrue": s.n_true,
                "nPred": s.n_pred,
                "tomMatched": s.tom.matched,
                "tomCorrect": s.tom.correct,
                "tomFalseKept": s.tom.false_kept,
                "tomDropped": s.tom_dropped,
                "tomRescued": s.tom_rescued,
                "tomKickDropped": s.tom_kick_dropped,
                "tomConsistent": s.tom_consistent,
                "tomClusters": s.tom_clusters,
                "tomClusterHz": s.tom_cluster_hz,
                "tomKickHz": s.tom_kick_hz,
                "cymbalMatched": s.cymbal.matched,
                "cymbalCorrect": s.cymbal.correct,
                "cymbalFalseKept": s.cymbal.false_kept,
            }
            for p in SCORED_PADS:
                c = s.pads.get(p, MatchCounts())
                row[f"tp{p}"], row[f"fp{p}"], row[f"fn{p}"] = c.tp, c.fp, c.fn
            for p in sep_pads:
                c = s.pads9.get(p, MatchCounts())
                row[f"tp{p}9"], row[f"fp{p}9"], row[f"fn{p}9"] = c.tp, c.fp, c.fn
            row["pedalAsHihat"] = s.pedal.pedal_as_hihat
            row["hihatAsPedal"] = s.pedal.hihat_as_pedal
            w.write(row)
    w.close()
    summary_md = out_dir / "summary.md"
    summary_md.write_text(summary_markdown(results, candidates), encoding="utf-8")
    if opts.mlflow_uri and opts.mlflow_uri.lower() != "none":
        from ssaplash_ai.bench.runner.mlflow_tracking import log_run

        for cand in candidates:
            per_dataset = {r.dataset: r.metrics() for r in results if r.candidate == cand.name}
            params = {f"rules.{k}": v for k, v in cand.full_rules.items()}
            params["candidate"] = cand.name
            params["datasets"] = ",".join(per_dataset)
            # 후보 이름이 여러 결과 폴더에 겹쳐 나와서 runId는 `폴더 이름/후보 이름` (relog와 같은 규칙)
            run_id = log_run(
                run_id=f"{out_dir.name}/{cand.name}",
                params=params,
                summary_metrics=per_dataset,
                artifacts=[csv_path, conf_path, summary_md, out_dir / "candidates.yaml"],
                tags={"candidate": cand.name},
                tracking_uri=opts.mlflow_uri,
                experiment_name=RULES_EXPERIMENT,
            )
            log(f"[rule-eval] MLflow run {cand.name}: {run_id}")
    log(f"[rule-eval] 결과 → {summary_md}")
    return RuleEvalResult(
        results, candidates, out_dir, csv_path, conf_path, by_song_path, summary_md
    )


def pads_by_label_from_five(hits_true: np.ndarray) -> dict[str, int]:
    """정답 표를 5가지 묶음으로 센 개수 (보조)."""
    five = to_five_groups(hits_true)
    out: dict[str, int] = {}
    for label in five["pad"].tolist():
        out[label] = out.get(label, 0) + 1
    return out


__all__ = [
    "CYMBAL_PADS",
    "NONE_LABEL",
    "RULES_EXPERIMENT",
    "TOM_PADS",
    "CandidateResult",
    "GroupResult",
    "RuleCandidate",
    "RuleEvalOptions",
    "RuleEvalResult",
    "SongEval",
    "confusion_markdown",
    "eval_candidate",
    "eval_song",
    "group_confusion",
    "load_candidates",
    "rename_two_tom_upper",
    "load_dataset_songs",
    "predict_hits",
    "run_rule_eval",
    "summary_markdown",
    "tom_summary",
]
