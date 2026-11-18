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
#include <nrf_soc.h>                       /* sd_clock_hfclk_request */
#include <Adafruit_LittleFS.h>
#include <InternalFileSystem.h>
#include <Adafruit_NeoPixel.h>             /* 상태 LED (라이브러리 매니저: "Adafruit NeoPixel") */
using namespace Adafruit_LittleFS_Namespace;

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
#define FW_MINOR 11                    /* 1 = 프로토콜 v0.8 (연결 즉시 STATUS, UNCONFIGURED 플래그), 2 = 정지 중 바이어스 재추정 (234), 3 = 전원 버튼·상태 LED (237), 4 = 패드 밖 타격 진동 안 함, 5 = 끄기를 systemOff 대신 대기 후 리셋 (DFU 진입 방지), 6 = 세기 상한 2000·세기별 진동 3단계 (236), 7 = 스틱을 돌려 쥐어도 타격 감지 (235), 8 = 세기 상한 1400·진동 경계 68/92 (343), 9 = µs 시계를 크리스탈(HFXO)로 고정 (345), 10 = 정지 바이어스 재추정 조건 강화 (346), 11 = 크리스탈(HFXO) 실패 재시도·연주 중 감시 (345), 자이로 포화 로그 SAT (346) */
/* 비교 실험용: 1이면 1.9의 느슨한 정지 판정으로 빌드 (11/10 1.9 vs 1.10 비교). 평소엔 0 */
#define BIAS_STILL_V19    0
#if BIAS_STILL_V19
#define FW_TAG   "BOOT 1.11 nrf52 bias19"
#else
#define FW_TAG   "BOOT 1.11 nrf52"
#endif

/* 스틱마다 이 한 줄만 바꿔서 굽는다: 0 = 왼손, 1 = 오른손.
 * HIT 등 모든 패킷 flags 비트 0–1에 실리고(프로토콜 v0.7), BLE 이름 끝에 -L / -R이 붙는다.
 * 실행 중 SET_PARAM 0x07로도 바꿀 수 있지만 껐다 켜면 이 값으로 돌아온다 */
#define STICK_ROLE 0
#if STICK_ROLE == 0
#define BLE_NAME "SSAPLASH-STICK-L"
#else
#define BLE_NAME "SSAPLASH-STICK-R"
#endif

#define PIN_IMU_INT  3                 /* LSM6DS3TR-C INT1 (Adafruit 핀맵) */
#define PIN_USER_SW  7

#define IMU_ADDR 0x6A
#define GYRO_DPS_PER_LSB 0.070f        /* ±2000dps */
#define ACC_G_PER_LSB    0.000488f     /* ±16g */
#define G_MS2            9.80665f

/* 타격 신호 (235): 1 = 스틱 끝이 아래로 내려가는 회전 속도(pose_down_rate). 스틱을 돌려 쥐어도 같다.
 *                  0 = 예전 방식, 센서 y축 하나 (위아래를 맞춰 쥐어야 함). 문제 생기면 0으로 되돌린다 */
#define HIT_ROLL_FREE 1
/* 스윙 축 (HIT_ROLL_FREE 0일 때만): 2026-10-26 녹화에서 내려칠 때 자이로 y가 + (보드를 손에 쥔 방향 기준) */
#define HIT_AXIS 1
#define HIT_SIGN (+1)
/* 스틱 끝 방향 (센서 좌표). 부착 방향이 정해지면 녹화로 확인할 것 */
static const float TIP_AXIS[3] = {1.0f, 0.0f, 0.0f};

#define ACC_EVERY        5             /* 자세 보정에 가속도를 쓰는 간격 (샘플). 250Hz·5칸마다였던 117과 같은 세기 */
#define MARGIN_AMBIG_X10 100           /* margin 10° 미만이면 판정 애매 플래그 */
#define BIAS_SAMPLES     1666          /* 부팅 시 바이어스 측정 1초 */
#define BIAS_MAX_SD_DPS  3.0f          /* 이보다 흔들리면 측정 실패 → 기본값 */
static const float BIAS_DEFAULT_DPS[3] = {1.0f, -3.9f, -0.1f};   /* 2026-10-26 실측 (보드 1개 값. 플래시에 저장값이 없을 때만) */
#define BIAS_SAVE_SD_DPS 0.5f          /* 부팅 측정이 이만큼 조용하면(책상 위) 이 보드 값으로 플래시에 저장. 11/4 손에 쥔 부팅이 sd 0.6으로 저장돼 0.8 → 0.5 */
#define BIAS_FILE        "/gyro_bias.bin"

/* 정지 중 자이로 바이어스 재추정 (S15P31A307-234)
 * 2026-11-04 실측: 왼손 보드는 7분 쓰는 동안 바이어스가 +0.5°/s 변해 방위각이 분당 약 17° 밀렸다 (칩 온도 변화).
 * 부팅 때 한 번 잰 값으로는 못 따라가서, 스틱이 멈춰 있을 때마다 그 순간의 자이로 평균으로 천천히 다시 잡는다.
 * 기준값은 swing_1026·nohit_1026 녹화로 확인: 스윙 중에는 정지로 잡히지 않아 바이어스가 0.1°/s 넘게 흔들리지 않음 */
