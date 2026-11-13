"""NCS 기본곡 50곡을 BE 관리자 API로 공용 곡 일괄 등록·공개.

입력: `ncs_make_bulk.py`가 만든 `<bulk>/register.csv`와 같은 폴더의 MIDI·WAV.
- 등록: 곡마다 `POST /api/v1/admin/songs/midi`(제목·아티스트·라이선스·offsetMs·공개 false·MIDI)
  → `PUT /api/v1/admin/songs/{id}/accompaniment`(WAV)
- 관리자 곡 목록에 제목·아티스트가 같은 곡이 있으면 등록은 건너뛰고, 반주가 없을 때만 올림. 끊겨도 다시 실행하면 이어서 감
- `--publish`: 등록된 곡을 공개로 바꿈(`PATCH /api/v1/admin/songs/{id}` published true). `--skip`으로 뺄 곡 번호 지정
- `--dry-run`: 목록만 읽고 무엇을 할지 찍음. 쓰기 요청 없음
- `--all`: 한 번에 숨김 등록 → 목록을 다시 읽어 3난이도·반주 확인 → 확인된 곡만 공개
- `--replace-fixed`: `check.csv`에서 bpm을 고친 곡을 먼저 지우고(`DELETE /api/v1/admin/songs/{id}`) 다시 등록.
  관리자 채보 교체 API는 첫 박 위치를 바꿀 수 없어서 지우고 다시 올림

토큰: 관리자 계정 access 토큰. 환경 변수 SSAPLASH_ADMIN_TOKEN이 없으면 터미널에서 안 보이게 입력받음.
화면·파일에 남기지 않음.
access 토큰은 30분이면 만료되므로 401이 나오면 멈춤. 새 토큰을 넣고 다시 실행하면 남은 곡부터.

AI/ 에서
  uv run python scripts/ncs_register.py --bulk data/ncs/bulk --dry-run
  uv run python scripts/ncs_register.py --bulk data/ncs/bulk
  uv run python scripts/ncs_register.py --bulk data/ncs/bulk --publish --skip 07,22

결과는 `<bulk>/register_result.csv`(곡별 id·한 일·결과).
종료 코드: 0 정상, 1 입력 오류, 2 일부 곡 실패, 3 인증 실패(401·403)로 멈춤.
"""

from __future__ import annotations

import argparse
import csv
import getpass
import os
import sys
from dataclasses import dataclass
from pathlib import Path

import requests

DEFAULT_BASE_URL = "https://k15a307.p.ssafy.io"
ADMIN_SONGS = "/api/v1/admin/songs"
TOKEN_ENV = "SSAPLASH_ADMIN_TOKEN"
LIST_PAGE_SIZE = 100
UPLOAD_TIMEOUT_SEC = 600
TIMEOUT_SEC = 60
REGISTER_COLUMNS = ["제목", "아티스트", "MIDI", "드럼리스 MR", "offsetMs", "라이선스", "공개"]


class AuthError(Exception):
    """401·403. 토큰 만료나 관리자 아님."""


@dataclass
class Row:
    no: str
    title: str
    artist: str
    midi: Path
    wav: Path
    offset_ms: str
    license: str


def read_register(bulk: Path) -> list[Row]:
    """register.csv 읽기와 파일 확인. 문제가 있으면 모두 모아 ValueError."""
    path = bulk / "register.csv"
    if not path.is_file():
        raise ValueError(f"{path} 없음. ncs_make_bulk.py를 먼저 실행")
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != REGISTER_COLUMNS:
            raise ValueError(f"열이 다름: {reader.fieldnames}")
        raw = list(reader)
    rows, errors = [], []
    for r in raw:
        no = r["MIDI"].split(" ", 1)[0].removeprefix("ncs_")
        row = Row(
            no,
            r["제목"],
            r["아티스트"],
            bulk / r["MIDI"],
            bulk / r["드럼리스 MR"],
            r["offsetMs"],
            r["라이선스"],
        )
        for p in (row.midi, row.wav):
            if not p.is_file():
                errors.append(f"{no}: {p.name} 없음")
        rows.append(row)
    if errors:
        raise ValueError("\n".join(errors))
    return rows


