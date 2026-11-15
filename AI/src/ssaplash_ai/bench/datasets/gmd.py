"""GMD(Groove MIDI Dataset)·E-GMD 로더와 MIDI 피치 → 패드 대응표.

폴더 규칙은 `{root}/info.csv`와 그 안의 midi_filename·audio_filename. 드럼만 있어 mixture = drums_true, 반주는 무음.
타격 정답은 MIDI에서 뽑음. 44번 페달 하이햇은 HIHAT_PEDAL.
E-GMD는 GMD 연주를 킷 43개로 다시 녹음한 것. 같은 연주 id가 킷마다 한 행이라 곡 id로 오디오 파일 이름을 씀.
"""

from __future__ import annotations

import csv
import shutil
from pathlib import Path

import mido
import numpy as np

from ssaplash_ai.bench.datasets.base import BaseDataset, SongItem
from ssaplash_ai.bench.datasets.pads import DROP, clip_hits, make_hits

# 합성곡 onsets.csv의 gmd_class(synth_build.GMD_PITCH_CLASS 값) → 패드
GMD_CLASS_PAD: dict[str, str] = {
    "kick": "KICK",
    "snare": "SNARE",
    "hihat_closed": "HIHAT",
    "hihat_open": "HIHAT",
    "tom_high": "SMALL_TOM",
    "tom_mid": "MID_TOM",
    "tom_low": "FLOOR_TOM",
    "crash": "CRASH",
    "ride": "RIDE",
    "other": DROP,
}

# GMD MIDI 피치 → 패드
GMD_PITCH_PAD: dict[int, str] = {
    36: "KICK",
    38: "SNARE",
    37: "SNARE",
    40: "SNARE",
    42: "HIHAT",
    22: "HIHAT",
    44: "HIHAT_PEDAL",
    46: "HIHAT",
    26: "HIHAT",
    48: "SMALL_TOM",
    50: "SMALL_TOM",
    45: "MID_TOM",
    47: "MID_TOM",
    43: "FLOOR_TOM",
    58: "FLOOR_TOM",
    49: "CRASH",
    55: "CRASH",
    57: "CRASH",
    52: "CRASH",
    51: "RIDE",
    59: "RIDE",
    53: "RIDE",
    # 패드에 없는 타악기
    39: DROP,  # 클랩
    54: DROP,  # 탬버린
    56: DROP,  # 카우벨
    64: DROP,  # 콩가
    70: DROP,  # 마라카스
    75: DROP,  # 클라베
}


BEAT_TYPES: tuple[str, ...] = ("beat", "fill")


def beat_types_of(value: object) -> set[str]:
    """yaml `extra.beat_type` → 연주 종류 집합. 'beat'·'fill'·'all' 또는 목록. (파인튜닝 학습 분할은 둘 다 씀)"""
    if value is None:
        return {"beat"}
    items = [value] if isinstance(value, str) else list(value)
    out: set[str] = set()
    for item in items:
        s = str(item)
        if s == "all":
            out.update(BEAT_TYPES)
        elif s in BEAT_TYPES:
            out.add(s)
        else:
            raise ValueError(f"beat_type은 {BEAT_TYPES} 또는 all: {item!r}")
    return out


def load_gmd_info(gmd_root: Path) -> dict[str, dict[str, str]]:
    """info.csv를 id 열로 찾는 사전으로 읽음."""
    with open(gmd_root / "info.csv", encoding="utf-8", newline="") as f:
        return {row["id"]: row for row in csv.DictReader(f)}


def midi_onsets(path: Path) -> list[tuple[float, int, int]]:
    """MIDI에서 (시각 초, 피치, 세기) 목록 추출. 세기 0인 note_on은 note_off로 취급."""
    onsets = []
    t = 0.0
    for msg in mido.MidiFile(str(path)):
        t += msg.time
        if msg.type == "note_on" and msg.velocity > 0:
            onsets.append((t, msg.note, msg.velocity))
    return onsets


def midi_hits(path: Path) -> tuple[np.ndarray, int]:
    """MIDI → (타격 표, 패드에 없어 뺀 개수)."""
    rows = midi_onsets(path)
    return make_hits(
        (t for t, _, _ in rows),
        (pitch for _, pitch, _ in rows),
        (vel for _, _, vel in rows),
        GMD_PITCH_PAD,
    )