#if BIAS_STILL_V19
#define STILL_DPS         4.0f
#define STILL_MIN_SAMPLES 500
#else
#define STILL_DPS         1.5f         /* 바이어스 뺀 각속도 크기가 이보다 작고 (1.9까지 4.0: 손에 들고 천천히 돌리는 것까지 정지로 봤다) */
#define STILL_MIN_SAMPLES 1666         /* 1초(1.66kHz) 이상 이어지면 정지 (1.9까지 0.3초) */
#endif
#define STILL_ACC_MS2     0.6f         /* | |a| − g | 가 이보다 작은 샘플이 */
#define BIAS_TAU_S        2.0f         /* 정지 중 바이어스를 따라가는 시간 상수 */
#if BIAS_STILL_V19
#define BIAS_MAX_DEV_DPS  4.0f
#else
#define BIAS_MAX_DEV_DPS  1.0f         /* 부팅 값에서 이보다 멀어지지 않게 (1.9까지 4.0)
                                        * 11/10 리듬 게임 중 왼손 BT x가 0.83 → −0.56 → 1.05°/s로 튐: 쉬는 박자에 들고 있던 움직임을
                                        * 바이어스로 먹어 방향이 분당 수십 도 흘렀다. 온도로 변하는 양은 ±1°/s 안 */
#endif

/* ===================== µs 시계 (TIMER4, 1MHz, 32비트) =====================
 * 프로토콜 시각이 µs u32(약 71.6분 랩어라운드)이므로 하드웨어 타이머를 그대로 쓴다.
 * Arduino micros()는 이 보드에서 약 1ms 단위라 쓰지 않는다 (2026-10-26 실측)
 * TIMER4는 HFCLK로 돈다. SoftDevice는 무선을 쓸 때만 크리스탈(HFXO)을 켜고 그 사이엔 내부 RC(HFINT)로 돌려서
 * 보드마다 시계가 분당 수십 ms씩 다르게 흘렀다 (11/10 모니터: 오른손 오프셋 6분에 −176ms, 웹 판정이 손마다 어긋남).
 * hfxo_hold()로 크리스탈을 계속 켜 둔다 (약 0.25mA 더 씀, 오차 ±20ppm = 분당 약 1ms) */
static void clock_init()
{
    NRF_TIMER4->TASKS_STOP = 1;
    NRF_TIMER4->MODE = TIMER_MODE_MODE_Timer;
    NRF_TIMER4->BITMODE = TIMER_BITMODE_BITMODE_32Bit;
    NRF_TIMER4->PRESCALER = 4;                         /* 16MHz / 2^4 = 1MHz */
    NRF_TIMER4->TASKS_CLEAR = 1;
    NRF_TIMER4->TASKS_START = 1;
}

/* SoftDevice가 켜진 뒤(Bluefruit.begin 다음)에 부른다. 켜졌는지 로그로 남긴다 */
static bool hfxo_hold()
{
    if (sd_clock_hfclk_request() != NRF_SUCCESS) return false;
    uint32_t running = 0;
    for (int i = 0; i < 50 && !running; i++) { sd_clock_hfclk_is_running(&running); delay(1); }   /* 기동 약 0.4ms */
    return running != 0;
}
/* 11/12 왼손이 하루 종일 분당 −21~−39ms로 흘렀다(오른손·페달 0~3ms). 부팅 때 크리스탈이 안 걸렸거나 도중에 풀린 것으로 본다.
 * 부팅 때 3번까지 다시 시도하고, 연주 중에도 10초마다 확인해 꺼져 있으면 다시 켠다 (345) */
static void send_log(const char *s);
static uint16_t hfxo_lost = 0;                          /* 연주 중 풀려서 다시 켠 횟수 */
static void hfxo_watch()
{
    uint32_t running = 0;
    sd_clock_hfclk_is_running(&running);
    if (running) return;
    sd_clock_hfclk_request();
    hfxo_lost++;
    char m[19];
    snprintf(m, sizeof m, "HFXO lost %u", hfxo_lost);
    send_log(m);
}

/* 자이로 포화 (346): ±2000dps 끝에 닿은 샘플 수를 축별로 센다. 빠른 연주에서 오른손 방향이 25~60° 흐른 원인 확인용 */
#define SAT_LSB 27857                                   /* 1950dps / 0.070 */
static uint32_t sat_n[3] = {0, 0, 0};

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
static float          bias_boot[3];                   /* 부팅 때 정한 값 (재추정 한계의 기준) */
static uint32_t       still_updates = 0;              /* 정지 재추정이 적용된 샘플 수 */
static uint8_t        role = STICK_ROLE;               /* 0 왼손, 1 오른손 */
static uint8_t        mode = 0;                        /* 0 연주, 1 설정(+POSE) */
static int16_t        pose_rate_hz = 50;
static int16_t        haptic_enable = 1, haptic_strength = 200;
static int16_t        lat_log = 0;                    /* SET_PARAM 0x10 = 1: 타격마다 펌웨어 구간 지연 LOG "LT" (233, 측정용) */
static uint8_t        hit_seq = 0, pose_seq = 0;
static uint32_t       n_samples = 0, n_missed = 0;

static bool           configured = false;            /* 부팅 뒤 웹 설정을 한 번이라도 받았나 (v0.8 STATUS 플래그) */
static volatile bool  status_due = false;            /* 동글·브라우저가 notify를 켜면 STATUS 바로 보내기 */

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

/* ===================== 배터리 =====================
 * Feather nRF52840 Sense: VBAT = A6 (PIN_VBAT), 100k/100k 분압이라 실제 전압 = 읽은 값 × 2.
 * ADC 기준 3.0V, 12비트 → 1 LSB = 0.732mV (분압 전).
 * LiPo는 완전 방전하면 상하므로 BAT_OFF_MV 아래가 연속 BAT_OFF_N번이면 스스로 꺼진다 (USER 버튼으로 다시 켬).
 * USB가 꽂혀 있으면 충전 전압(~4.2V)이 읽혀서 꺼지지 않는다 */
#define BAT_WARN_MV  3500
#define BAT_OFF_MV   3300
#define BAT_OFF_N    3            /* 5초마다 읽으니 15초 연속 */

static uint16_t bat_mv = 0;
static uint8_t  bat_pct = 0xFF;

static uint16_t bat_read_mv()
{
    uint32_t sum = 0;
    for (int i = 0; i < 8; i++) sum += analogRead(PIN_VBAT);
    return (uint16_t)(sum / 8 * 0.73242188f * 2.0f);
}

