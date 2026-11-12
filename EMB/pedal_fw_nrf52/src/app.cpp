/*
 * app.cpp - 페달 보드 본체 (pedal_fw_nrf52, S15P31A307-232). 설명은 pedal_fw_nrf52.ino
 *
 * 입력: 풋스위치 COM → GND, NO(또는 NC) → A0(킥) / A1(하이햇). 내부 풀업.
 *   부팅 때 쉬는 상태 레벨을 읽어 NO/NC를 자동으로 맞춘다 (쉬는 상태가 HIGH면 NO, LOW면 NC).
 *   그래서 부팅할 때는 페달을 밟지 않는다.
 * 채터링: 접점이 붙는 첫 순간 바로 보내고(지연 없음) LOCKOUT_US 동안 다시 안 받는다.
 *   떼짐은 RELEASE_US 동안 계속 떨어져 있어야 인정한다 (발을 걸쳐 둘 때 깜빡임 방지).
 * 시각: micros() 하나로 HIT·PEDAL·SYNC_ACK를 찍는다 (FE 시계 보정과 같은 기준).
 * 전원 버튼·LED (FW 3.1): 박스 뚜껑의 불 들어오는 버튼. 아래 "전원 버튼 · LED" 참고.
 */
#include "app.h"
#include <Arduino.h>
#include <bluefruit.h>

extern "C" {
#include "stick_proto.h"
}

/* ===================== 설정 ===================== */
#define SERIAL_TEXT   0
#define SERIAL_BINARY 1
#define SERIAL_MODE   SERIAL_BINARY

#define FW_MAJOR 3                     /* 3 = 페달 보드 */
#define FW_MINOR 2                     /* 1 = 박스 전원 버튼(D5)·LED(D6), 2 = 버튼 튐(1초 안 반복 짧은 누름)은 BAT 표시·로그 대신 10초마다 BTN noise 집계 */
#define FW_TAG   "BOOT 3.2 pedal"
#define BLE_NAME "SSAPLASH-PEDAL"

#define ROLE_HIHAT   2                 /* 왼발 */
#define ROLE_KICK    3                 /* 오른발 */
#define PAD_KICK     7
#define PAD_HH_PEDAL 8
#define PEDAL_VEL    100               /* 페달 HIT 세기 고정 */

/* 전원 버튼·LED 핀 (D9·D6·D5 3핀 헤더 하나. 보드 GND 헤더는 풋스위치가 쓰고 있어 D9를 LOW로 두고 GND 대신 쓴다)
 *   버튼(6mm 택트, LED 내장): 스위치 D5 ↔ D9, LED + → D6, LED − → D9 (빨간 칠 쪽이 LED −)
 *   D5·D6·D9는 Feather nRF52840 Sense·Express 같은 자리 */
#define PIN_PWR_BTN  5
#define PIN_PWR_LED  6
#define PIN_PWR_GND  9

#define LOCKOUT_US   15000             /* 밟은 뒤 이 시간 동안 다시 안 받음 (빠른 더블 킥도 60ms 이상) */
#define RELEASE_US   10000             /* 이만큼 계속 떨어져 있어야 뗌 */

/* ===================== 송신 ===================== */
/* 스틱과 같은 서비스·특성 UUID (동글이 이 서비스로 찾는다) */
static const uint8_t UUID_SVC[16]    = {0x01,0x00,0x7c,0x2d,0x0e,0x5f,0xc8,0xb1,0x2e,0x4f,0x3c,0x9a,0x01,0x00,0xd5,0xa7};
static const uint8_t UUID_NOTIFY[16] = {0x01,0x00,0x7c,0x2d,0x0e,0x5f,0xc8,0xb1,0x2e,0x4f,0x3c,0x9a,0x02,0x00,0xd5,0xa7};
static const uint8_t UUID_CTRL[16]   = {0x01,0x00,0x7c,0x2d,0x0e,0x5f,0xc8,0xb1,0x2e,0x4f,0x3c,0x9a,0x03,0x00,0xd5,0xa7};

BLEService        svc(UUID_SVC);
BLECharacteristic chr_notify(UUID_NOTIFY);
BLECharacteristic chr_ctrl(UUID_CTRL);
static volatile bool ble_connected = false;
static volatile bool status_due = false;

