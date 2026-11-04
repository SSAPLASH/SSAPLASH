"""뷰 읽기와 허용 필드 검증: 허용 밖 열은 데이터를 읽기 전에 거부하고 값은 오류에 담지 않는다."""

from __future__ import annotations

import random

import pytest

from calibration_helpers import synthetic_request, view_rows
from ssaplash_ai.coach import AnalysisRequest, analyze
from ssaplash_ai.coach_calibration import source as src
from ssaplash_ai.coach_calibration.source import (
    ALLOWED_COLUMNS,
    DisallowedColumnError,
    ListSource,
    MissingColumnError,
    PostgresViewSource,
    read_sessions,
)

# BE 요청 문서의 뷰 허용 목록. 바꿀 때는 BE와 먼저 합의해야 하므로 시험에 그대로 적어 둔다.
EXPECTED_ALLOWED = (
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
# 어떤 경우에도 허용하면 안 되는 이름(신원·기기·원본 연결·정확한 시각)
FORBIDDEN = (
    "user_id",
    "email",
    "nickname",
    "kit_preset_id",
    "kit_preset_snapshot",
    "calibration",
    "client_meta",
    "raw_log_key",
    "raw_log_status",
    "payload_hash",
    "live_coach_events",
    "started_at",
    "ended_at",
    "created_at",
    "pitch",
    "yaw",
    "baseline_pad",
    "predicted_pad",
)


def test_allowed_columns_match_the_agreed_list():
    assert ALLOWED_COLUMNS == EXPECTED_ALLOWED


def test_forbidden_names_are_never_allowed():
    assert not set(FORBIDDEN) & set(ALLOWED_COLUMNS)


def test_groups_rows_into_sessions_and_sorts_hits_by_seq():
    rows = view_rows(synthetic_request(1), "aaa") + view_rows(synthetic_request(2), "bbb")
    random.Random(0).shuffle(rows)  # 뷰가 정렬을 보장하지 않아도 세션 안 순서는 seq다

    sessions = read_sessions(ListSource(rows))

    assert sorted(s.session_key for s in sessions) == ["aaa", "bbb"]
    for s in sessions:
        seqs = [h["seq"] for h in s.hits]
        assert seqs == sorted(seqs)
        assert not s.inconsistent


def test_session_converts_to_an_analysis_request_the_engine_accepts():
    (session,) = read_sessions(ListSource(view_rows(synthetic_request(3, n_notes=120))))

    request = AnalysisRequest.model_validate(session.to_request())
    response = analyze(request)

    assert request.playId == session.session_key
    assert request.timingWindows.goodMs == session.good_ms
    assert response.reason in ("OK", "NO_WEAKNESS")


def test_extra_column_is_rejected_before_any_row_is_read():
    class Guarded(ListSource):
        def rows(self):
            raise AssertionError("허용 밖 열이 있는데 행을 읽었다")

    rows = view_rows(synthetic_request(4))
    secret = "SECRET-VALUE-123"
    for row in rows:
        row["client_meta"] = secret
        row["user_id"] = 42

    with pytest.raises(DisallowedColumnError) as caught:
        read_sessions(Guarded(rows))

    assert set(caught.value.columns) == {"client_meta", "user_id"}
    assert secret not in str(caught.value)
    assert "42" not in str(caught.value)


def test_missing_required_column_is_rejected():
    rows = [
        {k: v for k, v in r.items() if k != "delta_ms"} for r in view_rows(synthetic_request(5))
    ]

    with pytest.raises(MissingColumnError) as caught:
        read_sessions(ListSource(rows))

    assert caught.value.columns == ("delta_ms",)


def test_difficulty_is_optional_until_be_confirms_it():
    rows = view_rows(synthetic_request(6), with_difficulty=False)

    (session,) = read_sessions(ListSource(rows))

    assert session.difficulty is None


def test_session_values_that_disagree_mark_the_session_inconsistent():
    rows = view_rows(synthetic_request(7))
    rows[3]["good_ms"] = 99.0  # 같은 세션인데 판정 폭이 다르다

    (session,) = read_sessions(ListSource(rows))

    assert session.inconsistent


def test_empty_source_gives_no_sessions():
    assert read_sessions(ListSource([], columns=ALLOWED_COLUMNS)) == []


# --- PostgresViewSource: 실제 DB 없이 연결 객체를 가짜로 끼워 확인한다 ---


class FakeCursor:
    def __init__(self, conn, named: bool):
        self.conn = conn
        self.named = named
        self.itersize = None
        self.description = [type("D", (), {"name": c})() for c in conn.view_columns]

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql):
        self.conn.executed.append(sql)

    def __iter__(self):
        yield from self.conn.data


class FakeConnection:
    def __init__(self, view_columns, data=()):
        self.view_columns = list(view_columns)
        self.data = list(data)
        self.executed: list[str] = []
        self.read_only = False
        self.closed = False

    def cursor(self, name=None):
        return FakeCursor(self, named=name is not None)

    def close(self):
        self.closed = True


def _source(conn) -> PostgresViewSource:
    return PostgresViewSource(connect=lambda: conn)


def test_postgres_source_reads_only_allowed_columns_in_order_with_read_only_connection():
    conn = FakeConnection(ALLOWED_COLUMNS, data=[("k", *range(len(ALLOWED_COLUMNS) - 1))])
    source = _source(conn)

    assert list(source.columns()) == list(ALLOWED_COLUMNS)
    assert conn.read_only is True and conn.closed is True
    assert conn.executed[0].endswith("LIMIT 0")

    conn.executed.clear()
    rows = list(source.rows())

    select = [s for s in conn.executed if "ORDER BY session_key, seq" in s]
    assert select and select[0].startswith("SELECT session_key, mode,")
    assert "*" not in select[0]
    assert set(rows[0]) == set(ALLOWED_COLUMNS)


def test_postgres_source_with_extra_view_column_fails_before_reading_rows():
    conn = FakeConnection([*ALLOWED_COLUMNS, "user_id"], data=[("x",)])

    with pytest.raises(DisallowedColumnError) as caught:
        read_sessions(_source(conn))

    assert caught.value.columns == ("user_id",)
    assert not any("ORDER BY" in s for s in conn.executed)  # 행 조회 질의가 나가지 않았다


def test_postgres_source_without_dsn_fails_without_leaking_anything(monkeypatch):
    monkeypatch.delenv(src.DSN_ENV, raising=False)

    with pytest.raises(RuntimeError) as caught:
        PostgresViewSource()

    assert src.DSN_ENV in str(caught.value)


def test_postgres_source_uses_dsn_from_environment_with_timeout_and_app_name(monkeypatch):
    seen = {}

    def fake_connect(dsn, **kwargs):
        seen["dsn"], seen["kwargs"] = dsn, kwargs
        return FakeConnection(ALLOWED_COLUMNS)

    monkeypatch.setattr("psycopg.connect", fake_connect)
    monkeypatch.setenv(src.DSN_ENV, "postgresql://reader:pw@db:5432/app")

    PostgresViewSource(statement_timeout_ms=5000).columns()

    assert seen["dsn"].startswith("postgresql://reader")
    assert seen["kwargs"]["application_name"] == "coach-calibration"
    assert "statement_timeout=5000" in seen["kwargs"]["options"]


def test_view_name_must_be_a_plain_identifier():
    with pytest.raises(ValueError):
        PostgresViewSource(view="coach_export_v; DROP TABLE hits", connect=lambda: None)
