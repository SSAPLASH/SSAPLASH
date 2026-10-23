# 드럼 채보 벤치마크 요약

run: drums-gmd, drums-mdb, drums-mdbu, drums-synth, mix-mdbu, mix-synth, sep-musdb-mdbu, sep-musdb-synth, sep-sw-mdbu, sep-sw-synth, ymt3-drums-gmd, ymt3-drums-mdb, ymt3-drums-mdbu, ymt3-drums-synth, ymt3-mix-mdbu, ymt3-mix-synth, ymt3-sep-musdb-mdbu, ymt3-sep-musdb-synth, ymt3-sep-sw-mdbu, ymt3-sep-sw-synth · 행 792개. F1은 묶음 안 모든 곡의 맞힌·헛것·놓친 개수를 더해 계산한 값(곡별 평균 아님)이고 오류가 난 곡은 집계에서 뺀다. 8패드 F1은 8패드를 다 내는 모델만, Perfect 폭 적중률은 ±25ms F1 ÷ ±50ms F1(8패드가 있으면 8패드 기준). 분리 후 F1 변화는 같은 모델의 정답 드럼(drums) 입력 대비 차이. RTF는 채보 시간 ÷ 곡 길이(로드·분리 제외, 곡 중앙값).

## gmd_test

| 모델 | 입력 | 곡/실패 | 5가지 F1 | 8패드 F1 | 분리 후 F1 변화 | Perfect 폭 적중률 | RTF | 피크 GPU 메모리 (MB) | 가중치 라이선스 | GPU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| adtof | drums | 45/0 | 0.801 | — | — | 0.975 | 0.005 | 126 | CC BY-NC-SA 4.0 (원본 ADTOF 가중치를 변환한 것) | NVIDIA A100-SXM4-40GB |
| adtof_drumsep | drums | 45/0 | 0.801 | 0.798 | — | 0.975 | 0.062 | 605 | CC BY-NC-SA 4.0 (ADTOF 가중치) + 미명시 (MDX23C DrumSep 가중치, aufr33·jarredou 공개) | NVIDIA A100-SXM4-40GB |
| yourmt3 | drums | 45/0 | 0.826 | 0.795 | — | 0.994 | 0.051 | 1978 | Apache-2.0 (HF 모델 저장소 mimbres/YourMT3 README. 학습 데이터 중 MAESTRO·ENST는 비상업 조건) | NVIDIA H200 NVL |
| idm | drums | 45/0 | 0.777 | 0.735 | — | 0.996 | 0.002 | 123 | Apache-2.0 (저장소 포함) | NVIDIA A100-SXM4-40GB |
| omnizart | drums | 45/0 | 0.650 | — | — | 0.914 | 0.308 | 3516 | 명시 없음 (omnizart download-checkpoints로 받음) | NVIDIA A100-SXM4-40GB |
| adt_str_tau08 | drums | 45/0 | 0.637 | 0.602 | — | 0.968 | 0.179 | 459 | CC BY-SA 4.0 (HF Pierfrancesco/adt-str, 저장소 README 기준) | NVIDIA A100-SXM4-40GB |

### gmd_test 보조값

| 모델 | 입력 | 체크포인트 | 파라미터 수 | 5가지 정밀도 | 5가지 재현율 | 5가지 F1 (±25ms) | 8패드 정밀도 | 8패드 재현율 | 8패드 F1 (±25ms) | 라벨 무시 F1 | 시각 오차 평균 (ms) | 시각 오차 절댓값 평균 (ms) | 세기 상관 | 채보 시간 (s) | 로드 시간 (s) | 피크 RAM (MB) | 패드 밖 예측 수 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| adtof | drums | adtof_frame_rnn_pytorch_weights.pth | 0.4M | 0.948 | 0.693 | 0.781 | — | — | — | 0.898 | -7.165 | 8.579 | — | 0.219 | 0.529 | 1406 | 0 |
| adtof_drumsep | drums | adtof_frame_rnn_pytorch_weights.pth+aufr33-jarredou_DrumSep_model_mdx23c_ep_141_sdr_10.8059.ckpt | 109.8M | 0.948 | 0.693 | 0.781 | 0.944 | 0.691 | 0.778 | 0.898 | -7.177 | 8.579 | — | 2.860 | 1.709 | 2435 | 0 |
| yourmt3 | drums | mimbres/YourMT3/mc13_256_g4_all_v7_mt3f_sqr_rms_moe_wf4_n8k2_silu_rope_rp_b36_nops@last.ckpt | 47.1M | 0.939 | 0.737 | 0.821 | 0.905 | 0.709 | 0.790 | 0.912 | -0.704 | 4.893 | — | 2.266 | 19.292 | — | 120 |
| idm | drums | idm-44-train-kits | 0.5M | 0.869 | 0.703 | 0.775 | 0.821 | 0.665 | 0.732 | 0.885 | 0.374 | 2.819 | — | 0.104 | 6.215 | — | 0 |
| omnizart | drums | omnizart-drum-default | — | 0.760 | 0.567 | 0.594 | — | — | — | 0.822 | -6.078 | 10.229 | — | 14.564 | 7.776 | — | 0 |
| adt_str_tau08 | drums | Pierfrancesco/adt-str/setting-tau-0.8 | 69.0M | 0.848 | 0.510 | 0.617 | 0.801 | 0.482 | 0.582 | 0.758 | -5.629 | 7.103 | 0.395 | 12.138 | 5.597 | — | 469 |

### gmd_test 패드별 F1 (±50ms)

| 모델 | 입력 | CRASH | FLOOR_TOM | HIHAT | HI_TOM | KICK | MID_TOM | RIDE | SNARE |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| adt_str_tau08 | drums | 0.000 | 0.525 | 0.644 | 0.003 | 0.766 | 0.368 | 0.000 | 0.578 |
| adtof_drumsep | drums | 0.785 | 0.856 | 0.841 | 0.872 | 0.818 | 0.909 | 0.920 | 0.660 |
| idm | drums | 0.716 | 0.018 | 0.889 | 0.465 | 0.690 | 0.020 | 0.583 | 0.691 |
| yourmt3 | drums | 0.549 | 0.504 | 0.788 | 0.554 | 0.909 | 0.376 | 0.702 | 0.824 |

### gmd_test 5가지별 F1 (±50ms)

| 모델 | 입력 | cymbal | hihat | kick | snare | tom |
| --- | --- | --- | --- | --- | --- | --- |
| adt_str_tau08 | drums | 0.070 | 0.644 | 0.766 | 0.578 | 0.753 |
| adtof | drums | 0.926 | 0.841 | 0.818 | 0.660 | 0.895 |
| adtof_drumsep | drums | 0.926 | 0.841 | 0.818 | 0.660 | 0.895 |
| idm | drums | 0.597 | 0.889 | 0.690 | 0.691 | 0.834 |
| omnizart | drums | 0.000 | 0.759 | 0.815 | 0.496 | 0.000 |
| yourmt3 | drums | 0.702 | 0.788 | 0.909 | 0.824 | 0.905 |

