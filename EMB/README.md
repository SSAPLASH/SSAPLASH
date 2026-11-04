# EMB — 센서 스틱 펌웨어

에어드럼 센서 스틱의 펌웨어 파트입니다. IMU로 스윙을 측정해 타격을 검출하고, 어느 패드를 쳤는지 판별한 결과를 브라우저로 보냅니다.

알고리즘은 **NUCLEO-F103RB + BNO055** 프로토타입(`stick_fw_f103`, Web Serial)에서 만들고 검증했고, 2026-10-26부터 최종 보드 **Adafruit Feather nRF52840 Sense**(`stick_fw_nrf52`, BLE)로 옮기는 중입니다. Feather 쪽 개발 환경·실측은 [`stick_fw_nrf52/README.md`](stick_fw_nrf52/README.md)에 있고, 이 문서의 2~13장은 NUCLEO 프로토타입 기준입니다.

---

## 1. 하드웨어

| 구분 | 프로토타입 (`stick_fw_f103`) | 최종 (`stick_fw_nrf52`, 이식 중) |
|---|---|---|
| MCU 보드 | NUCLEO-F103RB (STM32F103RB, Cortex-M3) | Adafruit Feather nRF52840 Sense (Cortex-M4F) |
| IMU | Adafruit BNO055 (2472, 9축 + 온보드 퓨전), 250Hz | 보드 내장 LSM6DS3TR-C (6축) + LIS3MDL (지자기), 1.66kHz |
| 브라우저 연결 | USB 가상 COM → Web Serial | BLE → Web Bluetooth (USB 시리얼도 가능) |
| 햅틱 | 없음 | DRV2605L + LRA VG0832012 (10/28 도착 예정) |
| 전원 | USB | LiPo 194mAh (YJ601235) + 보드 충전 회로 |

## 2. 개발 환경

| 항목 | 버전 / 내용 |
|---|---|
| IDE | **STM32CubeIDE 1.19.0** (CubeMX 통합 마지막 버전, 팀 내 고정) |
| 펌웨어 패키지 | **STM32Cube FW_F1 V1.8.7** (Help > Configuration Tool > Manage Embedded Software Packages) |
| 드라이버 | ST-Link 드라이버 (CubeIDE 설치 시 함께 설치) |
| 케이블 | **USB Mini-B, 데이터 전송 지원** (충전 전용 케이블은 인식 안 됨) |
| 시리얼 터미널 | CubeIDE 콘솔 또는 Tera Term, 115200 8N1 |
| 계정 | myST 계정 (CubeMX 펌웨어 패키지 다운로드 시 필요) |

> 2.x 버전은 CubeMX가 분리되어 있어 .ioc 편집에 별도 설치가 필요합니다. 버전이 섞이면 .ioc 업그레이드 문제가 생기므로 **1.19.0으로 통일**합니다.

## 3. 핀맵

| 기능 | 설정 | 핀 | 비고 |
|---|---|---|---|
| 시스템 클럭 | HSE Bypass (ST-Link MCO 8MHz) → 72MHz | | 안 잡히면 HSI 64MHz |
| USART2 | 115200, 8N1 | PA2 / PA3 | ST-Link 가상 COM, Web Serial 경로 |
| I2C1 | Fast Mode 400kHz | PB8 (SCL) / PB9 (SDA) | 아두이노 헤더 D15 / D14 |
| 측정용 GPIO | 출력 | PA8 (D7) | 지연 측정 루프백용 부저 |
| LED | 출력 | PA5 (LD2) | 동작 확인 |
| 디버그 | Serial Wire | PA13 / PA14 | 끄면 디버깅 불가 |

## 4. 배선 (BNO055)

| BNO055 | NUCLEO-F103RB |
|---|---|
| VIN | CN6 3V3 |
| GND | CN6 GND |
| SCL | CN5 D15 (PB8) |
| SDA | CN5 D14 (PB9) |

- I2C 주소: **0x28** (ADR 핀 기본 상태). 3Vo, RST, INT, ADR, PS0, PS1은 연결하지 않음
- 브레이크아웃에 풀업 저항이 있어 외부 저항 불필요
- 헤더 핀은 직접 납땜 필요
- CubeMX에서 I2C1을 켜면 기본 핀이 PB6/PB7이므로 **PB8/PB9로 직접 지정**
- 흔들면서 테스트할 때는 보드·센서·선을 테이프로 고정 (접촉 불량 시 I2C 고착)

## 5. 클럭 · 기타 CubeMX 설정

