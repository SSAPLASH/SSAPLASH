/* PC용: 녹화 CSV를 hit_detect에 그대로 넣어 결과를 출력한다
 * 사용법: replay <csv> [axis 0/1/2] [sign +1/-1] [bias_lsb]
 * 출력: seg,t_detect_ms,t_hit_ms,peak,velocity,swing_ms,decel */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "hit_detect.h"

int main(int argc, char **argv)
{
    if (argc < 2) { fprintf(stderr, "usage: replay file.csv [axis] [sign] [bias]\n"); return 1; }
    FILE *f = fopen(argv[1], "r");
    if (!f) { perror("open"); return 1; }
    int axis = argc > 2 ? atoi(argv[2]) : 0;
    int sign = argc > 3 ? atoi(argv[3]) : -1;
    int bias = argc > 4 ? atoi(argv[4]) : 0;

    hit_params_t p; hit_default_params(&p);
    hit_detector_t h; hit_init(&h, &p);
    char line[256];
    printf("seg,t_detect_ms,t_hit_ms,peak,velocity,swing_ms,decel\n");
    while (fgets(line, sizeof line, f)) {
        if (line[0] < '0' || line[0] > '9') continue;
        unsigned long t; unsigned seg; int g[3];
        if (sscanf(line, "%lu,%u,%d,%d,%d", &t, &seg, &g[0], &g[1], &g[2]) != 5) continue;
        int32_t v = sign * (g[axis] - bias);
        hit_event_t ev;
        if (hit_update(&h, (uint32_t)t, v, &ev))
            printf("%u,%.1f,%.1f,%u,%u,%u,%.1f\n", seg, ev.t_detect_us / 1000.0, ev.t_hit_us / 1000.0,
                   ev.peak_dps, ev.velocity, ev.swing_ms, ev.decel_x10 / 10.0);
    }
    fprintf(stderr, "hits=%u reject weak=%u slow=%u long=%u\n",
            h.n_hits, h.n_reject_weak, h.n_reject_slow, h.n_reject_long);
    return 0;
}