## mdb_drums

| 모델 | 입력 | 곡/실패 | 5가지 F1 | 8패드 F1 | 분리 후 F1 변화 | Perfect 폭 적중률 | RTF | 피크 GPU 메모리 (MB) | 가중치 라이선스 | GPU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| adtof | drums | 23/0 | 0.852 | — | — | 0.979 | 0.005 | 124 | CC BY-NC-SA 4.0 (원본 ADTOF 가중치를 변환한 것) | NVIDIA A100-SXM4-40GB |
| adtof_drumsep | drums | 23/0 | 0.852 | 0.840 | — | 0.979 | 0.065 | 605 | CC BY-NC-SA 4.0 (ADTOF 가중치) + 미명시 (MDX23C DrumSep 가중치, aufr33·jarredou 공개) | NVIDIA A100-SXM4-40GB |
| yourmt3 | drums | 23/0 | 0.733 | 0.719 | — | 0.986 | 0.050 | 1978 | Apache-2.0 (HF 모델 저장소 mimbres/YourMT3 README. 학습 데이터 중 MAESTRO·ENST는 비상업 조건) | NVIDIA H200 NVL |
| idm | drums | 23/0 | 0.706 | 0.698 | — | 0.985 | 0.002 | 103 | Apache-2.0 (저장소 포함) | NVIDIA A100-SXM4-40GB |
| adt_str_tau08 | drums | 23/0 | 0.672 | 0.668 | — | 0.974 | 0.102 | 415 | CC BY-SA 4.0 (HF Pierfrancesco/adt-str, 저장소 README 기준) | NVIDIA A100-SXM4-40GB |
| omnizart | drums | 23/0 | 0.628 | — | — | 0.942 | 0.309 | 3517 | 명시 없음 (omnizart download-checkpoints로 받음) | NVIDIA A100-SXM4-40GB |

### mdb_drums 보조값

| 모델 | 입력 | 체크포인트 | 파라미터 수 | 5가지 정밀도 | 5가지 재현율 | 5가지 F1 (±25ms) | 8패드 정밀도 | 8패드 재현율 | 8패드 F1 (±25ms) | 라벨 무시 F1 | 시각 오차 평균 (ms) | 시각 오차 절댓값 평균 (ms) | 세기 상관 | 채보 시간 (s) | 로드 시간 (s) | 피크 RAM (MB) | 패드 밖 예측 수 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| adtof | drums | adtof_frame_rnn_pytorch_weights.pth | 0.4M | 0.866 | 0.839 | 0.834 | — | — | — | 0.946 | -9.520 | 10.400 | — | 0.190 | 0.300 | 1391 | 0 |
| adtof_drumsep | drums | adtof_frame_rnn_pytorch_weights.pth+aufr33-jarredou_DrumSep_model_mdx23c_ep_141_sdr_10.8059.ckpt | 109.8M | 0.866 | 0.839 | 0.834 | 0.853 | 0.827 | 0.822 | 0.946 | -9.509 | 10.372 | — | 2.457 | 1.747 | 2345 | 0 |
| yourmt3 | drums | mimbres/YourMT3/mc13_256_g4_all_v7_mt3f_sqr_rms_moe_wf4_n8k2_silu_rope_rp_b36_nops@last.ckpt | 47.1M | 0.786 | 0.686 | 0.722 | 0.771 | 0.673 | 0.709 | 0.846 | -4.567 | 6.733 | — | 2.084 | 19.406 | — | 128 |
| idm | drums | idm-44-train-kits | 0.5M | 0.695 | 0.718 | 0.695 | 0.687 | 0.709 | 0.687 | 0.803 | -4.311 | 6.666 | — | 0.089 | 5.869 | — | 0 |
| adt_str_tau08 | drums | Pierfrancesco/adt-str/setting-tau-0.8 | 69.0M | 0.736 | 0.618 | 0.654 | 0.732 | 0.615 | 0.651 | 0.816 | -10.064 | 11.355 | — | 5.148 | 5.877 | — | 226 |
| omnizart | drums | omnizart-drum-default | — | 0.582 | 0.681 | 0.592 | — | — | — | 0.834 | -10.205 | 11.254 | — | 11.523 | 6.793 | — | 0 |

### mdb_drums 패드별 F1 (±50ms)

| 모델 | 입력 | CRASH | FLOOR_TOM | HIHAT | HI_TOM | KICK | MID_TOM | RIDE | SNARE |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| adt_str_tau08 | drums | 0.030 | 0.169 | 0.618 | 0.000 | 0.898 | 0.390 | 0.002 | 0.783 |
| adtof_drumsep | drums | 0.599 | 0.405 | 0.863 | 0.021 | 0.960 | 0.000 | 0.844 | 0.805 |
| idm | drums | 0.452 | 0.035 | 0.741 | 0.008 | 0.909 | 0.045 | 0.314 | 0.750 |
| yourmt3 | drums | 0.414 | 0.199 | 0.576 | 0.062 | 0.907 | 0.000 | 0.599 | 0.819 |

### mdb_drums 5가지별 F1 (±50ms)

| 모델 | 입력 | cymbal | hihat | kick | snare | tom |
| --- | --- | --- | --- | --- | --- | --- |
| adt_str_tau08 | drums | 0.039 | 0.618 | 0.898 | 0.783 | 0.139 |
| adtof | drums | 0.870 | 0.863 | 0.960 | 0.805 | 0.322 |
| adtof_drumsep | drums | 0.870 | 0.863 | 0.960 | 0.805 | 0.322 |
| idm | drums | 0.378 | 0.741 | 0.909 | 0.750 | 0.113 |
| omnizart | drums | 0.000 | 0.578 | 0.868 | 0.687 | 0.000 |
| yourmt3 | drums | 0.646 | 0.576 | 0.907 | 0.819 | 0.247 |

## mdb_drums_unseen