class AdminClient:
    """관리자 공용 곡 API. session은 테스트에서 바꿔 끼움."""

    def __init__(self, base_url: str, token: str, session: requests.Session | None = None):
        self.base = base_url.rstrip("/") + ADMIN_SONGS
        self.session = session or requests.Session()
        self.headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}

    def _check(self, response: requests.Response) -> requests.Response:
        if response.status_code in (401, 403):
            raise AuthError(f"{response.status_code} 인증 실패. 토큰 만료 또는 관리자 계정 아님")
        return response

    def list_all(self) -> list[dict]:
        items, page = [], 0
        while True:
            r = self._check(
                self.session.get(
                    self.base,
                    params={"page": page, "size": LIST_PAGE_SIZE},
                    headers=self.headers,
                    timeout=TIMEOUT_SEC,
                )
            )
            r.raise_for_status()
            body = r.json()
            items += body["items"]
            if not body.get("hasNext"):
                return items
            page += 1

    def register(self, row: Row) -> int:
        data = {
            "title": row.title,
            "artist": row.artist,
            "license": row.license,
            "published": "false",
            "offsetMs": row.offset_ms,
        }
        with open(row.midi, "rb") as f:
            r = self._check(
                self.session.post(
                    self.base + "/midi",
                    data=data,
                    files={"file": (row.midi.name, f, "audio/midi")},
                    headers=self.headers,
                    timeout=TIMEOUT_SEC,
                )
            )
        if r.status_code != 201:
            raise RuntimeError(f"등록 {r.status_code}: {r.text[:300]}")
        return int(r.json()["id"])

    def upload_accompaniment(self, song_id: int, row: Row) -> None:
        with open(row.wav, "rb") as f:
            r = self._check(
                self.session.put(
                    f"{self.base}/{song_id}/accompaniment",
                    files={"file": (row.wav.name, f, "audio/wav")},
                    headers=self.headers,
                    timeout=UPLOAD_TIMEOUT_SEC,
                )
            )
        if r.status_code != 200:
            raise RuntimeError(f"반주 {r.status_code}: {r.text[:300]}")

    def publish(self, song_id: int) -> None:
        r = self._check(
            self.session.patch(
                f"{self.base}/{song_id}",
                json={"published": True},
                headers=self.headers,
                timeout=TIMEOUT_SEC,
            )
        )
        if r.status_code != 200:
            raise RuntimeError(f"공개 {r.status_code}: {r.text[:300]}")

    def delete(self, song_id: int) -> None:
        r = self._check(
            self.session.delete(f"{self.base}/{song_id}", headers=self.headers, timeout=TIMEOUT_SEC)
        )
        if r.status_code not in (200, 204):
            raise RuntimeError(f"삭제 {r.status_code}: {r.text[:300]}")


def fixed_numbers(bulk: Path) -> set[str]:
    """check.csv에서 bpm을 고친 곡 번호. 고친 MIDI로 바꾸려면 지우고 다시 등록해야 함
    (관리자 채보 교체 API는 첫 박 위치를 바꿀 수 없음)."""
    path = bulk / "check.csv"
    with open(path, encoding="utf-8-sig", newline="") as f:
        return {
            r["곡"].split(" ", 1)[0].removeprefix("ncs_")
            for r in csv.DictReader(f)
            if r.get("bpm 고침")
        }


def delete_songs(
    client: AdminClient, rows: list[Row], numbers: set[str], dry_run: bool
) -> list[str]:
    """번호에 해당하는 등록 곡(제목·아티스트 같은 곡)을 지움. 찍은 줄 목록 반환."""
    existing = index_existing(client.list_all())
    done = []
    for row in rows:
        if row.no not in numbers:
            continue
        song = existing.get((row.title, row.artist))
        if not song:
            msg = f"{row.no} {row.title}: 등록된 곡 없음, 지울 것 없음"
        elif dry_run:
            msg = f"{row.no} {row.title}: 삭제 예정 (id {song['id']})"
        else:
            client.delete(song["id"])
            msg = f"{row.no} {row.title}: 삭제 (id {song['id']})"
        print(msg, flush=True)
        done.append(msg)
    return done


def index_existing(items: list[dict]) -> dict[tuple[str, str], dict]:
    """(제목, 아티스트) → 곡 요약. 같은 제목·아티스트가 둘 이상이면 None으로 표시해 건드리지 않음."""
    out: dict[tuple[str, str], dict] = {}
    for it in items:
        key = (it["title"], it.get("artist") or "")
        out[key] = None if key in out else it
    return out


def run(
    client: AdminClient, rows: list[Row], *, dry_run: bool, publish: bool, skip: set[str]
) -> list[dict]:
    """곡마다 등록·반주·공개. 결과 행 목록. 인증 실패면 AuthError를 그대로 올림."""
    existing = index_existing(client.list_all())
    results = []
    for row in rows:
        res = {
            "번호": row.no,
            "제목": row.title,
            "아티스트": row.artist,
            "id": "",
            "한 일": "",
            "결과": "ok",
        }
        results.append(res)
        if row.no in skip:
            res["한 일"] = "건너뜀(--skip)"
            continue
        song = existing.get((row.title, row.artist), {})
        if song is None:
            res["결과"] = "같은 제목·아티스트 곡이 둘 이상이라 건드리지 않음"
            continue
        done: list[str] = []
        try:
            if publish:
                if not song:
                    res["결과"] = "등록 안 된 곡이라 공개 못 함"
                    continue
                res["id"] = song["id"]
                if song.get("published"):
                    done.append("이미 공개")
                elif not dry_run:
                    client.publish(song["id"])
                    done.append("공개")
                else:
                    done.append("공개 예정")
                continue
            song_id = song.get("id")
            if song_id is None:
                if dry_run:
                    done.append("등록 예정, 반주 예정")
                    continue
                song_id = client.register(row)
                done.append("등록")
            else:
                done.append("이미 등록")
            res["id"] = song_id
            if not song.get("hasAccompaniment"):
                if dry_run:
                    done.append("반주 예정")
                else:
                    client.upload_accompaniment(song_id, row)
                    done.append("반주")
            else:
                done.append("반주 이미 있음")
        except RuntimeError as e:
            res["결과"] = str(e)
        except requests.RequestException as e:
            res["결과"] = f"요청 실패: {type(e).__name__}"
        finally:
            res["한 일"] = ", ".join(done)
            print(f"{row.no} {row.artist} - {row.title}: {res['한 일']} {res['결과']}", flush=True)
    return results


