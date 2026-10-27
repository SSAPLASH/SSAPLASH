"""스윙 녹화 (S15P31A307-116).

TEST_CAPTURE 펌웨어가 보내는 CSV를 파일로 저장한다.
    pip install pyserial
    python capture_serial.py COM5 swing_0421.csv
Ctrl+C로 끝낸다. MobaXterm 등 다른 터미널이 포트를 잡고 있으면 먼저 닫는다.
보드 RESET을 누르면 헤더부터 다시 나오므로, 실행 후 RESET 한 번 누르는 것을 권장.
"""
import sys
import time

import serial

BAUD = 921600


def main() -> None:
    if len(sys.argv) < 3:
        print("사용법: python capture_serial.py <COM포트> <저장파일.csv>")
        sys.exit(1)
    port, path = sys.argv[1], sys.argv[2]

    ser = serial.Serial(port, BAUD, timeout=0.5)
    print(f"{port} @ {BAUD} → {path}  (Ctrl+C로 종료, 보드 RESET 권장)")

    started = False
    rows = 0
    seg = 0
    t_last = time.time()
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        try:
            while True:
                raw = ser.readline()
                if not raw:
                    continue
                line = raw.decode("ascii", errors="replace").strip()
                if not started:
                    # 보드 리셋 직후의 깨진 바이트·부팅 메시지는 건너뛰고 헤더부터 저장
                    if line.startswith("# capture") or line.startswith("t_us,"):
                        started = True
                    else:
                        continue
                f.write(line + "\n")
                if line.startswith("# seg"):
                    seg = int(line.split()[-1])
                    print(f"\n--- seg {seg} ---")
                elif line.startswith("#"):
                    print(line)
                elif line[0].isdigit():
                    rows += 1
                if time.time() - t_last > 1.0:
                    print(f"\rseg {seg}  rows {rows}", end="", flush=True)
                    t_last = time.time()
        except KeyboardInterrupt:
            pass
    ser.close()
    print(f"\n저장 완료: {path}  ({rows}줄)")


if __name__ == "__main__":
    main()