- RCC → HSE: **BYPASS Clock Source** (NUCLEO는 ST-Link에서 8MHz를 받음), HCLK 72MHz
- RCC의 Master Clock Output 경고는 PA8을 부저 GPIO로 써서 생기는 것으로 무시
- 프로젝트 인코딩 UTF-8 (한글 주석 깨짐 방지)

## 6. 빌드 · 플래시

1. CubeIDE에서 `File > Import > Existing Projects into Workspace`로 이 폴더를 불러옵니다
2. 보드를 USB로 연결합니다 (장치 관리자에 ST-Link와 STLink Virtual COM Port가 보여야 정상)
3. 빌드 (`Ctrl+B`) 후 `Run > Debug` 또는 `Run`으로 플래시합니다
4. 시리얼 터미널을 115200으로 열고 출력을 확인합니다

**동작 확인 기준**
- 시리얼에 `boot` → `[IMU] init OK` 출력
- 이후 선택한 테스트 모드(`app_imu_test.c`의 `TEST_MODE`)에 맞는 측정값이 1초마다 출력

## 7. 소스 구성

| 파일 | 내용 |
|---|---|
| `Core/Inc/bno055.h`, `Core/Src/bno055.c` | BNO055 I2C 드라이버 (초기화, 모드 전환, 고속 설정, 읽기, 캘리브레이션 오프셋) |
| `Core/Inc/dwt_timer.h` | DWT 사이클 카운터 기반 µs 측정 |
| `Core/Inc/hit_detect.h`, `Core/Src/hit_detect.c` | 자이로 감속 기반 타격 검출기. HAL 없는 순수 C (PC 재생 테스트, nRF52 이식용) |
| `Core/Inc/pose.h`, `Core/Src/pose.c` | 스틱 끝 방향 추정 (자이로 적분 + 느릴 때 가속도로 기울기 보정, 지자기 미사용). 고도각·방위각 출력 |
| `Core/Inc/pad.h`, `Core/Src/pad.c` | 패드 판정 (방향 벡터 사이 각도가 가장 작은 패드), 패드 테이블, 캘리브레이션 평균 |
| `Core/Inc/app_imu_test.h`, `Core/Src/app_imu_test.c` | 실측용 테스트 앱. `TEST_MODE`로 선택 |
| `tools/capture_serial.py` | TEST_CAPTURE 출력을 CSV로 저장 (`pip install pyserial`) |
| `tools/hit_replay/replay.c` | 녹화 CSV를 PC에서 검출기에 재생: `gcc -O2 -o replay replay.c ../../stick_fw_f103/Core/Src/hit_detect.c -I../../stick_fw_f103/Core/Inc` → `./replay swing.csv 0 -1 -6` |
| `tools/pad_replay/pad_replay.c` | 녹화 CSV를 검출기 + 자세 추정 + 패드 판정에 재생: `gcc -O2 -o pad_replay pad_replay.c ../../stick_fw_f103/Core/Src/{hit_detect,pose,pad}.c -I../../stick_fw_f103/Core/Inc -lm` → `./pad_replay pad.csv <정면 보정 시각(초)>` |
| `tools/sound_test.html` | TEST_HIT 출력 줄을 Web Serial(921600)로 받아 패드별 합성 드럼 소리 재생 (Chrome/Edge, 개발용) |
| `tools/ws_bridge.py` | 시리얼(0xA5 LEN payload CRC8) ↔ WebSocket(`ws://localhost:8765`) 중계, 1초마다 BRIDGE_STATS(0x7E). `python ws_bridge.py COM5` / 보드 없이 `python ws_bridge.py fake` (`pip install pyserial websockets`) |
| `tools/ble_latency.html` | Web Bluetooth로 Feather에 연결해 SYNC 왕복, HIT 도착 − 스틱 정지 시각, 오디오 출력 지연을 재고 소리 재생. CSV 저장 (Chrome/Edge) |

`main.c`에는 USER CODE 영역에 `__io_putchar`(printf → USART2), `app_imu_test_init()`, `app_imu_test_loop()`만 추가합니다.

| TEST_MODE | 용도 |
|---|---|
| `TEST_RATE` | 연속 읽기 속도 측정 (읽기 시간, 실제 갱신 횟수) |
| `TEST_MIXED` | 실전 구조 검증: 4ms 주기 자이로 + 가속도·지자기 분산 읽기, 부팅 시 자이로 바이어스 측정 |
| `TEST_FUSION` | NDOF 퓨전 각도, 캘리브레이션 상태, 오프셋 출력 |
| `TEST_CAPTURE` | 스윙 녹화. 4ms 자이로 + 50Hz 가속도를 CSV로 출력, **921600 baud**. 파란 버튼(B1) = 다음 구간 |
| `TEST_HIT` | 타격 검출 + 패드 판정 실시간 확인. 타격마다 PA8·LED 토글 + 한 줄 출력, **921600 baud**. 파란 버튼(B1) = 정면 보정 + 패드 캘리브레이션 (10장) |

