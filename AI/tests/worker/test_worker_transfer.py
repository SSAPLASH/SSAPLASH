"""서명 URL 파일 전송 테스트. 표준 라이브러리 http.server를 스레드로 띄워 GET·PUT을 받는다."""

from __future__ import annotations

import hashlib
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
import requests

from ssaplash_ai.worker.transfer import IntegrityError, TransferError, download, sha256_of, upload


class _Storage(BaseHTTPRequestHandler):
    """경로별 바이트 저장소. /forbidden은 403."""

    store: dict[str, bytes] = {}
    puts: list[tuple[str, dict[str, str]]] = []

    def log_message(self, *args) -> None:  # 테스트 출력 조용히
        return None

    def do_GET(self) -> None:
        if self.path == "/forbidden":
            self.send_response(403)
            self.end_headers()
            return
        data = self.store.get(self.path)
        if data is None:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_PUT(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        if self.path == "/forbidden":
            self.send_response(403)
            self.end_headers()
            return
        self.puts.append((self.path, dict(self.headers)))
        self.store[self.path] = body
        self.send_response(200)
        self.end_headers()


@pytest.fixture
def server():
    _Storage.store = {}
    _Storage.puts = []
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), _Storage)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()
    httpd.server_close()


@pytest.fixture
def session():
    with requests.Session() as s:
        yield s


def test_sha256_of(tmp_path: Path):
    p = tmp_path / "a.bin"
    p.write_bytes(b"hello" * 1000)
    assert sha256_of(p) == hashlib.sha256(b"hello" * 1000).hexdigest()


def test_내려받기는_크기와_해시를_검사한다(tmp_path: Path, server: str, session):
    data = bytes(range(256)) * 4096  # 1MiB
    _Storage.store["/song.wav"] = data
    dest = download(
        session,
        f"{server}/song.wav",
        tmp_path / "in" / "song.wav",
        expected_size=len(data),
        expected_sha256=hashlib.sha256(data).hexdigest().upper(),  # 대소문자 무관
        timeout_sec=10,
    )
    assert dest.read_bytes() == data


def test_해시가_다르면_파일을_지우고_IntegrityError(tmp_path: Path, server: str, session):
    _Storage.store["/song.wav"] = b"abc"
    dest = tmp_path / "song.wav"
    with pytest.raises(IntegrityError, match="배정과 다름"):
        download(
            session,
            f"{server}/song.wav",
            dest,
            expected_size=3,
            expected_sha256="0" * 64,
            timeout_sec=10,
        )
    assert not dest.exists()


def test_크기가_다르면_IntegrityError(tmp_path: Path, server: str, session):
    _Storage.store["/song.wav"] = b"abcd"
    with pytest.raises(IntegrityError):
        download(
            session,
            f"{server}/song.wav",
            tmp_path / "song.wav",
            expected_size=3,
            expected_sha256=hashlib.sha256(b"abcd").hexdigest(),
            timeout_sec=10,
        )


def test_403은_TransferError_needs_new_url(tmp_path: Path, server: str, session):
    with pytest.raises(TransferError) as info:
        download(
            session,
            f"{server}/forbidden",
            tmp_path / "x",
            expected_size=1,
            expected_sha256="0" * 64,
            timeout_sec=10,
        )
    assert info.value.status == 403 and info.value.needs_new_url is True
    assert "forbidden" not in str(info.value)  # URL을 메시지에 넣지 않음


def test_올리기는_Content_Type과_Content_Length를_보낸다(tmp_path: Path, server: str, session):
    p = tmp_path / "drums.flac"
    p.write_bytes(b"fLaC" + bytes(5000))
    upload(session, f"{server}/drums", p, timeout_sec=10)
    assert _Storage.store["/drums"] == p.read_bytes()
    path, headers = _Storage.puts[0]
    assert path == "/drums"
    assert headers["Content-Type"] == "audio/flac"
    assert headers["Content-Length"] == str(5004)


def test_올리기_403은_TransferError(tmp_path: Path, server: str, session):
    p = tmp_path / "d.flac"
    p.write_bytes(b"x")
    with pytest.raises(TransferError) as info:
        upload(session, f"{server}/forbidden", p, timeout_sec=10)
    assert info.value.status == 403 and info.value.needs_new_url


def test_연결_오류는_status_None(tmp_path: Path, session):
    with pytest.raises(TransferError) as info:
        download(
            session,
            "http://127.0.0.1:9/none",
            tmp_path / "x",
            expected_size=1,
            expected_sha256="0" * 64,
            timeout_sec=2,
        )
    assert info.value.status is None and "연결 오류" in str(info.value)
