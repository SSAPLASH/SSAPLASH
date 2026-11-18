"""MUSDB18-HQ 로더.

폴더 규칙은 `{root}/{subset}/{곡 이름}/{mixture,drums,bass,other,vocals}.wav`,
44.1kHz 스테레오 16비트. musdb 패키지 없이 soundfile로 직접 읽음.
정답 반주는 원곡 − 정답 드럼.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from ssaplash_ai.bench.datasets.base import (
    BaseDataset,
    DatasetConfig,
    SongItem,
    match_length,
    read_audio,
)

STEMS = ("mixture", "drums", "bass", "other", "vocals")
ACCOMP_STEMS = ("bass", "other", "vocals")


class MusdbDataset(BaseDataset):
    kind = "musdb"

    def __init__(self, config: DatasetConfig) -> None:
        super().__init__(config)
        if not config.subset:
            raise ValueError("musdb 데이터셋 설정에는 subset(train 또는 test)이 필요")
        self.subset_dir = config.root / config.subset

    def song_ids(self) -> list[str]:
        if self.config.songs:
            return list(self.config.songs)
        if not self.subset_dir.is_dir():
            return []
        return sorted(p.name for p in self.subset_dir.iterdir() if p.is_dir())

    def required_files(self, song_id: str) -> list[Path]:
        d = self.subset_dir / song_id
        return [d / "mixture.wav", d / "drums.wav"]

    def load(self, song_id: str) -> SongItem:
        mixture_path, drums_path = self.required_files(song_id)
        mixture = self._read(mixture_path)
        drums = self._read(drums_path)
        mixture, drums = match_length(mixture, drums)
        return SongItem(
            dataset=self.name,
            song_id=song_id,
            sample_rate=self.config.sample_rate,
            mixture=mixture,
            drums_true=drums,
            accomp_true=mixture - drums,
            clip=self.config.clip,
            onsets_true=None,
        )


def read_accompaniment_stems(
    song_dir: Path,
    sample_rate: int,
    clip: tuple[float, float] | None = None,
) -> np.ndarray:
    """bass·other·vocals 세 스템의 합 = 드럼 없는 반주. 합성곡 재료용."""
    stems = [read_audio(song_dir / f"{name}.wav", sample_rate, clip) for name in ACCOMP_STEMS]
    stems = match_length(*stems)
    return np.sum(stems, axis=0, dtype=np.float32)
