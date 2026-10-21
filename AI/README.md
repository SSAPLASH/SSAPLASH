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
| 지표 | museval, mir_eval, librosa, psutil | BSS Eval v4(SDR·SIR·SAR), 온셋 매칭, 온셋 검출, 메모리 측정 |
| 실험 기록 | MLflow (로컬 파일 모드) | 팀 MLflow 서버(S15P31A307-45)가 생기면 tracking URI만 바꾼다 |
| 보고서 | pandas, matplotlib | CSV 집계, 마크다운 표, PNG 그래프 |
| 모델 실행 | PyTorch + ZFTurbo MSST(msst), demucs, openunmix | 선택 extra `models`. 단위 테스트·CI에는 필요 없다 |

이 스택은 2026-10-19 기준 잠정 확정이다. 팀 전체 기술 스택이 확정되면 바뀔 수 있다.

## 폴더 구조

```
AI/
├─ pyproject.toml        패키지·의존성·ruff·pytest 설정, ssaplash-bench 명령 진입점
├─ uv.lock               의존성 잠금
├─ .python-version       3.11
├─ src/ssaplash_ai/      패키지 본체
│   ├─ bench/            벤치마크 하네스
│   │   ├─ cli.py        명령줄 진입점 (check-data · run · report)
│   │   ├─ datasets/     평가 데이터 읽기 (base, musdb, synth, synth_build, gmd, mdb) · 패드 어휘·타격 표(pads)
│   │   ├─ separators/   분리 모델 실행. separator_base(공통 인터페이스·yaml·다운로드),
│   │   │                mock_separator(모델 없이 원곡·무음을 돌려주는 테스트용), msst_separator(SCNet·BS Roformer),
│   │   │                demucs_separator(HTDemucs), openunmix_separator(umxhq)
│   │   ├─ metrics/      지표 계산. bss_eval_metrics(SDR·SIR·SAR·SI-SDR), onset_preservation(타격 보존율),
│   │   │                attack_slope_distortion(어택 왜곡), resource_usage(시간·RAM·VRAM)
│   │   ├─ runner/       벤치마크 실행. benchmark_runner(모델 × 곡, 결과 CSV), mlflow_tracking(MLflow 기록)
│   │   └─ report/       결과 보고서. summary_table(집계·요약 표), charts(그래프 PNG), build_report(파일 생성)
│   └─ chart/            채보 형식·패드 매핑 (예정)
├─ configs/bench/datasets/  데이터셋 설정 yaml, 합성곡 레시피
├─ configs/bench/models/    모델 설정 yaml. 어댑터별 폴더 (msst, demucs, openunmix, mock=테스트용)
├─ scripts/              데이터 준비 스크립트 (make_synth_songs.py)
├─ tests/                pytest. src와 같은 폴더 구조. 실제 데이터·모델 없이 테스트용 wav와 mock 어댑터로 돈다
├─ notebooks/            코랩 실행용 노트북 (bench_colab.ipynb)
├─ mlruns/               MLflow 로컬 기록 (git 미추적)
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
uv sync                  # .venv 생성 + 의존성 설치 (Python 3.11은 uv가 받아 준다)
uv sync --extra models   # 실제 분리 모델까지 돌릴 때. torch(CUDA)·msst·demucs·openunmix 약 3GB
```

`models` extra는 Windows에서 CUDA 12.8 휠을, Linux(코랩)에서는 PyPI 기본 휠을 받는다 (`pyproject.toml`의 `tool.uv.index`). Spleeter는 tensorflow 2.12·numpy 1.x에 고정돼 이 환경에 설치할 수 없어 후보에서 뺐다.

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

## 벤치마크 실행

모델 yaml 여러 개와 데이터셋 yaml 하나를 받아 모델 × 곡을 전부 돌린다. 곡마다 결과 행을 CSV에 바로 쓰므로 중간에 끊겨도 그때까지의 결과가 남는다. 끝나면 같은 폴더에 보고서를 만들고 MLflow에 run 하나를 남긴다.

