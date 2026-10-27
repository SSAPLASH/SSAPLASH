"""ADTOF + 드럼 킷 분리 어댑터 (채보 설계 1-1절 결정, U8). "5가지 모델을 8패드로 늘리는 길".

흐름: ADTOF(5가지: 킥·스네어·하이햇·탐·심벌) → MDX23C DrumSep(기존 msst 어댑터, 6스템: kick·snare·toms·
hh·ride·crash)로 입력 드럼을 다시 나눔 → 규칙으로 탐·심벌 타격에 패드를 붙임.
- 탐: 탐 스템에서 타격 직후 window_ms 구간의 스펙트럼 최대 봉우리(tom_fmin~tom_fmax Hz)를 기본 주파수로 봄.
  tom_mode가 fixed(기본)면 tom_bands(Hz 경계 두 개)로 FLOOR_TOM / MID_TOM / SMALL_TOM. 경계값은 yaml(rules)에
  있고 GMD 정답으로 한 번 맞춘 값(U8): GMD(TD-11 킷) 정답 탐의 기본 주파수 중앙값이 플로어 97·미드 129·하이
  160Hz라 경계를 113·142Hz로 둠. 실제 드럼 킷은 음높이가 달라 MDB에서는 틀릴 수 있음(한계로 표기,
  S15P31A307-163 분석). drum2midi의 "음높이 순서" 규칙을 절대 구간으로 바꾼 것.
  tom_mode가 relative면 곡 안의 탐 타격 음높이를 모아 큰 틈에서 1~3묶음으로 나누고 낮은 순서로 이름을 붙임
  (S15P31A307-164 실험). 묶음이 3개보다 적을 때는 tom_relative_naming대로 이름을 정함.
  tom_gate_ratio가 있으면 타격 직후 toms 트랙 에너지가 입력 드럼 에너지의 그 비율보다 작은 탐 타격은 버림
  (탐이 아닌 소리를 탐으로 잡은 것 거르기, S15P31A307-164 실험). 입력 드럼(mixture)이 필요함.
- 심벌: 타격 직후 cymbal_window_ms(없으면 window_ms) 구간에서 crash 스템과 ride 스템의 에너지를 비교해 큰 쪽.
킥·스네어·하이햇은 ADTOF 결과 그대로. 세기 없음. 채보 시간에는 ADTOF + 분리 + 규칙이 다 들어감.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from ssaplash_ai.bench.transcribers.adtof_transcriber import AdtofTranscriber
from ssaplash_ai.bench.transcribers.transcriber_base import BaseTranscriber, RawHit

DEFAULT_RULES: dict = {
    "window_ms": 80.0,
    "tom_fmin": 50.0,
    "tom_fmax": 400.0,
    "tom_bands": [
        113.0,
        142.0,
    ],  # f0 < 113 플로어, 113~142 미드, > 142 하이 (GMD TD-11 정답으로 맞춤)
    "stems": {"toms": "toms", "crash": "crash", "ride": "ride"},
    "cymbal_min_energy": 1e-8,
    # 심벌 판정 구간. None이면 window_ms와 같음 (탐 구간만 따로 바꿀 수 있게, S15P31A307-163)
    "cymbal_window_ms": None,
    # 탐 방식 (S15P31A307-164). fixed: 고정 Hz 경계. relative: 곡 안에서 탐 음높이를 모아 순서로 나눔
    "tom_mode": "fixed",
    # relative일 때 최대 묶음 수, 묶음을 가르는 최소 틈(반음), 묶음 하나의 최소 타격 수(작으면 이웃에 합침)
    "tom_relative_k": 3,
    "tom_relative_min_gap": 2.0,
    "tom_relative_min_hits": 2,
    # 묶음이 3개보다 적을 때 이름 붙이기. bands: 묶음 중앙값을 고정 경계로 / order: 순서만 (1개 MID, 2개 FLOOR·MID)
    "tom_relative_naming": "bands",
    # 탐 아닌 소리 거르기 (S15P31A307-164). None이면 끔. toms 트랙 에너지 / 입력 드럼 에너지가 이 값 아래면 버림
    "tom_gate_ratio": None,
    # 거르기 에너지를 재는 구간. None이면 window_ms
    "tom_gate_window_ms": None,
    # 거른 탐을 어떻게 할지. drop: 버림. snare: 50ms 안에 ADTOF 스네어 타격이 없으면 SNARE로 돌리고 있으면 버림
    # (거른 탐 대부분이 정답 스네어 옆이라서, S15P31A307-164 분석)
    "tom_gate_action": "drop",
}
ADTOF_SNARE = 38
ADTOF_TOM = 47
ADTOF_CYMBAL = 49
LABEL_BY_PITCH = {35: "KICK", ADTOF_SNARE: "SNARE", 42: "HIHAT"}
TOM_MODES = ("fixed", "relative")
TOM_NAMINGS = ("bands", "order")
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
    return out


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


def estimate_f0(segment: np.ndarray, sample_rate: int, fmin: float, fmax: float) -> float:
    """구간의 스펙트럼 최대 봉우리 주파수(Hz). 구간이 비거나 무음이면 nan. 4배 zero-pad로 해상도 확보."""
    if segment.size == 0 or not np.any(segment):
        return math.nan
    n = int(2 ** math.ceil(math.log2(max(segment.size * 4, 2048))))
    window = np.hanning(segment.size).astype(np.float32)
    spec = np.abs(np.fft.rfft(segment * window, n=n))
    freqs = np.fft.rfftfreq(n, d=1.0 / sample_rate)
    mask = (freqs >= fmin) & (freqs <= fmax)
    if not np.any(mask):
        return math.nan
    idx = int(np.argmax(spec[mask]))
    return float(freqs[mask][idx])


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


def cymbal_pad(crash_seg: np.ndarray, ride_seg: np.ndarray, min_energy: float) -> str:
    """두 스템 구간의 에너지 비교. 둘 다 거의 무음이면 CRASH(ADTOF 심벌 타격은 크래시가 더 흔함)."""
    e_crash = _energy(crash_seg)
    e_ride = _energy(ride_seg)
    if max(e_crash, e_ride) < min_energy:
        return "CRASH"
    return "RIDE" if e_ride > e_crash else "CRASH"


# ---------- 탐: 곡별 상대 방식·거르기 (S15P31A307-164) ----------


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


def name_clusters(
    medians_hz: Sequence[float], naming: str = "bands", bands: Sequence[float] = (113.0, 142.0)
) -> list[str]:
    """묶음 중앙값(낮은 순) → 패드 이름. 3개면 순서대로 FLOOR·MID·SMALL.

    1~2개일 때 bands는 중앙값을 고정 경계로 이름 짓고 둘이 같으면 그 안에서 순서로 벌림(둘 다 플로어면
    FLOOR·MID, 둘 다 스몰이면 MID·SMALL, 둘 다 미드면 경계에 더 가까운 쪽을 밖으로). order는 1개 MID, 2개 FLOOR·MID.
    """
    medians = [float(m) for m in medians_hz]
    m = len(medians)
    if m == 0:
        return []
    if m >= 3:
        return ["FLOOR_TOM"] + ["MID_TOM"] * (m - 2) + ["SMALL_TOM"]
    if naming == "order":
        return ["MID_TOM"] if m == 1 else ["FLOOR_TOM", "MID_TOM"]
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
    """곡 하나의 탐 타격 처리 결과. 분석 도구(rule_eval·tom_pitch)가 by_song 통계에 씀."""

    times: list[float]
    f0: np.ndarray  # Hz, 무음이면 nan
    gate_ratio: np.ndarray | None  # 거르기를 안 켰으면 None
    kept: np.ndarray  # bool. 거른 타격은 False
    labels: np.ndarray  # 묶음 번호 (fixed나 거른 타격은 -1)
    cluster_medians: list[float] = field(default_factory=list)
    cluster_names: list[str] = field(default_factory=list)
    # 최종 패드. 버린 타격은 None, 거른 뒤 스네어로 돌린 타격은 "SNARE"
    pads: list[str | None] = field(default_factory=list)

    @property
    def n_dropped(self) -> int:
        return sum(p is None for p in self.pads)

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


def assign_toms(
    times: Sequence[float],
    toms: np.ndarray | None,
    sample_rate: int,
    rules: dict,
    mixture: np.ndarray | None = None,
    snare_times: Sequence[float] | None = None,
) -> TomAssignment:
    """ADTOF 탐 타격 시각 → 음높이 → (거르기) → 고정 경계 또는 곡별 상대 방식으로 패드.

    snare_times는 ADTOF 스네어 타격 시각. tom_gate_action이 snare일 때 이미 스네어가 있는 타격은 돌리지 않음.
    """
    r = rules_with_defaults(rules)
    times = [float(t) for t in times]
    f0 = np.array(
        [
            estimate_f0(
                _window(toms, sample_rate, t, r["window_ms"]),
                sample_rate,
                r["tom_fmin"],
                r["tom_fmax"],
            )
            if toms is not None
            else math.nan
            for t in times
        ],
        dtype=np.float64,
    )
    kept = np.ones(len(times), dtype=bool)
    ratios: np.ndarray | None = None
    if r["tom_gate_ratio"] is not None:
        if mixture is None:
            raise ValueError("tom_gate_ratio를 쓰려면 입력 드럼(mixture)이 필요")
        gate_window = r["tom_gate_window_ms"] if r.get("tom_gate_window_ms") else r["window_ms"]
        ratios = tom_gate_ratios(times, toms, mixture, sample_rate, gate_window)
        kept = ratios >= float(r["tom_gate_ratio"])
    labels = np.full(len(times), -1, dtype=np.int64)
    pads: list[str | None] = [None] * len(times)
    medians: list[float] = []
    names: list[str] = []
    kept_idx = np.where(kept)[0]
    if r["tom_mode"] == "fixed":
        for i in kept_idx:
            pads[i] = tom_pad(float(f0[i]), r["tom_bands"])
    else:
        sub = cluster_pitches(
            f0[kept_idx],
            int(r["tom_relative_k"]),
            float(r["tom_relative_min_gap"]),
            int(r["tom_relative_min_hits"]),
        )
        labels[kept_idx] = sub
        n_clusters = int(sub.max()) + 1 if sub.size and sub.max() >= 0 else 0
        medians = [float(np.median(f0[kept_idx][sub == c])) for c in range(n_clusters)]
        names = name_clusters(medians, r["tom_relative_naming"], r["tom_bands"])
        for i, label in zip(kept_idx, sub, strict=True):
            pads[i] = names[label] if label >= 0 else NAN_TOM_PAD
    if r["tom_gate_action"] == "snare":
        snares = np.asarray(list(snare_times or []), dtype=np.float64)
        for i in np.where(~kept)[0]:
            near = snares.size and np.min(np.abs(snares - times[i])) <= GATE_SNARE_SEC
            if not near:
                pads[i] = "SNARE"
    return TomAssignment(
        times=times,
        f0=f0,
        gate_ratio=ratios,
        kept=kept,
        labels=labels,
        cluster_medians=medians,
        cluster_names=names,
        pads=pads,
    )


def assign_pads(
    peaks: dict[int, list[float]],
    stems: dict[str, np.ndarray],
    sample_rate: int,
    rules: dict,
    mixture: np.ndarray | None = None,
) -> list[RawHit]:
    """ADTOF 피치별 시각 + 분리 스템 (+ 입력 드럼) → (시각, 패드 이름, None) 목록. 패드 이름이 원래 라벨.

    mixture는 tom_gate_ratio(탐 아닌 소리 거르기)를 켰을 때만 필요한 입력 드럼 (채널, 샘플).
    """
    r = rules_with_defaults(rules)
    cymbal_window = r["cymbal_window_ms"] if r.get("cymbal_window_ms") else r["window_ms"]
    names = r["stems"]
    toms = stems.get(names["toms"])
    crash = stems.get(names["crash"])
    ride = stems.get(names["ride"])
    out: list[RawHit] = []
    for pitch, times in peaks.items():
        if pitch == ADTOF_TOM:
            toms_result = assign_toms(
                times, toms, sample_rate, r, mixture, snare_times=peaks.get(ADTOF_SNARE, [])
            )
            out.extend(
                (t, pad, None)
                for t, pad in zip(toms_result.times, toms_result.pads, strict=True)
                if pad is not None
            )
            continue
        for t in times:
            if pitch in LABEL_BY_PITCH:
                out.append((t, LABEL_BY_PITCH[pitch], None))
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
                out.append((t, cymbal_pad(c, d, r["cymbal_min_energy"]), None))
            else:
                out.append((t, str(pitch), None))
    return sorted(out, key=lambda h: h[0])


class AdtofDrumsepTranscriber(BaseTranscriber):
    adapter = "adtof_drumsep"

    def __init__(self, config, device: str = "cuda") -> None:
        super().__init__(config, device)
        if not config.drumsep_config:
            raise ValueError(
                f"{config.name}: adtof_drumsep 어댑터에는 drumsep_config(분리 모델 yaml)가 필요"
            )
        self._adtof = AdtofTranscriber(config, device)
        self._sep = None
        self.rules = rules_with_defaults(config.rules)

    def prepare(self) -> None:
        from ssaplash_ai.bench.separators import SeparatorConfig, create_separator

        self._sep = create_separator(
            SeparatorConfig.from_yaml(Path(self.config.drumsep_config)), self.device
        )
        self._sep.prepare()

    def _load(self) -> None:
        self._adtof._load()
        self._adtof.loaded = True
        self._sep._load()
        self._sep.loaded = True

    def stems(self, audio: np.ndarray, sample_rate: int) -> dict[str, np.ndarray]:
        """드럼 킷 분리 스템 이름 → (채널, 샘플)."""
        out = self._sep.separate(audio, sample_rate)
        stems = dict(out.other_stems)
        stems[self._sep.config.drums_stem] = out.drums
        return stems

    def _transcribe(
        self, audio: np.ndarray, sample_rate: int, song_id: str | None
    ) -> Sequence[RawHit]:
        peaks = self._adtof.peaks(self._adtof.activations(audio, sample_rate))
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
        return assign_pads(peaks, stems, sample_rate, self.rules, mixture=audio)

    def _checkpoint_id(self) -> str:
        sep_ckpt = self._sep.info().checkpoint if self._sep is not None and self._sep.loaded else ""
        return f"{self._adtof._checkpoint_id()}+{sep_ckpt}"

    def _n_params(self) -> int | None:
        a = self._adtof._n_params()
        b = self._sep._n_params() if self._sep is not None and self._sep.loaded else None
        return (a or 0) + (b or 0) if (a is not None or b is not None) else None

    def _close(self) -> None:
        self._adtof.close()
        if self._sep is not None:
            self._sep.close()
