"""NCS 기본곡 관리자 API 일괄 등록 스크립트 테스트. 실제 서버 대신 가짜 세션."""

from __future__ import annotations

import csv
import importlib.util
import sys
from pathlib import Path

AI_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = AI_ROOT / "scripts" / "ncs_register.py"


def _load():
    spec = importlib.util.spec_from_file_location("ncs_register", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["ncs_register"] = module
    spec.loader.exec_module(module)
    return module


reg = _load()


class FakeResponse:
    def __init__(self, status: int, body: dict | None = None):
        self.status_code = status
        self._body = body or {}
        self.text = str(self._body)

    def json(self) -> dict:
        return self._body

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


class FakeSession:
    """관리자 API 흉내. 요청을 calls에 남김."""

    def __init__(self, songs: list[dict] | None = None, fail_auth_on: str | None = None):
        self.songs = list(songs or [])
        self.calls: list[tuple[str, str]] = []
        self.fail_auth_on = fail_auth_on
        self.next_id = 100

    def _auth(self, kind: str):
        return FakeResponse(401) if self.fail_auth_on == kind else None

    def get(self, url, params=None, headers=None, timeout=None):
        assert headers["Authorization"] == "Bearer tok"
        self.calls.append(("GET", url))
        page, size = params["page"], params["size"]
        items = self.songs[page * size : (page + 1) * size]
        return FakeResponse(200, {"items": items, "hasNext": (page + 1) * size < len(self.songs)})

    def post(self, url, data=None, files=None, headers=None, timeout=None):
        self.calls.append(("POST", url))
        if r := self._auth("POST"):
            return r
        assert data["published"] == "false"
        assert files["file"][0].endswith(".mid")
        self.next_id += 1
        self.songs.append(
            {
                "id": self.next_id,
                "title": data["title"],
                "artist": data["artist"],
                "hasAccompaniment": False,
                "published": False,
                "status": "READY",
                "difficulties": ["EASY", "NORMAL", "HARD"],
            }
        )
        return FakeResponse(201, {"id": self.next_id})

    def _song(self, url: str) -> dict:
        sid = int(url.rstrip("/").split("/")[-1 if url[-1].isdigit() else -2])
        return next(s for s in self.songs if s["id"] == sid)

    def put(self, url, files=None, headers=None, timeout=None):
        self.calls.append(("PUT", url))
        if r := self._auth("PUT"):
            return r
        assert files["file"][0].endswith(".wav")
        self._song(url)["hasAccompaniment"] = True
        return FakeResponse(200, {"accompanimentUrl": "u"})

    def patch(self, url, json=None, headers=None, timeout=None):
        self.calls.append(("PATCH", url))
        assert json == {"published": True}
        self._song(url)["published"] = True
        return FakeResponse(200, {})


def _bulk(tmp_path: Path, n: int) -> Path:
    bulk = tmp_path / "bulk"
    bulk.mkdir()
    rows = []
    for i in range(1, n + 1):
        stem = f"ncs_{i:02d} Artist {i} - Title {i}"
        (bulk / f"{stem}.mid").write_bytes(b"MThd")
        (bulk / f"{stem}.wav").write_bytes(b"RIFF")
        rows.append(
            {
                "제목": f"Title {i}",
                "아티스트": f"Artist {i}",
                "MIDI": f"{stem}.mid",
                "드럼리스 MR": f"{stem}.wav",
                "offsetMs": "100",
                "라이선스": "Song: x",
                "공개": "false",
            }
        )
    with open(bulk / "register.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=reg.REGISTER_COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    return bulk


def test_register_new_and_resume(tmp_path, monkeypatch):
    monkeypatch.setenv(reg.TOKEN_ENV, "Bearer tok")
    bulk = _bulk(tmp_path, 3)
    # 2번은 이미 등록됐고 반주 없음, 3번과 제목만 같고 아티스트가 다른 곡은 다른 곡으로 봄
    session = FakeSession(
        [
            {
                "id": 7,
                "title": "Title 2",
                "artist": "Artist 2",
                "hasAccompaniment": False,
                "published": False,
            },
            {
                "id": 8,
                "title": "Title 3",
                "artist": "Someone",
                "hasAccompaniment": True,
                "published": True,
            },
        ]
    )

    assert reg.main(["--bulk", str(bulk)], session=session) == 0

    kinds = [c[0] for c in session.calls]
    assert kinds.count("POST") == 2  # 1번·3번만 새로 등록
    assert kinds.count("PUT") == 3  # 반주는 세 곡 모두
    assert ("PUT", f"{reg.DEFAULT_BASE_URL}{reg.ADMIN_SONGS}/7/accompaniment") in session.calls
    with open(bulk / "register_result.csv", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    assert [r["한 일"] for r in rows] == ["등록, 반주", "이미 등록, 반주", "등록, 반주"]

    # 다시 실행하면 쓰기 요청 없음(반주는 FakeSession이 hasAccompaniment를 안 바꾸므로 직접 표시)
    for s in session.songs:
        s["hasAccompaniment"] = True
    session.calls.clear()
    assert reg.main(["--bulk", str(bulk)], session=session) == 0
    assert {c[0] for c in session.calls} == {"GET"}


def test_dry_run_sends_no_writes(tmp_path, monkeypatch):
    monkeypatch.setenv(reg.TOKEN_ENV, "tok")
    bulk = _bulk(tmp_path, 2)
    session = FakeSession()
    assert reg.main(["--bulk", str(bulk), "--dry-run"], session=session) == 0
    assert {c[0] for c in session.calls} == {"GET"}


def test_auth_failure_stops_with_3(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv(reg.TOKEN_ENV, "tok")
    bulk = _bulk(tmp_path, 2)
    session = FakeSession(fail_auth_on="POST")
    assert reg.main(["--bulk", str(bulk)], session=session) == 3
    assert "이어서" in capsys.readouterr().err
    assert [c[0] for c in session.calls].count("POST") == 1


def test_publish_with_skip(tmp_path, monkeypatch):
    monkeypatch.setenv(reg.TOKEN_ENV, "tok")
    bulk = _bulk(tmp_path, 3)
    session = FakeSession(
        [
            {
                "id": 1,
                "title": "Title 1",
                "artist": "Artist 1",
                "hasAccompaniment": True,
                "published": False,
            },
            {
                "id": 2,
                "title": "Title 2",
                "artist": "Artist 2",
                "hasAccompaniment": True,
                "published": True,
            },
            {
                "id": 3,
                "title": "Title 3",
                "artist": "Artist 3",
                "hasAccompaniment": True,
                "published": False,
            },
        ]
    )
    assert reg.main(["--bulk", str(bulk), "--publish", "--skip", "3"], session=session) == 0
    assert [c for c in session.calls if c[0] == "PATCH"] == [
        ("PATCH", f"{reg.DEFAULT_BASE_URL}{reg.ADMIN_SONGS}/1")
    ]


def test_missing_token_returns_1(tmp_path, monkeypatch):
    monkeypatch.delenv(reg.TOKEN_ENV, raising=False)
    assert reg.main(["--bulk", str(_bulk(tmp_path, 1))], session=FakeSession()) == 1


def test_all_registers_verifies_then_publishes(tmp_path, monkeypatch):
    monkeypatch.setenv(reg.TOKEN_ENV, "tok")
    bulk = _bulk(tmp_path, 3)
    # 3번은 이미 등록됐지만 난이도가 하나뿐이라 확인에서 걸려 공개하지 않음
    session = FakeSession(
        [
            {
                "id": 9,
                "title": "Title 3",
                "artist": "Artist 3",
                "hasAccompaniment": True,
                "published": False,
                "status": "READY",
                "difficulties": ["NORMAL"],
            }
        ]
    )

    assert reg.main(["--bulk", str(bulk), "--all"], session=session) == 2

    patched = [c[1].rsplit("/", 1)[-1] for c in session.calls if c[0] == "PATCH"]
    assert patched == ["101", "102"]
    with open(bulk / "register_result.csv", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    assert [r["확인"] for r in rows] == ["ok", "ok", "난이도 없음 EASY,HARD"]
    assert [r["공개"] for r in rows] == ["공개", "공개", "건너뜀(--skip)"]


def test_replace_fixed_deletes_then_registers(tmp_path, monkeypatch):
    monkeypatch.setenv(reg.TOKEN_ENV, "tok")
    bulk = _bulk(tmp_path, 2)
    with open(bulk / "check.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["곡", "bpm 고침"], lineterminator="\n")
        w.writeheader()
        w.writerow({"곡": "ncs_01 Artist 1 - Title 1", "bpm 고침": ""})
        w.writerow({"곡": "ncs_02 Artist 2 - Title 2", "bpm 고침": "86.94→87"})
    done = {"status": "READY", "difficulties": ["EASY", "NORMAL", "HARD"], "hasAccompaniment": True}
    session = FakeSession(
        [
            {"id": 1, "title": "Title 1", "artist": "Artist 1", "published": True, **done},
            {"id": 2, "title": "Title 2", "artist": "Artist 2", "published": True, **done},
        ]
    )

    def delete(url, headers=None, timeout=None):
        session.calls.append(("DELETE", url))
        session.songs = [s for s in session.songs if not url.endswith(f"/{s['id']}")]
        return FakeResponse(204)

    session.delete = delete
    assert reg.main(["--bulk", str(bulk), "--all", "--replace-fixed"], session=session) == 0
    kinds = [(k, u.rsplit("/", 2)[-2:]) for k, u in session.calls if k != "GET"]
    assert kinds[0] == ("DELETE", ["songs", "2"])
    assert [k for k, _ in kinds] == ["DELETE", "POST", "PUT", "PATCH"]