```bash
# 동작 확인: 모델 1개 × 30초 클립 3곡 (GPU 없으면 cpu로 내려간다)
uv run ssaplash-bench run --models configs/bench/models/msst/scnet_large.yaml     --dataset configs/bench/datasets/musdb18hq_test_clip30.yaml --out data/results

# 여러 모델, 분리 결과 wav를 모델당 3곡 저장, MLflow 기록 생략
uv run ssaplash-bench run --models configs/bench/models/msst/scnet_xl_ihf.yaml configs/bench/models/demucs/htdemucs_ft.yaml     --dataset configs/bench/datasets/musdb18hq_test.yaml --out data/results --save-wav 3 --mlflow-uri none

# 보고서만 다시 만들기 (CSV 여러 개를 합칠 수 있다)
uv run ssaplash-bench report data/results/<runId>/results.csv --out data/results/<runId>
```

| 옵션 | 뜻 | 기본 |
| --- | --- | --- |
| `--models` | 모델 yaml 목록 (`configs/bench/models/<어댑터>/*.yaml`) | 필수 |
| `--dataset` | 데이터셋 yaml | 필수 |
| `--out` | 결과 폴더. 아래에 `<runId>/` 생성 | `data/results` |
| `--device` | `cuda` 또는 `cpu` | `cuda` |
| `--clip START END` | 곡마다 쓸 구간(초). yaml의 clip보다 우선 | 없음 |
| `--save-wav N` | 모델당 분리 결과 wav를 저장할 곡 수 | 0 |
| `--run-id` | runId 직접 지정 | 시각+난수 |
| `--mlflow-uri` | MLflow tracking URI. `none`이면 기록 안 함 | `mlruns` (환경 변수 `MLFLOW_TRACKING_URI`) |

결과 폴더 `data/results/<runId>/`

| 파일 | 내용 |
| --- | --- |
| `results.csv` | 곡 × 모델당 1행. 설계 문서 3-3절 열 + 보조 열. 실패한 곡은 `error` 열에 예외 요약 |
| `summary.md` | 모델별 비교표(드럼 SDR, 타격 보존율, 어택 기울기 왜곡, 반주 SIR, RTF, 피크 GPU 메모리, 가중치 라이선스. 드럼 SDR 내림차순), 보조값 표, 데이터셋별 표, 실패 목록 |
| `per_song.csv` | 보고서에 쓴 곡별 값 (CSV 여러 개를 합친 경우 합친 것) |
| `metrics_by_model.png`, `rtf_vs_sdr.png` | 모델별 지표 막대, RTF 대 드럼 SDR 산점도 |
| `separated/<모델>/<곡>/{drums,accomp}.wav` | `--save-wav`로 저장한 분리 결과 (청취용) |

MLflow 기록은 `uv run mlflow ui --backend-store-uri mlruns`로 본다. 실험 이름 `separation-bench`, run 이름이 runId이고, 모델별 중앙값이 `<모델>/<열>` 지표로, CSV·표·그래프가 artifact로 붙는다.

모델 yaml은 어댑터(`msst`, `demucs`, `openunmix`, `mock`)와 가중치 위치, 코드·가중치 라이선스 문자열을 적는다. 라이선스 두 필드는 필수다. MSST 가중치는 첫 실행 때 `data/models/<모델>/`에 내려받고, demucs·openunmix 가중치는 torch hub 캐시에 받는다. 다운로드 시간은 로드 시간(`loadSec`)에 넣지 않는다.

### 코랩에서 돌리기

`notebooks/bench_colab.ipynb`를 코랩에서 열고 위에서부터 실행한다. 저장소 zip과 `data/` 폴더를 드라이브 `MyDrive/ssaplash/`에 올려 두면 노트북이 저장소를 풀고 `uv sync --extra models`로 환경을 만든 뒤 위와 같은 `ssaplash-bench` 명령을 부른다. 결과 CSV·MLflow 기록은 드라이브에 쌓인다. 본측정은 코랩 GPU에서만 한다 (로컬 RTX 4070 8GB는 30초 클립 동작 확인용).

## 지표 정의

