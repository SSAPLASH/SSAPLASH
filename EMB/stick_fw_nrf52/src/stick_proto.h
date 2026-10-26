/*
 * stick_proto.h - 스틱 ↔ 브라우저 패킷 (통신 프로토콜 v0.7, 원문은 GitLab Wiki)
 *
 * 패킷 내용만 만든다. 운반(BLE notify 1회 = 패킷 1개 / 시리얼 0xA5 LEN payload CRC8)은 호출 쪽.
 * 모든 값 리틀 엔디언, 시각 µs u32, 각도 0.01° i16.
 */
#ifndef STICK_PROTO_H
#define STICK_PROTO_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* 스틱 → 브라우저 */
#define PKT_HIT        0x01
#define PKT_POSE       0x02
#define PKT_STATUS     0x03
#define PKT_SYNC_ACK   0x04
#define PKT_PARAM_ACK  0x06
#define PKT_LOG        0x7F

/* 브라우저 → 스틱 */
#define CMD_SYNC            0x10
#define CMD_SET_MODE        0x11
#define CMD_HAPTIC          0x12
#define CMD_RESET_POSE      0x13
#define CMD_SET_PARAM       0x14
#define CMD_SET_PAD_TABLE   0x15
#define CMD_SET_YAW_OFFSET  0x16
#define CMD_GET_PARAMS      0x17

/* PARAM_ACK 예약 id */
#define PID_GET_END      0x00
#define PID_PAD_TABLE    0x20
#define PID_YAW_OFFSET   0x21
#define PID_RESET_POSE   0x22

/* flags */
#define FLAG_ROLE_MASK   0x03
#define FLAG_MAG_BAD     0x08
#define FLAG_AMBIGUOUS   0x10

#define PKT_MAX 20

typedef struct {
    uint8_t  flags, seq;
    uint32_t t_hit_us;
    uint8_t  pad, margin_x10;
    int16_t  elev_x100, azim_x100;
    uint16_t peak_dps;
    uint8_t  velocity, swing_ms;
    int16_t  lateral_x10;
    uint8_t  decel_x10;
} pkt_hit_t;

uint8_t crc8(const uint8_t *p, uint8_t n);                                  /* 다항식 0x07, 초기 0 */

uint8_t pkt_hit(uint8_t *b, const pkt_hit_t *h);                            /* 20 */
uint8_t pkt_pose(uint8_t *b, uint8_t flags, uint32_t t_us, int16_t el, int16_t az, int16_t roll, uint8_t seq); /* 13 */
uint8_t pkt_status(uint8_t *b, uint8_t flags, uint8_t battery, int8_t rssi, uint8_t fw_major, uint8_t fw_minor); /* 6 */
uint8_t pkt_sync_ack(uint8_t *b, uint8_t flags, uint32_t t0, uint32_t t1);  /* 10 */
uint8_t pkt_param_ack(uint8_t *b, uint8_t flags, uint8_t id, int16_t value);/* 5 */
uint8_t pkt_log(uint8_t *b, uint8_t flags, const char *s);                  /* 2 + 최대 18 */

/* 시리얼용 프레이밍: out에 0xA5 LEN payload CRC. 반환 = 프레임 길이 */
uint8_t frame_wrap(uint8_t *out, const uint8_t *payload, uint8_t n);

/* 받은 명령 하나 (t_rx = 수신 시각 µs, SYNC_ACK의 t1) */
typedef struct { uint8_t len; uint8_t d[PKT_MAX]; uint32_t t_rx; } cmd_t;

/* 시리얼 수신 프레이밍 해제기 */
typedef struct {
    uint8_t buf[PKT_MAX + 3];
    uint8_t len, need;
    uint32_t ok, crc_err;
} deframer_t;
void deframer_init(deframer_t *d);
/* 바이트 하나 넣기. payload가 완성되면 길이 반환하고 out에 복사, 아니면 0 */
uint8_t deframer_feed(deframer_t *d, uint8_t c, uint8_t *out);

static inline uint16_t rd16(const uint8_t *p) { return (uint16_t)(p[0] | (p[1] << 8)); }
static inline uint32_t rd32(const uint8_t *p) { return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }

#ifdef __cplusplus
}
#endif

#endif /* STICK_PROTO_H */
