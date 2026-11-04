#!/usr/bin/env python3
"""
ws_bridge.py - 스틱 시리얼 <-> WebSocket 중계 (S15P31A307-118)

통신 프로토콜 1-1장 그대로:
  스틱 -> 브라우저 : 시리얼 프레임(0xA5 LEN payload CRC8)을 벗겨 payload만 바이너리 프레임 1개로
  브라우저 -> 스틱 : 바이너리 프레임(payload)에 프레이밍을 씌워 시리얼로. 텍스트(JSON)는 받지 않음
  1초마다 BRIDGE_STATS(0x7E, 14바이트)를 브라우저에 보냄
  브라우저가 연결되면 마지막으로 받은 BOOT LOG와 STATUS를 먼저 한 번 보냄 (부팅 뒤에 연결해도 버전 확인 가능)

실행:
  pip install pyserial websockets
  python ws_bridge.py COM5                  # 실제 스틱 (기본 921600, ws://localhost:8765)
  python ws_bridge.py fake                  # 보드 없이 가짜 스틱 (FE 연동 테스트용)
  python ws_bridge.py COM5 --verbose        # 패킷마다 hex 출력
옵션: --baud 921600 --port 8765 --host localhost
"""
import argparse
import asyncio
import math
import random
import struct
import sys
import threading
import time

try:
    import websockets
    try:
        from websockets.asyncio.server import serve as ws_serve   # websockets >= 13
        NEW_API = True
    except ImportError:
        from websockets import serve as ws_serve                  # 이전 버전
        NEW_API = False
except ImportError:
    sys.exit("websockets가 없습니다: pip install websockets")

SOF = 0xA5
MAX_PAYLOAD = 64          # 프로토콜상 최대 20, 여유를 두고 이보다 크면 잘못된 LEN으로 봄
STATS_PERIOD_S = 1.0

NAMES = {0x01: "HIT", 0x02: "POSE", 0x03: "STATUS", 0x04: "SYNC_ACK", 0x05: "SWING",
         0x06: "PARAM_ACK", 0x7E: "BRIDGE_STATS", 0x7F: "LOG",
         0x10: "SYNC", 0x11: "SET_MODE", 0x12: "HAPTIC", 0x13: "RESET_POSE", 0x14: "SET_PARAM",
         0x15: "SET_PAD_TABLE", 0x16: "SET_YAW_OFFSET", 0x17: "GET_PARAMS"}

PAD_NAMES = ["CRASH", "HIHAT", "SNARE", "SMALL_TOM", "MID_TOM", "FLOOR_TOM", "RIDE", "KICK", "HIHAT_PEDAL"]


# ---------------------------------------------------------------- 프레이밍

def crc8(data: bytes) -> int:
    """CRC-8, 다항식 0x07, 초기값 0x00 (펌웨어 stick_link와 같음)"""
    c = 0
    for b in data:
        c ^= b
        for _ in range(8):
            c = ((c << 1) ^ 0x07) & 0xFF if c & 0x80 else (c << 1) & 0xFF
    return c


def frame(payload: bytes) -> bytes:
    return bytes([SOF, len(payload)]) + payload + bytes([crc8(payload)])


class Deframer:
    """시리얼 바이트 스트림 -> payload 목록. 통계는 BRIDGE_STATS에 그대로 들어감"""

    def __init__(self):
        self.buf = bytearray()
        self.ok = 0
        self.crc_err = 0
        self.resync = 0

    def feed(self, data: bytes):
        self.buf += data
        out = []
        while True:
            i = self.buf.find(SOF)
            if i < 0:
                if self.buf:
                    self.resync += 1
                    self.buf.clear()
                break
            if i > 0:                        # SOF 앞 쓰레기 버림
                self.resync += 1
                del self.buf[:i]
            if len(self.buf) < 2:
                break
            n = self.buf[1]
            if n == 0 or n > MAX_PAYLOAD:   # 잘못된 길이: 이 SOF는 가짜
                self.resync += 1
                del self.buf[:1]
                continue
            if len(self.buf) < n + 3:
                break
            payload = bytes(self.buf[2:2 + n])
            if crc8(payload) == self.buf[2 + n]:
                self.ok += 1
                out.append(payload)
                del self.buf[:n + 3]
            else:                            # CRC 불일치: SOF 다음 바이트부터 다시 탐색
                self.crc_err += 1
                del self.buf[:1]
        return out

    def stats_packet(self) -> bytes:
        return struct.pack("<BBIII", 0x7E, 0, self.ok & 0xFFFFFFFF,
                           self.crc_err & 0xFFFFFFFF, self.resync & 0xFFFFFFFF)


