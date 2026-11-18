# 곡 추천 R3 PoC: 입력 데이터와 분할

그래프 임베딩(R3)이 인기·규칙·비슷한 곡(R1·R2)보다 다음에 칠 곡을 더 잘 맞히는지 **오프라인으로** 확인하는 실험이다.
운영 API·DB 접속·모델 서빙은 하지 않는다. 설계와 판단 기준은 개인 설계 문서(`CHART-COACH-곡추천-설계.md` 부록 B)에 있다.

코드: `src/ssaplash_ai/recommend/` — `schema.py`(파일·열·값 목록), `data.py`(로더, 시간순 분할). 시험: `tests/recommend/`.

## 데이터 출처 단계

| 단계 | 데이터 | 조건 |
| --- | --- | --- |
| `P0` | 합성 데이터 | 실제 사용자 정보를 쓰지 않는다 |
| `P1` | 팀 내부·시험 계정의 연주 기록 | 계정 본인이 추천 학습 시험에 동의한 경우만. 파일은 git에 넣지 않고 GPU 서버 디렉터리에만 두며 PoC가 끝나면 지운다 |
| `P2` | 일반 사용자 기록 | **동의 범위가 정해진 뒤에만.** 로더가 승인 근거(`p2_approval`) 없이는 읽지 않는다 |

`load_dataset(폴더, 단계)`는 단계를 꼭 지정하게 한다. 단계는 MLflow 기록에 함께 남긴다.

## 입력 파일 (폴더에 CSV, UTF-8, 첫 줄은 열 이름)

JSON 열은 JSON 문자열로 쓰고, 목록 열은 `;`로 구분한다. 불리언은 `true/false`, 시각은 ISO 8601(`2026-10-01T10:00:00Z`).

| 파일 | 필수 | 열 |
| --- | --- | --- |
| `users.csv` | 필수 | `user_key`, `consent_recommendation`, `consent_version` |
| `songs.csv` | 필수 | `song_id`, `bpm`, `duration_ms`, `song_level`, `public` |
| `chart_features.csv` | 필수 | `chart_id`, `song_id`, `difficulty`, `avg_notes_per_sec`, `peak_notes_2s`, `pad_ratio`, `transition_ratio`, `rhythm_grid` |
| `interactions.csv` | 필수 | `user_key`, `song_id`, `chart_id`, `played_at`, `accuracy`(0~100), `completed`, `mode`(`RHYTHM`·`SHEET`) |
| `exposures.csv` | 선택 | `user_key`, `song_id`, `chart_id`, `shown_at`, `clicked`, `context`(`SONG_PICKER`·`REPORT`·`SIMILAR`), `strategy` |
| `song_meta.csv` | 선택 | `song_id` + 선택 열 `genre`, `sub_genres`(≤2), `mood`(≤2), `energy`(1~5), `language`, `drum_style`(≤3). 값 목록은 `schema.py`. 모르면 비운다(`energy`는 읽으면 `NaN`) |
| `weak_summary.csv` | 선택 | `user_key`, `pattern`, `pad`, `count`(≥1), `avg_severity`(0~1) |

`chart_features`는 BE가 이미 계산해 저장한 값(`chart_features` 테이블)이다. `rhythm_grid`는 `{"groups": …}` 또는 제외된 채보의 `{"excluded": "…"}` 형태다.

## 로더가 항상 멈추는 경우

조용히 고치지 않고 `DataError`로 멈춘다.

- 어느 파일에든 개인을 가리킬 수 있는 열(`email`, `nickname`, `user_id`, `account_id`, `ip` 등)이 있을 때. 스키마에 없는 열도 거부한다.
- `users.csv`에 **추천 학습에 동의하지 않은 사용자**(`consent_recommendation`이 true가 아님)가 있을 때. 내보내기에서 동의한 사용자만 넣어야 한다.
- `songs.csv`에 공개되지 않은 곡(`public`이 true가 아님)이 있을 때.
- 가명 키(`user_key`)가 영문·숫자·`_`·`-` 8~64자가 아니거나 숫자만일 때(원래 계정 번호일 수 있다).
- 참조가 맞지 않을 때: 없는 사용자·곡·채보, 채보가 다른 곡의 것, 중복된 id, 완전히 같은 연주 행, 범위 밖의 값(정확도 101 등).
- `P2`를 승인 근거 없이 지정했을 때.

## 시간순 분할 `temporal_split`

시각 하나(`cutoff`, 기본은 연주 시각의 80% 지점)로 전체를 나눈다. 미래 정보가 학습으로 새지 않는 "다음 연주 맞히기" 설정이다.

- **학습:** `played_at < cutoff`인 모든 연주.
- **시험 목표:** 학습 구간에 연주가 있는 사용자마다 `cutoff` 이후의 **첫 연주 하나**.
- **`warm_test`:** 목표 곡이 학습 구간에도 있던 곡. **`cold_test`:** 학습 구간에 한 번도 나오지 않은 새 곡.
- `repeat` 열: 그 사용자가 학습 구간에서 이미 친 곡이 목표인지. 평가에서 제외할지 정한다.
- 입력 행의 순서가 달라도 결과가 같다(시각 순, 같으면 원래 순서).

