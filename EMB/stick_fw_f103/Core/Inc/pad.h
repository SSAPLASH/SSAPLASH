/*
 * pad.h - 패드 판정 (S15P31A307-117)
 *
 * 패드마다 기준 방향(고도각, 방위각)과 반경을 두고, 타격 순간 스틱 끝 방향과
 * "방향 벡터 사이 각도"가 가장 작은 패드를 고른다.
 * (고도각·방위각 평면 거리는 스틱이 수직에 가까울 때 방위각이 크게 흔들려서 쓰지 않는다)
 *
 * 패드 번호는 통신 프로토콜 v0.7과 같다: 0 CRASH, 1 HIHAT, 2 SNARE, 3 SMALL_TOM, 4 MID_TOM, 5 FLOOR_TOM, 6 RIDE (스틱 0~6)
 *                                       7 KICK, 8 HIHAT_PEDAL (페달, 패드 테이블에는 넣지 않음)
 * 테이블은 웹의 SET_PAD_TABLE로 덮어쓴다. 기본값은 2026-10-22 녹화 1인 데이터 (EMB README)
 */
#ifndef PAD_H
#define PAD_H

#include <stdint.h>

#define PAD_NONE     0xFF
#define PAD_MAX      7

typedef struct {
    uint8_t id;
    float   elev_deg, azim_deg;
    float   radius_deg;      /* 이보다 멀면 이 패드가 아님 */
    float   v[3];            /* 방향 단위벡터 (계산용) */
} pad_anchor_t;

typedef struct {
    pad_anchor_t a[PAD_MAX];
    uint8_t n;
} pad_table_t;

typedef struct {
    uint8_t id;              /* PAD_NONE이면 판정 없음 */
    float   dist_deg;        /* 1등 패드까지 각도 */
    float   margin_deg;      /* 2등 - 1등 각도 차 (패드 1개면 0) */
} pad_result_t;

void pad_table_clear(pad_table_t *t);
void pad_table_default(pad_table_t *t);
/* 같은 id면 덮어쓰고 없으면 추가. 가득 차면 0 반환 */
int  pad_table_set(pad_table_t *t, uint8_t id, float elev_deg, float azim_deg, float radius_deg);
pad_result_t pad_classify(const pad_table_t *t, float elev_deg, float azim_deg);

/* 반경 자동 설정: 패드마다 가장 가까운 다른 패드까지 각도 × 0.6, 15~35도로 제한 */
void pad_table_autoradius(pad_table_t *t);

/* 캘리브레이션 보조: 방향 벡터 누적 → 평균 방향 */
typedef struct { float sum[3]; uint8_t n; } pad_acc_t;
void pad_acc_reset(pad_acc_t *a);
void pad_acc_add(pad_acc_t *a, float elev_deg, float azim_deg);
int  pad_acc_mean(const pad_acc_t *a, float *elev_deg, float *azim_deg);   /* 샘플 없으면 0 */
const char *pad_name(uint8_t id);

#endif /* PAD_H */
