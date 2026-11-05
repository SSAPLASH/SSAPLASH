"""PoC 입력 로더와 시간순 분할(설계 문서 부록 B.2·B.3·B.7).

로더는 스키마에서 어긋나는 것을 조용히 고치지 않고 `DataError`로 멈춘다. 특히 다음은 항상 멈춘다.
- 개인을 가리킬 수 있는 열(닉네임·이메일·계정 id 등)이 어느 파일에든 있을 때
- 추천 학습에 동의하지 않은 사용자, 공개되지 않은 곡이 들어 있을 때
- 가명 키가 숫자만이거나 이메일 모양일 때(원래 계정 값일 수 있다)
- 일반 사용자 데이터(P2)를 승인 근거 없이 쓰려 할 때
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from ssaplash_ai.recommend import schema as S


class DataError(ValueError):
    """입력 데이터가 스키마·정책에 맞지 않는다."""


@dataclass(frozen=True)
class Dataset:
    """검증을 통과한 입력. JSON 열은 dict로, 메타데이터의 목록 열은 tuple로 풀려 있다. 비어 있는 energy는 NaN이다."""

    stage: str
    users: pd.DataFrame
    songs: pd.DataFrame
    chart_features: pd.DataFrame
    interactions: pd.DataFrame  # played_at 오름차순(같으면 원래 순서)
    exposures: pd.DataFrame
    song_meta: pd.DataFrame
    weak_summary: pd.DataFrame
    data_hash: str

    def summary(self) -> dict[str, str | int]:
        """MLflow 기록용 요약. 개인 값은 담지 않는다."""
        return {
            "stage": self.stage,
            "data_hash": self.data_hash,
            "users": len(self.users),
            "songs": len(self.songs),
            "charts": len(self.chart_features),
            "interactions": len(self.interactions),
            "exposures": len(self.exposures),
            "song_meta": len(self.song_meta),
            "weak_summary": len(self.weak_summary),
        }


def load_dataset(directory: str | Path, stage: str, *, p2_approval: str | None = None) -> Dataset:
    """폴더의 CSV들을 읽어 검증한다. `stage`는 데이터 출처 단계(P0 합성, P1 내부, P2 일반 사용자).

    P2는 동의 범위가 정해진 뒤에만 쓸 수 있으므로 승인 근거(문서·결정 번호)를 `p2_approval`에 적어야 한다.
    """
    if stage not in S.STAGES:
        raise DataError(f"데이터 출처 단계는 {S.STAGES} 중 하나여야 합니다: {stage!r}")
    if stage == S.STAGE_PRODUCTION and not (p2_approval and p2_approval.strip()):
        raise DataError(
            "일반 사용자 데이터(P2)는 동의 범위 승인 근거(p2_approval) 없이 사용할 수 없습니다."
        )
    root = Path(directory)
    if not root.is_dir():
        raise DataError(f"데이터 폴더가 없습니다: {root}")

    raw: dict[str, pd.DataFrame] = {}
    digest = hashlib.sha256()
    for name, spec in sorted(S.FILES.items()):
        path = root / spec.filename
        if not path.is_file():
            if spec.must_exist:
                raise DataError(f"필수 파일이 없습니다: {spec.filename}")
            raw[name] = pd.DataFrame(columns=list(spec.required + spec.optional))
            continue
        digest.update(spec.filename.encode("utf-8"))
        digest.update(path.read_bytes())
        raw[name] = _read(path, spec)

    users = _users(raw["users"])
    songs = _songs(raw["songs"])
    charts = _chart_features(raw["chart_features"], set(songs["song_id"]))
    chart_song = dict(zip(charts["chart_id"], charts["song_id"], strict=True))
    interactions = _interactions(
        raw["interactions"], set(users["user_key"]), set(songs["song_id"]), chart_song
    )
    exposures = _exposures(
        raw["exposures"], set(users["user_key"]), set(songs["song_id"]), chart_song
    )
    song_meta = _song_meta(raw["song_meta"], set(songs["song_id"]))
    weak = _weak_summary(raw["weak_summary"], set(users["user_key"]))
    return Dataset(
        stage, users, songs, charts, interactions, exposures, song_meta, weak, digest.hexdigest()
    )


# ---------------------------------------------------------------- 읽기와 열 검사


def _read(path: Path, spec: S.FileSpec) -> pd.DataFrame:
    try:
        df = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8")
    except (UnicodeDecodeError, pd.errors.ParserError, pd.errors.EmptyDataError) as ex:
        raise DataError(
            f"{spec.filename}을 읽지 못했습니다(UTF-8 CSV 필요): {type(ex).__name__}"
        ) from ex
    lowered = {c.lower(): c for c in df.columns}
    forbidden = sorted(S.FORBIDDEN_COLUMNS & set(lowered))
    if forbidden:
        raise DataError(
            f"{spec.filename}에 개인을 가리킬 수 있는 열이 있습니다: {[lowered[c] for c in forbidden]}"
        )
    missing = [c for c in spec.required if c not in df.columns]
    if missing:
        raise DataError(f"{spec.filename}에 필수 열이 없습니다: {missing}")
    unknown = [c for c in df.columns if c not in spec.required and c not in spec.optional]
    if unknown:
        raise DataError(f"{spec.filename}에 스키마에 없는 열이 있습니다: {unknown}")
    if spec.must_exist and df.empty:
        raise DataError(f"{spec.filename}에 행이 없습니다.")
    return df


# ---------------------------------------------------------------- 값 변환 도구


def _bad(file: str, col: str, why: str) -> DataError:
    return DataError(f"{file}.{col}: {why}")


def _bool(df: pd.DataFrame, col: str, file: str) -> pd.Series:
    mapping = {"true": True, "false": False, "1": True, "0": False}
    lowered = df[col].str.strip().str.lower()
    if not lowered.isin(mapping).all():
        raise _bad(file, col, "true/false(또는 1/0)만 쓸 수 있습니다")
    return lowered.map(mapping).astype(bool)


def _int(
    df: pd.DataFrame, col: str, file: str, minimum: int | None = None, maximum: int | None = None
) -> pd.Series:
    try:
        values = pd.to_numeric(df[col].str.strip(), errors="raise")
    except (ValueError, TypeError) as ex:
        raise _bad(file, col, "정수여야 합니다") from ex
    if not (values == values.round()).all():
        raise _bad(file, col, "정수여야 합니다")
    values = values.astype("int64")
    if minimum is not None and (values < minimum).any():
        raise _bad(file, col, f"{minimum} 이상이어야 합니다")
    if maximum is not None and (values > maximum).any():
        raise _bad(file, col, f"{maximum} 이하여야 합니다")
    return values


def _float(
    df: pd.DataFrame,
    col: str,
    file: str,
    minimum: float | None = None,
    maximum: float | None = None,
    exclusive_min: bool = False,
) -> pd.Series:
    try:
        values = pd.to_numeric(df[col].str.strip(), errors="raise").astype("float64")
    except (ValueError, TypeError) as ex:
        raise _bad(file, col, "숫자여야 합니다") from ex
    if not values.map(lambda v: v == v and abs(v) != float("inf")).all():
        raise _bad(file, col, "NaN·무한대는 쓸 수 없습니다")
    if minimum is not None and ((values <= minimum) if exclusive_min else (values < minimum)).any():
        raise _bad(file, col, f"{minimum}{' 초과' if exclusive_min else ' 이상'}이어야 합니다")
    if maximum is not None and (values > maximum).any():
        raise _bad(file, col, f"{maximum} 이하여야 합니다")
    return values


def _time(df: pd.DataFrame, col: str, file: str) -> pd.Series:
    try:
        return pd.to_datetime(df[col].str.strip(), utc=True, format="ISO8601")
    except (ValueError, TypeError) as ex:
        raise _bad(file, col, "ISO 8601 시각이어야 합니다") from ex


def _choice(df: pd.DataFrame, col: str, file: str, allowed: tuple[str, ...]) -> pd.Series:
    values = df[col].str.strip()
    if not values.isin(allowed).all():
        raise _bad(file, col, f"{allowed} 중 하나여야 합니다")
    return values


def _nonblank(df: pd.DataFrame, col: str, file: str) -> pd.Series:
    values = df[col].str.strip()
    if (values == "").any():
        raise _bad(file, col, "빈 값이 있습니다")
    return values


def _json_object(df: pd.DataFrame, col: str, file: str) -> list[dict]:
    parsed: list[dict] = []
    for text in df[col]:
        try:
            value = json.loads(text)
        except (ValueError, TypeError) as ex:
            raise _bad(file, col, "JSON이어야 합니다") from ex
        if not isinstance(value, dict):
            raise _bad(file, col, "JSON 객체여야 합니다")
        parsed.append(value)
    return parsed


def _ratio_map(values: list[dict], col: str, file: str) -> None:
    for obj in values:
        for key, v in obj.items():
            if not isinstance(v, (int, float)) or isinstance(v, bool) or not 0 <= v <= 1:
                raise _bad(file, col, f"{key!r}의 값은 0~1 숫자여야 합니다")


def _unique(series: pd.Series, file: str, col: str) -> None:
    if series.duplicated().any():
        raise _bad(file, col, "중복된 값이 있습니다")


def _within(series: pd.Series, allowed: set, file: str, col: str, what: str) -> None:
    if not series.isin(allowed).all():
        raise _bad(file, col, f"{what}에 없는 값이 있습니다")


def _no_full_duplicates(df: pd.DataFrame, file: str) -> None:
    if df.duplicated().any():
        raise DataError(f"{file}: 완전히 같은 행이 중복되어 있습니다(내보내기 오류로 봅니다)")


# ---------------------------------------------------------------- 파일별 검증


def _users(df: pd.DataFrame) -> pd.DataFrame:
    f = "users"
    keys = _user_keys(df, "user_key", f)
    _unique(keys, f, "user_key")
    consent = _bool(df, "consent_recommendation", f)
    if not consent.all():
        raise DataError(
            f"users: 추천 학습에 동의하지 않은 사용자가 {int((~consent).sum())}명 있습니다. "
            "내보내기에서 동의한 사용자만 넣어야 합니다."
        )
    return pd.DataFrame(
        {"user_key": keys, "consent_version": _nonblank(df, "consent_version", f)}
    ).reset_index(drop=True)


def _user_keys(df: pd.DataFrame, col: str, file: str) -> pd.Series:
    keys = df[col].str.strip()
    if not keys.map(lambda k: re.fullmatch(S.USER_KEY_PATTERN, k) is not None).all():
        raise _bad(file, col, "가명 키는 영문·숫자·_- 8~64자여야 합니다")
    if keys.str.fullmatch(r"[0-9]+").any():
        raise _bad(file, col, "숫자만 있는 키는 원래 계정 번호일 수 있어 쓸 수 없습니다")
    return keys


def _songs(df: pd.DataFrame) -> pd.DataFrame:
    f = "songs"
    out = pd.DataFrame(
        {
            "song_id": _int(df, "song_id", f, minimum=1),
            "bpm": _float(df, "bpm", f, minimum=0, exclusive_min=True),
            "duration_ms": _int(df, "duration_ms", f, minimum=1),
            "song_level": _choice(df, "song_level", f, S.SONG_LEVELS),
        }
    )
    _unique(out["song_id"], f, "song_id")
    public = _bool(df, "public", f)
    if not public.all():
        raise DataError(
            f"songs: 공개되지 않은 곡이 {int((~public).sum())}개 있습니다. 공용 곡만 넣어야 합니다."
        )
    return out.reset_index(drop=True)


def _chart_features(df: pd.DataFrame, song_ids: set[int]) -> pd.DataFrame:
    f = "chart_features"
    out = pd.DataFrame(
        {
            "chart_id": _int(df, "chart_id", f, minimum=1),
            "song_id": _int(df, "song_id", f, minimum=1),
            "difficulty": _choice(df, "difficulty", f, S.DIFFICULTIES),
            "avg_notes_per_sec": _float(df, "avg_notes_per_sec", f, minimum=0),
            "peak_notes_2s": _int(df, "peak_notes_2s", f, minimum=0),
        }
    )
    _unique(out["chart_id"], f, "chart_id")
    _within(out["song_id"], song_ids, f, "song_id", "songs")
    pads = _json_object(df, "pad_ratio", f)
    transitions = _json_object(df, "transition_ratio", f)
    grids = _json_object(df, "rhythm_grid", f)
    _ratio_map(pads, "pad_ratio", f)
    _ratio_map(transitions, "transition_ratio", f)
    for grid in grids:
        if "groups" not in grid and "excluded" not in grid:
            raise _bad(f, "rhythm_grid", "groups 또는 excluded가 있어야 합니다")
    out["pad_ratio"] = pads
    out["transition_ratio"] = transitions
    out["rhythm_grid"] = grids
    return out.reset_index(drop=True)


def _interactions(
    df: pd.DataFrame, users: set[str], song_ids: set[int], chart_song: dict[int, int]
) -> pd.DataFrame:
    f = "interactions"
    out = pd.DataFrame(
        {
            "user_key": _user_keys(df, "user_key", f),
            "song_id": _int(df, "song_id", f, minimum=1),
            "chart_id": _int(df, "chart_id", f, minimum=1),
            "played_at": _time(df, "played_at", f),
            "accuracy": _float(df, "accuracy", f, minimum=0, maximum=100),
            "completed": _bool(df, "completed", f),
            "mode": _choice(df, "mode", f, S.MODES),
        }
    )
    _no_full_duplicates(out, f)
    _references(out, users, song_ids, chart_song, f)
    # 시간순. 같은 시각이면 원래 순서를 지킨다(분할이 결정적이도록).
    return out.sort_values("played_at", kind="stable").reset_index(drop=True)


def _exposures(
    df: pd.DataFrame, users: set[str], song_ids: set[int], chart_song: dict[int, int]
) -> pd.DataFrame:
    f = "exposures"
    if df.empty:
        return pd.DataFrame({c: pd.Series(dtype="object") for c in S.FILES["exposures"].required})
    out = pd.DataFrame(
        {
            "user_key": _user_keys(df, "user_key", f),
            "song_id": _int(df, "song_id", f, minimum=1),
            "chart_id": _int(df, "chart_id", f, minimum=1),
            "shown_at": _time(df, "shown_at", f),
            "clicked": _bool(df, "clicked", f),
            "context": _choice(df, "context", f, S.CONTEXTS),
            "strategy": _nonblank(df, "strategy", f),
        }
    )
    _references(out, users, song_ids, chart_song, f)
    return out.sort_values("shown_at", kind="stable").reset_index(drop=True)


def _references(
    df: pd.DataFrame, users: set[str], song_ids: set[int], chart_song: dict[int, int], file: str
) -> None:
    _within(df["user_key"], users, file, "user_key", "users")
    _within(df["song_id"], song_ids, file, "song_id", "songs")
    _within(df["chart_id"], set(chart_song), file, "chart_id", "chart_features")
    if not (df["chart_id"].map(chart_song) == df["song_id"]).all():
        raise _bad(file, "chart_id", "채보가 다른 곡의 것입니다(chart_features의 song_id와 다름)")


def _year(text: str) -> int | None:
    if text == "":
        return None
    if re.fullmatch(r"(19|20)\d\d", text) is None:
        raise _bad("song_meta", "release_year", "네 자리 연도(1900~2099)여야 합니다(모르면 비움)")
    return int(text)


def _energy(text: str) -> int | None:
    if text == "":
        return None
    if re.fullmatch(r"[1-5]", text) is None:
        raise _bad("song_meta", "energy", "1~5 정수여야 합니다(모르면 비움)")
    return int(text)


def _split_list(text: str) -> tuple[str, ...]:
    return tuple(p.strip() for p in text.split(";") if p.strip())


def _song_meta(df: pd.DataFrame, song_ids: set[int]) -> pd.DataFrame:
    f = "song_meta"
    columns = [
        "song_id",
        "genre",
        "sub_genres",
        "mood",
        "energy",
        "language",
        "drum_style",
        "release_year",
    ]
    if df.empty:
        return pd.DataFrame({c: pd.Series(dtype="object") for c in columns})
    out = pd.DataFrame({"song_id": _int(df, "song_id", f, minimum=1)})
    _unique(out["song_id"], f, "song_id")
    _within(out["song_id"], song_ids, f, "song_id", "songs")

    def column(name: str) -> pd.Series:
        return (
            df[name].str.strip()
            if name in df.columns
            else pd.Series([""] * len(df), index=df.index)
        )

    def lists(name: str, allowed: tuple[str, ...], limit: int) -> pd.Series:
        parsed = column(name).map(_split_list)
        for values in parsed:
            if any(v not in allowed for v in values):
                raise _bad(f, name, f"{allowed} 중에서만 고를 수 있습니다")
            if len(values) > limit:
                raise _bad(f, name, f"최대 {limit}개입니다")
        return parsed

    genre = column("genre")
    if not genre.isin(("",) + S.GENRES).all():
        raise _bad(f, "genre", f"{S.GENRES} 중 하나여야 합니다(모르면 비움)")
    language = column("language")
    if not language.isin(("",) + S.LANGUAGES).all():
        raise _bad(f, "language", f"{S.LANGUAGES} 중 하나여야 합니다(모르면 비움)")
    out["genre"] = genre
    out["sub_genres"] = lists("sub_genres", S.GENRES, 2)
    out["mood"] = lists("mood", S.MOODS, 2)
    out["energy"] = [_energy(t) for t in column("energy")]
    out["language"] = language
    out["drum_style"] = lists("drum_style", S.DRUM_STYLES, 3)
    out["release_year"] = [_year(t) for t in column("release_year")]
    return out.reset_index(drop=True)


def _weak_summary(df: pd.DataFrame, users: set[str]) -> pd.DataFrame:
    f = "weak_summary"
    if df.empty:
        return pd.DataFrame(
            {c: pd.Series(dtype="object") for c in S.FILES["weak_summary"].required}
        )
    out = pd.DataFrame(
        {
            "user_key": _user_keys(df, "user_key", f),
            "pattern": _nonblank(df, "pattern", f),
            "pad": df["pad"].str.strip(),
            "count": _int(df, "count", f, minimum=1),
            "avg_severity": _float(df, "avg_severity", f, minimum=0, maximum=1),
        }
    )
    _within(out["user_key"], users, f, "user_key", "users")
    return out.reset_index(drop=True)


# ---------------------------------------------------------------- 시간순 분할


@dataclass(frozen=True)
class Split:
    """시간순 분할(부록 B.7). `train`은 모두 `cutoff` 이전이고 시험 목표는 모두 그 이후다."""

    cutoff: pd.Timestamp
    train: pd.DataFrame
    warm_test: pd.DataFrame  # 목표 곡이 학습 구간에 있던 곡
    cold_test: pd.DataFrame  # 목표 곡이 학습 구간에 한 번도 나오지 않은 새 곡


def temporal_split(
    interactions: pd.DataFrame,
    *,
    cutoff_quantile: float = 0.8,
    cutoff: pd.Timestamp | None = None,
) -> Split:
    """전체 연주를 시각 기준 하나로 나눈다. 미래 정보가 새지 않는 다음 연주 맞히기 설정이다.

    - 학습: `played_at < cutoff`인 모든 연주.
    - 시험 목표: 학습 구간에 연주가 있는 사용자마다 `cutoff` 이후의 **첫 연주** 하나.
    - 학습 구간에 없던 곡이 목표인 행은 `cold_test`(새 곡), 나머지는 `warm_test`.
    - `repeat` 열은 그 사용자가 학습 구간에서 이미 친 곡이 목표인지 알려 준다(평가에서 제외할지 고른다).
    """
    if interactions.empty:
        raise DataError("연주 기록이 비어 있어 분할할 수 없습니다.")
    if not 0 < cutoff_quantile < 1:
        raise DataError("cutoff_quantile은 0과 1 사이여야 합니다.")
    ordered = interactions.sort_values("played_at", kind="stable").reset_index(drop=True)
    if cutoff is None:
        cutoff = ordered["played_at"].iloc[int(len(ordered) * cutoff_quantile)]
    cutoff = pd.Timestamp(cutoff)
    if cutoff.tzinfo is None:
        cutoff = cutoff.tz_localize("UTC")

    train = ordered[ordered["played_at"] < cutoff].reset_index(drop=True)
    after = ordered[ordered["played_at"] >= cutoff]
    if train.empty or after.empty:
        raise DataError("cutoff 앞뒤에 연주가 모두 있어야 합니다.")

    targets = after[after["user_key"].isin(set(train["user_key"]))].drop_duplicates(
        "user_key", keep="first"
    )
    seen_songs = set(train["song_id"])
    played_before = set(zip(train["user_key"], train["song_id"], strict=True))
    targets = targets.assign(
        repeat=[
            (u, s) in played_before
            for u, s in zip(targets["user_key"], targets["song_id"], strict=True)
        ]
    )
    warm = targets[targets["song_id"].isin(seen_songs)].reset_index(drop=True)
    cold = targets[~targets["song_id"].isin(seen_songs)].reset_index(drop=True)
    return Split(cutoff, train, warm, cold)