# ---------------------------------------------------------------- 출력용 디코드

def describe(p: bytes) -> str:
    t = p[0]
    name = NAMES.get(t, f"0x{t:02X}")
    try:
        if t == 0x01 and len(p) >= 20:
            seq, ts, pad, mg, el, az, peak, vel, sw, lat, dec = struct.unpack_from("<BIBBhhHBBhB", p, 2)
            pn = PAD_NAMES[pad] if pad < len(PAD_NAMES) else "-"
            amb = "?" if p[1] & 0x10 else ""
            return (f"HIT #{seq} t={ts / 1000:.1f}ms {pn}{amb} mg={mg / 10:.1f} el={el / 100:.1f} "
                    f"az={az / 100:.1f} peak={peak} vel={vel} swing={sw}ms decel={dec / 10:.1f}")
        if t == 0x7F:
            return "LOG " + p[2:].decode("ascii", "replace")
        if t == 0x03 and len(p) >= 6:
            return f"STATUS bat={p[2]} rssi={struct.unpack_from('<b', p, 3)[0]} fw={p[4]}.{p[5]}"
        if t == 0x04 and len(p) >= 10:
            t0, t1 = struct.unpack_from("<II", p, 2)
            return f"SYNC_ACK t0={t0} t1={t1}us"
        if t == 0x06 and len(p) >= 5:
            pid, val = struct.unpack_from("<Bh", p, 2)
            return f"PARAM_ACK id=0x{pid:02X} value={val}"
    except (struct.error, IndexError):
        pass
    return f"{name} [{len(p)}] {p.hex(' ')}"


# ---------------------------------------------------------------- 가짜 스틱