static void send(const uint8_t *p, uint8_t n)
{
    if (ble_connected && chr_notify.notifyEnabled()) chr_notify.notify(p, n);
#if SERIAL_MODE == SERIAL_BINARY
    if (Serial) { uint8_t f[PKT_MAX + 3]; Serial.write(f, frame_wrap(f, p, n)); }
#endif
}

static void send_log(const char *s)
{
    uint8_t b[PKT_MAX];
    send(b, pkt_log(b, ROLE_KICK, s));
#if SERIAL_MODE == SERIAL_TEXT
    if (Serial) Serial.printf("[LOG] %s\r\n", s);
#endif
}

/* ===================== 배터리 (스틱과 같음) ===================== */
#define BAT_WARN_MV  3500
#define BAT_OFF_MV   3300
#define BAT_OFF_N    3

static void power_off(const char *why);

static uint16_t bat_mv = 0;
static uint8_t  bat_pct = 0xFF;

static uint16_t bat_read_mv()
{
    uint32_t sum = 0;
    for (int i = 0; i < 8; i++) sum += analogRead(PIN_VBAT);
    return (uint16_t)(sum / 8 * 0.73242188f * 2.0f);
}

static uint8_t bat_percent(uint16_t mv)
{
    static const uint16_t MV[]  = {4200, 4100, 4000, 3900, 3850, 3800, 3750, 3700, 3650, 3500, 3300};
    static const uint8_t  PCT[] = { 100,   90,   78,   64,   55,   45,   35,   22,   12,    5,    0};
    if (mv >= MV[0]) return 100;
    for (int i = 1; i < (int)(sizeof MV / sizeof MV[0]); i++)
        if (mv >= MV[i]) return (uint8_t)(PCT[i] + (PCT[i - 1] - PCT[i]) * (mv - MV[i]) / (MV[i - 1] - MV[i]));
    return 0;
}

/* STATUS는 role 2·3으로 한 번씩. 페달은 웹에서 받을 설정이 없어 '설정 전'(비트 5)은 항상 0 */
static void send_status()
{
    uint8_t b[PKT_MAX];
    send(b, pkt_status(b, ROLE_HIHAT, bat_pct, 0, FW_MAJOR, FW_MINOR));
    send(b, pkt_status(b, ROLE_KICK,  bat_pct, 0, FW_MAJOR, FW_MINOR));
}

static void bat_update()
{
    static uint8_t n_low = 0, k = 0;
    static bool warned = false;
    bat_mv = bat_read_mv();
    bat_pct = bat_percent(bat_mv);
    char s[19];
    if (k++ % 6 == 0) { snprintf(s, sizeof s, "BAT %umV %u%%", bat_mv, bat_pct); send_log(s); }
    if (bat_mv < BAT_WARN_MV && !warned) { warned = true; send_log("BAT LOW"); }
    n_low = bat_mv < BAT_OFF_MV ? n_low + 1 : 0;
    if (n_low >= BAT_OFF_N) {
        power_off("BAT OFF");                        /* 박스 버튼(D5)으로 다시 켬 */
    }
}

/* ===================== 전원 버튼 · LED =====================
 *   꺼진 상태에서 누름 → 깨어나 부팅 (LED 켜짐)
 *   2초 누름          → 누르는 동안 LED 빠르게 깜빡 → 꺼짐 (손 떼면 깊은 잠)
 *   한 번 누름         → 배터리 깜빡 1~4번 (25%씩)
 *   LED: 동글 연결 찾는 중 1초 주기 깜빡, 연결되면 계속 켜짐
 *   BLE·USB 시리얼 없이 10분 → 자동으로 꺼짐. 배터리 3.3V 아래 3번 연속 → 꺼짐
 * D5는 부트로더가 보지 않아서 systemOff로 자도 깨어날 때 DFU로 빠지지 않는다 (스틱 USER 버튼과 다름).
 * 잠든 동안 D9 LOW·D6 LOW 출력 상태는 유지된다 (nRF52 System OFF는 GPIO 설정을 그대로 둔다).
 * 흰 LED(1mA에서 2.57V)라 저항 없이 기본 구동(standard drive)으로 켠다. 강한 구동으로 바꾸지 말 것 */
#define LONG_PRESS_MS 2000
#define AUTO_OFF_MS   (10UL * 60UL * 1000UL)

