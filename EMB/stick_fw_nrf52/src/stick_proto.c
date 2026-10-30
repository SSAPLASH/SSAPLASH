/*
 * stick_proto.c - 스틱 ↔ 브라우저 패킷. 설명은 stick_proto.h
 */
#include "stick_proto.h"
#include <string.h>

static void w16(uint8_t *p, uint16_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); }
static void w32(uint8_t *p, uint32_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); p[2] = (uint8_t)(v >> 16); p[3] = (uint8_t)(v >> 24); }

uint8_t crc8(const uint8_t *p, uint8_t n)
{
    uint8_t c = 0;
    while (n--) {
        c ^= *p++;
        for (int i = 0; i < 8; i++) c = (c & 0x80) ? (uint8_t)((c << 1) ^ 0x07) : (uint8_t)(c << 1);
    }
    return c;
}

uint8_t pkt_hit(uint8_t *b, const pkt_hit_t *h)
{
    b[0] = PKT_HIT;
    b[1] = h->flags;
    b[2] = h->seq;
    w32(&b[3], h->t_hit_us);
    b[7] = h->pad;
    b[8] = h->margin_x10;
    w16(&b[9], (uint16_t)h->elev_x100);
    w16(&b[11], (uint16_t)h->azim_x100);
    w16(&b[13], h->peak_dps);
    b[15] = h->velocity;
    b[16] = h->swing_ms;
    w16(&b[17], (uint16_t)h->lateral_x10);
    b[19] = h->decel_x10;
    return 20;
}

uint8_t pkt_pose(uint8_t *b, uint8_t flags, uint32_t t_us, int16_t el, int16_t az, int16_t roll, uint8_t seq)
{
    b[0] = PKT_POSE; b[1] = flags;
    w32(&b[2], t_us);
    w16(&b[6], (uint16_t)el); w16(&b[8], (uint16_t)az); w16(&b[10], (uint16_t)roll);
    b[12] = seq;
    return 13;
}

uint8_t pkt_status(uint8_t *b, uint8_t flags, uint8_t battery, int8_t rssi, uint8_t fw_major, uint8_t fw_minor)
{
    b[0] = PKT_STATUS; b[1] = flags; b[2] = battery; b[3] = (uint8_t)rssi; b[4] = fw_major; b[5] = fw_minor;
    return 6;
}

uint8_t pkt_sync_ack(uint8_t *b, uint8_t flags, uint32_t t0, uint32_t t1)
{
    b[0] = PKT_SYNC_ACK; b[1] = flags;
    w32(&b[2], t0); w32(&b[6], t1);
    return 10;
}

uint8_t pkt_param_ack(uint8_t *b, uint8_t flags, uint8_t id, int16_t value)
{
    b[0] = PKT_PARAM_ACK; b[1] = flags; b[2] = id;
    w16(&b[3], (uint16_t)value);
    return 5;
}

uint8_t pkt_log(uint8_t *b, uint8_t flags, const char *s)
{
    uint8_t n = 0;
    b[0] = PKT_LOG; b[1] = flags;
    while (s[n] && n < PKT_MAX - 2) { b[2 + n] = (uint8_t)s[n]; n++; }
    return (uint8_t)(2 + n);
}

uint8_t frame_wrap(uint8_t *out, const uint8_t *payload, uint8_t n)
{
    out[0] = 0xA5;
    out[1] = n;
    memcpy(&out[2], payload, n);
    out[2 + n] = crc8(payload, n);
    return (uint8_t)(n + 3);
}

void deframer_init(deframer_t *d) { memset(d, 0, sizeof *d); }

uint8_t deframer_feed(deframer_t *d, uint8_t c, uint8_t *out)
{
    if (d->len == 0) {                          /* SOF 찾기 */
        if (c == 0xA5) d->buf[d->len++] = c;
        return 0;
    }
    if (d->len == 1) {                          /* LEN */
        if (c == 0 || c > PKT_MAX) { d->len = (c == 0xA5); if (d->len) d->buf[0] = c; return 0; }
        d->buf[d->len++] = c;
        d->need = (uint8_t)(c + 3);
        return 0;
    }
    d->buf[d->len++] = c;
    if (d->len < d->need) return 0;
    uint8_t n = d->buf[1];
    d->len = 0;
    if (crc8(&d->buf[2], n) != d->buf[2 + n]) { d->crc_err++; return 0; }
    d->ok++;
    memcpy(out, &d->buf[2], n);
    return n;
}