class FakeStick:
    """보드 없이 FE 연동을 시험하기 위한 가짜 펌웨어. 실제 펌웨어와 같은 패킷을 프레이밍해서 내보냄"""

    DEFAULT_PARAMS = {0x01: 150, 0x02: 30, 0x03: 400, 0x04: 30, 0x05: 1, 0x06: 200, 0x07: 1,
                      0x09: 50, 0x0A: 30, 0x0B: 400, 0x0C: 50, 0x0D: 150, 0x0E: 3000, 0x0F: 1000}
    # 1단계 4패드 (프로토콜 v0.7 번호), 고도·방위 (도)
    PADS = {1: (39, -50), 2: (30, -27), 3: (61, -34), 5: (43, 55)}

    def __init__(self, emit):
        self.emit = emit          # emit(bytes) : 프레이밍된 바이트를 "시리얼에서 읽은 것처럼" 넘김
        self.t_start = time.monotonic()
        self.params = dict(self.DEFAULT_PARAMS)
        self.hit_seq = 0
        self.pose_seq = 0
        self.mode = 0
        self.yaw_offset = 0
        self.flags = 0x01         # 오른손
        self.PADS = dict(FakeStick.PADS)

    def now_us(self):
        return int((time.monotonic() - self.t_start) * 1e6) & 0xFFFFFFFF

    def send(self, payload: bytes):
        self.emit(frame(payload))

    def log(self, s: str):
        self.send(bytes([0x7F, self.flags]) + s.encode("ascii")[:18])

    def status(self):
        self.send(struct.pack("<BBBbBB", 0x03, self.flags, 0xFF, 0, 0, 1))

    def param_ack(self, pid, val):
        self.send(struct.pack("<BBBh", 0x06, self.flags, pid, val))

    def hit(self):
        pad = random.choice(list(self.PADS))
        el, az = self.PADS[pad]
        el += random.uniform(-4, 4)
        az += random.uniform(-4, 4) + self.yaw_offset / 100
        peak = random.randint(450, 1200)
        vel = min(127, peak * 127 // self.params[0x0F])
        mg = random.randint(60, 250)
        flags = self.flags | (0x10 if mg < 100 else 0)
        ts = (self.now_us() + 14000) & 0xFFFFFFFF          # 정지 추정 시각은 판정보다 약 14ms 뒤
        self.send(struct.pack("<BBBIBBhhHBBhB", 0x01, flags, self.hit_seq, ts, pad, mg,
                              int(el * 100), int(az * 100), peak, vel, random.randint(60, 160),
                              0, random.randint(55, 126)))
        self.hit_seq = (self.hit_seq + 1) & 0xFF

    def pose(self):
        t = time.monotonic()
        el = 35 + 20 * math.sin(t * 2.0)
        az = 30 * math.sin(t * 0.7) + self.yaw_offset / 100
        self.send(struct.pack("<BBIhhhB", 0x02, self.flags, self.now_us(), int(el * 100),
                              int(az * 100), 0, self.pose_seq))
        self.pose_seq = (self.pose_seq + 1) & 0xFF

    def command(self, p: bytes):
        """브라우저 명령 처리 (프레이밍을 벗긴 payload)"""
        t1 = self.now_us()        # 실제 펌웨어는 수신 인터럽트에서 찍음
        c = p[0]
        if c == 0x10 and len(p) >= 5:
            (t0,) = struct.unpack_from("<I", p, 1)
            self.send(struct.pack("<BBII", 0x04, self.flags, t0, t1))
        elif c == 0x11 and len(p) >= 2:
            self.mode = p[1]
        elif c == 0x13:
            self.yaw_offset = 0
            self.param_ack(0x22, 3500)
        elif c == 0x14 and len(p) >= 4:
            pid, val = struct.unpack_from("<Bh", p, 1)
            if pid in self.params:
                self.params[pid] = val
                self.param_ack(pid, val)
        elif c == 0x15 and len(p) >= 2:
            ctrl = p[1]
            n = ctrl & 0x0F
            if ctrl & 0x80:
                self.PADS = {}
            for i in range(n):
                off = 2 + i * 6
                if off + 6 > len(p):
                    break
                pad, el, az, _r = struct.unpack_from("<BhhB", p, off)
                if pad < 7:
                    self.PADS[pad] = (el / 100, az / 100)
            self.param_ack(0x20, len(self.PADS))
        elif c == 0x16 and len(p) >= 3:
            (self.yaw_offset,) = struct.unpack_from("<h", p, 1)
            self.param_ack(0x21, self.yaw_offset)
        elif c == 0x17:
            for pid in sorted(self.params):
                self.param_ack(pid, self.params[pid])
            self.param_ack(0x00, len(self.params))

    async def run(self):
        self.log("BOOT 0.1 fake")
        self.status()
        next_status = time.monotonic() + 5
        next_hit = time.monotonic() + 1
        while True:
            now = time.monotonic()
            if now >= next_status:
                self.status()
                next_status += 5
            if self.mode == 0 and self.PADS and now >= next_hit:
                self.hit()
                next_hit = now + random.uniform(0.3, 0.9)
            if self.mode == 1:
                self.pose()
            await asyncio.sleep(0.02)


# ---------------------------------------------------------------- 브리지

class Bridge:
    def __init__(self, args):
        self.args = args
        self.clients = set()
        self.deframer = Deframer()
        self.loop = None
        self.ser = None
        self.fake = None
        self.warned_text = False
        self.last_boot = None     # 브라우저가 나중에 연결해도 받도록 마지막 BOOT LOG·STATUS를 보관
        self.last_status = None

    # ---- 스틱 쪽
    def on_bytes(self, data: bytes):
        """시리얼(또는 가짜 스틱)에서 들어온 바이트. 이벤트 루프 스레드에서 호출"""
        for p in self.deframer.feed(data):
            if p[0] == 0x7F and p[2:7] == b"BOOT ":
                self.last_boot = p
            elif p[0] == 0x03:
                self.last_status = p
            if p[0] == 0x7F or self.args.verbose:
                print("  <-", describe(p))
            self.broadcast(p)

    def to_stick(self, payload: bytes):
        if self.args.verbose:
            print("  ->", NAMES.get(payload[0], f"0x{payload[0]:02X}"), payload.hex(" "))
        if self.fake:
            self.fake.command(payload)
        elif self.ser:
            try:
                self.ser.write(frame(payload))
            except Exception as e:  # noqa: BLE001
                print(f"[serial] write 실패: {e}")

    def serial_thread(self):
        import serial  # pyserial
        while True:
            try:
                self.ser = serial.Serial(self.args.device, self.args.baud, timeout=0.01)
                print(f"[serial] {self.args.device} {self.args.baud} 열림")
                while True:
                    # read(256)은 256바이트가 다 차거나 timeout(10ms)까지 기다려서 패킷이 최대 10ms 묶여 늦게 나감
                    # → 1바이트가 오면 바로 깨어나고, 이미 들어와 있는 만큼만 더 읽는다 (2026-10-27 실측 WS 지터 sd 6ms)
                    data = self.ser.read(1)
                    if data and self.ser.in_waiting:
                        data += self.ser.read(self.ser.in_waiting)
                    if data:
                        self.loop.call_soon_threadsafe(self.on_bytes, data)
            except Exception as e:  # noqa: BLE001  (포트 없음, 보드 리셋, USB 뽑힘)
                if self.ser:
                    print(f"[serial] 끊김: {e}")
                    try:
                        self.ser.close()
                    except Exception:  # noqa: BLE001
                        pass
                else:
                    print(f"[serial] {self.args.device} 열기 실패: {e} (1초 뒤 재시도)")
                self.ser = None
                time.sleep(1)

    # ---- 브라우저 쪽
    def broadcast(self, payload: bytes):
        for ws in list(self.clients):
            asyncio.ensure_future(self._send(ws, payload))

    async def _send(self, ws, payload):
        try:
            await ws.send(payload)
        except Exception:  # noqa: BLE001
            self.clients.discard(ws)

    async def handler(self, ws, *_):
        self.clients.add(ws)
        print(f"[ws] 연결 ({len(self.clients)}개)")
        for p in (self.last_boot, self.last_status):   # 연결 전에 지나간 부팅 정보 재전송
            if p:
                await self._send(ws, p)
        try:
            async for msg in ws:
                if isinstance(msg, (bytes, bytearray)):
                    if 1 <= len(msg) <= 20:
                        self.to_stick(bytes(msg))
                    else:
                        print(f"[ws] 길이 {len(msg)} 명령 무시 (1~20바이트)")
                elif not self.warned_text:
                    print("[ws] 텍스트(JSON) 프레임은 받지 않습니다. 바이너리로 보내 주세요")
                    self.warned_text = True
        except Exception:  # noqa: BLE001
            pass
        finally:
            self.clients.discard(ws)
            print(f"[ws] 끊김 ({len(self.clients)}개)")

    async def stats_task(self):
        last = None
        while True:
            await asyncio.sleep(STATS_PERIOD_S)
            self.broadcast(self.deframer.stats_packet())
            cur = (self.deframer.ok, self.deframer.crc_err, self.deframer.resync)
            if cur[1:] != (last or cur)[1:]:
                print(f"[stats] ok={cur[0]} crc_err={cur[1]} resync={cur[2]}")
            last = cur

    async def main(self):
        self.loop = asyncio.get_running_loop()
        if self.args.device.lower() == "fake":
            self.fake = FakeStick(self.on_bytes)
            asyncio.ensure_future(self.fake.run())
            print("[fake] 가짜 스틱: 연주 모드에서 0.3~0.9초마다 HIT, 5초마다 STATUS, 설정 모드면 POSE 50Hz")
        else:
            threading.Thread(target=self.serial_thread, daemon=True).start()
        asyncio.ensure_future(self.stats_task())
        async with ws_serve(self.handler, self.args.host, self.args.port, max_size=1024):
            print(f"[ws] ws://{self.args.host}:{self.args.port} 대기 중 (Ctrl+C 종료)")
            await asyncio.Future()


def main():
    ap = argparse.ArgumentParser(description="스틱 시리얼 <-> WebSocket 브리지")
    ap.add_argument("device", help="시리얼 포트 (예: COM5, /dev/ttyACM0) 또는 fake")
    ap.add_argument("--baud", type=int, default=921600)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--verbose", "-v", action="store_true", help="패킷마다 출력")
    args = ap.parse_args()
    try:
        asyncio.run(Bridge(args).main())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
