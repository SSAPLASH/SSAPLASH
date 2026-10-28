# stick_fw_nrf52 — Feather nRF52840 Sense 펌웨어

최종 보드 **Adafruit Feather nRF52840 Sense** 펌웨어입니다. 내장 IMU를 1.66kHz로 읽어 타격을 검출하고, 자세·패드를 판정해 **BLE**(Web Bluetooth)와 USB 시리얼로 HIT 패킷을 보냅니다. 통신 규약은 스틱 통신 프로토콜 v0.7(GitLab Wiki)을 따릅니다.

알고리즘(`hit_detect`, `pose`, `pad`)은 NUCLEO 프로토타입(`../stick_fw_f103`)의 순수 C 모듈을 그대로 가져왔고, 2026-10-26 녹화로 1.66kHz용 파라미터만 다시 잡았습니다. 하드웨어 배선 전체는 "에어드럼 센서 스틱 하드웨어 명세서" 5장을 따릅니다.

## 1. 개발 환경

| 항목 | 버전 / 내용 |
|---|---|
| IDE | **Arduino IDE 2.3.10** |
| 보드 패키지 | **Adafruit nRF52 1.7.0** (Boards Manager). Preferences의 Additional boards manager URLs에 `https://adafruit.github.io/arduino-board-index/package_adafruit_index.json` |
| 보드 선택 | Tools > Board > **Adafruit Feather nRF52840 Sense** |
| 케이블 | Micro USB **데이터** 케이블 |
| 브라우저 | Chrome / Edge (Web Bluetooth) |

## 2. 빌드 · 업로드

1. Arduino IDE에서 `File > Open` → `stick_fw_nrf52.ino`
2. Tools > Port에서 보드 COM 포트 선택 (업로드·재연결 뒤 번호가 바뀔 수 있음)
3. Upload. 업로드 전에 **이 포트를 연 프로그램을 모두 닫기** (시리얼 모니터, Tera Term, Web Serial 페이지, `capture_serial.py`, `ws_bridge.py`)
4. 업로드가 안 되면 RESET을 빠르게 두 번 눌러 부트로더(LED가 천천히 깜빡임)로 들어간 뒤 새로 생긴 포트로 다시 업로드

**동작 확인**: 업로드 직후 1초는 보드를 가만히 둔다 (자이로 바이어스 측정). 시리얼 모니터(아무 baud)에 아래가 나오면 정상.

```
[LOG] BOOT 1.0 nrf52
[LOG] hold still...
[LOG] BIAS 10 -39 -1          (0.1°/s 단위. 흔들렸으면 "BIAS default")
n t_hit_ms pad el az mg peak vel sw decel | detect->send us | missed
```

## 3. 핀 · 주변장치

| 기능 | 핀 / 주소 | 비고 |
|---|---|---|
| IMU LSM6DS3TR-C | I2C 0x6A, INT1 → **D3** | WHO_AM_I 0x6A. 구버전 보드는 LSM6DS33(0x69) → 이 펌웨어는 `IMU FAIL` |
| 지자기 LIS3MDL | I2C 0x1C | 아직 안 씀 |
| 근접·습도·기압 | 0x39 / 0x44 / 0x77 | 안 씀 |
| DRV2605L (예정) | I2C 0x5A | 3V·GND·SDA·SCL 납땜 (Feather Sense엔 STEMMA QT 포트 없음) |
| USER 버튼 | D7 | 정면 보정 (RESET_POSE) |
| µs 시계 | TIMER4, 1MHz, 32비트 | 프로토콜 시각(µs u32) 그대로. `micros()`는 이 보드에서 약 1ms 단위라 안 씀 |

IMU 설정: 자이로 ±2000dps(0.07°/s/LSB), 가속도 ±16g(0.488mg/LSB), 둘 다 1.66kHz. 데이터 준비 신호(INT1, 펄스 모드)를 인터럽트로 받아 그 순간의 시각을 샘플 시각으로 쓴다.

