/*
 * app.cpp - 동글 본체. 설명은 dongle_fw_xiao.ino
 *
 * 지연을 줄이려고
 *  - 연결 간격 7.5ms를 central(동글)이 직접 정한다 (PC 블루투스 스택·브라우저를 거치지 않음)
 *  - notify 콜백을 BLE 이벤트 문맥에서 바로 받는다 (Bluefruit 콜백 태스크를 거치지 않음)
 *  - 받은 패킷은 큐에 넣고 loop가 바로 USB로 내보낸 뒤 flush
 *
 * 스틱 2대: 연결은 최대 MAX_STICKS개까지 받는다. 스틱 → PC 패킷은 flags 비트 0–1(역할)로 구분된다.
 * PC → 스틱 명령은 기본으로 연결된 스틱 모두에 보낸다.
 * 한 스틱에만 보낼 땐 동글 전용 ROUTE: [0x70, 역할 비트마스크, 명령...] → 마스크에 맞는 스틱에만 [명령...]을 쓴다.
 * 동글은 스틱마다 마지막으로 받은 패킷의 flags로 역할을 기억한다 (148, 프로토콜 v0.8 후보)
 */
#include <Arduino.h>
#include <bluefruit.h>
#include "app.h"
#include "stick_proto.h"

#define MAX_STICKS  2
#define CONN_ITV    6          /* 1.25ms 단위 → 7.5ms */
#define CMD_ROUTE   0x70       /* 동글 전용: [0x70, 역할 마스크, 명령...] */
#define SCAN_2ND_S  10         /* 첫 스틱 연결 뒤 두 번째 스틱을 찾는 시간 (초) */

/* a7d5000X-9a3c-4f2e-b1c8-5f0e2d7c0001, 바이트 역순 (스틱 펌웨어와 같음) */
static const uint8_t UUID_SVC[16]    = {0x01,0x00,0x7c,0x2d,0x0e,0x5f,0xc8,0xb1,0x2e,0x4f,0x3c,0x9a,0x01,0x00,0xd5,0xa7};
static const uint8_t UUID_NOTIFY[16] = {0x01,0x00,0x7c,0x2d,0x0e,0x5f,0xc8,0xb1,0x2e,0x4f,0x3c,0x9a,0x02,0x00,0xd5,0xa7};
static const uint8_t UUID_CTRL[16]   = {0x01,0x00,0x7c,0x2d,0x0e,0x5f,0xc8,0xb1,0x2e,0x4f,0x3c,0x9a,0x03,0x00,0xd5,0xa7};

struct stick_link_t {
    BLEClientService        svc{BLEUuid(UUID_SVC)};
    BLEClientCharacteristic chr_notify{BLEUuid(UUID_NOTIFY)};
    BLEClientCharacteristic chr_ctrl{BLEUuid(UUID_CTRL)};
    uint16_t conn = BLE_CONN_HANDLE_INVALID;
    bool     ready = false;
    int8_t   role = -1;        /* 스틱 패킷 flags 비트 0–1, 아직 모르면 -1 */
};
static stick_link_t sticks[MAX_STICKS];

/* ---------- USB로 내보낼 패킷 큐 (BLE 태스크 → loop) ---------- */
struct out_t { uint8_t len; uint8_t d[PKT_MAX]; };
static QueueHandle_t outq;
static volatile uint32_t n_drop = 0;

static void out_push(const uint8_t *p, uint16_t n)
{
    if (n == 0 || n > PKT_MAX) return;
    out_t o; o.len = (uint8_t)n; memcpy(o.d, p, n);
    if (xQueueSend(outq, &o, 0) != pdTRUE) n_drop++;
}
static void out_log(const char *s)
{
    uint8_t b[PKT_MAX];
    out_push(b, pkt_log(b, 0, s));
}

/* ---------- LED (XIAO RGB, 하드웨어상 LOW = 켜짐. 반대로 켜지면 여기만 뒤집기) ---------- */
static void led(int pin, bool on)
{
#ifdef LED_BLUE
    digitalWrite(pin, on ? LOW : HIGH);
#endif
}

static int n_ready()
{
    int n = 0;
    for (auto &s : sticks) n += s.ready;
    return n;
}
static stick_link_t *by_conn(uint16_t h)
{
    for (auto &s : sticks) if (s.conn == h) return &s;
    return nullptr;
}
static stick_link_t *free_slot()
{
    for (auto &s : sticks) if (s.conn == BLE_CONN_HANDLE_INVALID) return &s;
    return nullptr;
}

/* ---------- BLE 콜백 ---------- */
static void notify_cb(BLEClientCharacteristic *chr, uint8_t *data, uint16_t len)
{
    if (len >= 2)
        for (auto &s : sticks)
            if (&s.chr_notify == chr) s.role = data[1] & 0x03;
    out_push(data, len);
}

static void scan_cb(ble_gap_evt_adv_report_t *report)
{
    if (free_slot()) Bluefruit.Central.connect(report);
    else Bluefruit.Scanner.resume();
}