/* 1셀 LiPo 무부하 곡선 근사 (mV, %) */
static uint8_t bat_percent(uint16_t mv)
{
    static const uint16_t MV[]  = {4200, 4100, 4000, 3900, 3850, 3800, 3750, 3700, 3650, 3500, 3300};
    static const uint8_t  PCT[] = { 100,   90,   78,   64,   55,   45,   35,   22,   12,    5,    0};
    if (mv >= MV[0]) return 100;
    for (int i = 1; i < (int)(sizeof MV / sizeof MV[0]); i++)
        if (mv >= MV[i]) return (uint8_t)(PCT[i] + (PCT[i - 1] - PCT[i]) * (mv - MV[i]) / (MV[i - 1] - MV[i]));
    return 0;
}

static void send_status()
{
    uint8_t b[PKT_MAX];
    send(b, pkt_status(b, flags() | (configured ? 0 : FLAG_UNCONFIGURED), bat_pct, 0, FW_MAJOR, FW_MINOR));
}

static void send_log(const char *s);
static void power_off(const char *why);

/* 5초마다: 전압 읽기, 30초마다 LOG "BAT 3987mV 82%" (사용 시간 측정용), 저전압이면 경고·꺼짐 */
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
        power_off("BAT OFF");                           /* 깊은 잠. USER 버튼 누르면 재부팅 */
    }
}

static void send_param(uint8_t id, int16_t v)
{
    uint8_t b[PKT_MAX];
    send(b, pkt_param_ack(b, flags(), id, v));
}

/* ===================== 진동 (DRV2605L + LRA, PLAY-006 / S15P31A307-146) =====================
 * LRA: Vybronics VG0832012 (1.8Vrms, 235Hz). I2C 0x5A, IMU와 같은 Wire 버스.
 * 켤 때 자동 보정(모터가 0.5초 정도 웅 울림 = 켜짐 알림)을 하고, 이후 RTP(실시간) 모드로 둔다.
 * 타격 시: 라이브러리 클릭 파형(아래 haptic_click). HAPTIC 명령(테스트)만 RTP로 세기·길이를 직접 준다.
 * 브라우저를 거치지 않으므로 진동 지연 = 검출 시각 + I2C 쓰기 + 모터 기동 */
#define DRV_ADDR     0x5A
#define DRV_RATED_V  70           /* 0x16: 1.8Vrms, 235Hz → 1.8·√(1−(4·300µs+300µs)·235)/20.71mV ≈ 70 */
#define DRV_OD_CLAMP 110          /* 0x17: 과구동 최대 약 2.3V (21.22mV × 110). 2.5V + 0.3초 최대 구동에서 DRV가 응답 없어진 적 있음(10/30) */

static bool     drv_ok = false;
static uint32_t haptic_off_ms = 0;

static void drv_w(uint8_t r, uint8_t v)
{
    Wire.beginTransmission(DRV_ADDR); Wire.write(r); Wire.write(v); Wire.endTransmission();
}
static int drv_r(uint8_t r)
{
    Wire.beginTransmission(DRV_ADDR); Wire.write(r);
    if (Wire.endTransmission(false) != 0) return -1;
    if (Wire.requestFrom(DRV_ADDR, 1) != 1) return -1;
    return Wire.read();
}

/* I2C 버스 풀기: 장치가 전송 중간에 굳어 SDA를 0으로 잡고 있으면 Wire가 영원히 기다린다.
 * Wire.begin() 전에 SCL을 최대 9번 흔들어 장치가 남은 비트를 내보내고 SDA를 놓게 한다.
 * 반환: 0 = 원래 정상, 1 = 풀림, 2 = 못 풂 (SDA가 계속 0) */
static uint8_t i2c_recover()
{
    pinMode(PIN_WIRE_SDA, INPUT_PULLUP);
    pinMode(PIN_WIRE_SCL, INPUT_PULLUP);
    delayMicroseconds(10);
    if (digitalRead(PIN_WIRE_SDA) && digitalRead(PIN_WIRE_SCL)) return 0;
    for (int i = 0; i < 9 && !digitalRead(PIN_WIRE_SDA); i++) {
        pinMode(PIN_WIRE_SCL, OUTPUT); digitalWrite(PIN_WIRE_SCL, LOW); delayMicroseconds(5);
        pinMode(PIN_WIRE_SCL, INPUT_PULLUP); delayMicroseconds(5);
    }
    /* STOP: SCL 1인 동안 SDA 0 → 1 */
    pinMode(PIN_WIRE_SDA, OUTPUT); digitalWrite(PIN_WIRE_SDA, LOW); delayMicroseconds(5);
    pinMode(PIN_WIRE_SDA, INPUT_PULLUP); delayMicroseconds(5);
    return digitalRead(PIN_WIRE_SDA) && digitalRead(PIN_WIRE_SCL) ? 1 : 2;
}

static void drv_init()
{
    int st = drv_r(0x00);
    if (st < 0) { send_log("DRV none"); return; }    /* 진동 없이도 스틱은 동작 */
    drv_w(0x01, 0x07);                              /* MODE: 자동 보정, 대기 해제 */
    drv_w(0x16, DRV_RATED_V);
    drv_w(0x17, DRV_OD_CLAMP);
    drv_w(0x1A, 0xB6);                              /* FEEDBACK: LRA, 브레이크 4x, 루프 게인 중, BEMF 게인 2 */
    drv_w(0x1B, 0x90);                              /* CONTROL1: 시동 부스트 + DRIVE_TIME 2.1ms (235Hz 반주기) */
    drv_w(0x1C, 0xF5);                              /* CONTROL2: 기본값 */
    drv_w(0x1D, 0xA8);                              /* CONTROL3: 기본(LRA 폐루프) + RTP 부호 없는 값 */
    drv_w(0x1E, 0x20);                              /* CONTROL4: 자동 보정 시간 500ms */
    drv_w(0x0C, 0x01);                              /* GO */
    uint32_t t0 = millis();
    while ((drv_r(0x0C) & 1) && millis() - t0 < 2000) delay(10);
    st = drv_r(0x00);
    send_log((st >= 0 && !(st & 0x08)) ? "DRV cal ok" : "DRV cal fail");  /* STATUS bit3 = 보정 실패 */
    drv_w(0x03, 6);                                 /* LRA 라이브러리 */
    drv_w(0x02, 0);                                 /* RTP 세기 0 */
    drv_w(0x05, 0);                                 /* 파형 순서 2번째 = 끝 */
    drv_w(0x01, 0x00);                              /* MODE: 내부 트리거 (라이브러리 파형) */
    drv_ok = true;
    char m[19]; snprintf(m, sizeof m, "DRV mode %d", drv_r(0x01));
    send_log(m);
}