| 모델 | 입력 | 곡/실패 | 5가지 F1 | 8패드 F1 | 분리 후 F1 변화 | Perfect 폭 적중률 | RTF | 피크 GPU 메모리 (MB) | 가중치 라이선스 | GPU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| adtof | separated(bs_roformer_sw) | 11/0 | 0.799 | — | +0.004 | 0.924 | 0.007 | 1168 | CC BY-NC-SA 4.0 (원본 ADTOF 가중치를 변환한 것) | NVIDIA A100-SXM4-40GB |
| adtof | drums | 11/0 | 0.795 | — | — | 0.975 | 0.005 | 238 | CC BY-NC-SA 4.0 (원본 ADTOF 가중치를 변환한 것) | NVIDIA A100-SXM4-40GB |
| adtof | separated(bs_roformer_musdb) | 11/0 | 0.789 | — | -0.007 | 0.931 | 0.007 | 1018 | CC BY-NC-SA 4.0 (원본 ADTOF 가중치를 변환한 것) | NVIDIA A100-SXM4-40GB |
| adtof_drumsep | separated(bs_roformer_sw) | 11/0 | 0.799 | 0.777 | +0.001 | 0.922 | 0.062 | 1386 | CC BY-NC-SA 4.0 (ADTOF 가중치) + 미명시 (MDX23C DrumSep 가중치, aufr33·jarredou 공개) | NVIDIA A100-SXM4-40GB |
| adtof_drumsep | drums | 11/0 | 0.795 | 0.776 | — | 0.975 | 0.063 | 658 | CC BY-NC-SA 4.0 (ADTOF 가중치) + 미명시 (MDX23C DrumSep 가중치, aufr33·jarredou 공개) | NVIDIA A100-SXM4-40GB |
| adtof_drumsep | separated(bs_roformer_musdb) | 11/0 | 0.789 | 0.765 | -0.012 | 0.929 | 0.064 | 1234 | CC BY-NC-SA 4.0 (ADTOF 가중치) + 미명시 (MDX23C DrumSep 가중치, aufr33·jarredou 공개) | NVIDIA A100-SXM4-40GB |
| yourmt3 | drums | 11/0 | 0.752 | 0.733 | — | 0.982 | 0.050 | 1982 | Apache-2.0 (HF 모델 저장소 mimbres/YourMT3 README. 학습 데이터 중 MAESTRO·ENST는 비상업 조건) | NVIDIA H200 NVL |
| adtof | mixture | 11/0 | 0.716 | — | -0.079 | 0.939 | 0.005 | 238 | CC BY-NC-SA 4.0 (원본 ADTOF 가중치를 변환한 것) | NVIDIA A100-SXM4-40GB |
| adtof_drumsep | mixture | 11/0 | 0.716 | 0.697 | -0.079 | 0.939 | 0.061 | 658 | CC BY-NC-SA 4.0 (ADTOF 가중치) + 미명시 (MDX23C DrumSep 가중치, aufr33·jarredou 공개) | NVIDIA A100-SXM4-40GB |
| yourmt3 | separated(bs_roformer_sw) | 11/0 | 0.689 | 0.676 | -0.057 | 0.943 | 0.048 | 1982 | Apache-2.0 (HF 모델 저장소 mimbres/YourMT3 README. 학습 데이터 중 MAESTRO·ENST는 비상업 조건) | NVIDIA H200 NVL |
| idm | drums | 11/0 | 0.649 | 0.639 | — | 0.983 | 0.002 | 222 | Apache-2.0 (저장소 포함) | NVIDIA A100-SXM4-40GB |
| yourmt3 | separated(bs_roformer_musdb) | 11/0 | 0.648 | 0.635 | -0.098 | 0.948 | 0.047 | 1982 | Apache-2.0 (HF 모델 저장소 mimbres/YourMT3 README. 학습 데이터 중 MAESTRO·ENST는 비상업 조건) | NVIDIA H200 NVL |
| idm | separated(bs_roformer_sw) | 11/0 | 0.644 | 0.635 | -0.004 | 0.960 | 0.002 | 222 | Apache-2.0 (저장소 포함) | NVIDIA A100-SXM4-40GB |
| idm | separated(bs_roformer_musdb) | 11/0 | 0.632 | 0.622 | -0.017 | 0.951 | 0.002 | 222 | Apache-2.0 (저장소 포함) | NVIDIA A100-SXM4-40GB |
| adt_str_tau08 | drums | 11/0 | 0.589 | 0.585 | — | 0.968 | 0.156 | 463 | CC BY-SA 4.0 (HF Pierfrancesco/adt-str, 저장소 README 기준) | NVIDIA A100-SXM4-40GB |
| yourmt3 | mixture | 11/0 | 0.597 | 0.583 | -0.150 | 0.952 | 0.085 | 1982 | Apache-2.0 (HF 모델 저장소 mimbres/YourMT3 README. 학습 데이터 중 MAESTRO·ENST는 비상업 조건) | NVIDIA H200 NVL |
| adt_str_tau08 | separated(bs_roformer_sw) | 11/0 | 0.578 | 0.572 | -0.012 | 0.899 | 0.129 | 463 | CC BY-SA 4.0 (HF Pierfrancesco/adt-str, 저장소 README 기준) | NVIDIA A100-SXM4-40GB |
| adt_str_tau08 | separated(bs_roformer_musdb) | 11/0 | 0.567 | 0.555 | -0.029 | 0.907 | 0.160 | 463 | CC BY-SA 4.0 (HF Pierfrancesco/adt-str, 저장소 README 기준) | NVIDIA A100-SXM4-40GB |
| omnizart | separated(bs_roformer_sw) | 11/0 | 0.527 | — | +0.005 | 0.880 | 0.277 | 3517 | 명시 없음 (omnizart download-checkpoints로 받음) | NVIDIA A100-SXM4-40GB |
| omnizart | drums | 11/0 | 0.522 | — | — | 0.924 | 0.291 | 3517 | 명시 없음 (omnizart download-checkpoints로 받음) | NVIDIA A100-SXM4-40GB |
| omnizart | separated(bs_roformer_musdb) | 11/0 | 0.519 | — | -0.003 | 0.901 | 0.286 | 3517 | 명시 없음 (omnizart download-checkpoints로 받음) | NVIDIA A100-SXM4-40GB |
| omnizart | mixture | 11/0 | 0.482 | — | -0.040 | 0.872 | 0.277 | 3517 | 명시 없음 (omnizart download-checkpoints로 받음) | NVIDIA A100-SXM4-40GB |
| idm | mixture | 11/0 | 0.449 | 0.431 | -0.208 | 0.935 | 0.002 | 222 | Apache-2.0 (저장소 포함) | NVIDIA A100-SXM4-40GB |
| adt_str_tau08 | mixture | 11/0 | 0.375 | 0.346 | -0.238 | 0.856 | 0.199 | 463 | CC BY-SA 4.0 (HF Pierfrancesco/adt-str, 저장소 README 기준) | NVIDIA A100-SXM4-40GB |

### mdb_drums_unseen 보조값