## 합성 데이터 생성기 `simulate.py`

실데이터가 충분해지기 전에 파이프라인과 평가 하니스가 맞게 돌아가는지, 모델이 **심어 둔 취향을 되찾는지** 확인하는 용도다.
**여기서 나온 점수는 모델의 실제 성능이 아니다.** 하니스 검증과 회귀 방지에만 쓰고, 실제 성능은 `P1` 이후 데이터로만 말한다.

```python
from ssaplash_ai.recommend.simulate import SimConfig, generate

data = generate(SimConfig(seed=0))  # 곡 300, 사용자 2,000, 약 5만 연주. 약 4초
data.write("data/recommend/synthetic")  # 위 입력 파일 규격의 CSV 폴더. 로더가 그대로 읽는다
```

- **곡:** 장르 원형(ROCK·POP·JAZZ·FUNK·METAL·ELECTRONIC)의 패드 구성·리듬 격자·밀도·BPM에 무작위를 더한 가상 곡. 앞의 3곡은 연습 패턴(`PRACTICE`)을 흉내 낸 값이며 실제 MIDI에서 계산한 특징이 아니다. 5%는 가변 템포(`excluded`), 곡마다 EASY·HARD가 없을 수 있다(NORMAL은 항상 있다). 곡 난이도는 BE의 규칙(`song-level-1`)과 같은 기준.
- **사용자:** 숨은 실력(감당하는 노트 밀도)과 장르 취향을 가진다. 연주는 장르 취향, 실력 적합도(기준 밀도의 약 1.15배가 가장 알맞음), 곡 인기에 따라 뽑고 12%는 이미 친 곡을 다시 친다. 너무 어려우면 정확도가 떨어지고 완주하지 않는다.
- **새 곡:** 연주 시각 분포의 80~95% 분위수에서야 열리는 곡이 10%. 시간순 분할(기본 80% 지점)보다 뒤라서 항상 `cold_test`가 된다.
- **재현성:** 같은 `SimConfig`(시드 포함)면 모든 표가 같다. 사용자 키(`synth-user-000000`…)·곡 정보는 모두 가짜다.
- **숨은 값:** `data.truth`에 사용자 실력·장르 취향·새 곡 열림 시각·채보 밀도가 있다. 하니스가 "심어 둔 것을 되찾는가"를 확인하는 데만 쓰고 파일로 쓰지 않는다.
- 노출 기록(`exposures`)은 만들지 않는다. R1·R2 노출 평가는 실데이터나 이후 작업에서 다룬다.

## 기준선 M0~M3 (`models/`)

모든 방법이 같은 인터페이스를 따른다(`models/base.py`): `fit(train, data, now=)`로 **학습 구간 연주만** 보고, `rank(user, k, exclude)`로 곡 id 상위 k개를 돌려준다.
후보는 `data.songs`의 모든 공용 곡이며 학습 구간에 없던 새 곡도 포함한다. 점수가 같으면 곡 id 오름차순이라 결과가 결정적이다.
학습 구간에 연주가 없는 사용자는 모든 방법이 인기 순서로 대체한다. `exclude`는 평가 하니스가 정한다(보통 그 사용자가 이미 친 곡, `Split`의 `repeat` 열과 함께 쓴다).

| 방법 | 클래스 | 하는 일 | 새 곡 |
| --- | --- | --- | --- |
| M0 인기 | `Popularity` | 학습 구간 연주 수 순서 | 연주가 0이라 맨 뒤 |
| M1 R1 규칙 | `R1Rules` | 서비스의 규칙 점수(난이도 적합도 0.45, 약점 0.30, 새로움 0.15, 재도전 0.10, 기준 밀도 1.5배 초과 제외)를 본인 학습 구간 기록에 적용 | 채보 특징으로 점수를 받음 |
| M2 R2 최근접 | `SimilarToRecent` | 최근 친 5곡과 채보 유사도(리듬 격자·패드·전환·밀도·템포)가 높은 곡. 최근일수록 0.8배씩 덜 반영 | 채보 특징으로 점수를 받음 |
| M3 동시 연주 | `CoPlay` | 같은 사용자가 함께 친 곡 쌍의 코사인(item-item). 이력 규칙은 M2와 같음 | 동시 연주가 없어 0점 |

`r1.py`와 `similarity.py`는 서비스(BE `RecommendationScorer`·`SimilarityEngine`)를 파이썬으로 옮긴 것이다. 계수가 같고 BE의 단위 테스트와 같은 시나리오로 `tests/recommend/test_r1_port.py`·`test_similarity.py`가 확인한다. **계수를 바꿀 때는 BE와 함께 바꾼다.** 오프라인에서 서비스와 다른 점(근사)은 다음과 같다.

