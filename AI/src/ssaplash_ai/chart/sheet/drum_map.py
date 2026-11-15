"""GM 드럼 번호 → 패드.

BE `song/midi/GmDrumMapping.java`와 같은 표. 같은 악보를 MIDI로 올리든 MusicXML로 올리든 같은 패드가 나오게 함.
표에 없는 번호(클랩·탬버린·카우벨 등)는 None이고 채보에서 뺌. 58은 GM에서 비브라슬랩이지만 BE 표대로 플로어탐.
"""

from __future__ import annotations

PAD_PITCHES: dict[str, tuple[int, ...]] = {
    "KICK": (35, 36),
    "SNARE": (37, 38, 40),
    "HIHAT": (22, 26, 42, 46),
    "HIHAT_PEDAL": (44,),
    "SMALL_TOM": (48, 50),
    "MID_TOM": (45, 47),
    "FLOOR_TOM": (41, 43, 58),
    "CRASH": (49, 52, 55, 57),
    "RIDE": (51, 53, 59),
}
GM_PAD: dict[int, str] = {p: pad for pad, pitches in PAD_PITCHES.items() for p in pitches}
# 열린 하이햇(46)·열린 하이햇 가장자리(26). 닫힘은 42·22
OPEN_HIHAT_PITCHES: tuple[int, ...] = (46, 26)
CLOSED_HIHAT_PITCHES: tuple[int, ...] = (42, 22)


def pad_of(gm: int | None) -> str | None:
    """GM 번호 → 패드 9종 중 하나. 표에 없으면 None."""
    return None if gm is None else GM_PAD.get(int(gm))