| 모델 | 입력 | 체크포인트 | 파라미터 수 | 5가지 정밀도 | 5가지 재현율 | 5가지 F1 (±25ms) | 8패드 정밀도 | 8패드 재현율 | 8패드 F1 (±25ms) | 라벨 무시 F1 | 시각 오차 평균 (ms) | 시각 오차 절댓값 평균 (ms) | 세기 상관 | 채보 시간 (s) | 로드 시간 (s) | 피크 RAM (MB) | 패드 밖 예측 수 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| adtof | separated(bs_roformer_sw) | adtof_frame_rnn_pytorch_weights.pth | 0.4M | 0.853 | 0.751 | 0.738 | — | — | — | 0.898 | -10.718 | 11.142 | — | 0.564 | 0.293 | 2732 | 0 |
| adtof | drums | adtof_frame_rnn_pytorch_weights.pth | 0.4M | 0.829 | 0.765 | 0.776 | — | — | — | 0.938 | -9.974 | 10.400 | — | 0.402 | 0.295 | 1565 | 0 |
| adtof | separated(bs_roformer_musdb) | adtof_frame_rnn_pytorch_weights.pth | 0.4M | 0.832 | 0.750 | 0.734 | — | — | — | 0.894 | -11.025 | 11.432 | — | 0.527 | 0.296 | 2488 | 0 |
| adtof_drumsep | separated(bs_roformer_sw) | adtof_frame_rnn_pytorch_weights.pth+aufr33-jarredou_DrumSep_model_mdx23c_ep_141_sdr_10.8059.ckpt | 109.8M | 0.853 | 0.751 | 0.738 | 0.830 | 0.730 | 0.717 | 0.898 | -10.718 | 11.142 | — | 5.467 | 1.128 | 3454 | 0 |
| adtof_drumsep | drums | adtof_frame_rnn_pytorch_weights.pth+aufr33-jarredou_DrumSep_model_mdx23c_ep_141_sdr_10.8059.ckpt | 109.8M | 0.829 | 0.765 | 0.776 | 0.809 | 0.746 | 0.757 | 0.938 | -9.940 | 10.372 | — | 5.422 | 1.770 | 2882 | 0 |
| adtof_drumsep | separated(bs_roformer_musdb) | adtof_frame_rnn_pytorch_weights.pth+aufr33-jarredou_DrumSep_model_mdx23c_ep_141_sdr_10.8059.ckpt | 109.8M | 0.832 | 0.750 | 0.734 | 0.806 | 0.727 | 0.711 | 0.894 | -11.025 | 11.432 | — | 5.727 | 1.151 | 3264 | 0 |
| yourmt3 | drums | mimbres/YourMT3/mc13_256_g4_all_v7_mt3f_sqr_rms_moe_wf4_n8k2_silu_rope_rp_b36_nops@last.ckpt | 47.1M | 0.771 | 0.734 | 0.738 | 0.752 | 0.716 | 0.720 | 0.868 | -5.111 | 7.332 | — | 4.040 | 18.991 | — | 122 |
| adtof | mixture | adtof_frame_rnn_pytorch_weights.pth | 0.4M | 0.805 | 0.645 | 0.672 | — | — | — | 0.869 | -7.848 | 9.178 | — | 0.409 | 0.296 | 1529 | 0 |
| adtof_drumsep | mixture | adtof_frame_rnn_pytorch_weights.pth+aufr33-jarredou_DrumSep_model_mdx23c_ep_141_sdr_10.8059.ckpt | 109.8M | 0.805 | 0.645 | 0.672 | 0.784 | 0.628 | 0.654 | 0.869 | -7.848 | 9.049 | — | 5.399 | 1.757 | 2865 | 0 |
| yourmt3 | separated(bs_roformer_sw) | mimbres/YourMT3/mc13_256_g4_all_v7_mt3f_sqr_rms_moe_wf4_n8k2_silu_rope_rp_b36_nops@last.ckpt | 47.1M | 0.753 | 0.635 | 0.649 | 0.739 | 0.623 | 0.637 | 0.757 | -6.765 | 8.352 | — | 3.922 | 19.194 | — | 63 |
| idm | drums | idm-44-train-kits | 0.5M | 0.644 | 0.653 | 0.637 | 0.635 | 0.644 | 0.628 | 0.796 | -6.037 | 7.428 | — | 0.196 | 5.721 | — | 0 |
| yourmt3 | separated(bs_roformer_musdb) | mimbres/YourMT3/mc13_256_g4_all_v7_mt3f_sqr_rms_moe_wf4_n8k2_silu_rope_rp_b36_nops@last.ckpt | 47.1M | 0.705 | 0.601 | 0.615 | 0.690 | 0.588 | 0.602 | 0.782 | -6.618 | 8.281 | — | 3.809 | 19.709 | — | 90 |
| idm | separated(bs_roformer_sw) | idm-44-train-kits | 0.5M | 0.640 | 0.648 | 0.619 | 0.631 | 0.639 | 0.610 | 0.813 | -6.012 | 7.415 | — | 0.197 | 5.736 | — | 0 |
| idm | separated(bs_roformer_musdb) | idm-44-train-kits | 0.5M | 0.626 | 0.638 | 0.601 | 0.617 | 0.628 | 0.592 | 0.792 | -5.664 | 7.324 | — | 0.188 | 5.717 | — | 0 |
| adt_str_tau08 | drums | Pierfrancesco/adt-str/setting-tau-0.8 | 69.0M | 0.656 | 0.535 | 0.571 | 0.651 | 0.530 | 0.566 | 0.812 | -10.692 | 11.355 | — | 16.200 | 5.459 | — | 197 |
| yourmt3 | mixture | mimbres/YourMT3/mc13_256_g4_all_v7_mt3f_sqr_rms_moe_wf4_n8k2_silu_rope_rp_b36_nops@last.ckpt | 47.1M | 0.690 | 0.526 | 0.568 | 0.674 | 0.513 | 0.555 | 0.762 | -6.059 | 7.633 | — | 7.080 | 20.073 | — | 82 |
| adt_str_tau08 | separated(bs_roformer_sw) | Pierfrancesco/adt-str/setting-tau-0.8 | 69.0M | 0.656 | 0.516 | 0.520 | 0.649 | 0.511 | 0.514 | 0.786 | -10.806 | 11.492 | — | 8.536 | 5.446 | — | 228 |
| adt_str_tau08 | separated(bs_roformer_musdb) | Pierfrancesco/adt-str/setting-tau-0.8 | 69.0M | 0.654 | 0.500 | 0.514 | 0.641 | 0.490 | 0.504 | 0.790 | -11.518 | 11.865 | — | 14.049 | 5.468 | — | 223 |
| omnizart | separated(bs_roformer_sw) | omnizart-drum-default | — | 0.519 | 0.535 | 0.464 | — | — | — | 0.782 | -10.159 | 11.870 | — | 24.693 | 6.693 | — | 0 |
| omnizart | drums | omnizart-drum-default | — | 0.477 | 0.577 | 0.482 | — | — | — | 0.786 | -10.047 | 11.056 | — | 25.029 | 6.668 | — | 0 |
| omnizart | separated(bs_roformer_musdb) | omnizart-drum-default | — | 0.512 | 0.526 | 0.467 | — | — | — | 0.785 | -10.395 | 12.538 | — | 25.595 | 6.763 | — | 0 |
| omnizart | mixture | omnizart-drum-default | — | 0.486 | 0.478 | 0.420 | — | — | — | 0.741 | -8.158 | 11.818 | — | 25.290 | 6.602 | — | 0 |
| idm | mixture | idm-44-train-kits | 0.5M | 0.548 | 0.381 | 0.421 | 0.526 | 0.365 | 0.403 | 0.667 | -5.677 | 7.512 | — | 0.205 | 5.670 | — | 0 |
| adt_str_tau08 | mixture | Pierfrancesco/adt-str/setting-tau-0.8 | 69.0M | 0.369 | 0.381 | 0.319 | 0.341 | 0.352 | 0.296 | 0.663 | -12.477 | 13.967 | — | 19.782 | 5.375 | — | 1151 |