곡 단위 값이고 모델 단위 값은 곡 값들의 중앙값이다. 자세한 계산 규칙은 `src/ssaplash_ai/bench/metrics/` 각 파일 머리말에 있다.

| CSV 열 | 뜻 | 계산 |
| --- | --- | --- |
| `sdrDrums`, `sdrAccomp` | 분리 품질 (dB). 정답과 예측이 얼마나 가까운지 | museval(BSS Eval v4)에 정답·예측 드럼과 반주 2소스를 넣고 1초 프레임 값의 중앙값. 예측 반주 = 원곡 − 예측 드럼 |
| `sirAccomp`, `sarAccomp` | 반주에 남은 드럼 누설, 인공음 (dB) | 같은 museval 호출. 드럼 쪽 `sirDrums`·`sarDrums`도 보조로 기록 |
| `siSdrDrums`, `siSdrAccomp` | 배율 불변 SDR (dB) | 곡 전체 1회 |
| `onsetF1`, `onsetPrecision`, `onsetRecall` | 타격 보존율. 정답 타격 시각을 예측 드럼에서 얼마나 되찾는지 | librosa 스펙트럼 플럭스 온셋 검출(hop 512 샘플)을 예측 드럼에 적용, mir_eval로 ±50ms 매칭. 정답 온셋은 합성곡이면 MIDI, MUSDB면 정답 드럼 스템에 같은 검출기 적용 |
| `onsetF1Tight` | 같은 것, ±25ms | |
| `attackSlopeDistortion` | 어택(타격 직후 음량이 솟는 구간) 왜곡. 0이면 원음 그대로 | 정답 온셋마다 온셋 후 10ms 구간을 1ms 블록 최댓값 포락선으로 만들고 최소제곱 기울기를 구해 \|ln(예측 기울기 / 정답 기울기)\|를 평균. Beyond SDR 논문의 attack slope를 단순화한 것이라 논문 수치와 직접 비교하지 않는다 |
| `separateSec`, `rtf` | 분리 시간(초), RTF = 분리 시간 / 곡 길이 | 벽시계. 모델 로드 제외. 로드 직후 첫 곡을 한 번 분리하고 버려(워밍업, `--no-warmup`으로 생략) GPU 커널 준비 시간을 뺀다 |
| `loadSec` | 모델 로드 시간 | 가중치 다운로드 제외. 곡마다 같은 값 반복 |
| `peakRamMb`, `peakVramMb` | 분리 중 최대 메모리 (MB) | RAM은 50ms마다 프로세스 RSS 표본의 최댓값, VRAM은 torch 최대 할당량. CPU 실행이면 VRAM은 nan |

무음 예측의 BSS 값은 정의되지 않으므로 `-inf`로 적는다. 비교표에는 ADR-011의 6개 지표와 가중치 라이선스만 올리고 나머지는 보조값 표에 둔다.

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
├─ synth_v1/{곡 이름}/                 아래 스크립트로 생성
│   ├─ mixture.wav, drums.wav, accomp.wav
│   ├─ onsets.csv                     타격 시각(초)·MIDI 피치·악기 분류·세기
│   └─ meta.yaml                      출처·라이선스·bpm·게인
└─ mdb_drums/                         채보 벤치마크용. 아래 "MDB Drums" 절
    ├─ CHECKSUMS.txt                  sha256 (git 추적)
    └─ MDB Drums/{annotations,audio/drum_only,audio/full_mix}/
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

### 채보 벤치마크 정답 데이터 (S15P31A307-108)

채보 모델은 "몇 초에 어느 패드를 쳤는지"를 맞혀야 하므로 타격 시각과 패드가 적힌 정답이 필요하다. 패드는 와이어프레임과 같은 8종 `KICK, SNARE, HIHAT, HI_TOM, MID_TOM, FLOOR_TOM, CRASH, RIDE`이고(`bench/datasets/pads.py`), 카우벨·클랩·탬버린처럼 패드에 없는 타격은 정답에서 빼고 개수만 센다. 세 묶음을 쓰며 묶음마다 점수를 따로 낸다.

