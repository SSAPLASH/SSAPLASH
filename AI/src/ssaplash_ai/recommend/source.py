"""운영 배치의 입력: BE 읽기 뷰(`recommend_*_v`)를 메모리에서 표로 읽는다(설계 문서 부록 C.3·C.5).

내보낸 데이터는 파일로 남기지 않는다. 표는 문자열 열로 만들어 `data.dataset_from_frames`가 CSV 입력과 같은 규칙으로 검증한다.
뷰는 BE가 정한 허용 목록이고, 여기서도 행을 읽기 전에 열 이름을 확인한다. 허용 밖의 열이 있으면 행을 읽지 않고 멈춘다.
접속 문자열과 값은 로그·오류에 쓰지 않는다.
"""

from __future__ import annotations

import json
import math
import os
import re
from collections.abc import Callable, Mapping
from dataclasses import fields
from datetime import date, datetime
from typing import Any, Protocol

import pandas as pd

from ssaplash_ai.recommend import schema as S
from ssaplash_ai.recommend.data import DataError, check_columns
from ssaplash_ai.recommend.simulate import SimConfig, SyntheticData, generate

DSN_ENV = "SSAPLASH_RECOMMEND_EXPORT_DSN"

# 표 이름 → 뷰 이름. 필수 뷰는 없으면 멈추고, 메타데이터 뷰는 BE가 추가하기 전까지 없어도 된다.
REQUIRED_VIEWS = {
    "users": "recommend_users_v",
    "songs": "recommend_songs_v",
    "chart_features": "recommend_chart_features_v",
    "interactions": "recommend_interactions_v",
}
OPTIONAL_VIEWS = {"song_meta": "recommend_song_meta_v"}
_IDENTIFIER = re.compile(r"^[a-z_][a-z0-9_]*$")


class ExportSource(Protocol):
    def frames(self) -> dict[str, pd.DataFrame]:
        """표 이름 → 문자열 열 표. 표 이름은 `schema.FILES`의 키다."""


def to_text(value: Any) -> str:
    """값 하나를 CSV에 쓴 것과 같은 문자열로 바꾼다. 비어 있는 값은 빈 문자열이다."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, dict | list):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, datetime | date):
        return value.isoformat()
    return str(value)


def text_frame(columns: list[str], rows: list[tuple[Any, ...]]) -> pd.DataFrame:
    return pd.DataFrame([[to_text(v) for v in row] for row in rows], columns=columns, dtype=object)


class PostgresExportSource:
    """읽기 전용 계정으로 뷰를 읽는다.

    네 뷰를 한 트랜잭션의 같은 스냅숏으로 읽는다. 읽는 사이에 동의를 철회한 사용자가 한 표에만 남으면
    로더가 멈추거나, 철회한 사용자의 연주가 섞일 수 있기 때문이다.
    """

    def __init__(
        self,
        dsn: str | None = None,
        connect: Callable[[], Any] | None = None,
        statement_timeout_ms: int = 300_000,
    ) -> None:
        self._connect = connect or self._default_connect(dsn, statement_timeout_ms)

    @staticmethod
    def _default_connect(dsn: str | None, timeout_ms: int) -> Callable[[], Any]:
        resolved = dsn or os.environ.get(DSN_ENV)
        if not resolved:
            raise RuntimeError(f"접속 문자열이 없습니다(환경 변수 {DSN_ENV})")

        def connect() -> Any:
            import psycopg

            return psycopg.connect(
                resolved,
                application_name="recommend-batch",
                options=f"-c statement_timeout={int(timeout_ms)}",
            )

        return connect

    def frames(self) -> dict[str, pd.DataFrame]:
        conn = self._connect()
        try:
            with conn.cursor() as cur:
                cur.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
                out = {name: _read_view(cur, name, view) for name, view in REQUIRED_VIEWS.items()}
                for name, view in OPTIONAL_VIEWS.items():
                    cur.execute("SELECT to_regclass(%s)", (view,))
                    if cur.fetchone()[0] is not None:
                        out[name] = _read_view(cur, name, view)
            return out
        finally:
            conn.close()


def _read_view(cur: Any, name: str, view: str) -> pd.DataFrame:
    if not _IDENTIFIER.match(view):
        raise ValueError("뷰 이름 형식이 올바르지 않습니다")
    cur.execute(f"SELECT * FROM {view} LIMIT 0")  # 뷰 이름은 위 상수이고 형식을 확인했다
    columns = [d.name for d in cur.description]
    spec = S.FILES[name]
    check_columns(columns, spec, label=view)
    # 스키마에 있는 열만 고르고 순서를 정해 읽는다. 같은 입력이면 같은 데이터 해시가 나와야 한다
    allowed = [c for c in spec.required + spec.optional if c in columns]
    cur.execute(f"SELECT {', '.join(allowed)} FROM {view} ORDER BY {', '.join(allowed[:3])}")
    return text_frame(allowed, cur.fetchall())


class SyntheticSource:
    """합성 입력. 배치를 끝까지 시험할 때 쓴다(출처 단계 P0)."""

    def __init__(self, cfg: SimConfig | None = None) -> None:
        self._cfg = cfg or SimConfig()

    def frames(self) -> dict[str, pd.DataFrame]:
        data = generate(self._cfg)
        names = {f.name for f in fields(SyntheticData)} & set(S.FILES)
        return {name: _as_text(getattr(data, name)) for name in names}


def _as_text(frame: pd.DataFrame) -> pd.DataFrame:
    columns = list(frame.columns)
    return text_frame(columns, list(frame.itertuples(index=False, name=None)))


def require_views(frames: Mapping[str, pd.DataFrame]) -> None:
    """필수 표가 모두 있는지 확인한다."""
    missing = sorted(set(REQUIRED_VIEWS) - set(frames))
    if missing:
        raise DataError(f"필수 입력이 없습니다: {missing}")
