"""V10 시드 공용 곡 3곡의 노트를 MIDI 파일로 옮긴다(254번, 1회용·재현용).

V10의 채보 노트(timeMs·pad·velocityHint)와 timing(bpm·박자)을 GM 드럼(채널 10) MIDI로 쓴다.
결과는 공용 곡 카탈로그(src/main/resources/builtin-songs/midi/)에 들어가고, 앱 시작 시 등록기가
156번 변환기로 3난이도를 만든다. 표준 라이브러리만 쓴다.

실행: BE/ 에서 `python scripts/seed_midi_from_v10.py`
"""
import json
import pathlib
import re
import struct

ROOT = pathlib.Path(__file__).resolve().parent.parent
V10 = ROOT / "src/main/resources/db/migration/V10__seed_builtin_practice_charts.sql"
OUT = ROOT / "src/main/resources/builtin-songs/midi"
PPQ = 480
NOTE_TICKS = 60  # 드럼 노트 길이(16분음표의 절반). 변환기는 note-on 시각만 쓴다
# 156번 GmDrumMapping과 같은 대표 피치. HI_TOM은 SMALL_TOM과 같다.
GM = {"KICK": 36, "SNARE": 38, "HIHAT": 42, "HIHAT_PEDAL": 44, "HI_TOM": 50, "SMALL_TOM": 50,
      "MID_TOM": 47, "FLOOR_TOM": 43, "CRASH": 49, "RIDE": 51}
FILES = {"기본 8비트": "basic-8beat.mid", "8비트 + 필인": "8beat-fill.mid", "라이드 16비트": "ride-16beat.mid"}


def var_len(n):
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.insert(0, (n & 0x7F) | 0x80)
        n >>= 7
    return bytes(out)


def ticks(ms, bpm):
    return round(ms * PPQ * bpm / 60000)


def track(notes, bpm, numerator, denominator, duration_ms):
    events = []  # (tick, 순서, 바이트)
    tempo = round(60_000_000 / bpm)
    events.append((0, 0, b"\xFF\x51\x03" + tempo.to_bytes(3, "big")))
    events.append((0, 0, b"\xFF\x58\x04" + bytes([numerator, denominator.bit_length() - 1, 24, 8])))
    for n in notes:
        t = ticks(n["timeMs"], bpm)
        pitch = GM[n["pad"]]
        vel = max(1, min(127, int(n.get("velocityHint") or 100)))
        events.append((t, 2, bytes([0x99, pitch, vel])))
        events.append((t + NOTE_TICKS, 1, bytes([0x89, pitch, 0])))
    end = max(ticks(duration_ms, bpm), max(e[0] for e in events))
    events.sort(key=lambda e: (e[0], e[1]))
    data, last = bytearray(), 0
    for t, _, body in events:
        data += var_len(t - last) + body
        last = t
    data += var_len(end - last) + b"\xFF\x2F\x00"
    return b"MTrk" + struct.pack(">I", len(data)) + bytes(data)


def main():
    sql = V10.read_text(encoding="utf-8")
    songs = re.findall(r"VALUES \('([^']+)', NULL, 'BUILTIN', 'READY', ([0-9.]+), 0, '(\d+)/(\d+)', (\d+),", sql)
    blocks = re.findall(r"SELECT id, 1, 1, '(\[.*?\])'::jsonb", sql, re.S)
    assert len(songs) == len(blocks) == 3, (len(songs), len(blocks))
    OUT.mkdir(parents=True, exist_ok=True)
    for (title, bpm, num, den, duration), raw in zip(songs, blocks):
        notes = json.loads(raw)
        body = track(notes, float(bpm), int(num), int(den), int(duration))
        midi = b"MThd" + struct.pack(">IHHH", 6, 0, 1, PPQ) + body
        (OUT / FILES[title]).write_bytes(midi)
        print(f"{FILES[title]}: {title} bpm={bpm} notes={len(notes)} bytes={len(midi)}")


if __name__ == "__main__":
    main()
