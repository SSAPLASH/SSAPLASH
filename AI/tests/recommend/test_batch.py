"""R3 운영 배치: 입력 검증, 후보 생성, 적재 계약(설계 문서 부록 C.7·C.8)."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime
from decimal import Decimal

import pandas as pd
import pytest
import requests

from ssaplash_ai.recommend import batch as B
from ssaplash_ai.recommend import schema as S
from ssaplash_ai.recommend.candidates_client import (
    CandidateBatch,
    CandidatesClient,
    UploadError,
    UserCandidates,
    build_bodies,
)
from ssaplash_ai.recommend.data import DataError, dataset_from_frames
from ssaplash_ai.recommend.simulate import SimConfig
from ssaplash_ai.recommend.source import PostgresExportSource, SyntheticSource, to_text

KEY = "user-aaaaaaaa"
SMALL = SimConfig(seed=1, n_users=60, n_songs=40, days=30)


@pytest.fixture(scope="module")
def frames():
    return SyntheticSource(SMALL).frames()


@pytest.fixture(scope="module")
def data(frames):
    return dataset_from_frames(frames, S.STAGE_SYNTHETIC)


class StaticSource:
    def __init__(self, frames):
        self._frames = frames

    def frames(self):
        return {k: v.copy() for k, v in self._frames.items()}


class Response:
    def __init__(self, status=200, body=None):
        self.status_code = status
        self._body = (
            body
            if body is not None
            else {
                "accepted": 1,
                "droppedUnknown": 0,
                "droppedNoConsent": 0,
            }
        )

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


class FakeSession:
    """차례로 응답을 돌려주고 받은 요청을 모은다. 응답이 예외면 던진다."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []

    def post(self, url, data, headers, timeout):
        self.requests.append({"url": url, "body": data, "headers": headers})
        item = self.responses.pop(0) if self.responses else Response()
        if isinstance(item, Exception):
            raise item
        return item

    def get(self, url, headers, timeout):
        self.requests.append({"url": url, "headers": headers})
        return self.responses.pop(0)


def client(session, **kwargs):
    return CandidatesClient(
        "https://be.test/", "t" * 32, session=session, sleep=lambda _: None, **kwargs
    )


def one_user_batch(n=2):
    users = tuple(UserCandidates(f"user-{i:08d}", (1, 2, 3)) for i in range(n))
    return CandidateBatch("b-1", "r3-base-1a2b3c4d", "2026-11-05T03:00:00Z", users)


# ---------------------------------------------------------------- 후보 생성


def test_candidates_follow_the_contract(data):
    cfg = B.BatchConfig(candidates_per_user=10)
    batch, stats = B.generate_candidates(data, cfg, generated_at=datetime(2026, 11, 5, tzinfo=UTC))
    assert batch.generated_at == "2026-11-05T00:00:00Z"
    assert batch.batch_id.startswith("2026-11-05T00:00:00Z-")
    assert batch.users
    known = set(data.users["user_key"])
    public = set(data.songs["song_id"])
    for user in batch.users:
        assert user.user_key in known
        assert 0 < len(user.song_ids) <= 10
        assert len(set(user.song_ids)) == len(user.song_ids)
        assert set(user.song_ids) <= public
    assert stats.users_with_candidates == len(batch.users)
    assert stats.candidate_pairs == sum(len(u.song_ids) for u in batch.users)


def test_candidates_exclude_songs_the_user_already_played(data):
    batch, _ = B.generate_candidates(data, B.BatchConfig(candidates_per_user=10))
    played = data.interactions.groupby("user_key")["song_id"].agg(set)
    for user in batch.users:
        assert not set(user.song_ids) & played[user.user_key]


def test_user_without_plays_gets_no_candidates(frames):
    users = frames["users"]
    extra = users.iloc[[0]].assign(user_key="user-noplays1")
    changed = {**frames, "users": pd.concat([users, extra], ignore_index=True)}
    data = dataset_from_frames(changed, S.STAGE_SYNTHETIC)
    batch, stats = B.generate_candidates(data, B.BatchConfig(candidates_per_user=5))
    assert "user-noplays1" not in {u.user_key for u in batch.users}
    assert stats.users_without_history >= 1


def test_same_input_and_seed_give_the_same_candidates(data):
    stamp = datetime(2026, 11, 5, tzinfo=UTC)
    first, _ = B.generate_candidates(data, B.BatchConfig(), generated_at=stamp)
    second, _ = B.generate_candidates(data, B.BatchConfig(), generated_at=stamp)
    assert first == second


