/*
 * app.cpp - 펌웨어 본체 (stick_fw_nrf52)
 *   .ino는 Arduino 전처리(함수 원형 자동 생성)가 타입 순서를 꼬아서 setup/loop만 두고 본체는 여기
 *
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
 * USER 버튼(7번 핀): 정면 보정 (현재 방향을 방위각 0으로)
 */
#include "app.h"
#include <Arduino.h>
#include <Wire.h>
#include <bluefruit.h>

extern "C" {
#include "hit_detect.h"
#include "pose.h"
#include "pad.h"
#include "stick_proto.h"
}

/* ===================== 설정 ===================== */
#define SERIAL_TEXT   0
#define SERIAL_BINARY 1
#define SERIAL_MODE   SERIAL_BINARY

#define FW_MAJOR 1                     /* 1 = Feather nRF52840 Sense */
#define FW_MINOR 0                     /* develop-EMB 병합 전 */
#define FW_TAG   "BOOT 1.0 nrf52"

#define BLE_NAME "SSAPLASH-STICK"

#define PIN_IMU_INT  3                 /* LSM6DS3TR-C INT1 (Adafruit 핀맵) */
#define PIN_USER_SW  7

#define IMU_ADDR 0x6A
#define GYRO_DPS_PER_LSB 0.070f        /* ±2000dps */
#define ACC_G_PER_LSB    0.000488f     /* ±16g */
#define G_MS2            9.80665f

/* 스윙 축: 2026-10-26 녹화에서 내려칠 때 자이로 y가 + (보드를 손에 쥔 방향 기준. 스틱 부착 후 재확인) */
#define HIT_AXIS 1
#define HIT_SIGN (+1)
/* 스틱 끝 방향 (센서 좌표). 부착 방향이 정해지면 녹화로 확인할 것 */
static const float TIP_AXIS[3] = {1.0f, 0.0f, 0.0f};

#define ACC_EVERY        5             /* 자세 보정에 가속도를 쓰는 간격 (샘플). 250Hz·5칸마다였던 117과 같은 세기 */
#define MARGIN_AMBIG_X10 100           /* margin 10° 미만이면 판정 애매 플래그 */
#define BIAS_SAMPLES     1666          /* 부팅 시 바이어스 측정 1초 */
#define BIAS_MAX_SD_DPS  3.0f          /* 이보다 흔들리면 측정 실패 → 기본값 */
static const float BIAS_DEFAULT_DPS[3] = {1.0f, -3.9f, -0.1f};   /* 2026-10-26 실측 */

/* ===================== µs 시계 (TIMER4, 1MHz, 32비트) =====================
 * 프로토콜 시각이 µs u32(약 71.6분 랩어라운드)이므로 하드웨어 타이머를 그대로 쓴다.
 * Arduino micros()는 이 보드에서 약 1ms 단위라 쓰지 않는다 (2026-10-26 실측) */
static void clock_init()
{
    NRF_TIMER4->TASKS_STOP = 1;
    NRF_TIMER4->MODE = TIMER_MODE_MODE_Timer;
    NRF_TIMER4->BITMODE = TIMER_BITMODE_BITMODE_32Bit;
    NRF_TIMER4->PRESCALER = 4;                         /* 16MHz / 2^4 = 1MHz */
    NRF_TIMER4->TASKS_CLEAR = 1;
    NRF_TIMER4->TASKS_START = 1;
}
static inline uint32_t now_us()                        /* 메인 루프용 (CC[0]) */
{
    NRF_TIMER4->TASKS_CAPTURE[0] = 1;
    return NRF_TIMER4->CC[0];
}
static inline uint32_t now_us_isr()                    /* 인터럽트용 (CC[1]) */
{
    NRF_TIMER4->TASKS_CAPTURE[1] = 1;
    return NRF_TIMER4->CC[1];
}
static inline uint32_t now_us_ble()                    /* BLE 콜백용 (CC[2]) */
{
    NRF_TIMER4->TASKS_CAPTURE[2] = 1;
    return NRF_TIMER4->CC[2];
}

