"""ENST-Drums 로더. 실제 드러머 3명의 녹음 (Gillet & Richard, ISMIR 2006).

이용 조건은 본인만·연구용·변형물 금지·공유 금지. 세기 정답과 페달 하이햇 라벨이 없음.

폴더 규칙 (root는 `ENST-drums-public`)
- `{root}/drummer_{N}/annotation/{번호}_{종류}_{스타일}_{도구}.txt`: 한 줄 "초 라벨"
- `{root}/drummer_{N}/audio/wet_mix/{같은 이름}.wav`: 드럼만. 채보 입력이자 정답 드럼
- `{root}/drummer_{N}/audio/accompaniment/{같은 이름}.wav`: 반주. minus-one·MIDI-minus-one 곡만
곡 id는 `drummer_1/107_minus-one_salsa_sticks`. 종류는 hits·phrase·solo·minus-one·MIDI-minus-one.

탐: 드러머 1·2는 탐 둘(mt·lt)이라 위쪽 탐을 MID_TOM으로 적음. 드러머 3은 탐 넷이라 설정 `extra.tom4`로 대응.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from ssaplash_ai.bench.datasets.base import BaseDataset, SongItem, match_length
from ssaplash_ai.bench.datasets.pads import DROP, clip_hits, make_hits

# 탐이 아닌 라벨 → 패드. 드러머 셋의 주석 318개 파일에서 모은 라벨 전부
ENST_LABEL_PAD: dict[str, str] = {
    "bd": "KICK",
    "sd": "SNARE",
    "sd-": "SNARE",  # 약한 스네어
    "rs": "SNARE",  # 림샷
    "cs": "SNARE",  # 크로스 스틱
    "sweep": DROP,  # 브러시 쓸기
    "sticks": DROP,  # 스틱끼리 부딪힘
    "chh": "HIHAT",
    "ohh": "HIHAT",
    "cb": DROP,  # 카우벨
    "c1": "CRASH",  # 심벌 (크래시·라이드 구분 없는 라벨)
    "c4": "CRASH",
    "cr1": "CRASH",
    "cr2": "CRASH",
    "cr5": "CRASH",
    "ch1": "CRASH",  # 차이나
    "ch5": "CRASH",
    "spl2": "CRASH",  # 스플래시
    "rc2": "RIDE",
    "rc3": "RIDE",
    "rc4": "RIDE",
}
TOM_LABELS: tuple[str, ...] = ("mt", "lmt", "lt", "lft")
# 탐 둘인 드러머(1·2): 위쪽 탐은 MID_TOM
TWO_TOM_PAD: dict[str, str] = {"mt": "MID_TOM", "lt": "FLOOR_TOM"}
# 탐 넷인 드러머(3)의 기본 대응. yaml `extra.tom4`로 바꿀 수 있음
DEFAULT_TOM4: dict[str, str] = {
    "mt": "SMALL_TOM",
    "lmt": "MID_TOM",
    "lt": "FLOOR_TOM",
    "lft": "FLOOR_TOM",
}
FOUR_TOM_DRUMMERS: tuple[int, ...] = (3,)
KINDS: tuple[str, ...] = ("hits", "phrase", "solo", "minus-one", "MIDI-minus-one")
ACCOMP_KINDS: tuple[str, ...] = ("minus-one", "MIDI-minus-one")
# subset 값 → 종류 집합. minus-one은 반주 있는 둘 다(64곡), practice는 반주 없는 연주 셋
SUBSET_KINDS: dict[str, tuple[str, ...]] = {
    "minus-one": ACCOMP_KINDS,
    "practice": ("hits", "phrase", "solo"),
    "all": KINDS,
    **{k: (k,) for k in KINDS if k != "minus-one"},
}
DEFAULT_DRUMMERS: tuple[int, ...] = (1, 2, 3)
DEFAULT_ACCOMP_GAIN = 0.5
DEFAULT_DRUM_MIX = "wet_mix"


def parse_song_id(song_id: str) -> tuple[int, str]:
    """`drummer_1/107_minus-one_salsa_sticks` → (1, '107_minus-one_salsa_sticks')."""
    folder, _, name = song_id.partition("/")
    if not folder.startswith("drummer_") or not name:
        raise ValueError(f"ENST 곡 id 형식이 아님 (drummer_N/이름): {song_id}")
    return int(folder[len("drummer_") :]), name


def song_kind(name: str) -> str:
    """파일 이름 `{번호}_{종류}_{스타일}_{도구}` → 종류."""
    parts = name.split("_")
    if len(parts) < 2 or parts[1] not in KINDS:
        raise ValueError(f"ENST 파일 이름의 종류를 모름 (가능: {KINDS}): {name}")
    return parts[1]


def tom_label_pads(drummer: int, tom4: dict[str, str] | None = None) -> dict[str, str]:
    """드러머별 탐 라벨 → 패드. 림 라벨(mtr 등)은 같은 탐."""
    base = dict(DEFAULT_TOM4 if tom4 is None else tom4) if drummer in FOUR_TOM_DRUMMERS else {}
    pads = base if base else dict(TWO_TOM_PAD)
    out: dict[str, str] = {}
    for label, pad in pads.items():
        out[label] = pad
        out[label + "r"] = pad
    return out


def label_pad_table(drummer: int, tom4: dict[str, str] | None = None) -> dict[str, str]:
    return {**ENST_LABEL_PAD, **tom_label_pads(drummer, tom4)}


def read_annotation(path: Path) -> list[tuple[float, str]]:
    """주석 파일 → (초, 라벨) 목록. 빈 줄 무시."""
    rows: list[tuple[float, str]] = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            parts = line.split()
            if len(parts) < 2:
                continue
            rows.append((float(parts[0]), parts[1]))
    return rows


def annotation_hits(path: Path, table: dict[str, str]) -> tuple[np.ndarray, int]:
    rows = read_annotation(path)
    return make_hits((t for t, _ in rows), (label for _, label in rows), None, table)


class EnstDataset(BaseDataset):
    kind = "enst"

    @property
    def drummers(self) -> tuple[int, ...]:
        raw = self.config.extra.get("drummers")
        return tuple(int(d) for d in raw) if raw else DEFAULT_DRUMMERS

    @property
    def accomp_gain(self) -> float:
        return float(self.config.extra.get("accomp_gain", DEFAULT_ACCOMP_GAIN))

    @property
    def tom4(self) -> dict[str, str]:
        raw = self.config.extra.get("tom4")
        return {str(k): str(v) for k, v in raw.items()} if raw else dict(DEFAULT_TOM4)

    @property
    def drum_mix(self) -> str:
        return str(self.config.extra.get("drum_mix", DEFAULT_DRUM_MIX))

    def kinds(self) -> tuple[str, ...]:
        subset = self.config.subset or "minus-one"
        try:
            return SUBSET_KINDS[subset]
        except KeyError as e:
            raise ValueError(f"ENST subset은 {sorted(SUBSET_KINDS)} 중 하나: {subset!r}") from e

    def song_ids(self) -> list[str]:
        if self.config.songs:
            return list(self.config.songs)
        kinds = set(self.kinds())
        out: list[str] = []
        for d in self.drummers:
            folder = self.config.root / f"drummer_{d}" / "annotation"
            if not folder.is_dir():
                continue
            for p in sorted(folder.glob("*.txt")):
                if song_kind(p.stem) in kinds:
                    out.append(f"drummer_{d}/{p.stem}")
        return out

    def drummer_of(self, song_id: str) -> int:
        return parse_song_id(song_id)[0]

    def kind_of(self, song_id: str) -> str:
        return song_kind(parse_song_id(song_id)[1])

    def _paths(self, song_id: str) -> dict[str, Path]:
        drummer, name = parse_song_id(song_id)
        base = self.config.root / f"drummer_{drummer}"
        return {
            "drums": base / "audio" / self.drum_mix / f"{name}.wav",
            "annotation": base / "annotation" / f"{name}.txt",
            "accomp": base / "audio" / "accompaniment" / f"{name}.wav",
        }

    def has_accomp(self, song_id: str) -> bool:
        return self.kind_of(song_id) in ACCOMP_KINDS

    def required_files(self, song_id: str) -> list[Path]:
        p = self._paths(song_id)
        files = [p["drums"], p["annotation"]]
        if self.has_accomp(song_id):
            files.append(p["accomp"])
        return files

    def hits_of(self, song_id: str) -> tuple[np.ndarray, int]:
        table = label_pad_table(self.drummer_of(song_id), self.tom4)
        hits, dropped = annotation_hits(self._paths(song_id)["annotation"], table)
        if self.config.clip is not None:
            hits = clip_hits(hits, *self.config.clip)
        return hits, dropped

    def load(self, song_id: str) -> SongItem:
        p = self._paths(song_id)
        drums = self._read(p["drums"])
        if self.has_accomp(song_id):
            accomp = self._read(p["accomp"]) * np.float32(self.accomp_gain)
            drums, accomp = match_length(drums, accomp)
        else:
            accomp = np.zeros_like(drums)
        onsets = np.array([t for t, _ in read_annotation(p["annotation"])], dtype=np.float64)
        hits, dropped = self.hits_of(song_id)
        if self.config.clip is not None:
            start, end = self.config.clip
            onsets = onsets[(onsets >= start) & (onsets < end)] - start
        return SongItem(
            dataset=self.name,
            song_id=song_id,
            sample_rate=self.config.sample_rate,
            mixture=drums + accomp,
            drums_true=drums,
            accomp_true=accomp,
            clip=self.config.clip,
            onsets_true=onsets,
            hits_true=hits,
            hits_dropped=dropped,
        )