def test_model_version_does_not_depend_on_data_but_on_settings():
    cfg = B.BatchConfig()
    version = B.model_version(cfg, B.build_model(cfg))
    assert version.startswith("r3-base-") and len(version) == len("r3-base-") + 8
    assert version == B.model_version(cfg, B.build_model(cfg))
    other = B.BatchConfig(seed=9)
    assert version != B.model_version(other, B.build_model(other))
    assert "user" not in version


def test_meta_variant_needs_metadata(frames):
    empty = frames["song_meta"].iloc[0:0]
    data = dataset_from_frames({**frames, "song_meta": empty}, S.STAGE_SYNTHETIC)
    with pytest.raises(DataError, match="메타데이터"):
        B.generate_candidates(data, B.BatchConfig(variant="feat_meta"))


@pytest.mark.parametrize(
    "kwargs", [{"variant": "nope"}, {"candidates_per_user": 51}, {"candidates_per_user": 0}]
)
def test_bad_config_is_rejected(kwargs):
    with pytest.raises(ValueError):
        B.BatchConfig(**kwargs)


# ---------------------------------------------------------------- 입력 검증


def test_frames_go_through_the_same_rules_as_files(frames):
    with_nick = {**frames, "users": frames["users"].assign(nickname="x")}
    with pytest.raises(DataError, match="개인을 가리킬"):
        dataset_from_frames(with_nick, S.STAGE_SYNTHETIC)
    no_consent = frames["users"].copy()
    no_consent.loc[0, "consent_recommendation"] = "false"
    with pytest.raises(DataError, match="동의하지 않은"):
        dataset_from_frames({**frames, "users": no_consent}, S.STAGE_SYNTHETIC)


def test_production_stage_needs_approval(frames):
    with pytest.raises(DataError, match="승인 근거"):
        dataset_from_frames(frames, S.STAGE_PRODUCTION)


def test_data_hash_is_stable_and_changes_with_input(frames):
    first = dataset_from_frames(frames, S.STAGE_SYNTHETIC).data_hash
    assert first == dataset_from_frames(frames, S.STAGE_SYNTHETIC).data_hash
    changed = frames["songs"].copy()
    changed.loc[0, "bpm"] = "199"
    assert first != dataset_from_frames({**frames, "songs": changed}, S.STAGE_SYNTHETIC).data_hash


def test_bad_input_stops_before_any_upload(frames, capsys):
    bad = {**frames, "users": frames["users"].assign(email="a@b.c")}
    session = FakeSession()
    code = B.main(
        ["--from-views", "--stage", "P1", "--upload"],
        source=StaticSource(bad),
        client=client(session),
    )
    assert code == 2
    assert session.requests == []
    assert "적재 안 함" in capsys.readouterr().err


def test_missing_required_view_stops(frames):
    partial = {k: v for k, v in frames.items() if k != "interactions"}
    with pytest.raises(DataError, match="필수 입력"):
        B.load_input(StaticSource(partial), S.STAGE_SYNTHETIC)


# ---------------------------------------------------------------- 뷰 읽기


class Column:
    def __init__(self, name):
        self.name = name


class FakeCursor:
    def __init__(self, views):
        self.views = views
        self.statements = []
        self.description = []
        self._rows = []

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, sql, params=None):
        self.statements.append(sql)
        if "to_regclass" in sql:
            self._rows = [(params[0] if params[0] in self.views else None,)]
            return
        if sql.startswith("SET TRANSACTION"):
            return
        view = sql.split(" FROM ")[1].split()[0]
        columns, rows = self.views[view]
        self.description = [Column(c) for c in columns]
        self._rows = [] if "LIMIT 0" in sql else rows

    def fetchone(self):
        return self._rows[0]

    def fetchall(self):
        return self._rows


class FakeConnection:
    def __init__(self, views):
        self.cur = FakeCursor(views)
        self.closed = False

    def cursor(self):
        return self.cur

    def close(self):
        self.closed = True


