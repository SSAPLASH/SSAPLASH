/*
 * hit_detect.h - 자이로 감속 기반 타격 검출 (S15P31A307-116)
 *
 * HAL을 쓰지 않는 순수 C 모듈. nRF52와 PC(녹화 데이터 재생 테스트, tools/hit_replay·pad_replay)에서 그대로 쓴다.
 *
 * 입력: 샘플마다 (시각 µs, 하강 각속도). 하강 각속도는 스틱 끝이 아래로 내려갈 때 +인 값으로,
 *       호출 쪽에서 스윙 축 자이로에 부호를 맞춰 넘긴다 (단위: BNO055 원시값, 16 LSB = 1 dps)
 *
 * 상태: IDLE → SWING → (급감속) HIT → REARM → IDLE
 *   - SWING  : 하강 속도가 swingStart를 2샘플 연속 넘으면 시작. 최대 속도(peak) 갱신
 *   - HIT    : 속도가 peak의 brakePct% 아래로 떨어지고, 그때까지의 감속률이 minDecel 이상이면 타격
 *              (천천히 내리다 멈춘 동작은 감속률이 낮아 걸러진다)
 *   - REARM  : 스틱이 다시 올라가거나(rearmUp) 잠시 멈추면 다음 타격 준비. 고정 불응기 대신 써서 연타에 강하다
 *
 * 타격 시각: 검출 순간이 아니라 "스틱이 멈추는 순간(하강 속도 0)"을 직전 기울기로 외삽한 값.
 *           검출은 정지보다 약 10~15ms 먼저 일어난다 (2026-10-21 녹화 기준)
 */
#ifndef HIT_DETECT_H
#define HIT_DETECT_H

#include <stdint.h>

typedef struct {
    int16_t  swing_start_dps;   /* 스윙 시작 하강 속도                     기본 150 */
    uint8_t  brake_pct;         /* peak의 몇 % 아래로 떨어지면 판정          기본 30  */
    int16_t  min_peak_dps;      /* 이보다 느린 스윙은 무시 (치는 척)         기본 400 */
    uint16_t min_decel_x10;     /* 최소 감속률, dps/ms × 10                  기본 30 (= 3 dps/ms) */
    uint16_t max_swing_ms;      /* 스윙 시작 후 이 시간 안에 판정 안 되면 포기 기본 400 */
    int16_t  rearm_up_dps;      /* 이만큼 위로 움직이면 재무장               기본 50  */
    uint16_t rearm_idle_ms;     /* 위로 안 움직여도 타격 후 이 시간 지나면 재무장 기본 150 */
    uint16_t debounce_ms;       /* 타격 사이 최소 간격                       기본 30  */
    int16_t  ts_corr_us;        /* 외삽 정지 시각 보정 (실측 평균 오차 상쇄) 기본 +3000 */
    int16_t  vel_max_dps;       /* 이 속도 이상이면 벨로시티 127             기본 1000 */
    uint16_t min_swing_ms;      /* 스윙 시작~판정이 이보다 짧으면 무시 (버튼·충격 같은 순간 튐)
                                   기본 0 = 사용 안 함. 1.66kHz IMU는 20 (2026-10-26 녹화) */
} hit_params_t;

typedef struct {
    uint32_t t_detect_us;       /* 판정한 샘플 시각 */
    uint32_t t_hit_us;          /* 추정 정지 시각 (= 타격 시각, 패킷 timestamp) */
    uint16_t peak_dps;          /* 최대 하강 속도 → HIT peakSpeed */
    uint8_t  velocity;          /* 0~127 → HIT velocity */
    uint8_t  swing_ms;          /* 스윙 시작~판정 → HIT swingMs */
    uint16_t decel_x10;         /* 감속률 dps/ms × 10 (진단용) */
} hit_event_t;

typedef enum { HIT_IDLE = 0, HIT_SWING, HIT_REARM } hit_state_t;

typedef struct {
    hit_params_t p;
    hit_state_t  st;
    uint8_t      above;         /* swingStart 초과 연속 샘플 수 */
    uint32_t     t_start, t_peak, t_last_hit, t_prev;
    int32_t      peak, v_prev;  /* LSB */
    uint32_t     n_hits, n_reject_slow, n_reject_weak, n_reject_long, n_reject_short;
} hit_detector_t;

void hit_default_params(hit_params_t *p);
void hit_init(hit_detector_t *h, const hit_params_t *p);

/* 샘플 하나 처리. 타격이면 1을 반환하고 ev를 채운다 */
int hit_update(hit_detector_t *h, uint32_t t_us, int32_t down_lsb, hit_event_t *ev);

#endif /* HIT_DETECT_H */
