"""비식별 내보내기 뷰(`coach_export_v`) 읽기와 허용 필드 검증.

뷰는 BE가 정의하는 허용 목록이다. 여기서도 한 번 더 확인해서 **허용 목록 밖의 열이 하나라도 있으면 데이터를 읽지 않고 실패**한다
(뷰가 잘못 바뀐 경우의 이중 방어). 오류 메시지에는 열 이름만 담고 값은 담지 않는다.

읽기 대상은 `RowSource` 인터페이스 뒤에 둔다. 시험은 합성 행으로, 실제 실행은 `PostgresViewSource`로 한다.
"""

from __future__ import annotations

import os
import re
from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

# 뷰가 내보내도 되는 열 전부(BE 요청 문서의 허용 목록). 이 밖의 열은 거부한다.
SESSION_COLUMNS = (
    "session_key",
    "mode",
    "input_source",
    "song_ref",
    "song_origin",
    "difficulty",
    "perfect_ms",
    "good_ms",
    "played_date",
    "payload_schema_version",
)
HIT_COLUMNS = (
    "seq",
    "t_ms",
    "stick_id",
    "pad",
    "velocity",
    "peak_accel",
    "judgement",
    "matched_note_id",
    "delta_ms",
)
ALLOWED_COLUMNS = SESSION_COLUMNS + HIT_COLUMNS

# BE가 아직 확인 중인 열은 없어도 된다(난이도 경로 확인 대기). 나머지는 반드시 있어야 한다.
OPTIONAL_COLUMNS = frozenset({"difficulty"})
REQUIRED_COLUMNS = tuple(c for c in ALLOWED_COLUMNS if c not in OPTIONAL_COLUMNS)

DSN_ENV = "SSAPLASH_COACH_EXPORT_DSN"
DEFAULT_VIEW = "coach_export_v"
_IDENTIFIER = re.compile(r"^[a-z_][a-z0-9_]*$")


class ExportSchemaError(Exception):
    """뷰의 열 구성이 계약과 다르다. 열 이름만 담는다."""

    def __init__(self, message: str, columns: Sequence[str]) -> None:
        super().__init__(f"{message}: {', '.join(columns)}")
        self.columns = tuple(columns)


class DisallowedColumnError(ExportSchemaError):
    pass


class MissingColumnError(ExportSchemaError):
    pass


class RowSource(Protocol):
    def columns(self) -> Sequence[str]:
        """뷰의 열 이름. 데이터를 읽지 않고 구한다."""

    def rows(self) -> Iterator[Mapping[str, Any]]:
        """허용 열만 담은 행. `session_key`, `seq` 순으로 온다."""


@dataclass
class Session:
    """세션 한 개와 그 타격들. 비식별 상태라 신원 값이 없다."""

    session_key: str
    mode: str
    input_source: str
    song_ref: int | None
    song_origin: str | None
    difficulty: str | None
    perfect_ms: float
    good_ms: float
    played_date: Any
    schema_version: int | None
    hits: list[dict[str, Any]] = field(default_factory=list)
    # 같은 세션의 행들이 세션 값을 서로 다르게 말하면 손상으로 본다(제외 단계에서 거른다)
    inconsistent: bool = False

    def to_request(self) -> dict[str, Any]:
        """`ssaplash_ai.coach.analyze()`가 받는 요청 형식으로 바꾼다."""
        return {
            "playId": self.session_key,
            "mode": self.mode,
            "difficulty": self.difficulty,
            "timingWindows": {"perfectMs": self.perfect_ms, "goodMs": self.good_ms},
            "hits": [
                {
                    "seq": h["seq"],
                    "tMs": h["t_ms"],
                    "stickId": h["stick_id"],
                    "pad": h["pad"],
                    "velocity": h["velocity"],
                    "peakAccel": h["peak_accel"],
                    "judgement": h["judgement"],
                    "matchedNoteId": h["matched_note_id"],
                    "deltaMs": h["delta_ms"],
                }
                for h in self.hits
            ],
        }


def check_columns(columns: Iterable[str]) -> None:
    """허용 목록 밖의 열이 있거나 필수 열이 없으면 실패한다."""
    names = list(columns)
    extra = sorted(set(names) - set(ALLOWED_COLUMNS))
    if extra:
        raise DisallowedColumnError("허용 목록 밖의 열이 있다", extra)
    missing = [c for c in REQUIRED_COLUMNS if c not in names]
    if missing:
        raise MissingColumnError("필수 열이 없다", missing)


