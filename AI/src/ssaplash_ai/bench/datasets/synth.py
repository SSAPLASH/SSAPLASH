"""자체 합성곡(synth_v1) 로더.

폴더 규칙은 `{root}/{곡 이름}/` 아래 mixture.wav, drums.wav, accomp.wav,
onsets.csv, meta.yaml. 생성은 synth_build.py와 scripts/make_synth_songs.py.
정답 반주는 MUSDB와 같은 기준으로 원곡 − 정답 드럼. accomp.wav는 청취·검산용.
채보 정답 hits_true는 onsets.csv의 gmd_class·velocity를 gmd.GMD_CLASS_PAD로 변환한 것.
onsets_true는 지금처럼 csv 전체 시각(패드에 없는 타격 포함).
"""

from __future__ import annotations

import csv
from pathlib import Path

import numpy as np

from ssaplash_ai.bench.datasets.base import BaseDataset, SongItem, match_length
from ssaplash_ai.bench.datasets.gmd import GMD_CLASS_PAD
from ssaplash_ai.bench.datasets.pads import clip_hits, make_hits

ONSET_COLUMNS = ("time_sec", "pitch", "gmd_class", "velocity")
SONG_FILES = ("mixture.wav", "drums.wav", "accomp.wav", "onsets.csv", "meta.yaml")


def read_onset_rows(path: Path) -> list[dict[str, str]]:
    """onsets.csv 행 전체."""
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def read_onsets(path: Path) -> np.ndarray:
    """onsets.csv의 time_sec 열을 초 단위 float 배열로 읽음."""
    rows = read_onset_rows(path)
    return np.array([float(r["time_sec"]) for r in rows], dtype=np.float64)


def read_hits(path: Path) -> tuple[np.ndarray, int]:
    """onsets.csv → (타격 표, 패드에 없어 뺀 개수)."""
    rows = read_onset_rows(path)
    return make_hits(
        (float(r["time_sec"]) for r in rows),
        (r["gmd_class"] for r in rows),
        (int(r["velocity"]) for r in rows),
        GMD_CLASS_PAD,
    )


class SynthDataset(BaseDataset):
    kind = "synth"

    def song_ids(self) -> list[str]:
        if self.config.songs:
            return list(self.config.songs)
        root = self.config.root
        if not root.is_dir():
            return []
        return sorted(p.name for p in root.iterdir() if p.is_dir())

    def required_files(self, song_id: str) -> list[Path]:
        d = self.config.root / song_id
        return [d / name for name in SONG_FILES]

    def hits_of(self, song_id: str) -> tuple[np.ndarray, int]:
        hits, dropped = read_hits(self.config.root / song_id / "onsets.csv")
        if self.config.clip is not None:
            hits = clip_hits(hits, *self.config.clip)
        return hits, dropped

    def load(self, song_id: str) -> SongItem:
        d = self.config.root / song_id
        mixture = self._read(d / "mixture.wav")
        drums = self._read(d / "drums.wav")
        mixture, drums = match_length(mixture, drums)
        onsets = read_onsets(d / "onsets.csv")
        hits, dropped = self.hits_of(song_id)
        if self.config.clip is not None:
            start, end = self.config.clip
            onsets = onsets[(onsets >= start) & (onsets < end)] - start
        return SongItem(
            dataset=self.name,
            song_id=song_id,
            sample_rate=self.config.sample_rate,
            mixture=mixture,
            drums_true=drums,
            accomp_true=mixture - drums,
            clip=self.config.clip,
            onsets_true=onsets,
            hits_true=hits,
            hits_dropped=dropped,
        )
