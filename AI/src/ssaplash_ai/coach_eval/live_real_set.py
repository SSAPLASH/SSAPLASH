"""실제 연주 기록으로 연주 중 LLM 평가 세트를 만든다(설계 COACH-001 각도·실측평가 3.4, 4.2~4.3).

입력은 EC2에서 1회성 조회로 내보낸 CSV 세 개다(`sessions.csv`·`hits.csv`·`charts.csv`, 내보내기 절차:
`docs/live-coach-llm.md` "실제 기록 평가"). 채보는 DB `chart_versions`의 `notes`·`timing` 그대로다. 허용한 열 밖의 열이 하나라도 있으면 읽지 않고 멈춘다. 회원 번호·이메일·닉네임·원래 판 번호는
받지 않는다. 결과 파일과 입력 파일은 git에 넣지 않고, 평가가 끝나면 지운다.

```
uv run python -m ssaplash_ai.coach_eval.live_real_set --export data/live-real/export --out data/live-real/sets
# → sets/real.jsonl (각도 사실 없음), sets/real-aim.jsonl (같은 구간 + 각도 사실), 요약 출력
```
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ssaplash_ai.coach.live_narrative import LiveSegmentFacts
from ssaplash_ai.coach_eval.live_segments import (
    PlayRecord,
    chart_from_detail,
    rebuild_segments,
)

SESSION_COLUMNS = (
    "session_key",
    "input_source",
    "chart_version_ref",
    "perfect_ms",
    "good_ms",
    "pad_poses",
    "live_coach_events",
    "played_date",
)
HIT_COLUMNS = (
    "session_key",
    "seq",
    "t_ms",
    "stick_id",
    "pad",
    "judgement",
    "matched_note_id",
    "delta_ms",
    "velocity",
    "pitch",
    "yaw",
)
CHART_COLUMNS = ("chart_version_ref", "notes", "timing")
# 개인을 가리킬 수 있어 어떤 이름으로도 받지 않는 열(허용 목록 검사와 별도로 오류 문구를 분명히 하려고 둔다)
FORBIDDEN_COLUMNS = ("user_id", "email", "nickname", "play_id", "id", "account_id", "ip")
_INTS = {"seq", "stick_id", "velocity"}
_FLOATS = {"t_ms", "delta_ms", "pitch", "yaw", "perfect_ms", "good_ms"}


class ExportError(ValueError):
    pass


def check_columns(names: Sequence[str], allowed: Sequence[str], file: str) -> None:
    bad = sorted(set(names) & set(FORBIDDEN_COLUMNS))
    if bad:
        raise ExportError(
            f"{file}: 개인을 가리킬 수 있는 열이 있어 읽지 않습니다: {', '.join(bad)}"
        )
    extra = sorted(set(names) - set(allowed))
    if extra:
        raise ExportError(f"{file}: 허용하지 않은 열이 있어 읽지 않습니다: {', '.join(extra)}")
    missing = [c for c in allowed if c not in names]
    if missing:
        raise ExportError(f"{file}: 필요한 열이 없습니다: {', '.join(missing)}")


def _value(col: str, raw: str) -> Any:
    if raw == "":
        return None
    if col in _INTS:
        return int(raw)
    if col in _FLOATS:
        return float(raw)
    return raw


def read_csv(path: Path, allowed: Sequence[str]) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        check_columns(reader.fieldnames or [], allowed, path.name)
        return [{k: _value(k, v) for k, v in row.items()} for row in reader]


def _json(raw: Any, what: str) -> Any:
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ExportError(f"{what} JSON을 읽지 못했습니다") from exc


def _poses(raw: Any) -> dict[str, dict[str, float]]:
    """캘리브레이션 패드 기준 자세 {패드: {pitch, yaw}}. 모양이 틀린 패드는 뺀다"""
    v = _json(raw, "pad_poses") or {}
    out: dict[str, dict[str, float]] = {}
    if isinstance(v, dict):
        for pad, p in v.items():
            if (
                isinstance(p, dict)
                and isinstance(p.get("pitch"), int | float)
                and isinstance(p.get("yaw"), int | float)
            ):
                out[pad] = {"pitch": float(p["pitch"]), "yaw": float(p["yaw"])}
    return out


@dataclass(frozen=True)
class RealCase:
    """평가 세트 한 줄: 어느 판(가명 앞 8자리)의 몇 번째 구간인지와 그 사실"""

    name: str
    facts: dict[str, Any]

    def to_json(self) -> str:
        return json.dumps({"name": self.name, "facts": self.facts}, ensure_ascii=False)


@dataclass(frozen=True)
class RealSetSummary:
    plays: int
    songs: int
    segments: int
    withAim: int
    skippedPlays: int


def plays_of(
    sessions: Sequence[Mapping[str, Any]], hits: Sequence[Mapping[str, Any]]
) -> Iterator[tuple[Mapping[str, Any], PlayRecord]]:
    by: dict[str, list[Mapping[str, Any]]] = {}
    for h in hits:
        by.setdefault(h["session_key"], []).append(h)
    for s in sessions:
        if s["input_source"] not in ("STICK", "KEYBOARD") or s.get("good_ms") is None:
            continue
        events = _json(s.get("live_coach_events"), "live_coach_events") or []
        yield (
            s,
            PlayRecord(
                session_key=s["session_key"],
                input_source=s["input_source"],
                good_ms=float(s["good_ms"]),
                hits=sorted(by.get(s["session_key"], []), key=lambda h: h["seq"]),
                events=events if isinstance(events, list) else [],
                pad_poses=_poses(s.get("pad_poses")),
            ),
        )


def chart_details(path: Path) -> dict[str, dict[str, Any]]:
    """`charts.csv`(DB `chart_versions`의 notes·timing) → {채보 버전: BE 채보 응답 모양}. BE `ChartDocumentReader`와 같다"""
    out: dict[str, dict[str, Any]] = {}
    for row in read_csv(path, CHART_COLUMNS):
        timing = _json(row["timing"], "timing")
        notes = _json(row["notes"], "notes")
        if not isinstance(timing, dict) or not isinstance(notes, list):
            raise ExportError("charts.csv: notes·timing 모양이 다릅니다")
        out[str(row["chart_version_ref"])] = {
            "bpm": timing["bpm"],
            "offsetMs": timing["offsetMs"],
            "beatsPerBar": int(str(timing["timeSignature"]).split("/")[0]),
            "timing": timing,
            "notes": notes,
        }
    return out


def build_sets(
    export_dir: Path, charts_dir: Path | None = None, *, trust_yaw: bool = True
) -> tuple[list[RealCase], list[RealCase], RealSetSummary]:
    """채보는 `export_dir/charts.csv`에서 읽는다. `charts_dir`를 주면 `<채보 버전>.json`(BE 채보 응답)을 먼저 본다"""
    sessions = read_csv(export_dir / "sessions.csv", SESSION_COLUMNS)
    hits = read_csv(export_dir / "hits.csv", HIT_COLUMNS)
    csv_charts = (
        chart_details(export_dir / "charts.csv") if (export_dir / "charts.csv").is_file() else {}
    )
    plain: list[RealCase] = []
    aimed: list[RealCase] = []
    songs: set[str] = set()
    plays = skipped = 0
    for s, play in plays_of(sessions, hits):
        ref = s.get("chart_version_ref")
        path = charts_dir / f"{ref}.json" if charts_dir is not None else None
        if path is not None and path.is_file():
            detail = json.loads(path.read_text(encoding="utf-8"))
        elif str(ref) in csv_charts:
            detail = csv_charts[str(ref)]
        else:
            skipped += 1
            continue
        chart = chart_from_detail(detail)
        a = rebuild_segments(chart, play, with_aim=False)
        b = rebuild_segments(chart, play, with_aim=True, trust_yaw=trust_yaw)
        if not a:
            skipped += 1
            continue
        plays += 1
        songs.add(str(ref))
        for x, y in zip(a, b, strict=True):
            name = f"{play.session_key[:8]}#{x.facts['segment']['index']}"
            # 워커가 받는 모양인지 여기서 확인한다(틀리면 평가 전에 멈춘다)
            LiveSegmentFacts.model_validate(x.facts)
            LiveSegmentFacts.model_validate(y.facts)
            plain.append(RealCase(name, x.facts))
            aimed.append(RealCase(name, y.facts))
    summary = RealSetSummary(
        plays=plays,
        songs=len(songs),
        segments=len(plain),
        withAim=sum("aim" in c.facts for c in aimed),
        skippedPlays=skipped,
    )
    return plain, aimed, summary


def load_cases(path: Path) -> dict[str, LiveSegmentFacts]:
    """평가 세트 파일 → `live_tip_compare.run`이 받는 {이름: 사실}"""
    out: dict[str, LiveSegmentFacts] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            row = json.loads(line)
            out[row["name"]] = LiveSegmentFacts.model_validate(row["facts"])
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="실제 연주 기록으로 연주 중 LLM 평가 세트 만들기")
    p.add_argument(
        "--export", type=Path, required=True, help="sessions.csv·hits.csv·charts.csv가 있는 폴더"
    )
    p.add_argument(
        "--charts", type=Path, help="(선택) <chart_version_ref>.json 채보 폴더. 없으면 charts.csv"
    )
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--no-yaw", action="store_true", help="방위각(좌우)을 쓰지 않는다(U6)")
    args = p.parse_args(argv)
    try:
        plain, aimed, summary = build_sets(args.export, args.charts, trust_yaw=not args.no_yaw)
    except ExportError as exc:
        print(f"내보내기 오류: {exc}", file=sys.stderr)
        return 2
    args.out.mkdir(parents=True, exist_ok=True)
    for name, cases in (("real", plain), ("real-aim", aimed)):
        (args.out / f"{name}.jsonl").write_text(
            "".join(c.to_json() + "\n" for c in cases), encoding="utf-8"
        )
    print(json.dumps(summary.__dict__, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