- **약점:** 서비스는 리포트의 약점 구간을 쓰지만 PoC 입력에는 구간이 없다. 학습 구간 연주 중 정확도 75 미만인 최근 5판의 패드 비율로 약한 패드를 근사한다. `weak_summary.csv`는 시간 정보가 없어 미래 정보가 섞이므로 M1에는 쓰지 않는다.
- **채보 노트 수:** 입력에 없어 "NORMAL과 노트 수가 같은 채보 제외"는 적용하지 않는다.
- **박자표·최소 유사도·메타데이터 보조:** 박자표 감점, 유사도 0.5 미만 제외, 메타데이터 15% 보조는 쓰지 않는다(순위만 필요하고 채보 유사도만 평가한다).
- **M1의 빈자리:** 기준 밀도의 1.5배를 넘는 곡을 빼면 k개가 안 찰 수 있다. 이때 남는 자리는 인기 순서로 채운다. 채운 만큼은 규칙이 아니라 인기의 성능이다.

합성 데이터(`SimConfig(seed=0, n_songs=300, n_users=1000)`)에서 눈으로 본 값(무작위 Recall@10 ≈ 0.033): M0 0.087, M1 0.062, M2 0.119, M3 0.150. 새 곡 시험은 M2 0.121, M1 0.061, M0·M3은 0. **하니스가 도는지 보는 값이며 실제 성능이 아니다.** 정식 평가(Recall·NDCG·커버리지·안전성)는 작업 4의 평가 하니스가 맡는다.

## 그래프와 LightGCN (M5)

`graph.py`가 사용자-곡 이분 그래프에 곡 특징 노드를 더한 이종 그래프를 만들고, `models/lightgcn.py`가 LightGCN(He et al., 2020)을 학습한다.

- **구현:** PyTorch 없이 numpy와 scipy.sparse만 쓴다. LightGCN은 비선형과 특징 변환이 없어 최종 임베딩이 초기 임베딩의 선형 함수(`E = P·E0`)이므로 BPR 손실의 기울기를 손으로 정확히 쓸 수 있다. 새 의존성이 없고 CI에서도 시험이 돈다. **손으로 쓴 기울기는 수치 미분과 맞는지 시험이 직접 확인한다.**
- **연결 가중치:** 사용자-곡은 1에 완주 +0.5, 정확도 85 이상 +0.5, 다시 칠 때마다 +0.25(최대 +0.5)를 더해 최대 2.5(반복 횟수만으로 커지지 않게 상한). 곡-특징은 묶음(패드 구성, 패드 전환, 리듬 격자 군집, 노트 밀도 구간, 곡 난이도, BPM 구간)마다 합이 `feature_weight`가 되게 나눈다.
- **변형:** `M5` 특징 없음 / `M5F` 곡 특징 노드(`chart`) / `M5FM` +메타데이터(`chart+meta`: 장르·분위기·드럼 스타일·에너지·언어). 메타데이터가 정답 라벨 역할을 겸할 수 있어 따로 비교한다.
- **음성 표본은 학습 구간에 연주가 있는 곡에서만** 뽑는다. 한 번도 연주되지 않은 새 곡을 음성으로 뽑으면 새 곡을 일부러 밀어낸다.
- **새 곡 크기 보정(`cold_norm`):** 특징 노드를 통해서만 임베딩을 받는 새 곡은 임베딩 크기가 연주 기록이 있는 곡보다 작아 내적 점수에서 항상 밀린다(이웃 평균과 차수 정규화 탓. 보정 전 새 곡 Recall@10은 0이었다). 방향은 그대로 두고 크기만 학습된 곡의 평균에 맞춘다. 특징이 없는 변형에는 쓰지 않는다(그 곡의 임베딩은 학습되지 않은 무작위 값).
- 사용자 임베딩은 메모리에만 있고 파일로 저장하지 않는다.

기본값(`dim=32`, `layers=3`, `epochs=40`, `lr=0.02`, `reg=3e-3`, `feature_weight=4`)은 합성 데이터의 **검증 구간**에서 골랐다. 실데이터에서는 다시 골라야 한다.

### 하이퍼파라미터는 검증 구간으로 고른다 (`tuning.py`)

시험 구간을 보고 값을 고르면 누수다. `tune(build, candidates, train, data)`는 **학습 구간 안에서 다시 시간순으로 나눈 검증 구간**의 Recall@k로 설정을 고르고, 시험 구간은 고른 뒤 한 번만 본다.
이 규칙이 필요했던 실제 사례: 처음 `reg=1e-4`로는 학습을 오래 하거나 차원을 키울수록 손실은 줄지만 맞히는 성능이 떨어졌다(과적합). 검증 구간에서 `reg=3e-3`을 골랐더니 시험 구간 warm Recall@10이 0.148에서 0.201로 올라 동시 연주(0.173)를 넘었다.

### 순위 안정성 (민감도)

`ranking_stability(a, b, users, k)`는 시드·차원·가중치만 다른 두 설정의 상위 k 목록이 얼마나 같은지(사용자별 겹침 자카드와 공통 곡의 스피어만 상관)를 준다.

## Node2Vec (M4, `models/node2vec.py`)