## 4. 소스 구성

| 파일 | 내용 |
|---|---|
| `stick_fw_nrf52.ino` | `setup()`/`loop()`만. 본체는 `src/app.cpp` (Arduino가 .ino에 함수 원형을 자동으로 넣어 타입 순서가 꼬이는 문제 회피) |
| `src/app.cpp` | IMU 읽기, 바이어스 측정, 검출·자세·판정, BLE GATT, 명령 처리, 시리얼 출력. **설정은 파일 위쪽 `#define`** |
| `src/hit_detect.*` | 타격 검출 (f103 사본 + `min_swing_ms`, `n_reject_short` 추가) |
| `src/pose.*`, `src/pad.*` | 자세 추정, 패드 판정 (f103과 같음) |
| `src/stick_proto.*` | 패킷 만들기, CRC8, 시리얼 프레이밍·해제, 명령 구조체 |

`hit_detect`·`pose`·`pad`는 f103과 사본이 둘이다. f103 쪽 `hit_detect`는 `min_swing_ms` 기본값 0이라 동작이 같다. 나중에 공용 폴더로 합친다.

## 5. 설정 (`src/app.cpp` 위쪽)

| 이름 | 값 | 설명 |
|---|---|---|
| `SERIAL_MODE` | `SERIAL_BINARY` | USB 시리얼 출력. 0xA5 프레임 → Web Serial 직결 또는 `../tools/ws_bridge.py`로 브라우저 연결. **시리얼 모니터로 텍스트를 보려면 `SERIAL_TEXT`로 바꿔 빌드** |
| `HIT_AXIS`, `HIT_SIGN` | 1, +1 | 스윙 축. 10/26 녹화(보드를 손에 쥔 방향)에서 내려칠 때 자이로 y가 +. **스틱 부착 후 재확인** |
| `TIP_AXIS` | {1, 0, 0} | 센서 좌표에서 스틱 끝 방향. **스틱 부착 후 녹화로 확인** (현재 가정값) |
| `FW_MAJOR.FW_MINOR` | 1.0 | 1 = Feather. develop-EMB 병합마다 minor +1 |
| `BLE_NAME` | `SSAPLASH-STICK` | |

타격 검출 파라미터 (NUCLEO 기본값에서 바꾼 것, SET_PARAM으로도 바꿀 수 있음)

| 파라미터 | NUCLEO | Feather | 근거 (2026-10-26 녹화) |
|---|---|---|---|
| minDecel (0x0A) | 3.0°/s per ms | **6.0** | 진짜 타격 9.2 이상, 천천히 멈춘 동작 5.2 이하 |
| maxSwingMs (0x0B) | 400 | **160** | 진짜 71~112ms, 가짜 175~219ms |
| minSwingMs | (없음) | **20** | 버튼 누름 흔들림이 스윙 1ms로 잡힘. 250Hz에선 2샘플 조건이 8ms였지만 1.66kHz에선 1.2ms라 따로 둠. 프로토콜 id 없음 (펌웨어 상수) |
| tsCorrUs (0x0E) | 3000 | **800** | 추정 정지 시각 평균 오차 +2.2ms → 0 |
| velMax (0x0F) | 1000 | **1200** | 세게 친 타격이 127에 몰림 |

## 6. BLE