/* ===================== IMU ===================== */
static void imu_wr(uint8_t r, uint8_t v)
{
    Wire.beginTransmission(IMU_ADDR); Wire.write(r); Wire.write(v); Wire.endTransmission();
}
static uint8_t imu_rd8(uint8_t r)
{
    Wire.beginTransmission(IMU_ADDR); Wire.write(r); Wire.endTransmission(false);
    Wire.requestFrom(IMU_ADDR, 1);
    return Wire.read();
}
static bool imu_read(int16_t v[6])                     /* 자이로 xyz, 가속도 xyz (원시) */
{
    Wire.beginTransmission(IMU_ADDR); Wire.write(0x22);
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom(IMU_ADDR, 12) != 12) return false;
    uint8_t b[12];
    for (int i = 0; i < 12; i++) b[i] = Wire.read();
    for (int i = 0; i < 6; i++) v[i] = (int16_t)(b[2 * i] | (b[2 * i + 1] << 8));
    return true;
}

static volatile uint32_t drdy_t = 0, drdy_count = 0;
static void imu_isr() { drdy_t = now_us_isr(); drdy_count++; }

static bool imu_init()
{
    if (imu_rd8(0x0F) != 0x6A) return false;           /* WHO_AM_I: LSM6DS3TR-C */
    imu_wr(0x12, 0x01); delay(20);                     /* 소프트 리셋 */
    imu_wr(0x12, 0x44);                                /* BDU + 주소 자동 증가 */
    imu_wr(0x10, 0x84);                                /* 가속도 1.66kHz ±16g */
    imu_wr(0x11, 0x8C);                                /* 자이로 1.66kHz 2000dps */
    imu_wr(0x0B, 0x80);                                /* DRDY 펄스 모드: 못 읽어도 다음 샘플에 다시 펄스 */
    imu_wr(0x0D, 0x02);                                /* INT1 = 자이로 데이터 준비 */
    delay(50);
    return true;
}

/* ===================== 상태 ===================== */
static hit_params_t   hp;
static hit_detector_t hd;
static pose_t         pose;
static pad_table_t    pads;
static float          bias_dps[3];
static uint8_t        role = 1;                        /* 0 왼손, 1 오른손 */
static uint8_t        mode = 0;                        /* 0 연주, 1 설정(+POSE) */
static int16_t        pose_rate_hz = 50;
static int16_t        haptic_enable = 1, haptic_strength = 200;
static uint8_t        hit_seq = 0, pose_seq = 0;
static uint32_t       n_samples = 0, n_missed = 0;

static uint8_t flags() { return role & FLAG_ROLE_MASK; }

/* ===================== 송신 ===================== */
/* FE stickProtocol.ts 값. 128비트 UUID는 바이트 역순(리틀 엔디언)으로 넣는다
 * a7d5000X-9a3c-4f2e-b1c8-5f0e2d7c0001 */
static const uint8_t UUID_SVC[16]    = {0x01,0x00,0x7c,0x2d,0x0e,0x5f,0xc8,0xb1,0x2e,0x4f,0x3c,0x9a,0x01,0x00,0xd5,0xa7};
static const uint8_t UUID_NOTIFY[16] = {0x01,0x00,0x7c,0x2d,0x0e,0x5f,0xc8,0xb1,0x2e,0x4f,0x3c,0x9a,0x02,0x00,0xd5,0xa7};
static const uint8_t UUID_CTRL[16]   = {0x01,0x00,0x7c,0x2d,0x0e,0x5f,0xc8,0xb1,0x2e,0x4f,0x3c,0x9a,0x03,0x00,0xd5,0xa7};

BLEService        svc(UUID_SVC);
BLECharacteristic chr_notify(UUID_NOTIFY);
BLECharacteristic chr_ctrl(UUID_CTRL);
static volatile bool ble_connected = false;

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
    send(b, pkt_log(b, flags(), s));
#if SERIAL_MODE == SERIAL_TEXT
    if (Serial) Serial.printf("[LOG] %s\r\n", s);
#endif
}