/* 타격 진동: DRV 라이브러리 파형 (TI LRA 라이브러리 6번)
 *   1 = Strong Click 100%, 2 = Strong Click 60%, 3 = Strong Click 30%
 * 시작할 때 과구동 + 끝에 브레이크라 짧아도 "톡" 하고 느껴진다. I2C 쓰기 2번(파형 번호, GO) ≈ 0.2ms */
/* 진동 지연 측정 (개발용): 모터를 스틱에 붙이고 가만히 둔 상태에서 HAPTIC [파형, 0xFE]을 받으면
 * 파형을 울리고, IMU 가속도가 샘플 간에 VIB_THR_LSB 넘게 바뀌는 첫 샘플까지 시간을 LOG "VIB 6.3ms"로 보낸다.
 * 타격 시 진동 지연 = (검출 → I2C 쓰기 ≈ 0.2ms) + 이 값 */
#define VIB_THR_LSB  150          /* 가속도 원시 변화 합 (0.488mg/LSB → 약 0.07g) */
static uint32_t vib_t0_us = 0;
static int16_t  vib_prev[3];
static uint8_t  vib_n = 0;

static bool    haptic_seq_dirty = false;            /* 버튼 진동이 WAVESEQ2를 썼으면 다음 진동 전에 비운다 */
static uint8_t hit_effect[3] = {14, 17, 19};       /* 세기 강·중·약: Strong Buzz 100%, Strong Click 1 100%, Strong Click 3 60% (11/6 손으로 고름. 세기만 다르면 LRA에서 구분 안 돼 종류를 다르게) */

static void haptic_effect(uint8_t effect)
{
    if (!drv_ok || effect == 0 || effect > 123) return;
    if (haptic_off_ms) { drv_w(0x02, 0); drv_w(0x01, 0x00); haptic_off_ms = 0; }
    if (haptic_seq_dirty) { drv_w(0x05, 0); haptic_seq_dirty = false; }
    drv_w(0x04, effect);
    drv_w(0x0C, 0x01);
}

static void haptic_click(uint8_t level)             /* level 0~255 */
{
    if (!drv_ok || level == 0) return;
    uint8_t effect = hit_effect[level > 170 ? 0 : level > 85 ? 1 : 2];
    if (haptic_off_ms) { drv_w(0x02, 0); drv_w(0x01, 0x00); haptic_off_ms = 0; }   /* RTP 테스트 중이면 끝냄 */
    if (haptic_seq_dirty) { drv_w(0x05, 0); haptic_seq_dirty = false; }
    drv_w(0x04, effect);
    drv_w(0x0C, 0x01);                              /* GO */
#if SERIAL_MODE == SERIAL_TEXT
    if (Serial) Serial.printf("[HAP] click %u (level %u)\r\n", effect, level);
#endif
}

/* HAPTIC 명령(테스트): RTP로 정해진 세기·길이만큼 울리고 내부 트리거 모드로 돌아간다 */
static void haptic_play(uint8_t amp, uint16_t ms)
{
    if (!drv_ok || amp == 0 || ms == 0) return;
    drv_w(0x01, 0x05);                              /* MODE: RTP */
    drv_w(0x02, amp);
    haptic_off_ms = millis() + ms;
    if (haptic_off_ms == 0) haptic_off_ms = 1;
}

static void haptic_poll()
{
    if (haptic_off_ms && (int32_t)(millis() - haptic_off_ms) >= 0) {
        drv_w(0x02, 0);                             /* 0 = 멈춤 (폐루프라 브레이크가 걸림) */
        drv_w(0x01, 0x00);                          /* 내부 트리거 모드로 복귀 */
        haptic_off_ms = 0;
    }
}

/* ===================== 전원 버튼 · 상태 LED (S15P31A307-237) =====================
 * 버튼 = 보드 USER 버튼(7번 핀, 뚜껑 누름 탭). LED = 보드 NeoPixel(뚜껑 LED 창).
 *   꺼진 상태에서 누름    → 깨어나 부팅 (부팅 중 초록, 준비되면 초록 → 진동 짧게 1번)
 *   1.5초 누름           → 누르는 동안 빨강이 밝아짐 → 꺼짐 (빨강 0.5초 + 진동 길게, 손 떼면 깊은 잠)
 *   두 번 누름           → 정면 보정 (흰색 2번 + 진동 2번)
 *   한 번 누름           → 배터리 표시 1초 (초록 > 50%, 주황 > 20%, 빨강)
 *   연결 찾는 중 파랑 깜빡, 연결되면 초록 반짝 + 진동 2번 → 은은한 파랑, 끊기면 진동 길게
 *   배터리 20% 이하 10초마다 주황 2번, 5% 이하 빨강 깜빡
 *   BLE도 USB 시리얼도 없이 10분 → 자동으로 꺼짐
 * 꺼져 있어도 NeoPixel 칩이 약 1mA를 먹는다 (오래 안 쓰면 배터리 커넥터를 뺀다) */
