"""MusicXML 드럼 악보 → 채보 테스트. 테스트가 직접 쓰는 짧은 MusicXML만 사용."""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest

from ssaplash_ai.chart.chart_json import validate_chart
from ssaplash_ai.chart.cli import main
from ssaplash_ai.chart.errors import ChartInputError
from ssaplash_ai.chart.sheet import SheetConfig, convert_sheet, pad_of, parse_musicxml

# 드럼 악기: id → midi-unpitched(GM 번호 + 1)
DRUMS = {"kick": 37, "snare": 39, "hh": 43, "ohh": 47, "pedal": 45, "shaker": 71}
DIVISIONS = 4  # 4분음표 = 4, 8분음표 = 2


def note(inst: str, dur: int = DIVISIONS, chord: bool = False, extra: str = "") -> str:
    return (
        f"<note>{'<chord/>' if chord else ''}<unpitched><display-step>C</display-step>"
        f"<display-octave>5</display-octave></unpitched><duration>{dur}</duration>"
        f'<instrument id="{inst}"/>{extra}</note>'
    )


def rest(dur: int = DIVISIONS * 4) -> str:
    return f"<note><rest/><duration>{dur}</duration></note>"


def measure(number: int, body: str, attrs: str = "", head: str = "", implicit: bool = False) -> str:
    imp = ' implicit="yes"' if implicit else ""
    attributes = f"<attributes>{attrs}</attributes>" if attrs else ""
    return f'<measure number="{number}"{imp}>{head}{attributes}{body}</measure>'


FIRST_ATTRS = (
    f"<divisions>{DIVISIONS}</divisions><time><beats>4</beats><beat-type>4</beat-type></time>"
    "<clef><sign>percussion</sign></clef>"
)
TEMPO_120 = '<direction><sound tempo="120"/></direction>'


def score(*measures: str, drum: bool = True) -> str:
    insts = "".join(
        f'<score-instrument id="{k}"><instrument-name>{k}</instrument-name></score-instrument>'
        for k in DRUMS
    )
    midi = "".join(
        f'<midi-instrument id="{k}"><midi-channel>10</midi-channel><midi-unpitched>{v}</midi-unpitched>'
        "</midi-instrument>"
        for k, v in DRUMS.items()
    )
    if not drum:
        insts = midi = ""
    return (
        '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list>'
        f'<score-part id="P1"><part-name>Drumset</part-name>{insts}{midi}</score-part></part-list>'
        f'<part id="P1">{"".join(measures)}</part></score-partwise>'
    )


def write(tmp_path: Path, xml: str, name: str = "s.musicxml") -> Path:
    path = tmp_path / name
    path.write_text(xml, encoding="utf-8")
    return path


BASIC = score(
    measure(
        1,
        note("kick", 2)
        + note("hh", 2, chord=True)
        + note("ohh", 2)
        + note("snare", 2)
        + note("pedal", 2, chord=True)
        + note("hh", 2, extra='<notehead parentheses="yes">x</notehead>')
        + note("shaker", 2)
        + note("kick", 6),  # 마디를 채워 4박(2초)
        FIRST_ATTRS,
        TEMPO_120,
    )
)


def test_드럼_음표를_시각_패드_열림으로_읽는다(tmp_path: Path):
    s = parse_musicxml(write(tmp_path, BASIC))
    got = [(round(n.onset_sec, 3), n.gm, n.is_open) for n in s.drum_notes]
    assert got == [
        (0.0, 36, None),
        (0.0, 42, False),
        (0.25, 46, True),
        (0.5, 38, None),
        (0.5, 44, None),
        (0.75, 42, False),
        (1.0, 70, None),
        (1.25, 36, None),
    ]
    assert s.bpm == 120 and s.tempo_found and s.time_signature == "4/4"
    assert s.duration_sec == pytest.approx(2.0)


