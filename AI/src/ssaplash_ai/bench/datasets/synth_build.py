"""합성곡(synth_v1) 제작 로직. scripts/make_synth_songs.py가 호출.

레시피 yaml의 곡 하나 = GMD 연주 하나 + MUSDB18-HQ train 곡의 드럼 없는 구간 하나.
산출물은 mixture.wav, drums.wav, accomp.wav, onsets.csv, meta.yaml.
정답 온셋은 GMD MIDI의 note_on에서 추출. 악기 9종 분류는 Gillick 외 2019년 논문의 매핑.
"""

from __future__ import annotations

import csv
import datetime as dt
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import yaml

from ssaplash_ai.bench.datasets.base import SAMPLE_RATE, match_length, read_audio, write_audio
from ssaplash_ai.bench.datasets.gmd import load_gmd_info, midi_onsets  # noqa: F401 (스크립트 호환)
from ssaplash_ai.bench.datasets.musdb import ACCOMP_STEMS, read_accompaniment_stems
from ssaplash_ai.bench.datasets.synth import ONSET_COLUMNS

# GMD MIDI 피치 → 악기 9종. Roland TD-11 매핑, 출처 Gillick et al., "Learning to Groove", 2019, 표 2.
GMD_PITCH_CLASS: dict[int, str] = {
    36: "kick",
    38: "snare",
    37: "snare",
    40: "snare",
    42: "hihat_closed",
    22: "hihat_closed",
    44: "hihat_closed",
    46: "hihat_open",
    26: "hihat_open",
    43: "tom_low",
    58: "tom_low",
    47: "tom_mid",
    45: "tom_mid",
    50: "tom_high",
    48: "tom_high",
    49: "crash",
    55: "crash",
    57: "crash",
    52: "crash",
    51: "ride",
    59: "ride",
    53: "ride",
}

GMD_SOURCE = "Groove MIDI Dataset v1.0.0 (Google Magenta)"
GMD_LICENSE = "CC BY 4.0"
MUSDB_SOURCE = "MUSDB18-HQ (Zenodo 3338373)"
MUSDB_LICENSE = "교육·연구 목적 전용, 상업 사용 금지"

PEAK_LIMIT = 0.99
EDGE_FADE_MS = 20.0


@dataclass
class SongRecipe:
    """합성곡 한 곡의 재료와 섞는 비율."""

    name: str
    gmd_id: str
    musdb_song: str
    accomp_start_sec: float = 0.0
    duration_sec: float | None = None
    drums_gain_db: float = 0.0
    accomp_gain_db: float = 0.0

    @classmethod
    def from_dict(cls, raw: dict) -> SongRecipe:
        return cls(
            name=str(raw["name"]),
            gmd_id=str(raw["gmd_id"]),
            musdb_song=str(raw["musdb_song"]),
            accomp_start_sec=float(raw.get("accomp_start_sec", 0.0)),
            duration_sec=float(raw["duration_sec"]) if raw.get("duration_sec") else None,
            drums_gain_db=float(raw.get("drums_gain_db", 0.0)),
            accomp_gain_db=float(raw.get("accomp_gain_db", 0.0)),
        )


@dataclass
class Recipe:
    """configs/bench/datasets/synth_v1_recipe.yaml 전체."""

    version: str
    gmd_root: Path
    musdb_root: Path
    output_root: Path
    sample_rate: int
    songs: list[SongRecipe]

    @classmethod
    def from_yaml(cls, path: str | Path) -> Recipe:
        raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
        return cls(
            version=str(raw["version"]),
            gmd_root=Path(raw["gmd_root"]),
            musdb_root=Path(raw["musdb_root"]),
            output_root=Path(raw["output_root"]),
            sample_rate=int(raw.get("sample_rate", SAMPLE_RATE)),
            songs=[SongRecipe.from_dict(s) for s in raw.get("songs") or []],
        )


# ---------- GMD 메타·MIDI ----------


def list_gmd(
    gmd_root: Path,
    style: str | None = None,
    bpm_min: int | None = None,
    bpm_max: int | None = None,
    min_sec: float = 0.0,
    beat_type: str | None = "beat",
) -> list[dict[str, str]]:
    """레시피 후보 필터. 오디오가 있는 연주만 반환."""
    rows = []
    for row in load_gmd_info(gmd_root).values():
        if not row.get("audio_filename"):
            continue
        if beat_type and row["beat_type"] != beat_type:
            continue
        if style and style not in row["style"]:
            continue
        bpm = int(row["bpm"])
        if bpm_min is not None and bpm < bpm_min:
            continue
        if bpm_max is not None and bpm > bpm_max:
            continue
        if float(row["duration"]) < min_sec:
            continue
        rows.append(row)
    return sorted(rows, key=lambda r: (r["style"], int(r["bpm"]), r["id"]))