#define LED_BRIGHT      60            /* 표시 밝기 0~255 */
#define LED_IDLE        6             /* 연결됨 상태 파랑 (연주 중 거슬리지 않게) */
#define LONG_PRESS_MS   1500
#define DOUBLE_GAP_MS   400
#define AUTO_OFF_MS     (10UL * 60UL * 1000UL)
#define FX_SHORT        1             /* DRV2605L 라이브러리: Strong Click 100% */
#define FX_DOUBLE       10            /* Double Click 100% */
#define FX_LONG         47            /* Buzz 1 100% (두 번 이어서 길게) */

static Adafruit_NeoPixel pix(1, PIN_NEOPIXEL, NEO_GRB + NEO_KHZ800);
enum { ANIM_NONE, ANIM_BOOT, ANIM_CONNECTED, ANIM_RESET, ANIM_BATT };
static uint8_t  ui_anim = ANIM_NONE;
static uint32_t ui_anim_t0 = 0, ui_link_ms = 0, ui_px = 0xFFFFFFFF;
static bool     ui_armed = false;     /* 부팅을 깨운 누름이 떨어진 뒤부터 버튼을 받는다 */
static uint32_t ui_hold_t0 = 0;       /* 누르고 있는 중이면 누른 시각, 아니면 0 */

static void handle_cmd(const cmd_t *c);

static void led_set(uint8_t r, uint8_t g, uint8_t b)
{
    uint32_t c = pix.Color(r, g, b);
    if (c == ui_px) return;
    ui_px = c;
    pix.setPixelColor(0, c);
    pix.show();
}

static void haptic_seq(uint8_t a, uint8_t b)
{
    if (!drv_ok) return;
    if (haptic_off_ms) { drv_w(0x02, 0); drv_w(0x01, 0x00); haptic_off_ms = 0; }
    drv_w(0x04, a);
    drv_w(0x05, b);
    drv_w(0x06, 0);
    haptic_seq_dirty = b != 0;
    drv_w(0x0C, 0x01);
}

static void ui_start(uint8_t anim) { ui_anim = anim; ui_anim_t0 = millis(); }

static void power_off(const char *why)
{
    send_log(why);
    haptic_seq(FX_LONG, FX_LONG);
    led_set(LED_BRIGHT * 2, 0, 0);
    delay(500);
    led_set(0, 0, 0);
    while (!digitalRead(PIN_USER_SW)) delay(10);        /* 누른 채로 자면 바로 다시 깨어난다 */
    delay(100);
    imu_wr(0x10, 0x00);                                 /* IMU 가속도·자이로 끔 */
    imu_wr(0x11, 0x00);
    if (drv_ok) drv_w(0x01, 0x40);                      /* DRV2605L 대기 */
    delay(20);
    /* systemOff로 자면 USER 버튼으로 깨어날 때 버튼이 눌린 채 리셋된다. Feather 부트로더는 USER 버튼(P1.02)이
     * DFU 버튼이라, 그대로 DFU 모드로 들어가 빨강만 켜지고 앱이 안 돈다 (11/5 확인).
     * 그래서 앱이 저전력으로 기다리다가, 버튼을 눌렀다 뗀 뒤에 리셋한다 → 부트로더가 바로 앱으로 넘어간다 */
    Bluefruit.Advertising.restartOnDisconnect(false);
    Bluefruit.Advertising.stop();
    for (uint16_t h = 0; h < BLE_MAX_CONNECTION; h++)
        if (Bluefruit.connected(h)) Bluefruit.disconnect(h);
    sd_clock_hfclk_release();                           /* 꺼진 동안은 크리스탈 끔 (0.25mA) */
    for (;;) {
        delay(50);                                      /* FreeRTOS 대기: CPU는 잔다 */
        if (digitalRead(PIN_USER_SW)) continue;
        uint32_t t = millis();
        while (!digitalRead(PIN_USER_SW)) delay(10);    /* 뗄 때까지 */
        if (millis() - t >= 30) {                       /* 30ms 미만은 튐 */
            led_set(0, LED_BRIGHT / 3, 0);
            delay(20);
            NVIC_SystemReset();                         /* 버튼이 떼진 상태로 리셋 → 앱 부팅 */
        }
    }
}

static void ui_button(uint32_t now)
{
    static uint8_t  prev = 1, clicks = 0;
    static uint32_t t_down = 0, t_up = 0;
    uint8_t b = digitalRead(PIN_USER_SW);
    if (!ui_armed) { if (b) ui_armed = true; prev = b; return; }
    if (!b && prev) t_down = now;
    ui_hold_t0 = b ? 0 : (t_down ? t_down : 1);
    if (!b && now - t_down >= LONG_PRESS_MS) power_off("OFF (btn)");
    if (b && !prev && now - t_down > 30) {              /* 30ms 미만은 튐 */
        clicks++;
        t_up = now;
        if (clicks >= 2) {
            clicks = 0;
            cmd_t c = {1, {CMD_RESET_POSE}, 0};
            handle_cmd(&c);
            send_log("RESET_POSE (btn)");
            haptic_effect(FX_DOUBLE);
            ui_start(ANIM_RESET);
        }
    }
    if (clicks == 1 && b && now - t_up > DOUBLE_GAP_MS) { clicks = 0; ui_start(ANIM_BATT); }
    prev = b;
}