- 서비스 `a7d50001-9a3c-4f2e-b1c8-5f0e2d7c0001`, notify `…0002`, control(write / write without response) `…0003` — FE `stickProtocol.ts`와 같음
- 연결 간격 7.5~15ms 요청. 패킷 최대 20바이트라 notify 1회 = 패킷 1개
- 보내는 것: HIT, STATUS(5초마다, battery 0xFF), SYNC_ACK, PARAM_ACK(0x00·0x20~0x22 포함), LOG(`BOOT`, `BIAS`, `drop weak|slow|long|short <°/s>`), 설정 모드에서 POSE
- 받는 것: SYNC, SET_MODE, RESET_POSE, SET_PARAM, SET_PAD_TABLE, SET_YAW_OFFSET, GET_PARAMS. HAPTIC은 DRV2605L 연결 전이라 LOG만
- SYNC 수신 시각(t1)은 BLE 쓰기 콜백에서 바로 찍고, 처리·응답은 `loop()`에서 한다
- 아직 없음: SWING(0x05), 배터리 잔량, BOOT LOG의 git 해시

## 7. 실측 (2026-10-26, S15P31A307-144·145)

**IMU** (책상 위 정지, 1초 평균)

| 항목 | Feather (LSM6DS3TR-C) | NUCLEO (BNO055) |
|---|---|---|
| 샘플 | 1688/s, 누락 없음 | 250/s |
| 12바이트 읽기 | 약 0.37ms | 2.4ms (자이로 6바이트) |
| 자이로 노이즈 sd | 0.2~0.5°/s | 3.3~4.7°/s |
| 자이로 바이어스 | x +1.0, y −3.9, z −0.1°/s → 부팅 시 측정해 뺌 | 거의 0 |
| 휘두를 때 최대 | 자이로 1266°/s, 가속도 12.5g (포화 없음) | |

**타격 검출 재생 검증** (`swing_1026.csv` 세게 10 + 중간 10 + 섞어서 15, `nohit_1026.csv` 들어 올리기·천천히 내리기·멈칫·돌리기·내려놓기)

| 항목 | 기본값 그대로 | 위 5장 파라미터 |
|---|---|---|
| 진짜 타격 | 35/35 | **35/35** |
| 가짜 (swing 파일, 버튼 흔들림) | 3 | **0** |
| 가짜 (nohit 파일) | 5 | **0** |
| 검출 시점 | 정지 전 중앙값 11ms (7~15ms) | 같음 |
| 정지 시각 오차 | 평균 +2.2ms, sd 3.0ms | 평균 약 0, sd 3.0ms |

**BLE 지연** (`../tools/ble_latency.html`, Windows Chrome, 1스틱, USB 전원)

| 항목 | 값 |
|---|---|
| SYNC 왕복 | 중앙값 18.4ms, 최소 12.3, p95 28.3 (595회) |
| HIT 도착 − 스틱 정지 | 중앙값 약 **−5ms** (−11 ~ −1ms, 24회). 멈추기 전에 도착 |
| HIT 유실 | 0 |
| 오디오 출력 (크롬 보고값) | 50~58ms. 실제는 출력 장치에 따라 다름 (아래 탭 테스트) |

**경로별 HIT 도착 − 스틱 정지** (`../tools/ble_latency.html`, 같은 계산. 편도 = SYNC 왕복의 절반으로 가정한 값이라 경로끼리 비교용)

| 경로 | 측정일 | SYNC 왕복 중앙값 | 도착 중앙값 | sd | 타격 수 |
|---|---|---|---|---|---|
| USB 시리얼 직결 (Web Serial) | 10/27 | 1.5ms | **−9.2ms** | 1.1ms | 30 |
| WS 브리지 (`ws_bridge.py`, 수정 후) | 10/28 | 4.1ms | **−7.6ms** | 2.0ms | 61 |
| XIAO 동글 → Web Serial (`../dongle_fw_xiao`) | 10/28 | 16.0ms | −6.2ms | 2.8ms | 58 |
| BLE (Web Bluetooth 직접) | 10/27 | 18.9ms | −4.8ms | 3.9ms | 30 |
| WS 브리지 (수정 전) | 10/27 | 18.4ms | +0.7ms | 6.1ms | 30 |

