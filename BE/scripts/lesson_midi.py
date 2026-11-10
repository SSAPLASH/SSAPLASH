"""입문 코스 레슨 MIDI를 만든다(331번, 재현용).

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
GM = {"KICK": 36, "SNARE": 38, "HIHAT": 42}
ALL_EIGHTHS = list(range(8))

# 연주 레슨: 한 마디를 8분음표 8칸으로 나눈 위치. 4마디 반복한다.
PLAY = {
    "lesson-kick-quarter.mid": {"KICK": [0, 2, 4, 6]},
    "lesson-snare-backbeat.mid": {"SNARE": [2, 6]},
    "lesson-kick-snare.mid": {"KICK": [0, 4], "SNARE": [2, 6]},
    "lesson-hihat-quarter.mid": {"HIHAT": [0, 2, 4, 6]},
    "lesson-hihat-eighth.mid": {"HIHAT": ALL_EIGHTHS},
    "lesson-hihat-snare.mid": {"HIHAT": ALL_EIGHTHS, "SNARE": [2, 6]},
    "lesson-hihat-kick.mid": {"HIHAT": ALL_EIGHTHS, "KICK": [0, 4]},
    "lesson-8beat.mid": {"HIHAT": ALL_EIGHTHS, "KICK": [0, 4], "SNARE": [2, 6]},
}
PLAY_BARS = 4

# 알아보기 레슨: 4분음표 간격으로 한 음표씩. 화면은 시간과 관계없이 순서대로 보여 준다.
READ = {
    "lesson-read-kick.mid": ["KICK"] * 4,
    "lesson-read-snare.mid": ["SNARE"] * 4,
    "lesson-read-hihat.mid": ["HIHAT"] * 4,
    "lesson-read-mixed.mid": ["KICK", "SNARE", "HIHAT", "KICK", "HIHAT", "SNARE", "KICK", "SNARE"],
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
        hits = [(b * bar + slot * EIGHTH, pad) for b in range(PLAY_BARS) for pad, slots in pattern.items() for slot in slots]
        (OUT / name).write_bytes(midi(hits, PLAY_BARS * bar))
        print(f"{name}: notes={len(hits)}")
    for name, pads in READ.items():
        hits = [(i * PPQ, pad) for i, pad in enumerate(pads)]
        bars = -(-len(pads) // 4)
        (OUT / name).write_bytes(midi(hits, bars * bar))
        print(f"{name}: notes={len(hits)}")


if __name__ == "__main__":
    main()
