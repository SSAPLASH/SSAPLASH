# AI 파트

싸플래쉬(SSAPLASH)의 AI·데이터 영역. 채보 생성(MIDI 규칙 변환, 음원 드럼 분리, 드럼 트랜스크립션), 실시간·리포트 코칭, 악보 자동 넘기기를 맡는다. 현재는 **드럼 분리 모델 벤치마크 하네스**를 만드는 단계다.

## 스택

| 항목 | 선택 | 비고 |
| --- | --- | --- |
| Python | 3.11 | 시스템 파이썬(3.13)과 분리된 가상환경. 분리·채보 모델 패키지 호환 때문 |
| 환경·의존성 | [uv](https://docs.astral.sh/uv/) | `uv.lock`으로 버전 고정 |
| 코드 검사 | ruff | lint + format |
| 테스트 | pytest | |
| 오디오 입출력 | soundfile, soxr, mido | wav 읽고 쓰기, 샘플레이트 변환, MIDI 온셋 추출 |
| 실험 기록 | MLflow (로컬 파일 모드) | 팀 MLflow 서버(S15P31A307-45)가 생기면 그쪽으로 옮긴다 |
| 모델 실행 | PyTorch + ZFTurbo MSST (예정) | 벤치마크 하네스 작업에서 추가 |

이 스택은 2026-10-19 기준 잠정 확정이다. 팀 전체 기술 스택이 확정되면 바뀔 수 있다.

## 폴더 구조

```
AI/
├─ pyproject.toml        패키지·의존성·ruff·pytest 설정, ssaplash-bench 명령 진입점
├─ uv.lock               의존성 잠금
├─ .python-version       3.11
├─ src/ssaplash_ai/      패키지 본체
│   ├─ bench/            벤치마크 하네스
│   │   ├─ datasets/     데이터셋 로더 (base, musdb, synth) + 합성곡 제작 로직 (synth_build)
│   │   └─ cli.py        명령줄 진입점 (check-data. run·report는 예정)
│   └─ chart/            채보 형식·패드 매핑 (예정)
├─ configs/bench/datasets/  데이터셋 설정 yaml, 합성곡 레시피
├─ scripts/              데이터 준비 스크립트 (make_synth_songs.py)
├─ tests/                pytest. 실제 데이터 없이 가짜 wav로 돈다
├─ notebooks/            코랩 실행용 노트북 (예정)
├─ data/                 데이터셋·모델 가중치·결과 (git 미추적, 설명은 data/README.md)
└─ DESIGN.md             작업 기록·세션 인계 문서 (git 미추적, 개인 문서)
```

## 환경 구축

uv가 없으면 먼저 설치한다 (Windows PowerShell).

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

저장소 루트가 아니라 `AI/` 폴더에서 실행한다.

```bash
cd AI
uv sync          # .venv 생성 + 의존성 설치 (Python 3.11은 uv가 받아 준다)
```

## 실행·검증 명령

전부 `AI/` 폴더에서 실행한다. 설정 yaml의 상대 경로가 이 폴더 기준이다.

```bash
cd AI
uv run ruff check .      # lint
uv run ruff format .     # 포맷 (커밋 전)
uv run pytest            # 테스트
```

커밋 전에 `ruff check`와 `pytest`가 모두 통과해야 한다 (CLAUDE.md 규칙). GitLab CI의 AI lint·test 단계도 같은 명령을 쓴다.

데이터 점검. 곡 수, 길이 합, 빠진 파일을 출력하고 문제가 있으면 종료 코드 1을 돌려준다.

```bash
uv run ssaplash-bench check-data configs/bench/datasets/musdb18hq_test.yaml configs/bench/datasets/synth_v1.yaml
```

Git Bash에서 한글이 깨지면 `PYTHONUTF8=1`을 앞에 붙인다.

## 데이터

`AI/data/`는 git이 추적하지 않는다. 폴더마다 무슨 데이터가 있는지는 `AI/data/README.md`에 있다. 아래 두 데이터셋을 직접 받아 둔다. 둘 다 교육·연구 목적으로만 쓰고 저장소나 Notion에 음원을 올리지 않는다.

| 데이터셋 | 용도 | 받는 곳 | 크기 | 라이선스 | md5 |
| --- | --- | --- | --- | --- | --- |
| MUSDB18-HQ | 분리 벤치마크의 기본 평가 데이터. test 50곡을 평가에 쓰고, train 100곡은 합성곡 반주 재료로 쓴다 | [Zenodo 3338373](https://zenodo.org/records/3338373) `musdb18hq.zip` | 22.7GB (22,656,664,047 바이트) | 교육·연구 목적 전용, 상업 사용 금지 | `12d4f2ecd55245a4688754dd76363103` (Zenodo 기재) |
| GMD (Groove MIDI Dataset) v1.0.0 | 합성곡 드럼 재료. 연주 MIDI가 같이 있어서 타격 시각과 악기 정답을 그대로 얻는다 | [Magenta](https://magenta.tensorflow.org/datasets/groove) `groove-v1.0.0.zip` | 4.8GB (5,111,599,714 바이트) | CC BY 4.0 (Google LLC) | `99db7e2a087761a913b2abfb19e86181` (2026-10-19 직접 계산) |

받은 뒤 md5를 확인한다.

```bash
cd AI/data
md5sum musdb18hq/musdb18hq.zip gmd/groove-v1.0.0.zip
```

압축을 풀면 폴더가 이렇게 된다.

```
AI/data/
├─ musdb18hq/
│   ├─ train/{곡 이름}/{mixture,drums,bass,other,vocals}.wav   100곡
│   └─ test/{곡 이름}/...                                       50곡
├─ gmd/groove/
│   ├─ info.csv                       연주별 스타일·bpm·길이·split (train/validation/test)
│   └─ drummer{N}/{session}/*.mid, *.wav
└─ synth_v1/{곡 이름}/                 아래 스크립트로 생성
    ├─ mixture.wav, drums.wav, accomp.wav
    ├─ onsets.csv                     타격 시각(초)·MIDI 피치·악기 분류·세기
    └─ meta.yaml                      출처·라이선스·bpm·게인
```

### 자체 합성곡 (synth_v1)

GMD 드럼 연주 하나와 MUSDB18-HQ train 곡에서 드럼을 뺀 구간을 섞어 만든다. 드럼을 뺀 구간은 bass·other·vocals 세 트랙의 합이다. 드럼 정답 트랙과 타격 시각이 정확하므로, 분리 뒤에 타격이 얼마나 살아 있는지 재는 지표에 쓴다. 레시피는 `configs/bench/datasets/synth_v1_recipe.yaml`에 있고 만들어진 음원은 git이 추적하지 않는다.

```bash
# 후보 고르기: 스타일·bpm·길이로 GMD 연주 목록 보기
uv run python scripts/make_synth_songs.py list-gmd data/gmd/groove --style rock --bpm-min 80 --bpm-max 100 --min-sec 30
# 레시피대로 만들기
uv run python scripts/make_synth_songs.py build configs/bench/datasets/synth_v1_recipe.yaml
```

반주가 MUSDB에서 왔으므로 합성곡도 교육용 비상업 라이선스를 따른다. 후보 분리 모델 대부분이 MUSDB train으로 학습했기 때문에 이 반주를 이미 본 셈이고, 결과를 해석할 때 이 점을 적는다. 드럼은 모델이 본 적 없는 GMD 소리라 드럼 분리 평가 자체는 유효하다.

## 관련 문서

- 공통 명세서: `Docs/Service Design/공통 명세서.md` (11장 AI 활용 계획, 15장 기술 검증 포인트)
- Jira: 에픽 `[CHART] 채보` (S15P31A307-29), 스토리 CHART-003 (S15P31A307-62) · CHART-004 (S15P31A307-69)
