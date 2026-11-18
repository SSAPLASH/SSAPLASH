"""체크포인트 하나를 데이터셋에서 돌려 클래스별 F1.

학습 중 검증과 학습 뒤 확인이 같은 함수를 씀. 입력은 정답 드럼 트랙, 피크 고르기는 어댑터와
같은 madmom 방식(`adtof_drumsep_transcriber.pick_peaks`), 점수는 `hit_f1.score_hits`.
- 클래스 five: 5가지 기준(scheme five)의 클래스별 F1. 탐은 어느 탐인지 무시한 검출 점수
- 클래스 five_pedal: five + 페달 하이햇 F1
- 클래스 five_pedal_cym: five_pedal + 크래시·라이드 F1(f1_crash·f1_ride)과 focus_f1(탐·페달·크래시·라이드 평균)
- 클래스 pads: 9패드 기준(scheme pads9)의 패드별 F1에 더해 5가지 묶음 F1도 냄
- 모든 클래스 묶음에서 페달 하이햇 정밀도·재현율·F1과 하이햇↔페달 혼동 수를 같이 냄(페달을 안 내는 모델은 페달 F1 0).
  5가지 묶음의 hihat은 하이햇과 페달을 합친 점수
규칙(탐 음높이 등)은 여기 없음.
"""

from __future__ import annotations

import csv
import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import torch

from ssaplash_ai.bench.datasets import SongItem, load_dataset
from ssaplash_ai.bench.datasets.pads import HITS_DTYPE, NO_VELOCITY, PEDAL
from ssaplash_ai.bench.metrics.hit_f1 import (
    WINDOW_SEC,
    MatchCounts,
    PedalConfusion,
    match_by_label,
    pedal_confusion,
    score_hits,
)
from ssaplash_ai.bench.transcribers.adtof_drumsep_transcriber import pick_peaks
from ssaplash_ai.train.adtof_data import FIVE_ORDER, FPS, class_names, song_features

# 저장소 기본 문턱값(ADTOF FRAME_RNN_THRESHOLDS)을 클래스 이름으로
DEFAULT_THRESHOLDS_FIVE: dict[str, float] = dict(
    zip(FIVE_ORDER, (0.22, 0.24, 0.32, 0.22, 0.30), strict=True)
)
DEFAULT_THRESHOLDS_FIVE["pedal"] = 0.22  # 페달은 하이햇 값으로 시작
DEFAULT_THRESHOLDS_FIVE["crash"] = DEFAULT_THRESHOLDS_FIVE["ride"] = 0.30  # 크래시·라이드는 심벌 값
# 9패드 기본값: 탐 3개는 탐 값, 크래시·라이드는 심벌 값, 페달은 하이햇 값
DEFAULT_THRESHOLDS_PADS: dict[str, float] = {
    "KICK": 0.22,
    "SNARE": 0.24,
    "SMALL_TOM": 0.32,
    "MID_TOM": 0.32,
    "FLOOR_TOM": 0.32,
    "HIHAT": 0.22,
    "CRASH": 0.30,
    "RIDE": 0.30,
    PEDAL: 0.22,
}
# 5가지 클래스 이름 → 예측 표 라벨. 탐·심벌은 거친 라벨 그대로
FIVE_PRED_LABEL = {
    "kick": "KICK",
    "snare": "SNARE",
    "tom": "tom",
    "hihat": "HIHAT",
    "cymbal": "cymbal",
    "pedal": PEDAL,
    "crash": "CRASH",
    "ride": "RIDE",
}
FIVE_SETS = ("five", "five_pedal", "five_pedal_cym")


def default_thresholds(classes: str) -> list[float]:
    names = class_names(classes)
    table = DEFAULT_THRESHOLDS_FIVE if classes in FIVE_SETS else DEFAULT_THRESHOLDS_PADS
    return [table[n] for n in names]


def model_activations(
    model: torch.nn.Module, feat: np.ndarray, device: str = "cpu", chunk_frames: int = 30000
) -> np.ndarray:
    """(프레임, 84) → (프레임, 클래스). 긴 곡은 chunk_frames씩 나눠 돌림(GRU라 경계 영향은 작음)."""
    model.eval()
    outs = []
    with torch.no_grad():
        for s in range(0, len(feat), chunk_frames):
            x = torch.from_numpy(feat[s : s + chunk_frames]).to(device)[None, :, :, None]
            outs.append(model(x)[0].cpu().numpy())
    return np.concatenate(outs, axis=0) if outs else np.zeros((0, 1), dtype=np.float32)