class GmdDataset(BaseDataset):
    kind = "gmd"

    def __init__(self, config) -> None:
        super().__init__(config)
        self._info: dict[str, dict[str, str]] | None = None

    @property
    def info(self) -> dict[str, dict[str, str]]:
        if self._info is None:
            path = self.config.root / "info.csv"
            self._info = load_gmd_info(self.config.root) if path.is_file() else {}
        return self._info

    def song_ids(self) -> list[str]:
        """설정 songs가 있으면 그 목록. 없으면 subset(기본 test)·extra.beat_type(기본 beat)·오디오 있는 연주 전부."""
        if self.config.songs:
            return list(self.config.songs)
        split = self.config.subset or "test"
        beat_types = beat_types_of(self.config.extra.get("beat_type", "beat"))
        return sorted(
            row["id"]
            for row in self.info.values()
            if row.get("audio_filename")
            and row["split"] == split
            and row["beat_type"] in beat_types
        )

    def _row(self, song_id: str) -> dict[str, str]:
        try:
            return self.info[song_id]
        except KeyError as e:
            raise KeyError(f"info.csv에 없는 GMD 연주 id: {song_id}") from e

    def required_files(self, song_id: str) -> list[Path]:
        if song_id not in self.info:
            # info.csv가 없거나 id가 틀리면 wav 경로를 만들 수 없음. 존재하지 않는 경로를 돌려
            # check()가 "{id}/missing-in-info.csv"로 누락 보고
            return [self.config.root / song_id / "missing-in-info.csv"]
        row = self._row(song_id)
        return [self.config.root / row["audio_filename"], self.config.root / row["midi_filename"]]

    def hits_of(self, song_id: str) -> tuple[np.ndarray, int]:
        hits, dropped = midi_hits(self.config.root / self._row(song_id)["midi_filename"])
        if self.config.clip is not None:
            hits = clip_hits(hits, *self.config.clip)
        return hits, dropped

    def load(self, song_id: str) -> SongItem:
        row = self._row(song_id)
        drums = self._read(self.config.root / row["audio_filename"])
        onsets = np.array(
            [t for t, _, _ in midi_onsets(self.config.root / row["midi_filename"])],
            dtype=np.float64,
        )
        hits, dropped = self.hits_of(song_id)
        if self.config.clip is not None:
            start, end = self.config.clip
            onsets = onsets[(onsets >= start) & (onsets < end)] - start
        return SongItem(
            dataset=self.name,
            song_id=song_id,
            sample_rate=self.config.sample_rate,
            mixture=drums,
            drums_true=drums,
            accomp_true=np.zeros_like(drums),
            clip=self.config.clip,
            onsets_true=onsets,
            hits_true=hits,
            hits_dropped=dropped,
        )


def export_subset(dataset: GmdDataset, out_root: Path) -> list[Path]:
    """설정 songs의 wav·mid와 info.csv를 out_root 아래 같은 상대 경로로 복사 (코랩에 올릴 묶음용).

    빠진 파일이 있으면 FileNotFoundError. 복사한 파일 경로 목록을 돌려줌.
    """
    root = dataset.config.root
    out_root.mkdir(parents=True, exist_ok=True)
    copied = [shutil.copy2(root / "info.csv", out_root / "info.csv")]
    for song_id in dataset.song_ids():
        for src in dataset.required_files(song_id):
            if not src.is_file():
                raise FileNotFoundError(f"{song_id}: 없음 {src}")
            dst = out_root / src.relative_to(root)
            dst.parent.mkdir(parents=True, exist_ok=True)
            copied.append(Path(shutil.copy2(src, dst)))
    return copied


EGMD_CSV = "e-gmd-v1.0.0.csv"


class EgmdDataset(GmdDataset):
    """E-GMD 로더. 곡 id = 오디오 파일 이름(확장자 뺀 것, 예 `drummer1/eval_session/1_funk-groove1_138_beat_4-4_10`).

    설정: `subset`은 split(test·validation·train, 기본 test). `extra.perf_ids`는 GMD 연주 id 목록(없으면 전부),
    `extra.kits`는 kit_name 목록(없으면 43개 전부), `extra.beat_type`은 beat·fill·all 또는 목록(기본 beat).
    `songs`가 있으면 그대로. GMD 로더도 같은 subset·beat_type 키를 받음(파인튜닝 학습 분할용).
    """

    kind = "egmd"

    @property
    def info(self) -> dict[str, dict[str, str]]:
        if self._info is None:
            path = self.config.root / EGMD_CSV
            if not path.is_file():
                self._info = {}
            else:
                with open(path, encoding="utf-8", newline="") as f:
                    self._info = {
                        row["audio_filename"].rsplit(".", 1)[0]: row for row in csv.DictReader(f)
                    }
        return self._info

    def kit_of(self, song_id: str) -> str:
        return self._row(song_id)["kit_name"]

    def perf_of(self, song_id: str) -> str:
        """곡 id → GMD 연주 id (`drummer1/eval_session/1`)."""
        return self._row(song_id)["id"]

    def song_ids(self) -> list[str]:
        if self.config.songs:
            return list(self.config.songs)
        split = self.config.subset or "test"
        beat_types = beat_types_of(self.config.extra.get("beat_type", "beat"))
        perf_ids = self.config.extra.get("perf_ids")
        kits = self.config.extra.get("kits")
        return sorted(
            sid
            for sid, row in self.info.items()
            if row["split"] == split
            and row["beat_type"] in beat_types
            and row.get("audio_filename")
            and (perf_ids is None or row["id"] in set(perf_ids))
            and (kits is None or row["kit_name"] in set(kits))
        )