| 설정 | 내용 | 역할 |
| --- | --- | --- |
| `synth_v1.yaml` | 합성곡 5곡. 원곡·정답 드럼·MIDI 타격 정답 | 분리 모델을 거친 뒤 채보 점수가 얼마나 떨어지는지 |
| `gmd_test.yaml` | GMD test split 드럼 연주 45개(52분). 드럼만 있는 전자 드럼 녹음 + MIDI 타격 정답 | 드럼 트랙 입력 채보, 8패드별 점수 |
| `mdb_drums.yaml` | MDB Drums 23곡(22분). 실제 밴드 녹음, 원곡·드럼 트랙·사람이 적은 타격 정답 | 논문 수치와 검산 |
| `mdb_drums_unseen.yaml` | 위 23곡 중 MUSDB18 train에 없는 11곡 | 분리 모델을 거치는 평가는 이 묶음만 (아래 참고) |

GMD 연주는 `list-gmd --split test --min-sec 30 --hits`로 패드별 타격 수를 보고 골랐다. test split만 쓰는 이유는 채보 후보 중 셋(OaF Drums·YourMT3+·Inverse Drum Machine)이 GMD를 다시 녹음·렌더링한 E-GMD·StemGMD의 train split로 학습했기 때문이다. 밴드 장르만 고르면 크래시 73개·미드탐 34개뿐이라 재즈 2개·라틴 3개 연주를 더해 탐·심벌이 각 100개 이상 되게 했다. 합성곡에 쓴 연주 5개는 뺐다.

```bash
# 세 묶음 점검 (곡 수·길이·누락·패드별 타격 수)
uv run ssaplash-bench check-data configs/bench/datasets/synth_v1.yaml configs/bench/datasets/gmd_test.yaml configs/bench/datasets/mdb_drums.yaml
```

### MDB Drums

MedleyDB 23곡에 드럼 타격 시각과 종류(세부 분류 21종)를 사람이 적은 공개 데이터셋. 채보 논문들이 점수 비교에 쓰는 표준 평가곡이다. 라이선스는 **CC BY-NC-SA 4.0**이라 음원·주석을 저장소나 Notion에 올리지 않는다. 벤치마크에 필요한 폴더 세 개만 받으면 331MB다.

```bash
cd AI/data
git clone --depth 1 --filter=blob:none --sparse https://github.com/CarlSouthall/MDBDrums.git mdb_drums
cd mdb_drums
git sparse-checkout set "MDB Drums/annotations" "MDB Drums/audio/drum_only" "MDB Drums/audio/full_mix"
sha256sum -c CHECKSUMS.txt   # 115개 파일. 체크섬 파일은 git이 추적한다 (2018-03-12 커밋 b29e2d6 기준)
rm -rf .git                  # 받은 뒤 안쪽 .git은 지운다. 남겨 두면 우리 저장소 git status에 잡힌다
```

주의: 23곡 중 12곡(80sRock·Beatles·Britpop·Country1·Disco·Gospel·Grunge·Hendrix·Punk·Reggae·Rock·Rockabilly)은 같은 MedleyDB 녹음이 MUSDB18 train에도 들어 있다. 분리 모델이 학습 때 본 곡이라, 분리 모델을 거치는 평가에는 나머지 11곡(`mdb_drums_unseen.yaml`)만 쓴다. 세부 분류를 패드로 바꾸는 표는 `bench/datasets/mdb.py`에 있고, 탬버린(TMB) 32개는 패드 밖이라 뺀다. 탐 타격이 23곡 합쳐 90개뿐이라 탐별 점수는 GMD 묶음이 맡는다.

## 관련 문서

- 공통 명세서: `Docs/Service Design/공통 명세서.md` (11장 AI 활용 계획, 15장 기술 검증 포인트)
- Jira: 에픽 `[CHART] 채보` (S15P31A307-29). 분리 벤치마크(-101~-105)는 스토리 CHART-004 음원 드럼 분리 (S15P31A307-69), 채보 벤치마크(-106~-110)는 스토리 CHART-003 음원 → 채보 생성 (S15P31A307-62)