### mdb_drums_unseen 패드별 F1 (±50ms)

| 모델 | 입력 | CRASH | FLOOR_TOM | HIHAT | HI_TOM | KICK | MID_TOM | RIDE | SNARE |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| adt_str_tau08 | drums | 0.045 | 0.065 | 0.483 | 0.000 | 0.879 | 0.457 | 0.002 | 0.737 |
| adt_str_tau08 | mixture | 0.029 | 0.020 | 0.322 | 0.000 | 0.552 | 0.028 | 0.110 | 0.506 |
| adt_str_tau08 | separated(bs_roformer_musdb) | 0.008 | 0.182 | 0.464 | 0.000 | 0.855 | 0.276 | 0.031 | 0.688 |
| adt_str_tau08 | separated(bs_roformer_sw) | 0.024 | 0.126 | 0.459 | 0.000 | 0.896 | 0.323 | 0.025 | 0.702 |
| adtof_drumsep | drums | 0.540 | 0.000 | 0.728 | 0.025 | 0.943 | 0.000 | 0.848 | 0.752 |
| adtof_drumsep | mixture | 0.374 | 0.182 | 0.733 | 0.174 | 0.740 | 0.143 | 0.811 | 0.629 |
| adtof_drumsep | separated(bs_roformer_musdb) | 0.507 | 0.300 | 0.746 | 0.085 | 0.867 | 0.000 | 0.805 | 0.745 |
| adtof_drumsep | separated(bs_roformer_sw) | 0.507 | 0.364 | 0.751 | 0.077 | 0.921 | 0.000 | 0.814 | 0.745 |
| idm | drums | 0.539 | 0.036 | 0.663 | 0.009 | 0.883 | 0.051 | 0.342 | 0.721 |
| idm | mixture | 0.259 | 0.018 | 0.692 | 0.010 | 0.445 | 0.000 | 0.243 | 0.351 |
| idm | separated(bs_roformer_musdb) | 0.463 | 0.060 | 0.607 | 0.032 | 0.882 | 0.000 | 0.256 | 0.717 |
| idm | separated(bs_roformer_sw) | 0.469 | 0.075 | 0.617 | 0.031 | 0.903 | 0.033 | 0.268 | 0.719 |
| yourmt3 | drums | 0.417 | 0.192 | 0.479 | 0.080 | 0.944 | 0.000 | 0.626 | 0.828 |
| yourmt3 | mixture | 0.472 | 0.100 | 0.414 | 0.026 | 0.776 | 0.031 | 0.488 | 0.655 |
| yourmt3 | separated(bs_roformer_musdb) | 0.466 | 0.047 | 0.431 | 0.089 | 0.855 | 0.000 | 0.525 | 0.732 |
| yourmt3 | separated(bs_roformer_sw) | 0.533 | 0.115 | 0.450 | 0.154 | 0.883 | 0.000 | 0.557 | 0.765 |

### mdb_drums_unseen 5가지별 F1 (±50ms)

| 모델 | 입력 | cymbal | hihat | kick | snare | tom |
| --- | --- | --- | --- | --- | --- | --- |
| adt_str_tau08 | drums | 0.042 | 0.483 | 0.879 | 0.737 | 0.076 |
| adt_str_tau08 | mixture | 0.215 | 0.322 | 0.552 | 0.506 | 0.031 |
| adt_str_tau08 | separated(bs_roformer_musdb) | 0.106 | 0.464 | 0.855 | 0.688 | 0.120 |
| adt_str_tau08 | separated(bs_roformer_sw) | 0.065 | 0.459 | 0.896 | 0.702 | 0.117 |
| adtof | drums | 0.877 | 0.728 | 0.943 | 0.752 | 0.242 |
| adtof | mixture | 0.851 | 0.733 | 0.740 | 0.629 | 0.328 |
| adtof | separated(bs_roformer_musdb) | 0.857 | 0.746 | 0.867 | 0.745 | 0.549 |
| adtof | separated(bs_roformer_sw) | 0.859 | 0.751 | 0.921 | 0.745 | 0.490 |
| adtof_drumsep | drums | 0.877 | 0.728 | 0.943 | 0.752 | 0.242 |
| adtof_drumsep | mixture | 0.851 | 0.733 | 0.740 | 0.629 | 0.328 |
| adtof_drumsep | separated(bs_roformer_musdb) | 0.857 | 0.746 | 0.867 | 0.745 | 0.549 |
| adtof_drumsep | separated(bs_roformer_sw) | 0.859 | 0.751 | 0.921 | 0.745 | 0.490 |
| idm | drums | 0.414 | 0.663 | 0.883 | 0.721 | 0.079 |
| idm | mixture | 0.341 | 0.692 | 0.445 | 0.351 | 0.056 |
| idm | separated(bs_roformer_musdb) | 0.330 | 0.607 | 0.882 | 0.717 | 0.128 |
| idm | separated(bs_roformer_sw) | 0.345 | 0.617 | 0.903 | 0.719 | 0.133 |
| omnizart | drums | 0.000 | 0.439 | 0.797 | 0.630 | 0.000 |
| omnizart | mixture | 0.000 | 0.533 | 0.596 | 0.490 | 0.000 |
| omnizart | separated(bs_roformer_musdb) | 0.000 | 0.511 | 0.729 | 0.554 | 0.000 |
| omnizart | separated(bs_roformer_sw) | 0.000 | 0.497 | 0.817 | 0.557 | 0.000 |
| yourmt3 | drums | 0.676 | 0.479 | 0.944 | 0.828 | 0.338 |
| yourmt3 | mixture | 0.554 | 0.414 | 0.776 | 0.655 | 0.106 |
| yourmt3 | separated(bs_roformer_musdb) | 0.575 | 0.431 | 0.855 | 0.732 | 0.127 |
| yourmt3 | separated(bs_roformer_sw) | 0.605 | 0.450 | 0.883 | 0.765 | 0.284 |

## synth_v1

