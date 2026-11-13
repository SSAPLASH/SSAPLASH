"""STAR Drums 로더.

실제 반주에 샘플 킷 20개(어쿠스틱 15·전자 5)로 다시 합성한 드럼을 섞은 공개 데이터 (Weber 외 2025, Zenodo
10.5281/zenodo.15690078). 탐이 HT·MT·LT 3종으로 적혀 있어 킷이 바뀔 때 탐 규칙이 버티는지 보는 데 씀.
오디오는 출처별 CC BY-NC-SA·MTG-Jamendo 개별 라이선스라 평가·연구용으로만 쓴다.

폴더 규칙 (root는 zip 안 `data` 폴더, subset은 그 아래 분할 폴더. test·validation은 바로, training은
`training/ismir04`처럼 출처 폴더까지)
- `{root}/{subset}/annotation/{곡}_mix_{킷}.txt`: 탭 구분 "초 \t 클래스 \t MIDI 세기". 곡 id는 이 파일 이름
- `{root}/{subset}/audio/re_synthesized_drum/{곡}_re_synth_drum_{킷}.flac`: 합성 드럼 트랙 (정답 드럼)
- `{root}/{subset}/audio/non_drum/{곡}_non_drum.flac`: 반주
- `{root}/{subset}/audio/mix/{곡}_mix_{킷}.flac`: 원곡. MUSDB18 출처 일부는 라이선스 때문에 없고 드럼 + 반주로 대신함
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from ssaplash_ai.bench.datasets.base import BaseDataset, SongItem, match_length
from ssaplash_ai.bench.datasets.pads import DROP, clip_hits, make_hits

# 18 클래스 → 패드. 이름은 데이터셋 class_mappings.py와 킷 MIDI 대응표 기준
STAR_CLASS_PAD: dict[str, str] = {
    "BD": "KICK",
    "SD": "SNARE",
    "SS": "SNARE",  # 사이드 스틱
    "CHH": "HIHAT",
    "PHH": "HIHAT_PEDAL",
    "OHH": "HIHAT",  # 오픈
    "HT": "SMALL_TOM",
    "MT": "MID_TOM",
    "LT": "FLOOR_TOM",
    "CRC": "CRASH",
    "SPC": "CRASH",  # 스플래시
    "CHC": "CRASH",  # 차이나
    "RD": "RIDE",
    "RB": "RIDE",  # 라이드 벨
    "CL": DROP,  # 클랩
    "CB": DROP,  # 카우벨
    "TB": DROP,  # 탬버린
    "CLP": DROP,  # 클라베
}
MIX_TAG = "_mix_"
DRUM_TAG = "_re_synth_drum_"


def split_song_id(song_id: str) -> tuple[str, str]:
    """`{곡}_mix_{킷}` → (곡, 킷)."""
    if MIX_TAG not in song_id:
        raise ValueError(f"STAR Drums 곡 id 형식이 아님 ({MIX_TAG!r} 없음): {song_id}")
    item, kit = song_id.split(MIX_TAG, 1)
    return item, kit


def read_annotation(path: Path) -> list[tuple[float, str, int]]:
    """주석 파일 → (초, 클래스, 세기) 목록. 빈 줄 무시. 세기가 없으면 -1."""
    rows: list[tuple[float, str, int]] = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            parts = line.split()
            if len(parts) < 2:
                continue
            vel = int(float(parts[2])) if len(parts) >= 3 else -1
            rows.append((float(parts[0]), parts[1], vel))
    return rows


def annotation_hits(path: Path) -> tuple[np.ndarray, int]:
    rows = read_annotation(path)
    return make_hits(
        (t for t, _, _ in rows),
        (c for _, c, _ in rows),
        (v if v >= 0 else None for _, _, v in rows),
        STAR_CLASS_PAD,
    )


class StarDataset(BaseDataset):
    kind = "star"

    @property
    def split_dir(self) -> Path:
        return self.config.root / (self.config.subset or "test")

    def song_ids(self) -> list[str]:
        if self.config.songs:
            return list(self.config.songs)
        d = self.split_dir / "annotation"
        if not d.is_dir():
            return []
        return sorted(p.stem for p in d.glob("*.txt"))

    def kit_of(self, song_id: str) -> str:
        return split_song_id(song_id)[1]

    def _paths(self, song_id: str) -> dict[str, Path]:
        item, kit = split_song_id(song_id)
        audio = self.split_dir / "audio"
        return {
            "drums": audio / "re_synthesized_drum" / f"{item}{DRUM_TAG}{kit}.flac",
            "annotation": self.split_dir / "annotation" / f"{song_id}.txt",
            "accomp": audio / "non_drum" / f"{item}_non_drum.flac",
            "mix": audio / "mix" / f"{song_id}.flac",
        }

    def required_files(self, song_id: str) -> list[Path]:
        p = self._paths(song_id)
        return [p["drums"], p["annotation"], p["accomp"]]

    def hits_of(self, song_id: str) -> tuple[np.ndarray, int]:
        hits, dropped = annotation_hits(self._paths(song_id)["annotation"])
        if self.config.clip is not None:
            hits = clip_hits(hits, *self.config.clip)
        return hits, dropped

    def load(self, song_id: str) -> SongItem:
        p = self._paths(song_id)
        drums = self._read(p["drums"])
        accomp = self._read(p["accomp"])
        drums, accomp = match_length(drums, accomp)
        if p["mix"].is_file():
            mixture = self._read(p["mix"])
            mixture, drums, accomp = match_length(mixture, drums, accomp)
        else:
            # MUSDB18 출처 일부는 믹스가 배포되지 않음. 데이터셋 스크립트의 믹싱 게인 대신 단순 합으로 대신함
            mixture = drums + accomp
        onsets = np.array([t for t, _, _ in read_annotation(p["annotation"])], dtype=np.float64)
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
            accomp_true=accomp,
            clip=self.config.clip,
            onsets_true=onsets,
            hits_true=hits,
            hits_dropped=dropped,
        )