def test_채보_JSON은_페달을_하이햇에_합치고_없는_타악기는_뺀다(tmp_path: Path):
    out = convert_sheet(write(tmp_path, BASIC))
    notes = out.chart["charts"][0]["notes"]
    assert [(n["timeMs"], n["pad"]) for n in notes] == [
        (0, "KICK"),
        (0, "HIHAT"),
        (250, "HIHAT"),
        (500, "SNARE"),
        (500, "HIHAT"),
        (750, "HIHAT"),
        (1250, "KICK"),
    ]
    assert notes[5]["velocityHint"] == 40  # 괄호 친 고스트 노트
    assert notes[0]["velocityHint"] == 90
    assert out.dropped == {"70": 1}
    assert out.n_hihat_pedal == 1 and out.n_open_hihat == 1
    assert all("hihatOpen" not in n for n in notes)
    assert out.chart["generator"] == "ADT_MODEL"
    assert out.chart["generatorVersion"] == "sheet-musicxml-1"
    assert out.chart["charts"][0]["timing"] == {"bpm": 120.0, "offsetMs": 0, "timeSignature": "4/4"}
    validate_chart(out.chart, out.duration_ms)


def test_emit_hihat_open이면_열린_하이햇에만_필드를_붙인다(tmp_path: Path):
    out = convert_sheet(write(tmp_path, BASIC), SheetConfig(emit_hihat_open=True))
    flagged = [n["timeMs"] for n in out.chart["charts"][0]["notes"] if n.get("hihatOpen")]
    assert flagged == [250]
    validate_chart(out.chart, out.duration_ms)


def test_emit_hihat_pedal이면_페달을_HIHAT_PEDAL로_낸다(tmp_path: Path):
    out = convert_sheet(write(tmp_path, BASIC), SheetConfig(emit_hihat_pedal=True))
    notes = out.chart["charts"][0]["notes"]
    assert [(n["timeMs"], n["pad"]) for n in notes if n["timeMs"] == 500] == [
        (500, "SNARE"),
        (500, "HIHAT_PEDAL"),
    ]
    assert out.n_hihat_pedal == 1 and out.notes_by_pad["HIHAT_PEDAL"] == 1
    validate_chart(out.chart, out.duration_ms)


def test_두_설정을_켜면_하이햇을_세_가지로_나눈다(tmp_path: Path):
    config = SheetConfig(emit_hihat_pedal=True, emit_hihat_open=True)
    out = convert_sheet(write(tmp_path, BASIC), config)
    hats = [
        (n["timeMs"], n["pad"], n.get("hihatOpen", False))
        for n in out.chart["charts"][0]["notes"]
        if n["pad"] in ("HIHAT", "HIHAT_PEDAL")
    ]
    # 0ms 닫힘, 250ms 열림, 500ms 페달만, 750ms 닫힘
    assert hats == [
        (0, "HIHAT", False),
        (250, "HIHAT", True),
        (500, "HIHAT_PEDAL", False),
        (750, "HIHAT", False),
    ]
    validate_chart(out.chart, out.duration_ms)


def test_서비스_설정은_페달과_열린_하이햇을_모두_낸다(tmp_path: Path):
    config = SheetConfig.from_yaml(Path(__file__).resolve().parents[2] / "configs/chart/sheet.yaml")
    out = convert_sheet(write(tmp_path, BASIC), config)
    notes = out.chart["charts"][0]["notes"]
    assert out.chart["generatorVersion"] == "sheet-musicxml-3"
    assert [n["timeMs"] for n in notes if n["pad"] == "HIHAT_PEDAL"] == [500]
    assert [n["timeMs"] for n in notes if n.get("hihatOpen")] == [250]
    validate_chart(out.chart, out.duration_ms)


def test_technical_표시가_GM_번호보다_먼저다(tmp_path: Path):
    xml = score(
        measure(
            1,
            note("hh", 8, extra="<notations><technical><open/></technical></notations>")
            + note("ohh", 8, extra="<notations><technical><stopped/></technical></notations>"),
            FIRST_ATTRS,
        )
    )
    assert [n.is_open for n in parse_musicxml(write(tmp_path, xml)).drum_notes] == [True, False]


def test_도돌이표를_펼친다(tmp_path: Path):
    xml = score(
        measure(
            1,
            note("kick", 16),
            FIRST_ATTRS,
            TEMPO_120 + '<barline location="left"><repeat direction="forward"/></barline>',
        ),
        measure(
            2,
            note("snare", 16)
            + '<barline location="right"><repeat direction="backward"/></barline>',
        ),
        measure(3, note("kick", 16)),
    )
    s = parse_musicxml(write(tmp_path, xml))
    assert (s.measures_written, s.measures_played) == (3, 5)
    assert [round(n.onset_sec, 3) for n in s.drum_notes] == [0.0, 2.0, 4.0, 6.0, 8.0]