static uint32_t ui_last_click = 0;    /* 직전 짧은 누름 시각 (튐 판별) */
static uint16_t ui_noise = 0;         /* 10초 동안 모인 튐 수 */
static uint32_t ui_noise_ms = 0;
static bool     ui_armed = false;     /* 부팅을 깨운 누름이 떨어진 뒤부터 버튼을 받는다 */
static uint32_t ui_t_down = 0;        /* 누르고 있는 중이면 누른 시각, 아니면 0 */
static uint32_t ui_link_ms = 0, ui_blink_t0 = 0;
static uint8_t  ui_blinks = 0;

static void power_pins_init()
{
    pinMode(PIN_PWR_GND, OUTPUT);
    digitalWrite(PIN_PWR_GND, LOW);
    pinMode(PIN_PWR_LED, OUTPUT);
    digitalWrite(PIN_PWR_LED, HIGH);
    pinMode(PIN_PWR_BTN, INPUT_PULLUP);
    ui_link_ms = millis();
}

static void power_off(const char *why)
{
    send_log(why);
    for (int i = 0; i < 6; i++) { digitalWrite(PIN_PWR_LED, (i & 1) ? HIGH : LOW); delay(80); }
    digitalWrite(PIN_PWR_LED, LOW);
    digitalWrite(LED_RED, LOW);
    while (!digitalRead(PIN_PWR_BTN)) delay(10);        /* 누른 채로 자면 바로 다시 깨어난다 */
    delay(100);
    Bluefruit.Advertising.restartOnDisconnect(false);
    Bluefruit.Advertising.stop();
    for (uint16_t h = 0; h < BLE_MAX_CONNECTION; h++)
        if (Bluefruit.connected(h)) Bluefruit.disconnect(h);
    delay(50);
    systemOff(PIN_PWR_BTN, LOW);                        /* D5가 LOW(눌림)면 깨어나 리셋 → 앱 부팅 */
}

static void ui_update()
{
    uint32_t now = millis();
    bool down = !digitalRead(PIN_PWR_BTN);

    if (!ui_armed) {
        if (!down) ui_armed = true;
    } else if (down) {
        if (!ui_t_down) ui_t_down = now ? now : 1;
        else if (now - ui_t_down >= LONG_PRESS_MS) power_off("OFF (btn)");
    } else if (ui_t_down) {
        uint32_t held = now - ui_t_down;
        ui_t_down = 0;
        if (held >= 30 && ui_last_click && now - ui_last_click < 1000) {
            ui_noise++;                                 /* 1초 안에 또 짧게 눌림 = 배선 튐으로 본다 (11/11 0.3초마다 BTN BAT 297건) */
            ui_last_click = now;
        } else if (held >= 30) {                        /* 30ms 미만은 튐 */
            ui_last_click = now;
            ui_blinks = bat_pct == 0xFF ? 1 : bat_pct > 75 ? 4 : bat_pct > 50 ? 3 : bat_pct > 25 ? 2 : 1;
            ui_blink_t0 = now;
            char s[19];
            snprintf(s, sizeof s, "BTN BAT %u%%", bat_pct);
            send_log(s);
        }
    }

    if (ui_noise && now - ui_noise_ms >= 10000) {        /* 튐은 10초에 한 번만 알린다 */
        char s[19];
        snprintf(s, sizeof s, "BTN noise %u", ui_noise);
        send_log(s);
        ui_noise = 0;
        ui_noise_ms = now;
    }

    if (ble_connected || Serial) ui_link_ms = now;
    if (now - ui_link_ms > AUTO_OFF_MS) power_off("OFF (idle 10min)");

    bool on;
    if (ui_t_down && now - ui_t_down > 300) {
        on = ((now - ui_t_down) / 100) & 1;             /* 길게 누르는 중: 빠르게 깜빡 */
    } else if (ui_blinks) {
        uint32_t ph = now - ui_blink_t0;
        if (ph < 400) on = false;                       /* 잠깐 끄고 */
        else {
            uint32_t k = (ph - 400) / 200;              /* 켜짐 200 · 꺼짐 200 반복 */
            if (k >= 2u * ui_blinks + 1) { ui_blinks = 0; on = true; }
            else on = !(k & 1);
        }
    } else {
        on = ble_connected ? true : ((now / 500) & 1);
    }
    digitalWrite(PIN_PWR_LED, on ? HIGH : LOW);
}