| 모델 | 입력 | 곡/실패 | 5가지 F1 | 8패드 F1 | 분리 후 F1 변화 | Perfect 폭 적중률 | RTF | 피크 GPU 메모리 (MB) | 가중치 라이선스 | GPU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| adtof | drums | 5/0 | 0.830 | — | — | 0.964 | 0.005 | 162 | CC BY-NC-SA 4.0 (원본 ADTOF 가중치를 변환한 것) | NVIDIA A100-SXM4-40GB |
| adtof_drumsep | drums | 5/0 | 0.830 | 0.827 | — | 0.964 | 0.066 | 607 | CC BY-NC-SA 4.0 (ADTOF 가중치) + 미명시 (MDX23C DrumSep 가중치, aufr33·jarredou 공개) | NVIDIA A100-SXM4-40GB |
| idm | drums | 5/0 | 0.810 | 0.782 | — | 0.997 | 0.002 | 162 | Apache-2.0 (저장소 포함) | NVIDIA A100-SXM4-40GB |
| adtof | separated(bs_roformer_sw) | 5/0 | 0.780 | — | -0.050 | 0.970 | 0.004 | 871 | CC BY-NC-SA 4.0 (원본 ADTOF 가중치를 변환한 것) | NVIDIA A100-SXM4-40GB |
| adtof_drumsep | separated(bs_roformer_sw) | 5/0 | 0.780 | 0.778 | -0.049 | 0.970 | 0.063 | 1296 | CC BY-NC-SA 4.0 (ADTOF 가중치) + 미명시 (MDX23C DrumSep 가중치, aufr33·jarredou 공개) | NVIDIA A100-SXM4-40GB |
| yourmt3 | drums | 5/0 | 0.814 | 0.768 | — | 0.997 | 0.056 | 1979 | Apache-2.0 (HF 모델 저장소 mimbres/YourMT3 README. 학습 데이터 중 MAESTRO·ENST는 비상업 조건) | NVIDIA H200 NVL |
| adtof | separated(bs_roformer_musdb) | 5/0 | 0.763 | — | -0.067 | 0.967 | 0.004 | 722 | CC BY-NC-SA 4.0 (원본 ADTOF 가중치를 변환한 것) | NVIDIA A100-SXM4-40GB |
| adtof_drumsep | separated(bs_roformer_musdb) | 5/0 | 0.763 | 0.762 | -0.065 | 0.967 | 0.065 | 1144 | CC BY-NC-SA 4.0 (ADTOF 가중치) + 미명시 (MDX23C DrumSep 가중치, aufr33·jarredou 공개) | NVIDIA A100-SXM4-40GB |
| idm | separated(bs_roformer_musdb) | 5/0 | 0.760 | 0.741 | -0.041 | 0.993 | 0.002 | 162 | Apache-2.0 (저장소 포함) | NVIDIA A100-SXM4-40GB |
| idm | separated(bs_roformer_sw) | 5/0 | 0.750 | 0.730 | -0.052 | 0.994 | 0.002 | 162 | Apache-2.0 (저장소 포함) | NVIDIA A100-SXM4-40GB |
| adtof | mixture | 5/0 | 0.698 | — | -0.132 | 0.969 | 0.005 | 162 | CC BY-NC-SA 4.0 (원본 ADTOF 가중치를 변환한 것) | NVIDIA A100-SXM4-40GB |
| adtof_drumsep | mixture | 5/0 | 0.698 | 0.685 | -0.142 | 0.971 | 0.061 | 607 | CC BY-NC-SA 4.0 (ADTOF 가중치) + 미명시 (MDX23C DrumSep 가중치, aufr33·jarredou 공개) | NVIDIA A100-SXM4-40GB |
| yourmt3 | separated(bs_roformer_sw) | 5/0 | 0.665 | 0.648 | -0.119 | 0.987 | 0.054 | 1979 | Apache-2.0 (HF 모델 저장소 mimbres/YourMT3 README. 학습 데이터 중 MAESTRO·ENST는 비상업 조건) | NVIDIA H200 NVL |
| adt_str_tau08 | drums | 5/0 | 0.659 | 0.644 | — | 0.982 | 0.162 | 458 | CC BY-SA 4.0 (HF Pierfrancesco/adt-str, 저장소 README 기준) | NVIDIA A100-SXM4-40GB |
| omnizart | drums | 5/0 | 0.625 | — | — | 0.929 | 0.296 | 3517 | 명시 없음 (omnizart download-checkpoints로 받음) | NVIDIA A100-SXM4-40GB |
| omnizart | separated(bs_roformer_musdb) | 5/0 | 0.620 | — | -0.005 | 0.926 | 0.290 | 3517 | 명시 없음 (omnizart download-checkpoints로 받음) | NVIDIA A100-SXM4-40GB |
| yourmt3 | separated(bs_roformer_musdb) | 5/0 | 0.647 | 0.617 | -0.150 | 0.994 | 0.056 | 1979 | Apache-2.0 (HF 모델 저장소 mimbres/YourMT3 README. 학습 데이터 중 MAESTRO·ENST는 비상업 조건) | NVIDIA H200 NVL |
| omnizart | separated(bs_roformer_sw) | 5/0 | 0.616 | — | -0.009 | 0.933 | 0.296 | 3517 | 명시 없음 (omnizart download-checkpoints로 받음) | NVIDIA A100-SXM4-40GB |
| adt_str_tau08 | separated(bs_roformer_sw) | 5/0 | 0.631 | 0.613 | -0.030 | 0.974 | 0.120 | 460 | CC BY-SA 4.0 (HF Pierfrancesco/adt-str, 저장소 README 기준) | NVIDIA A100-SXM4-40GB |
| adt_str_tau08 | separated(bs_roformer_musdb) | 5/0 | 0.624 | 0.610 | -0.034 | 0.975 | 0.123 | 460 | CC BY-SA 4.0 (HF Pierfrancesco/adt-str, 저장소 README 기준) | NVIDIA A100-SXM4-40GB |
| omnizart | mixture | 5/0 | 0.584 | — | -0.041 | 0.930 | 0.288 | 3517 | 명시 없음 (omnizart download-checkpoints로 받음) | NVIDIA A100-SXM4-40GB |
| yourmt3 | mixture | 5/0 | 0.569 | 0.557 | -0.211 | 0.964 | 0.202 | 1979 | Apache-2.0 (HF 모델 저장소 mimbres/YourMT3 README. 학습 데이터 중 MAESTRO·ENST는 비상업 조건) | NVIDIA H200 NVL |
| idm | mixture | 5/0 | 0.502 | 0.495 | -0.287 | 0.980 | 0.002 | 162 | Apache-2.0 (저장소 포함) | NVIDIA A100-SXM4-40GB |
| adt_str_tau08 | mixture | 5/0 | 0.381 | 0.361 | -0.283 | 0.907 | 0.321 | 460 | CC BY-SA 4.0 (HF Pierfrancesco/adt-str, 저장소 README 기준) | NVIDIA A100-SXM4-40GB |

### synth_v1 보조값