def activations_to_hits(act: np.ndarray, classes: str, thresholds: Sequence[float]) -> np.ndarray:
    """(프레임, 클래스) → 예측 타격 표. five면 라벨 KICK·SNARE·HIHAT·tom·cymbal(five_pedal은 + HIHAT_PEDAL, five_pedal_cym은 cymbal 대신 CRASH·RIDE), pads면 패드 이름."""
    names = class_names(classes)
    rows: list[tuple[float, str, int]] = []
    for k, name in enumerate(names):
        label = FIVE_PRED_LABEL[name] if classes in FIVE_SETS else name
        for t in pick_peaks(act[:, k], float(thresholds[k]), fps=FPS):
            rows.append((t, label, NO_VELOCITY))
    hits = np.array(rows, dtype=HITS_DTYPE) if rows else np.zeros(0, dtype=HITS_DTYPE)
    return hits[np.argsort(hits["time_sec"], kind="stable")]


@dataclass
class EvalResult:
    """데이터셋 하나의 집계. 개수가 원본이고 F1은 개수에서 나옴."""

    classes: str
    n_songs: int
    by_class: dict[str, MatchCounts] = field(default_factory=dict)  # 클래스 집합 기준
    by_five: dict[str, MatchCounts] = field(default_factory=dict)  # 5가지 묶음 기준
    pedal: MatchCounts = field(default_factory=MatchCounts)  # 페달 하이햇만 (패드 9종 기준)
    hihat_sep: MatchCounts = field(default_factory=MatchCounts)  # 페달을 뺀 하이햇 (패드 9종 기준)
    confusion: PedalConfusion = field(default_factory=PedalConfusion)
    crash: MatchCounts = field(
        default_factory=MatchCounts
    )  # 크래시만 (모델이 크래시·라이드를 낼 때 뜻이 있음)
    ride: MatchCounts = field(default_factory=MatchCounts)

    @property
    def f1(self) -> float:
        total = sum(self.by_five.values(), MatchCounts())
        return total.f1

    @property
    def tom_f1(self) -> float:
        return self.by_five["tom"].f1 if "tom" in self.by_five else math.nan

    @property
    def pedal_f1(self) -> float:
        return self.pedal.f1

    def class_f1(self) -> dict[str, float]:
        return {k: v.f1 for k, v in self.by_class.items()}

    def metrics(self) -> dict[str, float]:
        """log.csv·선택 기준용 평평한 dict. tom_pedal_f1은 탐 F1과 페달 F1의 평균(페달 학습의 선택 기준)."""
        out = {
            "f1": self.f1,
            "tom_f1": self.tom_f1,
            "pedal_f1": self.pedal_f1,
            "tom_pedal_f1": (self.tom_f1 + self.pedal_f1) / 2,
        }
        out.update({f"f1_{k}": v.f1 for k, v in self.by_five.items()})
        if self.classes == "pads":
            out.update({f"f1_{k}": v.f1 for k, v in self.by_class.items()})
        out.update(
            pedal_prec=self.pedal.precision,
            pedal_rec=self.pedal.recall,
            f1_hihat_sep=self.hihat_sep.f1,
            pedal_as_hihat=float(self.confusion.pedal_as_hihat),
            hihat_as_pedal=float(self.confusion.hihat_as_pedal),
        )
        if self.classes == "five_pedal_cym":
            out.update(f1_crash=self.crash.f1, f1_ride=self.ride.f1)
            out["focus_f1"] = (self.tom_f1 + self.pedal_f1 + self.crash.f1 + self.ride.f1) / 4
        return out


