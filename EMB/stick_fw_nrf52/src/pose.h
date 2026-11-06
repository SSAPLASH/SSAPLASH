/*
 * pose.h - 스틱 방향 추정 (S15P31A307-117)
 *
 * 자이로를 적분해 자세(쿼터니언)를 따라가고, 스틱이 느릴 때 가속도(중력 방향)로
 * 기울기 오차를 보정한다 (Mahony 방식의 비례 보정). 지자기는 쓰지 않는다.
 *
 * 출력은 센서 축이 아니라 "스틱 끝 방향 벡터"의 각도라서 스틱을 쥔 방향(롤)과 무관하다.
 *   elevation(고도각): 수평 0, 끝이 위 +. 중력 기준 절대각
 *   azimuth(방위각)  : pose_reset_yaw() 시점의 방향 0, 위에서 봐서 시계 방향(오른쪽) +
 *                      지자기가 없어 시간이 지나면 조금씩 밀린다 → 웹이 SET_YAW_OFFSET으로 보정
 *
 * HAL 없는 순수 C, float 사용 (F103은 소프트웨어 float 250Hz, nRF52840은 FPU 1.66kHz)
 */
#ifndef POSE_H
#define POSE_H

#include <stdint.h>

typedef struct {
    float q[4];          /* 센서 → 월드 회전 (w, x, y, z), 월드 z = 위 */
    float tip[3];        /* 센서 좌표계에서 스틱 끝 방향 단위벡터 */
    float kp;            /* 가속도 보정 이득 (rad/s per 단위 오차), 가속도를 읽은 샘플에만 적용 */
    float gate_ms2;      /* |a| - g 가 이 안일 때만 보정 (스윙 중 원심력 제외) */
    float gate_dps;      /* 각속도가 이보다 클 때는 보정 안 함 */
    float az_ref_deg;    /* 방위각 0 기준 */
    float az_offset_deg; /* 웹에서 내려준 밀림 보정 (SET_YAW_OFFSET) */
    int   ready;
} pose_t;

/* tip_axis: 센서 좌표계에서 스틱 끝 방향 (예: {0,0,1}) */
void pose_init(pose_t *p, const float tip_axis[3]);

/* 정지 상태 가속도(m/s^2)로 초기 기울기를 잡고 방위각 0을 현재 방향으로 */
void pose_start(pose_t *p, const float acc_ms2[3]);

/* 샘플 하나. gyro_dps는 바이어스 뺀 값. acc_ms2는 이번 샘플에 읽었으면 값, 아니면 NULL */
void pose_update(pose_t *p, const float gyro_dps[3], const float *acc_ms2, float dt_s);

/* 현재 스틱 끝 방향 */
void pose_angles(const pose_t *p, float *elev_deg, float *azim_deg);

/* 정면 보정 (RESET_POSE): 현재 방향을 방위각 0으로. 고도각은 그대로 */
void pose_reset_yaw(pose_t *p);

/* 스틱 끝이 아래로 내려가는 회전 속도 (°/s, 내려갈 때 +). 스틱을 쥔 방향(롤)과 무관 (235).
 * 자이로를 "끝을 아래로 꺾는 수평 회전축"에 투영한 값 = 고도각 변화율의 부호 반대.
 * 끝이 거의 수직(|고도각| > 약 75°)이면 축이 정해지지 않아 0 */
float pose_down_rate(const pose_t *p, const float gyro_dps[3]);

#endif /* POSE_H */