LightGCN과 같은 그래프(`M4` 특징 없음 / `M4F` 곡 특징 노드 / `M4FM` +메타데이터) 위에서 편향 랜덤 워크와 스킵그램(음성 표본)으로 임베딩을 배운다. 역시 numpy·scipy.sparse로 직접 구현했다.

- **랜덤 워크:** 연결 가중치에 비례해 이웃을 뽑고, `p`(되돌아감)·`q`(바깥으로)가 1이 아니면 2차 편향을 거절 표집으로 적용한다. 걷는 이를 모두 벡터로 한 번에 움직인다. 되돌아감 비율이 `p`에 따라 맞게 변하는지, 연결 가중치 1:3이 표집 빈도 0.25:0.75로 나오는지를 통계적으로 시험한다.
- **학습:** 스킵그램 음성 표본 손실의 기울기를 손으로 쓰고 수치 미분으로 확인한다. 같은 노드의 기울기는 배치 안에서 평균을 내 Adam으로 갱신한다.
- **점수:** 사용자와 곡 임베딩의 **코사인 유사도**. 크기에 영향을 받지 않아 특징 노드로만 이어진 새 곡도 그대로 비교된다(LightGCN은 이 때문에 `cold_norm` 보정이 필요했다). 연결이 없는 곡은 학습되지 않아 점수 0이다.
- **느리다:** 사용자 2,000명·곡 300곡에서 한 번 학습에 약 25~45초(LightGCN은 약 7초). 하이퍼파라미터 후보 6개를 검증하는 데 약 5~6분이 걸렸다.

**하이퍼파라미터 선택 결과(검증 구간, 합성 데이터).** 6개 후보(`epochs=6`, `dim=64`, `q=0.5`, `window=5`, 걷기 길이·횟수 늘리기)를 비교했으나 개선은 작았고 변형마다 달랐다. 특징 없음은 `q=0.5`(0.102 → 0.126), 특징 있음은 `window=5`(0.098 → 0.101)가 최선이었다. 특히 특징 있는 변형을 warm 기준으로 고르면 시험의 새 곡 Recall이 0.24에서 0.12로 **오히려 떨어졌다**(검증 기준이 warm Recall뿐이라). 변형마다 기본값을 따로 두는 것은 비교를 어지럽히므로 **기본값(p=q=1, window=3)을 그대로 두고** 이 결과는 민감도로만 기록한다.

### 전체 비교 (합성 데이터, 사용자 2,000명, k=10, 시드 0 — 실제 성능이 아님)

| 방법 | warm Recall | warm NDCG | 새 곡 Recall | 커버리지 | 새 곡 비중 | 위반율 |
| --- | --- | --- | --- | --- | --- | --- |
| M0 인기 | 0.086 | 0.041 | 0 | 0.06 | 0 | 5.3% |
| M1 R1 규칙 | 0.055 | 0.024 | 0.12 | 1.00 | 12.8% | 0% |
| M2 최근접 | 0.084 | 0.039 | 0.08 | 0.91 | 8.1% | 1.5% |
| M3 동시 연주 | 0.173 | 0.085 | 0 | 0.75 | 0 | 3.9% |
| M4 Node2Vec | 0.133 | 0.061 | 0 | 0.90 | 0 | 4.5% |
| M4F Node2Vec+특징 | 0.094 | 0.040 | **0.24** | 1.00 | 21.2% | 3.9% |
| M4FM Node2Vec+메타 | 0.094 | 0.042 | 0.20 | 1.00 | 15.7% | 3.9% |
| M5 LightGCN | **0.201** | **0.101** | 0 | 0.75 | 0 | 2.5% |
| M5FM LightGCN+메타 | 0.191 | 0.098 | 0.10 | 0.79 | 4.9% | 2.6% |
| M6FM 재정렬(LightGCN+메타) | 0.196 | 0.100 | 0.08 | 0.82 | 4.9% | **0%** |

- **LightGCN이 Node2Vec보다 warm에서 일관되게 낫다**(0.20 대 0.13). 사용자-곡 연주 기록을 직접 학습하는 방식이 랜덤 워크로 간접 학습하는 것보다 유리했다.
- **Node2Vec은 새 곡에서 가장 좋다**(특징 변형 0.20~0.24, M2 0.08). 코사인 점수가 크기 편향 없이 특징으로 새 곡을 올린다. 대신 인기·연주 빈도 정보를 쓰지 않아 warm은 낮다(0.094). **warm과 새 곡 사이의 상충**이고, 새 곡 시험은 50건 안팎이라 값이 흔들린다.
- 진입 판단에서 Node2Vec 변형은 warm에서 탈락한다(가장 좋은 기준선 M3 대비 −51~−53%). 이 데이터에서는 LightGCN 계열(M6FM)이 후보다. 그러나 합성 데이터 결과라 진입을 결정하지 않는다.
- 두 방법을 섞어(예: Node2Vec으로 새 곡 후보를 일부 채우고 LightGCN으로 나머지를 채우는 슬롯 방식) 쓰는 것이 자연스러운 다음 실험이지만 이번 PoC 범위 밖이다.

