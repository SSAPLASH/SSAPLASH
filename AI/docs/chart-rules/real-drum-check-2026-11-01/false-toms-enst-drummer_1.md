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

## tom_6cls_real_no_d1

- 정답 없는 탐 2559개, 정답 탐과 짝이 된 탐 216개
- 정답 없는 탐에 붙은 패드: FLOOR_TOM 2545, SMALL_TOM 8, MID_TOM 6
- 같은 자리(±30ms)에 ADTOF 킥 피크도 있음: 1505 (59%)
- 가장 가까운 정답 주석까지 거리 중앙값 5ms
- 탐 점수 중앙값: 정답 없는 탐 0.76, 짝이 된 탐 0.93

±50ms 안 정답 주석 조합 (위 12개)

| 정답 주석 | 개수 |
| --- | --- |
| bd+chh | 387 (15%) |
| bd+sd | 360 (14%) |
| bd | 255 (10%) |
| (없음) | 242 (9%) |
| bd+ohh | 215 (8%) |
| sd | 215 (8%) |
| bd+c1 | 114 (4%) |
| bd+chh+sd | 114 (4%) |
| bd+rc2 | 113 (4%) |
| chh+sd | 89 (3%) |
| bd+ohh+sd | 58 (2%) |
| bd+c1+chh | 57 (2%) |

라벨 하나씩: 정답 없는 탐 ±50ms 안에 그 라벨이 있는 개수 (한 자리에 여럿이면 각각 셈)

| 라벨 | 개수 |
| --- | --- |
| bd | 1898 (74%) |
| sd | 948 (37%) |
| chh | 747 (29%) |
| ohh | 311 (12%) |
| rc2 | 228 (9%) |
| c1 | 214 (8%) |
| cs | 92 (4%) |
| rs | 35 (1%) |
| cb | 20 (1%) |
| mt | 10 (0%) |
| sd- | 7 (0%) |
| lt | 5 (0%) |
| mtr | 1 (0%) |

정답 없는 탐이 많은 곡 (위 8곡)

| 곡 | 정답 없는 탐 | 가장 많은 정답 주석 |
| --- | --- | --- |
| drummer_1/114_minus-one_celtic-rock_brushes | 293 | bd+sd 89, (없음) 71, bd 42 |
| drummer_1/115_minus-one_bossa_brushes | 224 | bd+sd 85, bd+cs 46, sd 36 |
| drummer_1/121_MIDI-minus-one_bigband_brushes | 209 | bd+sd 44, bd+chh+sd 34, bd 27 |
| drummer_1/123_MIDI-minus-one_blues-102_sticks | 198 | bd+chh 70, bd+ohh 49, bd+ohh+sd 31 |
| drummer_1/111_minus-one_funky_rods | 189 | bd+chh 42, (없음) 41, sd 28 |
| drummer_1/108_minus-one_rock-60s_sticks | 186 | bd+chh 55, bd+c1+chh 29, chh+sd 23 |
| drummer_1/110_minus-one_musette_brushes | 151 | sd 41, bd+sd 30, bd 25 |
| drummer_1/137_MIDI-minus-one_rock'n'roll-188_sticks | 137 | bd+rc2+sd 46, bd+rc2 45, bd+chh+rc2+sd 10 |

## tom_6cls_real_d1_practice

- 정답 없는 탐 99개, 정답 탐과 짝이 된 탐 260개
- 정답 없는 탐에 붙은 패드: FLOOR_TOM 92, MID_TOM 5, SMALL_TOM 2
- 같은 자리(±30ms)에 ADTOF 킥 피크도 있음: 55 (56%)
- 가장 가까운 정답 주석까지 거리 중앙값 7ms
- 탐 점수 중앙값: 정답 없는 탐 0.52, 짝이 된 탐 0.99

±50ms 안 정답 주석 조합 (위 12개)

| 정답 주석 | 개수 |
| --- | --- |
| bd+sd | 29 (29%) |
| (없음) | 20 (20%) |
| bd | 12 (12%) |
| bd+chh+sd | 7 (7%) |
| chh | 6 (6%) |
| bd+c1+chh | 3 (3%) |
| bd+chh | 3 (3%) |
| bd+c1+cs | 2 (2%) |
| c1+chh+cs | 2 (2%) |
| bd+c1+chh+cs | 2 (2%) |
| bd+rc2+sd | 2 (2%) |
| bd+mt | 1 (1%) |

라벨 하나씩: 정답 없는 탐 ±50ms 안에 그 라벨이 있는 개수 (한 자리에 여럿이면 각각 셈)

| 라벨 | 개수 |
| --- | --- |
| bd | 68 (69%) |
| sd | 40 (40%) |
| chh | 25 (25%) |
| c1 | 11 (11%) |
| cs | 6 (6%) |
| rc2 | 6 (6%) |
| mt | 4 (4%) |
| cb | 1 (1%) |
| ohh | 1 (1%) |

정답 없는 탐이 많은 곡 (위 8곡)

| 곡 | 정답 없는 탐 | 가장 많은 정답 주석 |
| --- | --- | --- |
| drummer_1/107_minus-one_salsa_sticks | 22 | bd 3, (없음) 3, chh 2 |
| drummer_1/121_MIDI-minus-one_bigband_brushes | 18 | bd+sd 7, bd+chh+sd 5, chh 3 |
| drummer_1/125_MIDI-minus-one_country-120_brushes | 16 | bd+sd 14, sd 1, bd+chh+sd 1 |
| drummer_1/114_minus-one_celtic-rock_brushes | 7 | (없음) 3, bd+sd 3, bd+chh+sd 1 |
| drummer_1/127_MIDI-minus-one_disco-108_sticks | 7 | bd 4, (없음) 2, rc2+sd 1 |
| drummer_1/108_minus-one_rock-60s_sticks | 6 | (없음) 5, bd+c1+chh 1 |
| drummer_1/110_minus-one_musette_brushes | 4 | bd+chh+rc2 1, (없음) 1, rc2 1 |
| drummer_1/137_MIDI-minus-one_rock'n'roll-188_sticks | 4 | bd+rc2+sd 2, bd+sd 2 |