static void send_status()
{
    uint8_t b[PKT_MAX];
    send(b, pkt_status(b, flags(), 0xFF, 0, FW_MAJOR, FW_MINOR));
}

static void send_param(uint8_t id, int16_t v)
{
    uint8_t b[PKT_MAX];
    send(b, pkt_param_ack(b, flags(), id, v));
}

/* ===================== 파라미터 (SET_PARAM id → 값) ===================== */
static int16_t param_get(uint8_t id)
{
    switch (id) {
    case 0x01: return hp.swing_start_dps;
    case 0x02: return hp.brake_pct;
    case 0x03: return hp.min_peak_dps;
    case 0x04: return (int16_t)hp.debounce_ms;
    case 0x05: return haptic_enable;
    case 0x06: return haptic_strength;
    case 0x07: return role;
    case 0x09: return pose_rate_hz;
    case 0x0A: return (int16_t)hp.min_decel_x10;
    case 0x0B: return (int16_t)hp.max_swing_ms;
    case 0x0C: return hp.rearm_up_dps;
    case 0x0D: return (int16_t)hp.rearm_idle_ms;
    case 0x0E: return hp.ts_corr_us;
    case 0x0F: return hp.vel_max_dps;
    }
    return 0;
}
static int16_t clampi(int16_t v, int16_t lo, int16_t hi) { return v < lo ? lo : v > hi ? hi : v; }
static bool param_set(uint8_t id, int16_t v)
{
    switch (id) {
    case 0x01: hp.swing_start_dps = clampi(v, 50, 1000); break;
    case 0x02: hp.brake_pct = (uint8_t)clampi(v, 5, 90); break;
    case 0x03: hp.min_peak_dps = clampi(v, 100, 2000); break;
    case 0x04: hp.debounce_ms = (uint16_t)clampi(v, 0, 500); break;
    case 0x05: haptic_enable = clampi(v, 0, 1); break;
    case 0x06: haptic_strength = clampi(v, 0, 255); break;
    case 0x07: role = (uint8_t)clampi(v, 0, 3); break;
    case 0x09: pose_rate_hz = clampi(v, 1, 200); break;
    case 0x0A: hp.min_decel_x10 = (uint16_t)clampi(v, 0, 1000); break;
    case 0x0B: hp.max_swing_ms = (uint16_t)clampi(v, 50, 1000); break;
    case 0x0C: hp.rearm_up_dps = clampi(v, 0, 1000); break;
    case 0x0D: hp.rearm_idle_ms = (uint16_t)clampi(v, 0, 1000); break;
    case 0x0E: hp.ts_corr_us = clampi(v, -20000, 20000); break;
    case 0x0F: hp.vel_max_dps = clampi(v, 200, 2000); break;
    default: return false;
    }
    hd.p = hp;                                          /* 검출기 상태는 유지하고 파라미터만 교체 */
    return true;
}
static const uint8_t PARAM_IDS[] = {0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x09,0x0A,0x0B,0x0C,0x0D,0x0E,0x0F};

/* ===================== 명령 처리 ===================== */
/* BLE 콜백은 다른 태스크에서 돌기 때문에 큐에 넣고 loop()에서 처리한다. SYNC 수신 시각만 콜백에서 바로 찍는다 */
#define CMDQ 16
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
    cmd_push(data, len, now_us_ble());
}