## 후보 + 규칙 재정렬 (M6, `models/rerank.py`)

후보 생성(LightGCN)은 "무엇을 좋아할지"는 맞혀도 "지금 칠 수 있는 난이도인지"는 모른다(합성에서 하드 제외 위반율 2~5%). `Reranked(생성기)`는 생성기의 상위 후보(기본 50)를 R1 규칙으로 걸러 다시 세운다.

- **하드 제외:** 사용자의 기준 밀도(최근 85% 이상 연주의 최대 밀도)의 1.5배를 넘는 채보만 있는 곡은 후보 점수와 무관하게 뺀다. 서비스 R1과 같은 규칙이라 평가의 위반율은 0이다.
- **재정렬 점수:** `(1 - w) · R1 점수 + w · 후보 순위 점수`(후보 순위 점수는 후보 목록의 순위로 정한 0~1 값). 기본 `w = 0.75`는 합성 데이터의 **검증 구간**에서 골랐다.
- **`w = 0`(규칙 점수만으로 순서)은 맞히는 성능을 크게 떨어뜨렸다**: 합성에서 warm Recall@10 0.191 → 0.109. 설계의 "R3는 후보만 만들고 최종 순서는 규칙 점수"는 이 데이터에서 맞지 않았고, 이득은 대부분 **하드 제외 필터**에서 왔다(`w = 1`, 즉 순서는 후보 그대로 두고 필터만 해도 0.195, `w = 0.75`는 0.196).
- 기준 밀도를 모르는 사용자(연주가 적거나 85% 이상이 없음)는 거를 근거가 없어 후보 순서를 그대로 쓴다.
- 안전한 후보가 k개보다 적으면 후보 풀을 전체 곡까지 넓히고, 그래도 모자라면 **위험한 곡으로 채우지 않고 모자란 대로** 돌려준다.
- 방법 이름은 `M6`(특징 없음), `M6F`(곡 특징 노드), `M6FM`(+메타데이터)이다.

### 합성 데이터 진입 판단 (3개 시드, 사용자 2,000명, 새 곡 시험 50건 안팎)

| 시드 | M3(가장 좋은 기준선) warm NDCG | M6FM warm NDCG | 상대 개선 [95% 구간] | 새 곡 Recall M6FM / M2 | 위반율 | 판정 |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 0.085 | 0.100 | +17.6% [+5.6, +31.1] | 0.08 / 0.08 | 0 | 통과 |
| 1 | 0.074 | 0.099 | +32.8% [+19.9, +49.2] | 0.11 / 0.11 | 0 | 통과 |
| 2 | 0.084 | 0.089 | +6.7% [−4.2, +20.3] | 0.08 / 0.08 | 0 | **탈락**(개선 구간이 0을 포함) |

- **위반율 0은 모든 시드·모든 변형에서 지켜졌다.** 재정렬의 핵심 목적은 달성됐다.
- 메타데이터가 없는 변형(`M6`, `M6F`)은 모든 시드에서 새 곡 기준(M2 이상)에서 탈락했다. `M6`는 새 곡을 아예 못 올린다.
- **결과가 안정적이지 않다.** 시드에 따라 warm 개선이 +2%에서 +39%까지 움직이고, 새 곡 기준은 시험 50건 중 4~6건의 차이로 갈린다(M6FM이 M2와 같은 값으로 "이상"을 간신히 만족). **이 표로 R3 진입을 결정하지 않는다.** 합성 데이터의 점수는 실제 성능이 아니며, 실데이터에서 같은 하니스를 돌려야 한다.
- 새 곡 기준(`cold_reference` M2 이상)은 시험 건수가 적어 잡음이 크다. 진입 판단 수치(설계 U21)를 확정할 때 새 곡 시험의 최소 건수와 신뢰구간 기준을 함께 정하는 것이 좋다.

## 평가 하니스 `evaluate.py`

모든 방법을 같은 분할·같은 사용자·같은 규칙으로 평가한다. 지표는 사용자 단위로 계산하고 사용자를 다시 뽑는 부트스트랩(시드 고정)으로 95% 신뢰구간(`*_ci_low`, `*_ci_high`)을 낸다.
같은 입력·같은 시드면 결과가 같다(`Report.digest()`).

| 지표 | 의미 |
| --- | --- |
| `recall_warm`, `ndcg_warm` | 목표 곡이 학습 구간에 있던 곡일 때의 적중률과 NDCG@k(목표가 하나라 Recall은 적중률과 같음) |
| `recall_cold`, `ndcg_cold` | 목표 곡이 학습 구간에 한 번도 없던 새 곡일 때. 연주 기록만 쓰는 방법은 0이 된다 |
| `coverage` | 추천에 한 번이라도 나온 곡 비율 |
| `cold_item_share` | 추천 항목 중 새 곡의 비중 |
| `violation_rate` | 추천 곡 중, 그 사용자의 기준 밀도(최근 85% 이상 연주의 최대 밀도)의 1.5배를 넘는 곡(곡의 가장 쉬운 채보도 넘는 경우)의 비율. 기준 밀도가 없는 사용자는 제외 |
| `diversity_levels`, `diversity_genres` | 목록 안의 곡 난이도·장르 종류 수 평균(장르는 `song_meta`가 있을 때만) |

