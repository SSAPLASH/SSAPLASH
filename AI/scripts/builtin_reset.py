"""운영 공용 곡 전부 지우고 다시 올리기 (BE 이원빈 요청 2026-11-09).

순서 (각 단계는 따로 실행. 토큰은 SSAPLASH_ADMIN_TOKEN 또는 실행할 때 안 보이게 입력)
1. backup: 관리자 곡 목록·상세를 `<backup>/backup.json`에, 반주·커버 파일을 `<backup>/files/`에 받아 둠.
   반주는 공개 곡만 받을 수 있음(공개 API로 서명 URL을 받음). 곡마다 다시 만들 수 있는지 표시:
   BE 카탈로그(`BE/src/main/resources/builtin-songs/catalog.json`)에 있는 제목이면 카탈로그 MIDI로,
   NCS 50곡 표에 있으면 `ncs_register.py`로 다시 만듦. 둘 다 아니면 다시 만들 수 없음
2. delete-all: 지금 관리자 목록의 공용 곡을 전부 지움(소프트 삭제). backup.json에 없는 곡이 있거나
   다시 만들 수 없는 곡이 있으면 멈춤(`--allow-unrestorable`로 넘김). `--dry-run`이면 지울 목록만 찍음
3. restore-catalog: 카탈로그 곡을 카탈로그 MIDI·offsetMs로 관리자 MIDI 등록(공개 끔) → 받아 둔 반주·커버 올림 →
   백업 때 공개였던 곡만 공개. 제목·아티스트가 같은 곡이 이미 있으면 등록은 건너뛰고 빠진 반주·커버만 올림
   (BE가 재시작하며 카탈로그로 다시 만든 경우). 곡 추천 메타데이터는 BE가 다음 재시작 때 카탈로그로 채움
4. NCS 50곡은 `ncs_register.py --bulk data/ncs/bulk --all`

카탈로그는 운영 브랜치 파일을 git으로 읽음(`--catalog-ref`, 기본 origin/main). 실행 전에 `git fetch origin main`.

AI/ 에서
  uv run python scripts/builtin_reset.py backup --backup data/builtin_backup
  uv run python scripts/builtin_reset.py delete-all --backup data/builtin_backup --dry-run
  uv run python scripts/builtin_reset.py delete-all --backup data/builtin_backup
  uv run python scripts/builtin_reset.py restore-catalog --backup data/builtin_backup
"""

from __future__ import annotations

import argparse
import csv
import getpass
import io
import json
import os
import subprocess
import sys
from pathlib import Path

import requests
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ncs_register import (  # noqa: E402
    DEFAULT_BASE_URL,
    TIMEOUT_SEC,
    TOKEN_ENV,
    UPLOAD_TIMEOUT_SEC,
    AdminClient,
    AuthError,
    Row,
    index_existing,
)

CATALOG_PATH = "BE/src/main/resources/builtin-songs/catalog.json"
MIDI_DIR = "BE/src/main/resources/builtin-songs/midi"
NCS_SONGS = Path("configs/ncs/songs.csv")
ACCOMP_MAX_BYTES = 50 * 2**20


def git_show(ref: str, path: str) -> bytes:
    root = Path(__file__).resolve().parents[2]
    r = subprocess.run(["git", "-C", str(root), "show", f"{ref}:{path}"], capture_output=True)
    if r.returncode != 0:
        raise ValueError(f"git show {ref}:{path} 실패: {r.stderr.decode(errors='replace')[:200]}")
    return r.stdout


def load_catalog(ref: str) -> list[dict]:
    return json.loads(git_show(ref, CATALOG_PATH).decode("utf-8"))


def ncs_titles() -> set[tuple[str, str]]:
    with open(NCS_SONGS, encoding="utf-8", newline="") as f:
        return {(r["title"], r["artist"]) for r in csv.DictReader(f)}


def audio_kind(data: bytes) -> str:
    """파일 앞 바이트로 형식. wav·mp3·flac·ogg·unknown."""
    if data[:4] == b"RIFF":
        return "wav"
    if data[:3] == b"ID3" or (len(data) > 1 and data[0] == 0xFF and data[1] & 0xE0 == 0xE0):
        return "mp3"
    if data[:4] == b"fLaC":
        return "flac"
    if data[:4] == b"OggS":
        return "ogg"
    return "unknown"


def image_ext(data: bytes) -> str:
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return "bin"


def to_uploadable(path: Path) -> Path:
    """관리자 반주 업로드는 wav·mp3만 받음. flac·ogg면 같은 폴더에 16bit WAV로 바꿔 그 경로."""
    data = path.read_bytes()
    kind = audio_kind(data)
    if kind in ("wav", "mp3"):
        return path
    audio, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
    out = path.with_suffix(".upload.wav")
    sf.write(str(out), audio, sr, subtype="PCM_16")
    return out


