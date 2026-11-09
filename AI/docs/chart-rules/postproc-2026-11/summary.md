# 채보 후처리 — 피크 다시 고르기·이름 바꾸기

측정일 2026-11-08 · 로컬 CPU · 저장 특징(ADTOF 프레임별 점수 + 드럼 킷 분리 트랙) + 서비스 규칙 · 8패드 F1 ±50ms · ENST `c1`·`c4`는 RIDE로 채점

## 결론

- 킥·스네어·하이햇 ADTOF 문턱값만 0.85배로 낮춘 후보(`thr_m0.85_c1`)가 평가 전용 ENST에서 처음으로 지금 서비스보다 올랐다. 8패드 F1이 드럼 단독 0.828 → 0.833(+0.005, 95% 구간 +0.002 ~ +0.009), 원곡 분리 0.785 → 0.794(+0.009, +0.006 ~ +0.013)이고 드러머 1과 2·3 모두 구간이 0보다 위다
- 오른 곳은 킥과 스네어다. ENST 드럼 단독 킥 0.882 → 0.890, 스네어 0.807 → 0.820, 원곡 분리 킥 0.853 → 0.863, 스네어 0.747 → 0.769. 하이햇은 −0.001 ~ +0.002이고 탐·심벌은 같다
- 값은 ENST를 보지 않고 MDB 23곡(0.854 → 0.857)과 E-GMD test(0.654 → 0.668)로 골랐다. MDB 차이의 95% 구간은 −0.002 ~ +0.009로 0을 걸친다
- 오르는 폭은 작다. 11/07 E-GMD 검증으로 다시 맞춘 문턱값(킥 0.14·스네어 0.10·하이햇 0.16·심벌 0.22)은 ENST를 더 올렸지만(+0.010·+0.021) MDB 심벌이 떨어졌다. 이번 후보는 심벌 문턱값을 그대로 두고 덜 낮춘 것이다
- 다른 후처리 3종(동시 타격 보충, 탐 → 스네어, 하이햇 → 스네어)은 MDB에서 오르지 않아 고르지 않았다
- 서비스 적용 여부는 정하지 않았다. 적용하면 서비스 ADTOF 문턱값이 [0.22, 0.24, 0.32, 0.22, 0.30]에서 [0.187, 0.204, 0.32, 0.187, 0.30]이 된다(킥·스네어·탐·하이햇·심벌 순)

## 1. 왜 이 후보들인가

서비스 규칙 예측의 오류를 종류별로 나눴다(`scripts/hit_error_breakdown.py`).

| 종류 | ENST 드럼 단독 | ENST 원곡 분리 | MDB 23곡 | E-GMD test 1,170개 |
| --- | --- | --- | --- | --- |
| 놓친 타격 합 / 헛친 타격 합 | 5,951 / 2,441 | 7,471 / 2,760 | 1,357 / 894 | 311,214 / 87,449 |
| 다른 패드와 동시에 친 타격을 놓침 (킥·스네어·하이햇) | 617·658·1,032 | 853·937·1,018 | 14·29·174 | 29,029·37,584·43,876 |
| 스네어를 탐으로 적음 (플로어·미드) | 240·2 | 222·77 | 1·0 | 3,024·2,666 |
| 스네어를 하이햇으로만 적음 | 238 | 252 | 24 | 2,387 |
| 혼자 친 스네어를 놓침 | 967 | 1,277 | 635 | 80,112 |

- 놓친 타격이 헛친 타격의 2.4배라 문턱값을 낮추는 쪽(thr), 동시에 친 타격만 낮추는 쪽(co)을 넣었다
- 스네어를 탐·하이햇으로 적는 혼동을 고치는 이름 바꾸기 2종(tom2sn, hh2sn)을 넣었다
- 저장 특징의 프레임별 점수로 피크를 다시 고르면 저장 피크와 같다(25곡 125열 확인). 모델을 다시 돌리지 않는다
- 시간 오프셋은 11/08 측정에서 ENST에 효과가 없어 넣지 않았다(ROADMAP 11/08)

## 2. 후보와 고르는 방법

| 이름 | 하는 일 | 값 |
| --- | --- | --- |
| thr | 킥·스네어·하이햇 문턱값 m배, 심벌 c배. 탐은 서비스 규칙이 따로 고름 | m ∈ {0.5, 0.6, 0.7, 0.85, 1.0}, c ∈ {0.7, 0.85, 1.0} |
| co | 다른 종류 피크 20ms 안에서만 문턱값 r배 | r ∈ {0.5, 0.7, 0.85} |
| tom2sn | 규칙이 낸 탐 타격 20ms 안에 스네어 타격이 없고 ±20ms 스네어 점수 최대가 탐 점수 최대의 s배 이상이면 스네어로 | s ∈ {0.3, 0.5, 0.7, 1.0} |
| hh2sn | 같은 방식으로 하이햇 타격을 스네어로 | s ∈ {0.3, 0.5, 0.7, 1.0} |

- 후보 묶음마다 MDB 8패드가 가장 높은 값을 고른다. MDB가 지금 서비스보다 높고 E-GMD가 0.005 넘게 떨어지지 않은 것만 고른다
- 고른 후보를 MDB 상승이 큰 순서로 더한 조합을 만들어 다시 채점하고, 같은 규칙으로 하나를 마지막으로 고른다
- ENST는 고른 후보와 조합에만 한 번 돌렸다. 후보를 모두 끈 `current`는 서비스 예측과 패드별 개수가 같다(MDB 확인)