static void connect_cb(uint16_t h)
{
    stick_link_t *s = free_slot();
    if (!s) { Bluefruit.disconnect(h); return; }
    s->conn = h;
    BLEConnection *c = Bluefruit.Connection(h);
    c->requestConnectionParameter(CONN_ITV);

    if (!s->svc.discover(h) || !s->chr_notify.discover() || !s->chr_ctrl.discover()) {
        out_log("DONGLE no svc");
        Bluefruit.disconnect(h);
        return;
    }
    s->chr_notify.enableNotify();
    s->ready = true;
    out_log(n_ready() == 1 ? "DONGLE stick 1" : "DONGLE stick 2");

    /* 스캔은 연결과 라디오를 나눠 쓴다. 계속 켜 두면 연결 이벤트를 놓쳐 지연이 수십 ms 튄다 (10/28 실측 RTT 50ms).
     * 그래서 두 번째 스틱은 첫 연결 뒤 SCAN_2ND_S초 동안만 찾고 끈다. 나중에 붙이려면 동글 리셋 */
    if (free_slot()) Bluefruit.Scanner.start(SCAN_2ND_S * 100);   /* 10ms 단위 */
}

static void disconnect_cb(uint16_t h, uint8_t reason)
{
    (void)reason;
    stick_link_t *s = by_conn(h);
    if (s) { s->conn = BLE_CONN_HANDLE_INVALID; s->ready = false; s->role = -1; }
    out_log("DONGLE lost");
    Bluefruit.Scanner.start(0);                         /* 다시 붙을 때까지 찾기 (붙으면 위 규칙대로 꺼짐) */
}

/* ---------- PC → 스틱 ---------- */
static void to_sticks(const uint8_t *p, uint8_t n)
{
    uint8_t mask = 0xFF;
    if (n >= 3 && p[0] == CMD_ROUTE) { mask = p[1]; p += 2; n -= 2; }
    else if (p[0] == CMD_ROUTE) return;                  /* 감싼 명령이 비었으면 버림 */
    bool sent = false;
    for (auto &s : sticks) {
        if (!s.ready) continue;
        if (mask != 0xFF && (s.role < 0 || !(mask & (1 << s.role)))) continue;
        s.chr_ctrl.write(p, n);                         /* write without response */
        sent = true;
    }
    if (!sent && mask != 0xFF) out_log("DONGLE route miss");
}

void app_setup()
{
#ifdef LED_BLUE
    pinMode(LED_RED, OUTPUT);  led(LED_RED, false);
    pinMode(LED_BLUE, OUTPUT); led(LED_BLUE, false);
    pinMode(LED_GREEN, OUTPUT); led(LED_GREEN, false);
#endif
    Serial.begin(115200);
    outq = xQueueCreate(64, sizeof(out_t));

    /* BANDWIDTH_MAX는 연결 하나가 이벤트를 길게(최대 125ms) 잡을 수 있어서, 2대면 서로 번갈아 밀려 간격이 사실상 15ms가 된다
     * (10/28 실측: 1대 왕복 16ms → 2대 28ms). 패킷이 20바이트라 NORMAL(3.75ms)이면 두 연결이 한 간격에 들어간다 */
    Bluefruit.configCentralBandwidth(BANDWIDTH_NORMAL);
    Bluefruit.begin(0, MAX_STICKS);                     /* peripheral 0, central MAX_STICKS */
    Bluefruit.setName("SSAPLASH-DONGLE");
    Bluefruit.setTxPower(4);

    for (auto &s : sticks) {
        s.svc.begin();
        s.chr_notify.setNotifyCallback(notify_cb, false);  /* false = BLE 이벤트에서 바로 호출 */
        s.chr_notify.begin(&s.svc);
        s.chr_ctrl.begin(&s.svc);
    }

    Bluefruit.Central.setConnInterval(CONN_ITV, CONN_ITV);
    Bluefruit.Central.setConnectCallback(connect_cb);
    Bluefruit.Central.setDisconnectCallback(disconnect_cb);

    Bluefruit.Scanner.setRxCallback(scan_cb);
    Bluefruit.Scanner.restartOnDisconnect(false);       /* disconnect_cb에서 직접 다시 시작 */
    Bluefruit.Scanner.filterUuid(BLEUuid(UUID_SVC));
    Bluefruit.Scanner.setInterval(160, 80);             /* 100ms마다 50ms 듣기 */
    Bluefruit.Scanner.useActiveScan(false);
    Bluefruit.Scanner.start(0);
}

void app_loop()
{
    /* 스틱 → PC */
    out_t o;
    bool wrote = false;
    while (xQueueReceive(outq, &o, 0) == pdTRUE) {
        uint8_t f[PKT_MAX + 3];
        Serial.write(f, frame_wrap(f, o.d, o.len));
        wrote = true;
    }
    if (wrote) Serial.flush();

    /* PC → 스틱 */
    static deframer_t dfr;
    static bool dfr_init = false;
    if (!dfr_init) { deframer_init(&dfr); dfr_init = true; }
    while (Serial.available()) {
        uint8_t p[PKT_MAX], n = deframer_feed(&dfr, (uint8_t)Serial.read(), p);
        if (n) to_sticks(p, n);
    }

    /* LED: 파랑 = 연결 수만큼(1대 켜짐), 빨강 = 아무것도 없으면 깜빡 */
#ifdef LED_BLUE
    int n = n_ready();
    led(LED_BLUE, n > 0);
    led(LED_RED, n == 0 && (millis() / 300) % 2);
#endif

    if (!wrote) delay(0);
}