static void ui_led(uint32_t now)
{
    static uint32_t t_last = 0;
    if (now - t_last < 20) return;                      /* 50Hz */
    t_last = now;
    uint32_t a = now - ui_anim_t0;
    if (ui_hold_t0 && now - ui_hold_t0 > 200) {        /* 끄는 중: 빨강이 점점 (짧은 누름은 표시 그대로) */
        uint32_t h = now - ui_hold_t0;
        if (h > LONG_PRESS_MS) h = LONG_PRESS_MS;
        led_set((uint8_t)(LED_BRIGHT * 2 * h / LONG_PRESS_MS), 0, 0);
        return;
    }
    switch (ui_anim) {
    case ANIM_BOOT:                                     /* 초록 0.5초 서서히 */
        if (a < 500) { led_set(0, (uint8_t)(LED_BRIGHT * a / 500), 0); return; }
        if (a < 800) { led_set(0, LED_BRIGHT, 0); return; }
        break;
    case ANIM_CONNECTED:
        if (a < 300) { led_set(0, LED_BRIGHT, 0); return; }
        break;
    case ANIM_RESET:                                    /* 흰색 2번 */
        if (a < 450) { uint8_t v = (a < 150 || a >= 300) ? LED_BRIGHT : 0; led_set(v, v, v); return; }
        break;
    case ANIM_BATT:
        if (a < 1000) {
            if (bat_pct == 0xFF || bat_pct > 50) led_set(0, LED_BRIGHT, 0);
            else if (bat_pct > 20)               led_set(LED_BRIGHT, LED_BRIGHT / 3, 0);
            else                                 led_set(LED_BRIGHT, 0, 0);
            return;
        }
        break;
    }
    ui_anim = ANIM_NONE;
    if (bat_pct != 0xFF && bat_pct <= 5) {             /* 곧 꺼짐: 빨강 깜빡 */
        led_set((now / 500) % 2 ? LED_BRIGHT : 0, 0, 0);
        return;
    }
    if (bat_pct != 0xFF && bat_pct <= 20) {            /* 10초마다 주황 2번 */
        uint32_t k = now % 10000;
        if (k < 450) { uint8_t v = (k < 150 || k >= 300) ? LED_BRIGHT : 0; led_set(v, v / 3, 0); return; }
    }
    if (ble_connected) led_set(0, 0, LED_IDLE);
    else               led_set(0, 0, (now / 500) % 2 ? LED_BRIGHT / 2 : 0);
}

static void ui_poll()
{
    static bool was = false;
    uint32_t now = millis();
    bool c = ble_connected;
    if (c && !was) { haptic_effect(FX_DOUBLE); ui_start(ANIM_CONNECTED); }
    if (!c && was) haptic_seq(FX_LONG, FX_LONG);
    was = c;
    if (c || Serial) ui_link_ms = now;                  /* USB 시리얼(PC 측정 페이지)로 쓰는 중이어도 안 꺼짐 */
    if (now - ui_link_ms > AUTO_OFF_MS) power_off("OFF (idle 10min)");
    ui_button(now);
    ui_led(now);
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
    case 0x10: return lat_log;
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
    case 0x10: lat_log = clampi(v, 0, 1); return true;   /* 검출기와 무관 */
    default: return false;
    }
    hd.p = hp;                                          /* 검출기 상태는 유지하고 파라미터만 교체 */
    return true;
}
static const uint8_t PARAM_IDS[] = {0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x09,0x0A,0x0B,0x0C,0x0D,0x0E,0x0F,0x10};

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
    case CMD_HAPTIC:                                    /* [1]세기 0~255 [2]길이 ×10ms (테스트용) */
        /* 개발용 확장: [2] = 0이면 [1]을 라이브러리 파형 번호로 재생, [2] = 0xFF면 [1]을 타격 파형(세기 상)으로 설정 */
        if (c->len >= 3) {
            if (d[2] == 0) haptic_effect(d[1]);
            else if (d[2] == 0xFE) { vib_n = 0; vib_t0_us = now_us(); haptic_effect(d[1]); }
            else if (d[2] == 0xFF) { hit_effect[0] = hit_effect[1] = hit_effect[2] = d[1]; haptic_effect(d[1]); }
            else haptic_play(d[1], (uint16_t)d[2] * 10);
        }
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
            if (param_set(id, (int16_t)rd16(&d[2]))) { configured = true; send_param(id, param_get(id)); }
        }
        break;
    case CMD_SET_PAD_TABLE:
        if (c->len >= 2) {
            uint8_t ctrl = d[1], n = ctrl & 0x0F;
            configured = true;
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
            configured = true;
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
/* 연결 직후엔 상대가 notify를 아직 안 켜서 STATUS가 안 나간다. 켜는 순간(CCCD 쓰기) 표시해 두고 loop에서 보낸다 (v0.8) */
static void cccd_cb(uint16_t, BLECharacteristic *, uint16_t value) { if (value & BLE_GATT_HVX_NOTIFICATION) status_due = true; }

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

/* ===================== 부팅 ===================== */
static bool bias_load(float b[3])
{
    File f(InternalFS);
    if (!f.open(BIAS_FILE, FILE_O_READ)) return false;
    bool ok = f.read((uint8_t *)b, 12) == 12;
    f.close();
    for (int i = 0; i < 3 && ok; i++) if (!(fabsf(b[i]) < 20.0f)) ok = false;   /* 쓰레기 값 거르기 (NaN 포함) */
    return ok;
}

static void bias_save(const float b[3])
{
    InternalFS.remove(BIAS_FILE);
    File f(InternalFS);
    if (f.open(BIAS_FILE, FILE_O_WRITE)) { f.write((const uint8_t *)b, 12); f.close(); }
}

/* 현재 바이어스 (0.01°/s). 연결 직후와 10초마다 보낸다 → 쓰는 동안 바이어스가 얼마나 변하는지 측정 페이지에서 본다 */
static void send_bias()
{
    char m[20];
    snprintf(m, sizeof m, "BT %d %d %d", (int)lroundf(bias_dps[0] * 100), (int)lroundf(bias_dps[1] * 100), (int)lroundf(bias_dps[2] * 100));
    send_log(m);
}

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
    double sd_max = 0;
    for (int i = 0; i < 3 && ok; i++) {
        double m = s[i] / n, sd = sqrt(q[i] / n - m * m);
        if (sd > sd_max) sd_max = sd;
    }
    if (sd_max > BIAS_MAX_SD_DPS) ok = false;
    for (int i = 0; i < 3; i++) acc_mean_ms2[i] = n ? (float)(a[i] / n) : (i == 2 ? G_MS2 : 0);

    /* 우선순위: 이번 측정 → 이 보드에 저장된 값 → 공용 기본값. 흔들려서 실패해도 정지 재추정이 곧 바로잡는다 */
    const char *src = "meas";
    if (ok) {
        for (int i = 0; i < 3; i++) bias_dps[i] = (float)(s[i] / n);
        if (sd_max < BIAS_SAVE_SD_DPS) { bias_save(bias_dps); src = "saved"; }
    } else if (bias_load(bias_dps)) {
        src = "flash";
    } else {
        for (int i = 0; i < 3; i++) bias_dps[i] = BIAS_DEFAULT_DPS[i];
        src = "default";
    }
    for (int i = 0; i < 3; i++) bias_boot[i] = bias_dps[i];
    char msg[20];
    if (ok) snprintf(msg, sizeof msg, "BIAS %d %d %d", (int)(bias_dps[0] * 10), (int)(bias_dps[1] * 10), (int)(bias_dps[2] * 10));
    else    snprintf(msg, sizeof msg, "BIAS %s", src);   /* "BIAS flash" | "BIAS default" */
    send_log(msg);
    if (ok) { snprintf(msg, sizeof msg, "BIAS %s sd%d", src, (int)(sd_max * 10)); send_log(msg); }
    send_bias();
}

