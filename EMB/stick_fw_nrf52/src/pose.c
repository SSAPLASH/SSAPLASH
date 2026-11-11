/*
 * pose.c - 스틱 방향 추정 (S15P31A307-117). 설명은 pose.h
 */
#include "pose.h"
#include <math.h>

#define DEG2RAD 0.01745329252f
#define RAD2DEG 57.2957795131f
#define G_MS2   9.80665f

static void qmul(const float a[4], const float b[4], float o[4])
{
    o[0] = a[0]*b[0] - a[1]*b[1] - a[2]*b[2] - a[3]*b[3];
    o[1] = a[0]*b[1] + a[1]*b[0] + a[2]*b[3] - a[3]*b[2];
    o[2] = a[0]*b[2] - a[1]*b[3] + a[2]*b[0] + a[3]*b[1];
    o[3] = a[0]*b[3] + a[1]*b[2] - a[2]*b[1] + a[3]*b[0];
}

static void qnorm(float q[4])
{
    float n = sqrtf(q[0]*q[0] + q[1]*q[1] + q[2]*q[2] + q[3]*q[3]);
    if (n > 0.0f) { q[0] /= n; q[1] /= n; q[2] /= n; q[3] /= n; }
}

/* v(센서) → 월드 */
static void rotate(const float q[4], const float v[3], float o[3])
{
    float qv[4] = {0, v[0], v[1], v[2]}, qc[4] = {q[0], -q[1], -q[2], -q[3]}, t[4], r[4];
    qmul(q, qv, t); qmul(t, qc, r);
    o[0] = r[1]; o[1] = r[2]; o[2] = r[3];
}

/* 월드 → 센서 */
static void rotate_inv(const float q[4], const float v[3], float o[3])
{
    float qc[4] = {q[0], -q[1], -q[2], -q[3]};
    rotate(qc, v, o);
}

static float raw_azimuth(const pose_t *p)
{
    float w[3];
    rotate(p->q, p->tip, w);
    return atan2f(w[1], w[0]) * RAD2DEG;
}

static float wrap180(float a)
{
    while (a > 180.0f) a -= 360.0f;
    while (a < -180.0f) a += 360.0f;
    return a;
}

void pose_init(pose_t *p, const float tip_axis[3])
{
    float n = sqrtf(tip_axis[0]*tip_axis[0] + tip_axis[1]*tip_axis[1] + tip_axis[2]*tip_axis[2]);
    for (int i = 0; i < 3; i++) p->tip[i] = tip_axis[i] / n;
    p->q[0] = 1; p->q[1] = p->q[2] = p->q[3] = 0;
    p->kp = 2.5f;
    p->gate_ms2 = 1.5f;
    p->gate_dps = 200.0f;
    p->az_ref_deg = 0;
    p->az_offset_deg = 0;
    p->ready = 0;
}

void pose_start(pose_t *p, const float a[3])
{
    /* 센서에서 본 "위" = 가속도 방향. 이것을 월드 z로 보내는 최소 회전 */
    float n = sqrtf(a[0]*a[0] + a[1]*a[1] + a[2]*a[2]);
    if (n < 1e-3f) return;
    float u[3] = {a[0]/n, a[1]/n, a[2]/n};
    /* cross(u, z) = (u_y, -u_x, 0), dot(u, z) = u_z */
    p->q[0] = 1.0f + u[2];
    p->q[1] = u[1];
    p->q[2] = -u[0];
    p->q[3] = 0.0f;
    if (p->q[0] < 1e-6f) { p->q[0] = 0; p->q[1] = 1; p->q[2] = 0; p->q[3] = 0; }   /* 거꾸로 */
    qnorm(p->q);
    p->ready = 1;
    pose_reset_yaw(p);
}

void pose_update(pose_t *p, const float g_dps[3], const float *a, float dt)
{
    if (!p->ready) return;
    float w[3] = {g_dps[0]*DEG2RAD, g_dps[1]*DEG2RAD, g_dps[2]*DEG2RAD};

    if (a) {
        float n = sqrtf(a[0]*a[0] + a[1]*a[1] + a[2]*a[2]);
        float gmag = sqrtf(g_dps[0]*g_dps[0] + g_dps[1]*g_dps[1] + g_dps[2]*g_dps[2]);
        if (fabsf(n - G_MS2) < p->gate_ms2 && gmag < p->gate_dps) {
            static const float zw[3] = {0, 0, 1};
            float um[3] = {a[0]/n, a[1]/n, a[2]/n}, ue[3];
            rotate_inv(p->q, zw, ue);                     /* 추정한 "위"를 센서 좌표로 */
            /* e = um × ue : 측정과 추정의 어긋남을 줄이는 방향의 회전 */
            w[0] += p->kp * (um[1]*ue[2] - um[2]*ue[1]);
            w[1] += p->kp * (um[2]*ue[0] - um[0]*ue[2]);
            w[2] += p->kp * (um[0]*ue[1] - um[1]*ue[0]);
        }
    }

    float qw[4] = {0, w[0], w[1], w[2]}, dq[4];
    qmul(p->q, qw, dq);
    for (int i = 0; i < 4; i++) p->q[i] += 0.5f * dq[i] * dt;
    qnorm(p->q);
}

void pose_angles(const pose_t *p, float *el, float *az)
{
    float w[3];
    rotate(p->q, p->tip, w);
    float z = w[2];
    if (z > 1.0f) z = 1.0f;
    if (z < -1.0f) z = -1.0f;
    *el = asinf(z) * RAD2DEG;
    /* 월드는 오른손 좌표(z 위)라 atan2가 반시계 +. 시계 방향(오른쪽) +로 뒤집는다 */
    *az = wrap180(-(atan2f(w[1], w[0]) * RAD2DEG - p->az_ref_deg) + p->az_offset_deg);
}

float pose_down_rate(const pose_t *p, const float g[3])
{
    const float zw[3] = {0, 0, 1};
    float u[3], n[3];
    const float *t = p->tip;
    rotate_inv(p->q, zw, u);                          /* 월드 "위"를 센서 좌표로 */
    n[0] = u[1]*t[2] - u[2]*t[1];                     /* n = 위 × 끝 : 끝을 아래로 꺾는 회전축 (수평) */
    n[1] = u[2]*t[0] - u[0]*t[2];
    n[2] = u[0]*t[1] - u[1]*t[0];
    float m = sqrtf(n[0]*n[0] + n[1]*n[1] + n[2]*n[2]);   /* = cos(고도각) */
    if (m < 0.25f) return 0.0f;
    return (g[0]*n[0] + g[1]*n[1] + g[2]*n[2]) / m;
}

void pose_reset_yaw(pose_t *p)
{
    p->az_ref_deg = raw_azimuth(p);
    p->az_offset_deg = 0;
}
