"""MusicXML 드럼 악보 → 채보 JSON. 음원 채보와 같은 `build_chart`·`validate_chart`를 씀.

- 패드: GM 번호를 BE `GmDrumMapping`과 같은 표로 바꿈. 표에 없는 타악기는 빼고 개수만 셈
- 하이햇 페달(44): emit_hihat_pedal이 참이면 HIHAT_PEDAL 노트, 거짓이면 HIHAT으로 합침
- 열린 하이햇: emit_hihat_open이 참이면 노트에 hihat_open_field 필드를 붙임
- timing: bpm은 첫 템포, timeSignature는 첫 박자, offsetMs는 못갖춘마디 길이
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import yaml

from ssaplash_ai.bench.datasets.pads import HITS_DTYPE
from ssaplash_ai.chart.chart_json import build_chart, notes_by_pad, validate_chart
from ssaplash_ai.chart.errors import (
    ChartInputError,
    ChartNoDrumError,
    ChartOutputError,
    summarize_exception,
)
from ssaplash_ai.chart.sheet.drum_map import pad_of
from ssaplash_ai.chart.sheet.musicxml import SheetScore, parse_musicxml
from ssaplash_ai.chart.tempo import TempoEstimate

DEFAULT_SHEET_CONFIG = Path("configs/chart/sheet.yaml")
CHART_FILENAME = "chart.json"
SHEET_SUFFIXES = (".musicxml", ".xml", ".mxl")
SOURCE_METHOD = "musicxml"


@dataclass
class SheetConfig:
    """configs/chart/sheet.yaml."""

    generator_version: str = "sheet-musicxml-1"
    default_bpm: float = 120.0
    max_duration_sec: float = 1800.0
    emit_hihat_pedal: bool = False
    emit_hihat_open: bool = False
    hihat_open_field: str = "hihatOpen"
    schema_version: int = 1

    @classmethod
    def from_yaml(cls, path: str | Path) -> SheetConfig:
        raw = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
        return cls.from_dict(raw)

    @classmethod
    def from_dict(cls, raw: dict) -> SheetConfig:
        known = set(cls.__dataclass_fields__)
        unknown = sorted(set(raw) - known)
        if unknown:
            raise ValueError(f"모르는 악보 설정 필드: {unknown}")
        config = cls(**raw)
        if not 0 < config.default_bpm <= 999:
            raise ValueError(f"default_bpm은 0~999: {config.default_bpm}")
        if config.max_duration_sec <= 0:
            raise ValueError(f"max_duration_sec는 양수: {config.max_duration_sec}")
        return config


@dataclass
class SheetOutput:
    """convert_sheet 결과. chart는 chart.json과 같은 내용."""

    chart_json_path: Path | None
    chart: dict
    n_notes: int
    notes_by_pad: dict[str, int]
    duration_ms: int
    bpm: float
    tempo_found: bool
    time_signature: str
    offset_ms: int
    measures_written: int
    measures_played: int
    dropped: dict[str, int]  # 패드 표에 없어 뺀 GM 번호 → 개수
    n_open_hihat: int
    n_hihat_pedal: int
    generator_version: str
    convert_ms: int

    def to_dict(self) -> dict:
        """결과 메타(sheet.json)용 dict. 채보 본문은 chart.json에 있으므로 뺌."""
        d = asdict(self)
        d.pop("chart")
        d["chart_json_path"] = None if self.chart_json_path is None else str(self.chart_json_path)
        return d


def score_to_hits(
    score: SheetScore, emit_pedal: bool = False
) -> tuple[np.ndarray, list[float], dict[str, int], int]:
    """드럼 음표 → (타격 표, 열린 하이햇 시각 초 목록, 뺀 GM 번호 개수, 페달 개수).

    emit_pedal이 거짓이면 페달은 HIHAT으로 합침."""
    rows: list[tuple[float, str, int]] = []
    open_sec: list[float] = []
    dropped: dict[str, int] = {}
    n_pedal = 0
    for n in score.drum_notes:
        pad = pad_of(n.gm)
        if pad is None:
            dropped[str(n.gm)] = dropped.get(str(n.gm), 0) + 1
            continue
        if pad == "HIHAT_PEDAL":
            n_pedal += 1
            if not emit_pedal:
                pad = "HIHAT"
        elif pad == "HIHAT" and n.is_open:
            open_sec.append(n.onset_sec)
        rows.append((n.onset_sec, pad, n.velocity))
    hits = np.array(sorted(rows), dtype=HITS_DTYPE) if rows else np.zeros(0, HITS_DTYPE)
    return hits, open_sec, dropped, n_pedal


def sheet_tempo(score: SheetScore) -> TempoEstimate:
    """악보 템포 → TempoEstimate. 첫 정마디 시작을 첫 박·첫 마디 첫 박으로 둬서 offsetMs가 못갖춘마디 길이가 됨."""
    origin = int(round(score.pickup_sec * 1000))
    return TempoEstimate(
        bpm=round(score.bpm, 2),
        raw_bpm=score.bpm,
        first_beat_ms=origin,
        first_downbeat_ms=origin,
        n_beats=0,
        time_signature=score.time_signature,
        estimated=True,
        method=SOURCE_METHOD,
    )


def mark_open_hihats(chart: dict, open_sec: list[float], field_name: str) -> int:
    """열린 하이햇 시각과 같은 ms의 HIHAT 노트에 field_name: true를 붙이고 붙인 개수를 돌려줌."""
    open_ms = {int(round(t * 1000)) for t in open_sec}
    n = 0
    for note in chart["charts"][0]["notes"]:
        if note["pad"] == "HIHAT" and note["timeMs"] in open_ms:
            note[field_name] = True
            n += 1
    return n


def convert_sheet(
    path: str | Path, config: SheetConfig | None = None, out_dir: str | Path | None = None
) -> SheetOutput:
    """MusicXML 파일 → 채보 JSON. out_dir가 있으면 chart.json을 씀."""
    config = config or SheetConfig()
    path = Path(path)
    if path.suffix.lower() not in SHEET_SUFFIXES:
        raise ChartInputError(f"MusicXML 파일만 받음 ({', '.join(SHEET_SUFFIXES)}): {path.name}")
    if not path.is_file():
        raise ChartInputError(f"파일이 없음: {path.name}")
    start = time.perf_counter()
    try:
        score = parse_musicxml(path, config.default_bpm)
    except ValueError as e:
        raise ChartInputError(str(e)) from e
    if not any(p.is_drum for p in score.parts):
        raise ChartNoDrumError("드럼 파트가 없음 (음높이 없는 음표나 MIDI 채널 10 파트가 필요)")
    if score.duration_sec > config.max_duration_sec:
        raise ChartInputError(
            f"반복을 펼친 길이 {score.duration_sec:.0f}초가 {config.max_duration_sec:.0f}초를 넘음"
        )
    hits, open_sec, dropped, n_pedal = score_to_hits(score, config.emit_hihat_pedal)
    if len(hits) == 0:
        raise ChartNoDrumError("드럼 파트에 패드로 바꿀 음표가 없음")
    duration_ms = int(round(score.duration_sec * 1000))
    convert_ms = int(round((time.perf_counter() - start) * 1000))
    chart = build_chart(
        hits,
        duration_ms,
        sheet_tempo(score),
        config.generator_version,
        convert_ms,
        schema_version=config.schema_version,
    )
    n_open = len({int(round(t * 1000)) for t in open_sec})
    if config.emit_hihat_open:
        n_open = mark_open_hihats(chart, open_sec, config.hihat_open_field)
    validate_chart(chart, duration_ms)
    chart_path = None
    if out_dir is not None:
        chart_path = Path(out_dir) / CHART_FILENAME
        try:
            chart_path.parent.mkdir(parents=True, exist_ok=True)
            chart_path.write_text(
                json.dumps(chart, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
        except OSError as e:
            raise ChartOutputError(
                f"파일을 쓰지 못함: {chart_path.name} ({summarize_exception(e)})"
            ) from e
    counts = notes_by_pad(chart)
    timing = chart["charts"][0]["timing"]
    return SheetOutput(
        chart_json_path=chart_path,
        chart=chart,
        n_notes=sum(counts.values()),
        notes_by_pad=counts,
        duration_ms=duration_ms,
        bpm=timing["bpm"],
        tempo_found=score.tempo_found,
        time_signature=score.time_signature,
        offset_ms=timing["offsetMs"],
        measures_written=score.measures_written,
        measures_played=score.measures_played,
        dropped=dropped,
        n_open_hihat=n_open,
        n_hihat_pedal=n_pedal,
        generator_version=config.generator_version,
        convert_ms=convert_ms,
    )