def verify(client: AdminClient, rows: list[Row]) -> dict[str, str]:
    """등록 확인. 곡 번호 → 문제(없으면 빈 문자열). 3난이도와 반주가 모두 있어야 통과."""
    existing = index_existing(client.list_all())
    out = {}
    for row in rows:
        song = existing.get((row.title, row.artist))
        if not song:
            out[row.no] = "목록에 없음"
            continue
        problems = []
        missing = {"EASY", "NORMAL", "HARD"} - set(song.get("difficulties") or [])
        if missing:
            problems.append("난이도 없음 " + ",".join(sorted(missing)))
        if not song.get("hasAccompaniment"):
            problems.append("반주 없음")
        if song.get("status") not in (None, "READY"):
            problems.append(f"상태 {song.get('status')}")
        out[row.no] = "; ".join(problems)
    return out


def write_results(bulk: Path, results: list[dict]) -> Path:
    path = bulk / "register_result.csv"
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(results[0]), lineterminator="\n")
        w.writeheader()
        w.writerows(results)
    return path


def main(argv: list[str] | None = None, session: requests.Session | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--bulk", type=Path, default=Path("data/ncs/bulk"), help="register.csv·MIDI·WAV 폴더"
    )
    ap.add_argument("--base-url", default=DEFAULT_BASE_URL, help="서비스 주소")
    ap.add_argument("--dry-run", action="store_true", help="쓰기 요청 없이 할 일만 찍음")
    ap.add_argument("--publish", action="store_true", help="등록된 곡을 공개로 바꿈")
    ap.add_argument("--skip", default="", help="뺄 곡 번호, 쉼표로 (예 07,22)")
    ap.add_argument(
        "--all",
        action="store_true",
        help="한 번에: 숨김 등록 → 3난이도·반주 확인 → 확인된 곡만 공개",
    )
    ap.add_argument(
        "--replace-fixed",
        action="store_true",
        help="check.csv에서 bpm을 고친 곡을 먼저 지우고 다시 등록 (--all과 같이 씀)",
    )
    args = ap.parse_args(argv)
    token = os.environ.get(TOKEN_ENV, "").strip()
    if not token and sys.stdin.isatty():
        # 붙여 넣은 값이 화면에 안 보이게 받음
        token = getpass.getpass("관리자 access 토큰 붙여 넣고 Enter (화면에 안 보임): ").strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    if not token:
        print(f"환경 변수 {TOKEN_ENV}에 관리자 access 토큰을 넣고 실행", file=sys.stderr)
        return 1
    try:
        rows = read_register(args.bulk)
    except ValueError as e:
        print(f"실패: {e}", file=sys.stderr)
        return 1
    skip = {s.strip().zfill(2) for s in args.skip.split(",") if s.strip()}
    client = AdminClient(args.base_url, token, session)
    try:
        if args.replace_fixed:
            numbers = fixed_numbers(args.bulk) - skip
            print(
                f"bpm 고친 곡 {len(numbers)}개 지우고 다시 등록: {', '.join(sorted(numbers))}",
                flush=True,
            )
            delete_songs(client, rows, numbers, args.dry_run)
        results = run(client, rows, dry_run=args.dry_run, publish=args.publish, skip=skip)
        if args.all and not args.dry_run and not args.publish:
            print("등록 확인 중", flush=True)
            checked = verify(client, rows)
            for r in results:
                r["확인"] = checked.get(r["번호"], "") or "ok"
            ok = [r for r in results if r["결과"] == "ok" and r["확인"] == "ok"]
            not_ok = {r["번호"] for r in results} - {r["번호"] for r in ok}
            print(f"확인 통과 {len(ok)}곡, 공개 시작", flush=True)
            published = run(client, rows, dry_run=False, publish=True, skip=skip | not_ok)
            for r, p in zip(results, published, strict=True):
                r["공개"] = p["한 일"] if p["결과"] == "ok" else p["결과"]
    except AuthError as e:
        print(f"멈춤: {e}. 새 토큰을 넣고 다시 실행하면 이어서 감", file=sys.stderr)
        return 3
    path = write_results(args.bulk, results)
    bad = [r for r in results if r["결과"] != "ok" or r.get("확인", "ok") != "ok"]
    print(f"{len(results)}곡 처리, 실패 {len(bad)}곡 → {path}")
    for r in bad:
        print(f"  {r['번호']} {r['제목']}: {r['결과']} {r.get('확인', '')}")
    return 2 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