void app_setup()
{
    Serial.begin(115200);
    analogReference(AR_INTERNAL_3_0);                   /* 배터리 전압용 ADC (VBAT, 분압 1/2) */
    analogReadResolution(12);
    uint32_t t0 = millis();
#if SERIAL_MODE == SERIAL_TEXT
    while (!Serial && millis() - t0 < 4000) delay(10);  /* 디버그: 시리얼 모니터가 다시 붙을 시간 */
#else
    while (!Serial && millis() - t0 < 1500) delay(10);  /* PC 없이도 1.5초 후 시작 (배터리 단독) */
#endif

    pinMode(PIN_USER_SW, INPUT_PULLUP);
    pix.begin();
    led_set(0, LED_BRIGHT / 3, 0);                      /* 깨어나자마자 초록: 켜지는 중 */
    clock_init();
    uint8_t i2c_state = i2c_recover();
    Wire.begin();
    Wire.setClock(400000);
    ble_init();
    bool hfxo = false;
    uint8_t hfxo_try = 0;
    while (!hfxo && hfxo_try < 3) { hfxo_try++; hfxo = hfxo_hold(); if (!hfxo) delay(100); }
    InternalFS.begin();                                 /* 보드별 바이어스 저장 (Bluefruit 본딩과 같은 파일시스템) */

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
    hp.vel_max_dps   = 1400;                            /* PLAY-006: 세게 친 타격이 100~120 (11/9 1600 실측 오른손 강 79~102 → 1400 환산 94~122) */
    hit_init(&hd, &hp);
    pad_table_default(&pads);

    send_log(FW_TAG);
    {
        char m[19];
        snprintf(m, sizeof m, hfxo ? "HFXO on %u" : "HFXO FAIL %u", hfxo_try);   /* 숫자 = 시도 횟수 */
        send_log(m);
    }
    if (i2c_state) send_log(i2c_state == 1 ? "I2C stuck->freed" : "I2C stuck SDA low");
    drv_init();                                         /* 자동 보정 진동 = 켜짐 알림. 정지 측정 전에 끝냄 */
    delay(200);
    send_log("hold still...");
    float acc0[3];
    measure_bias(acc0);
    pose_init(&pose, TIP_AXIS);
    pose_start(&pose, acc0);
    bat_update();
    send_status();
    ui_link_ms = millis();
    haptic_effect(FX_SHORT);                            /* 준비 완료 */
    ui_start(ANIM_BOOT);
#if SERIAL_MODE == SERIAL_TEXT
    if (Serial) Serial.print("n t_hit_ms pad el az mg peak vel sw decel | detect->send us | missed\r\n");
#endif
}