def read_sessions(source: RowSource) -> list[Session]:
    """뷰의 행을 세션 단위로 묶는다. 열을 먼저 검사하고, 통과해야만 행을 읽는다."""
    check_columns(source.columns())

    sessions: dict[str, Session] = {}
    for row in source.rows():
        key = row["session_key"]
        session = sessions.get(key)
        head = _session_values(row)
        if session is None:
            session = sessions[key] = Session(**head)
        elif _session_values(row) != _head_of(session):
            session.inconsistent = True
        session.hits.append({c: row.get(c) for c in HIT_COLUMNS})

    for session in sessions.values():
        session.hits.sort(key=lambda h: (h["seq"] is None, h["seq"]))
    return list(sessions.values())


def _session_values(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "session_key": row["session_key"],
        "mode": row.get("mode"),
        "input_source": row.get("input_source"),
        "song_ref": row.get("song_ref"),
        "song_origin": row.get("song_origin"),
        "difficulty": row.get("difficulty"),
        "perfect_ms": row.get("perfect_ms"),
        "good_ms": row.get("good_ms"),
        "played_date": row.get("played_date"),
        "schema_version": row.get("payload_schema_version"),
    }


def _head_of(session: Session) -> dict[str, Any]:
    return {
        "session_key": session.session_key,
        "mode": session.mode,
        "input_source": session.input_source,
        "song_ref": session.song_ref,
        "song_origin": session.song_origin,
        "difficulty": session.difficulty,
        "perfect_ms": session.perfect_ms,
        "good_ms": session.good_ms,
        "played_date": session.played_date,
        "schema_version": session.schema_version,
    }


class ListSource:
    """메모리의 행을 읽는 출처. 시험과 뷰 모사에 쓴다."""

    def __init__(self, rows: Sequence[Mapping[str, Any]], columns: Sequence[str] | None = None):
        self._rows = list(rows)
        self._columns = tuple(columns) if columns is not None else _union_columns(self._rows)

    def columns(self) -> Sequence[str]:
        return self._columns

    def rows(self) -> Iterator[Mapping[str, Any]]:
        yield from self._rows


def _union_columns(rows: Sequence[Mapping[str, Any]]) -> tuple[str, ...]:
    seen: dict[str, None] = {}
    for row in rows:
        for key in row:
            seen.setdefault(key)
    return tuple(seen)


class PostgresViewSource:
    """읽기 전용 DB 계정으로 뷰를 읽는다.

    접속 문자열은 환경 변수 `SSAPLASH_COACH_EXPORT_DSN`에서 받고 로그·오류에 쓰지 않는다.
    연결은 읽기 전용이고 질의 시간 제한이 있다. 뷰에서 허용 열만 골라 `session_key`, `seq` 순으로 읽는다.
    """

    def __init__(
        self,
        dsn: str | None = None,
        view: str = DEFAULT_VIEW,
        connect: Callable[[], Any] | None = None,
        statement_timeout_ms: int = 120_000,
    ) -> None:
        if not _IDENTIFIER.match(view):
            raise ValueError("뷰 이름 형식이 올바르지 않다")
        self._view = view
        self._connect = connect or self._default_connect(dsn, statement_timeout_ms)

    @staticmethod
    def _default_connect(dsn: str | None, timeout_ms: int) -> Callable[[], Any]:
        resolved = dsn or os.environ.get(DSN_ENV)
        if not resolved:
            raise RuntimeError(f"접속 문자열이 없다(환경 변수 {DSN_ENV})")

        def connect() -> Any:
            import psycopg

            return psycopg.connect(
                resolved,
                application_name="coach-calibration",
                options=f"-c statement_timeout={int(timeout_ms)}",
            )

        return connect

    def columns(self) -> Sequence[str]:
        conn = self._open()
        try:
            with conn.cursor() as cur:
                cur.execute(f"SELECT * FROM {self._view} LIMIT 0")  # 뷰 이름은 생성자에서 검증됨
                return [d.name for d in cur.description]
        finally:
            conn.close()

    def rows(self) -> Iterator[Mapping[str, Any]]:
        present = set(self.columns())
        names = [c for c in ALLOWED_COLUMNS if c in present]
        select = ", ".join(names)
        conn = self._open()
        try:
            with conn.cursor(name="coach_export_read") as cur:
                cur.itersize = 5000
                cur.execute(f"SELECT {select} FROM {self._view} ORDER BY session_key, seq")
                for values in cur:
                    yield dict(zip(names, values, strict=True))
        finally:
            conn.close()

    def _open(self) -> Any:
        conn = self._connect()
        conn.read_only = True
        return conn