class ResetClient(AdminClient):
    def __init__(self, base_url: str, token: str, session: requests.Session | None = None):
        super().__init__(base_url, token, session)
        self.api = base_url.rstrip("/") + "/api/v1"

    def detail(self, song_id: int) -> dict:
        r = self._check(
            self.session.get(f"{self.base}/{song_id}", headers=self.headers, timeout=TIMEOUT_SEC)
        )
        r.raise_for_status()
        return r.json()

    def accompaniment_url(self, song_id: int) -> str | None:
        r = self._check(
            self.session.get(
                f"{self.api}/songs/{song_id}/accompaniment",
                headers=self.headers,
                timeout=TIMEOUT_SEC,
            )
        )
        if r.status_code != 200:
            return None
        return r.json().get("accompanimentUrl")

    def download(self, url: str) -> bytes:
        # 서명 URL이라 인증 헤더를 붙이지 않음
        r = self.session.get(url, timeout=UPLOAD_TIMEOUT_SEC)
        r.raise_for_status()
        return r.content

    def upload_cover(self, song_id: int, path: Path) -> None:
        mime = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}.get(
            path.suffix[1:], ""
        )
        with open(path, "rb") as f:
            r = self._check(
                self.session.put(
                    f"{self.base}/{song_id}/cover",
                    files={"file": (path.name, f, mime)},
                    headers=self.headers,
                    timeout=TIMEOUT_SEC,
                )
            )
        if r.status_code != 200:
            raise RuntimeError(f"커버 {r.status_code}: {r.text[:300]}")


