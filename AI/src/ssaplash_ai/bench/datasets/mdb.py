"""MDB Drums 로더.

MedleyDB 23곡에 사람이 타격 시각·드럼 종류를 적은 공개 데이터셋 (CC BY-NC-SA 4.0).
폴더 규칙은 `{root}/audio/full_mix/{곡}_MIX.wav`, `{root}/audio/drum_only/{곡}_Drum.wav`,
`{root}/annotations/subclass/{곡}_subclass.txt`(탭 구분, 초·라벨). root는 `MDB Drums` 폴더.
정답 반주는 원곡 − 정답 드럼으로 계산하되 근사값(마스터링 차이 가능). 세기 정답은 없음.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from ssaplash_ai.bench.datasets.base import BaseDataset, SongItem, match_length
from ssaplash_ai.bench.datasets.pads import DROP, clip_hits, make_hits

# 세부 분류(subclass) 21종 → 패드. 23곡 주석에서 모은 라벨 전부
MDB_SUBCLASS_PAD: dict[str, str] = {
    "KD": "KICK",
    "SD": "SNARE",
    "SDB": "SNARE",  # 브러시
    "SDD": "SNARE",  # 드래그
    "SDF": "SNARE",  # 플램
    "SDG": "SNARE",  # 고스트
    "SDNS": "SNARE",  # 스네어 끈 풀림
    "SST": "SNARE",  # 사이드 스틱
    "CHH": "HIHAT",
    "OHH": "HIHAT",
    "PHH": "HIHAT_PEDAL",
    "HIT": "SMALL_TOM",
    "MHT": "MID_TOM",
    "HFT": "FLOOR_TOM",
    "LFT": "FLOOR_TOM",
    "CRC": "CRASH",
    "CHC": "CRASH",  # 차이나
    "SPC": "CRASH",  # 스플래시
    "RDC": "RIDE",
    "RDB": "RIDE",  # 라이드 벨
    "TMB": DROP,  # 탬버린
}

# MUSDB18 train에도 들어 있는 곡 (같은 MedleyDB 녹음). 분리 모델이 학습 때 본 곡이라
# "분리 후 F1 변화"에서는 뺀다
MDB_IN_MUSDB_TRAIN: tuple[str, ...] = (
    "MusicDelta_80sRock",
    "MusicDelta_Beatles",
    "MusicDelta_Britpop",
    "MusicDelta_Country1",
    "MusicDelta_Disco",
    "MusicDelta_Gospel",
    "MusicDelta_Grunge",
    "MusicDelta_Hendrix",
    "MusicDelta_Punk",
    "MusicDelta_Reggae",
    "MusicDelta_Rock",
    "MusicDelta_Rockabilly",
)


def read_annotation(path: Path) -> list[tuple[float, str]]:
    """주석 파일 → (시각 초, 라벨) 목록. 빈 줄 무시."""
    rows: list[tuple[float, str]] = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            parts = line.split()
            if len(parts) < 2:
                continue
            rows.append((float(parts[0]), parts[1]))
    return rows


def annotation_hits(path: Path) -> tuple[np.ndarray, int]:
    rows = read_annotation(path)
    return make_hits((t for t, _ in rows), (label for _, label in rows), None, MDB_SUBCLASS_PAD)


class MdbDataset(BaseDataset):
    kind = "mdb"

    def song_ids(self) -> list[str]:
        if self.config.songs:
            return list(self.config.songs)
        d = self.config.root / "audio" / "full_mix"
        if not d.is_dir():
            return []
        return sorted(p.name[: -len("_MIX.wav")] for p in d.glob("*_MIX.wav"))

    def required_files(self, song_id: str) -> list[Path]:
        root = self.config.root
        return [
            root / "audio" / "full_mix" / f"{song_id}_MIX.wav",
            root / "audio" / "drum_only" / f"{song_id}_Drum.wav",
            root / "annotations" / "subclass" / f"{song_id}_subclass.txt",
        ]

    def hits_of(self, song_id: str) -> tuple[np.ndarray, int]:
        hits, dropped = annotation_hits(self.required_files(song_id)[2])
        if self.config.clip is not None:
            hits = clip_hits(hits, *self.config.clip)
        return hits, dropped

    def load(self, song_id: str) -> SongItem:
        mix_path, drum_path, ann_path = self.required_files(song_id)
        mixture = self._read(mix_path)
        drums = self._read(drum_path)
        mixture, drums = match_length(mixture, drums)
        onsets = np.array([t for t, _ in read_annotation(ann_path)], dtype=np.float64)
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
