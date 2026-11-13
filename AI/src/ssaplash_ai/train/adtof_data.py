"""ADTOF 파인튜닝용 학습 윈도 생성.

데이터셋 로더에서 곡을 뽑아 4.12초(412프레임, 100fps) 윈도를 자르고, 추론과 같은 함수로 입력 특징을,
정답 타격 표에서 프레임별 정답(프레임 × 클래스)을 만듦.
- 클래스 묶음: five(5가지), five_pedal(+ 페달 하이햇), five_pedal_cym(심벌을 크래시·라이드로), pads(패드 9종)
- 탐 강조: 윈도의 `tom_window_frac` 비율은 정답 탐 타격 하나를 가운데 두고 자름
- 반주가 있는 곡은 `accomp_mix_prob` 확률로 반주를 낮은 게인으로 섞음
- 데이터셋마다 `ignore_classes`로 손실에서 뺄 클래스를 지정
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import torch
from adtof_pytorch.audio import AudioProcessor, create_adtof_processor
from torch.utils.data import IterableDataset

from ssaplash_ai.bench.datasets import SongItem, load_dataset
from ssaplash_ai.bench.datasets.base import BaseDataset
from ssaplash_ai.bench.datasets.pads import FIVE_GROUPS, HITS_DTYPE, PEDAL

FPS = 100
SAMPLE_RATE = 44100
HOP = SAMPLE_RATE // FPS  # 441
WINDOW_FRAMES = 412

# 출력 순서. five는 ADTOF LABELS_5 순서(35 킥·38 스네어·47 탐·42 하이햇·49 심벌)와 같음
FIVE_ORDER: tuple[str, ...] = ("kick", "snare", "tom", "hihat", "cymbal")
FIVE_PITCHES: tuple[int, ...] = (35, 38, 47, 42, 49)
# five_pedal은 five 뒤에 페달 하이햇(GM 44번)
FIVE_PEDAL_ORDER: tuple[str, ...] = (*FIVE_ORDER, "pedal")
FIVE_PEDAL_PITCHES: tuple[int, ...] = (*FIVE_PITCHES, 44)
# five_pedal_cym은 심벌 채널을 크래시로 쓰고 끝에 라이드(GM 51번). 앞 5채널 순서는 ADTOF 그대로
FIVE_PEDAL_CYM_ORDER: tuple[str, ...] = ("kick", "snare", "tom", "hihat", "crash", "pedal", "ride")
FIVE_PEDAL_CYM_PITCHES: tuple[int, ...] = (*FIVE_PEDAL_PITCHES, 51)
PAD_ORDER: tuple[str, ...] = (
    "KICK",
    "SNARE",
    "SMALL_TOM",
    "MID_TOM",
    "FLOOR_TOM",
    "HIHAT",
    "CRASH",
    "RIDE",
    PEDAL,
)
TOM_PADS: tuple[str, ...] = ("SMALL_TOM", "MID_TOM", "FLOOR_TOM")
CLASS_SETS = ("five", "five_pedal", "five_pedal_cym", "pads")
FIVE_LIKE = ("five", "five_pedal", "five_pedal_cym")  # 앞 5채널이 ADTOF 순서인 묶음


def class_names(classes: str) -> tuple[str, ...]:
    """클래스 집합 이름 → 출력 순서의 클래스 이름."""
    if classes == "five":
        return FIVE_ORDER
    if classes == "five_pedal":
        return FIVE_PEDAL_ORDER
    if classes == "five_pedal_cym":
        return FIVE_PEDAL_CYM_ORDER
    if classes == "pads":
        return PAD_ORDER
    raise ValueError(f"classes는 {CLASS_SETS} 중 하나: {classes!r}")


def pad_to_index(classes: str) -> dict[str, int]:
    """패드 9종 → 출력 채널 번호. five는 페달을 하이햇 채널로, five_pedal·five_pedal_cym은 페달 채널로.
    five_pedal_cym은 크래시·라이드도 각자 채널로."""
    names = class_names(classes)
    if classes == "five_pedal_cym":
        out = {pad: names.index(group) for pad, group in FIVE_GROUPS.items() if group != "cymbal"}
        out.update({PEDAL: names.index("pedal"), "CRASH": names.index("crash")})
        out["RIDE"] = names.index("ride")
        return out
    if classes in ("five", "five_pedal"):
        out = {pad: names.index(group) for pad, group in FIVE_GROUPS.items()}
        if classes == "five_pedal":
            out[PEDAL] = names.index("pedal")
        return out
    return {pad: names.index(pad) for pad in PAD_ORDER}


def tom_indices(classes: str) -> list[int]:
    """출력 채널 중 탐 채널 번호(클래스 가중치 배수용)."""
    names = class_names(classes)
    return [i for i, n in enumerate(names) if n == "tom" or n in TOM_PADS]


def pedal_indices(classes: str) -> list[int]:
    """출력 채널 중 페달 하이햇 채널 번호(클래스 가중치 배수용). five는 없음."""
    names = class_names(classes)
    return [i for i, n in enumerate(names) if n in ("pedal", PEDAL)]


# ---------- 특징·정답 ----------


def to_mono(audio: np.ndarray) -> np.ndarray:
    """(채널, 샘플) → (샘플,). librosa.load(mono=True)와 같이 채널 평균."""
    if audio.ndim == 1:
        return audio.astype(np.float32, copy=False)
    return audio.mean(axis=0).astype(np.float32, copy=False)


def features(audio: np.ndarray, processor: AudioProcessor | None = None) -> np.ndarray:
    """(채널, 샘플) 44.1kHz → (프레임, 84) float32. 추론(`load_audio_for_model`)과 같은 계산."""
    processor = processor or create_adtof_processor()
    spec = processor.compute_stft(to_mono(audio))
    return np.ascontiguousarray(processor.apply_filterbank(spec).T, dtype=np.float32)


def window_samples(window_frames: int = WINDOW_FRAMES) -> int:
    """윈도 프레임 수에 맞는 샘플 수. STFT(center=True)가 1 + 샘플÷hop 프레임을 내므로 뒤를 자름."""
    return window_frames * HOP


def frame_targets(
    hits: np.ndarray,
    n_frames: int,
    classes: str,
    label_radiation: int = 1,
    fps: int = FPS,
) -> np.ndarray:
    """타격 표 → (프레임, 클래스) 0/1. 타격 프레임과 앞뒤 label_radiation 프레임이 1."""
    if hits.dtype != HITS_DTYPE:
        raise ValueError("타격 표 dtype이 HITS_DTYPE이 아님")
    index = pad_to_index(classes)
    target = np.zeros((n_frames, len(class_names(classes))), dtype=np.float32)
    frames = np.rint(hits["time_sec"] * fps).astype(int)
    for frame, pad in zip(frames.tolist(), hits["pad"].tolist(), strict=True):
        lo = max(0, frame - label_radiation)
        hi = min(n_frames, frame + label_radiation + 1)
        if lo < hi:
            target[lo:hi, index[pad]] = 1.0
    return target


# ---------- 윈도 뽑기 ----------


@dataclass
class WindowConfig:
    """윈도 하나를 만들 때 쓰는 설정. 학습 설정(adtof_finetune.TrainConfig)의 부분집합."""

    classes: str = "five"
    window_frames: int = WINDOW_FRAMES
    label_radiation: int = 1
    tom_window_frac: float = 0.5
    accomp_mix_prob: float = 0.3
    accomp_gain_range: tuple[float, float] = (0.05, 0.3)
    gain_db_range: tuple[float, float] = (-6.0, 6.0)


def tom_hit_times(hits: np.ndarray) -> np.ndarray:
    return hits["time_sec"][np.isin(hits["pad"], TOM_PADS)]


def choose_start(song: SongItem, rng: np.random.Generator, cfg: WindowConfig) -> tuple[int, bool]:
    """윈도 시작 샘플과 탐 중심 여부. 곡이 윈도보다 짧으면 0."""
    n_win = window_samples(cfg.window_frames)
    n = song.drums_true.shape[1]
    if n <= n_win:
        return 0, False
    toms = tom_hit_times(song.hits_true) if song.hits_true is not None else np.zeros(0)
    if len(toms) and rng.random() < cfg.tom_window_frac:
        center = float(rng.choice(toms)) * SAMPLE_RATE
        # 정확히 가운데가 아니라 ±1초 안에서 흔들어 같은 탐이 항상 같은 자리에 오지 않게 함
        center += rng.uniform(-1.0, 1.0) * SAMPLE_RATE
        start = int(np.clip(round(center - n_win / 2), 0, n - n_win))
        return start, True
    return int(rng.integers(0, n - n_win + 1)), False


def cut_window(
    song: SongItem, start: int, rng: np.random.Generator, cfg: WindowConfig
) -> tuple[np.ndarray, np.ndarray]:
    """곡에서 start 샘플부터 윈도를 잘라 (입력 특징 (프레임, 84), 정답 (프레임, 클래스))."""
    n_win = window_samples(cfg.window_frames)
    drums = song.drums_true[:, start : start + n_win]
    audio = drums.astype(np.float32, copy=True)
    if (
        song.accomp_true is not None
        and song.accomp_true.shape[1] >= start + drums.shape[1]
        and np.any(song.accomp_true[:, start : start + drums.shape[1]])
        and rng.random() < cfg.accomp_mix_prob
    ):
        gain = rng.uniform(*cfg.accomp_gain_range)
        audio += np.float32(gain) * song.accomp_true[:, start : start + drums.shape[1]]
    audio *= np.float32(10.0 ** (rng.uniform(*cfg.gain_db_range) / 20.0))
    if audio.shape[1] < n_win:
        audio = np.pad(audio, ((0, 0), (0, n_win - audio.shape[1])))
    feat = features(audio)[: cfg.window_frames]
    start_sec = start / SAMPLE_RATE
    end_sec = start_sec + n_win / SAMPLE_RATE
    hits = song.hits_true
    if hits is None:
        hits = np.zeros(0, dtype=HITS_DTYPE)
    t = hits["time_sec"]
    local = hits[(t >= start_sec) & (t < end_sec)].copy()
    local["time_sec"] -= start_sec
    target = frame_targets(local, cfg.window_frames, cfg.classes, cfg.label_radiation)
    return feat, target


# ---------- 곡 모음 ----------


@dataclass
class DatasetSpec:
    """학습 설정의 train_datasets 항목 하나. ignore_classes는 이 데이터셋 윈도에서 손실을 뺄 클래스 이름
    (주석에 없는 클래스, 예: 페달 표시가 없는 ENST의 `pedal`)."""

    path: Path
    weight: float = 1.0
    ignore_classes: tuple[str, ...] = ()


def loss_mask(classes: str, ignore: Sequence[str] = ()) -> np.ndarray:
    """(클래스,) 1/0. ignore에 든 클래스 채널만 0. 모르는 이름이면 오류."""
    names = class_names(classes)
    unknown = [c for c in ignore if c not in names]
    if unknown:
        raise ValueError(f"ignore_classes {unknown}는 {classes} 클래스가 아님 (가능: {names})")
    return np.array([0.0 if n in ignore else 1.0 for n in names], dtype=np.float32)


@dataclass
class SongPool:
    """데이터셋 여러 개의 곡 목록. 데이터셋은 weight에 비례해, 곡은 그 안에서 고르게 뽑음."""

    loaders: list[BaseDataset]
    weights: np.ndarray
    song_ids: list[list[str]]
    names: list[str] = field(default_factory=list)
    ignore: list[tuple[str, ...]] = field(default_factory=list)

    @classmethod
    def from_specs(cls, specs: Sequence[DatasetSpec]) -> SongPool:
        loaders = [load_dataset(s.path) for s in specs]
        ids = [ld.song_ids() for ld in loaders]
        for ld, songs in zip(loaders, ids, strict=True):
            if not songs:
                raise ValueError(f"학습 데이터셋에 곡이 없음: {ld.name}")
        w = np.array([max(0.0, float(s.weight)) for s in specs], dtype=np.float64)
        if w.sum() <= 0:
            raise ValueError("train_datasets의 weight 합이 0")
        ignore = [tuple(s.ignore_classes) for s in specs]
        return cls(loaders, w / w.sum(), ids, [ld.name for ld in loaders], ignore)

    def ignore_of(self, k: int) -> tuple[str, ...]:
        return self.ignore[k] if k < len(self.ignore) else ()

    @property
    def n_songs(self) -> int:
        return sum(len(s) for s in self.song_ids)

    def digest(self) -> str:
        """곡 목록 해시(재현 기록용)."""
        h = hashlib.sha1()
        for name, songs in zip(self.names, self.song_ids, strict=True):
            h.update(name.encode())
            for s in songs:
                h.update(s.encode())
        return h.hexdigest()[:12]

    def draw(self, rng: np.random.Generator) -> tuple[BaseDataset, str]:
        k, song_id = self.draw_index(rng)
        return self.loaders[k], song_id

    def draw_index(self, rng: np.random.Generator) -> tuple[int, str]:
        """(데이터셋 번호, 곡 id). draw와 같은 순서로 난수를 씀."""
        k = int(rng.choice(len(self.loaders), p=self.weights))
        return k, str(rng.choice(self.song_ids[k]))


class WindowDataset(IterableDataset):
    """무한히 윈도를 내는 데이터셋. 곡 하나를 읽으면 windows_per_song개를 뽑고 다음 곡으로.

    윈도마다 (입력 (프레임, 84, 1), 정답 (프레임, 클래스), 손실 마스크 (클래스,))를 냄.
    마스크는 그 곡 데이터셋의 ignore_classes 채널만 0.
    DataLoader 워커마다 시드가 달라야 하므로 워커 번호를 시드에 더함.
    """

    def __init__(
        self,
        pool: SongPool,
        cfg: WindowConfig,
        seed: int = 0,
        windows_per_song: int = 8,
    ) -> None:
        self.pool = pool
        self.cfg = cfg
        self.seed = seed
        self.windows_per_song = windows_per_song

    def __iter__(self) -> Iterator[tuple[torch.Tensor, torch.Tensor, torch.Tensor]]:
        info = torch.utils.data.get_worker_info()
        worker = info.id if info is not None else 0
        rng = np.random.default_rng(self.seed * 1000 + worker)
        masks = [
            torch.from_numpy(loss_mask(self.cfg.classes, self.pool.ignore_of(k)))
            for k in range(len(self.pool.loaders))
        ]
        while True:
            k, song_id = self.pool.draw_index(rng)
            song = self.pool.loaders[k].load(song_id)
            for _ in range(self.windows_per_song):
                start, _ = choose_start(song, rng, self.cfg)
                feat, target = cut_window(song, start, rng, self.cfg)
                yield torch.from_numpy(feat).unsqueeze(-1), torch.from_numpy(target), masks[k]


def song_features(song: SongItem, processor: AudioProcessor | None = None) -> np.ndarray:
    """검증·평가용 곡 전체 특징 (프레임, 84). 정답 드럼 트랙 입력."""
    return features(song.drums_true, processor)