def view_rows():
    return {
        "recommend_users_v": (
            ["user_key", "consent_recommendation", "consent_version"],
            [(KEY, True, "2026-11-05")],
        ),
        "recommend_songs_v": (
            ["song_id", "bpm", "duration_ms", "song_level", "public"],
            [(1, Decimal("120.0"), 180000, "BEGINNER", True)],
        ),
        "recommend_chart_features_v": (
            list(S.FILES["chart_features"].required),
            [(10, 1, "EASY", 2.0, 3.0, {"KICK": 1.0}, {"KICK>KICK": 1.0}, {"groups": {}})],
        ),
        "recommend_interactions_v": (
            list(S.FILES["interactions"].required),
            [(KEY, 1, 10, datetime(2026, 11, 1, tzinfo=UTC), 0.9, True, "RHYTHM")],
        ),
    }


def test_views_are_read_in_one_read_only_snapshot_and_connection_closes():
    conn = FakeConnection(view_rows())
    frames = PostgresExportSource(connect=lambda: conn).frames()
    assert conn.cur.statements[0] == "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
    assert conn.closed
    assert set(frames) == {"users", "songs", "chart_features", "interactions"}
    assert frames["users"].iloc[0]["consent_recommendation"] == "true"
    assert json.loads(frames["chart_features"].iloc[0]["pad_ratio"]) == {"KICK": 1.0}


def test_view_with_disallowed_column_is_not_read():
    views = view_rows()
    columns, rows = views["recommend_users_v"]
    views["recommend_users_v"] = ([*columns, "user_id"], rows)
    conn = FakeConnection(views)
    with pytest.raises(DataError, match="user_id"):
        PostgresExportSource(connect=lambda: conn).frames()
    assert not any(s.startswith("SELECT user_key") for s in conn.cur.statements)
    assert conn.closed


def test_metadata_view_is_read_only_when_it_exists():
    views = view_rows()
    views["recommend_song_meta_v"] = (["song_id", "genre"], [(1, "ROCK")])
    frames = PostgresExportSource(connect=lambda: FakeConnection(views)).frames()
    assert frames["song_meta"].iloc[0]["genre"] == "ROCK"


def test_source_needs_a_dsn(monkeypatch):
    monkeypatch.delenv("SSAPLASH_RECOMMEND_EXPORT_DSN", raising=False)
    with pytest.raises(RuntimeError, match="SSAPLASH_RECOMMEND_EXPORT_DSN"):
        PostgresExportSource()


@pytest.mark.parametrize(
    ("value", "text"),
    [
        (None, ""),
        (float("nan"), ""),
        (True, "true"),
        (False, "false"),
        ({"a": 1}, '{"a": 1}'),
        (date(2026, 11, 5), "2026-11-05"),
        (Decimal("1.5"), "1.5"),
        (3, "3"),
    ],
)
def test_to_text(value, text):
    assert to_text(value) == text


# ---------------------------------------------------------------- 적재 클라이언트


def test_body_matches_the_contract():
    session = FakeSession()
    result = client(session).upload(one_user_batch(1))
    sent = session.requests[0]
    assert sent["url"] == "https://be.test/internal/v1/recommend-candidates"
    assert sent["headers"]["Authorization"] == "Bearer " + "t" * 32
    assert json.loads(sent["body"]) == {
        "batchId": "b-1",
        "modelVersion": "r3-base-1a2b3c4d",
        "generatedAt": "2026-11-05T03:00:00Z",
        "users": [{"userKey": "user-00000000", "songIds": [1, 2, 3]}],
    }
    assert result.complete and result.accepted == 1


def test_bodies_stay_under_the_limit_and_keep_batch_id_and_every_user():
    batch = one_user_batch(50)
    bodies = build_bodies(batch, max_bytes=400)
    assert len(bodies) > 1
    parsed = [json.loads(b) for b in bodies]
    assert all(len(b) <= 400 for b in bodies)
    assert {p["batchId"] for p in parsed} == {"b-1"}
    keys = [u["userKey"] for p in parsed for u in p["users"]]
    assert keys == [u.user_key for u in batch.users]


def test_counts_are_summed_over_chunks():
    body = {"accepted": 2, "droppedUnknown": 1, "droppedNoConsent": 1}
    session = FakeSession(Response(body=body), Response(body=body))
    result = client(session, max_bytes=150).upload(one_user_batch(2))
    assert (
        result.chunks_total,
        result.accepted,
        result.dropped_unknown,
        result.dropped_no_consent,
    ) == (2, 4, 2, 2)


def test_empty_batch_sends_nothing():
    session = FakeSession()
    result = client(session).upload(one_user_batch(0))
    assert session.requests == [] and result.complete