## 8. BNO055 실측 결과 (S15P31A307-114, 2026-10-20)

조건: NUCLEO-F103RB 72MHz, I2C1 400kHz, BNO055 AMG 모드

**읽기 시간**

| 실험 | 설정 | 1회 읽기 | 초당 읽기 | 비고 |
|---|---|---|---|---|
| A | 고속 BW, 18B, 갭 없음 | 4.6~5.7ms | ~180 | 켤 때마다 값이 멈추는 경우 있음 |
| B | 기본 BW, 18B | 3.65ms | 274 | 자이로 32Hz 필터라 타격 검출엔 부적합 |
| C | 고속 BW, 자이로 6B | 2.4~2.7ms | ~370 | |
| D | 고속 BW, 18B, **100kHz** | 4.60ms | 218 | 400kHz와 같음 → 병목은 버스가 아니라 BNO055 내부 |
| E | 고속 BW, 18B, 갭 1ms | 5.8ms | 147 | 값 멈춤 해결 |
| 채택 | 고속 BW, 자이로 6B, 갭 1.3ms | 평균 2.38ms, 최대 3.3ms | 271 | 에러 0 |

- BNO055는 바이트당 약 0.16ms + 매 읽기 고정 약 1.7ms가 걸림 (A·C 비교). 버스 이론값(바이트당 0.02ms)보다 훨씬 큼
- 쉬는 틈 없이 연속으로 읽으면 BNO055가 데이터 레지스터를 갱신하지 못해 값이 멈출 수 있음 → **반드시 주기적으로 읽기**

**4ms 주기 혼합 읽기 (TEST_MIXED)**

| 항목 | 값 |
|---|---|
| 칸 수 / drop | 250/s, 0 |
| 자이로 간격 | 평균 3999µs, 최소 약 2.1ms, 최대 약 6.5ms |
| 한 칸 최대 소요 | 약 6.4ms (가속도 6B 칸) |

가속도 칸이 4ms를 넘어 앞뒤 간격이 흔들림. 스윙 중에는 가속도가 원심력 때문에 쓸모없으므로, 116에서는 자이로가 작을 때(정지에 가까울 때)만 가속도·지자기를 읽는 방식으로 개선 예정.

**노이즈 · 바이어스 · 센서 값 검산**

| 항목 | 값 |
|---|---|
| 자이로 정지 노이즈 (523Hz BW) | 표준편차 3.3~4.7°/s |
| 자이로 바이어스 | 약 0°/s (자체 측정, BNO055 오프셋 모두 0.3°/s 미만) |
| 가속도 크기 (정지) | 약 9.8 m/s² |
| 지자기 크기 | 약 46 µT |

**캘리브레이션 오프셋 (NDOF, sys/gyr/acc/mag 모두 3)**

```
FC FF 26 00 04 00 1F FF 5F FF 81 FE FE FF FC FF FF FF E8 03 EB 02
```

| 항목 | 값 |
|---|---|
| 가속도 오프셋 | -0.04, 0.38, 0.04 m/s² |
| 지자기 오프셋 | -14.1, -10.1, -23.9 µT |
| 자이로 오프셋 | -0.13, -0.25, -0.06 °/s |
| 가속도 / 지자기 반경 | 1000 / 747 |

지자기 오프셋이 지구자기장(약 50µT)의 절반 수준으로 큼. 주변 배선·보드 영향이며, 최종 스틱은 배터리와 LRA(자석 포함)가 가까워 더 커질 수 있음 → 요(좌우) 판별에 지자기를 쓸 때 스틱 조립 상태에서 다시 보정 필요.

## 9. 타격 검출 (S15P31A307-116, 2026-10-21)

**방식**: 스윙 축 자이로의 하강 속도로 상태 머신 IDLE → SWING → HIT → REARM

| 단계 | 조건 |
| --- | --- |
| 스윙 시작 | 하강 속도 > 150°/s, **2샘플 연속** (한 샘플짜리 튐 무시) |
| 타격 판정 | 속도가 최대치의 30% 아래로 떨어지고, 최대 속도 ≥ 400°/s, 감속률 ≥ 3°/s/ms |
| 거름 | 최대 속도 미달(weak), 감속이 느림(slow), 스윙이 400ms 넘음(long) |
| 재무장 | 스틱이 다시 올라감(−50°/s) 또는 판정 후 150ms. 고정 불응기 대신 써서 연타에 강함 |
| 타격 시각 | 판정 순간이 아니라 **직전 감속 기울기로 외삽한 정지 시각** (+3ms 보정) |

