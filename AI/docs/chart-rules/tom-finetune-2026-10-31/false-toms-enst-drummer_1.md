# 정답 없는 탐 자리 확인: enst_minus_one drummer_1 (21곡, 후보 pk_gap30)

정답 없는 탐 = 정답 탐과 50ms 안에서 짝이 안 된 탐 예측 (rule-eval tomFalseKept와 같은 수).

## base

- 정답 없는 탐 385개, 정답 탐과 짝이 된 탐 88개
- 정답 없는 탐에 붙은 패드: FLOOR_TOM 380, MID_TOM 5
- 같은 자리(±30ms)에 ADTOF 킥 피크도 있음: 52 (14%)
- 가장 가까운 정답 주석까지 거리 중앙값 6ms
- 탐 점수 중앙값: 정답 없는 탐 0.54, 짝이 된 탐 0.48

±50ms 안 정답 주석 조합 (위 12개)

| 정답 주석 | 개수 |
| --- | --- |
| bd+sd | 102 (26%) |
| sd | 77 (20%) |
| rs | 45 (12%) |
| bd+cs | 39 (10%) |
| bd+rs | 17 (4%) |
| chh+sd | 14 (4%) |
| cs | 12 (3%) |
| chh+cs | 12 (3%) |
| (없음) | 11 (3%) |
| bd+chh | 9 (2%) |
| bd+chh+sd | 9 (2%) |
| bd | 8 (2%) |

라벨 하나씩: 정답 없는 탐 ±50ms 안에 그 라벨이 있는 개수 (한 자리에 여럿이면 각각 셈)

| 라벨 | 개수 |
| --- | --- |
| sd | 205 (53%) |
| bd | 196 (51%) |
| cs | 75 (19%) |
| rs | 69 (18%) |
| chh | 65 (17%) |
| c1 | 5 (1%) |
| sd- | 2 (1%) |
| rc2 | 2 (1%) |
| ohh | 1 (0%) |

정답 없는 탐이 많은 곡 (위 8곡)

| 곡 | 정답 없는 탐 | 가장 많은 정답 주석 |
| --- | --- | --- |
| drummer_1/115_minus-one_bossa_brushes | 209 | bd+sd 75, sd 41, bd+cs 39 |
| drummer_1/113_minus-one_charleston_sticks | 84 | rs 45, bd+rs 17, (없음) 9 |
| drummer_1/125_MIDI-minus-one_country-120_brushes | 38 | bd+sd 19, sd 18, chh+sd 1 |
| drummer_1/111_minus-one_funky_rods | 11 | sd 8, (없음) 2, bd+c1+chh 1 |
| drummer_1/121_MIDI-minus-one_bigband_brushes | 10 | sd 7, bd+sd 2, bd+c1+sd 1 |
| drummer_1/107_minus-one_salsa_sticks | 9 | c1+cs 3, bd+chh 3, sd- 2 |
| drummer_1/108_minus-one_rock-60s_sticks | 8 | bd+chh 4, bd 2, bd+chh+sd 2 |
| drummer_1/114_minus-one_celtic-rock_brushes | 5 | sd 2, bd+chh+sd 2, bd+sd 1 |

## tom_5cls

- 정답 없는 탐 3552개, 정답 탐과 짝이 된 탐 240개
- 정답 없는 탐에 붙은 패드: FLOOR_TOM 3533, MID_TOM 10, SMALL_TOM 9
- 같은 자리(±30ms)에 ADTOF 킥 피크도 있음: 1634 (46%)
- 가장 가까운 정답 주석까지 거리 중앙값 6ms
- 탐 점수 중앙값: 정답 없는 탐 0.85, 짝이 된 탐 0.97

±50ms 안 정답 주석 조합 (위 12개)

| 정답 주석 | 개수 |
| --- | --- |
| bd+chh | 459 (13%) |
| (없음) | 446 (13%) |
| sd | 446 (13%) |
| bd+sd | 384 (11%) |
| bd | 282 (8%) |
| chh+sd | 256 (7%) |
| bd+ohh | 255 (7%) |
| bd+chh+sd | 122 (3%) |
| bd+rc2 | 116 (3%) |
| bd+c1 | 115 (3%) |
| chh | 94 (3%) |
| bd+ohh+sd | 75 (2%) |

