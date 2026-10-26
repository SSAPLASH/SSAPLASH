/*
 * hit_detect.c - 자이로 감속 기반 타격 검출 (S15P31A307-116)
 * 설명은 hit_detect.h 참고. 모든 연산은 정수 (FPU 없는 Cortex-M3 대응)
 */
#include "hit_detect.h"

#define LSB_PER_DPS 16

void hit_default_params(hit_params_t *p)
{
    p->swing_start_dps = 150;
    p->brake_pct       = 30;
    p->min_peak_dps    = 400;
    p->min_decel_x10   = 30;
    p->max_swing_ms    = 400;
    p->rearm_up_dps    = 50;
    p->rearm_idle_ms   = 150;
    p->debounce_ms     = 30;
    p->ts_corr_us      = 3000;
    p->vel_max_dps     = 1000;
    p->min_swing_ms    = 0;
}

void hit_init(hit_detector_t *h, const hit_params_t *p)
{
    h->p = *p;
    h->st = HIT_IDLE;
    h->above = 0;
    h->t_start = h->t_peak = h->t_last_hit = h->t_prev = 0;
    h->peak = h->v_prev = 0;
    h->n_hits = h->n_reject_slow = h->n_reject_weak = h->n_reject_long = h->n_reject_short = 0;
}

static uint8_t to_velocity(const hit_params_t *p, int32_t peak_dps)
{
    int32_t lo = p->min_peak_dps, hi = p->vel_max_dps;
    if (hi <= lo) hi = lo + 1;
    int32_t v = 1 + (peak_dps - lo) * 126 / (hi - lo);
    if (v < 1) v = 1;
    if (v > 127) v = 127;
    return (uint8_t)v;
}

int hit_update(hit_detector_t *h, uint32_t t, int32_t v, hit_event_t *ev)
{
    const hit_params_t *p = &h->p;
    const int32_t start = (int32_t)p->swing_start_dps * LSB_PER_DPS;
    int fired = 0;

    switch (h->st) {
    case HIT_IDLE:
        if (v > start) {
            if (h->above == 0) h->t_start = t;
            if (++h->above >= 2 &&                      /* 2샘플 연속: 한 샘플짜리 잡음 무시 */
                (uint32_t)(t - h->t_last_hit) >= (uint32_t)p->debounce_ms * 1000U) {
                h->st = HIT_SWING;
                h->peak = v;
                h->t_peak = t;
            }
        } else {
            h->above = 0;
        }
        break;

    case HIT_SWING: {
        if (v > h->peak) { h->peak = v; h->t_peak = t; }

        if ((uint32_t)(t - h->t_start) > (uint32_t)p->max_swing_ms * 1000U) {
            h->n_reject_long++;                          /* 너무 긴 스윙 (천천히 내리기 등) */
            h->st = HIT_REARM; h->t_last_hit = t;
            break;
        }

        if (v * 100 <= h->peak * p->brake_pct) {         /* peak의 brake_pct% 아래로 떨어짐 */
            int32_t peak_dps = h->peak / LSB_PER_DPS;
            uint32_t dt_ms_x10 = (uint32_t)(t - h->t_peak) / 100U;   /* 0.1ms 단위 */
            if (dt_ms_x10 == 0) dt_ms_x10 = 1;
            /* 감속률 dps/ms ×10 = (peak - v)[dps] / dt[ms] × 10 */
            uint32_t decel_x10 = (uint32_t)((h->peak - v) * 100 / LSB_PER_DPS) / dt_ms_x10;

            if ((uint32_t)(t - h->t_start) < (uint32_t)p->min_swing_ms * 1000U) {
                h->n_reject_short++;                     /* 순간 튐 (버튼 누름, 부딪힘) */
            } else if (peak_dps < p->min_peak_dps) {
                h->n_reject_weak++;
            } else if (decel_x10 < p->min_decel_x10) {
                h->n_reject_slow++;
            } else {
                /* 정지 시각 외삽: 직전 샘플과의 기울기로 v가 0이 되는 시각 */
                int32_t dv = h->v_prev - v;              /* LSB, 감속이면 + */
                uint32_t dt = t - h->t_prev;             /* µs */
                int32_t lead_us = 0;
                if (dv > 0 && v > 0) lead_us = (int32_t)((int64_t)v * (int64_t)dt / dv);
                if (lead_us > 60000) lead_us = 60000;    /* 이상치 방지 */

                ev->t_detect_us = t;
                ev->t_hit_us    = t + (uint32_t)(lead_us + p->ts_corr_us);
                ev->peak_dps    = (uint16_t)peak_dps;
                ev->velocity    = to_velocity(p, peak_dps);
                uint32_t sw = (t - h->t_start) / 1000U;
                ev->swing_ms    = (uint8_t)(sw > 255 ? 255 : sw);
                ev->decel_x10   = (uint16_t)(decel_x10 > 65535 ? 65535 : decel_x10);
                h->n_hits++;
                fired = 1;
            }
            h->st = HIT_REARM;
            h->t_last_hit = t;
        } else if (v <= 0) {
            h->st = HIT_REARM; h->t_last_hit = t;        /* 판정 없이 정지 */
        }
        break;
    }

    case HIT_REARM:
        if (v < -(int32_t)p->rearm_up_dps * LSB_PER_DPS ||
            ((uint32_t)(t - h->t_last_hit) > (uint32_t)p->rearm_idle_ms * 1000U && v < start)) {
            h->st = HIT_IDLE;
            h->above = 0;
        }
        break;
    }

    h->v_prev = v;
    h->t_prev = t;
    return fired;
}
