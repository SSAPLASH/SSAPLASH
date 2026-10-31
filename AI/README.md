# AI 파트

싸플래쉬(SSAPLASH)의 AI·데이터 영역. 채보 생성(MIDI 규칙 변환, 음원 드럼 분리, 드럼 트랜스크립션), 실시간·리포트 코칭, 악보 자동 넘기기를 맡는다. 현재는 **드럼 분리·채보 모델 벤치마크 하네스**로 서비스에 쓸 모델을 고르는 단계다.

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
| 채보 모델 실행 | ADTOF-pytorch(extra `transcribers`), 별도 가상환경(ADT_STR·Inverse Drum Machine·Omnizart·YourMT3+) | 지금 환경과 의존성이 맞지 않는 모델은 `scripts/transcribers_ext/`의 스크립트를 별도 환경에서 돌린다 |

이 스택은 2026-10-19 기준 잠정 확정이다. 팀 전체 기술 스택이 확정되면 바뀔 수 있다.

## 폴더 구조

```
AI/
├─ pyproject.toml        패키지·의존성·ruff·pytest 설정, ssaplash-bench·ssaplash-chart·ssaplash-train 명령 진입점
├─ uv.lock               의존성 잠금
├─ .python-version       3.11
├─ src/ssaplash_ai/      패키지 본체
│   ├─ bench/            벤치마크 하네스
│   │   ├─ cli.py        명령줄 진입점 (check-data · run · report · run-transcription · report-transcription ·
│   │   │                rule-features · rule-eval · tom-pitch)
│   │   ├─ datasets/     평가 데이터 읽기 (base, musdb, synth, synth_build, gmd, mdb) · 패드 어휘·타격 표(pads)
│   │   ├─ separators/   분리 모델 실행. separator_base(공통 인터페이스·yaml·다운로드),
│   │   │                mock_separator(모델 없이 원곡·무음을 돌려주는 테스트용), msst_separator(SCNet·BS Roformer),
│   │   │                demucs_separator(HTDemucs), openunmix_separator(umxhq)
│   │   ├─ transcribers/ 채보 모델 실행. transcriber_base(공통 인터페이스·yaml 대응표), mock_transcriber(테스트용),
│   │   │                adtof_transcriber(ADTOF), adtof_drumsep_transcriber(ADTOF + 드럼 킷 분리 + 규칙),
│   │   │                external_transcriber(별도 가상환경 스크립트 실행)
│   │   ├─ metrics/      지표 계산. bss_eval_metrics(SDR·SIR·SAR·SI-SDR), onset_preservation(타격 보존율),
│   │   │                attack_slope_distortion(attack slope 왜곡), resource_usage(시간·RAM·VRAM), hit_f1(채보 타격 F1)
│   │   ├─ analysis/     채보 규칙 분석. rule_features(ADTOF 타격 시각·드럼 킷 분리 트랙 저장), rule_eval(규칙 후보 점수·혼동표),
│   │   │                tom_pitch(정답 탐 음높이 분포·경계 후보)
│   │   ├─ runner/       벤치마크 실행. benchmark_runner(분리 모델 × 곡), transcription_runner(채보 모델 × 곡 × 입력),
│   │   │                run_support(둘이 같이 쓰는 CSV 쓰기·이어하기), mlflow_tracking(MLflow 기록)
│   │   └─ report/       결과 보고서. summary_table·charts(분리), transcription_summary·transcription_charts(채보),
│   │                    build_report(파일 생성)
│   ├─ train/            채보 모델 파인튜닝. adtof_data(학습 윈도·특징·프레임 정답), adtof_finetune(학습 루프·체크포인트),
│   │                    adtof_eval(클래스별 F1·문턱값 맞추기), cli(ssaplash-train 명령)
│   ├─ chart/            서비스 추론 모듈. config(설정 yaml·환경 변수), audio_io(원곡 읽기·트랙 쓰기), errors(예외 분류),
│   │                    separation(음원 분리 SeparationModule), cli(ssaplash-chart 명령)
│   └─ server/           AI 서버 진입점 app.py (FastAPI, /health)
├─ configs/bench/datasets/  데이터셋 설정 yaml, 합성곡 레시피
├─ configs/bench/models/    분리 모델 설정 yaml. 어댑터별 폴더 (msst, demucs, openunmix, mock=테스트용)
├─ configs/bench/transcribers/  채보 모델 설정 yaml + 라벨 → 패드 대응표 (adtof, adtof_drumsep, external, mock)
├─ configs/train/        채보 모델 파인튜닝 설정 yaml (adtof_tom_5cls, adtof_tom_6cls, adtof_tom_7cls, adtof_tom_9cls)
├─ configs/chart/        서비스 추론 모듈 설정 yaml (separation.yaml, 모델 없이 흐름만 확인하는 separation_mock.yaml)
├─ scripts/              데이터 준비 스크립트 (make_synth_songs.py, pack_gmd_subset.py, pack_server_upload.py), 별도 환경 채보 스크립트 (transcribers_ext/)
├─ ext/                  채보 모델 저장소 클론·코드 (ADT_STR, inverse-drum-machine, YourMT3. git 미추적)
├─ .venv-*/              채보 모델 별도 가상환경 (git 미추적)
├─ tests/                pytest. src와 같은 폴더 구조. 실제 데이터·모델 없이 테스트용 wav와 mock 어댑터로 돈다
├─ notebooks/            실행용 ipynb 파일 (코랩: bench_colab.ipynb 분리, transcription_bench_colab.ipynb 채보 / GPU 서버: transcription_bench_server.ipynb 채보,
│                        tom_newkits_server.ipynb 새 킷 규칙 검증, tom_finetune_server.ipynb 채보 모델 파인튜닝)
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
uv sync --extra models --extra transcribers   # 채보 모델 ADTOF까지. 나머지 채보 모델은 아래 '별도 환경'
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

## 음원 분리 실행 (서비스 추론 모듈, S15P31A307-167)

원곡 파일 하나를 드럼 트랙과 반주로 나눈다. 벤치마크에서 고른 BS Roformer SW를 벤치마크 어댑터 그대로 쓰므로 모델 실행 패키지가 필요하다 (`uv sync --extra models`). 가중치 약 700MB는 첫 실행 때 `data/models/bs_roformer_sw/`에 받는다.

```bash
uv run ssaplash-chart separate data/synth_v1/funk_108/mixture.wav --out data/chart/funk_108
# GPU가 없으면 cpu로 내려간다. 강제로 바꾸려면 --device cpu
```

출력 폴더에 세 파일이 생긴다. 반주는 원곡에서 드럼 트랙을 샘플 단위로 뺀 것이라 세 파일의 샘플 수와 시간축이 원곡과 같다.

| 파일 | 내용 |
| --- | --- |
| `drums.flac` | 드럼 트랙. 16비트 44.1kHz 스테레오 |
| `accompaniment.flac` | 반주. 원곡 − 드럼 트랙 |
| `separation.json` | 결과 메타. 길이 ms, 모델 이름·버전, 올리기·분리 시간 ms, 최대 GPU 메모리·RAM MB, `audio_time_origin` |

설정은 `configs/chart/separation.yaml`에 있고 상대 경로는 `AI/` 기준이다.

| 키 | 기본값 | 뜻 |
| --- | --- | --- |
| `model_config` | `configs/bench/models/msst/bs_roformer_sw.yaml` | 분리 모델 yaml. 벤치마크 yaml을 그대로 가리키므로 대안 모델로 바꾸려면 경로만 바꾼다 |
| `device` | `cuda` | 없으면 `cpu`로 내려간다 |
| `output.format` | `flac` | `flac` 16비트 또는 `wav` PCM_16 |
| `output.sample_rate` | 44100 | 출력 샘플레이트 |
| `max_duration_sec` | 600 | 이보다 긴 입력은 입력 오류 |

| 환경 변수 | 뜻 |
| --- | --- |
| `SSAPLASH_CHART_DEVICE` | `device` 값을 덮어쓴다 |
| `SSAPLASH_MODELS_DIR` | 가중치 폴더. 기본 `data/models`. 벤치마크 어댑터도 같이 읽는다 |
| `SSAPLASH_WORK_DIR` | `--out`이 없을 때 출력 폴더의 부모. `<WORK_DIR>/<원곡 파일 이름>/`에 쓴다 |

종료 코드는 0 정상, 2 입력 오류, 3 모델 오류, 4 출력 오류, 1 설정·인자 오류다. 입력 오류는 못 읽는 파일·길이 초과·무음이고 모델을 돌리기 전에 난다. 모델 오류 중 GPU 메모리 부족만 재시도할 수 있는 것으로 표시한다. 파이썬에서 쓸 때는 `ssaplash_ai.chart.separation.SeparationModule`을 만들고 `load()` 한 번, `separate_file()` 곡마다, `close()` 순서로 부른다.

모델 없이 흐름만 확인할 때는 mock 설정을 쓴다. 드럼은 원곡 × 0.5가 나온다.

```bash
uv run ssaplash-chart separate <원곡> --out data/chart/check --config configs/chart/separation_mock.yaml
```

## 벤치마크 실행

모델 yaml 여러 개와 데이터셋 yaml 하나를 받아 모델 × 곡을 전부 돌린다. 곡마다 결과 행을 CSV에 바로 쓰므로 중간에 끊겨도 그때까지의 결과가 남는다. 끝나면 같은 폴더에 보고서를 만들고 MLflow에 run 하나를 남긴다.

**이어하기.** `--run-id`를 지정해 돌리다 끊기면 같은 명령을 그대로 다시 실행한다. 그 폴더의 `results.csv`에서 `error`가 빈 (모델, 곡) 행은 건너뛰고 그대로 두며, `error`가 있던 행은 지우고 다시 돌린다. 한 모델의 곡이 전부 끝나 있으면 그 모델은 로드도 하지 않는다. 열 구성이 다른 옛 CSV에는 이어 붙이지 않고 오류로 멈춘다. MLflow run은 마지막 실행 것 하나만 남고, 지표는 CSV 전체로 계산한다.

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
| `--run-id` | runId 직접 지정. 같은 runId의 `results.csv`가 있으면 이어하기 | 시각+난수 |
| `--mlflow-uri` | MLflow tracking URI. `none`이면 기록 안 함 | `mlruns` (환경 변수 `MLFLOW_TRACKING_URI`) |

결과 폴더 `data/results/<runId>/`

| 파일 | 내용 |
| --- | --- |
| `results.csv` | 곡 × 모델당 1행. 실행 식별(runId·device·gpuName·host), 모델 식별, 곡 식별, 아래 지표 열, 실패한 곡은 `error` 열에 예외 요약. `gpuName`은 torch가 알려주는 GPU 이름이고 CPU 실행이면 빈칸 |
| `summary.md` | 모델별 비교표(드럼 SDR, 타격 보존율, attack slope 왜곡, 반주 SIR, RTF, 피크 GPU 메모리, 가중치 라이선스. 드럼 SDR 내림차순), 보조값 표, 데이터셋별 표, 실패 목록 |
| `per_song.csv` | 보고서에 쓴 곡별 값 (CSV 여러 개를 합친 경우 합친 것) |
| `metrics_by_model.png`, `rtf_vs_sdr.png` | 모델별 지표 막대, RTF 대 드럼 SDR 산점도 |
| `separated/<모델>/<곡>/{drums,accomp}.wav` | `--save-wav`로 저장한 분리 결과 (청취용) |

MLflow 기록은 `uv run mlflow ui --backend-store-uri mlruns`로 본다. 실험 이름 `separation-bench`, run 이름이 runId이고, 모델별 중앙값이 `<모델>/<열>` 지표로, CSV·표·그래프가 artifact로 붙는다.

모델 yaml은 어댑터(`msst`, `demucs`, `openunmix`, `mock`)와 가중치 위치, 코드·가중치 라이선스 문자열을 적는다. 라이선스 두 필드는 필수다. MSST 가중치는 첫 실행 때 `data/models/<모델>/`에 내려받고, demucs·openunmix 가중치는 torch hub 캐시에 받는다. 다운로드 시간은 로드 시간(`loadSec`)에 넣지 않는다.

### 코랩에서 돌리기

`notebooks/bench_colab.ipynb`를 코랩에서 열고 위에서부터 실행한다. 드라이브 `MyDrive/ssaplash/`에 저장소 zip(`S15P31A307.zip`), `data/musdb18hq/test/`(11GB), `data/synth_v1/`(216MB)을 올려 두면 이 ipynb 파일이 저장소를 풀고 `uv sync --extra models`로 환경을 만든 뒤, 데이터를 런타임 로컬 디스크로 복사하고 위와 같은 `ssaplash-bench` 명령을 부른다. 결과 CSV·MLflow 기록은 드라이브에 바로 써서 세션이 끊겨도 남는다. 본측정은 코랩 GPU 한 종류로만 한다 (로컬 RTX 4070 8GB는 30초 클립 동작 확인용).

본측정 runId는 `musdb-full`·`synth-full`로 고정돼 있어, 세션이 끊기면 런타임을 다시 연결하고 준비 셀(1~4)을 돌린 뒤 같은 셀을 다시 실행하면 이어서 돈다. 다시 연결했을 때 GPU 이름이 바뀌었으면 결과의 `gpuName`이 섞이므로 같은 GPU를 받을 때까지 런타임을 바꾼다.

저장소 zip은 저장소 루트에서 만든다. 데이터·결과·MLflow 폴더는 git이 추적하지 않아 zip에 들어가지 않는다.

```bash
git archive --format=zip --prefix=S15P31A307/ -o S15P31A307.zip HEAD
```

## 채보 벤치마크 실행 (S15P31A307-109)

채보 모델은 드럼 소리를 넣으면 "몇 초에 어느 드럼을 쳤는지" 목록을 적어 주는 모델이다. 이 하네스는 채보 모델 여러 개를 같은 곡으로 돌려 정답 타격(위 "채보 벤치마크 정답 데이터")과 맞춰 보고 점수표를 만든다. 분리 벤치마크와 같은 뼈대(모델 yaml × 데이터셋 yaml → 곡마다 CSV 한 줄 → 보고서 → MLflow)이고, 다른 점은 세 가지다.

- **입력이 세 가지**다. `--input drums`(정답 드럼 트랙), `mixture`(원곡 그대로), `separated`(분리 모델이 뽑은 드럼). 한 번 실행에 하나만 고르고, 결과표에서 합쳐 본다. `separated`는 `--separator`로 분리 모델 yaml을 주면 곡마다 분리해 `separated/<분리 모델>/<곡>/drums.wav`에 저장해 두고 다음부터는 읽기만 한다. 다른 run 폴더의 그 파일을 쓰려면 `--separated-dir`.
- **모델이 내는 드럼 이름을 우리 패드 8종으로 바꾸는 표**가 모델 yaml의 `labels`에 있다. 값은 패드 이름(`KICK`…`RIDE`), 탐 3종을 못 나누면 `tom`, 크래시·라이드를 못 나누면 `cymbal`, 패드에 없는 타격(클랩·카우벨 등)은 `__drop__`. `tom`·`cymbal`이 있으면 8패드 점수는 매기지 않고 5가지 점수만 낸다.
- **점수는 곡별 평균이 아니라 개수 합산**이다. 곡마다 맞힌·헛것·놓친 개수를 CSV에 남기고, 보고서가 데이터 묶음 단위로 더해 F1을 낸다.

```bash
# 동작 확인: ADTOF × 합성곡 5곡 30초 (모델 다운로드 없음, 가중치는 패키지에 포함)
uv run ssaplash-bench run-transcription --models configs/bench/transcribers/adtof/adtof.yaml --dataset configs/bench/datasets/synth_v1.yaml --clip 0 30 --out data/results --mlflow-uri none