- 사용자가 학습 구간에서 이미 친 곡은 순위에서 뺀다. 그래서 `repeat` 목표는 맞힐 수 없어 기본으로 평가에서 제외한다(`EvalConfig.exclude_repeat_targets`).
- `compare(report, a, b)`는 같은 사용자에 대한 짝 비교로 a가 b보다 상대적으로 얼마나 높은지와 신뢰구간을 준다.
- `entry_gate(report, 후보, 기준선들, cold_reference=…)`는 진입 판단(설계 B.7)을 근거 값과 함께 돌려준다: warm NDCG가 가장 좋은 기준선보다 상대 +10% 이상(신뢰구간 하한 > 0), cold Recall이 기준 방법 이상, 하드 제외 위반율 1% 이하. 수치는 가정값(`GateConfig`)이며 첫 결과를 본 뒤 확정한다. 재현성은 `digest`로 따로 확인한다.
- 보고서 요약(`Report.to_dict`)과 MLflow에는 집계 값만 담는다. 사용자 키·연주 같은 개인 단위 값은 어디에도 기록하지 않는다.

### 실행

```
cd AI
uv run python scripts/run_recommend_poc.py --synthetic --stage P0 --out runs/recommend/p0
uv run python scripts/run_recommend_poc.py --data data/recommend/internal --stage P1 --mlflow
```

`--stage`는 필수다(P0 합성, P1 내부 동의 계정, P2 일반 사용자). 합성은 P0로만 쓸 수 있고, P2는 `--p2-approval`에 동의 범위 승인 근거를 적어야 한다.
`--mlflow`는 실험 `song-recommend`에 방법마다 run을 남긴다(시드·데이터 해시·코드 커밋·출처 단계·하이퍼파라미터). `MLFLOW_TRACKING_URI` 또는 `--tracking-uri`로 기록할 곳을 정한다.
오류(데이터 규격 위반, 단계 규칙 위반, 알 수 없는 방법)는 종료 코드 2다.

## 일반 사용자 데이터(P2) 평가

일반 사용자 데이터는 파일로 두지 않는다. `--from-views`로 BE 읽기 뷰에서 메모리로 읽고, 결과는 집계 값만 남긴다. `--data`로 P2를 쓰면 멈춘다.

```bash
docker compose -p infra run --rm --entrypoint python recommend-batch -m ssaplash_ai.recommend.run --from-views --stage P2 --p2-approval <근거> --models M0,M1,M2,M3,M5FM,M6FM --mlflow
```

## 실데이터(P1) 실행 준비 (작업 8)

실데이터 실행에 필요한 것은 ① 입력 CSV(BE 내보내기), ② 곡 메타데이터 변환, ③ 보고서다. ②와 ③은 이 저장소에 준비되어 있고, ①은 BE가 만들어야 한다. **음원은 필요 없다.** 추천은 채보에서 BE가 이미 계산한 특징만 쓴다.

### ① BE 내보내기 명세 (입력 CSV 4개 + 곡 목록)

| 파일 | 열 | 출처와 규칙 |
| --- | --- | --- |
| `users.csv` | `user_key`, `consent_recommendation`, `consent_version` | 추천 학습에 동의한 사용자만. `user_key`는 `user_id`를 비밀 값으로 해시한 가명(영문·숫자 8~64자, 숫자만이면 로더가 거부). 비밀 값은 저장소 밖에 둔다 |
| `songs.csv` | `song_id`, `bpm`, `duration_ms`, `song_level`, `public` | 공개된 공용 곡(BUILTIN, READY, published, 곡 난이도 산정 완료, 미삭제)만 |
| `chart_features.csv` | `chart_id`, `song_id`, `difficulty`, `avg_notes_per_sec`, `peak_notes_2s`, `pad_ratio`, `transition_ratio`, `rhythm_grid` | 채보별 최신 버전의 `chart_features`. JSON 열은 JSON 문자열. `chart_id`는 `charts.id`(채보 버전 id가 아님) |
| `interactions.csv` | `user_key`, `song_id`, `chart_id`, `played_at`, `accuracy`, `completed`, `mode` | `play_sessions` 중 RHYTHM·SHEET, 위 사용자·곡만 |
| `catalog.csv`(메타데이터 변환용) | `song_id`, `title`, `artist` | `songs`의 곡 목록. 학습 입력이 아니라 곡 맞추기용 |

SQL 초안(PostgreSQL, `:secret`은 저장소 밖의 해시 비밀 값, `:users`는 동의한 사용자 목록 — 추천 동의 기능이 생기기 전 P1에서는 본인이 동의한 내부 계정 id 목록):

