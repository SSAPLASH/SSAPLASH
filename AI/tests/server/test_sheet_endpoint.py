"""POST /chart/sheet — BE가 MusicXML 업로드 때 동기로 부르는 변환 엔드포인트(S15P31A307-293, BE 설계 3-3절).

본문은 파일 바이트 그대로, 파일 이름은 쿼리 name. 변환 로직은 chart/sheet/convert.py 그대로 쓰고 여기서는
HTTP 모양·오류 코드·임시 파일 정리·본문 미로그만 본다.
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ssaplash_ai.server import sheet as sheet_router
from ssaplash_ai.server.app import app

DIVISIONS = 4
DRUMS = {"kick": 37, "snare": 39, "hh": 43}
OCTET = {"Content-Type": "application/octet-stream"}


def note(inst: str, dur: int = DIVISIONS) -> str:
    return (
        "<note><unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched>"
        f'<duration>{dur}</duration><instrument id="{inst}"/></note>'
    )


def score(*bodies: str, drum: bool = True, root: str = "score-partwise") -> str:
    insts = "".join(
        f'<score-instrument id="{k}"><instrument-name>{k}</instrument-name></score-instrument>'
        for k in DRUMS
    )
    midi = "".join(
        f'<midi-instrument id="{k}"><midi-channel>10</midi-channel><midi-unpitched>{v}</midi-unpitched></midi-instrument>'
        for k, v in DRUMS.items()
    )
    if not drum:
        insts = midi = ""
    attrs = (
        f"<attributes><divisions>{DIVISIONS}</divisions><time><beats>4</beats><beat-type>4</beat-type></time>"
        "<clef><sign>percussion</sign></clef></attributes>"
    )
    tempo = '<direction><sound tempo="120"/></direction>'
    measures = "".join(
        f'<measure number="{i + 1}">{attrs if i == 0 else ""}{tempo if i == 0 else ""}{body}</measure>'
        for i, body in enumerate(bodies)
    )
    return (
        f'<?xml version="1.0" encoding="UTF-8"?><{root} version="4.0"><part-list>'
        f'<score-part id="P1"><part-name>Drumset</part-name>{insts}{midi}</score-part></part-list>'
        f'<part id="P1">{measures}</part></{root}>'
    )


BASIC = score(note("kick") + note("snare") + note("kick") + note("snare"), note("hh") * 4)


def mxl(xml: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>',
        )
        z.writestr("score.xml", xml)
    return buf.getvalue()


def post(client: TestClient, body: bytes, name: str | None = "s.musicxml"):
    params = {} if name is None else {"name": name}
    return client.post("/chart/sheet", params=params, content=body, headers=OCTET)


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(sheet_router, "TMP_ROOT", tmp_path)
    return TestClient(app)


def test_MusicXML을_올리면_chart와_sheet를_돌려주고_임시_파일을_지운다(
    client: TestClient, tmp_path: Path
):
    r = post(client, BASIC.encode("utf-8"))
    assert r.status_code == 200, r.text
    body = r.json()
    chart, sheet = body["chart"], body["sheet"]
    # 음원 워커 결과와 같은 모양(BE WorkerResults가 그대로 받는다)
    assert chart["schemaVersion"] == 1
    assert chart["generator"] == "ADT_MODEL"
    assert chart["generatorVersion"] == "sheet-musicxml-3"  # configs/chart/sheet.yaml
    assert chart["charts"][0]["difficulty"] == "NORMAL"
    assert chart["charts"][0]["notationStatus"] == "UNAVAILABLE"
    pads = [n["pad"] for n in chart["charts"][0]["notes"]]
    assert pads.count("KICK") == 2 and pads.count("SNARE") == 2 and pads.count("HIHAT") == 4
    assert chart["charts"][0]["timing"]["bpm"] == 120
    assert chart["charts"][0]["timing"]["offsetMs"] == 0
    # 변환 메타. 파일 경로는 내보내지 않는다
    assert sheet["duration_ms"] == 4000
    assert sheet["n_notes"] == 8
    assert sheet["measures_played"] == 2
    assert "chart_json_path" not in sheet
    assert list(tmp_path.iterdir()) == []


def test_mxl_압축_파일도_받는다(client: TestClient):
    r = post(client, mxl(BASIC), "s.mxl")
    assert r.status_code == 200, r.text
    assert r.json()["sheet"]["n_notes"] == 8


@pytest.mark.parametrize(
    ("name", "body", "message"),
    [
        ("s.pdf", BASIC.encode("utf-8"), "MusicXML"),
        ("s.musicxml", score(note("kick"), root="score-timewise").encode("utf-8"), "timewise"),
        ("s.mxl", b"PK\x03\x04garbage", "읽을 수 없음"),
        ("s.musicxml", b"<score-partwise><part", "읽을 수 없음"),
        ("s.musicxml", b"", ""),
    ],
)
def test_못_읽는_입력은_400_INPUT_INVALID(client: TestClient, name: str, body: bytes, message: str):
    r = post(client, body, name)
    assert r.status_code == 400, r.text
    assert r.json()["error"] == "INPUT_INVALID"
    assert message in r.json()["message"]


def test_name이_없으면_400(client: TestClient):
    r = post(client, BASIC.encode("utf-8"), None)
    assert r.status_code == 400
    assert r.json()["error"] == "INPUT_INVALID"


def test_드럼_파트가_없으면_422_NO_DRUM_NOTES(client: TestClient):
    # 쉼표만 있고 악기 정보도 채널 10도 없는 파트는 드럼이 아니다(unpitched 음표가 있으면 표준 기보 위치로 드럼으로 읽는다)
    rest_only = f"<note><rest/><duration>{DIVISIONS * 4}</duration></note>"
    r = post(client, score(rest_only, drum=False).encode("utf-8"))
    assert r.status_code == 422, r.text
    assert r.json()["error"] == "NO_DRUM_NOTES"
    assert "드럼" in r.json()["message"]


def test_5MiB를_넘으면_413(client: TestClient):
    r = post(client, b"x" * (5 * 1024 * 1024 + 1))
    assert r.status_code == 413
    assert r.json()["error"] == "BODY_TOO_LARGE"


def test_악보_본문은_로그에_남지_않는다(client: TestClient, capsys: pytest.CaptureFixture[str]):
    post(client, BASIC.encode("utf-8"))
    post(client, score(note("kick"), root="score-timewise").encode("utf-8"))
    out = capsys.readouterr().out
    assert "score-partwise" not in out and "score-timewise" not in out
    assert "sheet" in out  # 요약 한 줄은 남긴다