라벨 하나씩: 정답 없는 탐 ±50ms 안에 그 라벨이 있는 개수 (한 자리에 여럿이면 각각 셈)

| 라벨 | 개수 |
| --- | --- |
| bd | 2119 (60%) |
| sd | 1456 (41%) |
| chh | 1114 (31%) |
| ohh | 402 (11%) |
| rc2 | 250 (7%) |
| c1 | 249 (7%) |
| cs | 103 (3%) |
| rs | 61 (2%) |
| cb | 25 (1%) |
| sd- | 14 (0%) |
| mt | 6 (0%) |
| lt | 6 (0%) |

정답 없는 탐이 많은 곡 (위 8곡)

| 곡 | 정답 없는 탐 | 가장 많은 정답 주석 |
| --- | --- | --- |
| drummer_1/114_minus-one_celtic-rock_brushes | 423 | (없음) 114, bd+sd 102, sd 83 |
| drummer_1/111_minus-one_funky_rods | 285 | (없음) 65, sd 46, bd+chh 45 |
| drummer_1/123_MIDI-minus-one_blues-102_sticks | 276 | bd+chh 80, bd+ohh 61, bd+ohh+sd 43 |
| drummer_1/115_minus-one_bossa_brushes | 257 | bd+sd 85, bd+cs 47, sd 46 |
| drummer_1/121_MIDI-minus-one_bigband_brushes | 254 | bd+sd 47, (없음) 40, bd+chh+sd 33 |
| drummer_1/110_minus-one_musette_brushes | 249 | sd 76, (없음) 59, bd+sd 34 |
| drummer_1/108_minus-one_rock-60s_sticks | 245 | bd+chh 56, chh+sd 48, bd+c1+chh 33 |
| drummer_1/109_minus-one_metal_sticks | 167 | bd+chh 53, chh+sd 18, bd 14 |

## tom_6cls

- 정답 없는 탐 3268개, 정답 탐과 짝이 된 탐 242개
- 정답 없는 탐에 붙은 패드: FLOOR_TOM 3249, MID_TOM 10, SMALL_TOM 9
- 같은 자리(±30ms)에 ADTOF 킥 피크도 있음: 1358 (42%)
- 가장 가까운 정답 주석까지 거리 중앙값 5ms
- 탐 점수 중앙값: 정답 없는 탐 0.87, 짝이 된 탐 0.97

±50ms 안 정답 주석 조합 (위 12개)

| 정답 주석 | 개수 |
| --- | --- |
| bd+chh | 447 (14%) |
| sd | 376 (12%) |
| bd+sd | 374 (11%) |
| (없음) | 310 (9%) |
| bd | 281 (9%) |
| chh+sd | 248 (8%) |
| bd+ohh | 244 (7%) |
| bd+chh+sd | 119 (4%) |
| bd+c1 | 117 (4%) |
| bd+rc2 | 115 (4%) |
| bd+ohh+sd | 73 (2%) |
| bd+c1+chh | 65 (2%) |

라벨 하나씩: 정답 없는 탐 ±50ms 안에 그 라벨이 있는 개수 (한 자리에 여럿이면 각각 셈)

| 라벨 | 개수 |
| --- | --- |
| bd | 2083 (64%) |
| sd | 1367 (42%) |
| chh | 1053 (32%) |
| ohh | 388 (12%) |
| c1 | 252 (8%) |
| rc2 | 250 (8%) |
| cs | 100 (3%) |
| rs | 66 (2%) |
| cb | 30 (1%) |
| sd- | 18 (1%) |
| mt | 6 (0%) |
| lt | 5 (0%) |

정답 없는 탐이 많은 곡 (위 8곡)

