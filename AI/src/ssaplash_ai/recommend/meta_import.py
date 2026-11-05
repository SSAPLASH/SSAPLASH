"""공용 곡 메타데이터 초안(원빈이 만든 엑셀용 CSV)을 PoC 입력 `song_meta.csv`로 바꾼다(설계 문서 부록 B.2).

초안은 사람이 읽기 좋은 형식이다: UTF-8 BOM, camelCase 열(`subGenres`, `drumStyle`), 곡을 `title`·`artist`로 가리킨다.
PoC 입력은 곡을 `song_id`로 가리키고 snake_case 열을 쓴다. 이 도구가 그 사이를 잇는다.

- **곡 맞추기:** `catalog.csv`(열 `song_id`, `title`, `artist`; BE의 곡 목록)와 `(title, artist)`로 맞춘다. 먼저 글자 그대로, 안 되면
  유니코드 정규화·공백·대소문자·따옴표 표기를 무시한 비교로 맞추고 그 경우를 보고서에 센다. 아티스트가 비어 있는 곡(연습 패턴)은
  제목만 같으면 된다. 맞는 곡이 없거나 둘 이상이면 그 행은 넣지 않고 보고서에 남긴다(오류로 멈추지 않는다).
- **검증:** 허용 값 목록(`schema.py`)에서 벗어난 값은 모아서 `DataError`로 멈춘다. 추측해서 고치지 않는다.
  `source`가 `EXTERNAL_DB`인데 `sourceNote`가 비어 있어도 멈춘다. `source`·`sourceNote`는 검증에만 쓰고 출력에는 넣지 않는다.
- 곡이 DB에 아직 없으면 맞는 곡이 없는 행으로 남는다. 곡이 등록된 뒤 다시 돌리면 된다(같은 입력이면 같은 출력).
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

from ssaplash_ai.recommend import schema as S
from ssaplash_ai.recommend.data import DataError

HEADER_MAP = {
    "title": "title",
    "artist": "artist",
    "genre": "genre",
    "subGenres": "sub_genres",
    "mood": "mood",
    "energy": "energy",
    "releaseYear": "release_year",
    "language": "language",
    "drumStyle": "drum_style",
    "source": "source",
    "sourceNote": "source_note",
}
SOURCES = ("HUMAN", "AUTO", "EXTERNAL_DB")
OUT_COLUMNS = [
    "song_id",
    "genre",
    "sub_genres",
    "mood",
    "energy",
    "language",
    "drum_style",
    "release_year",
]


@dataclass
class ImportReport:
    """변환 결과. 개인 정보는 없고 곡 제목만 담는다."""

    matched: int = 0
    matched_normalized: int = 0
    unmatched: list[str] = field(default_factory=list)
    ambiguous: list[str] = field(default_factory=list)
    rows: int = 0

    def summary(self) -> str:
        return (
            f"초안 {self.rows}행 → 곡 맞춤 {self.matched}행(정규화 비교로 맞춘 것 {self.matched_normalized}행), "
            f"맞는 곡 없음 {len(self.unmatched)}행, 둘 이상과 맞음 {len(self.ambiguous)}행"
        )


def _normalize(text: str) -> str:
    """제목·아티스트 비교용: 유니코드 정규화, 따옴표 통일, 공백 정리, 소문자."""
    text = unicodedata.normalize("NFKC", text or "")
    text = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", text).strip().casefold()


def _read(path: Path) -> list[dict[str, str]]:
    try:
        with path.open(encoding="utf-8-sig", newline="") as f:
            return list(csv.DictReader(f))
    except (OSError, UnicodeDecodeError, csv.Error) as ex:
        raise DataError(
            f"{path.name}을 읽지 못했습니다(UTF-8 CSV 필요): {type(ex).__name__}"
        ) from ex


def _split(text: str) -> list[str]:
    return [p.strip() for p in (text or "").split(";") if p.strip()]


def _validate(rows: list[dict[str, str]]) -> None:
    problems: list[str] = []
    for i, r in enumerate(rows, start=2):  # 2행부터(1행은 머리글)
        where = f"{i}행 {r['title']!r}"
        if r["genre"] not in S.GENRES:
            problems.append(f"{where}: genre {r['genre']!r}")
        for key, allowed, limit in (
            ("sub_genres", S.GENRES, 2),
            ("mood", S.MOODS, 2),
            ("drum_style", S.DRUM_STYLES, 3),
        ):
            values = _split(r[key])
            bad = [v for v in values if v not in allowed]
            if bad:
                problems.append(f"{where}: {key} {bad}")
            if len(values) > limit:
                problems.append(f"{where}: {key}는 최대 {limit}개")
        if r["energy"] and not re.fullmatch(r"[1-5]", r["energy"]):
            problems.append(f"{where}: energy {r['energy']!r}")
        if r["release_year"] and not re.fullmatch(r"(19|20)\d\d", r["release_year"]):
            problems.append(f"{where}: release_year {r['release_year']!r}")
        if r["language"] and r["language"] not in S.LANGUAGES:
            problems.append(f"{where}: language {r['language']!r}")
        if r["source"] not in SOURCES:
            problems.append(f"{where}: source {r['source']!r}")
        if r["source"] == "EXTERNAL_DB" and not r["source_note"].strip():
            problems.append(f"{where}: EXTERNAL_DB는 source_note(이용 조건)가 필요합니다")
    if problems:
        shown = "\n  ".join(problems[:30])
        more = f"\n  … 외 {len(problems) - 30}건" if len(problems) > 30 else ""
        raise DataError(
            f"메타데이터 초안에 규격을 벗어난 값이 {len(problems)}건 있습니다:\n  {shown}{more}"
        )


def convert(draft: Path, catalog: Path, out: Path) -> ImportReport:
    """초안과 곡 목록을 읽어 `song_meta.csv`를 쓴다. 규격 위반이면 아무것도 쓰지 않고 `DataError`."""
    raw = _read(draft)
    if not raw:
        raise DataError("메타데이터 초안에 행이 없습니다.")
    unknown = [c for c in raw[0] if c not in HEADER_MAP]
    missing = [c for c in HEADER_MAP if c not in raw[0]]
    if unknown or missing:
        raise DataError(
            f"메타데이터 초안의 열이 규격과 다릅니다. 모르는 열 {unknown}, 빠진 열 {missing}"
        )
    rows = [{HEADER_MAP[k]: (v or "").strip() for k, v in r.items()} for r in raw]
    _validate(rows)

    songs = _read(catalog)
    if not songs or {"song_id", "title", "artist"} - set(songs[0]):
        raise DataError("곡 목록(catalog.csv)에는 song_id, title, artist 열이 필요합니다.")
    exact: dict[tuple[str, str], list[str]] = {}
    loose: dict[tuple[str, str], list[str]] = {}
    for s in songs:
        exact.setdefault((s["title"].strip(), (s["artist"] or "").strip()), []).append(
            s["song_id"].strip()
        )
        loose.setdefault((_normalize(s["title"]), _normalize(s["artist"])), []).append(
            s["song_id"].strip()
        )

    report = ImportReport(rows=len(rows))
    output: dict[str, dict[str, str]] = {}
    for r in rows:
        key = (r["title"], r["artist"])
        ids = exact.get(key)
        normalized = False
        if not ids:
            ids, normalized = loose.get((_normalize(r["title"]), _normalize(r["artist"]))), True
        label = f"{r['title']} / {r['artist']}" if r["artist"] else r["title"]
        if not ids:
            report.unmatched.append(label)
            continue
        if len(set(ids)) > 1:
            report.ambiguous.append(label)
            continue
        song_id = ids[0]
        if song_id in output:  # 같은 곡이 초안에 두 번 있으면 뒤의 것을 쓰지 않고 알린다
            report.ambiguous.append(label + " (초안에 중복)")
            continue
        output[song_id] = {c: r.get(c, "") for c in OUT_COLUMNS if c != "song_id"} | {
            "song_id": song_id
        }
        report.matched += 1
        report.matched_normalized += int(normalized)

    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=OUT_COLUMNS)
        writer.writeheader()
        for song_id in sorted(output, key=int):
            writer.writerow(output[song_id])
    return report


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="메타데이터 초안 → PoC song_meta.csv")
    p.add_argument(
        "--draft", type=Path, required=True, help="원빈의 메타데이터 CSV(엑셀용, BOM 가능)"
    )
    p.add_argument(
        "--catalog", type=Path, required=True, help="곡 목록 CSV(song_id, title, artist)"
    )
    p.add_argument("--out", type=Path, required=True, help="쓸 song_meta.csv")
    args = p.parse_args(argv)
    try:
        report = convert(args.draft, args.catalog, args.out)
    except DataError as ex:
        print(f"데이터 오류: {ex}", file=sys.stderr)
        return 2
    print(report.summary())
    for title in report.unmatched:
        print(f"  곡 없음: {title}")
    for title in report.ambiguous:
        print(f"  모호함: {title}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