def test_못갖춘마디_길이가_offsetMs가_된다(tmp_path: Path):
    xml = score(
        measure(0, note("snare", 4), FIRST_ATTRS, TEMPO_120, implicit=True),
        measure(1, note("kick", 16)),
    )
    out = convert_sheet(write(tmp_path, xml))
    assert out.offset_ms == 500
    assert [n["timeMs"] for n in out.chart["charts"][0]["notes"]] == [0, 500]


def test_마디_반복_기호는_앞_마디를_복사한다(tmp_path: Path):
    repeat_on = '<measure-style><measure-repeat type="start">1</measure-repeat></measure-style>'
    repeat_off = '<measure-style><measure-repeat type="stop"/></measure-style>'
    xml = score(
        measure(1, note("kick", 8) + note("snare", 8), FIRST_ATTRS, TEMPO_120),
        measure(2, rest(), repeat_on),
        measure(3, note("hh", 16), repeat_off),
    )
    s = parse_musicxml(write(tmp_path, xml))
    assert [(round(n.onset_sec, 3), n.gm) for n in s.drum_notes] == [
        (0.0, 36),
        (1.0, 38),
        (2.0, 36),
        (3.0, 38),
        (4.0, 42),
    ]


def test_mxl_압축_파일을_읽는다(tmp_path: Path):
    path = tmp_path / "s.mxl"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(
            "META-INF/container.xml",
            '<container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>',
        )
        z.writestr("score.musicxml", BASIC)
    assert convert_sheet(path).n_notes == 7


@pytest.mark.parametrize(
    ("name", "xml", "message"),
    [
        ("s.musicxml", score(measure(1, rest(), FIRST_ATTRS), drum=False), "드럼 파트가 없음"),
        (
            "s.musicxml",
            score(measure(1, note("shaker", 16), FIRST_ATTRS)),
            "패드로 바꿀 음표가 없음",
        ),
        ("s.musicxml", "<score-partwise><part", "읽을 수 없음"),
        ("s.pdf", BASIC, "MusicXML 파일만"),
    ],
)
def test_못_바꾸는_입력은_ChartInputError(tmp_path: Path, name: str, xml: str, message: str):
    with pytest.raises(ChartInputError, match=message):
        convert_sheet(write(tmp_path, xml, name))


def test_패드_표는_BE_GmDrumMapping과_같다():
    assert [
        pad_of(p) for p in (35, 36, 37, 40, 22, 26, 42, 46, 44, 48, 50, 45, 47, 41, 43, 58)
    ] == [
        "KICK",
        "KICK",
        "SNARE",
        "SNARE",
        "HIHAT",
        "HIHAT",
        "HIHAT",
        "HIHAT",
        "HIHAT_PEDAL",
        "SMALL_TOM",
        "SMALL_TOM",
        "MID_TOM",
        "MID_TOM",
        "FLOOR_TOM",
        "FLOOR_TOM",
        "FLOOR_TOM",
    ]
    assert [pad_of(p) for p in (49, 52, 55, 57, 51, 53, 59, 54, 70, None)] == [
        "CRASH",
        "CRASH",
        "CRASH",
        "CRASH",
        "RIDE",
        "RIDE",
        "RIDE",
        None,
        None,
        None,
    ]


def test_sheet_명령은_chart와_sheet_json을_쓴다(tmp_path: Path, capsys):
    out_dir = tmp_path / "out"
    assert main(["sheet", str(write(tmp_path, BASIC)), "--out", str(out_dir)]) == 0
    chart = json.loads((out_dir / "chart.json").read_text(encoding="utf-8"))
    meta = json.loads((out_dir / "sheet.json").read_text(encoding="utf-8"))
    assert len(chart["charts"][0]["notes"]) == 7
    assert meta["n_hihat_pedal"] == 1 and "chart" not in meta
    assert "노트 7개" in capsys.readouterr().out


def test_sheet_명령은_입력_오류면_종료_코드_2(tmp_path: Path):
    bad = write(tmp_path, score(measure(1, rest(), FIRST_ATTRS), drum=False))
    assert main(["sheet", str(bad), "--out", str(tmp_path / "out")]) == 2


def test_설정에_모르는_필드가_있으면_오류():
    with pytest.raises(ValueError, match="모르는 악보 설정 필드"):
        SheetConfig.from_dict({"swing": True})