```sql
-- songs.csv
SELECT s.id AS song_id, s.bpm, s.duration_ms, s.song_level, true AS public
FROM songs s
WHERE s.source = 'BUILTIN' AND s.owner_id IS NULL AND s.status = 'READY' AND s.published
  AND s.deleted_at IS NULL AND s.song_level IS NOT NULL;

-- chart_features.csv (채보별 최신 버전)
SELECT c.id AS chart_id, c.song_id, c.difficulty, f.avg_notes_per_sec, f.peak_notes_2s,
       f.pad_ratio::text AS pad_ratio, f.transition_ratio::text AS transition_ratio, f.rhythm_grid::text AS rhythm_grid
FROM charts c
JOIN chart_versions v ON v.id = (SELECT x.id FROM chart_versions x WHERE x.chart_id = c.id ORDER BY x.version DESC LIMIT 1)
JOIN chart_features f ON f.chart_version_id = v.id AND f.rhythm_grid IS NOT NULL
WHERE c.song_id IN (SELECT id FROM songs WHERE source = 'BUILTIN' AND owner_id IS NULL AND status = 'READY' AND published AND deleted_at IS NULL AND song_level IS NOT NULL);

-- users.csv
SELECT substr(encode(sha256(convert_to(:secret || ':' || u.id, 'UTF8')), 'hex'), 1, 32) AS user_key,
       true AS consent_recommendation, :consent_version AS consent_version
FROM users u WHERE u.id = ANY(:users) AND u.status = 'ACTIVE';

-- interactions.csv
SELECT substr(encode(sha256(convert_to(:secret || ':' || p.user_id, 'UTF8')), 'hex'), 1, 32) AS user_key,
       p.song_id, c.id AS chart_id, p.ended_at AS played_at, p.accuracy,
       (p.ended_at - p.started_at) >= interval '1 millisecond' * (0.8 * s.duration_ms) AS completed, p.mode
FROM play_sessions p
JOIN chart_versions v ON v.id = p.chart_version_id JOIN charts c ON c.id = v.chart_id
JOIN songs s ON s.id = p.song_id
WHERE p.user_id = ANY(:users) AND p.mode IN ('RHYTHM', 'SHEET') AND p.accuracy IS NOT NULL
  AND s.source = 'BUILTIN' AND s.owner_id IS NULL AND s.status = 'READY' AND s.published AND s.deleted_at IS NULL AND s.song_level IS NOT NULL;
```

BE와 정할 것:
- **"완주(`completed`)"의 정의.** 위 초안은 "연주 시간이 곡 길이의 80% 이상"이다. 서비스에 완주 필드가 없어 제안한 값이다.
- **채보 버전.** 사용자가 예전 버전을 쳤어도 `chart_id`는 채보 단위라 같은 채보로 묶는다. 특징은 최신 버전 것을 쓴다(버전이 바뀌면 약간 어긋날 수 있다).
- **동의.** 추천 학습 동의 기능이 들어가면 `:users`를 그 동의 목록으로 바꾼다. 그 전의 P1은 본인이 시험 사용에 동의한 내부 계정만이다. 내보낸 파일은 git에 넣지 않고 GPU 서버 디렉터리에 두며 PoC가 끝나면 지운다.
- **탈퇴 사용자.** 다음 내보내기에서 자연히 빠진다(`status = 'ACTIVE'`). 이미 만든 파일은 PoC 종료 때 지운다.

### ② 곡 메타데이터 변환 (`meta_import.py`)

원빈의 메타데이터 초안(엑셀용 CSV: BOM, camelCase 열, `title`·`artist`로 곡 지정)을 PoC 입력 `song_meta.csv`(`song_id` 기준, `release_year` 포함)로 바꾼다.

```
cd AI
uv run python scripts/import_song_meta.py --draft 초안.csv --catalog catalog.csv --out data/recommend/p1/song_meta.csv
```

- `(title, artist)`로 곡을 맞춘다. 먼저 글자 그대로, 안 되면 유니코드 정규화·공백·대소문자·따옴표 표기를 무시하고 맞추며 그 수를 센다. 아티스트가 비어 있는 연습 패턴은 제목만으로 맞춘다.
- 곡이 아직 등록되지 않았거나 둘 이상과 맞으면 **그 행만 빼고** 보고서에 남긴다. 곡이 등록된 뒤 다시 돌리면 된다.
- 허용 값 목록을 벗어난 값, `EXTERNAL_DB`인데 이용 조건이 없는 값은 모아서 보고하고 **아무것도 쓰지 않고** 멈춘다. 추측해서 고치지 않는다.
- 현재 초안(34행)은 형식 위반이 없다. 곡 목록에 있는 연습 패턴 3곡만 맞고 실곡 31곡은 아직 등록되지 않아 "곡 없음"이다.
- `release_year`는 연대(`era:2010`) 특징 노드가 된다(`chart+meta` 변형).

### ③ 진입 판단 보고서 (`report.py`)

```
uv run python scripts/run_recommend_poc.py --data data/recommend/p1 --stage P1 --models M0,M1,M2,M3,M5FM,M6FM --report runs/recommend/p1.md
```

권고는 데이터가 충분한지부터 따진다.