# ---------- 섞기 ----------


def db_to_gain(db: float) -> float:
    return float(10 ** (db / 20))


def fade_edges(audio: np.ndarray, sample_rate: int, fade_ms: float = EDGE_FADE_MS) -> np.ndarray:
    """잘라 낸 구간의 양 끝을 짧게 페이드해 클릭 제거."""
    n = min(int(sample_rate * fade_ms / 1000), audio.shape[1] // 2)
    if n <= 0:
        return audio
    out = audio.copy()
    ramp = np.linspace(0.0, 1.0, n, dtype=np.float32)
    out[:, :n] *= ramp
    out[:, -n:] *= ramp[::-1]
    return out


def build_song(recipe: Recipe, song: SongRecipe, info: dict[str, dict[str, str]]) -> Path:
    """곡 하나를 만들고 출력 폴더 반환."""
    sr = recipe.sample_rate
    row = info[song.gmd_id]
    if not row.get("audio_filename"):
        raise ValueError(f"GMD 연주 {song.gmd_id}에 오디오 없음")

    drums = read_audio(recipe.gmd_root / row["audio_filename"], sr)
    if song.duration_sec is not None:
        drums = drums[:, : int(round(song.duration_sec * sr))]
    duration = drums.shape[1] / sr

    song_dir = recipe.musdb_root / song.musdb_song
    accomp = read_accompaniment_stems(
        song_dir, sr, clip=(song.accomp_start_sec, song.accomp_start_sec + duration)
    )
    drums, accomp = match_length(drums, accomp)
    duration = drums.shape[1] / sr
    accomp = fade_edges(accomp, sr)

    drums = drums * db_to_gain(song.drums_gain_db)
    accomp = accomp * db_to_gain(song.accomp_gain_db)
    mixture = drums + accomp
    peak = float(np.max(np.abs(mixture))) if mixture.size else 0.0
    scale = PEAK_LIMIT / peak if peak > PEAK_LIMIT else 1.0
    drums, accomp, mixture = drums * scale, accomp * scale, mixture * scale

    out = recipe.output_root / song.name
    out.mkdir(parents=True, exist_ok=True)
    write_audio(out / "mixture.wav", mixture.astype(np.float32), sr)
    write_audio(out / "drums.wav", drums.astype(np.float32), sr)
    write_audio(out / "accomp.wav", accomp.astype(np.float32), sr)

    onsets = [
        (t, pitch, vel)
        for t, pitch, vel in midi_onsets(recipe.gmd_root / row["midi_filename"])
        if t < duration
    ]
    with open(out / "onsets.csv", "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(ONSET_COLUMNS)
        for t, pitch, vel in onsets:
            writer.writerow([f"{t:.6f}", pitch, GMD_PITCH_CLASS.get(pitch, "other"), vel])

    meta = {
        "name": song.name,
        "version": recipe.version,
        "sample_rate": sr,
        "duration_sec": round(duration, 3),
        "onset_count": len(onsets),
        "drums": {
            "source": GMD_SOURCE,
            "license": GMD_LICENSE,
            "gmd_id": song.gmd_id,
            "style": row["style"],
            "bpm": int(row["bpm"]),
            "beat_type": row["beat_type"],
            "time_signature": row["time_signature"],
            "midi_file": row["midi_filename"],
            "audio_file": row["audio_filename"],
            "gain_db": song.drums_gain_db,
        },
        "accomp": {
            "source": MUSDB_SOURCE,
            "license": MUSDB_LICENSE,
            "song": song.musdb_song,
            "stems": list(ACCOMP_STEMS),
            "start_sec": song.accomp_start_sec,
            "gain_db": song.accomp_gain_db,
            "edge_fade_ms": EDGE_FADE_MS,
        },
        "normalize_scale": round(scale, 6),
        "created_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
    }
    (out / "meta.yaml").write_text(
        yaml.safe_dump(meta, allow_unicode=True, sort_keys=False), encoding="utf-8"
    )
    return out


def build_all(recipe: Recipe, only: str | None = None) -> list[Path]:
    info = load_gmd_info(recipe.gmd_root)
    outputs = []
    for song in recipe.songs:
        if only and song.name != only:
            continue
        outputs.append(build_song(recipe, song, info))
    return outputs