정답 시점은 "스틱이 가장 낮은 지점(하강 속도 0)"으로 정의한다 (에어드럼은 실제 충격이 없음).

**녹화 데이터 분석** (`swing_1021.csv`, 70초, BNO055를 젓가락 끝에 부착, 스윙 축 = 자이로 x, 아래로 칠 때 −)

| 동작 | 최대 하강 속도 | 감속률 (°/s per ms) |
| --- | --- | --- |
| 보통 세기 타격 20회 | 570~755°/s | 5.5~10.8 |
| 빠른 연타 5회 (간격 약 0.28초) | 690~750°/s | 9.9~12.6 |
| 들어 올리기만 10회 | 210~280°/s | 0.4~1.1 |
| 천천히 내리기만 11회 | 180~340°/s | 0.3~1.8 |

진짜 타격과 아닌 동작은 속도로 약 2배, 감속률로 5배 이상 차이 → 두 기준을 함께 쓴다.

**검출 결과 (녹화 데이터 재생)**

| 항목 | 값 |
| --- | --- |
| 검출 | 25 / 25 (누락 0), 비타격 동작 오탐 0 |
| 판정 시점 | 스틱 정지보다 **중앙값 14ms 먼저** (평균 16ms, 최소 9.5ms, 최대 36ms) |
| 타임스탬프 오차 (외삽 정지 시각 − 실제 정지 시각) | 평균 0.3ms, 표준편차 3.4ms, 최대 10.6ms |

판정 기준을 최대치의 50%로 하면 26ms 먼저 잡지만 타임스탬프 표준편차가 6ms로 커져서 30%로 정했다.

**실시간 확인 (TEST_HIT)**: 22회 연속 타격 검출, lead 8~36ms, 벨로시티 11~100으로 고르게 분포, 느린 감속 오탐 0

**남은 것**
- 약한 타격(최대 400°/s 미만)은 녹화하지 않아 weak로 거르는 기준이 검증 안 됨. 실시간 확인 중 weak 4회 → 약한 타격 녹화 후 `min_peak_dps` 재조정 (감속률 기준이 따로 있어 300까지 낮춰도 느린 동작은 걸러질 것으로 예상)
- 스윙 축·부호는 부착 방향에 따라 다름 (`HIT_AXIS`, `HIT_SIGN`). 117에서 퓨전 자세의 고도각 변화율로 바꾸면 부착 방향과 무관해짐
- 한 사람, 한 부착 위치 데이터. 손목 스냅 위주 / 팔 전체 스윙 등 다른 타법은 미검증

## 10. 패드 판정 (S15P31A307-117, 2026-10-22)

**자세 추정 (`pose`)**: 자이로를 적분해 자세를 따라가고, 스틱이 느릴 때(각속도 < 200°/s, |a| − g < 1.5m/s²)만 가속도로 기울기를 보정한다. 출력은 센서 축이 아니라 **스틱 끝 방향 벡터**(`HIT_TIP_AXIS`, 현재 센서 +z)의 각도라 쥔 방향(롤)과 무관하다.

| 출력 | 정의 (통신 프로토콜 v0.5와 같음) |
| --- | --- |
| 고도각 | 수평 0, 끝이 위 +. 중력 기준 절대각 |
| 방위각 | 정면 보정 시점 0, 위에서 봐서 시계 방향(오른쪽) +. 지자기를 안 써서 시간이 지나면 밀림 → 웹이 SET_YAW_OFFSET으로 보정 |

- 가속도는 5칸(20ms)마다, 직전 칸이 느릴 때만 읽는다. 스윙 중에는 원심력 때문에 쓸모없고, 안 읽어야 타격 직전 샘플 간격이 일정하다
- TEST_HIT도 921600으로 출력한다. 115200이면 타격 한 줄 출력에 약 7ms가 걸려 샘플이 빠지고, 빠진 구간의 회전이 적분에서 사라져 방위각이 밀린다

**패드 판정 (`pad`)**: 타격 순간 스틱 끝 방향과 패드 기준 방향 사이 **각도**가 가장 작은 패드를 고른다 (고도각·방위각 평면 거리는 스틱이 수직에 가까울 때 방위각이 크게 흔들려서 쓰지 않음). 반경 밖이면 판정 없음(0xFF), 2등과의 각도 차가 margin (10° 미만이면 출력에 `?`, 프로토콜 flags 비트 4).

