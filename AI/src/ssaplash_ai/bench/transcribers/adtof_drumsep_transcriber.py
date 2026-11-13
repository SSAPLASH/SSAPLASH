"""ADTOF + 드럼 킷 분리 어댑터. 5가지를 내는 ADTOF 결과를 8패드로 늘림.

흐름: ADTOF(킥·스네어·하이햇·탐·심벌) → MDX23C DrumSep으로 입력 드럼을 6스템으로 나눔 → 규칙으로 탐·심벌에 패드를 붙임.
킥·스네어·하이햇은 ADTOF 결과 그대로. 세기 없음.
- 탐: 탐 스템에서 타격 직후 window_ms 구간의 스펙트럼 최대 피크를 음높이로 봄. tom_mode가 fixed면 tom_bands 경계로,
  relative면 곡 안 음높이를 1~3묶음으로 나눠 이름을 붙임. tom_gate_ratio가 있으면 탐 트랙 에너지가 작은 타격은 버림
- 심벌: 타격 직후 crash 스템과 ride 스템의 에너지를 비교해 큰 쪽. crash에는 cymbal_crash_weight를 곱함.
  크래시·라이드를 따로 내는 체크포인트면 모델 출력을 그대로 씀
- tom_checkpoint_path·cymbal_checkpoint_path: 탐 3종 또는 크래시·라이드만 다른 가중치 결과에서 가져옴
- average_checkpoints: ADTOF 가중치 여러 개의 프레임별 점수를 열마다 평균한 뒤 피크를 고름
규칙 값은 모델 yaml의 rules, 기본값은 DEFAULT_RULES.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from pathlib import Path

import numpy as np

from ssaplash_ai.bench.transcribers.adtof_transcriber import AdtofTranscriber, model_input
from ssaplash_ai.bench.transcribers.transcriber_base import BaseTranscriber, RawHit

DEFAULT_RULES: dict = {
    "window_ms": 80.0,
    "tom_fmin": 50.0,
    "tom_fmax": 400.0,
    "tom_bands": [
        113.0,
        142.0,
    ],  # f0 < 113 플로어, 113~142 미드, > 142 하이 (GMD TD-11 정답으로 맞춤)
    "stems": {
        "toms": "toms",
        "crash": "crash",
        "ride": "ride",
        "kick": "kick",
        "snare": "snare",
        "hh": "hh",
    },
    "cymbal_min_energy": 1e-8,
    # crash 스템 에너지에 곱하는 값. 1보다 크면 크래시 쪽으로 기움
    "cymbal_crash_weight": 1.0,
    # 심벌 판정 구간. None이면 window_ms와 같음 (탐 구간만 따로 바꿀 수 있게)
    "cymbal_window_ms": None,
    # 탐 방식. fixed: 고정 Hz 경계. relative: 곡 안에서 탐 음높이를 모아 순서로 나눔
    "tom_mode": "fixed",
    # relative일 때 최대 묶음 수, 묶음을 가르는 최소 틈(반음), 묶음 하나의 최소 타격 수(작으면 이웃에 합침)
    "tom_relative_k": 3,
    "tom_relative_min_gap": 2.0,
    "tom_relative_min_hits": 2,
    # 묶음이 3개보다 적을 때 이름 붙이기. bands: 묶음 중앙값을 고정 경계로 / order: 순서만 (1개 MID, 2개 FLOOR·MID)
    "tom_relative_naming": "bands",
    # 탐 아닌 소리 거르기. None이면 끔. toms 트랙 에너지 / 입력 드럼 에너지가 이 값 아래면 버림
    "tom_gate_ratio": None,
    # 거르기 에너지를 재는 구간. None이면 window_ms
    "tom_gate_window_ms": None,
    # 거른 탐을 어떻게 할지. drop: 버림. snare: 50ms 안에 ADTOF 스네어 타격이 없으면 SNARE로 돌리고 있으면 버림
    # (거른 탐 대부분이 정답 스네어 옆이라서)
    "tom_gate_action": "drop",
    # 탐 타격 시각 고르기. ADTOF 프레임별 확신 점수가 있을 때만 적용
    "tom_threshold": None,  # 탐 확신 점수 기준값. None이면 저장소 기본값 0.32
    # madmom: 100ms 이동평균을 뺀 뒤 기준값과 비교(저장소 방식). raw: 이동평균을 빼지 않음
    "tom_peak_mode": "madmom",
    # 거르기 분모. input: 입력 드럼 전체. others: snare·hh·crash·ride 트랙 합 (kick은 뺌)
    "tom_gate_mode": "input",
    # 낮은 탐 되살리기. 탐 트랙 비율이 기준 아래여도 (toms+kick)/분모가 이 값 이상이고 확신 점수가
    # tom_gate_low_min_score 이상이며 음높이가 tom_low_hz 안이면 탐으로 둠. None이면 끔.
    # 분리 모델이 80Hz 플로어탐을 kick 트랙에 넣는 경우(MDB Grunge) 대응
    "tom_gate_low_rescue": None,
    "tom_gate_low_min_score": 0.5,
    "tom_low_hz": [60.0, 130.0],
    # 음높이 계산 방법. peak: 구간 전체 스펙트럼의 가장 큰 피크 하나(지금 방식).
    # median: 구간을 tom_f0_frame_ms 길이·tom_f0_hop_ms 간격 프레임으로 잘라 프레임마다 피크를 재고 중앙값.
    # 킥 겹침·스틱 잡음이 한 프레임에만 있을 때 흔들리지 않게. tom_f0_start_ms는 타격 뒤 얼마부터 잴지
    "tom_f0_method": "peak",
    "tom_f0_frame_ms": 40.0,
    "tom_f0_hop_ms": 20.0,
    "tom_f0_start_ms": 0.0,
    # 탐 음높이 잴 때 킥 울림 빼기. None이면 끔. 탐 구간의 가장 큰 피크가 곡의
    # 킥 음높이 ±이 반음 안이면, 그 밖의 가장 큰 피크가 최대의 tom_kick_exclude_ratio배 이상일 때 그쪽을 음높이로 씀.
    # 킥을 다른 세트의 플로어탐 높이로 조율한 세트(킥 101Hz)에서 킥 울림이 탐 묶음 하나로 잡혀 이름이 밀리는 경우 대응.
    # 곡의 킥 음높이는 ADTOF 킥 시각에서 tom_kick_pitch_source 트랙의 스펙트럼 피크 중앙값
    "tom_kick_exclude_st": None,
    "tom_kick_exclude_ratio": 0.2,
    # 킥 울림 빼기를 어느 타격에 쓸지. 숫자면 곡 안 묶음 중 중앙값이 킥 음높이 ±이 반음 안인 묶음의 타격만 다시 재고
    # 다시 묶음(relative 모드, 묶음이 둘 이상일 때). None이면 모든 탐 타격을 처음부터 빼고 잼. 킥 트랙에 탐이 새어
    # 킥 음높이가 탐 높이로 재지는 곡(GMD 113Hz)에서 멀쩡한 탐까지 바꾸지 않게
    "tom_kick_cluster_st": 1.0,
    # 킥 음높이를 잴 트랙. kick: 분리한 kick 트랙. input: 입력 드럼
    "tom_kick_pitch_source": "kick",
    # tom_relative_naming이 hybrid일 때 묶음 수에 따른 이름 규칙의 절대 음높이 기준.
    # 1묶음: floor_max 아래 FLOOR, small_min 위 SMALL, 사이 MID. 2묶음: 낮은 쪽은 floor_max 아래면 FLOOR 아니면 MID,
    # 높은 쪽은 small_min 위면 SMALL 아니면 MID. 둘이 같아지면 순서로 벌림. 3묶음: 순서
    "tom_hybrid_floor_max_hz": 120.0,
    "tom_hybrid_small_min_hz": 200.0,
    # 곡 안 음높이 묶는 법. gap: 반음으로 정렬해 이웃 사이 틈이 tom_relative_min_gap 이상인 곳에서 자름.
    # 타격이 수백 개면 음높이가 연속으로 깔려 틈이 안 생겨 묶음이 하나가 됨. peaks: 반음 히스토그램을 부드럽게 한 뒤
    # 피크를 찾고(피크 사이 최소 거리 tom_relative_min_gap) 타격을 가장 가까운 피크에 붙임
    "tom_relative_method": "gap",
    "tom_relative_bin": 0.25,  # peaks 히스토그램 칸(반음)
    "tom_relative_smooth": 0.5,  # peaks 히스토그램을 부드럽게 하는 폭(반음)
    # 묶음 하나의 최소 타격 비율(곡 안 탐 타격 수 대비). tom_relative_min_hits와 둘 중 큰 쪽을 씀.
    # 실제 드럼은 같은 탐도 세기에 따라 음높이가 3반음쯤 흔들려 작은 곁가지 묶음이 생기므로 비율로 합침
    "tom_relative_min_frac": 0.0,
    # 킥과 겹친 탐 지우기. None이면 끔. 이름을 붙인 뒤
    # tom_kick_drop_pads에 든 탐이 ADTOF 킥 타격과 이 거리(ms) 안이면 버림. 파인튜닝 모델이 실제 킥을 킥과
    # 플로어탐으로 함께 내는 경우 대응. tom_kick_drop_max_score를 주면 탐 확신 점수가 그 값 미만인 것만 버림
    "tom_kick_drop_ms": None,
    "tom_kick_drop_pads": ["FLOOR_TOM"],
    "tom_kick_drop_max_score": None,
}
TOM_F0_METHODS = ("peak", "median")
TOM_KICK_PITCH_SOURCES = ("kick", "input")
TOM_RELATIVE_METHODS = ("gap", "peaks")
ADTOF_LABELS: tuple[int, ...] = (
    35,
    38,
    47,
    42,
    49,
)  # ADTOF 출력 열 순서 (페달 체크포인트는 끝에 44가 더 붙음)
ADTOF_DEFAULT_THRESHOLDS: tuple[float, ...] = (0.22, 0.24, 0.32, 0.22, 0.30)
ADTOF_FPS = 100
TOM_PEAK_MODES = ("madmom", "raw")
TOM_GATE_MODES = ("input", "others")
GATE_OTHER_STEMS = ("snare", "hh", "crash", "ride")
ADTOF_KICK = 35
ADTOF_SNARE = 38
ADTOF_TOM = 47
ADTOF_CYMBAL = 49
ADTOF_PEDAL = 44  # 페달 출력을 더한 파인튜닝 체크포인트만 냄
ADTOF_RIDE = 51  # 크래시·라이드를 나눈 파인튜닝 체크포인트(v0.3)만 냄. 이때 49는 크래시만
TOM_PAD_NAMES = ("SMALL_TOM", "MID_TOM", "FLOOR_TOM")
CYMBAL_PAD_NAMES = ("CRASH", "RIDE")
CYMBAL_MODES = ("take", "name")
AVERAGE_COLUMNS = "ksthc"  # ADTOF 5종 점수 열 순서: 킥 35·스네어 38·탐 47·하이햇 42·심벌 49
RENAME_NEAR_SEC = 0.05  # cymbal_mode name에서 이름을 가져올 타격 거리
LABEL_BY_PITCH = {ADTOF_KICK: "KICK", ADTOF_SNARE: "SNARE", 42: "HIHAT", ADTOF_PEDAL: "HIHAT_PEDAL"}
TOM_MODES = ("fixed", "relative")
TOM_NAMINGS = ("bands", "order", "hybrid")
TOM_GATE_ACTIONS = ("drop", "snare")
GATE_SNARE_SEC = 0.05  # 거른 탐을 스네어로 돌릴 때 이미 스네어 타격이 있는지 보는 거리
TOM_PAD_ORDER: tuple[str, str, str] = ("FLOOR_TOM", "MID_TOM", "SMALL_TOM")  # 음높이 낮은 순
NAN_TOM_PAD = "MID_TOM"  # 음높이를 못 잰 탐(무음 구간)은 가장 흔한 탐으로


def rules_with_defaults(rules: dict | None) -> dict:
    out = {**DEFAULT_RULES, **(rules or {})}
    out["stems"] = {**DEFAULT_RULES["stems"], **((rules or {}).get("stems") or {})}
    if out["tom_mode"] not in TOM_MODES:
        raise ValueError(f"tom_mode는 {TOM_MODES} 중 하나: {out['tom_mode']!r}")
    if out["tom_relative_naming"] not in TOM_NAMINGS:
        raise ValueError(
            f"tom_relative_naming은 {TOM_NAMINGS} 중 하나: {out['tom_relative_naming']!r}"
        )
    if out["tom_gate_action"] not in TOM_GATE_ACTIONS:
        raise ValueError(
            f"tom_gate_action은 {TOM_GATE_ACTIONS} 중 하나: {out['tom_gate_action']!r}"
        )
    if out["tom_relative_method"] not in TOM_RELATIVE_METHODS:
        raise ValueError(
            f"tom_relative_method는 {TOM_RELATIVE_METHODS} 중 하나: {out['tom_relative_method']!r}"
        )
    if out["tom_kick_pitch_source"] not in TOM_KICK_PITCH_SOURCES:
        raise ValueError(
            f"tom_kick_pitch_source는 {TOM_KICK_PITCH_SOURCES} 중 하나: {out['tom_kick_pitch_source']!r}"
        )
    if out["tom_f0_method"] not in TOM_F0_METHODS:
        raise ValueError(f"tom_f0_method는 {TOM_F0_METHODS} 중 하나: {out['tom_f0_method']!r}")
    if out["tom_peak_mode"] not in TOM_PEAK_MODES:
        raise ValueError(f"tom_peak_mode는 {TOM_PEAK_MODES} 중 하나: {out['tom_peak_mode']!r}")
    if out["tom_gate_mode"] not in TOM_GATE_MODES:
        raise ValueError(f"tom_gate_mode는 {TOM_GATE_MODES} 중 하나: {out['tom_gate_mode']!r}")
    return out


# ---------- 탐 타격 시각 고르기 ----------


def _moving_average(x: np.ndarray, left: int, right: int) -> np.ndarray:
    kernel = np.ones(left + 1 + right, dtype=np.float32) / (left + 1 + right)
    padded = np.pad(x, (left, right), mode="edge")
    return np.convolve(padded, kernel, mode="valid").astype(np.float32)


def _local_max(x: np.ndarray, left: int, right: int) -> np.ndarray:
    padded = np.pad(x, (left, right), mode="edge")
    return np.max(
        np.stack([padded[k : k + len(x)] for k in range(left + 1 + right)], axis=0), axis=0
    )


def pick_peaks(
    act: np.ndarray,
    threshold: float,
    pre_avg: float = 0.1,
    post_avg: float = 0.01,
    pre_max: float = 0.02,
    post_max: float = 0.01,
    combine: float = 0.02,
    fps: int = ADTOF_FPS,
) -> list[float]:
    """프레임별 점수 한 열 → 타격 시각(초). ADTOF-pytorch의 madmom식 피크 고르기와 같은 계산.

    pre_avg·post_avg가 0이면 이동평균을 빼지 않고 점수 그대로 기준값과 비교함(raw).
    """
    act = np.asarray(act, dtype=np.float32).reshape(-1)
    if act.size == 0:
        return []
    la, ra = int(round(pre_avg * fps)), int(round(post_avg * fps))
    proc = np.maximum(0.0, act - _moving_average(act, la, ra)) if (la > 0 or ra > 0) else act
    lm, rm = int(round(pre_max * fps)), int(round(post_max * fps))
    is_peak = (proc >= _local_max(proc, lm, rm)) if (lm > 0 or rm > 0) else np.ones_like(proc, bool)
    idx = np.where(is_peak & (proc >= threshold))[0]
    if idx.size == 0:
        return []
    gap = max(1, int(round(combine * fps)))
    kept: list[int] = []
    group = [int(idx[0])]
    for i in idx[1:]:
        if i - group[-1] <= gap:
            group.append(int(i))
        else:
            kept.append(max(group, key=lambda k: proc[k]))
            group = [int(i)]
    kept.append(max(group, key=lambda k: proc[k]))
    return [k / float(fps) for k in kept]


def tom_scores(act: np.ndarray, times: Sequence[float], fps: int = ADTOF_FPS) -> np.ndarray:
    """타격 시각마다 ±20ms 안 탐 점수의 최댓값. act는 탐 열 하나."""
    act = np.asarray(act, dtype=np.float32).reshape(-1)
    out = np.zeros(len(times), dtype=np.float64)
    for i, t in enumerate(times):
        c = int(round(float(t) * fps))
        a, b = max(0, c - 2), min(act.size, c + 3)
        out[i] = float(act[a:b].max()) if b > a else 0.0
    return out


def pick_tom_times(
    activations: np.ndarray, rules: dict, fps: int = ADTOF_FPS
) -> tuple[list[float], np.ndarray]:
    """ADTOF 프레임별 점수 (프레임, 5 이상) → 규칙(tom_threshold·tom_peak_mode)대로 고른 탐 시각과 확신 점수.

    앞 5열이 ADTOF 원래 순서이면 됨. 페달 체크포인트의 6번째 열(44)은 여기서 안 씀.
    """
    r = rules_with_defaults(rules)
    col = ADTOF_LABELS.index(ADTOF_TOM)
    th = r["tom_threshold"] if r["tom_threshold"] is not None else ADTOF_DEFAULT_THRESHOLDS[col]
    act = np.asarray(activations, dtype=np.float32)
    if act.ndim != 2 or act.shape[1] < len(ADTOF_LABELS):
        raise ValueError(f"활성값 모양이 (프레임, 5 이상)이 아님: {act.shape}")
    raw = r["tom_peak_mode"] == "raw"
    times = pick_peaks(
        act[:, col],
        float(th),
        pre_avg=0.0 if raw else 0.1,
        post_avg=0.0 if raw else 0.01,
        fps=fps,
    )
    return times, tom_scores(act[:, col], times, fps)


def uses_custom_tom_peaks(rules: dict) -> bool:
    """규칙이 저장소 기본 피크 고르기와 다른 탐 시각을 요구하는지."""
    r = rules_with_defaults(rules)
    return r["tom_threshold"] is not None or r["tom_peak_mode"] != "madmom"


def _window(audio: np.ndarray, sample_rate: int, t: float, window_ms: float) -> np.ndarray:
    """(채널, 샘플) 중 [t, t + window] 모노 구간. 비면 길이 0."""
    start = max(0, int(round(t * sample_rate)))
    end = min(audio.shape[1], start + int(round(window_ms / 1000 * sample_rate)))
    if end <= start:
        return np.zeros(0, dtype=np.float32)
    seg = audio[:, start:end]
    return np.mean(seg, axis=0, dtype=np.float32) if seg.ndim == 2 else seg.astype(np.float32)


def _energy(segment: np.ndarray) -> float:
    return float(np.sum(segment.astype(np.float64) ** 2)) if segment.size else 0.0


def estimate_f0(
    segment: np.ndarray,
    sample_rate: int,
    fmin: float,
    fmax: float,
    exclude_hz: float | None = None,
    exclude_st: float | None = None,
    exclude_ratio: float = 0.0,
) -> float:
    """구간의 스펙트럼 최대 피크 주파수(Hz). 구간이 비거나 무음이면 nan. 4배 zero-pad로 해상도 확보.

    exclude_hz·exclude_st를 주면 최대 피크가 exclude_hz ±exclude_st 반음 안일 때, 그 밖의 최대 피크가
    최대의 exclude_ratio배 이상이면 그 주파수를 돌려줌 (킥 울림 빼기).
    """
    if segment.size == 0 or not np.any(segment):
        return math.nan
    n = int(2 ** math.ceil(math.log2(max(segment.size * 4, 2048))))
    window = np.hanning(segment.size).astype(np.float32)
    spec = np.abs(np.fft.rfft(segment * window, n=n))
    freqs = np.fft.rfftfreq(n, d=1.0 / sample_rate)
    mask = (freqs >= fmin) & (freqs <= fmax)
    if not np.any(mask):
        return math.nan
    spec, freqs = spec[mask], freqs[mask]
    idx = int(np.argmax(spec))
    if exclude_hz is None or exclude_st is None or not exclude_hz > 0:
        return float(freqs[idx])
    with np.errstate(divide="ignore"):
        away = np.abs(12.0 * np.log2(freqs / exclude_hz)) > float(exclude_st)
    if away[idx] or not np.any(away):
        return float(freqs[idx])
    alt = int(np.argmax(np.where(away, spec, -1.0)))
    if spec[alt] >= float(exclude_ratio) * spec[idx]:
        return float(freqs[alt])
    return float(freqs[idx])


def estimate_f0_median(
    segment: np.ndarray,
    sample_rate: int,
    fmin: float,
    fmax: float,
    frame_ms: float = 40.0,
    hop_ms: float = 20.0,
    **exclude,
) -> float:
    """구간을 프레임으로 잘라 프레임마다 스펙트럼 피크를 재고 그 중앙값. 프레임이 하나도 안 나오면 구간 전체로.

    exclude는 estimate_f0의 exclude_hz·exclude_st·exclude_ratio.
    """
    frame = max(1, int(round(frame_ms / 1000 * sample_rate)))
    hop = max(1, int(round(hop_ms / 1000 * sample_rate)))
    values = []
    start = 0
    while start + frame <= segment.size:
        v = estimate_f0(segment[start : start + frame], sample_rate, fmin, fmax, **exclude)
        if not math.isnan(v):
            values.append(v)
        start += hop
    if not values:
        return estimate_f0(segment, sample_rate, fmin, fmax, **exclude)
    return float(np.median(values))


def tom_f0_at(
    toms: np.ndarray | None,
    sample_rate: int,
    t: float,
    rules: dict,
    kick_hz: float | None = None,
) -> float:
    """타격 시각 t의 탐 음높이(Hz)를 규칙대로 잼. toms가 없거나 무음이면 nan. 규칙 함수와 분석 도구가 같이 씀.

    kick_hz는 곡의 킥 음높이. tom_kick_exclude_st를 켰을 때만 씀.
    """
    if toms is None:
        return math.nan
    r = rules_with_defaults(rules)
    seg = _window(toms, sample_rate, t + r["tom_f0_start_ms"] / 1000.0, r["window_ms"])
    exclude = {}
    if r["tom_kick_exclude_st"] is not None and kick_hz is not None and math.isfinite(kick_hz):
        exclude = {
            "exclude_hz": float(kick_hz),
            "exclude_st": float(r["tom_kick_exclude_st"]),
            "exclude_ratio": float(r["tom_kick_exclude_ratio"]),
        }
    if r["tom_f0_method"] == "median":
        return estimate_f0_median(
            seg,
            sample_rate,
            r["tom_fmin"],
            r["tom_fmax"],
            r["tom_f0_frame_ms"],
            r["tom_f0_hop_ms"],
            **exclude,
        )
    return estimate_f0(seg, sample_rate, r["tom_fmin"], r["tom_fmax"], **exclude)


def song_kick_hz(
    kick_times: Sequence[float] | None,
    stems: dict[str, np.ndarray] | None,
    mixture: np.ndarray | None,
    sample_rate: int,
    rules: dict,
) -> float:
    """곡의 킥 음높이(Hz). ADTOF 킥 시각마다 tom_kick_pitch_source 트랙의 window_ms 구간 스펙트럼 피크를 재고 중앙값.

    킥 시각이나 트랙이 없거나 전부 무음이면 nan.
    """
    r = rules_with_defaults(rules)
    if r["tom_kick_pitch_source"] == "input":
        audio = mixture
    else:
        audio = (stems or {}).get(r["stems"]["kick"])
    if audio is None or not kick_times:
        return math.nan
    values = [
        estimate_f0(
            _window(audio, sample_rate, float(t), r["window_ms"]),
            sample_rate,
            r["tom_fmin"],
            r["tom_fmax"],
        )
        for t in kick_times
    ]
    values = [v for v in values if not math.isnan(v)]
    return float(np.median(values)) if values else math.nan


def tom_pad(f0: float, bands: Sequence[float]) -> str:
    """기본 주파수 → 탐 패드 (고정 경계). nan이면 MID_TOM(가장 흔한 탐)."""
    lo, hi = float(bands[0]), float(bands[1])
    if math.isnan(f0):
        return NAN_TOM_PAD
    if f0 < lo:
        return "FLOOR_TOM"
    if f0 < hi:
        return "MID_TOM"
    return "SMALL_TOM"


def cymbal_pad(
    crash_seg: np.ndarray, ride_seg: np.ndarray, min_energy: float, crash_weight: float = 1.0
) -> str:
    """두 스템 구간의 에너지 비교(crash 쪽은 crash_weight배). 둘 다 거의 무음이면 CRASH(ADTOF 심벌 타격은 크래시가 더 흔함)."""
    e_crash = _energy(crash_seg) * crash_weight
    e_ride = _energy(ride_seg)
    if max(e_crash, e_ride) < min_energy:
        return "CRASH"
    return "RIDE" if e_ride > e_crash else "CRASH"


# ---------- 탐: 곡별 상대 방식·거르기 ----------


def semitones(f0: np.ndarray) -> np.ndarray:
    """Hz → 반음 (55Hz 기준). 탐 사이 간격을 음정으로 보기 위함."""
    return 12.0 * np.log2(np.asarray(f0, dtype=np.float64) / 55.0)


def cluster_pitches(
    f0: Sequence[float], k: int = 3, min_gap: float = 2.0, min_hits: int = 2
) -> np.ndarray:
    """음높이(Hz) 목록 → 묶음 번호(0이 가장 낮음). nan은 -1.

    반음으로 바꿔 정렬한 뒤 이웃 사이 틈이 min_gap 이상인 곳 중 큰 순서로 최대 k-1곳을 자름.
    타격 수가 min_hits보다 작은 묶음은 중앙값이 가까운 이웃 묶음에 합침(한 번 튄 값이 묶음을 만들지 않게).
    """
    f0 = np.asarray(list(f0), dtype=np.float64)
    labels = np.full(f0.shape, -1, dtype=np.int64)
    ok = np.where(np.isfinite(f0) & (f0 > 0))[0]
    if ok.size == 0:
        return labels
    st = semitones(f0[ok])
    order = np.argsort(st, kind="stable")
    st_sorted = st[order]
    n = st_sorted.size
    cuts: list[int] = []
    if n > 1 and k > 1:
        gaps = np.diff(st_sorted)
        big = [i for i in np.argsort(-gaps, kind="stable") if gaps[i] >= min_gap]
        cuts = sorted(int(i) for i in big[: max(k - 1, 0)])
    groups: list[list[int]] = []
    start = 0
    for c in cuts:
        groups.append(list(order[start : c + 1]))
        start = c + 1
    groups.append(list(order[start:]))
    # 작은 묶음은 이웃에 합침
    while len(groups) > 1:
        sizes = [len(g) for g in groups]
        smallest = int(np.argmin(sizes))
        if sizes[smallest] >= min_hits:
            break
        medians = [float(np.median(st[g])) for g in groups]
        neighbors = [j for j in (smallest - 1, smallest + 1) if 0 <= j < len(groups)]
        target = min(neighbors, key=lambda j: abs(medians[j] - medians[smallest]))
        merged = groups[target] + groups[smallest]
        groups[target] = sorted(merged, key=lambda i: st[i])
        del groups[smallest]
    for label, g in enumerate(groups):
        labels[ok[g]] = label
    return labels


def cluster_pitches_peaks(
    f0: Sequence[float],
    k: int = 3,
    min_gap: float = 2.0,
    min_hits: int = 2,
    bin_st: float = 0.25,
    smooth_st: float = 0.5,
) -> np.ndarray:
    """음높이(Hz) 목록 → 묶음 번호(0이 가장 낮음). nan은 -1. 반음 히스토그램의 피크로 묶음.

    gap 방식은 타격이 수백 개면 음높이가 연속으로 깔려 틈이 안 생기므로, 대신 bin_st 칸 히스토그램을 smooth_st 폭
    가우시안으로 부드럽게 한 뒤 지역 최대 중 높은 순으로 최대 k개를 고르되 피크 사이는 min_gap 이상 떨어지게 함.
    타격은 가장 가까운 피크에 붙이고, min_hits보다 작은 묶음은 가까운 이웃에 합침.
    """
    f0 = np.asarray(list(f0), dtype=np.float64)
    labels = np.full(f0.shape, -1, dtype=np.int64)
    ok = np.where(np.isfinite(f0) & (f0 > 0))[0]
    if ok.size == 0:
        return labels
    st = semitones(f0[ok])
    lo, hi = float(st.min()) - 1.0, float(st.max()) + 1.0
    edges = np.arange(lo, hi + bin_st, bin_st)
    hist, _ = np.histogram(st, bins=edges)
    centers = (edges[:-1] + edges[1:]) / 2.0
    radius = max(1, int(round(3 * smooth_st / bin_st)))
    kernel = np.exp(-0.5 * (np.arange(-radius, radius + 1) * bin_st / smooth_st) ** 2)
    dens = np.convolve(hist.astype(np.float64), kernel / kernel.sum(), mode="full")[
        radius : radius + hist.size
    ]
    is_max = np.ones_like(dens, dtype=bool)
    is_max[1:] &= dens[1:] >= dens[:-1]
    is_max[:-1] &= dens[:-1] > dens[1:]
    cand = [int(i) for i in np.argsort(-dens, kind="stable") if is_max[i] and dens[i] > 0]
    peaks: list[float] = []
    for i in cand:
        c = float(centers[i])
        if all(abs(c - p) >= min_gap for p in peaks):
            peaks.append(c)
        if len(peaks) >= max(k, 1):
            break
    peaks.sort()
    groups: list[list[int]] = [[] for _ in peaks]
    for idx, v in enumerate(st):
        groups[int(np.argmin([abs(v - p) for p in peaks]))].append(idx)
    groups = [sorted(g, key=lambda i: st[i]) for g in groups if g]
    while len(groups) > 1:
        sizes = [len(g) for g in groups]
        smallest = int(np.argmin(sizes))
        if sizes[smallest] >= min_hits:
            break
        medians = [float(np.median(st[g])) for g in groups]
        neighbors = [j for j in (smallest - 1, smallest + 1) if 0 <= j < len(groups)]
        target = min(neighbors, key=lambda j: abs(medians[j] - medians[smallest]))
        groups[target] = sorted(groups[target] + groups[smallest], key=lambda i: st[i])
        del groups[smallest]
    for label, g in enumerate(groups):
        labels[ok[g]] = label
    return labels


def name_clusters(
    medians_hz: Sequence[float],
    naming: str = "bands",
    bands: Sequence[float] = (113.0, 142.0),
    floor_max_hz: float = 120.0,
    small_min_hz: float = 200.0,
) -> list[str]:
    """묶음 중앙값(낮은 순) → 패드 이름. 3개면 순서대로 FLOOR·MID·SMALL.

    1~2개일 때 bands는 고정 경계로, order는 순서로(1개 MID, 2개 FLOOR·MID) 이름을 붙임.
    hybrid는 floor_max 아래만 FLOOR, small_min 위만 SMALL, 나머지는 MID로 하고 둘이 같아지면 순서로 벌림.
    """
    medians = [float(m) for m in medians_hz]
    m = len(medians)
    if m == 0:
        return []
    if m >= 3:
        return ["FLOOR_TOM"] + ["MID_TOM"] * (m - 2) + ["SMALL_TOM"]
    if naming == "order":
        return ["MID_TOM"] if m == 1 else ["FLOOR_TOM", "MID_TOM"]
    if naming == "hybrid":
        if m == 1:
            v = medians[0]
            return [
                "FLOOR_TOM" if v < floor_max_hz else "SMALL_TOM" if v > small_min_hz else "MID_TOM"
            ]
        low = "FLOOR_TOM" if medians[0] < floor_max_hz else "MID_TOM"
        high = "SMALL_TOM" if medians[1] > small_min_hz else "MID_TOM"
        if low == high:
            return ["MID_TOM", "SMALL_TOM"]
        return [low, high]
    names = [tom_pad(v, bands) for v in medians]
    if m == 1 or names[0] != names[1]:
        return names
    same = names[0]
    if same == "FLOOR_TOM":
        return ["FLOOR_TOM", "MID_TOM"]
    if same == "SMALL_TOM":
        return ["MID_TOM", "SMALL_TOM"]
    lo, hi = float(bands[0]), float(bands[1])
    if medians[0] - lo <= hi - medians[1]:
        return ["FLOOR_TOM", "MID_TOM"]
    return ["MID_TOM", "SMALL_TOM"]


@dataclass
class TomAssignment:
    """곡 하나의 탐 타격 처리 결과. 분석 도구 rule_eval이 by_song 통계에 씀."""

    times: list[float]
    f0: np.ndarray  # Hz, 무음이면 nan
    gate_ratio: np.ndarray | None  # 거르기를 안 켰으면 None
    kept: np.ndarray  # bool. 거른 타격은 False
    labels: np.ndarray  # 묶음 번호 (fixed나 거른 타격은 -1)
    cluster_medians: list[float] = field(default_factory=list)
    cluster_names: list[str] = field(default_factory=list)
    # 최종 패드. 버린 타격은 None, 거른 뒤 스네어로 돌린 타격은 "SNARE"
    pads: list[str | None] = field(default_factory=list)
    # 타격마다 ADTOF 탐 확신 점수. 활성값이 없으면 None
    scores: np.ndarray | None = None
    # 거르기 기준 아래였지만 낮은 탐 되살리기로 남긴 타격 (tom_gate_low_rescue)
    rescued: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=bool))
    # 이름을 붙인 뒤 킥과 겹쳐 버린 타격 (tom_kick_drop_ms)
    kick_dropped: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=bool))
    # 곡의 킥 음높이(Hz). tom_kick_exclude_st를 껐거나 못 재면 nan
    kick_hz: float = math.nan

    @property
    def n_dropped(self) -> int:
        return sum(p is None for p in self.pads)

    @property
    def n_rescued(self) -> int:
        return int(self.rescued.sum()) if self.rescued.size else 0

    @property
    def n_kick_dropped(self) -> int:
        return int(self.kick_dropped.sum()) if self.kick_dropped.size else 0

    @property
    def n_relabeled(self) -> int:
        """거른 뒤 스네어로 돌린 타격 수."""
        return sum(1 for k, p in zip(self.kept, self.pads, strict=True) if not k and p is not None)

    @property
    def n_clusters(self) -> int:
        return len(self.cluster_medians)


def tom_gate_ratios(
    times: Sequence[float],
    toms: np.ndarray | None,
    mixture: np.ndarray,
    sample_rate: int,
    window_ms: float,
) -> np.ndarray:
    """타격마다 toms 트랙 구간 에너지 / 입력 드럼 구간 에너지. 입력이 무음이면 0."""
    out = np.zeros(len(times), dtype=np.float64)
    for i, t in enumerate(times):
        e_mix = _energy(_window(mixture, sample_rate, t, window_ms))
        if e_mix <= 0.0 or toms is None:
            continue
        out[i] = _energy(_window(toms, sample_rate, t, window_ms)) / e_mix
    return out


def gate_energies(
    times: Sequence[float],
    stems: dict[str, np.ndarray] | None,
    mixture: np.ndarray | None,
    sample_rate: int,
    window_ms: float,
    rules: dict,
) -> tuple[np.ndarray, np.ndarray]:
    """타격마다 (탐 트랙 비율, 탐+킥 트랙 비율). 분모는 tom_gate_mode대로 입력 전체 또는 다른 트랙 합.

    분모가 0이면 둘 다 0. others 모드는 stems에 snare·hh·crash·ride 중 있는 것만 더함.
    """
    r = rules_with_defaults(rules)
    names = r["stems"]
    stems = stems or {}
    toms = stems.get(names["toms"])
    kick = stems.get(names["kick"])
    ratio = np.zeros(len(times), dtype=np.float64)
    tomkick = np.zeros(len(times), dtype=np.float64)
    if r["tom_gate_mode"] == "input":
        if mixture is None:
            raise ValueError("tom_gate_mode가 input이면 입력 드럼(mixture)이 필요")
        others = []
    else:
        others = [stems[names[k]] for k in GATE_OTHER_STEMS if names[k] in stems]
        if not others:
            raise ValueError(
                f"tom_gate_mode가 others이면 {GATE_OTHER_STEMS} 트랙 중 하나는 있어야 함 "
                f"(있는 것: {sorted(stems)})"
            )
    for i, t in enumerate(times):
        t = float(t)
        if r["tom_gate_mode"] == "input":
            denom = _energy(_window(mixture, sample_rate, t, window_ms))
        else:
            denom = sum(_energy(_window(s, sample_rate, t, window_ms)) for s in others)
        if denom <= 0.0:
            continue
        e_toms = _energy(_window(toms, sample_rate, t, window_ms)) if toms is not None else 0.0
        e_kick = _energy(_window(kick, sample_rate, t, window_ms)) if kick is not None else 0.0
        ratio[i] = e_toms / denom
        tomkick[i] = (e_toms + e_kick) / denom
    return ratio, tomkick


def assign_toms(
    times: Sequence[float],
    toms: np.ndarray | None,
    sample_rate: int,
    rules: dict,
    mixture: np.ndarray | None = None,
    snare_times: Sequence[float] | None = None,
    stems: dict[str, np.ndarray] | None = None,
    scores: Sequence[float] | None = None,
    kick_times: Sequence[float] | None = None,
) -> TomAssignment:
    """ADTOF 탐 타격 시각 → 음높이 → (거르기) → 고정 경계 또는 곡별 상대 방식으로 패드 → (킥과 겹친 탐 지우기).

    snare_times는 ADTOF 스네어 타격 시각. tom_gate_action이 snare일 때 이미 스네어가 있는 타격은 돌리지 않음.
    kick_times는 ADTOF 킥 타격 시각. tom_kick_drop_ms·tom_kick_exclude_st를 켰을 때만 씀.
    stems는 분리 트랙 전부(거르기 분모 others·낮은 탐 되살리기에 kick·snare·hh가 필요). 없으면 toms만 씀.
    scores는 타격마다 ADTOF 탐 확신 점수. 없으면 되살리기의 점수 조건은 통과한 것으로 봄.
    """
    r = rules_with_defaults(rules)
    times = [float(t) for t in times]
    stems = dict(stems or {})
    if toms is not None:
        stems.setdefault(r["stems"]["toms"], toms)
    kick_hz = math.nan
    if r["tom_kick_exclude_st"] is not None:
        kick_hz = song_kick_hz(kick_times, stems, mixture, sample_rate, r)
    # 묶음 단위로 빼면 처음에는 그대로 재고, 킥 음높이에 앉은 묶음만 아래에서 다시 잼
    by_cluster = r["tom_kick_cluster_st"] is not None and r["tom_mode"] != "fixed"
    f0_kick = None if by_cluster else kick_hz
    f0 = np.array([tom_f0_at(toms, sample_rate, t, r, f0_kick) for t in times], dtype=np.float64)
    kept = np.ones(len(times), dtype=bool)
    rescued = np.zeros(len(times), dtype=bool)
    ratios: np.ndarray | None = None
    score_arr = None if scores is None else np.asarray(list(scores), dtype=np.float64)
    if r["tom_gate_ratio"] is not None:
        if mixture is None and r["tom_gate_mode"] == "input":
            raise ValueError("tom_gate_ratio를 쓰려면 입력 드럼(mixture)이 필요")
        gate_window = r["tom_gate_window_ms"] if r.get("tom_gate_window_ms") else r["window_ms"]
        ratios, tomkick = gate_energies(times, stems, mixture, sample_rate, gate_window, r)
        kept = ratios >= float(r["tom_gate_ratio"])
        if r["tom_gate_low_rescue"] is not None:
            lo_hz, hi_hz = float(r["tom_low_hz"][0]), float(r["tom_low_hz"][1])
            ok_score = (
                np.ones(len(times), dtype=bool)
                if score_arr is None
                else score_arr >= float(r["tom_gate_low_min_score"])
            )
            with np.errstate(invalid="ignore"):
                ok_hz = (f0 >= lo_hz) & (f0 <= hi_hz)
            rescued = (~kept) & (tomkick >= float(r["tom_gate_low_rescue"])) & ok_score & ok_hz
            kept = kept | rescued
    labels = np.full(len(times), -1, dtype=np.int64)
    pads: list[str | None] = [None] * len(times)
    medians: list[float] = []
    names: list[str] = []
    kept_idx = np.where(kept)[0]
    if r["tom_mode"] == "fixed":
        for i in kept_idx:
            pads[i] = tom_pad(float(f0[i]), r["tom_bands"])
    else:
        n_ok = int(np.sum(np.isfinite(f0[kept_idx]) & (f0[kept_idx] > 0)))
        min_hits = max(
            int(r["tom_relative_min_hits"]),
            int(math.ceil(float(r["tom_relative_min_frac"]) * n_ok)),
        )

        def cluster(values: np.ndarray) -> tuple[np.ndarray, list[float]]:
            if r["tom_relative_method"] == "peaks":
                out = cluster_pitches_peaks(
                    values,
                    int(r["tom_relative_k"]),
                    float(r["tom_relative_min_gap"]),
                    min_hits,
                    float(r["tom_relative_bin"]),
                    float(r["tom_relative_smooth"]),
                )
            else:
                out = cluster_pitches(
                    values,
                    int(r["tom_relative_k"]),
                    float(r["tom_relative_min_gap"]),
                    min_hits,
                )
            n = int(out.max()) + 1 if out.size and out.max() >= 0 else 0
            return out, [float(np.median(values[out == c])) for c in range(n)]

        sub, medians = cluster(f0[kept_idx])
        if by_cluster and math.isfinite(kick_hz) and len(medians) >= 2:
            on_kick = [
                c
                for c, m in enumerate(medians)
                if abs(12.0 * math.log2(m / kick_hz)) <= float(r["tom_kick_cluster_st"])
            ]
            if on_kick:
                for i in kept_idx[np.isin(sub, on_kick)]:
                    f0[i] = tom_f0_at(toms, sample_rate, times[i], r, kick_hz)
                sub, medians = cluster(f0[kept_idx])
        labels[kept_idx] = sub
        names = name_clusters(
            medians,
            r["tom_relative_naming"],
            r["tom_bands"],
            float(r["tom_hybrid_floor_max_hz"]),
            float(r["tom_hybrid_small_min_hz"]),
        )
        for i, label in zip(kept_idx, sub, strict=True):
            pads[i] = names[label] if label >= 0 else NAN_TOM_PAD
    if r["tom_gate_action"] == "snare":
        snares = np.asarray(list(snare_times or []), dtype=np.float64)
        for i in np.where(~kept)[0]:
            near = snares.size and np.min(np.abs(snares - times[i])) <= GATE_SNARE_SEC
            if not near:
                pads[i] = "SNARE"
    kick_dropped = np.zeros(len(times), dtype=bool)
    if r["tom_kick_drop_ms"] is not None:
        kicks = np.asarray(list(kick_times or []), dtype=np.float64)
        drop_pads = set(r["tom_kick_drop_pads"])
        max_score = r["tom_kick_drop_max_score"]
        limit = float(r["tom_kick_drop_ms"]) / 1000.0
        for i in kept_idx:
            if pads[i] not in drop_pads or not kicks.size:
                continue
            if np.min(np.abs(kicks - times[i])) > limit:
                continue
            # 점수가 없으면 점수 조건은 통과한 것으로 봄
            if max_score is not None and score_arr is not None and score_arr[i] >= float(max_score):
                continue
            pads[i] = None
            kick_dropped[i] = True
    return TomAssignment(
        times=times,
        f0=f0,
        gate_ratio=ratios,
        kept=kept,
        labels=labels,
        cluster_medians=medians,
        cluster_names=names,
        pads=pads,
        scores=score_arr,
        rescued=rescued,
        kick_dropped=kick_dropped,
        kick_hz=kick_hz,
    )


def tom_times_and_scores(
    peaks: dict[int, list[float]], rules: dict, activations: np.ndarray | None
) -> tuple[list[float], np.ndarray | None]:
    """규칙이 기본 피크 고르기면 ADTOF가 낸 탐 시각 그대로, 아니면 활성값에서 다시 고름. 점수는 활성값이 있을 때만."""
    if activations is not None and uses_custom_tom_peaks(rules):
        return pick_tom_times(activations, rules)
    times = [float(t) for t in peaks.get(ADTOF_TOM, [])]
    if activations is None:
        return times, None
    col = ADTOF_LABELS.index(ADTOF_TOM)
    return times, tom_scores(np.asarray(activations, dtype=np.float32)[:, col], times)


def assign_pads(
    peaks: dict[int, list[float]],
    stems: dict[str, np.ndarray],
    sample_rate: int,
    rules: dict,
    mixture: np.ndarray | None = None,
    activations: np.ndarray | None = None,
) -> list[RawHit]:
    """ADTOF 피치별 시각 + 분리 스템 (+ 입력 드럼, 프레임별 점수) → (시각, 패드 이름, None) 목록.

    mixture는 tom_gate_ratio(탐 아닌 소리 거르기)를 켰을 때 필요한 입력 드럼 (채널, 샘플).
    activations는 ADTOF 프레임별 점수 (프레임, 5·6·7). 있으면 tom_threshold·tom_peak_mode대로 탐 시각을 다시 고르고
    낮은 탐 되살리기의 점수 조건에 씀. 없으면 peaks의 탐 시각 그대로.
    """
    r = rules_with_defaults(rules)
    cymbal_window = r["cymbal_window_ms"] if r.get("cymbal_window_ms") else r["window_ms"]
    names = r["stems"]
    toms = stems.get(names["toms"])
    crash = stems.get(names["crash"])
    ride = stems.get(names["ride"])
    out: list[RawHit] = []
    tom_times, scores = tom_times_and_scores(peaks, r, activations)
    if tom_times:
        toms_result = assign_toms(
            tom_times,
            toms,
            sample_rate,
            r,
            mixture,
            snare_times=peaks.get(ADTOF_SNARE, []),
            stems=stems,
            scores=scores,
            kick_times=peaks.get(ADTOF_KICK, []),
        )
        out.extend(
            (t, pad, None)
            for t, pad in zip(toms_result.times, toms_result.pads, strict=True)
            if pad is not None
        )
    # 모델이 크래시·라이드를 따로 냈으면(51번 출력) 규칙 없이 그대로
    split_cymbal = ADTOF_RIDE in peaks
    for pitch, times in peaks.items():
        if pitch == ADTOF_TOM:
            continue
        for t in times:
            if pitch in LABEL_BY_PITCH:
                out.append((t, LABEL_BY_PITCH[pitch], None))
            elif split_cymbal and pitch in (ADTOF_CYMBAL, ADTOF_RIDE):
                out.append((t, "CRASH" if pitch == ADTOF_CYMBAL else "RIDE", None))
            elif pitch == ADTOF_CYMBAL:
                c = (
                    _window(crash, sample_rate, t, cymbal_window)
                    if crash is not None
                    else np.zeros(0)
                )
                d = (
                    _window(ride, sample_rate, t, cymbal_window)
                    if ride is not None
                    else np.zeros(0)
                )
                out.append(
                    (t, cymbal_pad(c, d, r["cymbal_min_energy"], r["cymbal_crash_weight"]), None)
                )
            else:
                out.append((t, str(pitch), None))
    return sorted(out, key=lambda h: h[0])


def merge_pad_hits(
    hits: Sequence[RawHit], other: Sequence[RawHit], pads: Sequence[str]
) -> list[RawHit]:
    """hits에서 pads를 빼고 other의 pads를 넣음. 시각순"""
    out = [h for h in hits if h[1] not in pads] + [h for h in other if h[1] in pads]
    return sorted(out, key=lambda h: h[0])


def rename_pad_hits(
    hits: Sequence[RawHit], other: Sequence[RawHit], pads: Sequence[str]
) -> list[RawHit]:
    """hits의 pads 타격 시각은 두고, RENAME_NEAR_SEC 안 가장 가까운 other의 pads 타격 이름으로 바꿈"""
    times = np.array([h[0] for h in other if h[1] in pads], dtype=np.float64)
    names = [h[1] for h in other if h[1] in pads]
    out = []
    for h in hits:
        if h[1] in pads and len(times):
            j = int(np.argmin(np.abs(times - h[0])))
            if abs(times[j] - h[0]) <= RENAME_NEAR_SEC:
                h = (h[0], names[j], h[2])
        out.append(h)
    return out


def average_activations(main: np.ndarray, members: Sequence[tuple[np.ndarray, str]]) -> np.ndarray:
    """주 가중치 점수 (프레임, 5)와 (점수, 열 글자) 목록 → 열마다 평균. 길이는 가장 짧은 것에 맞춤"""
    n = min([len(main), *(len(a) for a, _ in members)])
    out = np.array(main[:n, :5], dtype=np.float32)
    for j, letter in enumerate(AVERAGE_COLUMNS):
        use = [a[:n, j] for a, cols in members if letter in cols]
        if use:
            out[:, j] = (out[:, j] + np.sum(use, axis=0)) / (1 + len(use))
    return out


def merge_tom_hits(hits: Sequence[RawHit], tom_hits: Sequence[RawHit]) -> list[RawHit]:
    """hits에서 탐 3종을 빼고 tom_hits의 탐 3종을 넣음. 시각순"""
    return merge_pad_hits(hits, tom_hits, TOM_PAD_NAMES)


class AdtofDrumsepTranscriber(BaseTranscriber):
    adapter = "adtof_drumsep"

    def __init__(self, config, device: str = "cuda") -> None:
        super().__init__(config, device)
        if not config.drumsep_config:
            raise ValueError(
                f"{config.name}: adtof_drumsep 어댑터에는 drumsep_config(분리 모델 yaml)가 필요"
            )
        self._adtof = AdtofTranscriber(config, device)
        self._tom_adtof = self._extra_adtof(config.tom_checkpoint_path, device)
        self._cym_adtof = self._extra_adtof(config.cymbal_checkpoint_path, device)
        if config.cymbal_mode not in CYMBAL_MODES:
            raise ValueError(
                f"{config.name}: cymbal_mode는 {CYMBAL_MODES} 중 하나: {config.cymbal_mode}"
            )
        self._avg_adtofs: list[tuple[AdtofTranscriber, str]] = []
        for item in config.average_checkpoints:
            cols = str(item.get("columns") or AVERAGE_COLUMNS)
            if not item.get("path") or set(cols) - set(AVERAGE_COLUMNS):
                raise ValueError(
                    f"{config.name}: average_checkpoints 항목은 path와 {AVERAGE_COLUMNS} 글자 columns: {item}"
                )
            self._avg_adtofs.append((self._extra_adtof(str(item["path"]), device), cols))
        self._sep = None
        self.rules = rules_with_defaults(config.rules)

    def _extra_adtof(self, path: str | None, device: str) -> AdtofTranscriber | None:
        """탐·심벌 전용 ADTOF. "default"면 패키지 기본 가중치, 없으면 None"""
        if not path:
            return None
        ck = None if path == "default" else path
        return AdtofTranscriber(replace(self.config, checkpoint_path=ck, thresholds=None), device)

    def _extras(self) -> list[tuple[AdtofTranscriber, tuple[str, ...]]]:
        """(전용 ADTOF, 가져올 패드). 없는 것은 뺌"""
        return [
            (a, pads)
            for a, pads in ((self._tom_adtof, TOM_PAD_NAMES), (self._cym_adtof, CYMBAL_PAD_NAMES))
            if a is not None
        ]

    def prepare(self) -> None:
        from ssaplash_ai.bench.separators import SeparatorConfig, create_separator

        self._sep = create_separator(
            SeparatorConfig.from_yaml(Path(self.config.drumsep_config)), self.device
        )
        self._sep.prepare()

    def _load(self) -> None:
        for adtof in (self._adtof, self._tom_adtof, self._cym_adtof, *self._avg_models()):
            if adtof is not None:
                adtof._load()
                adtof.loaded = True
        if self._avg_adtofs:
            for adtof in (self._adtof, *self._avg_models()):
                if adtof._labels != [35, 38, 47, 42, 49]:
                    raise ValueError(f"점수 평균은 ADTOF 5종 가중치만 됨: {adtof._checkpoint_id()}")
        self._sep._load()
        self._sep.loaded = True

    def _avg_models(self) -> list[AdtofTranscriber]:
        return [a for a, _ in self._avg_adtofs]

    def stems(self, audio: np.ndarray, sample_rate: int) -> dict[str, np.ndarray]:
        """드럼 킷 분리 스템 이름 → (채널, 샘플)."""
        out = self._sep.separate(audio, sample_rate)
        stems = dict(out.other_stems)
        stems[self._sep.config.drums_stem] = out.drums
        return stems

    def _transcribe(
        self, audio: np.ndarray, sample_rate: int, song_id: str | None
    ) -> Sequence[RawHit]:
        x = model_input(audio, sample_rate)  # 가중치 여러 개가 같은 입력 특징을 씀
        activations = self._adtof.activations_from_input(x)
        if self._avg_adtofs:
            activations = average_activations(
                activations,
                [(a.activations_from_input(x), cols) for a, cols in self._avg_adtofs],
            )
        peaks = self._adtof.peaks(activations)
        stems = self.stems(audio, sample_rate)
        missing = [
            n
            for n in (
                self.rules["stems"]["toms"],
                self.rules["stems"]["crash"],
                self.rules["stems"]["ride"],
            )
            if n not in stems
        ]
        if missing:
            raise KeyError(f"드럼 킷 분리 출력에 스템이 없음: {missing} (있는 것: {sorted(stems)})")
        hits = assign_pads(
            peaks, stems, sample_rate, self.rules, mixture=audio, activations=activations
        )
        for adtof, pads in self._extras():
            act = adtof.activations_from_input(x)
            other = assign_pads(
                adtof.peaks(act), stems, sample_rate, self.rules, mixture=audio, activations=act
            )
            if pads == CYMBAL_PAD_NAMES and self.config.cymbal_mode == "name":
                hits = rename_pad_hits(hits, other, pads)
            else:
                hits = merge_pad_hits(hits, other, pads)
        return hits

    def _checkpoint_id(self) -> str:
        sep_ckpt = self._sep.info().checkpoint if self._sep is not None and self._sep.loaded else ""
        names = {id(self._tom_adtof): "tom", id(self._cym_adtof): "cymbal"}
        extra = "".join(f"+{names[id(a)]}:{a._checkpoint_id()}" for a, _ in self._extras())
        avg = "".join(f"+avg:{a._checkpoint_id()}:{cols}" for a, cols in self._avg_adtofs)
        return f"{self._adtof._checkpoint_id()}{avg}{extra}+{sep_ckpt}"

    def _n_params(self) -> int | None:
        a = self._adtof._n_params()
        for adtof in [*(x for x, _ in self._extras()), *self._avg_models()]:
            a = (a or 0) + (adtof._n_params() or 0)
        b = self._sep._n_params() if self._sep is not None and self._sep.loaded else None
        return (a or 0) + (b or 0) if (a is not None or b is not None) else None

    def _close(self) -> None:
        self._adtof.close()
        for adtof in [*(x for x, _ in self._extras()), *self._avg_models()]:
            adtof.close()
        if self._sep is not None:
            self._sep.close()