/* ===================== 루프 ===================== */
void app_loop()
{
    static uint32_t last_count = 0, t_prev = 0, t_status = 0, t_pose = 0;
    static uint32_t rej_prev[4] = {0};
    static float    az_swing_start = 0;
    static hit_state_t st_prev = HIT_IDLE;
    static uint32_t acc_div = 0;
    static deframer_t dfr;
    static bool dfr_init = false;
    if (!dfr_init) { deframer_init(&dfr); dfr_init = true; }

    /* 명령 */
    while (cq_tail != cq_head) { handle_cmd(&cmdq[cq_tail]); cq_tail = (uint8_t)((cq_tail + 1) % CMDQ); }
    haptic_poll();
#if SERIAL_MODE == SERIAL_BINARY
    while (Serial.available()) {
        uint32_t t_rx = now_us();
        uint8_t p[PKT_MAX], n = deframer_feed(&dfr, (uint8_t)Serial.read(), p);
        if (n) cmd_push(p, n, t_rx);
    }
#endif

    /* 전원 버튼·상태 LED·자동 꺼짐 (237) */
    ui_poll();

    /* 상태 5초마다 */
    if (status_due) { status_due = false; t_status = millis(); send_status(); send_bias(); }   /* 연결 직후 1회 */
    { static uint32_t t_bias = 0; if (millis() - t_bias > 10000) { t_bias = millis(); send_bias(); hfxo_watch(); } }
    if (millis() - t_status > 5000) { t_status = millis(); bat_update(); send_status(); }

    /* IMU 새 샘플 */
    uint32_t cnt = drdy_count;
    if (cnt == last_count) return;
    noInterrupts(); uint32_t t = drdy_t; cnt = drdy_count; interrupts();
    if (cnt - last_count > 1) n_missed += cnt - last_count - 1;
    last_count = cnt;

    int16_t v[6];
    if (!imu_read(v)) return;
    n_samples++;
    for (int i = 0; i < 3; i++) if (v[i] >= SAT_LSB || v[i] <= -SAT_LSB) sat_n[i]++;
    if (vib_t0_us) {                                    /* 진동 지연 측정 중 */
        int32_t dsum = 0;
        for (int i = 0; i < 3; i++) { dsum += abs(v[3 + i] - vib_prev[i]); vib_prev[i] = v[3 + i]; }
        if (vib_n++ >= 2 && (int32_t)(t - vib_t0_us) > 0) {
            uint32_t dt_us = t - vib_t0_us;
            char m[19];
            if (dsum > VIB_THR_LSB) { snprintf(m, sizeof m, "VIB %lu.%lums", dt_us / 1000, (dt_us / 100) % 10); send_log(m); vib_t0_us = 0; }
            else if (dt_us > 200000) { send_log("VIB none"); vib_t0_us = 0; }
        }
    }
    float g[3], dt = t_prev ? (t - t_prev) * 1e-6f : 0.0006f;
    t_prev = t;
    for (int i = 0; i < 3; i++) g[i] = v[i] * GYRO_DPS_PER_LSB - bias_dps[i];

    /* 정지 중 바이어스 재추정 (234): 멈춰 있는 동안 자이로 원값의 평균 = 바이어스 */
    {
        static uint32_t still_n = 0;
        float ax = v[3] * ACC_G_PER_LSB * G_MS2, ay = v[4] * ACC_G_PER_LSB * G_MS2, az = v[5] * ACC_G_PER_LSB * G_MS2;
        float am = sqrtf(ax * ax + ay * ay + az * az);
        float gm2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
        if (gm2 < STILL_DPS * STILL_DPS && fabsf(am - G_MS2) < STILL_ACC_MS2) still_n++;
        else still_n = 0;
        if (still_n >= STILL_MIN_SAMPLES) {
            float k = dt / BIAS_TAU_S;
            for (int i = 0; i < 3; i++) {
                float nb = bias_dps[i] + k * (v[i] * GYRO_DPS_PER_LSB - bias_dps[i]);
                if (nb > bias_boot[i] + BIAS_MAX_DEV_DPS) nb = bias_boot[i] + BIAS_MAX_DEV_DPS;
                if (nb < bias_boot[i] - BIAS_MAX_DEV_DPS) nb = bias_boot[i] - BIAS_MAX_DEV_DPS;
                bias_dps[i] = nb;
            }
            still_updates++;
        }
    }

    /* 자세 */
    float a[3], *ap = NULL;
    if (++acc_div >= ACC_EVERY) {
        acc_div = 0;
        for (int i = 0; i < 3; i++) a[i] = v[3 + i] * ACC_G_PER_LSB * G_MS2;
        ap = a;
    }
    pose_update(&pose, g, ap, dt);

    /* 타격 검출: hit_detect는 BNO055 단위(16 LSB/dps) 정수로 받는다 */
#if HIT_ROLL_FREE
    int32_t down = (int32_t)(pose_down_rate(&pose, g) * 16.0f);   /* 수평으로 쥐고 롤 0이면 HIT_SIGN·g[y]와 같은 값 */
#else
    int32_t down = (int32_t)(HIT_SIGN * g[HIT_AXIS] * 16.0f);
#endif
    hit_event_t ev;
    int fired = hit_update(&hd, t, down, &ev);

    if (hd.st == HIT_SWING && st_prev != HIT_SWING) {   /* 스윙 시작 시 방위각 (lateral 계산용) */
        float el0; pose_angles(&pose, &el0, &az_swing_start);
    }
    st_prev = hd.st;

    if (fired) {
        uint32_t t_det = now_us();                      /* 233: 샘플(DRDY 인터럽트 시각 t) → 검출 끝 */
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
        /* 패드를 판정 못 한 타격(PAD_NONE, 패드 밖)은 울리지 않는다 (11/5 FE 지적).
         * 236: 타격 세기 → 진동 3단계 (약 ≤68, 중 69~92, 강 ≥93. vel_max 1400 기준, 11/9 양손 번갈아 30타씩 실측에서 잡은 경계).
         * hapticStrength(기본 200) × 100/66/33% → haptic_click 의 >170 / >85 경계로 강·중·약 파형이 골라진다 */
        if (haptic_enable && pr.id != PAD_NONE)
            haptic_click((uint8_t)(haptic_strength * (ev.velocity >= 93 ? 100 : ev.velocity > 68 ? 66 : 33) / 100));
        if (lat_log) {                                  /* 233: 샘플 시각 t 기준 µs. 검출 끝 / 전송 끝 / 진동 GO 쓰기 끝 */
            uint32_t t_hap = now_us();
            char m[20];
            snprintf(m, sizeof m, "LT %lu %lu %lu", (unsigned long)(t_det - t), (unsigned long)(t_sent - t), (unsigned long)(t_hap - t));
            send_log(m);
        }
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

    /* 자이로 포화 → LOG "SAT x y z" (축별 샘플 수, 1초에 한 번까지). 재무장 단계라 HIT을 늦추지 않음 */
    {
        static uint32_t t_sat = 0;
        if ((sat_n[0] | sat_n[1] | sat_n[2]) && millis() - t_sat >= 1000) {
            t_sat = millis();
            char m[20];
            snprintf(m, sizeof m, "SAT %lu %lu %lu", (unsigned long)sat_n[0], (unsigned long)sat_n[1], (unsigned long)sat_n[2]);
            send_log(m);
            sat_n[0] = sat_n[1] = sat_n[2] = 0;
        }
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