@pytest.mark.parametrize(
    "first", [Response(503), Response(429), requests.ConnectionError("x"), requests.Timeout("x")]
)
def test_temporary_failure_retries_the_same_body(first):
    session = FakeSession(first, Response())
    result = client(session).upload(one_user_batch(1))
    assert result.complete
    assert len(session.requests) == 2
    assert session.requests[0]["body"] == session.requests[1]["body"]


def test_rejection_is_not_retried_and_reports_partial_upload():
    session = FakeSession(Response(), Response(400, {"detail": "user-00000001"}))
    result = client(session, max_bytes=150).upload(one_user_batch(3))
    assert not result.complete
    assert (result.chunks_sent, result.users_sent) == (1, 1)
    assert result.error == "적재 거절: HTTP 400"
    assert len(session.requests) == 2


def test_gives_up_after_attempts():
    session = FakeSession(Response(500), Response(500), Response(500))
    result = client(session).upload(one_user_batch(1))
    assert result.error == "서버 오류: HTTP 500 (3번 시도)"
    assert result.chunks_sent == 0


@pytest.mark.parametrize(
    "bad", [Response(body=[]), Response(body={"accepted": 1}), Response(body=ValueError("x"))]
)
def test_malformed_response_is_a_failure(bad):
    result = client(FakeSession(bad)).upload(one_user_batch(1))
    assert not result.complete


def test_too_many_or_duplicate_songs_are_rejected_before_sending():
    many = CandidateBatch("b", "m", "t", (UserCandidates(KEY, tuple(range(51))),))
    twice = CandidateBatch("b", "m", "t", (UserCandidates(KEY, (1, 1)),))
    for batch in (many, twice):
        with pytest.raises(ValueError):
            build_bodies(batch)


def test_secrets_and_user_keys_do_not_appear_in_repr_or_errors():
    c = client(FakeSession(Response(401, {"detail": KEY})))
    assert "t" * 32 not in repr(c)
    batch = one_user_batch(1)
    assert "user-0" not in repr(batch)
    assert "user-0" not in str(c.upload(batch))


def test_status_reads_aggregates():
    body = {"modelVersion": "m", "generatedAt": "t", "usersWithCandidates": 3}
    session = FakeSession(Response(body=body))
    assert client(session).status() == body
    assert session.requests[0]["url"].endswith("/recommend-candidates/status")
    with pytest.raises(UploadError, match="HTTP 403"):
        client(FakeSession(Response(403))).status()


def test_client_from_env_needs_both_values():
    with pytest.raises(RuntimeError, match="SSAPLASH_WORKER_TOKEN"):
        CandidatesClient.from_env({"SSAPLASH_WORKER_BASE_URL": "https://be.test"})


# ---------------------------------------------------------------- 실행


def run_args(*extra):
    return [
        "--synthetic",
        "--stage",
        "P0",
        "--synthetic-users",
        "60",
        "--synthetic-songs",
        "40",
        *extra,
    ]


def test_default_run_does_not_upload(capsys):
    assert B.main(run_args()) == 0
    out = capsys.readouterr().out
    assert "적재하지 않음" in out
    assert "user-" not in out


def test_synthetic_input_cannot_be_uploaded():
    session = FakeSession()
    assert B.main(run_args("--upload"), client=client(session)) == 2
    assert session.requests == []


def test_synthetic_needs_stage_p0_and_views_cannot_use_p0():
    assert B.main(["--synthetic", "--stage", "P1"]) == 2
    assert B.main(["--from-views", "--stage", "P0"]) == 2


def test_end_to_end_upload_and_partial_failure_exit_code(frames, capsys):
    args = ["--from-views", "--stage", "P1", "--upload", "--candidates", "5"]
    session = FakeSession()
    assert B.main(args, source=StaticSource(frames), client=client(session)) == 0
    body = json.loads(session.requests[0]["body"])
    assert all(len(u["songIds"]) <= 5 for u in body["users"])
    out = capsys.readouterr().out
    assert "user-" not in out

    failing = FakeSession(Response(400))
    assert B.main(args, source=StaticSource(frames), client=client(failing)) == 3
    assert "일부만 적재됨" in capsys.readouterr().err


def test_unexpected_read_failure_shows_only_the_error_type(capsys):
    class Broken:
        def frames(self):
            raise OSError("password=secret host=db")

    session = FakeSession()
    code = B.main(
        ["--from-views", "--stage", "P1", "--upload"], source=Broken(), client=client(session)
    )
    assert code == 2
    assert session.requests == []
    err = capsys.readouterr().err
    assert "OSError" in err and "secret" not in err
