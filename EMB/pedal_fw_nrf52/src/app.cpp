/*
 * app.cpp - 페달 보드 본체 (pedal_fw_nrf52, S15P31A307-232). 설명은 pedal_fw_nrf52.ino
 *
 * 입력: 풋스위치 COM → GND, NO(또는 NC) → A0(킥) / A1(하이햇). 내부 풀업.
 *   부팅 때 쉬는 상태 레벨을 읽어 NO/NC를 자동으로 맞춘다 (쉬는 상태가 HIGH면 NO, LOW면 NC).
 *   그래서 부팅할 때는 페달을 밟지 않는다.
 * 채터링: 접점이 붙는 첫 순간 바로 보내고(지연 없음) LOCKOUT_US 동안 다시 안 받는다.
 *   떼짐은 RELEASE_US 동안 계속 떨어져 있어야 인정한다 (발을 걸쳐 둘 때 깜빡임 방지).
 * 시각: micros() 하나로 HIT·PEDAL·SYNC_ACK를 찍는다 (FE 시계 보정과 같은 기준).
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
#define FW_MINOR 0
#define FW_TAG   "BOOT 3.0 pedal"
#define BLE_NAME "SSAPLASH-PEDAL"

#define ROLE_HIHAT   2                 /* 왼발 */
#define ROLE_KICK    3                 /* 오른발 */
#define PAD_KICK     7
#define PAD_HH_PEDAL 8
#define PEDAL_VEL    100               /* 페달 HIT 세기 고정 */

/* 보드 USER 버튼 (Sense는 PIN_USER_SW, Express는 PIN_BUTTON1, 둘 다 7번 핀) */
#if defined(PIN_USER_SW)
#define WAKE_PIN PIN_USER_SW
#elif defined(PIN_BUTTON1)
#define WAKE_PIN PIN_BUTTON1
#else
#define WAKE_PIN 7
#endif

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
        send_log("BAT OFF");
        delay(200);
        systemOff(WAKE_PIN, LOW);                    /* USER 버튼으로 다시 켬 */
    }
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
