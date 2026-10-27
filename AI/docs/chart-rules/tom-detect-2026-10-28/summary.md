# 실제 녹음 탐 검출·배정 규칙 비교 (S15P31A307-164 재연구)

측정일 2026-10-28 · 모델 ADTOF + 드럼 킷 분리(`adtof_drumsep`) · 입력 정답 드럼 트랙 · 저장 특징(채보 모델 프레임별 확신 점수 + 분리 트랙 6개)으로 규칙만 다시 돌려 후보 37개 비교(`rule-eval`, CPU) · 기본값은 아직 안 바꿈

## 결론

- **탐 타격 시각 고르기**를 저장소 방식(100ms 이동평균을 뺀 뒤 0.32와 비교)에서 이동평균을 안 빼는 방식으로 바꾸면(`tom_peak_mode: raw`) 실제 녹음(MDB)에서 50~70ms 간격 더블·롤의 두 번째 타격이 살아남아 탐 3종 F1 0.432 → 0.470, 전자 드럼(GMD) 0.919 → 0.903. 거르기 0.10은 그대로 켬
- **어느 탐인지**는 곡 안 음높이를 히스토그램 피크로 묶고(`tom_relative_method: peaks`) 묶음 수와 절대 음높이를 같이 보는 이름 규칙(`tom_relative_naming: hybrid`)을 쓰면 MDB 0.470 → **0.671**, GMD 0.903 → 0.863. 전 작업의 곡별 상대 방식이 GMD에서 무너진 원인은 가짜 탐(거르기로 해결)과 **틈으로 묶는 방식**이었음. 타격이 수백 개면 음높이가 연속으로 깔려 틈이 안 생기고 한 묶음이 됨(drummer5/session1/12: 탐 832개가 한 묶음 125Hz)
- GMD에서 남는 손실(0.863 vs 0.903)은 거의 전부 **정답 정의 충돌**임. GMD 연주가 탐 둘(94·157Hz)만 쓰면 정답은 플로어·스몰(TD-11 패드)인데, 실제 킷 MDB는 탐 둘인 킷의 위쪽 탐을 미드(164~176Hz)로 적음. 같은 소리를 한쪽은 스몰, 한쪽은 미드라고 부르므로 음높이로는 못 가름. 곡 안 이름 바뀜을 맞은 것으로 치는 보조 지표(`f1TomConsistent`)로 보면 GMD 0.899·MDB 0.698로 둘 다 유지됨
- **분리 모델이 킥 트랙에 넣은 낮은 플로어탐 되살리기**(`tom_gate_low_rescue`)는 채택 안 함. Grunge 7개를 되찾지만 Beatles·80sRock에서 킥을 탐으로 12개 더 내고, 그 가짜 탐이 묶음을 흐려 Beatles 플로어탐 21개가 통째로 미드가 됨. 진짜(Grunge)와 가짜(Beatles)를 가르는 특징이 없음: 둘 다 킥 점수 0.65~0.8, 탐 트랙 비율은 오히려 가짜가 더 큼(0.01~0.08 vs 0.000~0.002)
- 프레임 중앙값 음높이(`tom_f0_method: median`)는 차이 없음(MDB 0.671 → 0.429~0.702 범위에서 흔들림, GMD 변화 0.003 안). 기본은 그대로 피크 하나

## 후보 비교

점수는 탐 3종 패드별 F1 합산(50ms). 일관 F1은 곡 안에서 이름만 서로 바뀐 것을 맞은 것으로 친 값. 전체 표는 `candidates_scores.csv`(검출·이름 21개)와 `candidates_cluster_scores.csv`(묶는 법 10개).

| 후보 | GMD 탐 F1 | MDB 탐 F1 | GMD 일관 F1 | MDB 일관 F1 | MDB 짝 / 놓침 / 정답 없음 |
| --- | --- | --- | --- | --- | --- |
| 지금 기본값 | 0.880 | 0.213 | 0.876 | 0.284 | 59 / 31 / 217 |
| 거르기 0.10 | 0.919 | 0.432 | 0.915 | 0.619 | 48 / 42 / 1 |
| 거르기 + 이동평균 안 뺌 0.32 | 0.903 | 0.470 | 0.899 | 0.698 | 58 / 32 / 1 |
| 거르기 + 이동평균 안 뺌 0.24 | 0.866 | 0.468 | 0.863 | 0.701 | 61 / 29 / 3 |
| 거르기 + 이동평균 안 뺌 0.16 | 0.808 | 0.500 | 0.805 | 0.738 | 66 / 24 / 4 |
| 거르기 분모를 다른 트랙 합으로 | 0.917 | 0.366 | 0.914 | 0.537 | 49 / 41 / 25 |
| 거르기 + 낮은 탐 되살리기 0.5 | 0.919 | 0.468 | 0.915 | 0.633 | 55 / 35 / 13 |
| 위 검출(0.32) + 틈 묶기 + hybrid 이름 | 0.357 | 0.679 | 0.484 | 0.702 | 65 / 25 / 13 |
| 위 검출(0.32) + 피크 묶기 + hybrid 이름, 되살리기 포함 | 0.864 | 0.452 | 0.899 | 0.679 | 65 / 25 / 13 |
| **위 검출(0.32) + 피크 묶기(최소 거리 3.5반음) + hybrid 이름, 되살리기 없음** | **0.863** | **0.671** | **0.899** | **0.698** | 58 / 32 / 1 |
| 같은 조건, 이름은 고정 경계 | 0.902 | 0.274 | 0.899 | 0.679 | 65 / 25 / 13 |
| 같은 조건, 이름은 순서만 | 0.864 | 0.345 | 0.899 | 0.679 | 65 / 25 / 13 |