static void handle_cmd(const cmd_t *c)
{
    const uint8_t *d = c->d;
    uint8_t b[PKT_MAX];
    switch (d[0]) {
    case CMD_SYNC:
        if (c->len >= 5) send(b, pkt_sync_ack(b, flags(), rd32(&d[1]), c->t_rx));
        break;
    case CMD_SET_MODE:
        if (c->len >= 2) mode = d[1];
        break;
    case CMD_HAPTIC:
        send_log("HAPTIC n/a");                         /* DRV2605L 연결 전 */
        break;
    case CMD_RESET_POSE: {
        float el, az;
        pose_reset_yaw(&pose);
        pose_angles(&pose, &el, &az);
        send_param(PID_RESET_POSE, (int16_t)(el * 100));
        break;
    }
    case CMD_SET_PARAM:
        if (c->len >= 4) {
            uint8_t id = d[1];
            if (param_set(id, (int16_t)rd16(&d[2]))) send_param(id, param_get(id));
        }
        break;
    case CMD_SET_PAD_TABLE:
        if (c->len >= 2) {
            uint8_t ctrl = d[1], n = ctrl & 0x0F;
            if (ctrl & 0x80) pad_table_clear(&pads);
            for (uint8_t i = 0; i < n && 2 + 6 * (i + 1) <= c->len; i++) {
                const uint8_t *e = &d[2 + 6 * i];
                if (e[0] < PAD_MAX)
                    pad_table_set(&pads, e[0], (int16_t)rd16(&e[1]) / 100.0f, (int16_t)rd16(&e[3]) / 100.0f, e[5] * 0.5f);
            }
            send_param(PID_PAD_TABLE, pads.n);
        }
        break;
    case CMD_SET_YAW_OFFSET:
        if (c->len >= 3) {
            int16_t v = (int16_t)rd16(&d[1]);
            pose.az_offset_deg = v / 100.0f;
            send_param(PID_YAW_OFFSET, v);
        }
        break;
    case CMD_GET_PARAMS:
        for (uint8_t i = 0; i < sizeof PARAM_IDS; i++) send_param(PARAM_IDS[i], param_get(PARAM_IDS[i]));
        send_param(PID_GET_END, sizeof PARAM_IDS);
        break;
    }
}

/* ===================== BLE ===================== */
static void connect_cb(uint16_t conn_hdl)
{
    BLEConnection *conn = Bluefruit.Connection(conn_hdl);
    conn->requestConnectionParameter(6);                /* 7.5ms (1.25ms 단위) */
    ble_connected = true;
}
static void disconnect_cb(uint16_t, uint8_t) { ble_connected = false; }

