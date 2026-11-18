"""공용 곡 전부 지우고 다시 올리기 스크립트 테스트. 실제 서버 대신 가짜 세션."""

from __future__ import annotations

import importlib.util
import io
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

AI_ROOT = Path(__file__).resolve().parents[2]


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, AI_ROOT / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


br = _load("builtin_reset")
BASE = "https://x.test"
ADMIN = BASE + "/api/v1/admin/songs"


def _flac() -> bytes:
    buf = io.BytesIO()
    sf.write(buf, np.zeros((800, 2), dtype=np.float32), 8000, format="FLAC")
    return buf.getvalue()


class Resp:
    def __init__(self, status: int, body=None, content: bytes = b""):
        self.status_code, self._body, self.content = status, body or {}, content
        self.text = str(self._body)

    def json(self):
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


class Fake:
    """관리자·공개 API 흉내."""

    def __init__(self, songs):
        self.songs = songs
        self.calls = []
        self.next_id = 100

    def _song(self, sid):
        return next(s for s in self.songs if s["id"] == sid)

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append(("GET", url))
        if url == ADMIN:
            return Resp(200, {"items": list(self.songs), "hasNext": False})
        if url.startswith(ADMIN + "/"):
            s = self._song(int(url.rsplit("/", 1)[-1]))
            return Resp(200, {**s, "coverUrl": "https://s3/cover" if s["hasCover"] else None})
        if url.endswith("/accompaniment"):
            sid = int(url.split("/")[-2])
            return Resp(200, {"accompanimentUrl": f"https://s3/acc/{sid}"})
        if url.startswith("https://s3/acc/"):
            assert headers is None  # 서명 URL에는 인증 헤더를 안 붙임
            return Resp(200, content=_flac())
        if url == "https://s3/cover":
            return Resp(200, content=b"\x89PNG\r\n\x1a\n" + b"0" * 10)
        raise AssertionError(url)

    def delete(self, url, headers=None, timeout=None):
        self.calls.append(("DELETE", url))
        self.songs = [s for s in self.songs if s["id"] != int(url.rsplit("/", 1)[-1])]
        return Resp(204)

    def post(self, url, data=None, files=None, headers=None, timeout=None):
        self.calls.append(("POST", url))
        self.next_id += 1
        self.songs.append(
            {
                "id": self.next_id,
                "title": data["title"],
                "artist": data["artist"],
                "hasAccompaniment": False,
                "hasCover": False,
                "published": False,
            }
        )
        assert data["offsetMs"] == "562"
        return Resp(201, {"id": self.next_id})

    def put(self, url, files=None, headers=None, timeout=None):
        self.calls.append(("PUT", url))
        sid = int(url.split("/")[-2])
        if url.endswith("/accompaniment"):
            assert files["file"][0].endswith(".wav")  # flac은 wav로 바꿔 올림
            self._song(sid)["hasAccompaniment"] = True
        else:
            self._song(sid)["hasCover"] = True
        return Resp(200, {})

    def patch(self, url, json=None, headers=None, timeout=None):
        self.calls.append(("PATCH", url))
        self._song(int(url.rsplit("/", 1)[-1]))["published"] = True
        return Resp(200, {})


def test_backup_delete_restore(tmp_path, monkeypatch):
    monkeypatch.setenv(br.TOKEN_ENV, "tok")
    monkeypatch.chdir(AI_ROOT)
    catalog = [
        {
            "title": "Hail To The King",
            "artist": "Avenged Sevenfold",
            "license": "L",
            "midi": "a.mid",
            "offsetMs": 562,
        }
    ]
    monkeypatch.setattr(br, "load_catalog", lambda ref: catalog)
    monkeypatch.setattr(br, "git_show", lambda ref, path: b"MThd")
    fake = Fake(
        [
            {
                "id": 1,
                "title": "Hail To The King",
                "artist": "Avenged Sevenfold",
                "license": "L2",
                "hasAccompaniment": True,
                "hasCover": True,
                "published": True,
            },
            {
                "id": 2,
                "title": "Phoenix",
                "artist": "Netrum, Halvorsen",
                "license": "N",
                "hasAccompaniment": True,
                "hasCover": False,
                "published": True,
            },
            {
                "id": 3,
                "title": "Mystery",
                "artist": "Nobody",
                "license": "X",
                "hasAccompaniment": False,
                "hasCover": False,
                "published": False,
            },
        ]
    )
    b = tmp_path / "bk"
    args = ["--backup", str(b), "--base-url", BASE]

    assert br.main(["backup", *args], session=fake) == 0
    saved = json.loads((b / "backup.json").read_text(encoding="utf-8"))
    assert [r["restore"] for r in saved] == ["catalog", "ncs", "none"]
    assert saved[0]["accompaniment"].endswith(".flac") and saved[0]["cover"].endswith(".png")
    assert saved[1]["accompaniment"] is None  # NCS는 ncs_register로 다시 올려서 안 받음

    # 다시 만들 수 없는 곡(3)이 있으면 멈춤
    assert br.main(["delete-all", *args], session=fake) == 1
    assert not [c for c in fake.calls if c[0] == "DELETE"]
    assert br.main(["delete-all", *args, "--allow-unrestorable"], session=fake) == 0
    assert fake.songs == []

    assert br.main(["restore-catalog", *args], session=fake) == 0
    (song,) = fake.songs
    assert (
        song["title"] == "Hail To The King"
        and song["hasAccompaniment"]
        and song["hasCover"]
        and song["published"]
    )
    # 다시 실행하면 할 일 없음
    fake.calls.clear()
    assert br.main(["restore-catalog", *args], session=fake) == 0
    assert {c[0] for c in fake.calls} == {"GET"}
