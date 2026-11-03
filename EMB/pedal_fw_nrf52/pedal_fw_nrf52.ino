/*
 * pedal_fw_nrf52 - 에어드럼 페달 보드 펌웨어 (Adafruit Feather nRF52840, S15P31A307-232)
 *
 * 보드 하나에 풋스위치 2개: 킥(오른발, role 3) = A0, 하이햇(왼발, role 2) = A1. 공통선은 GND.
 * 밟으면 HIT(킥 pad 7 / 하이햇 pad 8)를 BLE notify와 USB 시리얼로 보내고,
 * 하이햇은 밟음·뗌 상태를 PEDAL(0x08)로도 보낸다.
 * 보드는 하나지만 FE에는 기기 2개(왼발·오른발)처럼 보이게 SYNC_ACK·STATUS를 role 2와 3으로 한 번씩 보낸다.
 * 통신 규약: 스틱 통신 프로토콜 v0.8 (GitLab Wiki)
 *
 * 빌드: Arduino IDE 2.x + Adafruit nRF52 BSP, 보드 "Adafruit Feather nRF52840 Sense" (페달 보드가 Sense라 그대로)
 */
#include "src/app.h"

void setup() { app_setup(); }
void loop()  { app_loop(); }