- 킥·스네어·하이햇·크래시·라이드는 모든 후보에서 같음. 탐 타격을 더 잡거나 덜 잡을 뿐 다른 패드는 안 건드림
- 고른 후보의 패드별: GMD 스몰 0.866·미드 0.827·플로어 0.889, MDB 스몰 0.000(정답 4개)·미드 0.708·플로어 0.680

## 고른 후보의 곡별

MDB. 짝지어진 탐 58개 중 맞음 50. 틀린 8개는 FunkJazz 스몰탐 2개(175Hz, 한 묶음이라 미드), Punk 미드 2개(94Hz, 플로어탐 91Hz와 같은 음높이), FreeJazz 플로어 3개(163Hz, 미드탐 164Hz와 같은 음높이), FusionJazz 1개

| 곡 | 짝 | 맞음 | 묶음 Hz | 비고 |
| --- | --- | --- | --- | --- |
| Beatles | 21 | 21 | 105 | 플로어탐 하나 |
| FreeJazz | 17 | 14 | 166 | 랙탐 1 + 플로어 1, 음높이 같음 |
| FunkJazz | 2 | 0 | 175 | 정답 스몰, 규칙은 미드 |
| FusionJazz | 12 | 11 | 89 / 179 | 플로어·미드 |
| Grunge | 0 | 0 | — | 81Hz 플로어탐 12개, 분리 모델이 킥 트랙에 넣어 거르기 탈락 |
| Punk | 6 | 4 | 91 | 플로어·미드 음높이 같음 |

GMD. 짝지어진 탐 1620개 중 맞음 1516. 틀린 104개 중 92개가 탐 둘만 쓴 연주(94·157~163Hz)에서 위쪽 탐을 미드로 붙인 것(정답 스몰). 세 탐을 다 쓴 연주 7개는 2030개 중 2017개 맞음

| 곡 | 짝 | 맞음 | 묶음 Hz |
| --- | --- | --- | --- |
| drummer5/session1/12 | 832 | 813 | 94 / 127 / 159 |
| drummer5/session1/7 | 410 | 404 | 94 / 128 / 159 |
| drummer1/session1/28 | 92 | 92 | 93 / 118 / 145 |
| drummer1/session2/110 | 58 | 16 | 94 / 159 (탐 둘) |
| drummer1/session1/239 | 43 | 20 | 94 / 157 (탐 둘) |
| 나머지 9곡 | 185 | 171 | |

## 남은 문제

- **정답 정의.** 탐 둘인 곡의 위쪽 탐을 미드로 볼지 스몰로 볼지 정해야 함. 지금 규칙은 실제 킷 표기(미드)를 따르고, 그래서 GMD 2탐 연주 92개가 틀림. 반대로 정하면 MDB FreeJazz·FusionJazz 24개가 틀림. 서비스 입력은 실제 녹음이라 지금 쪽을 제안하되 팀 확인이 필요함
- **같은 음높이의 두 드럼**(FreeJazz 163/164, Punk 91/94)은 어떤 규칙도 못 가름. 8개
- **Grunge 낮은 플로어탐 12개**는 분리 모델 한계. 되살리기 규칙으로는 가짜 탐이 더 생김. 분리 모델 교체·비교(LarsNet) 또는 채보 모델 추가 학습으로
- **검출 놓침 32개**(MDB): 더블 두 번째 5, 작은 타격, 킥·스네어 혼동. 기준값을 0.16까지 내리면 24개로 줄지만 GMD가 0.80으로 떨어짐
- MDB 탐 정답 90개·7곡이라 0.671은 타격 한둘에 0.01~0.02씩 흔들림. 다른 킷 데이터로 다시 확인해야 함

## 바꾼 것

규칙 기본값은 그대로. `adtof_drumsep_transcriber.py`에 선택 키 `tom_threshold`·`tom_peak_mode`·`tom_gate_mode`·`tom_gate_low_rescue`·`tom_gate_low_min_score`·`tom_low_hz`·`tom_f0_method`·`tom_f0_frame_ms`·`tom_f0_hop_ms`·`tom_f0_start_ms`·`tom_relative_method`·`tom_relative_bin`·`tom_relative_smooth`·`tom_relative_min_frac`·`tom_hybrid_floor_max_hz`·`tom_hybrid_small_min_hz`, `tom_relative_naming: hybrid`. 저장 특징에 채보 모델 프레임별 점수와 분리 트랙 6개. `rule-eval`에 `tomRescued`·`tomConsistentAcc`·`f1TomConsistent`.

## 재현

```bash
# 특징 저장 (GPU, 한 번). 2026-10-27 전 파일은 --overwrite 로 다시 만듦
uv run ssaplash-bench rule-features --dataset configs/bench/datasets/gmd_test.yaml configs/bench/datasets/mdb_drums.yaml --overwrite
uv run ssaplash-bench rule-eval --dataset configs/bench/datasets/gmd_test.yaml configs/bench/datasets/mdb_drums.yaml --candidates docs/chart-rules/tom-detect-2026-10-28/candidates.yaml --out data/results/rule-eval-tom-detect
uv run ssaplash-bench rule-eval --dataset configs/bench/datasets/gmd_test.yaml configs/bench/datasets/mdb_drums.yaml --candidates docs/chart-rules/tom-detect-2026-10-28/candidates_cluster.yaml --out data/results/rule-eval-tom-cluster
```

고른 후보는 `candidates_cluster.yaml`의 `pk_gap35_nores`. 파일: `candidates.yaml`·`candidates_cluster.yaml`(후보), `candidates_scores.csv`·`candidates_cluster_scores.csv`(점수), `by_song_cluster.csv`(곡별)
