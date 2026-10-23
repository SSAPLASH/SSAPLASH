# EMB — 센서 스틱 펌웨어

에어드럼 센서 스틱의 펌웨어 파트입니다. IMU로 스윙을 측정해 타격을 검출하고, 어느 패드를 쳤는지 판별한 결과를 브라우저로 보냅니다.

최종 보드(Adafruit Feather nRF52840 Sense)가 도착하기 전까지는 **NUCLEO-F103RB + BNO055**로 프로토타입을 만들고, 브라우저와는 **Web Serial(USB)**로 연결합니다.

---

## 1. 하드웨어

| 구분 | 프로토타입 (현재) | 최종 |
|---|---|---|
| MCU 보드 | NUCLEO-F103RB (STM32F103RB, Cortex-M3) | Adafruit Feather nRF52840 Sense |
| IMU | Adafruit BNO055 (2472, 9축 + 온보드 퓨전) | 보드 내장 IMU |
| 브라우저 연결 | USB 가상 COM → Web Serial | BLE → Web Bluetooth |
| 햅틱 | 없음 | DRV2605L + LRA |

## 2. 개발 환경

| 항목 | 버전 / 내용 |
|---|---|
| IDE | **STM32CubeIDE 1.19.0** (CubeMX 통합 마지막 버전, 팀 내 고정) |
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
| VIN | 3V3 |
| GND | GND |
| SCL | D15 (PB8) |
| SDA | D14 (PB9) |

- I2C 주소: **0x28** (ADR 핀 기본 상태)
- 브레이크아웃에 풀업 저항이 있어 외부 저항 불필요
- 헤더 핀은 직접 납땜 필요

## 5. 빌드 · 플래시

1. CubeIDE에서 `File > Import > Existing Projects into Workspace`로 이 폴더를 불러옵니다
2. 보드를 USB로 연결합니다 (장치 관리자에 ST-Link와 STLink Virtual COM Port가 보여야 정상)
3. 빌드 (`Ctrl+B`) 후 `Run > Debug` 또는 `Run`으로 플래시합니다
4. 시리얼 터미널을 115200으로 열고 출력을 확인합니다

**동작 확인 기준**
- LD2가 0.5초 간격으로 깜빡임
- 시리얼에 `BNO055 chip id: 0xA0` 출력

## 6. 지연 측정 준비

전체 지연 목표는 **타격 검출 → 소리 출력 30ms 이내**이며, 구간별로 실측하며 줄여 나갑니다.

- **µs 타이머**: Cortex-M3 DWT 사이클 카운터 사용 (`micros()`)
- **루프백 측정**: 타격 검출 순간 PA8로 부저를 울리고, 브라우저 출력음과 함께 녹음해 파형 간격을 측정

## 7. 트러블슈팅

| 증상 | 확인할 것 |
|---|---|
| PC에서 보드가 안 잡힘 | 데이터 케이블인지, ST-Link 펌웨어 업데이트 (STM32CubeProgrammer) |
| chip id 읽기 실패 | 배선, 주소 0x28, 전원 인가 후 약 700ms 대기 |
| printf 출력 없음 | `__io_putchar` 재정의, 줄 끝 `\r\n` |
| float가 출력 안 됨 | 링커 옵션에 `-u _printf_float` 추가 |
| .ioc 재생성 후 설정이 바뀜 | 재생성 전 커밋, 사용자 코드는 `USER CODE` 영역 안에만 작성 |

## 8. Git 규칙

- 올리는 것: `.ioc`, `.project`, `.cproject`, `.mxproject`, `Core/`, `Drivers/`, 링커 스크립트(`*.ld`)
- 올리지 않는 것: `Debug/`, `Release/`, `.settings/` 등 빌드 산출물과 개인 설정 (`.gitignore` 참고)
- `.ioc`가 있으면 같은 버전의 CubeIDE에서 동일하게 코드를 재생성할 수 있습니다