def cmd_backup(client: ResetClient, backup: Path, catalog: list[dict]) -> int:
    files = backup / "files"
    files.mkdir(parents=True, exist_ok=True)
    cat_titles = {c["title"] for c in catalog}
    ncs = ncs_titles()
    songs = []
    for s in client.list_all():
        d = client.detail(s["id"])
        rec = {"summary": s, "detail": d, "accompaniment": None, "cover": None}
        if (s["title"], s.get("artist") or "") in ncs:
            rec["restore"] = "ncs"
        elif s["title"] in cat_titles:
            rec["restore"] = "catalog"
        else:
            rec["restore"] = "none"
        note = []
        if s.get("hasAccompaniment") and rec["restore"] != "ncs":
            url = client.accompaniment_url(s["id"])
            if url:
                data = client.download(url)
                p = files / f"{s['id']}_accompaniment.{audio_kind(data)}"
                p.write_bytes(data)
                rec["accompaniment"] = p.name
                note.append(f"반주 {len(data) / 2**20:.1f}MiB")
            else:
                note.append("반주 못 받음(비공개 곡이거나 오류)")
        if d.get("coverUrl") and rec["restore"] != "ncs":
            data = client.download(d["coverUrl"])
            p = files / f"{s['id']}_cover.{image_ext(data)}"
            p.write_bytes(data)
            rec["cover"] = p.name
            note.append("커버")
        songs.append(rec)
        print(f"{s['id']} {s['title']} [{rec['restore']}] {' '.join(note)}", flush=True)
    (backup / "backup.json").write_text(
        json.dumps(songs, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    counts = {k: sum(r["restore"] == k for r in songs) for k in ("catalog", "ncs", "none")}
    print(
        f"{len(songs)}곡 백업 → {backup / 'backup.json'}. 카탈로그 {counts['catalog']}, NCS {counts['ncs']}, 다시 만들 수 없음 {counts['none']}"
    )
    lost = [
        r
        for r in songs
        if r["restore"] != "ncs" and r["summary"].get("hasAccompaniment") and not r["accompaniment"]
    ]
    if lost:
        print("반주를 못 받은 곡: " + ", ".join(r["summary"]["title"] for r in lost))
    return 0


def load_backup(backup: Path) -> list[dict]:
    path = backup / "backup.json"
    if not path.is_file():
        raise ValueError(f"{path} 없음. backup을 먼저 실행")
    return json.loads(path.read_text(encoding="utf-8"))


def cmd_delete_all(
    client: ResetClient, backup: Path, dry_run: bool, allow_unrestorable: bool
) -> int:
    saved = {r["summary"]["id"]: r for r in load_backup(backup)}
    current = client.list_all()
    missing = [s for s in current if s["id"] not in saved]
    if missing:
        print(
            "백업에 없는 곡이 있어 멈춤. backup을 다시 실행: "
            + ", ".join(f"{s['id']} {s['title']}" for s in missing)
        )
        return 1
    bad = [s for s in current if saved[s["id"]]["restore"] == "none"]
    if bad and not allow_unrestorable:
        print(
            "다시 만들 수 없는 곡이 있어 멈춤(--allow-unrestorable로 넘김): "
            + ", ".join(s["title"] for s in bad)
        )
        return 1
    for s in current:
        if dry_run:
            print(f"삭제 예정 {s['id']} {s['title']} [{saved[s['id']]['restore']}]")
        else:
            client.delete(s["id"])
            print(f"삭제 {s['id']} {s['title']}", flush=True)
    print(f"{len(current)}곡 {'삭제 예정' if dry_run else '삭제'}")
    return 0


def cmd_restore_catalog(
    client: ResetClient, backup: Path, catalog: list[dict], ref: str, dry_run: bool
) -> int:
    saved = [r for r in load_backup(backup) if r["restore"] == "catalog"]
    by_title = {r["summary"]["title"]: r for r in saved}
    work = backup / "midi"
    work.mkdir(parents=True, exist_ok=True)
    existing = index_existing(client.list_all())
    failed = 0
    for entry in catalog:
        rec = by_title.get(entry["title"])
        s = rec["summary"] if rec else {}
        title = entry["title"]
        artist = s.get("artist") or entry.get("artist") or ""
        license_ = s.get("license") or entry["license"]
        done = []
        try:
            song = existing.get((title, artist), {})
            if song is None:
                raise RuntimeError("같은 제목·아티스트 곡이 둘 이상")
            if not song:
                if dry_run:
                    print(
                        f"{title}: 등록 예정, 반주 {'있음' if rec and rec['accompaniment'] else '없음'}, 커버 {'있음' if rec and rec['cover'] else '없음'}"
                    )
                    continue
                midi = work / entry["midi"]
                midi.write_bytes(git_show(ref, f"{MIDI_DIR}/{entry['midi']}"))
                row = Row(
                    "", title, artist, midi, midi, str(int(entry.get("offsetMs", 0))), license_
                )
                sid = client.register(row)
                song = {"id": sid, "hasAccompaniment": False, "hasCover": False, "published": False}
                done.append("등록")
            sid = song["id"]
            if rec and rec["accompaniment"] and not song.get("hasAccompaniment"):
                up = to_uploadable(backup / "files" / rec["accompaniment"])
                if up.stat().st_size > ACCOMP_MAX_BYTES:
                    raise RuntimeError(f"반주 {up.stat().st_size / 2**20:.1f}MiB, 50MiB 넘음")
                if not dry_run:
                    client.upload_accompaniment(sid, Row("", title, artist, up, up, "", ""))
                done.append("반주")
            if rec and rec["cover"] and not song.get("hasCover"):
                if not dry_run:
                    client.upload_cover(sid, backup / "files" / rec["cover"])
                done.append("커버")
            want = (
                s.get("published", entry.get("published", True))
                if rec
                else entry.get("published", True)
            )
            if want and not song.get("published"):
                if not dry_run:
                    client.publish(sid)
                done.append("공개")
            print(f"{title}: {', '.join(done) or '할 일 없음'}", flush=True)
        except (RuntimeError, ValueError, requests.RequestException) as e:
            failed += 1
            print(f"{title}: 실패 {e}", flush=True)
    print(f"카탈로그 {len(catalog)}곡 처리, 실패 {failed}")
    return 2 if failed else 0


def main(argv: list[str] | None = None, session: requests.Session | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("step", choices=["backup", "delete-all", "restore-catalog"])
    ap.add_argument("--backup", type=Path, default=Path("data/builtin_backup"))
    ap.add_argument("--base-url", default=DEFAULT_BASE_URL)
    ap.add_argument("--catalog-ref", default="origin/main", help="카탈로그를 읽을 git 브랜치")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--allow-unrestorable", action="store_true")
    args = ap.parse_args(argv)
    token = os.environ.get(TOKEN_ENV, "").strip()
    if not token and sys.stdin.isatty():
        token = getpass.getpass("관리자 access 토큰 붙여 넣고 Enter (화면에 안 보임): ").strip()
    token = token[7:].strip() if token.lower().startswith("bearer ") else token
    if not token:
        print(f"환경 변수 {TOKEN_ENV}에 관리자 access 토큰을 넣고 실행", file=sys.stderr)
        return 1
    client = ResetClient(args.base_url, token, session)
    try:
        if args.step == "backup":
            return cmd_backup(client, args.backup, load_catalog(args.catalog_ref))
        if args.step == "delete-all":
            return cmd_delete_all(client, args.backup, args.dry_run, args.allow_unrestorable)
        return cmd_restore_catalog(
            client, args.backup, load_catalog(args.catalog_ref), args.catalog_ref, args.dry_run
        )
    except AuthError as e:
        print(f"멈춤: {e}. 새 토큰을 넣고 같은 명령을 다시 실행", file=sys.stderr)
        return 3
    except ValueError as e:
        print(f"실패: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