/* ===================== 페달 입력 ===================== */
struct pedal_t {
    uint8_t  pin, role, pad;
    bool     has_state;          /* 하이햇: 밟음·뗌 상태(PEDAL)도 보냄 */
    uint8_t  idle;               /* 쉬는 상태 레벨 (HIGH = NO, LOW = NC) */
    bool     down;               /* 인정된 상태 */
    uint32_t t_press, t_up0;     /* 마지막 밟음 시각, 떨어지기 시작한 시각 (0 = 붙어 있음) */
    uint8_t  seq;
};
static pedal_t pedals[2] = {
    {A0, ROLE_KICK,  PAD_KICK,     false, HIGH, false, 0, 0, 0},
    {A1, ROLE_HIHAT, PAD_HH_PEDAL, true,  HIGH, false, 0, 0, 0},
};

static void send_hit(pedal_t &p, uint32_t t)
{
    pkt_hit_t h;
    memset(&h, 0, sizeof h);
    h.flags = p.role;
    h.seq = p.seq++;
    h.t_hit_us = t;
    h.pad = p.pad;
    h.margin_x10 = 255;                                 /* 스위치라 판정이 애매할 일 없음 */
    h.velocity = PEDAL_VEL;
    uint8_t b[PKT_MAX];
    send(b, pkt_hit(b, &h));
}

/* 0x08 PEDAL (v0.8 초안): [0]0x08 [1]flags [2]state [3-6]t_us */
static void send_pedal_state(pedal_t &p, uint8_t state, uint32_t t)
{
    uint8_t b[7] = {PKT_PEDAL, p.role, state, (uint8_t)t, (uint8_t)(t >> 8), (uint8_t)(t >> 16), (uint8_t)(t >> 24)};
    send(b, sizeof b);
}

static void pedals_init()
{
    char s[19];
    for (auto &p : pedals) {
        pinMode(p.pin, INPUT_PULLUP);
    }
    delay(5);
    for (auto &p : pedals) {
        int hi = 0;
        for (int i = 0; i < 20; i++) { hi += digitalRead(p.pin); delay(1); }
        p.idle = hi >= 10 ? HIGH : LOW;
    }
    snprintf(s, sizeof s, "PEDAL K %s H %s", pedals[0].idle ? "NO" : "NC", pedals[1].idle ? "NO" : "NC");
    send_log(s);
}

static void pedals_poll()
{
    for (auto &p : pedals) {
        uint32_t now = micros();
        bool raw = digitalRead(p.pin) != p.idle;         /* true = 밟힘 */
        if (!p.down) {
            if (raw && now - p.t_press >= LOCKOUT_US) {  /* 첫 순간 바로 */
                p.down = true; p.t_press = now; p.t_up0 = 0;
                send_hit(p, now);
                if (p.has_state) send_pedal_state(p, 1, now);
                digitalWrite(LED_RED, HIGH);
            }
        } else {
            if (raw) { p.t_up0 = 0; continue; }
            if (p.t_up0 == 0) p.t_up0 = now ? now : 1;
            if (now - p.t_up0 >= RELEASE_US && now - p.t_press >= LOCKOUT_US) {
                p.down = false;
                if (p.has_state) send_pedal_state(p, 0, p.t_up0);
                digitalWrite(LED_RED, LOW);
            }
        }
    }
}

/* ===================== 명령 ===================== */
#define CMDQ 8
static cmd_t cmdq[CMDQ];
static volatile uint8_t cq_head = 0, cq_tail = 0;

static void cmd_push(const uint8_t *d, uint16_t len, uint32_t t_rx)
{
    uint8_t nx = (uint8_t)((cq_head + 1) % CMDQ);
    if (nx == cq_tail || len == 0 || len > PKT_MAX) return;
    cmdq[cq_head].len = (uint8_t)len;
    memcpy(cmdq[cq_head].d, d, len);
    cmdq[cq_head].t_rx = t_rx;
    cq_head = nx;
}

static void ctrl_write_cb(uint16_t, BLECharacteristic *, uint8_t *data, uint16_t len)
{
    cmd_push(data, len, micros());
}