def evaluate_activations(
    songs: Sequence[tuple[SongItem, np.ndarray]], classes: str, thresholds: Sequence[float]
) -> EvalResult:
    """(곡, 활성값) 목록에 문턱값을 적용해 집계. 문턱값 맞추기에서 같은 활성값을 재사용."""
    names = class_names(classes)
    result = EvalResult(classes=classes, n_songs=len(songs))
    result.by_five = {k: MatchCounts() for k in FIVE_ORDER}
    result.by_class = {k: MatchCounts() for k in names}
    for song, act in songs:
        if song.hits_true is None:
            raise ValueError(f"타격 정답이 없는 곡: {song.song_id}")
        pred = activations_to_hits(act, classes, thresholds)
        five = score_hits(song.hits_true, pred, "five")
        for k, c in five.by_label.items():
            result.by_five[k] = result.by_five.get(k, MatchCounts()) + c
        # 페달·하이햇은 라벨을 안 바꾸고 짝지음 (거친 라벨 tom·cymbal이 있어도 됨)
        sep = match_by_label(song.hits_true, pred, WINDOW_SEC)
        if PEDAL in sep:
            result.pedal = result.pedal + sep[PEDAL].counts
        if "HIHAT" in sep:
            result.hihat_sep = result.hihat_sep + sep["HIHAT"].counts
        if "CRASH" in sep:
            result.crash = result.crash + sep["CRASH"].counts
        if "RIDE" in sep:
            result.ride = result.ride + sep["RIDE"].counts
        result.confusion = result.confusion + pedal_confusion(song.hits_true, pred)
        if classes == "pads":
            pads = score_hits(song.hits_true, pred, "pads9")
            for k, c in pads.by_label.items():
                result.by_class[k] = result.by_class.get(k, MatchCounts()) + c
    if classes != "pads":
        result.by_class = dict(result.by_five)
        if classes in ("five_pedal", "five_pedal_cym"):
            result.by_class["pedal"] = result.pedal
        if classes == "five_pedal_cym":
            result.by_class["crash"], result.by_class["ride"] = result.crash, result.ride
    return result


def compute_song_activations(
    model: torch.nn.Module, songs: Sequence[SongItem], device: str = "cpu"
) -> list[tuple[SongItem, np.ndarray]]:
    return [(s, model_activations(model, song_features(s), device)) for s in songs]


def evaluate_model(
    model: torch.nn.Module,
    songs: Sequence[SongItem],
    classes: str,
    thresholds: Sequence[float] | None = None,
    device: str = "cpu",
) -> EvalResult:
    """모델을 곡 목록에서 돌려 집계. thresholds가 없으면 저장소 기본값."""
    acts = compute_song_activations(model, songs, device)
    return evaluate_activations(acts, classes, thresholds or default_thresholds(classes))


def fit_thresholds(
    songs: Sequence[tuple[SongItem, np.ndarray]],
    classes: str,
    grid: Sequence[float] | None = None,
) -> list[float]:
    """클래스마다 F1이 최대인 문턱값. 기본 격자 0.10~0.60, 0.02 간격. 클래스끼리 독립.

    기본값의 F1을 넘는 격자값이 없으면 기본값 그대로(정답·예측이 없는 클래스 포함).
    """
    grid = list(grid) if grid is not None else [round(0.10 + 0.02 * i, 2) for i in range(26)]
    names = class_names(classes)
    base = default_thresholds(classes)
    best = list(base)
    for k, name in enumerate(names):
        best_t = base[k]
        best_f1 = evaluate_activations(songs, classes, base).by_class[name].f1
        for t in grid:
            trial = list(base)
            trial[k] = t
            f1 = evaluate_activations(songs, classes, trial).by_class[name].f1
            if f1 > best_f1 + 1e-9:
                best_f1, best_t = f1, t
        best[k] = float(best_t)
    return best


def load_songs(
    dataset_yaml: str | Path, n_songs: int | None = None, seed: int = 0
) -> list[SongItem]:
    """데이터셋 yaml의 곡을 읽음. n_songs가 있으면 고정 시드로 그만큼만."""
    loader = load_dataset(dataset_yaml)
    ids = loader.song_ids()
    if n_songs is not None and n_songs < len(ids):
        rng = np.random.default_rng(seed)
        ids = sorted(rng.choice(ids, size=n_songs, replace=False).tolist())
    return [loader.load(s) for s in ids]


# ---------- 표 출력 ----------


def write_results(
    out_dir: Path, rows: list[dict], columns: list[str], title: str = "adtof-eval"
) -> tuple[Path, Path]:
    """결과 행을 summary.csv·summary.md로 저장."""
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / "summary.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=columns)
        w.writeheader()
        for r in rows:
            w.writerow({k: _fmt(r.get(k)) for k in columns})
    md_path = out_dir / "summary.md"
    lines = [f"# {title}", "", "| " + " | ".join(columns) + " |", "|" + "---|" * len(columns)]
    for r in rows:
        lines.append("| " + " | ".join(_fmt(r.get(k)) for k in columns) + " |")
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return csv_path, md_path


def _fmt(v: object) -> str:
    if v is None:
        return ""
    if isinstance(v, float):
        return "" if math.isnan(v) else f"{v:.3f}"
    return str(v)