static void ble_init()
{
    Bluefruit.configPrphBandwidth(BANDWIDTH_MAX);
    Bluefruit.begin();
    Bluefruit.setTxPower(4);
    Bluefruit.setName(BLE_NAME);
    Bluefruit.Periph.setConnectCallback(connect_cb);
    Bluefruit.Periph.setDisconnectCallback(disconnect_cb);
    Bluefruit.Periph.setConnInterval(6, 12);            /* 7.5~15ms */

    svc.begin();

    chr_notify.setProperties(CHR_PROPS_NOTIFY);
    chr_notify.setPermission(SECMODE_OPEN, SECMODE_NO_ACCESS);
    chr_notify.setMaxLen(PKT_MAX);
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

/* ===================== 부팅 ===================== */
static void measure_bias(float acc_mean_ms2[3])
{
    double s[3] = {0}, q[3] = {0}, a[3] = {0};
    uint32_t n = 0, last = drdy_count;
    uint32_t t_end = millis() + 2000;
    while (n < BIAS_SAMPLES && millis() < t_end) {
        if (drdy_count == last) continue;
        last = drdy_count;
        int16_t v[6];
        if (!imu_read(v)) continue;
        for (int i = 0; i < 3; i++) {
            float g = v[i] * GYRO_DPS_PER_LSB;
            s[i] += g; q[i] += g * g;
            a[i] += v[3 + i] * ACC_G_PER_LSB * G_MS2;
        }
        n++;
    }
    bool ok = n > BIAS_SAMPLES / 2;
    for (int i = 0; i < 3 && ok; i++) {
        double m = s[i] / n, sd = sqrt(q[i] / n - m * m);
        if (sd > BIAS_MAX_SD_DPS) ok = false;
    }
    for (int i = 0; i < 3; i++) {
        bias_dps[i] = ok ? (float)(s[i] / n) : BIAS_DEFAULT_DPS[i];
        acc_mean_ms2[i] = n ? (float)(a[i] / n) : (i == 2 ? G_MS2 : 0);
    }
    char msg[20];
    snprintf(msg, sizeof msg, ok ? "BIAS %d %d %d" : "BIAS default", (int)(bias_dps[0] * 10), (int)(bias_dps[1] * 10), (int)(bias_dps[2] * 10));
    send_log(msg);
}

void app_setup()
{
    Serial.begin(115200);
    uint32_t t0 = millis();
    while (!Serial && millis() - t0 < 1500) delay(10);  /* PC 없이도 1.5초 후 시작 (배터리 단독) */

    pinMode(PIN_USER_SW, INPUT_PULLUP);
    clock_init();
    Wire.begin();
    Wire.setClock(400000);
    ble_init();

    if (!imu_init()) {
        while (1) { send_log("IMU FAIL"); delay(1000); }
    }
    pinMode(PIN_IMU_INT, INPUT);
    attachInterrupt(digitalPinToInterrupt(PIN_IMU_INT), imu_isr, RISING);

    hit_default_params(&hp);                            /* 1.66kHz용 값 (2026-10-26 녹화 swing/nohit 기준) */
    hp.min_decel_x10 = 60;                              /* 가짜(천천히 멈춤) ≤5.2, 진짜 ≥9.2 */
    hp.max_swing_ms  = 160;                             /* 진짜 71~112ms, 가짜 175~219ms */
    hp.min_swing_ms  = 20;                              /* 버튼·충격 튐(1ms) 제거 */
    hp.ts_corr_us    = 800;                             /* 정지 시각 평균 오차 0으로 */
    hp.vel_max_dps   = 1200;                            /* 세게 친 타격이 127에 붙지 않게 */
    hit_init(&hd, &hp);
    pad_table_default(&pads);

    send_log(FW_TAG);
    send_log("hold still...");
    float acc0[3];
    measure_bias(acc0);
    pose_init(&pose, TIP_AXIS);
    pose_start(&pose, acc0);
    send_status();
#if SERIAL_MODE == SERIAL_TEXT
    if (Serial) Serial.print("n t_hit_ms pad el az mg peak vel sw decel | detect->send us | missed\r\n");
#endif
}

/* ===================== 루프 ===================== */
void app_loop()
{
    static uint32_t last_count = 0, t_prev = 0, t_status = 0, t_pose = 0, t_btn = 0;
    static uint32_t rej_prev[4] = {0};
    static uint8_t  btn_prev = 1;
    static float    az_swing_start = 0;
    static hit_state_t st_prev = HIT_IDLE;
    static uint32_t acc_div = 0;
    static deframer_t dfr;
    static bool dfr_init = false;
    if (!dfr_init) { deframer_init(&dfr); dfr_init = true; }

    /* 명령 */
    while (cq_tail != cq_head) { handle_cmd(&cmdq[cq_tail]); cq_tail = (uint8_t)((cq_tail + 1) % CMDQ); }
#if SERIAL_MODE == SERIAL_BINARY
    while (Serial.available()) {
        uint32_t t_rx = now_us();
        uint8_t p[PKT_MAX], n = deframer_feed(&dfr, (uint8_t)Serial.read(), p);
        if (n) cmd_push(p, n, t_rx);
    }
#endif

    /* 버튼: 정면 보정 */
    uint8_t btn = digitalRead(PIN_USER_SW);
    if (!btn && btn_prev && millis() - t_btn > 300) {
        t_btn = millis();
        cmd_t c = {1, {CMD_RESET_POSE}, 0};
        handle_cmd(&c);
        send_log("RESET_POSE (btn)");
    }
    btn_prev = btn;

    /* 상태 5초마다 */
    if (millis() - t_status > 5000) { t_status = millis(); send_status(); }

    /* IMU 새 샘플 */
    uint32_t cnt = drdy_count;
    if (cnt == last_count) return;
    noInterrupts(); uint32_t t = drdy_t; cnt = drdy_count; interrupts();
    if (cnt - last_count > 1) n_missed += cnt - last_count - 1;
    last_count = cnt;

    int16_t v[6];
    if (!imu_read(v)) return;
    n_samples++;
    float g[3], dt = t_prev ? (t - t_prev) * 1e-6f : 0.0006f;
    t_prev = t;
    for (int i = 0; i < 3; i++) g[i] = v[i] * GYRO_DPS_PER_LSB - bias_dps[i];

    /* 자세 */
    float a[3], *ap = NULL;
    if (++acc_div >= ACC_EVERY) {
        acc_div = 0;
        for (int i = 0; i < 3; i++) a[i] = v[3 + i] * ACC_G_PER_LSB * G_MS2;
        ap = a;
    }
    pose_update(&pose, g, ap, dt);

    /* 타격 검출: hit_detect는 BNO055 단위(16 LSB/dps) 정수로 받는다 */
    int32_t down = (int32_t)(HIT_SIGN * g[HIT_AXIS] * 16.0f);
    hit_event_t ev;
    int fired = hit_update(&hd, t, down, &ev);

    if (hd.st == HIT_SWING && st_prev != HIT_SWING) {   /* 스윙 시작 시 방위각 (lateral 계산용) */
        float el0; pose_angles(&pose, &el0, &az_swing_start);
    }
    st_prev = hd.st;

    if (fired) {
        float el, az;
        pose_angles(&pose, &el, &az);
        pad_result_t pr = pad_classify(&pads, el, az);
        pkt_hit_t h;
        uint32_t mg = (uint32_t)(pr.margin_deg * 10);
        h.flags = flags() | (mg < MARGIN_AMBIG_X10 ? FLAG_AMBIGUOUS : 0);
        h.seq = hit_seq++;
        h.t_hit_us = ev.t_hit_us;
        h.pad = pr.id;
        h.margin_x10 = (uint8_t)(mg > 255 ? 255 : mg);
        h.elev_x100 = (int16_t)(el * 100);
        h.azim_x100 = (int16_t)(az * 100);
        h.peak_dps = ev.peak_dps;
        h.velocity = ev.velocity;
        h.swing_ms = ev.swing_ms;
        float lat = az - az_swing_start;
        if (lat > 180) lat -= 360;
        if (lat < -180) lat += 360;
        h.lateral_x10 = (int16_t)(lat * 10);
        h.decel_x10 = (uint8_t)(ev.decel_x10 > 255 ? 255 : ev.decel_x10);
        uint8_t b[PKT_MAX];
        uint8_t n = pkt_hit(b, &h);
        send(b, n);
        uint32_t t_sent = now_us();
#if SERIAL_MODE == SERIAL_TEXT
        if (Serial)
            Serial.printf("%3u %8lu %-9s%c %4d %4d %3u %4u %3u %3u %4.1f | %4lu | %lu\r\n",
                          h.seq, ev.t_hit_us / 1000, pad_name(pr.id), (h.flags & FLAG_AMBIGUOUS) ? '?' : ' ',
                          (int)el, (int)az, (unsigned)(mg / 10), ev.peak_dps, ev.velocity, ev.swing_ms,
                          ev.decel_x10 / 10.0f, t_sent - ev.t_detect_us, n_missed);
#endif
    }

    /* 거른 스윙 → LOG drop (재무장 단계에서 보내 HIT를 늦추지 않음) */
    uint32_t rej[4] = {hd.n_reject_weak, hd.n_reject_slow, hd.n_reject_long, hd.n_reject_short};
    static const char *why[4] = {"weak", "slow", "long", "short"};
    for (int i = 0; i < 4; i++) if (rej[i] != rej_prev[i]) {
        char m[20]; snprintf(m, sizeof m, "drop %s %ld", why[i], (long)(hd.peak / 16));
        send_log(m);
        rej_prev[i] = rej[i];
    }

    /* 설정 모드: POSE 주기 전송 */
    if (mode == 1 && (uint32_t)(t - t_pose) >= 1000000UL / (uint32_t)pose_rate_hz) {
        t_pose = t;
        float el, az;
        pose_angles(&pose, &el, &az);
        uint8_t b[PKT_MAX];
        send(b, pkt_pose(b, flags(), t, (int16_t)(el * 100), (int16_t)(az * 100), 0, pose_seq++));
    }
}
