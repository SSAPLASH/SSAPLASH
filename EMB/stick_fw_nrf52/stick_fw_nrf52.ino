/*
 * stick_fw_nrf52 - 에어드럼 센서 스틱 펌웨어 (Adafruit Feather nRF52840 Sense)
 *
 * IMU(LSM6DS3TR-C) 1.66kHz → 타격 검출(hit_detect) + 자세(pose) + 패드 판정(pad)
 * → HIT 패킷을 BLE notify와 USB 시리얼로 동시에 보낸다. 명령(SYNC 등)은 BLE write / 시리얼로 받는다.
 * 통신 규약: 스틱 통신 프로토콜 v0.7 (GitLab Wiki)
 *
 * 빌드: Arduino IDE 2.x + Adafruit nRF52 BSP 1.7.0, 보드 "Adafruit Feather nRF52840 Sense"
 *
 * USB 시리얼 출력 (SERIAL_MODE)
 *   SERIAL_TEXT   : 사람이 읽는 줄 (시리얼 모니터, 115200 아무거나)
 *   SERIAL_BINARY : 0xA5 LEN payload CRC8 프레임 (EMB/tools/ws_bridge.py → 브라우저)
 *
 * USER 버튼(7번 핀): 전원·정면 보정 (S15P31A307-237)
 *   꺼진 상태에서 누름 → 켜기, 1.5초 누름 → 끄기, 두 번 누름 → 정면 보정(현재 방향을 방위각 0으로), 한 번 누름 → 배터리 표시
 *   BLE·USB 시리얼 연결 없이 10분이면 자동으로 꺼진다
 * 상태 LED: 보드 NeoPixel ("Adafruit NeoPixel" 라이브러리 필요)
 */
#include "src/app.h"

void setup() { app_setup(); }
void loop()  { app_loop(); }