- WS 브리지 수정 전에는 `read(256)`이 256바이트 또는 timeout 10ms까지 묶어서 늦게 내보냈다. `read(1)` + `in_waiting`으로 고친 뒤 왕복 18.4 → 4.1ms, sd 6.1 → 2.0ms
- XIAO 동글: 동글이 스캔을 켜 둔 채면 연결 이벤트를 놓쳐 왕복 50ms, sd 23.6ms까지 나빠졌다. 첫 스틱 연결 뒤 10초만 스캔하도록 고친 뒤 값이 위 표
- 무선 경로 중에서는 동글이 Web Bluetooth 직접보다 1.4ms 빠르고 sd가 30% 작다

**정지 → 소리 실측 (탭 테스트, 2026-10-28, XIAO 동글 경로)**

스틱으로 책상을 치고 폰으로 녹음(48kHz)해서, 책상 소리(정지)와 페이지 측정용 클릭 사이 간격을 파형에서 쟀다.

| 출력 장치 | 정지 → 소리 중앙값 | 범위 | sd | 횟수 |
|---|---|---|---|---|
| 노트북 내장 스피커 | **115ms** | 106.7~122.2ms | 3.7ms | 20 |
| 유선 이어폰 | **61ms** | 51.6~74.6ms | 5.0ms | 25 |

- 같은 타격의 정지 → PC 도착은 +1~2ms라, 나머지는 전부 PC가 소리를 내는 구간이다
- 유선 이어폰(약 59ms)은 크롬 보고값(58ms)과 맞는다. 내장 스피커는 음향 보정(DSP)으로 약 55ms가 더 붙는다
- 센서 + 전송 구간은 정지 시점보다 앞서 끝난다. **30ms 목표를 넘기는 건 PC 오디오 출력**이고, 시연은 유선 출력으로 한다
- 책상을 치면 스틱이 급정지해서 공중 타격(도착 −6ms)보다 검출이 늦다. 공중 타격이면 그만큼 빠를 수 있다

녹화 원본(`swing_1026.csv`, `nohit_1026.csv`, `ble_latency_*.csv`)은 저장소 밖(`ssaplash/`)에 있다.

## 8. 남은 것

- 스틱 부착 후 `HIT_AXIS`·`TIP_AXIS` 확인, 패드 위치 재보정 (지금 기본 패드표는 NUCLEO 때 값이라 Feather에선 방위가 어긋남)
- 오디오 출력 지연 줄이기: 내장 스피커 오디오 향상 끄기·48kHz 효과 확인, 유선 61ms에서 더 줄일 방법
- DRV2605L 진동 로컬 트리거 (PLAY-006), SWING 패킷, 배터리 잔량, BOOT LOG git 해시
- IMU FIFO로 읽기 (지금은 샘플마다 I2C, 루프가 느려지면 `missed` 증가)
- 아주 약한 타격 녹화로 minDecel 6 재확인

## 9. 트러블슈팅

| 증상 | 확인할 것 |
|---|---|
| `'cmd_t' does not name a type` | .ino에 타입·함수를 두면 생김. 본체는 `src/app.cpp`에만 |
| 업로드 `PermissionError(13)` | 그 COM 포트를 다른 프로그램이 열고 있음 (시리얼 모니터 등) |
| 업로드 `FileNotFoundError(2)` | 포트 번호가 바뀜. Tools > Port 다시 선택 |
| `IMU FAIL` | WHO_AM_I가 0x6A가 아님 (LSM6DS33 보드면 레지스터 설정 확인 필요) |
| `missed`가 계속 늘어남 | 루프가 0.6ms 안에 못 돎. 시리얼 출력 줄이기, FIFO 적용 |
| 보조배터리에서 BLE가 주기적으로 끊김 | 보조배터리 저전류 자동 꺼짐 (보드 20mA 미만). 저전류 모드나 휴대폰 충전기, LiPo 사용 |
| 연결 창에 장치가 안 보임 | 시리얼에 `BOOT`이 찍혔는지, 다른 PC·폰이 이미 연결했는지 |
