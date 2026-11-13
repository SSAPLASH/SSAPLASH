"""NCS 기본곡 서버 채보 결과 → 공용 곡 등록 파일·점검 표·검수 음원.

입력: `<charts>/<곡 이름>/chart.json`·`accompaniment.flac`(GPU 서버 `ncs_charts_server.ipynb` 결과), 50곡 표.
출력
- `<out>/<곡 이름>.mid`: 드럼 MIDI. 0틱 = 드럼리스 MR 0초. 첫 박이 정수 틱에 오도록 0틱에 맞춘 템포, 첫 박에 채보 bpm
  (BE 관리자 MIDI 등록 규칙에 맞춘 계산). 10번 채널, 길이 60틱, 세기는 velocityHint(없으면 95)
- `<out>/<곡 이름>.wav`: 드럼리스 MR. BE 반주 업로드가 flac을 받지 않아 WAV(16bit)로
- `<out>/register.csv`: 등록 입력. 관리자 화면 일괄 추가 양식과 같은 열(제목·아티스트·MIDI·드럼리스 MR·offsetMs·라이선스·공개)
- `<out>/check.csv`: 곡별 점검 표. 기준을 넘은 곡은 `문제` 칸에 이유
- `<review>/<곡 이름>.flac`: 검수 음원. 드럼리스 MR에 채보 노트를 합성 드럼 소리로 얹은 것

첫 박보다 ppq/8 넘게 앞선 노트는 BE가 MIDI_UNSUPPORTED로 등록을 거부해서 MIDI에서 빼고 수를 점검 표에 남김.
채보 bpm이 소수점만큼 틀려 곡 뒤로 갈수록 노트가 박자 칸에서 밀리는 곡은 `fix_timing`으로 정수 bpm·첫 박을
다시 맞춘 뒤 MIDI를 씀(노트 시각은 그대로). 고친 내용은 점검 표 `bpm 고침` 칸.

AI/ 에서
  uv run python scripts/ncs_make_bulk.py --charts data/ncs/charts --out data/ncs/bulk --review data/ncs/review

종료 코드: 0 정상(점검 표 문제 없음), 1 입력 오류, 2 점검 표에 문제 있는 곡 있음.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import mido
import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ncs_prepare import DEFAULT_SONGS, Song, read_songs  # noqa: E402

from ssaplash_ai.chart.tempo_refine import refine_timing  # noqa: E402

PPQ = 480
NOTE_TICKS = 60
DEFAULT_VELOCITY = 95
GM = {
    "KICK": 36,
    "SNARE": 38,
    "HIHAT": 42,
    "SMALL_TOM": 48,
    "MID_TOM": 45,
    "FLOOR_TOM": 43,
    "CRASH": 49,
    "RIDE": 51,
}
# BE 관리자 반주 업로드 제한(AdminSongService)
WAV_MAX_BYTES = 50 * 2**20
WAV_MAX_MS = 10 * 60 * 1000
ROUNDTRIP_MAX_MS = 1.0
# 고친 뒤에도 박자 칸에서 벗어난 노트가 이 비율(%)을 넘으면 점검 표 문제로 표시
GRID_PROBLEM_PCT = 20
REGISTER_COLUMNS = ["제목", "아티스트", "MIDI", "드럼리스 MR", "offsetMs", "라이선스", "공개"]


def fix_timing(chart: dict) -> tuple[dict, dict]:
    """채보 bpm이 소수점만큼 틀려 곡 뒤로 갈수록 노트가 박자 칸에서 밀리는 곡의 bpm·첫 박 고치기.

    계산은 서비스 채보와 같은 `ssaplash_ai.chart.tempo_refine.refine_timing`. 노트 시각은 그대로.
    (모델 출력이 아니라 우리가 붙인 규칙. 원래 값은 점검 표에 남김) → (고친 timing, 점검 표 정보)
    """
    timing = chart["timing"]
    bpm, off = float(timing["bpm"]), int(timing["offsetMs"])
    times = [n["timeMs"] for n in chart["notes"]]
    if "tempoMap" in timing:
        r = None
    else:
        r = refine_timing(times, bpm, off)
    info = {
        "원래 bpm": bpm,
        "원래 첫 박 ms": off,
        "고치기 전 벗어남 %": round(r.before_off_grid * 100) if r else "",
        "고치기 전 메트로놈 밀림 ms": round(r.before_drift_ms) if r else "",
        "고친 뒤 벗어남 %": round(r.after_off_grid * 100) if r else "",
        "고친 뒤 메트로놈 밀림 ms": round(r.after_drift_ms) if r else "",
        "bpm 고침": "",
    }
    if not r or not r.changed:
        return dict(timing), info
    info["bpm 고침"] = (
        f"{bpm:g}→{r.bpm:g}, 첫 박 {off}→{r.offset_ms}ms "
        f"({'셋잇단' if r.grid_div == 6 else '16분'} 칸)"
    )
    return {**timing, "bpm": r.bpm, "offsetMs": r.offset_ms}, info


def tempo_points(timing: dict) -> list[tuple[int, float]]:
    """(tick, bpm) 목록. 0틱 = 음원 0초. 첫 박 앞 구간은 첫 박이 정수 tick에 오도록 bpm을 조금 바꿈."""
    bpm0, off = float(timing["bpm"]), int(timing["offsetMs"])
    first = first_beat_tick(timing)
    pts: list[tuple[int, float]] = []
    if first > 0:
        pts.append((0, first * 60000 / (PPQ * off)))
    pts.append((first, bpm0))
    src_ppq = int(timing.get("ppq", PPQ))
    for t in (timing.get("tempoMap") or [])[1:]:
        pts.append((first + round(t["tick"] * PPQ / src_ppq), float(t["bpm"])))
    return pts


def first_beat_tick(timing: dict) -> int:
    return round(int(timing["offsetMs"]) * float(timing["bpm"]) * PPQ / 60000)


def ms_of(tick: float, pts: list[tuple[int, float]]) -> float:
    ms, prev_t, prev_b = 0.0, 0, pts[0][1]
    for t, b in pts:
        if t > tick:
            break
        ms += (t - prev_t) * 60000 / PPQ / prev_b
        prev_t, prev_b = t, b
    return ms + (tick - prev_t) * 60000 / PPQ / prev_b


def tick_of(ms: float, pts: list[tuple[int, float]]) -> float:
    acc, prev_t, prev_b = 0.0, 0, pts[0][1]
    for t, b in pts:
        seg = (t - prev_t) * 60000 / PPQ / prev_b
        if acc + seg > ms:
            break
        acc += seg
        prev_t, prev_b = t, b
    return prev_t + (ms - acc) * prev_b * PPQ / 60000


def write_midi(chart: dict, path: Path, name: str) -> dict:
    """채보 하나 → MIDI 파일. 재변환 최대 차이·뺀 노트 수·쓴 노트 수 반환."""
    timing, notes = chart["timing"], chart["notes"]
    pts = tempo_points(timing)
    first = first_beat_tick(timing)
    events: list[tuple[int, int, mido.Message | mido.MetaMessage]] = []
    for t, b in pts:
        events.append((t, 0, mido.MetaMessage("set_tempo", tempo=round(60_000_000 / b))))
    events.append((0, 0, mido.MetaMessage("time_signature", numerator=4, denominator=4)))
    err, dropped, written = 0.0, 0, 0
    for n in notes:
        tk = round(tick_of(n["timeMs"], pts))
        if tk < first - PPQ / 8:
            dropped += 1
            continue
        err = max(err, abs(ms_of(tk, pts) - n["timeMs"]))
        vel = int(n.get("velocityHint", DEFAULT_VELOCITY)) or 1
        pitch = GM[n["pad"]]
        events.append((tk, 2, mido.Message("note_on", channel=9, note=pitch, velocity=vel)))
        events.append(
            (tk + NOTE_TICKS, 1, mido.Message("note_off", channel=9, note=pitch, velocity=0))
        )
        written += 1
    events.sort(key=lambda e: (e[0], e[1]))
    mid = mido.MidiFile(ticks_per_beat=PPQ)
    track = mido.MidiTrack()
    mid.tracks.append(track)
    track.append(mido.MetaMessage("track_name", name=name[:60]))
    last = 0
    for t, _, msg in events:
        track.append(msg.copy(time=t - last))
        last = t
    track.append(mido.MetaMessage("end_of_track", time=0))
    path.parent.mkdir(parents=True, exist_ok=True)
    mid.save(str(path))
    return {"roundtrip_ms": round(err, 3), "dropped": dropped, "written": written}


def drum_kit(sr: int, seed: int = 0) -> dict[str, np.ndarray]:
    """검수용 합성 드럼 소리. 패드마다 모노 한 타. 실제 악기 소리가 아니라 위치·패드 구분용."""
    rng = np.random.default_rng(seed)

    def env(sec: float, decay: float) -> tuple[np.ndarray, np.ndarray]:
        t = np.arange(int(sr * sec)) / sr
        return t, np.exp(-t / decay)

    def noise(n: int, high: bool) -> np.ndarray:
        x = rng.standard_normal(n)
        return np.diff(x, prepend=0.0) / 2 if high else x

    def tom(freq: float) -> np.ndarray:
        t, e = env(0.35, 0.12)
        f = freq * (1 + 0.3 * np.exp(-t / 0.03))
        return np.sin(2 * np.pi * np.cumsum(f) / sr) * e * 0.8

    t, e = env(0.3, 0.12)
    kick = np.sin(2 * np.pi * np.cumsum(50 + 70 * np.exp(-t / 0.03)) / sr) * e
    t, e = env(0.25, 0.07)
    snare = noise(len(t), False) * e * 0.5 + np.sin(2 * np.pi * 190 * t) * e * 0.4
    t, e = env(0.08, 0.02)
    hihat = noise(len(t), True) * e * 0.5
    t, e = env(1.2, 0.4)
    crash = noise(len(t), True) * e * 0.45
    t, e = env(0.6, 0.2)
    ride = noise(len(t), True) * e * 0.2 + np.sin(2 * np.pi * 3100 * t) * e * 0.12
    return {
        "KICK": kick,
        "SNARE": snare,
        "HIHAT": hihat,
        "SMALL_TOM": tom(240),
        "MID_TOM": tom(170),
        "FLOOR_TOM": tom(110),
        "CRASH": crash,
        "RIDE": ride,
    }


def render_review(mr: np.ndarray, notes: list[dict], sr: int) -> np.ndarray:
    """드럼리스 MR(프레임×채널)에 채보 노트를 합성 드럼으로 얹기. 넘치면 전체를 줄임."""
    kit = drum_kit(sr)
    drums = np.zeros(mr.shape[0], dtype=np.float64)
    for n in notes:
        hit = kit[n["pad"]] * (int(n.get("velocityHint", DEFAULT_VELOCITY)) / 127)
        start = int(round(n["timeMs"] * sr / 1000))
        if start >= len(drums):
            continue
        end = min(len(drums), start + len(hit))
        drums[start:end] += hit[: end - start]
    mix = mr.astype(np.float64) * 0.8 + drums[:, None] * 0.6
    peak = float(np.max(np.abs(mix))) if mix.size else 0.0
    if peak > 0.99:
        mix *= 0.99 / peak
    return mix.astype(np.float32)


def check_song(song: Song, chart_doc: dict, midi_stat: dict, wav_bytes: int, wav_ms: int) -> dict:
    chart = chart_doc["charts"][0]
    notes = chart["notes"]
    pads: dict[str, int] = {}
    for n in notes:
        pads[n["pad"]] = pads.get(n["pad"], 0) + 1
    problems = []
    if midi_stat["roundtrip_ms"] > ROUNDTRIP_MAX_MS:
        problems.append(f"MIDI 시각 차이 {midi_stat['roundtrip_ms']}ms")
    if midi_stat["written"] == 0:
        problems.append("MIDI 노트 없음")
    if wav_bytes > WAV_MAX_BYTES:
        problems.append(f"WAV {wav_bytes / 2**20:.1f}MiB")
    if wav_ms > WAV_MAX_MS:
        problems.append(f"WAV {wav_ms / 1000:.0f}초")
    duration_ms = int(chart_doc["metrics"]["durationMs"])
    return {
        "곡": song.stem,
        "길이 ms": duration_ms,
        "bpm": chart["timing"]["bpm"],
        "offsetMs": chart["timing"]["offsetMs"],
        "노트": len(notes),
        "분당 노트": round(len(notes) / duration_ms * 60000) if duration_ms else 0,
        "첫 노트 ms": notes[0]["timeMs"] if notes else "",
        "패드별": " ".join(f"{p}:{c}" for p, c in sorted(pads.items(), key=lambda kv: -kv[1])),
        "MIDI 시각 최대 차이 ms": midi_stat["roundtrip_ms"],
        "첫 박 앞이라 뺀 노트": midi_stat["dropped"],
        "WAV MiB": round(wav_bytes / 2**20, 1),
        "generatorVersion": chart_doc["generatorVersion"],
        "문제": "; ".join(problems),
    }


def build(songs_csv: Path, charts: Path, out: Path, review: Path | None) -> list[dict]:
    """50곡 처리. 점검 표 행 목록 반환. 결과 폴더가 빠지면 ValueError."""
    songs = read_songs(songs_csv)
    missing = [s.stem for s in songs if not (charts / s.stem / "chart.json").is_file()]
    missing += [s.stem for s in songs if not (charts / s.stem / "accompaniment.flac").is_file()]
    if missing:
        raise ValueError("서버 결과 없음: " + ", ".join(sorted(set(missing))))
    out.mkdir(parents=True, exist_ok=True)
    checks: list[dict] = []
    register: list[dict] = []
    for s in songs:
        d = charts / s.stem
        chart_doc = json.loads((d / "chart.json").read_text(encoding="utf-8"))
        timing, fix_info = fix_timing(chart_doc["charts"][0])
        chart = {**chart_doc["charts"][0], "timing": timing}
        chart_doc = {**chart_doc, "charts": [chart]}
        midi_stat = write_midi(chart, out / f"{s.stem}.mid", s.stem)
        mr, sr = sf.read(str(d / "accompaniment.flac"), dtype="float32", always_2d=True)
        wav = out / f"{s.stem}.wav"
        sf.write(str(wav), mr, sr, subtype="PCM_16")
        if review is not None:
            review.mkdir(parents=True, exist_ok=True)
            sf.write(str(review / f"{s.stem}.flac"), render_review(mr, chart["notes"], sr), sr)
        row = check_song(s, chart_doc, midi_stat, wav.stat().st_size, round(len(mr) * 1000 / sr))
        row.update(fix_info)
        after = fix_info["고친 뒤 벗어남 %"]
        if isinstance(after, int) and after > GRID_PROBLEM_PCT:
            row["문제"] = "; ".join(x for x in (row["문제"], f"박자 칸 벗어남 {after}%") if x)
        checks.append(row)
        register.append(
            {
                "제목": s.title,
                "아티스트": s.artist,
                "MIDI": f"{s.stem}.mid",
                "드럼리스 MR": wav.name,
                "offsetMs": chart["timing"]["offsetMs"],
                "라이선스": s.license,
                "공개": "false",
            }
        )
        print(f"{s.stem}: 노트 {midi_stat['written']}, 뺀 노트 {midi_stat['dropped']}", flush=True)
    for name, rows in (("register.csv", register), ("check.csv", checks)):
        with open(out / name, "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0]), lineterminator="\n")
            w.writeheader()
            w.writerows(rows)
    return checks


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--songs", type=Path, default=DEFAULT_SONGS, help="50곡 표")
    ap.add_argument("--charts", type=Path, default=Path("data/ncs/charts"), help="서버 결과 폴더")
    ap.add_argument("--out", type=Path, default=Path("data/ncs/bulk"), help="등록 파일 폴더")
    ap.add_argument("--review", type=Path, default=Path("data/ncs/review"), help="검수 음원 폴더")
    ap.add_argument("--no-review", action="store_true", help="검수 음원을 만들지 않음")
    args = ap.parse_args(argv)
    try:
        checks = build(args.songs, args.charts, args.out, None if args.no_review else args.review)
    except ValueError as e:
        print(f"실패: {e}", file=sys.stderr)
        return 1
    bad = [c for c in checks if c["문제"]]
    print(f"{len(checks)}곡 → {args.out}, 점검 문제 {len(bad)}곡")
    for c in bad:
        print(f"  {c['곡']}: {c['문제']}")
    return 2 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
