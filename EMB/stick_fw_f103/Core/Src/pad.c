/*
 * pad.c - 패드 판정 (S15P31A307-117). 설명은 pad.h
 */
#include "pad.h"
#include <math.h>

#define DEG2RAD 0.01745329252f
#define RAD2DEG 57.2957795131f

static void dir(float el, float az, float v[3])
{
    float e = el * DEG2RAD, a = az * DEG2RAD;
    v[0] = cosf(e) * cosf(a);
    v[1] = cosf(e) * sinf(a);
    v[2] = sinf(e);
}

static float angle_between(const float a[3], const float b[3])
{
    float d = a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
    if (d > 1.0f) d = 1.0f;
    if (d < -1.0f) d = -1.0f;
    return acosf(d) * RAD2DEG;
}

void pad_table_clear(pad_table_t *t) { t->n = 0; }

int pad_table_set(pad_table_t *t, uint8_t id, float el, float az, float r)
{
    pad_anchor_t *p = 0;
    for (uint8_t i = 0; i < t->n; i++) if (t->a[i].id == id) p = &t->a[i];
    if (!p) {
        if (t->n >= PAD_MAX) return 0;
        p = &t->a[t->n++];
    }
    p->id = id; p->elev_deg = el; p->azim_deg = az; p->radius_deg = r;
    dir(el, az, p->v);
    return 1;
}

void pad_table_default(pad_table_t *t)
{
    pad_table_clear(t);
    /* 2026-10-22 녹화(pad_1022.csv), 패드별 10회 평균, 정면 보정 기준. 반경은 판정 없음 처리용 */
    pad_table_set(t, 1, 39.0f, -50.0f, 30.0f);   /* HIHAT */
    pad_table_set(t, 2, 30.0f, -27.0f, 30.0f);   /* SNARE */
    pad_table_set(t, 3, 61.0f, -34.0f, 30.0f);   /* HI_TOM */
    pad_table_set(t, 4, 43.0f,  55.0f, 30.0f);   /* FLOOR_TOM */
}

pad_result_t pad_classify(const pad_table_t *t, float el, float az)
{
    pad_result_t r = { PAD_NONE, 180.0f, 0.0f };
    float v[3], best = 360.0f, second = 360.0f;
    int bi = -1;
    dir(el, az, v);
    for (uint8_t i = 0; i < t->n; i++) {
        float d = angle_between(v, t->a[i].v);
        if (d < best) { second = best; best = d; bi = i; }
        else if (d < second) { second = d; }
    }
    if (bi < 0) return r;
    r.dist_deg = best;
    r.margin_deg = (second < 360.0f) ? second - best : 0.0f;
    r.id = (best <= t->a[bi].radius_deg) ? t->a[bi].id : PAD_NONE;
    return r;
}

const char *pad_name(uint8_t id)
{
    static const char *n[] = {"CRASH", "HIHAT", "SNARE", "HI_TOM", "FLOOR_TOM", "RIDE", "KICK"};
    return id < 7 ? n[id] : "-";
}

void pad_table_autoradius(pad_table_t *t)
{
    for (uint8_t i = 0; i < t->n; i++) {
        float nearest = 360.0f;
        for (uint8_t j = 0; j < t->n; j++) {
            if (i == j) continue;
            float d = angle_between(t->a[i].v, t->a[j].v);
            if (d < nearest) nearest = d;
        }
        float r = nearest * 0.6f;
        if (r < 15.0f) r = 15.0f;
        if (r > 35.0f) r = 35.0f;
        t->a[i].radius_deg = r;
    }
}

void pad_acc_reset(pad_acc_t *a) { a->sum[0] = a->sum[1] = a->sum[2] = 0; a->n = 0; }

void pad_acc_add(pad_acc_t *a, float el, float az)
{
    float v[3];
    dir(el, az, v);
    a->sum[0] += v[0]; a->sum[1] += v[1]; a->sum[2] += v[2];
    a->n++;
}

int pad_acc_mean(const pad_acc_t *a, float *el, float *az)
{
    if (a->n == 0) return 0;
    float x = a->sum[0], y = a->sum[1], z = a->sum[2];
    float n = sqrtf(x*x + y*y + z*z);
    if (n < 1e-6f) return 0;
    *el = asinf(z / n) * RAD2DEG;
    *az = atan2f(y, x) * RAD2DEG;
    return 1;
}
