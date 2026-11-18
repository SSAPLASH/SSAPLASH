"""서명 URL로 파일 내려받기·올리기.

- download: GET을 스트리밍으로 디스크에 쓰면서 sha256과 크기를 계산하고, 배정 값과 다르면 IntegrityError.
  다운로드가 잘리거나 스토리지 파일이 바뀐 경우라 호출하는 쪽(job)이 다시 받음
- upload: PUT에 `Content-Type`과 정확한 `Content-Length`로 파일 바이트를 그대로 보냄
- 서명 URL은 비밀이라 로그·예외 메시지에 넣지 않음. 403·만료는 호출하는 쪽(job)이 URL을 다시 발급받음
"""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path

import requests

from ssaplash_ai.chart.errors import summarize_exception

logger = logging.getLogger("ssaplash_ai.worker.transfer")

CHUNK_BYTES = 1024 * 1024
FLAC_CONTENT_TYPE = "audio/flac"


class TransferError(Exception):
    """서명 URL 요청 실패. status가 None이면 연결 오류·시간 초과."""

    def __init__(self, status: int | None, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message

    @property
    def needs_new_url(self) -> bool:
        """403(서명 불일치·만료)이면 같은 역할·fileId·크기로 URL을 다시 받아야 함."""
        return self.status == 403

    def __str__(self) -> str:
        head = f"HTTP {self.status}" if self.status is not None else "연결 오류"
        return f"{head}: {self.message}"


class IntegrityError(Exception):
    """내려받은 파일의 크기나 sha256이 배정 값과 다름. 기대값·실제값을 로그용으로 가짐."""

    def __init__(
        self, expected_size: int, actual_size: int, expected_sha256: str, actual_sha256: str
    ) -> None:
        self.expected_size = expected_size
        self.actual_size = actual_size
        self.expected_sha256 = expected_sha256.lower()
        self.actual_sha256 = actual_sha256.lower()
        super().__init__(
            f"입력 파일 크기 또는 해시가 배정과 다름: 크기 {actual_size} (배정 {expected_size}), "
            f"sha256 {self.actual_sha256[:12]}… (배정 {self.expected_sha256[:12]}…)"
        )


def sha256_of(path: str | Path) -> str:
    """파일 전체의 SHA-256 소문자 16진수."""
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(CHUNK_BYTES), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(
    session: requests.Session,
    url: str,
    dest: str | Path,
    *,
    expected_size: int,
    expected_sha256: str,
    timeout_sec: float,
) -> Path:
    """서명 GET URL → dest 파일. 크기·sha256이 배정과 다르면 파일을 지우고 IntegrityError."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    size = 0
    try:
        with session.get(url, stream=True, timeout=(10.0, timeout_sec)) as response:
            if response.status_code != 200:
                raise TransferError(response.status_code, "내려받기 실패")
            with open(dest, "wb") as f:
                for chunk in response.iter_content(CHUNK_BYTES):
                    if not chunk:
                        continue
                    f.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)
    except (requests.ConnectionError, requests.Timeout) as e:
        dest.unlink(missing_ok=True)
        raise TransferError(None, summarize_exception(e)) from e
    actual = digest.hexdigest()
    if size != expected_size or actual != expected_sha256.lower():
        dest.unlink(missing_ok=True)
        raise IntegrityError(expected_size, size, expected_sha256, actual)
    return dest


def upload(
    session: requests.Session,
    url: str,
    path: str | Path,
    *,
    content_type: str = FLAC_CONTENT_TYPE,
    timeout_sec: float,
) -> None:
    """파일 바이트를 서명 PUT URL에 올림. `Content-Length`는 파일 크기 그대로. 2xx가 아니면 TransferError."""
    path = Path(path)
    size = path.stat().st_size
    headers = {"Content-Type": content_type, "Content-Length": str(size)}
    try:
        with open(path, "rb") as f:
            response = session.put(url, data=f, headers=headers, timeout=(10.0, timeout_sec))
    except (requests.ConnectionError, requests.Timeout) as e:
        raise TransferError(None, summarize_exception(e)) from e
    if not 200 <= response.status_code < 300:
        raise TransferError(response.status_code, "올리기 실패")
    logger.debug("올림: %s (%d바이트)", path.name, size)