| 모델 | 입력 | 체크포인트 | 파라미터 수 | 5가지 정밀도 | 5가지 재현율 | 5가지 F1 (±25ms) | 8패드 정밀도 | 8패드 재현율 | 8패드 F1 (±25ms) | 라벨 무시 F1 | 시각 오차 평균 (ms) | 시각 오차 절댓값 평균 (ms) | 세기 상관 | 채보 시간 (s) | 로드 시간 (s) | 피크 RAM (MB) | 패드 밖 예측 수 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| adtof | drums | adtof_frame_rnn_pytorch_weights.pth | 0.4M | 0.969 | 0.726 | 0.800 | — | — | — | 0.837 | -8.396 | 9.031 | — | 0.268 | 0.288 | 1451 | 0 |
| adtof_drumsep | drums | adtof_frame_rnn_pytorch_weights.pth+aufr33-jarredou_DrumSep_model_mdx23c_ep_141_sdr_10.8059.ckpt | 109.8M | 0.969 | 0.726 | 0.800 | 0.965 | 0.724 | 0.798 | 0.837 | -8.424 | 9.063 | — | 3.951 | 1.743 | 2576 | 0 |
| idm | drums | idm-44-train-kits | 0.5M | 0.902 | 0.735 | 0.807 | 0.871 | 0.709 | 0.780 | 0.836 | 0.513 | 3.216 | — | 0.131 | 5.723 | — | 0 |
| adtof | separated(bs_roformer_sw) | adtof_frame_rnn_pytorch_weights.pth | 0.4M | 0.961 | 0.656 | 0.756 | — | — | — | 0.763 | -8.119 | 8.594 | — | 0.266 | 0.286 | 2631 | 0 |
| adtof_drumsep | separated(bs_roformer_sw) | adtof_frame_rnn_pytorch_weights.pth+aufr33-jarredou_DrumSep_model_mdx23c_ep_141_sdr_10.8059.ckpt | 109.8M | 0.961 | 0.656 | 0.756 | 0.959 | 0.655 | 0.755 | 0.763 | -8.153 | 8.594 | — | 3.773 | 1.153 | 3067 | 0 |
| yourmt3 | drums | mimbres/YourMT3/mc13_256_g4_all_v7_mt3f_sqr_rms_moe_wf4_n8k2_silu_rope_rp_b36_nops@last.ckpt | 47.1M | 0.955 | 0.710 | 0.812 | 0.900 | 0.669 | 0.765 | 0.826 | -1.182 | 5.502 | — | 3.015 | 19.281 | — | 13 |
| adtof | separated(bs_roformer_musdb) | adtof_frame_rnn_pytorch_weights.pth | 0.4M | 0.954 | 0.636 | 0.738 | — | — | — | 0.750 | -8.438 | 8.673 | — | 0.262 | 0.292 | 2433 | 0 |
| adtof_drumsep | separated(bs_roformer_musdb) | adtof_frame_rnn_pytorch_weights.pth+aufr33-jarredou_DrumSep_model_mdx23c_ep_141_sdr_10.8059.ckpt | 109.8M | 0.954 | 0.636 | 0.738 | 0.952 | 0.635 | 0.737 | 0.750 | -8.459 | 8.695 | — | 3.862 | 1.168 | 2903 | 0 |
| idm | separated(bs_roformer_musdb) | idm-44-train-kits | 0.5M | 0.853 | 0.685 | 0.754 | 0.832 | 0.668 | 0.736 | 0.818 | -0.453 | 3.999 | — | 0.133 | 5.844 | — | 0 |
| idm | separated(bs_roformer_sw) | idm-44-train-kits | 0.5M | 0.851 | 0.670 | 0.745 | 0.829 | 0.652 | 0.726 | 0.828 | -0.371 | 3.880 | — | 0.132 | 5.669 | — | 0 |
| adtof | mixture | adtof_frame_rnn_pytorch_weights.pth | 0.4M | 0.921 | 0.562 | 0.677 | — | — | — | 0.762 | -5.026 | 7.524 | — | 0.265 | 0.286 | 1433 | 0 |
| adtof_drumsep | mixture | adtof_frame_rnn_pytorch_weights.pth+aufr33-jarredou_DrumSep_model_mdx23c_ep_141_sdr_10.8059.ckpt | 109.8M | 0.921 | 0.562 | 0.677 | 0.905 | 0.552 | 0.666 | 0.762 | -5.026 | 7.418 | — | 3.676 | 1.749 | 2573 | 0 |
| yourmt3 | separated(bs_roformer_sw) | mimbres/YourMT3/mc13_256_g4_all_v7_mt3f_sqr_rms_moe_wf4_n8k2_silu_rope_rp_b36_nops@last.ckpt | 47.1M | 0.952 | 0.511 | 0.656 | 0.928 | 0.498 | 0.640 | 0.710 | -4.759 | 6.447 | — | 2.743 | 19.584 | — | 59 |
| adt_str_tau08 | drums | Pierfrancesco/adt-str/setting-tau-0.8 | 69.0M | 0.861 | 0.534 | 0.648 | 0.841 | 0.522 | 0.632 | 0.743 | -5.755 | 7.506 | 0.402 | 7.157 | 5.331 | — | 39 |
| omnizart | drums | omnizart-drum-default | — | 0.675 | 0.581 | 0.580 | — | — | — | 0.782 | -9.887 | 11.646 | — | 17.444 | 6.635 | — | 0 |
| omnizart | separated(bs_roformer_musdb) | omnizart-drum-default | — | 0.721 | 0.544 | 0.574 | — | — | — | 0.734 | -10.569 | 11.984 | — | 17.107 | 7.113 | — | 0 |
| yourmt3 | separated(bs_roformer_musdb) | mimbres/YourMT3/mc13_256_g4_all_v7_mt3f_sqr_rms_moe_wf4_n8k2_silu_rope_rp_b36_nops@last.ckpt | 47.1M | 0.938 | 0.493 | 0.642 | 0.895 | 0.471 | 0.614 | 0.678 | -3.088 | 6.097 | — | 2.931 | 19.289 | — | 63 |
| omnizart | separated(bs_roformer_sw) | omnizart-drum-default | — | 0.716 | 0.541 | 0.575 | — | — | — | 0.753 | -10.293 | 11.843 | — | 17.389 | 6.683 | — | 0 |
| adt_str_tau08 | separated(bs_roformer_sw) | Pierfrancesco/adt-str/setting-tau-0.8 | 69.0M | 0.871 | 0.494 | 0.614 | 0.847 | 0.481 | 0.597 | 0.683 | -7.884 | 8.516 | 0.317 | 7.202 | 5.415 | — | 43 |
| adt_str_tau08 | separated(bs_roformer_musdb) | Pierfrancesco/adt-str/setting-tau-0.8 | 69.0M | 0.854 | 0.492 | 0.609 | 0.834 | 0.480 | 0.594 | 0.700 | -7.719 | 9.079 | 0.320 | 7.387 | 5.388 | — | 38 |
| omnizart | mixture | omnizart-drum-default | — | 0.637 | 0.539 | 0.543 | — | — | — | 0.704 | -4.753 | 10.641 | — | 17.287 | 6.561 | — | 0 |
| yourmt3 | mixture | mimbres/YourMT3/mc13_256_g4_all_v7_mt3f_sqr_rms_moe_wf4_n8k2_silu_rope_rp_b36_nops@last.ckpt | 47.1M | 0.736 | 0.464 | 0.548 | 0.719 | 0.454 | 0.537 | 0.722 | -1.663 | 7.130 | — | 12.105 | 20.162 | — | 53 |
| idm | mixture | idm-44-train-kits | 0.5M | 0.603 | 0.430 | 0.491 | 0.595 | 0.424 | 0.485 | 0.663 | 1.381 | 5.350 | — | 0.137 | 5.683 | — | 0 |
| adt_str_tau08 | mixture | Pierfrancesco/adt-str/setting-tau-0.8 | 69.0M | 0.406 | 0.360 | 0.343 | 0.384 | 0.341 | 0.328 | 0.596 | -10.413 | 13.691 | 0.033 | 19.226 | 5.391 | — | 688 |