## 3. MDB·E-GMD (값 고르기)

| 후보 | MDB 8패드 | E-GMD 8패드 | 판단 |
| --- | --- | --- | --- |
| current (서비스) | 0.8544 | 0.6545 | |
| thr_m0.85_c1 | 0.8571 | 0.6681 | thr에서 고름, 마지막으로 고름 |
| thr_m0.7_c1 | 0.8570 | 0.6808 | MDB가 0.0001 낮음 |
| thr_m0.5_c1 | 0.8510 | 0.6951 | MDB가 떨어짐 |
| thr_m0.85_c0.7 | 0.8540 | 0.6685 | 심벌을 낮추면 MDB가 떨어짐 |
| co_r0.85 | 0.8528 | 0.6574 | MDB가 떨어짐 |
| tom2sn_s0.3 | 0.8540 | 0.6592 | MDB에 스네어를 탐으로 적는 혼동이 1개뿐이라 오를 자리가 없음 |
| hh2sn_s0.7 | 0.8547 | 0.6551 | hh2sn에서 고름 |
| thr_m0.85_c1 + hh2sn_s0.7 | 0.8568 | 0.6687 | MDB가 thr 하나보다 낮음 |

- 모든 후보 표는 `pick_stage1.json`, 조합 채점은 `pick_final.json`
- `thr_m0.85_c1`의 MDB 패드별: 스네어 0.805 → 0.810, 하이햇 0.863 → 0.866, 나머지 같음. E-GMD 킥 0.706 → 0.723, 스네어 0.500 → 0.532, 하이햇 0.731 → 0.738, 나머지 같음
- MDB 차이 +0.0027의 95% 구간은 −0.0024 ~ +0.0088, E-GMD +0.0136은 +0.0127 ~ +0.0145

## 4. ENST (평가 전용, 64곡)

괄호는 같은 곡끼리 2,000번 다시 뽑은 95% 구간. 전체 표는 `enst.md`.

| 입력 | 묶음 | current | thr_m0.85_c1 | 차이 |
| --- | --- | --- | --- | --- |
| 드럼 단독 | 전체 | 0.828 | 0.833 | +0.005 (+0.002 ~ +0.009) |
| 드럼 단독 | 드러머 1 | 0.704 | 0.710 | +0.006 (+0.003 ~ +0.011) |
| 드럼 단독 | 드러머 2·3 | 0.887 | 0.892 | +0.005 (+0.002 ~ +0.009) |
| 원곡 분리 | 전체 | 0.785 | 0.794 | +0.009 (+0.006 ~ +0.013) |
| 원곡 분리 | 드러머 1 | 0.666 | 0.677 | +0.011 (+0.005 ~ +0.018) |
| 원곡 분리 | 드러머 2·3 | 0.841 | 0.849 | +0.008 (+0.005 ~ +0.013) |

- 설계 판정(ENST 두 입력 모두 구간 아래쪽 > 0, 0.02 넘게 떨어지는 패드 없음, MDB가 떨어지지 않음)을 모두 만족해 "서비스 적용 후보"다
- hh2sn_s0.7은 ENST에서 ±0.001 안이고, 조합은 thr 하나와 같다

## 5. 재현

```bash
uv run python scripts/hit_error_breakdown.py --dataset configs/bench/datasets/enst_minus_one.yaml --features data/rule_features --enst-c1-ride --out data/results/postproc/err_enst_drums.csv
uv run python scripts/postproc_eval.py grid --out data/results/postproc/grid.json
uv run python scripts/postproc_eval.py run --dataset configs/bench/datasets/mdb_drums.yaml --candidates data/results/postproc/grid.json --out data/results/postproc/mdb.csv
uv run python scripts/postproc_eval.py run --dataset configs/bench/datasets/egmd_test_acoustic.yaml --candidates data/results/postproc/grid.json --out data/results/postproc/egmd.csv
uv run python scripts/postproc_eval.py select --mdb data/results/postproc/mdb.csv --egmd data/results/postproc/egmd.csv --candidates data/results/postproc/grid.json --out data/results/postproc/pick1.json
# pick1.json의 picked·combos로 stage2.json을 만들어 MDB·E-GMD를 다시 돌리고 select --final
uv run python scripts/postproc_eval.py run --dataset configs/bench/datasets/enst_minus_one.yaml --features data/rule_features --enst-c1-ride --candidates docs/chart-rules/postproc-2026-11/candidates_stage2.json --out data/results/postproc/enst_drums.csv
uv run python scripts/postproc_eval.py run --dataset configs/bench/datasets/enst_minus_one_gain1.yaml --features data/rule_features_sep --enst-c1-ride --candidates docs/chart-rules/postproc-2026-11/candidates_stage2.json --out data/results/postproc/enst_sep.csv
uv run python scripts/postproc_eval.py enst --drums data/results/postproc/enst_drums.csv --sep data/results/postproc/enst_sep.csv --out docs/chart-rules/postproc-2026-11/enst.md
```
