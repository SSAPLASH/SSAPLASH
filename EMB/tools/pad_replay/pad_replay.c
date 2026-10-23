/* PC용: 녹화 CSV를 hit_detect + pose + pad에 그대로 넣어 패드 판정 결과를 출력한다 (S15P31A307-117)
 * 사용법: pad_replay <csv> <reset_yaw_s>
 *   reset_yaw_s: 이 시각(초)에 정면 보정 (녹화에서 정면 수평 자세를 잡은 시점)
 * 스윙 축 x(아래로 -), 스틱 끝 +z, 자이로 바이어스는 116 실측값 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "hit_detect.h"
#include "pose.h"
#include "pad.h"

int main(int argc, char **argv)
{
    if (argc < 3) { fprintf(stderr, "usage: pad_replay file.csv reset_yaw_s\n"); return 1; }
    FILE *f = fopen(argv[1], "r");
    if (!f) { perror("open"); return 1; }
    double reset_s = atof(argv[2]);
    const float bias[3] = {-0.35f, -0.40f, 0.09f};
    const float tip[3] = {0, 0, 1};

    hit_params_t hp; hit_default_params(&hp);
    hit_detector_t hd; hit_init(&hd, &hp);
    pose_t ps; pose_init(&ps, tip);
    pad_table_t pt; pad_table_default(&pt);

    char line[256];
    unsigned long t_prev = 0;
    float last_acc[3] = {0, 0, 0};
    int started = 0;
    printf("seg,t_s,pad,elev,azim,dist,margin,peak\n");
    while (fgets(line, sizeof line, f)) {
        if (line[0] < '0' || line[0] > '9') continue;
        unsigned long t; unsigned seg; int g[3]; char *p = line;
        t = strtoul(p, &p, 10); p++;
        seg = (unsigned)strtoul(p, &p, 10); p++;
        for (int k = 0; k < 3; k++) { g[k] = (int)strtol(p, &p, 10); p++; }
        int has_acc = 0; float a[3];
        if (*p && *p != ',' && *p != '\n' && *p != '\r') {
            for (int k = 0; k < 3; k++) { a[k] = strtof(p, &p) / 100.0f; p++; }
            has_acc = 1;
        }
        float gd[3] = { g[0]/16.0f - bias[0], g[1]/16.0f - bias[1], g[2]/16.0f - bias[2] };
        if (has_acc) memcpy(last_acc, a, sizeof a);

        if (!started) {
            if (t / 1e6 >= reset_s && has_acc) { pose_start(&ps, a); started = 1; }
            t_prev = t;
            continue;
        }
        pose_update(&ps, gd, has_acc ? a : NULL, (float)((t - t_prev) / 1e6));
        t_prev = t;

        hit_event_t ev;
        int32_t down = -(int32_t)(g[0] - (int)(bias[0] * 16));
        if (hit_update(&hd, (uint32_t)t, down, &ev)) {
            float el, az; pose_angles(&ps, &el, &az);
            pad_result_t r = pad_classify(&pt, el, az);
            printf("%u,%.2f,%s,%.1f,%.1f,%.1f,%.1f,%u\n", seg, t / 1e6, pad_name(r.id), el, az,
                   r.dist_deg, r.margin_deg, ev.peak_dps);
        }
    }
    return 0;
}
