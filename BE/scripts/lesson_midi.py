"""학습 코스(입문·중급) 레슨 MIDI를 만든다(331번, 학습 코스 설계 3-7절, 재현용).

레슨마다 4/4, 70 BPM, GM 드럼(채널 10) MIDI를 쓴다. 결과는 공용 곡 카탈로그
(src/main/resources/builtin-songs/midi/)에 들어가고, 순서·설명은 catalog.json의 lesson 필드에 둔다.
모든 노트는 세기 100, 같은 시각 2개 이하, 8분 격자 위라 NORMAL 솎기 결과가 원본과 같다(레슨 채보 = NORMAL).
표준 라이브러리만 쓴다.

실행: BE/ 에서 `python scripts/lesson_midi.py`
"""
import pathlib
import struct

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "src/main/resources/builtin-songs/midi"
PPQ = 480
BPM = 70
EIGHTH = PPQ // 2
NOTE_TICKS = 60
# GM 드럼 번호. BE MIDI 변환 표(GmDrumMapping)에서 각 패드로 읽히는 번호다.
GM = {"KICK": 36, "SNARE": 38, "HIHAT": 42, "HIHAT_PEDAL": 44, "CRASH": 49, "RIDE": 51,
      "SMALL_TOM": 48, "MID_TOM": 45, "FLOOR_TOM": 43}
ALL_EIGHTHS = list(range(8))

EIGHT_BEAT = {"HIHAT": ALL_EIGHTHS, "KICK": [0, 4], "SNARE": [2, 6]}
CRASH_EIGHT_BEAT = {"CRASH": [0], "HIHAT": list(range(1, 8)), "KICK": [0, 4], "SNARE": [2, 6]}
TOM_FILL = {"SNARE": [0, 1], "SMALL_TOM": [2, 3], "MID_TOM": [4, 5], "FLOOR_TOM": [6, 7]}

# 연주 레슨: 한 마디를 8분음표 8칸으로 나눈 위치. 사전 하나면 4마디 반복하고, 목록이면 마디마다 그 패턴이다.
# 「킥으로 박자 세기」만 2마디다(385번, 시연에서 첫 연주 레슨이 길다는 의견).
PLAY = {
    "lesson-kick-quarter.mid": [{"KICK": [0, 2, 4, 6]}] * 2,
    "lesson-snare-backbeat.mid": {"SNARE": [2, 6]},
    "lesson-kick-snare.mid": {"KICK": [0, 4], "SNARE": [2, 6]},
    "lesson-hihat-quarter.mid": {"HIHAT": [0, 2, 4, 6]},
    "lesson-hihat-eighth.mid": {"HIHAT": ALL_EIGHTHS},
    "lesson-hihat-snare.mid": {"HIHAT": ALL_EIGHTHS, "SNARE": [2, 6]},
    "lesson-hihat-kick.mid": {"HIHAT": ALL_EIGHTHS, "KICK": [0, 4]},
    "lesson-8beat.mid": {"HIHAT": ALL_EIGHTHS, "KICK": [0, 4], "SNARE": [2, 6]},
    # 중급(입문에서 안 친 드럼): 크래시·라이드·탐 세 개·하이햇 페달
    "lesson-int-crash-8beat.mid": CRASH_EIGHT_BEAT,
    "lesson-int-ride-8beat.mid": {"RIDE": ALL_EIGHTHS, "KICK": [0, 4], "SNARE": [2, 6]},
    "lesson-int-ride-pedal.mid": {"RIDE": [0, 2, 4, 6], "HIHAT_PEDAL": [2, 6]},
    "lesson-int-snare-tom.mid": {"SNARE": [0, 1, 2, 3], "SMALL_TOM": [4, 5, 6, 7]},
    "lesson-int-toms-down.mid": {"SMALL_TOM": [0, 1], "MID_TOM": [2, 3], "FLOOR_TOM": [4, 5, 6, 7]},
    "lesson-int-tom-fill.mid": TOM_FILL,
    "lesson-int-8beat-fill.mid": [CRASH_EIGHT_BEAT, EIGHT_BEAT, EIGHT_BEAT, TOM_FILL],
}
PLAY_BARS = 4

# 알아보기 레슨: 4분음표 간격으로 한 음표씩. 화면은 시간과 관계없이 순서대로 보여 준다.
READ = {
    "lesson-read-kick.mid": ["KICK"] * 4,
    "lesson-read-snare.mid": ["SNARE"] * 4,
    "lesson-read-hihat.mid": ["HIHAT"] * 4,
    "lesson-read-mixed.mid": ["KICK", "SNARE", "HIHAT", "KICK", "HIHAT", "SNARE", "KICK", "SNARE"],
    "lesson-int-read-cymbals.mid": ["CRASH", "RIDE", "CRASH", "RIDE"],
    "lesson-int-read-toms.mid": ["SMALL_TOM", "MID_TOM", "FLOOR_TOM", "SMALL_TOM", "MID_TOM", "FLOOR_TOM"],
    "lesson-int-read-pedal.mid": ["HIHAT_PEDAL"] * 4,
}


def var_len(n):
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.insert(0, (n & 0x7F) | 0x80)
        n >>= 7
    return bytes(out)


def midi(hits, length):
    """hits: (tick, pad) 목록. length: 곡 끝 tick."""
    events = [
        (0, 0, b"\xFF\x51\x03" + round(60_000_000 / BPM).to_bytes(3, "big")),
        (0, 0, b"\xFF\x58\x04" + bytes([4, 2, 24, 8])),
    ]
    for tick, pad in hits:
        events.append((tick, 2, bytes([0x99, GM[pad], 100])))
        events.append((tick + NOTE_TICKS, 1, bytes([0x89, GM[pad], 0])))
    events.sort(key=lambda e: (e[0], e[1]))
    data, last = bytearray(), 0
    for tick, _, body in events:
        data += var_len(tick - last) + body
        last = tick
    data += var_len(max(length, last) - last) + b"\xFF\x2F\x00"
    track = b"MTrk" + struct.pack(">I", len(data)) + bytes(data)
    return b"MThd" + struct.pack(">IHHH", 6, 0, 1, PPQ) + track


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    bar = EIGHTH * 8
    for name, pattern in PLAY.items():
        bars = pattern if isinstance(pattern, list) else [pattern] * PLAY_BARS
        assert len(bars) in (2, PLAY_BARS), name
        hits = [(b * bar + slot * EIGHTH, pad) for b, p in enumerate(bars) for pad, slots in p.items() for slot in slots]
        # NORMAL 솎기는 같은 시각 2개까지만 남긴다. 넘으면 레슨 채보가 MIDI와 달라진다
        ticks = [t for t, _ in hits]
        assert all(ticks.count(t) <= 2 for t in ticks), name
        (OUT / name).write_bytes(midi(hits, len(bars) * bar))
        print(f"{name}: notes={len(hits)}")
    for name, pads in READ.items():
        hits = [(i * PPQ, pad) for i, pad in enumerate(pads)]
        bars = -(-len(pads) // 4)
        (OUT / name).write_bytes(midi(hits, bars * bar))
        print(f"{name}: notes={len(hits)}")


if __name__ == "__main__":
    main()