# 정답 드럼 입력으로 여러 모델 × MDB Drums, 예측 타격을 모델당 3곡 MIDI로 저장
uv run ssaplash-bench run-transcription --models configs/bench/transcribers/adtof/adtof.yaml configs/bench/transcribers/external/adt_str_tau08.yaml --dataset configs/bench/datasets/mdb_drums.yaml --input drums --save-midi 3 --out data/results

# 분리 모델을 거친 드럼 입력 (MUSDB train에 없는 MDB 11곡)
uv run ssaplash-bench run-transcription --models configs/bench/transcribers/adtof/adtof.yaml --dataset configs/bench/datasets/mdb_drums_unseen.yaml --input separated --separator configs/bench/models/msst/bs_roformer_sw.yaml --out data/results

# 여러 run의 결과를 합쳐 보고서 (drums 대비 separated·mixture 변화 열이 생긴다)
uv run ssaplash-bench report-transcription data/results/<run1>/results.csv data/results/<run2>/results.csv --out data/results/combined
```

| 옵션 | 뜻 | 기본 |
| --- | --- | --- |
| `--models` | 채보 모델 yaml 목록 (`configs/bench/transcribers/<어댑터>/*.yaml`) | 필수 |
| `--dataset` | 타격 정답이 있는 데이터셋 yaml (synth_v1, gmd_test, mdb_drums, mdb_drums_unseen). MUSDB는 정답이 없어 거부 | 필수 |
| `--input` | `drums` / `mixture` / `separated` | `drums` |
| `--separator`, `--separated-dir` | separated일 때 분리 모델 yaml / 이미 분리된 wav 폴더 | 없음 |
| `--save-midi N` | 모델당 예측 타격을 MIDI로 저장할 곡 수 (`midi/<모델>/<곡>.mid`, 청취·플레이 평가용) | 0 |
| `--out`, `--device`, `--clip`, `--run-id`, `--no-warmup`, `--mlflow-uri` | 분리 벤치마크와 같음. `--run-id`로 이어하기(키는 묶음·모델·입력·분리 모델·곡) | |

결과 폴더 `data/results/<runId>/`

| 파일 | 내용 |
| --- | --- |
| `results.csv` | 곡 × 모델 × 입력당 1행. 5가지·8패드 기준 맞힌·헛것·놓친 개수(±50ms·±25ms)와 곡 단위 F1, Perfect 폭 적중률, 시각 오차, 세기 상관, 채보 시간·RTF·로드 시간·메모리, `eightPad`(8패드를 다 내는지), `input`·`separator`, 실패 시 `error` |
| `hits_by_class.csv` | 라벨(패드 또는 5가지)별 개수. 보고서의 패드별 F1 표 재료 |
| `summary.md` | 데이터 묶음별 비교표(5가지 F1, 8패드 F1, 분리 후 F1 변화, Perfect 폭 적중률, RTF, 피크 GPU 메모리, 가중치 라이선스), 보조값, 패드별·5가지별 F1, 실패 목록 |
| `per_song.csv`, `f1_by_model.png`, `rtf_vs_f1.png` | 곡별 값, 정답 드럼 입력의 모델별 F1 막대, RTF 대 F1 산점도(기준선 0.15). 그래프는 묶음마다 칸 하나 |
| `separation_effect.png` | 입력을 둘 이상 넣은 묶음만. 모델별로 정답 드럼·분리 드럼·원곡을 넣었을 때의 F1 막대 |
| `separated/`, `inputs/`, `midi/` | 분리 드럼 캐시, 별도 환경 모델에 넘긴 입력 wav, 저장한 예측 MIDI |

MLflow 실험 이름은 `transcription-bench`다. 모델 yaml의 `labels`가 바뀌면 `configHash`가 바뀌어 기록에 남는다.

### 채보 모델과 환경

| 모델 | yaml | 어댑터 | 환경 | 8패드 | 비고 |
| --- | --- | --- | --- | --- | --- |
| ADTOF | `adtof/adtof.yaml` | adtof | extra `transcribers` | 5가지만 | 가중치 패키지 포함. CC BY-NC-SA |
| ADTOF + 드럼 킷 분리 | `adtof_drumsep/adtof_drumsep.yaml` | adtof_drumsep | extra `models` + `transcribers` | 8 | ADTOF 결과의 탐·심벌을 MDX23C DrumSep 6스템(첫 실행 때 437MB 다운로드)과 규칙(탐 음높이 구간, 크래시·라이드 스템 에너지)으로 나눔. DrumSep 가중치 라이선스 미명시 |
| ADT_STR | `external/adt_str_tau08.yaml` (tau 0.4·0.6 변형도 있음) | external | `.venv-adt-str` + `ext/ADT_STR` | 8 | torch 2.8 고정이라 별도 환경. HF `Pierfrancesco/adt-str`에서 가중치 자동 다운로드. CC BY-SA |
| Inverse Drum Machine | `external/idm.yaml` | external | `.venv-idm` + `ext/inverse-drum-machine` | 8 | numpy<2 등 고정이라 별도 환경. 가중치 저장소 포함. Apache-2.0 |
| Omnizart drum | `external/omnizart.yaml` | external | `.venv-omnizart` | 킥·스네어·하이햇만 | TensorFlow. 저장소 공개 추론이 3가지만 MIDI로 내서 탐·심벌은 못 맞힌다 |
| YourMT3+ | `external/yourmt3.yaml` (앱 기본값), `external/yourmt3_ps.yaml` (보조) | external | `.venv-yourmt3` + `ext/YourMT3` | 8 | 피아노·베이스까지 받아 적는 다악기 모델. 그중 드럼 노트만 쓴다. 코드는 GitHub이 아니라 HF Space에만 있어 스크립트의 `download`로 코드와 체크포인트(하나에 약 0.55GB)를 판을 고정해 받는다. 코드·가중치 Apache-2.0 |
| drum2midi | `external/drum2midi.yaml` (세기·페달 학습 모델 끔), `external/drum2midi_learned.yaml` (세기·페달 학습 모델 켬, `--pedal auto`) | external | `.venv-drum2midi` + `ext/drum2midi` | 8 | ADTOF + 드럼 킷 분리 어댑터가 참고한 원본 프로그램(S15P31A307-164 비교용). 곡마다 `drum2midi.py`를 불러서 채보 시간에 분리 모델 로드가 섞인다. 기준값·탐 나누기를 MDB Drums로 맞춘 프로그램이라 MDB 점수는 유리할 수 있다. 코드 MIT, 가중치는 ADTOF(CC BY-NC-SA)·DrumSep(미명시) |

**별도 환경 만들기.** 지금 환경(Python 3.11, torch 2.11, numpy 2)과 의존성이 맞지 않는 모델은 가상환경을 따로 만들고, 하네스가 그 환경의 python으로 `scripts/transcribers_ext/<모델>_transcribe.py`를 한 번 띄워 곡 목록을 통째로 넘긴다(스크립트가 모델을 한 번만 올리고 곡마다 시간·GPU 메모리를 재서 JSON으로 돌려준다). 폴더 이름과 python 경로는 yaml의 `python_exe`에 적혀 있다. Windows 경로이지만 그 파일이 없으면 하네스가 `.venv-<env_name>/bin/python`을 대신 찾으므로 Linux·코랩에서도 yaml을 고칠 필요가 없다.

```bash
# ADT_STR: 저장소 클론 + torch 2.8(CUDA 12.8) + 저장소 의존성
git clone --depth 1 https://github.com/pier-maker92/ADT_STR ext/ADT_STR
uv venv .venv-adt-str --python 3.11
uv pip install --python .venv-adt-str/Scripts/python.exe torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu128
uv pip install --python .venv-adt-str/Scripts/python.exe -r ext/ADT_STR/pyproject.toml

# Inverse Drum Machine: 저장소 클론(가중치 포함) + 설치
git clone --depth 1 https://github.com/bernardo-torres/inverse-drum-machine ext/inverse-drum-machine
uv venv .venv-idm --python 3.11
uv pip install --python .venv-idm/Scripts/python.exe "torch>=2.1.1,<2.9" "torchaudio>=2.1.1,<2.9" --index-url https://download.pytorch.org/whl/cu128
# 저장소 pyproject에 build-system이 없어 패키지로는 설치가 안 된다. 의존성만 깔고 스크립트가 저장소를 sys.path에 넣는다
uv pip install --python .venv-idm/Scripts/python.exe lightning lightning-utilities auraloss einops "librosa>=0.9.1,<0.10" soundfile "soxr>=0.3.7" mir_eval "numpy<2" scipy scikit-learn pandas "matplotlib==3.8.2" hydra-core hydra-colorlog omegaconf pyyaml rootutils tqdm rich beautifulsoup4 setuptools

# Omnizart: Python 3.10 + TensorFlow. PyPI의 madmom 0.16.1은 Python 3.10에서 C 컴파일이 안 되므로(tp_print·Py_REFCNT 오류)
# madmom은 저장소 최신판(git)을 먼저 깐다(C 컴파일러 필요: Windows는 Visual Studio, Linux는 gcc). omnizart 설치 스크립트는
# pyaudio·vamp·pyfluidsynth를 직접 깔므로 Linux에서는 apt로 portaudio19-dev·fluidsynth를 먼저 둔다(코랩 ipynb 파일 4번 셀)
uv python install 3.10
uv venv .venv-omnizart --python 3.10
uv pip install --python .venv-omnizart/Scripts/python.exe "Cython<3" "numpy<2" scipy mido wheel setuptools
uv pip install --python .venv-omnizart/Scripts/python.exe --no-build-isolation "madmom @ git+https://github.com/CPJKU/madmom.git"
uv pip install --python .venv-omnizart/Scripts/python.exe --no-build-isolation --no-deps omnizart
# 의존성을 따로 적는 이유: 그냥 깔면 위의 madmom 시험판(0.17.dev0)을 못 알아보고 PyPI 0.16.1을 다시 받는다. GPU용 TensorFlow는 [and-cuda]
uv pip install --python .venv-omnizart/Scripts/python.exe "numpy<2" "tensorflow[and-cuda]==2.20.*" "tf-keras==2.20.*" "numba<0.68" click jsonschema "librosa>=0.8" mir_eval pillow pretty_midi pyfluidsynth pyyaml sherpa-onnx soundfile "setuptools<82" urllib3 vamp
.venv-omnizart/Scripts/omnizart download-checkpoints

# YourMT3+: Python 3.10 + torch 2.8(CUDA 12.8). transformers는 4.46부터 생성 중 오류가 나서 4.45.1로 고정(YourMT3 저장소 이슈 15·16)
uv venv .venv-yourmt3 --python 3.10
uv pip install --python .venv-yourmt3/Scripts/python.exe torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu128
uv pip install --python .venv-yourmt3/Scripts/python.exe "numpy==1.26.4" "transformers==4.45.1" "tokenizers==0.20.3" "huggingface-hub<1.0" "pytorch-lightning==2.5.6" "torchmetrics==1.9.0" "einops==0.8.2" "mido==1.3.3" "mir-eval==0.8.2" "scikit-learn==1.7.2" "scipy==1.15.3" "wandb==0.31.0" "soundfile==0.14.0" "deprecated==1.3.1"
# 코드(HF Space mimbres/YourMT3의 amt/src·model_helper.py)와 체크포인트(HF 모델 저장소)를 ext/YourMT3에 받음. 판 고정, 약 1.1GB
.venv-yourmt3/Scripts/python.exe -I scripts/transcribers_ext/yourmt3_transcribe.py download --repo-dir ext/YourMT3

# drum2midi: Python 3.12 + CUDA 12.8판 torch·torchaudio·torchvision을 먼저 넣고 저장소의 setup_env.py로 나머지(ADTOF-pytorch
# 클론 포함)를 설치. torchvision을 먼저 넣지 않으면 setup_env.py가 torchvision 최신판을 따라 torch를 CUDA 13판으로 올리고,
# 그 뒤 torch만 되돌려도 CUDA 13판 cuDNN 파일이 남아 CUDNN_STATUS_NOT_INITIALIZED가 난다(드라이버 570 서버에서 확인).
# FFmpeg 프로그램이 PATH에 있어야 한다. 드럼 분리 모델은 첫 실행 때 약 400MB를 받는다
git clone --depth 1 https://github.com/miraer/drum2midi ext/drum2midi
uv venv .venv-drum2midi --python 3.12 --seed
uv pip install --python .venv-drum2midi/Scripts/python.exe torch==2.8.0 torchaudio==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cu128
.venv-drum2midi/Scripts/python.exe ext/drum2midi/setup_env.py --no-render
# librosa 1.0이 audioread를 같이 깔지 않아 드럼 분리 단계가 ModuleNotFoundError로 멈춘다(2026-10-28 서버에서 확인)
uv pip install --python .venv-drum2midi/Scripts/python.exe audioread
```

별도 환경 모델은 GPU 메모리를 스크립트가 torch로 읽어 보내고(ADT_STR·IDM·YourMT3+), TensorFlow 모델(Omnizart)은 못 읽으므로 하네스가 실행 중 `nvidia-smi`를 0.25초마다 읽어 "최댓값 − 시작값"을 쓴다. 이 값은 곡별이 아니라 실행 전체의 최댓값이며 CSV `vramMethod` 열에 `script` / `nvidia-smi`로 구분한다.

### 채보 벤치마크를 코랩에서 돌리기

`notebooks/transcription_bench_colab.ipynb`를 코랩에서 열고 위에서부터 실행한다. 분리 벤치마크 ipynb 파일과 같은 방식이고, 이 ipynb 파일이 별도 환경 3개(ADT_STR·Inverse Drum Machine·Omnizart)까지 만든다. 환경 만들기는 세션마다 10~20분이 든다.

드라이브 `MyDrive/ssaplash/`에 올릴 것. 저장소 zip과 `data/synth_v1/`은 분리 벤치마크 때 올린 것을 그대로 쓴다.

| 드라이브 경로 | 내용 | 만드는 법 |
| --- | --- | --- |
| `data/gmd/groove/` | GMD test 연주 45개 + info.csv, 약 560MB | 아래 명령으로 뽑은 `data/upload/gmd/` 폴더를 `data/gmd/`로 올린다. GMD 전체(11GB)는 올리지 않는다 |
| `data/mdb_drums/` | 로컬 `AI/data/mdb_drums/` 폴더 그대로 (`MDB Drums/` 23곡, 331MB) | 폴더째 올린다 |

```bash
# gmd_test.yaml의 연주 45개와 info.csv만 data/upload/gmd/groove/ 에 복사하고, 복사본으로 곡 수·누락을 점검한다
uv run python scripts/pack_gmd_subset.py configs/bench/datasets/gmd_test.yaml data/upload/gmd
```

본측정 runId는 `drums-synth`·`drums-gmd`·`drums-mdb`·`drums-mdbu`(정답 드럼 입력), `mix-*`(원곡 입력), `sep-sw-*`·`sep-musdb-*`(분리 모델이 뽑은 드럼 입력)로 고정돼 있어, 세션이 끊기면 준비 셀(1~6)을 돌린 뒤 같은 셀을 다시 실행하면 이어서 돈다. 합친 보고서는 드라이브 `results/combined/`에 생긴다.

### 채보 벤치마크를 GPU 서버에서 돌리기

코랩 대신 학교 GPU 서버(JupyterHub)에서 모델을 더 돌릴 때 쓴다. 지금은 YourMT3+ 하나를 돌리고 결과를 코랩 결과와 합친다. 서버에는 드라이브가 없으므로 필요한 것을 zip 5개로 묶어 JupyterHub 홈 폴더에 올리고, `notebooks/transcription_bench_server.ipynb`를 같이 올려 위에서부터 실행한다.

```bash
# 올릴 zip 5개를 data/upload/server/ 에 만든다. 코랩 분리 드럼 캐시에 빠진 곡이 있으면 목록을 찍고 멈춘다
uv run python scripts/pack_server_upload.py
```

| zip | 내용 | 크기 |
| --- | --- | --- |
| `S15P31A307_code.zip` | 저장소 코드. git이 추적하는 파일과 아직 커밋하지 않은 새 파일 | 약 2MB |
| `data_synth_v1.zip`, `data_gmd.zip`, `data_mdb_drums.zip` | 합성곡 5곡, GMD test 연주 45개(`pack_gmd_subset.py`로 뽑은 것), MDB Drums 23곡 | 약 220·550·350MB |
| `results_separated.zip` | 코랩 `sep-*` run에서 분리 모델이 뽑아 둔 드럼 32곡. 서버에서 `--separated-dir`로 그대로 써서 분리 모델을 설치하지 않는다 | 약 600MB |

서버에서 다른 점

- **지정된 GPU만 쓴다.** 공용 서버라서 서버 ipynb 파일 1번 셀의 `GPU_ID`에 지정받은 번호를 넣는다. `CUDA_VISIBLE_DEVICES`로 그 GPU 하나만 보이게 한다.
- **torch를 CUDA 12.8판으로 바꿔 넣는다.** `uv.lock`의 Linux torch는 CUDA 13판이라 드라이버가 CUDA 12.8인 서버(드라이버 570)에서는 GPU를 못 잡고 경고 한 줄만 찍은 채 CPU로 돈다. 그래서 하네스 환경은 extra 없이 `uv sync`만 하고 CUDA 12.8판 torch를 `uv pip install`로 넣은 뒤, `uv run` 대신 `.venv/bin/ssaplash-bench`로 부른다(`uv run`이 잠금 파일대로 다시 맞추지 않게).
- **runId는 `ymt3-*`.** 코랩 run 폴더에 이어 붙이지 않고 새 폴더로 돌린다. 한 CSV 안에 GPU가 섞이지 않게 하기 위해서다.
- **보고서는 로컬에서 만든다.** 서버의 `results_ymt3.zip`(서버 ipynb 파일 12번 셀)을 내려받아 `data/results/`에 풀고 코랩 results.csv와 같이 `report-transcription`에 넘긴다. GPU가 다른 행이 섞인 묶음은 비교표에 GPU 열이 붙는다. 점수는 GPU와 상관없어 그대로 비교하고, RTF·GPU 메모리는 GPU가 달라 따로 본다.

### 채보 규칙 분석 도구 (S15P31A307-163)

1순위 채보 모델(ADTOF + 드럼 킷 분리)은 탐 3종·크래시/라이드를 규칙으로 나눈다(`configs/bench/transcribers/adtof_drumsep/adtof_drumsep.yaml`의 `rules`). 규칙값을 바꿔 가며 다시 재는 일을 빠르게 하기 위해, 무거운 계산(ADTOF·드럼 킷 분리)은 곡마다 한 번만 GPU로 돌려 저장하고 규칙 비교는 CPU로 몇 초 안에 한다.

```bash
# 1. 특징 저장 (GPU, 한 번). 정답 드럼 트랙 입력으로 ADTOF 타격 시각·프레임별 확신 점수와 드럼 킷 분리 트랙 전부(kick·snare·toms·hh·ride·crash)를 data/rule_features/<데이터셋>/<곡>.npz 에 둔다. 있으면 건너뜀.
#    2026-10-27 전에 만든 파일은 점수와 kick·snare·hh 트랙이 없으므로 --overwrite 로 다시 만든다 (탐 시각 다시 고르기·거르기 분모 옵션에 필요)
uv run ssaplash-bench rule-features --dataset configs/bench/datasets/gmd_test.yaml configs/bench/datasets/mdb_drums.yaml
# 2. 정답 탐 타격의 음높이 분포·경계 후보·곡 하나 빼고 확인. 후보는 candidates.yaml로 나와 3번에 바로 넣는다
uv run ssaplash-bench tom-pitch --dataset configs/bench/datasets/mdb_drums.yaml configs/bench/datasets/gmd_test.yaml --out data/results/tom-pitch
# 3. 규칙 후보 비교 (CPU). 후보 하나 = MLflow run 하나(실험 chart-rules). 기본값(후보 rules: {})으로 돌리면 지난 벤치마크 hits_by_class.csv와 같은 개수가 나와야 한다
uv run ssaplash-bench rule-eval --dataset configs/bench/datasets/gmd_test.yaml configs/bench/datasets/mdb_drums.yaml --candidates data/results/tom-pitch/candidates.yaml --out data/results/rule-eval --mlflow-uri mlruns
```

후보 yaml은 `candidates: [{name, rules}]` 목록이거나 `{name, rules}` 하나이며 `rules`는 모델 yaml의 `rules`와 같은 키만 쓴다(없는 키는 기본값). 결과 폴더에 `candidates.csv`(후보 × 데이터셋: 패드별 F1, 탐·심벌 배정 정확도, 정답 없는 탐 수, 버린 탐 수), `confusion.csv`·`summary.md`(혼동표), `by_song.csv`(곡마다 버린 탐 수 `tomDropped`, 묶음 수·중앙값 `tomClusters`·`tomClusterHz`)가 생긴다. `--two-tom-upper MID_TOM`을 주면 정답에 탐 패드가 둘뿐이고 하나가 플로어탐인 곡의 나머지 탐 이름을 미드로 바꿔 채점한다(전자 드럼 데이터가 탐 둘 연주의 위쪽 탐을 스몰로 적는 것을 실제 킷 표기에 맞추는 용도. 2026-10-28 결정). 배정 정확도는 정답과 시각이 맞은 타격 중 패드를 맞게 붙인 비율로, 모델이 놓치거나 잘못 잡은 것은 빼고 규칙만의 성능을 본다. `run-transcription`도 이제 MLflow에 패드별 F1(`f1_KICK` 등)과 규칙값(`rules.tom_bands` 등)을 함께 남겨 run끼리 패드 단위로 비교할 수 있다.

탐 규칙에는 아래 선택 키가 있다 (S15P31A307-164 실험). 코드 기본값은 전부 꺼져 있어 안 넣으면 결과가 전과 같다. 서비스가 쓰는 `adtof_drumsep.yaml`은 2026-10-31부터 `tom_gate_ratio 0.10`·`tom_peak_mode raw`·`tom_mode relative`·`tom_relative_method peaks`·`tom_relative_naming hybrid`·`tom_relative_min_gap 3.0`·`cymbal_crash_weight 0.7`을 켠다(결과 `docs/chart-rules/tom-finetune-2026-10-31/`). 거르기를 켜려면 어댑터 입력 드럼이 필요하며, `rule-eval`·`tom-pitch`는 데이터셋의 정답 드럼 트랙을 자동으로 읽어 쓴다.

| 키 | 기본값 | 뜻 |
| --- | --- | --- |
| `tom_mode` | `fixed` | `fixed`: 고정 Hz 경계 `tom_bands`. `relative`: 곡 안의 탐 타격 음높이를 모아 큰 틈에서 1~3묶음으로 나누고 낮은 순서로 FLOOR·MID·SMALL |
| `tom_relative_k` / `tom_relative_min_gap` / `tom_relative_min_hits` | 3 / 2.0 / 2 | 최대 묶음 수, 묶음을 가르는 최소 틈(반음), 묶음 하나의 최소 타격 수(작으면 이웃에 합침) |
| `tom_relative_naming` | `bands` | 묶음이 3개보다 적을 때 이름. `bands`는 묶음 중앙값을 고정 경계로 정하고 둘이 같으면 순서로 벌림, `order`는 1개 MID·2개 FLOOR·MID. `hybrid`는 묶음 수와 절대 음높이를 같이 봄: 1개면 `tom_hybrid_floor_max_hz`(120) 아래 FLOOR·`tom_hybrid_small_min_hz`(200) 위 SMALL·사이 MID, 2개면 낮은 쪽은 120 아래일 때만 FLOOR 아니면 MID, 높은 쪽은 200 위일 때만 SMALL 아니면 MID. 실제 킷은 탐이 둘인 경우가 많고 그 랙탐이 160~180Hz라 MID로 두는 쪽이 정답 표기와 맞음 |
| `tom_relative_method` | `gap` | 곡 안 음높이를 묶는 법. `gap`은 반음으로 정렬해 이웃 사이 틈이 `tom_relative_min_gap` 이상인 곳에서 자름(타격이 수백 개면 틈이 안 생겨 한 묶음이 됨). `peaks`는 반음 히스토그램(칸 `tom_relative_bin` 0.25, 부드럽게 `tom_relative_smooth` 0.5)의 피크를 찾아 가장 가까운 피크에 붙임. 피크 사이 최소 거리는 `tom_relative_min_gap`. `tom_relative_min_frac`(0)은 묶음 하나의 최소 타격 비율로, `tom_relative_min_hits`와 둘 중 큰 쪽을 씀 |
| `tom_f0_method` | `peak` | 음높이 재는 법. `peak`는 구간 전체 스펙트럼의 가장 큰 피크 하나, `median`은 구간을 `tom_f0_frame_ms`(40) 길이·`tom_f0_hop_ms`(20) 간격 프레임으로 잘라 프레임마다 재고 중앙값. 킥 겹침이 한 프레임에만 있을 때 흔들리지 않음. `tom_f0_start_ms`(0)는 타격 뒤 얼마부터 잴지 |
| `tom_gate_ratio` | 없음 | 켜면 타격 직후 toms 트랙 에너지 / 입력 드럼 에너지가 이 값 아래인 탐 타격을 거른다(탐이 아닌 소리를 탐으로 잡은 것). 재는 구간은 `tom_gate_window_ms`, 없으면 `window_ms` |
| `tom_gate_action` | `drop` | 거른 탐을 어떻게 할지. `drop`은 버림, `snare`는 50ms 안에 ADTOF 스네어 타격이 없으면 SNARE로 돌리고 있으면 버림 |
| `cymbal_crash_weight` | 1.0 | 심벌 판정에서 crash 트랙 에너지에 곱하는 값. 1보다 크면 크래시 쪽으로 기움. 크래시·라이드를 따로 내는 체크포인트(`five_pedal_cym`)면 이 규칙 대신 모델 출력을 씀 |
| `tom_threshold` | 없음 = 0.32 | ADTOF 탐 확신 점수의 기준값. 저장 특징에 프레임별 점수가 있을 때만 적용 |
| `tom_peak_mode` | `madmom` | 탐 타격 시각 고르기. `madmom`은 저장소 방식(100ms 이동평균을 뺀 뒤 기준값 비교), `raw`는 이동평균을 빼지 않음. 50~70ms 간격 더블·롤의 두 번째 타격이 살아남는다 |
| `tom_gate_mode` | `input` | 거르기 비율의 분모. `input`은 입력 드럼 전체, `others`는 snare·hh·crash·ride 트랙 합 |
| `tom_kick_drop_ms` | 없음 | 켜면 탐 이름을 붙인 뒤 `tom_kick_drop_pads`(기본 FLOOR_TOM)에 든 탐이 ADTOF 킥 타격과 이 거리(ms) 안이면 버린다. `tom_kick_drop_max_score`를 주면 탐 확신 점수가 그 값 미만인 것만 버린다. 파인튜닝 모델이 실제 킥을 킥과 플로어탐으로 함께 내는 경우를 보려고 넣었고 채택하지 않았다. 버린 수는 `tomKickDropped` 열 |
| `tom_gate_low_rescue` | 없음 | 켜면 거르기 기준 아래여도 (toms+kick 트랙)/분모가 이 값 이상이고 확신 점수가 `tom_gate_low_min_score`(0.5) 이상이며 음높이가 `tom_low_hz`(60~130Hz) 안인 타격을 탐으로 남긴다. 분리 모델이 낮은 플로어탐을 kick 트랙에 넣는 경우 대응 |

`by_song.csv`의 `tomRescued`가 그렇게 남긴 수다. `tomConsistentAcc`·`f1TomConsistent`는 곡 안에서 탐 이름만 서로 바뀐 것(탐 둘인 킷의 위쪽 탐을 MID로 적을지 SMALL로 적을지)을 맞은 것으로 친 보조 지표로, 곡마다 정답 패드와 붙인 패드를 가장 잘 맞춰 주는 일대일 대응으로 센다. 2026-10-28 비교 결과는 `docs/chart-rules/tom-detect-2026-10-28/`.

`tom-pitch`는 ADTOF가 탐으로 잡은 타격마다 음높이·거르기 비율·짝지은 정답 탐·근처 정답 패드를 `pred_tom.csv`에 남기고, 거르기 비율 분포(`tom_gate_ratio.png`)와 문턱값별로 버려지는 정답 탐·정답 없는 탐 수를 `summary.md`에 적는다.

drum2midi 원본(`external/drum2midi.yaml`)과 우리 규칙 후보는 `scripts/compare_drum2midi.py`로 같은 표에 놓는다. run-transcription 결과 폴더와 rule-eval 결과 폴더를 받아 8패드·탐 3종·크래시와 라이드·킥과 스네어와 하이햇·탐 검출 F1을 50ms 기준으로 세고, 곡 단위로 2,000번 다시 뽑은 95% 구간과 같은 곡끼리 짝지은 탐 3종 F1 차이 구간을 붙인다. 구간이 0을 포함하면 그 데이터로는 어느 쪽이 나은지 판정할 수 없다는 뜻이다. rule-eval은 `--two-tom-upper` 없이 돌린 결과를 써야 정답 표기가 같다.

```bash
uv run python scripts/compare_drum2midi.py --run d2m=data/results/d2m-drums-mdb --run d2m=data/results/d2m-drums-gmd --rule-eval fixed=data/results/rule-eval-tom-detect --rule-eval pk_gap30=data/results/rule-eval-tom-final --out data/results/compare-drum2midi.md
```

정답 탐과 짝이 안 된 탐 예측이 어느 악기 자리에서 나오는지는 `scripts/check_false_toms.py`로 센다. rule-eval과 같은 특징·규칙 후보로 탐 예측을 다시 만들고, 짝이 안 된 탐마다 ±50ms 안 정답 주석(ENST는 `bd`·`sd`·`chh` 같은 원래 라벨, 다른 데이터는 정답 패드)과 같은 자리의 ADTOF 킥 타격 여부, 탐 확신 점수를 적는다. 특징 폴더를 여럿 주면 같은 곡끼리 나란히 놓는다.

```bash
uv run python scripts/check_false_toms.py --features base=data/rule_features --features tom_6cls=data/rule_features_ft_tom_6cls --dataset configs/bench/datasets/enst_minus_one.yaml --song-prefix drummer_1 --candidates docs/chart-rules/tom-newkits-2026-10-29/candidates.yaml --candidate pk_gap30 --out data/results/false-toms-enst-drummer_1.md
```

### 채보 모델 파인튜닝 (S15P31A307-164)

1순위 채보 모델 ADTOF Frame_RNN(파라미터 45만 개)을 E-GMD·STAR Drums의 정답 드럼 트랙으로 더 학습시켜 탐 검출을 올린다. 2026-10-31 결과로 파인튜닝 가중치는 채택하지 않았다. MDB 탐은 올랐지만 학습에 안 쓴 실제 녹음 ENST에서 탐이 떨어졌다(`docs/chart-rules/tom-finetune-2026-10-31/summary.md`). 서비스는 기본 가중치 그대로이고 아래 도구는 재시도용으로 남긴다. 모델 구조·입력 특징은 그대로이고 가중치 파일만 바뀌므로 어댑터·벤치마크·서비스 추론은 yaml의 `checkpoint_path`만 바꾸면 그대로 돈다. 원본 ADTOF 학습 코드는 Keras이고 학습 데이터는 신청제라 학습 코드를 새로 썼다(`src/ssaplash_ai/train/`). 학습은 GPU 서버에서 `notebooks/tom_finetune_server.ipynb`로 돌리고, 로컬은 pytest의 합성 데이터 몇 스텝(CPU)까지만 한다.

```bash
# 1. 학습. best.pth·last.pth·log.csv(에폭별 손실·검증 F1)·config.yaml 복사본이 --out에 생긴다
uv run ssaplash-train adtof-finetune --config configs/train/adtof_tom_5cls.yaml --out data/models/adtof_ft/tom_5cls
# 페달 하이햇 출력을 더한 학습 (5가지 + HIHAT_PEDAL)
uv run ssaplash-train adtof-finetune --config configs/train/adtof_tom_6cls.yaml --out data/models/adtof_ft/tom_6cls
# 심벌을 크래시·라이드로 나눈 7출력 학습 (킥·스네어·탐·하이햇·크래시·페달·라이드)
uv run ssaplash-train adtof-finetune --config configs/train/adtof_tom_7cls.yaml --out data/models/adtof_ft/tom_7cls
# 2. 기본 가중치와 파인튜닝 가중치를 같은 데이터셋에서 5가지(킥·스네어·탐·하이햇·심벌) F1로 비교. --checkpoint를 비우면 기본 가중치
uv run ssaplash-train adtof-eval --checkpoint data/models/adtof_ft/tom_5cls/best.pth --dataset configs/bench/datasets/mdb_drums.yaml configs/bench/datasets/enst_minus_one.yaml --out data/results/adtof-eval-ft
# 3. 규칙까지 포함한 8패드 점수. 분리 트랙은 기존 특징에서 복사하고 채보 모델 점수만 다시 계산한 뒤 rule-eval
uv run ssaplash-bench rule-features --model configs/bench/transcribers/adtof_drumsep/adtof_drumsep_ft.yaml --dataset configs/bench/datasets/mdb_drums.yaml --out data/rule_features_ft --stems-from data/rule_features
uv run ssaplash-bench rule-eval --features data/rule_features_ft --dataset configs/bench/datasets/mdb_drums.yaml --candidates docs/chart-rules/tom-newkits-2026-10-29/candidates.yaml --out data/results/rule-eval-ft
# 4. 페달 하이햇 비교표. rule-eval 결과(이름=폴더@후보)와 run-transcription 결과(이름=폴더)를 같은 기준으로 셈
uv run python scripts/score_pedal.py --rule-eval base=data/results/rule-eval-base-pedal@pk_gap30 --rule-eval tom_6cls=data/results/rule-eval-ft-tom_6cls@pk_gap30 --run d2m_learned=data/results/d2m-learned-mdb --baseline base --out data/results/pedal-compare.md
# 5. 크래시·라이드 비교표. rule-eval 결과(이름=폴더@후보)마다 크래시·라이드 F1, 심벌 혼동, 다른 패드 F1과 채택 판정
uv run python scripts/score_cymbal.py --rule-eval now=data/results/rule-eval-base-cymbal@pk_gap30 --rule-eval cw150=data/results/rule-eval-base-cymbal@cw150 --rule-eval tom_7cls=data/results/rule-eval-ft-tom_7cls@pk_gap30 --baseline now --out data/results/cymbal-compare.md
```

학습 설정 yaml의 주요 키. 기본값은 ADTOF 원본 Frame_RNN 설정(윈도 412프레임, 배치 32, 이진 교차 엔트로피, 정답 앞뒤 1프레임 번짐, 클래스 가중치 킥 1.078·스네어 1.353·탐 3.414·하이햇 1.144·심벌 1.768)이고 학습률만 파인튜닝이라 원본의 1/5인 0.0001이다.

| 키 | 뜻 |
| --- | --- |
| `classes` | `five`: 5가지 그대로(페달 하이햇은 하이햇으로 학습). `five_pedal`: 5가지 + 페달 하이햇 출력(GM 44번), 페달 출력층은 하이햇에서 복사. `five_pedal_cym`: five_pedal에서 심벌을 크래시(49)·라이드(51)로 나눈 7출력, 크래시·라이드 출력층은 심벌에서 복사. 이 체크포인트를 드럼 킷 분리 어댑터에 쓰면 crash·ride 트랙 에너지 비교 대신 모델 출력을 그대로 씀. `pads`: 패드 9종을 직접 내는 변형. 출력층 9개를 5클래스 가중치에서 복사해 초기화(탐 3개 ← 탐, 크래시·라이드 ← 심벌, 페달 ← 하이햇) |
| `train_datasets` / `val_datasets` | 데이터셋 yaml과 뽑을 비율(`weight`) / 검증에 쓸 yaml과 곡 수(`n_songs`, 고정 시드). 검증은 E-GMD validation·STAR validation 20곡씩이고 MDB·ENST·GMD test·E-GMD test·STAR test는 학습 뒤 한 번만 본다 |
| `tom_window_frac` / `tom_weight_mult` | 탐 강조 둘. 윈도 중 정답 탐 타격을 가운데 두고 자르는 비율(0.5) / 탐 클래스 가중치 배수(2.0). 안 쓰려면 0과 1 |
| `pedal_weight_mult` | 페달 클래스 가중치 = 하이햇 가중치 × 이 값(2.0). `five_pedal`·`pads`만 |
| `accomp_mix_prob` / `accomp_gain_range` | 반주가 있는 곡(STAR)에서 반주를 섞을 확률(0.3)과 게인(0.05~0.3). 분리 결과에 남는 반주 소리를 흉내 냄 |
| `select_metric` | 검증에서 best.pth를 고르는 기준. 기본 `tom_f1`(탐 검출 F1). `f1`은 5가지 합계, `tom_pedal_f1`은 탐 F1과 페달 F1의 평균, `focus_f1`은 탐·페달·크래시·라이드 F1의 평균(`five_pedal_cym`) |
| `guard_drop` | 학습 시작 전에 기본 가중치를 5클래스로 검증한 점수가 기준값. 5가지 클래스 F1 중 하나라도 기준값보다 이만큼(0.02) 넘게 떨어진 에폭은 best.pth로 고르지 않음. log.csv의 `guard` 열과 에폭 -1 줄(학습 시작 가중치 점수)로 확인. 조건을 넘는 에폭이 없으면 마지막 가중치를 저장하고 경고 |
| `fit_thresholds` | 학습 끝에 검증 곡으로 클래스별 문턱값(0.10~0.60, 0.02 간격)을 맞춰 체크포인트 `model_info.thresholds`에 저장. 어댑터가 그 값을 읽고, yaml `thresholds`가 있으면 그것이 우선 |
| `freeze_cnn` | 켜면 CNN 블록은 고정하고 GRU·출력층만 학습 |

끊긴 학습은 같은 명령에 `--resume`을 붙이면 `--out`의 `last.pth`·`log.csv`에서 이어 간다. 최고점·안 오른 에폭 수·학습률은 `log.csv`로 다시 계산하고, 옵티마이저 상태는 저장하지 않아 새로 시작한다. GPU 서버에서는 학습을 하나씩 돌리는 `scripts/train_queue.py`(`start`·`status`·`stop`)를 노트북 5·6번 셀이 부른다. 학습마다 실행 폴더에 코드 사본을 풀어 돌리므로, 학습 중에 공유 코드 폴더를 다시 풀어도 도는 학습은 바뀌지 않는다.

체크포인트는 기본 가중치 파일과 같은 `{'model_weights': state_dict, 'model_info': {...}}`이고 `model_info`에 `class_set`(five·five_pedal·five_pedal_cym·pads)·`classes`(원래 라벨: five 계열은 MIDI 피치, 9패드는 패드 이름)·`thresholds`·학습 설정·검증 점수가 들어간다. `adtof` 어댑터는 `checkpoint_path`의 이 정보를 읽어 출력 수·라벨·문턱값을 정하고, 정보가 없는 옛 파일은 지금처럼 5클래스·저장소 기본 문턱값으로 돈다. 9패드 체크포인트는 `configs/bench/transcribers/adtof/adtof_ft_9cls.yaml`처럼 `labels`에 `KICK: KICK`으로 적는다. 페달 출력이 있는 체크포인트를 드럼 킷 분리 어댑터에 쓸 때는 `adtof_drumsep_ft6.yaml`처럼 `labels`에 `HIHAT_PEDAL: HIHAT_PEDAL`을 더한다. 파인튜닝한 가중치의 라이선스는 원본과 같은 CC BY-NC-SA 4.0이다.

## 팀 MLflow에 기록하기

팀 MLflow 서버는 SSH 터널로만 붙는다(`Infra/mlflow/README.md`). 터널을 연 PC에서 벤치마크를 돌리면 `--mlflow-uri http://localhost:5000`으로 바로 기록한다. 코랩·학교 GPU 서버는 팀 서버에 못 붙으므로 `--mlflow-uri none`으로 돌리고, 결과 폴더를 PC로 가져와 `relog`로 올린다. 결과 파일이 원본이고 MLflow 기록은 거기서 다시 만든다.

```bash
# 터널 (창 하나를 열어 둔다)
ssh -i <키 파일> -L 5000:localhost:5000 ubuntu@k15a307.p.ssafy.io
# 1. 로컬 파일 저장소(mlruns/)의 run을 먼저 그대로 복사 (확인용 local-*·check-* run은 뺌).
#    같은 runId가 CSV 폴더에도 있으면 규칙값 파라미터까지 있는 이쪽이 남도록 먼저 올린다
uv run ssaplash-bench relog --from-mlruns mlruns --mlflow-uri http://localhost:5000 --dry-run
uv run ssaplash-bench relog --from-mlruns mlruns --mlflow-uri http://localhost:5000
# 2. 결과 폴더. 먼저 --dry-run으로 폴더마다 종류·실험·runId·지표 개수, 이미 올라간 것은 '건너뜀(중복)'
uv run ssaplash-bench relog data/results data/models/adtof_ft --recursive --mlflow-uri http://localhost:5000 --dry-run
# 3. 올리기. 여러 번 쳐도 같은 runId는 한 번만 올라간다
uv run ssaplash-bench relog data/results data/models/adtof_ft --recursive --mlflow-uri http://localhost:5000
```

| 폴더 종류 (판별 기준) | 실험 | run 단위·runId | 지표 |
| --- | --- | --- | --- |
| 분리 벤치마크 (`results.csv`에 `sdrDrums`) | `separation-bench` | 폴더, CSV `runId` | `run`과 같음 |
| 채보 벤치마크 (`results.csv`에 `f1Five50`) | `transcription-bench` | 폴더, CSV `runId` | `run-transcription`과 같음 (패드별 F1 포함) |
| 규칙 채점 (`candidates.csv`) | `chart-rules` | 후보, `폴더 이름/후보 이름` | `{데이터셋}/{열}` |
| 파인튜닝 학습 (`log.csv`·`config.yaml`·`best.pth`) | `adtof-finetune` | 학습 폴더 이름 | `log.csv` 열을 에폭 단위 이력으로(step = 에폭 + 1), `best/*`, `reference/*` |
| 체크포인트 평가 (`summary.csv`가 `checkpoint,dataset`로 시작) | `adtof-eval` | 폴더 이름 | `{체크포인트}/{데이터셋}/{열}` |

`--recursive`는 `check-*`·`local-*`·`*-check`·`combined*`·`tom-pitch*`·`tom-detect-*`·`smoke_*` 폴더와 분리 wav·MIDI 폴더에 들어가지 않는다. 다시 올린 run에는 `relogged=true`·`sourceDir` 태그가 붙고, 원래 실행 때만 알 수 있던 `clip`·`nSkipped`는 비어 있다. `dataset` 파라미터는 yaml 이름이 아니라 CSV의 `dataset` 값이다. `rule-eval`은 이제 후보 yaml을 결과 폴더에 `candidates.yaml`로 남겨, 다시 올릴 때도 규칙값이 `rules.*` 파라미터로 붙는다(그 전 결과 폴더는 후보 이름만).

## 지표 정의

분리 벤치마크 지표. 곡 단위 값이고 모델 단위 값은 곡 값들의 중앙값이다. 자세한 계산 규칙은 `src/ssaplash_ai/bench/metrics/` 각 파일 머리말에 있다.

| CSV 열 | 뜻 | 계산 |
| --- | --- | --- |
| `sdrDrums`, `sdrAccomp` | 분리 품질 (dB). 정답과 예측이 얼마나 가까운지 | museval(BSS Eval v4)에 정답·예측 드럼과 반주 2소스를 넣고 1초 프레임 값의 중앙값. 예측 반주 = 원곡 − 예측 드럼 |
| `sirAccomp`, `sarAccomp` | 반주에 남은 드럼 누설, 인공음 (dB) | 같은 museval 호출. 드럼 쪽 `sirDrums`·`sarDrums`도 보조로 기록 |
| `siSdrDrums`, `siSdrAccomp` | 배율 불변 SDR (dB) | 곡 전체 1회 |
| `onsetF1`, `onsetPrecision`, `onsetRecall` | 타격 보존율. 정답 타격 시각을 예측 드럼에서 얼마나 되찾는지 | librosa 스펙트럼 플럭스 온셋 검출(hop 512 샘플)을 예측 드럼에 적용, mir_eval로 ±50ms 매칭. 정답 온셋은 합성곡이면 MIDI, MUSDB면 정답 드럼 스템에 같은 검출기 적용 |
| `onsetF1Tight` | 같은 것, ±25ms | |
| `attackSlopeDistortion` | attack slope는 드럼을 친 직후 10ms 동안 소리가 커지는 기울기(Beyond SDR 논문 용어). 분리한 드럼의 이 기울기가 정답 드럼과 얼마나 달라졌는지를 잼. 0이면 원음 그대로, 클수록 타격 앞머리가 뭉개진 것. 뭉개지면 채보 모델이 타격 시각을 늦게 잡거나 놓치므로 봄 | 정답 온셋마다 온셋 후 10ms 구간을 1ms 블록 최댓값 포락선으로 만들고 최소제곱 기울기를 구해 \|ln(예측 기울기 / 정답 기울기)\|를 평균. Beyond SDR 논문의 attack slope를 단순화한 것이라 논문 수치와 직접 비교하지 않는다 |
| `separateSec`, `rtf` | 분리 시간(초), RTF = 분리 시간 / 곡 길이 | 벽시계. 모델 로드 제외. 로드 직후 첫 곡을 한 번 분리하고 버려(워밍업, `--no-warmup`으로 생략) GPU 커널 준비 시간을 뺀다 |
| `loadSec` | 모델 로드 시간 | 가중치 다운로드 제외. 곡마다 같은 값 반복 |
| `peakRamMb`, `peakVramMb` | 분리 중 최대 메모리 (MB) | RAM은 50ms마다 프로세스 RSS 표본의 최댓값, VRAM은 torch 최대 할당량. CPU 실행이면 VRAM은 nan |

무음 예측의 BSS 값은 정의되지 않으므로 `-inf`로 적는다. 비교표에는 ADR-011의 6개 지표와 가중치 라이선스만 올리고 나머지는 보조값 표에 둔다.

### 채보 지표

정답 타격 표와 모델 예측 표를 드럼 종류(라벨)별로 나눠 ±50ms 안에서 1:1로 짝짓는다(mir_eval). 짝 = 맞힌 것(tp), 예측에만 있으면 헛것(fp), 정답에만 있으면 놓친 것(fn). 모든 라벨의 개수를 더해 정밀도·재현율·F1을 내고(논문 표의 SUM), 묶음 단위 값은 곡들의 개수를 다시 더해 계산한다(곡별 평균 아님). 계산은 `metrics/hit_f1.py`.

| CSV 열 | 뜻 | 계산 |
| --- | --- | --- |
| `tpFive50`, `fpFive50`, `fnFive50`, `f1Five50`, `precFive50`, `recFive50` | 5가지(킥·스네어·하이햇·탐·심벌) 기준 개수와 곡 단위 F1·정밀도·재현율 | 정답 패드 → 5가지 묶음, 예측도 같게(`tom`·`cymbal`은 그대로). 모든 모델에 매김. 논문 수치 검산용 |
| `…Five25`, `f1Five25` | 같은 것 ±25ms | |
| `tpPads50` … `f1Pads25` | 8패드 기준 | 8패드를 다 내는 모델(`eightPad` 참)만. 아니면 NaN |
| `perfectRatio` | Perfect 폭 적중률 = ±25ms F1 ÷ ±50ms F1 | 8패드가 있으면 8패드 기준, 없으면 5가지 기준. ±50ms F1이 0이면 NaN |
| `meanErrMs`, `meanAbsErrMs` | 짝지은 쌍의 (예측 − 정답) 시각 평균(부호 있음, 늦게 찍는 경향)과 절댓값 평균 (ms) | ±50ms 창 |
| `f1Any50` | 라벨을 무시하고 시각만 맞춘 F1 | 분리 벤치마크 타격 보존율과 같은 계산. 보조 |
| `velocityCorr` | 세기 상관 | 정답·예측 모두 세기가 있고 짝이 10개 이상일 때 피어슨 상관. 아니면 NaN |
| `hitsTrue`, `hitsPred`, `hitsPredDropped` | 정답 타격 수, 예측 타격 수, 패드 밖이라 뺀 예측 수 | |
| `transcribeSec`, `rtf`, `loadSec`, `peakRamMb`, `peakVramMb`, `vramMethod` | 채보 시간·RTF(채보 시간 ÷ 곡 길이)·로드 시간·메모리 | 샘플레이트 변환·MIDI 읽기는 채보 시간에 포함, 로드·다운로드·분리는 제외. 분리 시간은 `separateSec` |

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

채보 모델은 "몇 초에 어느 패드를 쳤는지"를 맞혀야 하므로 타격 시각과 패드가 적힌 정답이 필요하다. 패드는 스틱 통신 프로토콜 v0.7과 같은 이름의 9종 `KICK, SNARE, HIHAT, SMALL_TOM, MID_TOM, FLOOR_TOM, CRASH, RIDE, HIHAT_PEDAL`이고(`bench/datasets/pads.py`. 옛 `HI_TOM`은 2026-10-26부터 `SMALL_TOM`). `HIHAT_PEDAL`은 페달만 밟아 난 하이햇 소리(GMD·E-GMD 44번, MDB·STAR `PHH`)로 2026-10-30부터 정답에서 따로 읽는다. 8패드 점수(`pads` 기준)는 지금까지와 같게 정답·예측의 `HIHAT_PEDAL`을 `HIHAT`에 합쳐 내고, 페달 점수는 `pads9` 기준(`hits_by_class.csv`의 `scheme` 열, 혼동 수 `PEDAL_AS_HIHAT`·`HIHAT_AS_PEDAL` 행은 짝 수를 `tp` 칸에)과 rule-eval의 `f1Pedal`·`pedalAsHihat` 등 열에 따로 낸다, 카우벨·클랩·탬버린처럼 패드에 없는 타격은 정답에서 빼고 개수만 센다. 세 묶음을 쓰며 묶음마다 점수를 따로 낸다.

| 설정 | 내용 | 역할 |
| --- | --- | --- |
| `synth_v1.yaml` | 합성곡 5곡. 원곡·정답 드럼·MIDI 타격 정답 | 분리 모델을 거친 뒤 채보 점수가 얼마나 떨어지는지 |
| `gmd_test.yaml` | GMD test split 드럼 연주 45개(52분). 드럼만 있는 전자 드럼 녹음 + MIDI 타격 정답 | 드럼 트랙 입력 채보, 8패드별 점수 |
| `mdb_drums.yaml` | MDB Drums 23곡(22분). 실제 밴드 녹음, 원곡·드럼 트랙·사람이 적은 타격 정답 | 논문 수치와 검산 |
| `mdb_drums_unseen.yaml` | 위 23곡 중 MUSDB18 train에 없는 11곡 | 분리 모델을 거치는 평가는 이 묶음만 (아래 참고) |
| `egmd_test_acoustic.yaml` | E-GMD(GMD 연주를 Roland TD-17 킷 43개로 다시 녹음, CC BY 4.0) test 분할 중 `gmd_test.yaml`의 연주 45개 × 어쿠스틱 음색 킷 26개 = 1170개(22.7시간). 로더는 `bench/datasets/gmd.py`의 `EgmdDataset`, 곡 id는 오디오 파일 이름 | 킷이 바뀔 때 탐 규칙 검증 (S15P31A307-164). 96GB 전체는 GPU 서버에 받고 목록 csv 9.6MB만 로컬에 둬도 곡 목록은 뽑힘 |
| `star_drums_test.yaml`, `star_drums_validation.yaml` | STAR Drums(Weber 외 2025) test·validation 분할. 실제 반주에 샘플 킷 20개(어쿠스틱 15·전자 5)로 합성한 드럼, 탐 3종(HT·MT·LT) 정답. 미리보기 1곡은 `star_drums_preview.yaml` | 킷이 바뀔 때 탐 규칙 검증 (S15P31A307-164). 오디오는 CC BY-NC-SA·개별 라이선스라 평가·연구용. 181GB 전체는 GPU 서버에 받고 로더는 `bench/datasets/star.py` |
| `enst_minus_one.yaml` | ENST-Drums(Gillet & Richard 2006) 중 반주가 있는 minus-one·MIDI-minus-one 64곡. 실제 드러머 3명 녹음, 탐 약 2,600타. 입력 드럼은 `wet_mix`, mixture는 `wet_mix` + 반주 × `extra.accomp_gain`(0.5). 드러머 3은 탐 넷이라 `extra.tom4`로 패드 3개에 대응(랙탐 둘은 스몰·미드, 플로어탐 둘은 플로어). 로더는 `bench/datasets/enst.py` | 실제 녹음에서 탐 규칙·파인튜닝 전후 비교 (S15P31A307-164). 이용 조건이 본인만·연구용·평가 전용(변형물 금지)이라 학습에 못 쓰고 공유하지 않음. 결과 공개 시 Gillet & Richard ISMIR 2006 인용. 서버에만 있음 |
| `gmd_train.yaml`, `egmd_train_acoustic.yaml`, `egmd_validation_acoustic.yaml`, `star_drums_training_ismir04.yaml`, `star_drums_training_mtg.yaml` | 채보 모델 탐 파인튜닝의 학습·검증 분할. GMD train 846개(beat+fill), E-GMD train 어쿠스틱 26킷 21,294개(206시간)·validation 3,042개, STAR training ISMIR04 약 1,228곡·MTG-Jamendo 약 4,807곡. GMD·E-GMD 로더는 `subset`(train·validation·test)과 `extra.beat_type`(beat·fill·all·목록)으로 분할을 고름. `gmd_train.yaml`은 학습 설정에서 뺐다(GPU 서버에는 GMD test 분할만 있고, 같은 연주를 26킷으로 친 것이 E-GMD train에 있음. 2026-10-30) | 파인튜닝 학습 (S15P31A307-164). 평가 분할(GMD test·MDB·ENST·E-GMD test·STAR test)과 겹치지 않음. 서버에만 있음 |

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
- Jira: 에픽 `[CHART] 채보` (S15P31A307-29). 분리 벤치마크(-101~-105)는 스토리 CHART-004 음원 드럼 분리 (S15P31A307-69), 채보 벤치마크(-106~-110)는 스토리 CHART-003 음원 → 채보 생성 (S15P31A307-62). 서비스 추론 모듈은 분리(-167·-168)가 CHART-004, 채보(-169~-171)가 CHART-003