| 곡 | 정답 없는 탐 | 가장 많은 정답 주석 |
| --- | --- | --- |
| drummer_1/114_minus-one_celtic-rock_brushes | 374 | bd+sd 100, (없음) 85, sd 64 |
| drummer_1/111_minus-one_funky_rods | 246 | (없음) 53, bd+chh 44, sd 41 |
| drummer_1/115_minus-one_bossa_brushes | 245 | bd+sd 82, sd 44, bd+cs 42 |
| drummer_1/108_minus-one_rock-60s_sticks | 234 | bd+chh 58, chh+sd 46, bd+c1+chh 33 |
| drummer_1/121_MIDI-minus-one_bigband_brushes | 227 | bd+sd 45, bd+chh+sd 32, sd 30 |
| drummer_1/123_MIDI-minus-one_blues-102_sticks | 223 | bd+chh 76, bd+ohh 53, bd+ohh+sd 40 |
| drummer_1/110_minus-one_musette_brushes | 209 | sd 72, bd+sd 31, (없음) 30 |
| drummer_1/109_minus-one_metal_sticks | 158 | bd+chh 51, chh+sd 16, bd 15 |

## tom_7cls

- 정답 없는 탐 3490개, 정답 탐과 짝이 된 탐 263개
- 정답 없는 탐에 붙은 패드: FLOOR_TOM 3466, SMALL_TOM 12, MID_TOM 12
- 같은 자리(±30ms)에 ADTOF 킥 피크도 있음: 1642 (47%)
- 가장 가까운 정답 주석까지 거리 중앙값 6ms
- 탐 점수 중앙값: 정답 없는 탐 0.89, 짝이 된 탐 0.97

±50ms 안 정답 주석 조합 (위 12개)

| 정답 주석 | 개수 |
| --- | --- |
| bd+chh | 455 (13%) |
| sd | 424 (12%) |
| bd+sd | 373 (11%) |
| (없음) | 371 (11%) |
| bd | 280 (8%) |
| chh+sd | 271 (8%) |
| bd+ohh | 254 (7%) |
| bd+c1 | 122 (3%) |
| bd+chh+sd | 121 (3%) |
| bd+rc2 | 118 (3%) |
| chh | 87 (2%) |
| bd+ohh+sd | 78 (2%) |

라벨 하나씩: 정답 없는 탐 ±50ms 안에 그 라벨이 있는 개수 (한 자리에 여럿이면 각각 셈)

| 라벨 | 개수 |
| --- | --- |
| bd | 2129 (61%) |
| sd | 1450 (42%) |
| chh | 1126 (32%) |
| ohh | 410 (12%) |
| c1 | 275 (8%) |
| rc2 | 256 (7%) |
| cs | 100 (3%) |
| rs | 55 (2%) |
| cb | 38 (1%) |
| sd- | 22 (1%) |
| mt | 8 (0%) |
| lt | 7 (0%) |

정답 없는 탐이 많은 곡 (위 8곡)

| 곡 | 정답 없는 탐 | 가장 많은 정답 주석 |
| --- | --- | --- |
| drummer_1/114_minus-one_celtic-rock_brushes | 395 | bd+sd 102, (없음) 96, sd 72 |
| drummer_1/111_minus-one_funky_rods | 285 | (없음) 63, sd 49, bd+chh 44 |
| drummer_1/108_minus-one_rock-60s_sticks | 259 | bd+chh 57, chh+sd 48, bd+c1+chh 35 |
| drummer_1/123_MIDI-minus-one_blues-102_sticks | 250 | bd+chh 77, bd+ohh 59, bd+ohh+sd 44 |
| drummer_1/115_minus-one_bossa_brushes | 243 | bd+sd 82, sd 44, bd+cs 43 |
| drummer_1/110_minus-one_musette_brushes | 228 | sd 74, (없음) 40, bd+sd 31 |
| drummer_1/121_MIDI-minus-one_bigband_brushes | 222 | bd+sd 43, bd+chh+sd 33, sd 31 |
| drummer_1/109_minus-one_metal_sticks | 183 | bd+chh 54, chh+sd 20, (없음) 17 |