**기본 패드 테이블** (`pad_1022.csv` 녹화, 패드별 10회 평균, 정면 보정 기준)

| 패드 | 고도각 | 방위각 | 반경 |
| --- | --- | --- | --- |
| HIHAT | 39° | −50° | 30° |
| SNARE | 30° | −27° | 30° |
| SMALL_TOM | 61° | −34° | 30° |
| FLOOR_TOM | 43° | 55° | 30° |

**보드 단독 캘리브레이션 (TEST_HIT)**: 스틱을 정면으로 들고 B1 → 방위각 0 → 안내대로 HIHAT → SMALL_TOM → SNARE → FLOOR_TOM 순서로 패드마다 2번 친다 (FE PLAY-004와 같은 2타). 평균 방향으로 테이블을 만들고, 반경은 가장 가까운 패드까지 각도 × 0.6 (15~35°)으로 자동 설정한다. 웹 연동 후에는 SET_PAD_TABLE로 덮어쓴다.

**남은 것**
- 판정 정확도 실측값(녹화 재생, 실시간)을 이 절에 기록
- 타격 검출은 아직 스윙 축 자이로(`HIT_AXIS`, `HIT_SIGN`)를 쓴다. 고도각 변화율로 바꾸면 부착 방향과 무관해짐
- 기본 테이블 고도각이 모두 +(끝이 위)라 실제 타격 자세·`HIT_TIP_AXIS` 부호 재확인 필요
- 1단계는 4개(HIHAT·SNARE·SMALL_TOM·FLOOR_TOM). CRASH·MID_TOM·RIDE는 기본 테이블에 없음 (패드 번호는 통신 프로토콜 v0.7, KICK·HIHAT_PEDAL은 페달)

## 11. 지연 측정 준비

전체 지연 목표는 **타격 검출 → 소리 출력 30ms 이내**이며, 구간별로 실측하며 줄여 나갑니다.

- **µs 타이머**: Cortex-M3 DWT 사이클 카운터 (`dwt_timer.h`). 구간은 사이클 차이를 먼저 구한 뒤 µs로 변환 (59초 랩어라운드 대비)
- **센서 구간 예상 (BNO055)**: 샘플 대기 최대 4ms + 읽기 약 2.4ms + 감속 확인 샘플 수 × 4ms. 최종 IMU는 kHz 샘플링으로 크게 줄어들 예정
- **루프백 측정**: 타격 검출 순간 PA8로 부저를 울리고, 브라우저 출력음과 함께 녹음해 파형 간격을 측정

## 12. 트러블슈팅

| 증상 | 확인할 것 |
|---|---|
| PC에서 보드가 안 잡힘 | 데이터 케이블인지, ST-Link 펌웨어 업데이트 (CubeIDE가 물어보면 업데이트) |
| 코드 생성(Alt+K)을 해도 Core 폴더가 안 생김 | 펌웨어 패키지 미설치. Manage Embedded Software Packages에서 STM32F1 설치 |
| `init FAIL (3)` | 배선, 주소 0x28. STM32만 리셋되면 BNO055가 SDA를 잡고 있을 수 있어 부팅 시 버스 복구를 수행함. 그래도 안 되면 USB를 뽑았다 꽂기 |
| 읽기가 갑자기 전부 실패 (err 증가) | 점퍼선 접촉 불량 → F1 I2C BUSY 고착. 연속 3회 실패 시 자동 복구(`rec` 증가). 선은 테이프로 고정 |
| 값이 바뀌지 않음 (new=0) | 갭 없이 연속 읽기 중. 주기적으로 읽기 |
| 시리얼에 아무것도 안 나옴 | `__io_putchar` 재정의 여부, Debug 실행 시 Resume(F8), RESET 버튼 |
| printf 출력 없음 | `__io_putchar` 재정의, 줄 끝 `\r\n` |
| float가 출력 안 됨 | 링커 옵션에 `-u _printf_float` 추가 |
| .ioc 재생성 후 설정이 바뀜 | 재생성 전 커밋, 사용자 코드는 `USER CODE` 영역 안에만 작성 |

## 13. Git 규칙

- 올리는 것: `.ioc`, `.project`, `.cproject`, `.mxproject`, `Core/`, `Drivers/`, 링커 스크립트(`*.ld`)
- 올리지 않는 것: `Debug/`, `Release/`, `.settings/` 등 빌드 산출물과 개인 설정 (`.gitignore` 참고)
- `.ioc`가 있으면 같은 버전의 CubeIDE에서 동일하게 코드를 재생성할 수 있습니다
