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
├─ pyproject.toml        패키지·의존성·ruff·pytest 설정, ssaplash-bench·ssaplash-chart 명령 진입점
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
│   ├─ chart/            서비스 추론 모듈. config(설정 yaml·환경 변수), audio_io(원곡 읽기·트랙 쓰기), errors(예외 분류),
│   │                    separation(음원 분리 SeparationModule), cli(ssaplash-chart 명령)
│   └─ server/           AI 서버 진입점 app.py (FastAPI, /health)
├─ configs/bench/datasets/  데이터셋 설정 yaml, 합성곡 레시피
├─ configs/bench/models/    분리 모델 설정 yaml. 어댑터별 폴더 (msst, demucs, openunmix, mock=테스트용)
├─ configs/bench/transcribers/  채보 모델 설정 yaml + 라벨 → 패드 대응표 (adtof, adtof_drumsep, external, mock)
├─ configs/chart/        서비스 추론 모듈 설정 yaml (separation.yaml, 모델 없이 흐름만 확인하는 separation_mock.yaml)
├─ scripts/              데이터 준비 스크립트 (make_synth_songs.py, pack_gmd_subset.py, pack_server_upload.py), 별도 환경 채보 스크립트 (transcribers_ext/)
├─ ext/                  채보 모델 저장소 클론·코드 (ADT_STR, inverse-drum-machine, YourMT3. git 미추적)
├─ .venv-*/              채보 모델 별도 가상환경 (git 미추적)
├─ tests/                pytest. src와 같은 폴더 구조. 실제 데이터·모델 없이 테스트용 wav와 mock 어댑터로 돈다
├─ notebooks/            실행용 ipynb 파일 (코랩: bench_colab.ipynb 분리, transcription_bench_colab.ipynb 채보 / GPU 서버: transcription_bench_server.ipynb 채보)
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
# 1. 특징 저장 (GPU, 한 번). 정답 드럼 트랙 입력으로 ADTOF 타격 시각과 toms·crash·ride 트랙을 data/rule_features/<데이터셋>/<곡>.npz 에 둔다. 있으면 건너뜀
uv run ssaplash-bench rule-features --dataset configs/bench/datasets/gmd_test.yaml configs/bench/datasets/mdb_drums.yaml
# 2. 정답 탐 타격의 음높이 분포·경계 후보·곡 하나 빼고 확인. 후보는 candidates.yaml로 나와 3번에 바로 넣는다
uv run ssaplash-bench tom-pitch --dataset configs/bench/datasets/mdb_drums.yaml configs/bench/datasets/gmd_test.yaml --out data/results/tom-pitch
# 3. 규칙 후보 비교 (CPU). 후보 하나 = MLflow run 하나(실험 chart-rules). 기본값(후보 rules: {})으로 돌리면 지난 벤치마크 hits_by_class.csv와 같은 개수가 나와야 한다
uv run ssaplash-bench rule-eval --dataset configs/bench/datasets/gmd_test.yaml configs/bench/datasets/mdb_drums.yaml --candidates data/results/tom-pitch/candidates.yaml --out data/results/rule-eval --mlflow-uri mlruns
```

후보 yaml은 `candidates: [{name, rules}]` 목록이거나 `{name, rules}` 하나이며 `rules`는 모델 yaml의 `rules`와 같은 키만 쓴다(없는 키는 기본값). 결과 폴더에 `candidates.csv`(후보 × 데이터셋: 패드별 F1, 탐·심벌 배정 정확도, 정답 없는 탐 수, 버린 탐 수), `confusion.csv`·`summary.md`(혼동표), `by_song.csv`(곡마다 버린 탐 수 `tomDropped`, 묶음 수·중앙값 `tomClusters`·`tomClusterHz`)가 생긴다. 배정 정확도는 정답과 시각이 맞은 타격 중 패드를 맞게 붙인 비율로, 모델이 놓치거나 잘못 잡은 것은 빼고 규칙만의 성능을 본다. `run-transcription`도 이제 MLflow에 패드별 F1(`f1_KICK` 등)과 규칙값(`rules.tom_bands` 등)을 함께 남겨 run끼리 패드 단위로 비교할 수 있다.

탐 규칙에는 아래 선택 키가 있다 (S15P31A307-164 실험). 기본값은 전부 꺼져 있어 안 넣으면 결과가 전과 같다. 거르기를 켜려면 어댑터 입력 드럼이 필요하며, `rule-eval`·`tom-pitch`는 데이터셋의 정답 드럼 트랙을 자동으로 읽어 쓴다.

| 키 | 기본값 | 뜻 |
| --- | --- | --- |
| `tom_mode` | `fixed` | `fixed`: 고정 Hz 경계 `tom_bands`. `relative`: 곡 안의 탐 타격 음높이를 모아 큰 틈에서 1~3묶음으로 나누고 낮은 순서로 FLOOR·MID·SMALL |
| `tom_relative_k` / `tom_relative_min_gap` / `tom_relative_min_hits` | 3 / 2.0 / 2 | 최대 묶음 수, 묶음을 가르는 최소 틈(반음), 묶음 하나의 최소 타격 수(작으면 이웃에 합침) |
| `tom_relative_naming` | `bands` | 묶음이 3개보다 적을 때 이름. `bands`는 묶음 중앙값을 고정 경계로 정하고 둘이 같으면 순서로 벌림, `order`는 1개 MID·2개 FLOOR·MID |
| `tom_gate_ratio` | 없음 | 켜면 타격 직후 toms 트랙 에너지 / 입력 드럼 에너지가 이 값 아래인 탐 타격을 거른다(탐이 아닌 소리를 탐으로 잡은 것). 재는 구간은 `tom_gate_window_ms`, 없으면 `window_ms` |
| `tom_gate_action` | `drop` | 거른 탐을 어떻게 할지. `drop`은 버림, `snare`는 50ms 안에 ADTOF 스네어 타격이 없으면 SNARE로 돌리고 있으면 버림 |

`tom-pitch`는 ADTOF가 탐으로 잡은 타격마다 음높이·거르기 비율·짝지은 정답 탐·근처 정답 패드를 `pred_tom.csv`에 남기고, 거르기 비율 분포(`tom_gate_ratio.png`)와 문턱값별로 버려지는 정답 탐·정답 없는 탐 수를 `summary.md`에 적는다.

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

채보 모델은 "몇 초에 어느 패드를 쳤는지"를 맞혀야 하므로 타격 시각과 패드가 적힌 정답이 필요하다. 패드는 스틱 통신 프로토콜 v0.7과 같은 이름의 8종 `KICK, SNARE, HIHAT, SMALL_TOM, MID_TOM, FLOOR_TOM, CRASH, RIDE`이고(`bench/datasets/pads.py`. 옛 `HI_TOM`은 2026-10-26부터 `SMALL_TOM`이며, 9번째 패드 `HIHAT_PEDAL`은 채보 모델이 못 내서 어휘에 없다), 카우벨·클랩·탬버린처럼 패드에 없는 타격은 정답에서 빼고 개수만 센다. 세 묶음을 쓰며 묶음마다 점수를 따로 낸다.

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
- Jira: 에픽 `[CHART] 채보` (S15P31A307-29). 분리 벤치마크(-101~-105)는 스토리 CHART-004 음원 드럼 분리 (S15P31A307-69), 채보 벤치마크(-106~-110)는 스토리 CHART-003 음원 → 채보 생성 (S15P31A307-62). 서비스 추론 모듈은 분리(-167·-168)가 CHART-004, 채보(-169~-171)가 CHART-003
