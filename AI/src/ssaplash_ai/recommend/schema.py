"""PoC 입력 파일의 스키마(설계 문서 부록 B.2). 로더(`data.py`)가 이 표로 검증한다.

데이터가 합성이든 내부 계정이든 운영 내보내기든 이 모양이면 같은 코드가 돈다.
"""

from __future__ import annotations

from dataclasses import dataclass

# 데이터 출처 단계(부록 B.3). P2(일반 사용자)는 동의 범위가 정해진 뒤에만 쓴다.
STAGE_SYNTHETIC = "P0"
STAGE_INTERNAL = "P1"
STAGE_PRODUCTION = "P2"
STAGES = (STAGE_SYNTHETIC, STAGE_INTERNAL, STAGE_PRODUCTION)

MODES = ("RHYTHM", "SHEET")
DIFFICULTIES = ("EASY", "NORMAL", "HARD")
SONG_LEVELS = ("BEGINNER", "INTERMEDIATE", "ADVANCED")
CONTEXTS = ("SONG_PICKER", "REPORT", "SIMILAR")

# 곡 메타데이터 값 목록(원빈 요청 문서 TECH_곡-메타데이터-제작과 같다)
GENRES = (
    "ROCK",
    "POP",
    "KPOP",
    "BALLAD",
    "JAZZ",
    "FUNK",
    "LATIN",
    "METAL",
    "PUNK",
    "HIPHOP",
    "ELECTRONIC",
    "SOUNDTRACK",
    "PRACTICE",
    "OTHER",
)
MOODS = ("CALM", "UPLIFTING", "ENERGETIC", "DARK", "SENTIMENTAL")
DRUM_STYLES = (
    "EIGHT_BEAT",
    "SIXTEEN_BEAT",
    "SHUFFLE",
    "HALF_TIME",
    "FOUR_ON_FLOOR",
    "DOUBLE_KICK",
    "SYNCOPATED",
    "FILL_HEAVY",
    "LATIN_PERCUSSION",
)
LANGUAGES = ("KO", "EN", "JA", "INSTRUMENTAL", "OTHER")

# 어느 파일에도 있으면 안 되는 열: 개인을 가리킬 수 있는 값
FORBIDDEN_COLUMNS = frozenset(
    {
        "nickname",
        "nick",
        "email",
        "mail",
        "name",
        "username",
        "phone",
        "tel",
        "user_id",
        "userid",
        "account_id",
        "provider_user_id",
        "social_id",
        "ip",
        "ip_address",
        "device_id",
        "token",
    }
)


@dataclass(frozen=True)
class FileSpec:
    """파일 하나의 규칙. `required`는 필수 열, `optional`은 있으면 검증하는 열."""

    filename: str
    required: tuple[str, ...]
    optional: tuple[str, ...] = ()
    must_exist: bool = True


FILES = {
    "users": FileSpec("users.csv", ("user_key", "consent_recommendation", "consent_version")),
    "songs": FileSpec("songs.csv", ("song_id", "bpm", "duration_ms", "song_level", "public")),
    "chart_features": FileSpec(
        "chart_features.csv",
        (
            "chart_id",
            "song_id",
            "difficulty",
            "avg_notes_per_sec",
            "peak_notes_2s",
            "pad_ratio",
            "transition_ratio",
            "rhythm_grid",
        ),
    ),
    "interactions": FileSpec(
        "interactions.csv",
        ("user_key", "song_id", "chart_id", "played_at", "accuracy", "completed", "mode"),
    ),
    "exposures": FileSpec(
        "exposures.csv",
        ("user_key", "song_id", "chart_id", "shown_at", "clicked", "context", "strategy"),
        must_exist=False,
    ),
    "song_meta": FileSpec(
        "song_meta.csv",
        ("song_id",),
        ("genre", "sub_genres", "mood", "energy", "language", "drum_style", "release_year"),
        must_exist=False,
    ),
    "weak_summary": FileSpec(
        "weak_summary.csv",
        ("user_key", "pattern", "pad", "count", "avg_severity"),
        must_exist=False,
    ),
}

# 가명 키는 이 모양이어야 한다. 숫자만 있거나 이메일처럼 보이면 원래 계정 값일 수 있어 거부한다.
USER_KEY_PATTERN = r"[A-Za-z0-9_-]{8,64}"
