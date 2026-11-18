"""NCS 기본곡 50곡 원본 음원을 `configs/ncs/songs.csv` 순서대로 모음.

- 파일 이름은 `ncs_NN 아티스트 - 제목.opus`(ncs.io 표기, 윈도에서 못 쓰는 글자는 뺌). 예전 이름 파일은 지움
- 원본 폴더에서 파일 이름 끝 `[유튜브 영상 ID].opus`로 곡을 찾음. 한 곡도 빠지거나 겹치면 실패
- 표 검사: 50곡, 번호 01~50, 영상 ID·ncs.io 경로 중복 없음, 제목·아티스트 100자 이하, 라이선스 200자 이하
  (BE 관리자 곡 등록 제한)
- 복사본 길이를 읽어 `<출력 폴더>/durations.csv`에 남김. 이미 같은 크기 파일이 있으면 복사 건너뜀

AI/ 에서
  uv run python scripts/ncs_prepare.py --src C:/Users/SSAFY --out data/ncs/audio

종료 코드: 0 정상, 1 표·원본 오류.
"""

from __future__ import annotations

import argparse
import csv
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

from ssaplash_ai.chart.audio_io import probe

DEFAULT_SONGS = Path("configs/ncs/songs.csv")
COLUMNS = [
    "no",
    "candidate_no",
    "youtube_id",
    "title",
    "artist",
    "ncs_path",
    "genre",
    "year",
    "license",
]
N_SONGS = 50
TITLE_MAX = 100
ARTIST_MAX = 100
LICENSE_MAX = 200
ID_IN_NAME = re.compile(r"\[([\w-]{11})\]\.opus$")
INVALID_CHARS = re.compile(r'[<>:"/\\|?*]')


@dataclass(frozen=True)
class Song:
    no: str
    youtube_id: str
    title: str
    artist: str
    ncs_path: str
    license: str

    @property
    def stem(self) -> str:
        """파일·폴더 이름. `ncs_01 Cartoon, Jéja - On & On (feat. Daniel Levi)`처럼 번호 + 아티스트 - 제목."""
        return safe_name(f"ncs_{self.no} {self.artist} - {self.title}")


def safe_name(name: str) -> str:
    """윈도에서 파일 이름에 못 쓰는 글자(<>:"/\\|?*) 빼기, 끝의 점·공백 빼기."""
    return INVALID_CHARS.sub("", name).rstrip(". ")


def read_songs(path: Path) -> list[Song]:
    """songs.csv 읽기와 검사. 문제가 있으면 모든 문제를 모아 ValueError."""
    with open(path, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != COLUMNS:
            raise ValueError(f"열이 다름: {reader.fieldnames} (기대 {COLUMNS})")
        rows = list(reader)
    errors: list[str] = []
    if len(rows) != N_SONGS:
        errors.append(f"곡 수 {len(rows)} (기대 {N_SONGS})")
    songs: list[Song] = []
    for i, r in enumerate(rows, start=1):
        where = f"{i}번째 줄"
        if r["no"] != f"{i:02d}":
            errors.append(f"{where}: no {r['no']!r} (기대 {i:02d})")
        if not ID_IN_NAME.search(f"[{r['youtube_id']}].opus"):
            errors.append(f"{where}: 유튜브 ID 형식 {r['youtube_id']!r}")
        for col, limit in (("title", TITLE_MAX), ("artist", ARTIST_MAX), ("license", LICENSE_MAX)):
            if not r[col].strip():
                errors.append(f"{where}: {col} 비어 있음")
            elif len(r[col]) > limit:
                errors.append(f"{where}: {col} {len(r[col])}자 ({limit}자 초과)")
        songs.append(
            Song(r["no"], r["youtube_id"], r["title"], r["artist"], r["ncs_path"], r["license"])
        )
    for col in ("youtube_id", "ncs_path"):
        values = [getattr(s, col) for s in songs]
        dup = sorted({v for v in values if values.count(v) > 1})
        if dup:
            errors.append(f"{col} 중복: {', '.join(dup)}")
    if errors:
        raise ValueError("\n".join(errors))
    return songs


def find_sources(src: Path, songs: list[Song]) -> dict[str, Path]:
    """원본 폴더 바로 아래 opus에서 곡별 파일 찾기. 빠지거나 겹치면 ValueError."""
    found: dict[str, list[Path]] = {}
    for p in sorted(src.glob("*.opus")):
        m = ID_IN_NAME.search(p.name)
        if m:
            found.setdefault(m.group(1), []).append(p)
    errors: list[str] = []
    result: dict[str, Path] = {}
    for s in songs:
        hits = found.get(s.youtube_id, [])
        if not hits:
            errors.append(f"{s.no} {s.artist} - {s.title}: [{s.youtube_id}].opus 없음")
        elif len(hits) > 1:
            errors.append(
                f"{s.no} {s.title}: 같은 ID 파일 {len(hits)}개 ({', '.join(h.name for h in hits)})"
            )
        else:
            result[s.youtube_id] = hits[0]
    if errors:
        raise ValueError("\n".join(errors))
    return result


def copy_song(source: Path, dest: Path) -> bool:
    """복사. 같은 크기 파일이 이미 있으면 건너뛰고 False."""
    if dest.is_file() and dest.stat().st_size == source.stat().st_size:
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, dest)
    return True


def prepare(src: Path, songs_csv: Path, out: Path) -> list[dict]:
    """표 검사 → 원본 찾기 → 복사 → 길이 표. durations.csv 행 목록 반환."""
    songs = read_songs(songs_csv)
    sources = find_sources(src, songs)
    # 이름 규칙이 바뀌어 남은 예전 파일(ncs_01.opus 등) 지우기. 같은 곡이 두 번 채보되지 않게
    expected = {f"{s.stem}.opus" for s in songs}
    for old in out.glob("ncs_*.opus") if out.is_dir() else []:
        if old.name not in expected:
            old.unlink()
    rows: list[dict] = []
    for s in songs:
        dest = out / f"{s.stem}.opus"
        copied = copy_song(sources[s.youtube_id], dest)
        info = probe(dest)
        rows.append(
            {
                "file": dest.name,
                "title": s.title,
                "artist": s.artist,
                "duration_ms": round(info.duration_sec * 1000),
                "sample_rate": info.sample_rate,
                "channels": info.channels,
                "bytes": dest.stat().st_size,
                "copied": copied,
            }
        )
    with open(out / "durations.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]), lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    return rows


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--src", type=Path, required=True, help="유튜브에서 받은 opus가 있는 폴더")
    ap.add_argument("--songs", type=Path, default=DEFAULT_SONGS, help="50곡 표")
    ap.add_argument("--out", type=Path, default=Path("data/ncs/audio"), help="곡 파일을 둘 폴더")
    args = ap.parse_args(argv)
    try:
        rows = prepare(args.src, args.songs, args.out)
    except ValueError as e:
        print(f"실패:\n{e}", file=sys.stderr)
        return 1
    secs = [r["duration_ms"] / 1000 for r in rows]
    print(
        f"{len(rows)}곡 준비, 새로 복사 {sum(r['copied'] for r in rows)}곡, "
        f"길이 {min(secs):.1f}~{max(secs):.1f}초, 합 {sum(r['bytes'] for r in rows) / 2**20:.1f} MiB → {args.out}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