| 권고 | 언제 |
| --- | --- |
| 판단하지 않음 | 출처 단계가 P0(합성) |
| 판단 보류 | 일반 시험 목표가 `--min-warm-targets`(기본 500) 미만이거나 새 곡 시험 목표가 `--min-cold-targets`(기본 30) 미만 |
| R3 계속 | 표본이 충분하고 후보가 진입 기준(warm NDCG +10% 이상·신뢰구간 하한 > 0, 새 곡 Recall이 M2 이상, 위반율 1% 이하)을 모두 넘음 |
| R3 중단 권고 | 표본이 충분한데 어떤 후보도 기준을 못 넘음. R1+R2로 간다 |

보고서에는 권고와 이유, 데이터 요약, 방법별 결과(신뢰구간), 후보별 진입 판단표, 해석 주의, 재현 정보(코드 커밋·시드·하이퍼파라미터)가 담기고 집계 값만 있다.
최소 표본 수는 가정값이다(설계 U21). 실데이터의 시험 목표가 이보다 적으면 보고서는 "판단 보류"라고 말한다.

### 지금 상태와 남은 일

- 실데이터 실행은 **BE 내보내기와 충분한 연주 기록이 있어야** 할 수 있다. 현재 공용 곡은 연습 패턴 3개뿐이고 실곡 31곡은 등록 전이다.
- 실데이터가 생기면: BE 내보내기 → `import_song_meta.py` → `run_recommend_poc.py --stage P1 --report` 순서로 돌리고, 시험 구간을 보지 않고 `tuning.tune`으로 하이퍼파라미터를 다시 고른 뒤 보고서를 본다.

## 운영 배치 (`batch.py`, 설계 문서 부록 C)

BE 읽기 뷰에서 입력을 읽어 사용자별 후보를 만들고 BE에 적재한다. 요청 경로에서 BE가 AI를 부르지 않는다. **기능은 꺼진 채로 준비만 되어 있다.** 켜는 조건은 실데이터 보고서, 동의 화면 배포, 동의 문구 확정이다.

```bash
# 합성 입력으로 끝까지 돌린다(적재하지 않음)
uv run python scripts/run_recommend_batch.py --synthetic --stage P0
# 운영: 뷰에서 읽어 적재한다
uv run python scripts/run_recommend_batch.py --from-views --stage P2 --p2-approval <근거> --variant base --upload --mlflow
```

| 구성 | 파일 | 하는 일 |
| --- | --- | --- |
| 입력 | `source.py` | `recommend_users_v`, `recommend_songs_v`, `recommend_chart_features_v`, `recommend_interactions_v`를 한 스냅숏으로 읽는다. `recommend_song_meta_v`는 있으면 읽는다. 허용 밖의 열이 있으면 행을 읽지 않는다. 파일로 남기지 않는다 |
| 검증 | `data.dataset_from_frames` | CSV 입력과 같은 규칙으로 검증한다. 어긋나면 적재 없이 멈춘다 |
| 후보 | `batch.generate_candidates` | 전체 연주로 LightGCN을 학습해 사용자별 상위 50개를 만든다. 이미 친 곡은 뺀다. 연주가 없는 사용자는 후보를 만들지 않는다(BE가 R1로 응답) |
| 적재 | `candidates_client.py` | 같은 `batchId`로 4 MiB 이하씩 나눠 보낸다. 연결 오류·429·5xx는 3번까지 다시 보내고, 그 밖의 4xx는 멈춘다 |

- **재정렬은 BE가 한다.** M6의 하드 제외와 규칙 점수 혼합은 서빙 때의 사용자 상태로 해야 해서, 배치는 재정렬 전 순위를 보낸다.
- **`modelVersion`**은 `r3-{변형}-{하이퍼파라미터 해시 8자}`다. 데이터가 바뀌어도 같아서 BE 허용 목록을 배치마다 고치지 않는다. 변형을 바꾸면 값이 바뀌므로 허용 목록에 먼저 넣는다.
- **변형**(`--variant`): `base`(특징 없음), `feat`(채보 특징), `feat_meta`(채보 특징과 메타데이터). 어떤 변형을 쓸지는 실데이터 보고서로 정한다.
- **환경 변수:** `SSAPLASH_RECOMMEND_EXPORT_DSN`(읽기 전용 계정), `SSAPLASH_WORKER_BASE_URL`, `SSAPLASH_WORKER_TOKEN`(채보 워커와 같은 값).
- **종료 코드:** 0 성공, 2 입력·설정 오류(적재 안 함), 3 적재 실패 또는 일부만 적재.
- **출력과 MLflow**에는 개수와 해시만 남는다. 사용자 키와 사용자 벡터는 저장·출력하지 않는다.
- 합성 입력은 적재할 수 없고, 뷰 입력은 출처 단계 P0로 쓸 수 없다.

## 실행·검증

```
cd AI
uv run pytest tests/recommend
uv run ruff check . && uv run ruff format --check .
```

학습 코드는 아직 없다. 기준선, 평가 하니스, 그래프 모델은 이후 작업에서 같은 폴더에 추가한다.