### synth_v1 패드별 F1 (±50ms)

| 모델 | 입력 | CRASH | FLOOR_TOM | HIHAT | HI_TOM | KICK | MID_TOM | RIDE | SNARE |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| adt_str_tau08 | drums | 0.000 | 0.238 | 0.607 | 0.000 | 0.814 | 0.324 | 0.015 | 0.712 |
| adt_str_tau08 | mixture | 0.019 | 0.144 | 0.465 | 0.000 | 0.529 | 0.082 | 0.036 | 0.484 |
| adt_str_tau08 | separated(bs_roformer_musdb) | 0.000 | 0.206 | 0.583 | 0.061 | 0.812 | 0.286 | 0.015 | 0.662 |
| adt_str_tau08 | separated(bs_roformer_sw) | 0.000 | 0.240 | 0.595 | 0.000 | 0.795 | 0.432 | 0.045 | 0.657 |
| adtof_drumsep | drums | 0.815 | 0.817 | 0.840 | 0.759 | 0.852 | 0.941 | 0.957 | 0.772 |
| adtof_drumsep | mixture | 0.051 | 0.172 | 0.802 | 0.627 | 0.687 | 0.848 | 0.720 | 0.614 |
| adtof_drumsep | separated(bs_roformer_musdb) | 0.421 | 0.630 | 0.815 | 0.727 | 0.776 | 0.909 | 0.906 | 0.682 |
| adtof_drumsep | separated(bs_roformer_sw) | 0.571 | 0.773 | 0.824 | 0.714 | 0.774 | 0.970 | 0.935 | 0.698 |
| idm | drums | 0.476 | 0.462 | 0.857 | 0.393 | 0.850 | 0.000 | 0.661 | 0.763 |
| idm | mixture | 0.359 | 0.148 | 0.678 | 0.077 | 0.345 | 0.047 | 0.295 | 0.497 |
| idm | separated(bs_roformer_musdb) | 0.211 | 0.471 | 0.845 | 0.342 | 0.833 | 0.000 | 0.556 | 0.674 |
| idm | separated(bs_roformer_sw) | 0.273 | 0.515 | 0.841 | 0.318 | 0.782 | 0.000 | 0.471 | 0.692 |
| yourmt3 | drums | 0.571 | 0.407 | 0.710 | 0.481 | 0.848 | 0.188 | 0.837 | 0.858 |
| yourmt3 | mixture | 0.320 | 0.337 | 0.469 | 0.053 | 0.694 | 0.275 | 0.618 | 0.589 |
| yourmt3 | separated(bs_roformer_musdb) | 0.250 | 0.451 | 0.465 | 0.185 | 0.749 | 0.175 | 0.706 | 0.709 |
| yourmt3 | separated(bs_roformer_sw) | 0.414 | 0.503 | 0.533 | 0.577 | 0.744 | 0.364 | 0.750 | 0.708 |

### synth_v1 5가지별 F1 (±50ms)

| 모델 | 입력 | cymbal | hihat | kick | snare | tom |
| --- | --- | --- | --- | --- | --- | --- |
| adt_str_tau08 | drums | 0.013 | 0.607 | 0.814 | 0.712 | 0.440 |
| adt_str_tau08 | mixture | 0.108 | 0.465 | 0.529 | 0.484 | 0.175 |
| adt_str_tau08 | separated(bs_roformer_musdb) | 0.025 | 0.583 | 0.812 | 0.662 | 0.343 |
| adt_str_tau08 | separated(bs_roformer_sw) | 0.112 | 0.595 | 0.795 | 0.657 | 0.407 |
| adtof | drums | 0.957 | 0.840 | 0.852 | 0.772 | 0.851 |
| adtof | mixture | 0.793 | 0.802 | 0.687 | 0.614 | 0.391 |
| adtof | separated(bs_roformer_musdb) | 0.886 | 0.815 | 0.776 | 0.682 | 0.687 |
| adtof | separated(bs_roformer_sw) | 0.914 | 0.824 | 0.774 | 0.698 | 0.796 |
| adtof_drumsep | drums | 0.957 | 0.840 | 0.852 | 0.772 | 0.851 |
| adtof_drumsep | mixture | 0.793 | 0.802 | 0.687 | 0.614 | 0.391 |
| adtof_drumsep | separated(bs_roformer_musdb) | 0.886 | 0.815 | 0.776 | 0.682 | 0.687 |
| adtof_drumsep | separated(bs_roformer_sw) | 0.914 | 0.824 | 0.774 | 0.698 | 0.796 |
| idm | drums | 0.662 | 0.857 | 0.850 | 0.763 | 0.761 |
| idm | mixture | 0.334 | 0.678 | 0.345 | 0.497 | 0.166 |
| idm | separated(bs_roformer_musdb) | 0.554 | 0.845 | 0.833 | 0.674 | 0.614 |
| idm | separated(bs_roformer_sw) | 0.469 | 0.841 | 0.782 | 0.692 | 0.649 |
| omnizart | drums | 0.000 | 0.681 | 0.755 | 0.583 | 0.000 |
| omnizart | mixture | 0.000 | 0.663 | 0.639 | 0.556 | 0.000 |
| omnizart | separated(bs_roformer_musdb) | 0.000 | 0.718 | 0.733 | 0.532 | 0.000 |
| omnizart | separated(bs_roformer_sw) | 0.000 | 0.720 | 0.713 | 0.533 | 0.000 |
| yourmt3 | drums | 0.839 | 0.710 | 0.848 | 0.858 | 0.908 |
| yourmt3 | mixture | 0.641 | 0.469 | 0.694 | 0.589 | 0.423 |
| yourmt3 | separated(bs_roformer_musdb) | 0.697 | 0.465 | 0.749 | 0.709 | 0.704 |
| yourmt3 | separated(bs_roformer_sw) | 0.751 | 0.533 | 0.744 | 0.708 | 0.691 |
