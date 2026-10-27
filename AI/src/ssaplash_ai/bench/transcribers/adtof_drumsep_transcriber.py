"""ADTOF + 드럼 킷 분리 어댑터 (채보 설계 1-1절 결정, U8). "5가지 모델을 8패드로 늘리는 길".

흐름: ADTOF(5가지: 킥·스네어·하이햇·탐·심벌) → MDX23C DrumSep(기존 msst 어댑터, 6스템: kick·snare·toms·
hh·ride·crash)로 입력 드럼을 다시 나눔 → 규칙으로 탐·심벌 타격에 패드를 붙임.
- 탐: 탐 스템에서 타격 직후 window_ms 구간의 스펙트럼 최대 봉우리(tom_fmin~tom_fmax Hz)를 기본 주파수로
  보고 tom_bands(Hz 경계 두 개)로 FLOOR_TOM / MID_TOM / SMALL_TOM. 경계값은 yaml(rules)에 있고 GMD 정답으로
  한 번 맞춘 값(U8): GMD(TD-11 킷) 정답 탐의 기본 주파수 중앙값이 플로어 97·미드 129·하이 160Hz라
  경계를 113·142Hz로 둠. 실제 드럼 킷은 음높이가 달라 MDB에서는 틀릴 수 있음(한계로 표기).
  drum2midi의 "음높이 순서" 규칙을 절대 구간으로 바꾼 것.
- 심벌: 타격 직후 cymbal_window_ms(없으면 window_ms) 구간에서 crash 스템과 ride 스템의 에너지를 비교해 큰 쪽.
킥·스네어·하이햇은 ADTOF 결과 그대로. 세기 없음. 채보 시간에는 ADTOF + 분리 + 규칙이 다 들어감.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
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
}
ADTOF_TOM = 47
ADTOF_CYMBAL = 49
LABEL_BY_PITCH = {35: "KICK", 38: "SNARE", 42: "HIHAT"}


def rules_with_defaults(rules: dict | None) -> dict:
    out = {**DEFAULT_RULES, **(rules or {})}
    out["stems"] = {**DEFAULT_RULES["stems"], **((rules or {}).get("stems") or {})}
    return out


def _window(audio: np.ndarray, sample_rate: int, t: float, window_ms: float) -> np.ndarray:
    """(채널, 샘플) 중 [t, t + window] 모노 구간. 비면 길이 0."""
    start = max(0, int(round(t * sample_rate)))
    end = min(audio.shape[1], start + int(round(window_ms / 1000 * sample_rate)))
    if end <= start:
        return np.zeros(0, dtype=np.float32)
    seg = audio[:, start:end]
    return np.mean(seg, axis=0, dtype=np.float32) if seg.ndim == 2 else seg.astype(np.float32)


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
    """기본 주파수 → 탐 패드. nan이면 MID_TOM(가장 흔한 탐)."""
    lo, hi = float(bands[0]), float(bands[1])
    if math.isnan(f0):
        return "MID_TOM"
    if f0 < lo:
        return "FLOOR_TOM"
    if f0 < hi:
        return "MID_TOM"
    return "SMALL_TOM"


def cymbal_pad(crash_seg: np.ndarray, ride_seg: np.ndarray, min_energy: float) -> str:
    """두 스템 구간의 에너지 비교. 둘 다 거의 무음이면 CRASH(ADTOF 심벌 타격은 크래시가 더 흔함)."""
    e_crash = float(np.sum(crash_seg.astype(np.float64) ** 2)) if crash_seg.size else 0.0
    e_ride = float(np.sum(ride_seg.astype(np.float64) ** 2)) if ride_seg.size else 0.0
    if max(e_crash, e_ride) < min_energy:
        return "CRASH"
    return "RIDE" if e_ride > e_crash else "CRASH"


def assign_pads(
    peaks: dict[int, list[float]],
    stems: dict[str, np.ndarray],
    sample_rate: int,
    rules: dict,
) -> list[RawHit]:
    """ADTOF 피치별 시각 + 분리 스템 → (시각, 패드 이름, None) 목록. 패드 이름이 원래 라벨."""
    r = rules_with_defaults(rules)
    cymbal_window = r["cymbal_window_ms"] if r.get("cymbal_window_ms") else r["window_ms"]
    names = r["stems"]
    toms = stems.get(names["toms"])
    crash = stems.get(names["crash"])
    ride = stems.get(names["ride"])
    out: list[RawHit] = []
    for pitch, times in peaks.items():
        for t in times:
            if pitch in LABEL_BY_PITCH:
                out.append((t, LABEL_BY_PITCH[pitch], None))
            elif pitch == ADTOF_TOM:
                seg = (
                    _window(toms, sample_rate, t, r["window_ms"])
                    if toms is not None
                    else np.zeros(0)
                )
                f0 = estimate_f0(seg, sample_rate, r["tom_fmin"], r["tom_fmax"])
                out.append((t, tom_pad(f0, r["tom_bands"]), None))
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
        return assign_pads(peaks, stems, sample_rate, self.rules)

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
