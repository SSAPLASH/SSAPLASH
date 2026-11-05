/*
 * dongle_fw_xiao - 스틱 BLE 수신 동글 (Seeed XIAO nRF52840, S15P31A307-148)
 *
 * PC에 USB로 꽂아 두면 스틱(SSAPLASH-STICK)을 BLE central로 직접 잡고,
 * 스틱 패킷을 USB 시리얼 바이너리 프레임(0xA5 LEN payload CRC8)으로 그대로 넘긴다.
 * 브라우저 → 스틱 명령도 같은 프레임으로 받아 스틱에 쓴다.
 * 브라우저 입장에선 스틱을 USB로 꽂은 것과 같다 (Web Serial 또는 ws_bridge.py).
 *
 * 빌드: Arduino IDE 2.x + "Seeed nRF52 Boards" (mbed 아닌 쪽), 보드 "Seeed XIAO nRF52840"
 * LED: 파랑 = 스틱 연결됨, 빨강 깜빡 = 스캔 중
 */
#include "src/app.h"

void setup() { app_setup(); }
void loop()  { app_loop(); }