static void handle_cmd(const cmd_t *c)
{
    const uint8_t *d = c->d;
    uint8_t b[PKT_MAX];
    switch (d[0]) {
    case CMD_SYNC:                                      /* role 2·3 둘 다 답한다 (FE는 역할별로 시계 보정) */
        if (c->len >= 5) {
            send(b, pkt_sync_ack(b, ROLE_HIHAT, rd32(&d[1]), c->t_rx));
            send(b, pkt_sync_ack(b, ROLE_KICK,  rd32(&d[1]), c->t_rx));
        }
        break;
    case CMD_GET_PARAMS:                                /* 페달은 파라미터 없음 */
        send(b, pkt_param_ack(b, ROLE_KICK, PID_GET_END, 0));
        break;
    default:                                            /* SET_PARAM·SET_PAD_TABLE·HAPTIC 등은 페달에 해당 없음 */
        break;
    }
}

/* ===================== BLE ===================== */
static void connect_cb(uint16_t conn_hdl)
{
    Bluefruit.Connection(conn_hdl)->requestConnectionParameter(6);
    ble_connected = true;
}
static void disconnect_cb(uint16_t, uint8_t) { ble_connected = false; }
static void cccd_cb(uint16_t, BLECharacteristic *, uint16_t value) { if (value & BLE_GATT_HVX_NOTIFICATION) status_due = true; }

static void ble_init()
{
    Bluefruit.configPrphBandwidth(BANDWIDTH_MAX);
    Bluefruit.begin();
    Bluefruit.setTxPower(4);
    Bluefruit.setName(BLE_NAME);
    Bluefruit.Periph.setConnectCallback(connect_cb);
    Bluefruit.Periph.setDisconnectCallback(disconnect_cb);
    Bluefruit.Periph.setConnInterval(6, 12);

    svc.begin();
    chr_notify.setProperties(CHR_PROPS_NOTIFY);
    chr_notify.setPermission(SECMODE_OPEN, SECMODE_NO_ACCESS);
    chr_notify.setMaxLen(PKT_MAX);
    chr_notify.setCccdWriteCallback(cccd_cb);
    chr_notify.begin();

    chr_ctrl.setProperties(CHR_PROPS_WRITE | CHR_PROPS_WRITE_WO_RESP);
    chr_ctrl.setPermission(SECMODE_NO_ACCESS, SECMODE_OPEN);
    chr_ctrl.setMaxLen(PKT_MAX);
    chr_ctrl.setWriteCallback(ctrl_write_cb);
    chr_ctrl.begin();

    Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
    Bluefruit.Advertising.addTxPower();
    Bluefruit.Advertising.addService(svc);
    Bluefruit.ScanResponse.addName();
    Bluefruit.Advertising.restartOnDisconnect(true);
    Bluefruit.Advertising.setInterval(32, 244);
    Bluefruit.Advertising.setFastTimeout(30);
    Bluefruit.Advertising.start(0);
}

void app_setup()
{
    Serial.begin(115200);
    analogReference(AR_INTERNAL_3_0);
    analogReadResolution(12);
    uint32_t t0 = millis();
    while (!Serial && millis() - t0 < 1500) delay(10);

    pinMode(LED_RED, OUTPUT);
    digitalWrite(LED_RED, LOW);
    power_pins_init();
    ble_init();
    send_log(FW_TAG);
    pedals_init();
    bat_update();
    send_status();
}

void app_loop()
{
    static uint32_t t_status = 0;
    static deframer_t dfr;
    static bool dfr_init = false;
    if (!dfr_init) { deframer_init(&dfr); dfr_init = true; }

    pedals_poll();
    ui_update();

    while (cq_tail != cq_head) { handle_cmd(&cmdq[cq_tail]); cq_tail = (uint8_t)((cq_tail + 1) % CMDQ); }
#if SERIAL_MODE == SERIAL_BINARY
    while (Serial.available()) {
        uint32_t t_rx = micros();
        uint8_t p[PKT_MAX], n = deframer_feed(&dfr, (uint8_t)Serial.read(), p);
        if (n) cmd_push(p, n, t_rx);
    }
#endif

    if (status_due) { status_due = false; t_status = millis(); send_status(); }   /* 연결 직후 1회 */
    if (millis() - t_status > 5000) { t_status = millis(); bat_update(); send_status(); }
}
