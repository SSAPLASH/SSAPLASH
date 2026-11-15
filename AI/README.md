# AI 파트

싸플래쉬(SSAPLASH)의 AI·데이터 영역. 채보 생성(음원 드럼 분리, 드럼 채보, MusicXML 드럼 악보 → 채보), 실시간·리포트 코칭, 곡 추천 실험을 맡는다. MIDI 드럼 파일 변환은 BE가 한다. 벤치마크로 고른 모델(분리 BS Roformer SW, 채보 STRUM 학습 가중치)을 서비스 추론 모듈·채보 워커·AI 서버로 운영하고, **드럼 분리·채보 모델 벤치마크 하네스**는 모델·규칙을 바꿀 때 다시 쓴다.

## 스택

| 항목 | 선택 | 비고 |
| --- | --- | --- |
| Python | 3.11 | 시스템 파이썬(3.13)과 분리된 가상환경. 분리·채보 모델 패키지 호환 때문 |
| 환경·의존성 | [uv](https://docs.astral.sh/uv/) | `uv.lock`으로 버전 고정 |
| 코드 검사 | ruff | lint + format |
| 테스트 | pytest | |
| 오디오 입출력 | soundfile, soxr, mido | wav 읽고 쓰기, 샘플레이트 변환, MIDI 온셋 추출 |
| 지표 | museval, mir_eval, librosa, psutil | BSS Eval v4(SDR·SIR·SAR), 온셋 매칭, 온셋 검출, 메모리 측정 |
| 실험 기록 | MLflow | 기본은 로컬 파일 모드. 팀 MLflow 서버에는 SSH 터널을 열고 `--mlflow-uri`나 `relog`로 올린다(아래 "팀 MLflow에 기록하기") |
| 보고서 | pandas, matplotlib | CSV 집계, 마크다운 표, PNG 그래프 |
| 모델 실행 | PyTorch + ZFTurbo MSST(msst), demucs, openunmix | 선택 extra `models`. 단위 테스트·CI에는 필요 없다 |
| 채보 모델 실행 | STRUM(extra `models`, 서비스 기본), ADTOF-pytorch·Beat This!·madmom(extra `transcribers`), 별도 가상환경(ADT_STR·Inverse Drum Machine·Omnizart·YourMT3+·drum2midi) | 지금 환경과 의존성이 맞지 않는 모델은 `scripts/transcribers_ext/`의 스크립트를 별도 환경에서 돌린다 |
| 음악 여부 검사 | transformers(AST 분류 모델) | 선택 extra `music-check`. 채보 워커가 분리 전에 CPU로 돌린다 |
| m4a 디코딩·음량 측정 | PyAV, pyloudnorm | PyAV 휠의 FFmpeg 라이브러리를 써서 ffmpeg 프로그램이 필요 없다 |
| AI 서버 | FastAPI, uvicorn | `POST /chart/sheet`, `POST /analysis/weak-segments` |

## 폴더 구조

```
AI/
├─ pyproject.toml        패키지·의존성·ruff·pytest 설정, ssaplash-bench·ssaplash-chart·ssaplash-train·ssaplash-worker 명령 진입점
├─ uv.lock               의존성 잠금
├─ .python-version       3.11
├─ Dockerfile            AI 서버 이미지 (.dockerignore로 데이터·모델 제외)
├─ src/ssaplash_ai/      패키지 본체
│   ├─ bench/            벤치마크 하네스
│   │   ├─ cli.py        명령줄 진입점 (check-data · run · report · run-transcription · report-transcription ·
│   │   │                rule-features · rule-eval · tom-pitch · relog)
│   │   ├─ datasets/     평가·학습 데이터 읽기 (base, musdb, synth, synth_build, gmd(E-GMD 포함), mdb, star, enst, songsterr)
│   │   │                · 패드 어휘·타격 표(pads)
│   │   ├─ separators/   분리 모델 실행. separator_base(공통 인터페이스·yaml·다운로드),
│   │   │                mock_separator(모델 없이 원곡·무음을 돌려주는 테스트용), msst_separator(SCNet·BS Roformer),
│   │   │                demucs_separator(HTDemucs), openunmix_separator(umxhq), ensemble_separator(여러 모델 드럼 평균),
│   │   │                postprocess(반주 리미터 limit_peaks)
│   │   ├─ transcribers/ 채보 모델 실행. transcriber_base(공통 인터페이스·yaml 대응표), mock_transcriber(테스트용),
│   │   │                strum_transcriber(STRUM 8종 온셋 CRNN, 서비스 기본), strum_rules(피크·킥 규칙·문턱값),
│   │   │                strum/(STRUM 저장소의 모델 정의 원본), adtof_transcriber(ADTOF),
│   │   │                adtof_drumsep_transcriber(ADTOF + 드럼 킷 분리 + 규칙), external_transcriber(별도 가상환경 스크립트 실행)
│   │   ├─ metrics/      지표 계산. bss_eval_metrics(SDR·SIR·SAR·SI-SDR), onset_preservation(타격 보존율),
│   │   │                attack_slope_distortion(attack slope 왜곡), mr_quality(드럼리스 MR 품질),
│   │   │                resource_usage(시간·RAM·VRAM), hit_f1(채보 타격 F1)
│   │   ├─ analysis/     채보 규칙 분석. rule_features(ADTOF 타격 시각·드럼 킷 분리 트랙 저장), rule_eval(규칙 후보 점수·혼동표),
│   │   │                tom_pitch(정답 탐 음높이 분포·경계 후보)
│   │   ├─ runner/       벤치마크 실행. benchmark_runner(분리 모델 × 곡), transcription_runner(채보 모델 × 곡 × 입력),
│   │   │                run_support(둘이 같이 쓰는 CSV 쓰기·이어하기), mlflow_tracking(MLflow 기록),
│   │   │                relog(지난 결과 폴더를 MLflow에 다시 기록)
│   │   └─ report/       결과 보고서. summary_table·charts(분리), transcription_summary·transcription_charts(채보),
│   │                    build_report(파일 생성)
│   ├─ train/            채보 모델 파인튜닝. adtof_data(학습 윈도·특징·프레임 정답), adtof_finetune(학습 루프·체크포인트),
│   │                    adtof_eval(클래스별 F1·문턱값 맞추기), cli(ssaplash-train 명령)
│   ├─ chart/            서비스 추론 모듈. config(설정 yaml·환경 변수), audio_io(원곡 읽기·트랙 쓰기), errors(예외 분류),
│   │                    music_check(분리 전 음악 여부 검사), separation(음원 분리 SeparationModule),
│   │                    transcription(드럼 채보 TranscriptionModule), chart_json(채보 JSON 만들기·검증), tempo(bpm 추정),
│   │                    tempo_refine(노트로 bpm·offsetMs 다시 맞추기), sheet/(MusicXML 드럼 악보 → 채보), cli(ssaplash-chart 명령)
│   ├─ worker/           채보 워커. config(환경 변수), payload(정규 JSON·payloadHash), api(BE 워커 API 호출부),
│   │                    transfer(서명 URL 내려받기·올리기), heartbeat(10초 heartbeat 스레드), job(작업 하나 실행기),
│   │                    loop(claim 폴링 루프), narrative_job(LLM 총평 작업), live_coach_job(연주 중 LLM 구간 코칭),
│   │                    cli(ssaplash-worker 명령), fake_be(테스트·로컬 확인용 BE 대역)
│   ├─ coach/            약점 구간 분석 엔진(통계 규칙, 모델 없음). config(임계값), schema(요청·응답), notes(노트 표),
│   │                    patterns/(패턴별 규칙), select(후보 선택), advice(연습 조언·상세 설명·심각도 단계), summary(종합 총평),
│   │                    narrative·llm_local·live_narrative(LLM 총평·연주 중 코칭 문장), analyzer(진입점). 설명은 docs/coach-weak-segments.md
│   ├─ coach_live_model/ 실시간 코칭 거름 모델 학습(개발 전용)
│   ├─ coach_eval/       약점 분석 합성 평가(개발 전용, 서버가 import하지 않음). chart(합성 채보), player(연주 모델·hits 만들기),
│   │                    scenarios(심는 약점·정답), metrics(탐지·오탐 계산), runner(실행), report(표·그림·MLflow), cli,
│   │                    narrative_compare·live_tip_compare·live_real_set·live_segments(LLM 문장 평가)
│   ├─ coach_calibration/ 약점 분석 실측 보정 배치(서버가 import하지 않음). source(비식별 뷰 읽기·허용 열 검증), filters(이상치 제외),
│   │                    profile(걸림 비율·분포), candidates(what-if·후보), policy(정책 파일), register(MLflow 기록·실행 판단),
│   │                    summary, pipeline, cli. 설명은 docs/coach-calibration.md
│   ├─ recommend/        곡 추천 R3 PoC(오프라인 실험). 설명은 docs/recommend-poc.md
│   └─ server/           AI 서버 진입점 app.py (FastAPI, /health), weak_segments.py (POST /analysis/weak-segments),
│                        sheet.py (POST /chart/sheet)
├─ configs/bench/datasets/  데이터셋 설정 yaml, 합성곡 레시피
├─ configs/bench/models/    분리 모델 설정 yaml. 어댑터별 폴더 (msst, demucs, openunmix, ensemble, mock=테스트용)
├─ configs/bench/transcribers/  채보 모델 설정 yaml + 라벨 → 패드 대응표 (strum, adtof, adtof_drumsep, external, mock)
├─ configs/train/        채보 모델 파인튜닝 설정 yaml (adtof_tom_*, 실제 곡 학습 songsterr_*, 실제 녹음 확인 실험 real_check/)
├─ configs/chart/        서비스 추론 모듈 설정 yaml (separation.yaml·transcription.yaml·music_check.yaml·sheet.yaml,
│                        모델 없이 흐름만 확인하는 separation_mock.yaml·transcription_mock.yaml)
├─ configs/coach/        약점 분석 보정 정책, 실시간 코칭 설정
├─ configs/ncs/          NCS 기본곡 50곡 표 (songs.csv)
├─ scripts/              데이터 준비(make_*·pack_*), 평가·측정(*_eval.py·score_*.py·check_*.py), NCS 기본곡 적재(ncs_*·builtin_reset),
│                        워커 속도 측정(worker_speed_check·profile_worker.sh), 별도 환경 채보 스크립트(transcribers_ext/),
│                        STRUM 채보 모델 학습·채점 스크립트(train_ext/)
├─ ext/                  채보 모델 저장소 클론·코드 (ADT_STR, inverse-drum-machine, YourMT3, drum2midi. git 미추적)
├─ .venv-*/              채보 모델 별도 가상환경 (git 미추적)
├─ tests/                pytest. 패키지·모듈별 폴더(bench 하위 모듈은 bench/ 없이 최상위, 스크립트 테스트는 analysis/·ncs/).
│                        실제 데이터·모델 없이 테스트용 wav와 mock 어댑터로 돈다
├─ notebooks/            GPU 서버 실행용 ipynb 파일. 작업별 *_server.ipynb
├─ docs/                 벤치마크·규칙 실험 결과(bench/, chart-rules/), 코칭·추천 설명 문서, 트러블슈팅-워커-처리-속도.md
├─ mlruns/               MLflow 로컬 기록 (git 미추적)
└─ data/                 데이터셋·모델 가중치·결과 (git 미추적, 빈 폴더만 .gitkeep으로 둠)
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
uv sync --extra models --extra transcribers   # ADTOF·Beat This!·madmom까지(서비스 채보에 필요). 나머지 채보 모델은 아래 '별도 환경'
uv sync --extra models --extra transcribers --extra music-check   # 채보 워커 환경. 분리 전 음악 여부 검사까지
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

커밋 전에 `ruff check`와 `pytest`가 모두 통과해야 한다 (CLAUDE.md 규칙). GitLab CI의 `ai-lint` job이 `ruff check .`와 `ruff format --check .`를 같은 ruff 버전(`AI/uv.lock`)으로 돌리고(AI 파일이 바뀐 MR·병합에서만), `ai-lock` job이 `uv lock --check`로 `uv.lock`이 `pyproject.toml`과 맞는지 본다(의존성을 바꿀 때 `uv lock`을 잊으면 여기서 실패한다). **AI 테스트(`pytest`)는 아직 CI에 없다.**

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

원곡은 mp3·wav·flac·Ogg Opus(`.opus`·`.ogg`)·m4a(AAC·ALAC)를 받는다. BE 업로드가 받는 형식과 같다 (S15P31A307-244). m4a 말고는 soundfile이 읽고, soundfile이 못 여는 m4a만 PyAV(`av` 패키지)로 읽는다. 형식은 확장자가 아니라 파일 내용으로 알아내므로 확장자가 없거나 틀려도 된다. PyAV 휠에 FFmpeg 라이브러리가 들어 있어서 ffmpeg 프로그램을 따로 깔 필요가 없다.

PyAV 라이선스: PyAV는 BSD-3이고, 휠에 든 FFmpeg는 LGPL 3 이상으로 빌드돼 있다. 휠에는 x264·x265 영상 인코더(GPL)도 같이 들어 있지만 우리는 오디오 디코딩만 하고 휠을 서버 안에서만 쓰며 따로 배포하지 않는다.

출력 폴더에 세 파일이 생긴다. 반주는 원곡에서 드럼 트랙을 샘플 단위로 뺀 것이라 세 파일의 샘플 수와 시간축이 원곡과 같다.

크게 마스터링된 원곡은 드럼을 빼면 반주 일부가 파일에 담을 수 있는 최대 크기(0dBFS)를 넘어, 16비트로 저장할 때 잘려 찌그러진다. 그래서 저장 전에 두 파일의 볼륨을 처리한다 (S15P31A307-165).

- 반주: 리미터를 건다. -1dBFS를 넘는 순간에만 볼륨을 낮추고 나머지 구간은 그대로 둔다. 낮추기는 5ms 전부터 시작하고, 낮춘 볼륨은 시간 상수 100ms로 천천히 되돌리며, 좌우 채널을 같은 양만큼 낮춘다. 코드는 `bench/separators/postprocess.py`의 `limit_peaks`
- 드럼 트랙: 피크가 -1dBFS를 넘으면 파일 전체 볼륨을 같은 양만큼 낮춘다. 채보 입력이라 파형 모양은 바꾸지 않는다

이 처리 때문에 드럼 트랙 + 반주가 원곡과 정확히 같지 않을 수 있다. 처음에는 두 파일 전체 볼륨을 같은 양만큼 낮췄는데, 데모 곡 반주가 원곡보다 3.6~6.1dB 작아져 리미터로 바꿨다. 리미터를 쓰면 원곡과의 차이가 0.9~3.0dB다.

| 파일 | 내용 |
| --- | --- |
| `drums.flac` | 드럼 트랙. 16비트 44.1kHz 스테레오 |
| `accompaniment.flac` | 반주. 원곡 − 드럼 트랙에 리미터 |
| `separation.json` | 결과 메타. 길이 ms, 샘플레이트, 두 파일 경로, 모델 이름·버전, 올리기·분리 시간 ms, 최대 GPU 메모리·RAM MB, `audio_time_origin`, `drums_gain_db`(드럼 트랙 전체를 낮춘 양 dB, 안 낮췄으면 0), `accompaniment_limit_db`(리미터가 반주를 가장 많이 낮춘 양 dB, 안 낮췄으면 0) |

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
| `SSAPLASH_CHART_MODEL` | 채보 설정의 `model` 값을 덮어쓴다. `strum`·`songsterr_avg`·`original`·`combo` |
| `SSAPLASH_MODELS_DIR` | 가중치 폴더. 기본 `data/models`. 벤치마크 어댑터도 같이 읽는다 |
| `SSAPLASH_WORK_DIR` | `--out`이 없을 때 출력 폴더의 부모. `<WORK_DIR>/<원곡 파일 이름>/`에 쓴다 |

종료 코드는 0 정상, 2 입력 오류, 3 모델 오류, 4 출력 오류, 1 설정·인자 오류다. 입력 오류는 못 읽는 파일·길이 초과·무음이고 모델을 돌리기 전에 난다. 모델 오류 중 GPU 메모리 부족만 재시도할 수 있는 것으로 표시한다. 파이썬에서 쓸 때는 `ssaplash_ai.chart.separation.SeparationModule`을 만들고 `load()` 한 번, `separate_file()` 곡마다, `close()` 순서로 부른다.

모델 없이 흐름만 확인할 때는 mock 설정을 쓴다. 드럼은 원곡 × 0.5가 나온다.

```bash
uv run ssaplash-chart separate <원곡> --out data/chart/check --config configs/chart/separation_mock.yaml
```

## 드럼 채보 실행 (서비스 추론 모듈, S15P31A307-169)

드럼 트랙 파일 하나로 채보 JSON을 만든다. 채보 모델은 벤치마크 어댑터를 그대로 쓰므로 모델 실행 패키지가 필요하다 (`uv sync --extra models --extra transcribers`). 기본 모델은 STRUM 8종 온셋 CRNN 학습 가중치다(아래 "STRUM 학습 가중치" 참고). 가중치 `data/models/strum_ft/songsterr_egmd/best.pt`(169MB)는 자동으로 받지 않으므로 직접 넣고, 파일이 없으면 모델 오류로 끝난다. ADTOF 계열 모델(`songsterr_avg`·`original`·`combo`)을 고르면 드럼 킷 분리(MDX23C DrumSep) 가중치를 첫 실행 때 `data/models/mdx23c_drumsep/`에 받는다. bpm 추정에 쓰는 Beat This! 가중치(81MB)도 첫 실행 때 `data/models/beat_this/`에 받고 md5로 확인한다. 공식 서버가 안 되면 개발자 사이트에서 받는다.

```bash
# 드럼 트랙 → 채보. --beat-audio <원곡>을 주면 박을 원곡에서 찾는다
uv run ssaplash-chart transcribe data/chart/funk_108/drums.flac --out data/chart/funk_108
# 원곡 → 분리 → 채보. 마지막에 단계별 시간·메모리를 찍는다
uv run ssaplash-chart run data/synth_v1/funk_108/mixture.wav --out data/chart/funk_108
```

| 파일 | 내용 |
| --- | --- |
| `chart.json` | 채보. BE 채보 결과 형식 schemaVersion 1 그대로라 워커가 `result`에 넣어 보내면 된다 |
| `transcription.json` | 결과 메타. 노트 수·패드별 수, 길이 ms, bpm과 박 추적값 `tracked_bpm`, 첫 박·첫 마디 첫 박 시각 ms, 박 추정 입력 `beat_source`(mix·drums), 빠르기 구간 수 `tempo_segments`, 모델 이름·버전, 올리기·채보 시간 ms, 최대 GPU 메모리·RAM MB |

`chart.json`에서 정해진 값은 다음과 같다.

- `generator`는 BE가 `ADT_MODEL`만 받아서 고정이다. 어떤 모델·규칙으로 만들었는지는 `generatorVersion`에 `<모델 yaml name>@<해시 12자리>`로 남는다. 해시에는 모델 yaml, bpm 방법·설정, `offsetMs`·bpm 계산 규칙 버전(`chart_json.TIMING_RULES_VERSION`)이 들어간다. 모델 yaml은 주석을 포함한 파일 글자 전체가 들어가므로 주석만 고쳐도 `generatorVersion`이 바뀐다
- 난이도는 `NORMAL` 하나, `notationStatus`는 `UNAVAILABLE`이다
- 노트는 시각순으로 `n0001`부터 번호를 붙인다. `timeMs`는 반주 시작 기준 정수 ms이고 같은 시각은 패드 순서(KICK·SNARE·HIHAT·SMALL_TOM·MID_TOM·FLOOR_TOM·CRASH·RIDE·HIHAT_PEDAL)다
- `pad`는 위 9종 중 하나다. 음원 채보는 하이햇 페달을 따로 내지 않고, 채보 모델이 `HIHAT_PEDAL`을 내도 `HIHAT`으로 합친다. 페달이 따로 적힌 실제 녹음 드럼 데이터가 MDB Drums 한 묶음뿐이라, 처음 보는 드럼 세트에서도 맞는지 확인할 수 없어서다. MDB에서는 원래 ADTOF + 드럼 킷 분리 모델의 `HIHAT` 노트에 실제 녹음 학습 모델의 페달 예측이 30ms 안에 있으면 페달로 바꿨을 때 페달 정밀도 0.835, F1 0.548이었다(`scripts/score_pedal_relabel.py`). ENST는 페달만 밟은 하이햇도 닫힌 하이햇과 같은 `chh`로 적어서 페달 채점에 쓸 수 없다
- bpm은 원곡에 Beat This!(2024, 코드·가중치 MIT)를 돌려 박 시각을 찾고 계산한다. 원곡이 없으면(`transcribe`에 `--beat-audio`를 안 줬거나 원곡을 못 읽은 경우) 드럼 트랙으로 찾는다. 박 시각은 madmom DBN 후처리(`tempo.postprocess: dbn`)를 거친 값이다. 박마다 몇 번째 박인지와 울린 시각을 짝지어, 박들이 모두 몇 초에 걸쳐 나왔는지로 한 박 길이를 구하고 bpm으로 바꾼다. Beat This! 박 시각은 0.02초 단위로 반올림돼 있어서, 이웃한 두 박 간격을 하나씩 재서 평균 내면 이 오차가 남는다. 박을 놓치거나 두 번 잡은 곳, 즉 간격이 중앙값에서 15% 넘게 벗어난 곳에서는 구간을 끊어 따로 계산한 뒤 합친다. 4박 넘게 이어지는 구간이 하나도 없으면 고른 간격의 평균을 쓴다. 60~200 밖이면 2배나 절반으로 접는다. 박을 못 찾으면 서비스 설정에서는 `NOT_TRANSCRIBABLE`로 실패하고, `drum_check.fail_on_unknown_tempo`를 끄면 120을 쓴다. GMD test 45곡에서 정답 bpm ±2% 안에 든 곡은 Beat This! 45곡, madmom 32곡, librosa 25곡이었다
- `offsetMs`는 곡의 첫 마디 첫 박이 울리는 시각이고 FE 악보 격자와 BE 난이도 솎기의 원점이다. 빠르기 구간(tempoMap)이 2개 이상인 채보는 첫 구간 시작에서 첫 구간 빠르기로 한 마디씩 앞으로 당겨 0ms 이상인 가장 이른 마디 시작을 넣고 `timing.bpm`은 첫 구간 bpm이다. 구간이 1개 이하면 Beat This!가 찾은 마디 첫 박 전부를 한 마디(`60000 / bpm × 4` ms) 길이로 접어 가장 많이 모인 위치, 즉 곡 맨 앞 한 마디 안의 마디 시작을 넣는다. 첫 번째 마디 첫 박 하나만 쓰면 드럼 인트로·필인에서 틀린 박을 잡는 곡이 많아서 곡 전체 다수결로 정한다. 드럼 없는 인트로가 있어도 첫 마디는 곡 맨 앞 한 마디 길이 안에서 시작한다. 마디 첫 박이 없으면(librosa) 첫 박 시각, 박을 못 찾으면 0이다. `offsetMs`보다 앞선 노트도 지우지 않는다. 박자는 `4/4` 고정이다
- 설정 `tempo.origin`이 `notes`면 위 값을 킥·스네어 노트로 한 번 더 맞춘다. 격자 박에서 60ms 안에 있는 킥·스네어 노트가 박보다 평균 몇 ms 앞뒤에 있는지 중앙값을 구해 그만큼 `offsetMs`를 옮긴다. 쓸 노트가 16개보다 적으면 옮기지 않는다. Beat This! 박 시각이 드럼 소리보다 늦게 잡히면 메트로놈 클릭이 킥보다 늦게 울리는데 이를 줄인다. 서비스 설정값은 `notes`이고(키를 빼면 `downbeat`), `downbeat`면 위 값을 그대로 쓴다. 측정은 `scripts/origin_alignment_eval.py`로 두 방식을 같은 Beat This! 박으로 비교한다
- bpm·`offsetMs`를 다시 측정하려면 `scripts/chart_timing_eval.py`를 쓴다. 드럼 트랙에 Beat This!만 돌려 데모 곡에서 FE 악보의 16분음표 칸을 벗어나 점이 찍히는 노트 비율, MDB Drums 정답 박 대비 bpm 차이·곡 끝 어긋남, GMD·합성곡 bpm 정확도를 낸다
- 마디선이 실제 곡 마디와 맞는지는 `scripts/chart_bar_grid_eval.py`로 측정한다. Songsterr 곡의 `final/bars.json` 마디 시작을 정답으로, Beat This! 박 캐시로 만든 마디선 70ms 안에 정답 마디 시작이 80% 이상 드는 곡 수를 이전 규칙(첫 번째 마디 첫 박)과 나란히 낸다
- 설정 `tempo.refine`이 `true`면 노트가 나온 뒤 bpm·`offsetMs`를 노트에 맞춰 다시 정한다(`chart/tempo_refine.py`, S15P31A307-322). 노트가 16분·셋잇단 칸에서 15ms 넘게 벗어난 비율과 곡 처음→끝 메트로놈 밀림을 측정해, 정수 bpm(±1) 또는 지금 bpm ±0.10(0.01 간격) 후보가 비율을 5%p 넘게 줄이거나, 비율을 1%p 넘게 늘리지 않으면서 밀림을 5ms 이상 줄일 때만 바꾼다. 노트 시각은 그대로다. 빠르기 구간(tempoMap)이 있는 채보에는 적용하지 않는다. 기본값은 `false`다. 전자음악 NCS 50곡은 밀림 10ms 넘는 곡이 26 → 0이었지만, 밴드 녹음 Songsterr 131곡은 정답 마디가 마디선 70ms 안에 80% 이상 드는 곡이 52 → 47로 줄었다. 측정은 `scripts/chart_tempo_refine_eval.py`. 켜면 `generatorVersion`이 바뀌고 `transcription.json`의 `timing_refine`(보정 전후 값·이유)이 채워진다. `tracked_bpm`(보정 전)은 끄고 켜는 것과 상관없이 남는다
- 저장 전에 BE 워커 API와 같은 검사를 한다. 걸리면 파일을 남기지 않고 출력 오류(종료 코드 4)로 끝난다
- 곡 안에서 빠르기가 바뀌는 채보는 `timing`에 `ppq`·`tempoMap`·`timeSignatureMap`을 더 넣을 수 있다. 형식은 BE MIDI 채보와 같다. `tempoMap`은 `{tick, bpm}` 목록이고 tick 0이 `offsetMs`, 첫 항목 bpm은 `timing.bpm`과 같아야 한다. 검사는 BE `ChartDocumentReader.timing`과 같은 조건이다. 음원 채보도 `tempo.tempo_map`이 `true`(서비스 설정)면 찾은 박을 따라가는 빠르기 구간을 이 필드로 낸다. 구간이 2개 미만이면 이 필드 없이 bpm 하나로 낸다

채보 모델을 바꿀 때는 `configs/chart/transcription.yaml`의 `model` 한 줄을 `strum`·`songsterr_avg`·`original`·`combo` 중 하나로 바꾸거나, 파일은 두고 `SSAPLASH_CHART_MODEL=songsterr_avg`처럼 환경 변수를 주고 워커를 다시 띄운다. 워커 로그의 "채보 모델 선택:" 줄과 채보 JSON의 `generatorVersion`(`<모델 yaml name>@…`)으로 어느 모델이 도는지 확인한다. 규칙을 바꿀 때는 모델 yaml을 고친다. 규칙 값(STRUM의 패드별 문턱값·킥 규칙, ADTOF 계열의 탐 음높이 경계 등)은 그 경로가 가리키는 벤치마크 yaml의 `rules`에 있다.

| 키 | 기본값 | 뜻 |
| --- | --- | --- |
| `model` | `strum` | 쓸 채보 모델 이름. `models` 안의 이름 하나. 환경 변수 `SSAPLASH_CHART_MODEL`이 있으면 그 값이 우선 |
| `models` | `strum`, `songsterr_avg`, `original`, `combo` | 이름 → 채보 모델 yaml. `strum`은 STRUM 8종 온셋 CRNN 학습 가중치 + 킥 규칙(아래 "STRUM 학습 가중치" 참고), `songsterr_avg`는 원래 ADTOF와 실제 곡 학습 가중치 점수 평균(아래 "실제 곡 점수 평균 조합" 참고), `original`은 원래 ADTOF + 드럼 킷 분리(`adtof_drumsep_ds_ov2.yaml`, 드럼 킷 분리 조각 겹침 2), `combo`는 패드별 가중치 조합 `adtof_drumsep_realrec.yaml`(실험용, 아래 "패드별 가중치 조합" 참고). `songsterr_avg`도 같은 겹침 2 드럼 킷 분리를 쓴다 |
| `device` | `cuda` | 없으면 `cpu`로 내려간다 |
| `schema_version` | 1 | 채보 JSON `schemaVersion`. BE가 1만 받는다 |
| `tempo.method` | `beat_this` | bpm 추정 방법. `beat_this` 또는 `librosa`. librosa는 torch 없이 돌아서 mock 설정이 쓴다 |
| `tempo.postprocess` | `dbn` | Beat This! 박 후처리. `dbn`(madmom 필요) 또는 `minimal`. 키를 빼면 `minimal` |
| `tempo.origin` | `notes` | `offsetMs` 원점 방식. `notes` 또는 `downbeat`. 키를 빼면 `downbeat` |
| `tempo.tempo_map`, `tempo.tempo_map_tolerance_ms` | `true`, 20 | 찾은 박을 따라가는 빠르기 구간(tempoMap)을 낼지, 마디 경계가 이 ms 안으로 맞으면 한 구간으로 묶음. 키를 빼면 `false` |
| `tempo.refine` | `false` | 노트로 bpm·`offsetMs` 다시 맞추기. 위 bpm 설명 참고 |
| `tempo.min_bpm`, `tempo.max_bpm` | 60, 200 | 이 범위 밖이면 2배·절반으로 접는다. 상한은 하한의 2배 이상 |
| `tempo.time_signature` | `4/4` | 박자. 추정하지 않는다 |
| `max_duration_sec` | 600 | 이보다 긴 드럼 트랙은 입력 오류 |
| `drum_check.min_notes_per_minute` | 92 | 곡 1분당 노트 수가 이보다 적으면 `NOT_TRANSCRIBABLE` 실패. 비우면 검사 안 함 |
| `drum_check.fail_on_unknown_tempo` | `true` | 박 추적 실패를 `NOT_TRANSCRIBABLE` 실패로 볼지 |

환경 변수와 종료 코드는 음원 분리와 같다. 파이썬에서 쓸 때는 `ssaplash_ai.chart.transcription.TranscriptionModule`을 만들고 `load()` 한 번, `transcribe_file()` 곡마다, `close()` 순서로 부른다. 워커는 BE가 준 원곡 길이를 `transcribe_file(..., duration_ms=)`로 넘기면 노트 시각 상한과 `metrics.durationMs`에 그 값을 쓴다. 원곡 경로를 `beat_audio_path=`로 넘기면 박을 원곡에서 찾는다.

모델 없이 흐름만 확인할 때는 mock 설정을 쓴다. 온셋 검출로 시각만 찾고 패드는 전부 KICK이 나온다.

```bash
uv run ssaplash-chart transcribe <드럼 트랙> --out data/chart/check --config configs/chart/transcription_mock.yaml
```

`separate`·`transcribe`·`run`에 `--duration-ms <원곡 길이 ms>`를 주면 분리 출력 두 파일의 끝을 그 길이에 맞춰 자르거나 무음을 채우고(샘플 수 `길이 × 44100 // 1000`), 채보 노트 시각 상한에도 같은 값을 쓴다. BE가 분리 결과 flac의 길이를 ms로 올림해 원곡 길이와 정확히 같은지 검사하므로 워커가 BE claim의 `input.durationMs`를 여기에 넘긴다. 실측 길이와 1000ms 넘게 다르면 입력 오류다.

### 드럼 악보 → 채보 (S15P31A307-292)

MusicXML 드럼 악보(`.musicxml`·`.xml`·`.mxl`)를 음원 채보와 같은 `chart.json`으로 바꾼다. 모델 없이 CPU로 곡당 0.5초 안에 끝난다. MIDI 드럼 파일은 BE `POST /api/v1/songs/midi`가 바꾸고, PDF·사진 악보는 받지 않는다. BE 업로드 API(S15P31A307-293)는 AI 서버 `POST /chart/sheet`를 동기로 부른다(아래).

```bash
uv run ssaplash-chart sheet score.mxl --out data/chart/score
```

- 드럼 파트는 음높이 없는 음표가 있거나 MIDI 채널 10인 파트다. 음표의 악기 id → `midi-unpitched` GM 번호 → 패드로 바꾸고, 패드 표는 BE `GmDrumMapping`과 같다(`chart/sheet/drum_map.py`). 표에 없는 타악기(탬버린·콩가 등)는 빼고 `sheet.json`의 `dropped`에 개수를 남긴다
- 첫 파트의 도돌이표·1/2번 괄호·D.C.·D.S.·Fine·Coda를 펼친 순서와 템포 표기로 시각을 정한다. 마디 반복 기호(`measure-repeat`)는 앞 마디를 복사한다
- `timing.bpm`·`timeSignature`는 첫 템포·첫 박자다(템포가 없으면 120). `offsetMs`는 못갖춘마디 길이다
- `velocityHint`는 음표 셈여림 × 0.9, 없으면 90, 괄호 친 고스트 노트는 40이다
- 하이햇은 세 가지로 나눌 수 있다. 하이햇 페달만 밟기(44)는 `emit_hihat_pedal`이 참이면 `HIHAT_PEDAL` 노트, 페달 안 밟고 치기(46·26, 또는 `<technical><open/>`)는 `emit_hihat_open`이 참이면 `HIHAT` 노트에 `hihatOpen: true`, 페달 밟고 치기(42·22)는 필드 없는 `HIHAT` 노트다. 두 값은 `configs/chart/sheet.yaml`에 있다. BE 결과 검증이 `HIHAT_PEDAL`을 받아서 `emit_hihat_pedal`은 참이다. `emit_hihat_open`도 참이다. FE는 `hihatOpen`을 판정에 쓰지 않고 악보 표시와 연습 가이드에만 쓴다
- `generator`는 `ADT_MODEL` 그대로이고 `generatorVersion`은 `sheet-musicxml-3`이다. 페달 출력을 켜면서 1에서 2로, 열린 하이햇 출력을 켜면서 3으로 올렸다. 2 이하로 만든 악보 채보에는 `hihatOpen`이 없다
- 드럼 파트가 없거나, 패드로 바꿀 음표가 없거나, 반복을 펼친 길이가 30분을 넘으면 입력 오류(종료 코드 2)다

**AI 서버 엔드포인트 (S15P31A307-293):** `POST /chart/sheet?name=<원래 파일 이름>` 본문에 파일 바이트를 그대로 보내면(`application/octet-stream`, 5 MiB 이하) 위 명령과 같은 변환을 하고 `{"chart": <chart.json>, "sheet": <sheet.json 내용>}`을 돌려준다. 확장자(`.mxl`/`.musicxml`·`.xml`)는 `name`으로 가른다. 오류는 `{"error": 코드, "message": 한 줄}` — 400 `INPUT_INVALID`(형식·timewise·깨진 파일·길이 초과), 422 `NO_DRUM_NOTES`(드럼 파트 없음), 413 `BODY_TOO_LARGE`, 500 `INTERNAL_ERROR`. 설정은 `configs/chart/sheet.yaml`(환경 변수 `SSAPLASH_SHEET_CONFIG`로 바꿈)이라 Docker 이미지에 `configs/`를 넣는다. 악보 본문·파일 이름은 로그에 남기지 않고 요약 한 줄만 남긴다. BE `POST /api/v1/songs/musicxml`이 이 응답을 음원 채보와 같은 규칙으로 3난이도 저장한다. 라우터 `server/sheet.py`, 시험 `tests/server/test_sheet_endpoint.py`.

정확도는 PDMX 공개 악보와 MuseScore가 같은 악보를 재생해 내보낸 MIDI를 비교해 측정한다. 악보·MIDI는 저장소에 넣지 않는다.

```bash
uv run python scripts/sheet_pdmx_eval.py --list <곡 목록.csv> --pdmx <PDMX 압축 푼 폴더> --out data/results/sheet_pdmx
```

### NCS 기본곡 적재 (S15P31A307-322)

NCS 50곡(표 `configs/ncs/songs.csv`)을 서비스 채보로 만들어 운영 공용 곡으로 올린다. 음원은 git에 넣지 않는다.

1. `uv run python scripts/ncs_prepare.py --src <유튜브 opus 폴더> --out data/ncs/audio`: 영상 ID로 50곡을 찾아 `ncs_NN 아티스트 - 제목.opus`로 모음
2. GPU 서버 `notebooks/ncs_charts_server.ipynb`: 50곡 `ssaplash-chart run`, 결과 zip을 `data/ncs/`에 풂
3. `uv run python scripts/ncs_make_bulk.py`: 곡마다 음원 정렬 드럼 MIDI(0틱 = 드럼리스 MR 0초)와 반주 WAV, 등록 표 `register.csv`, 점검 표 `check.csv`. bpm이 소수점만큼 틀려 메트로놈이 밀리는 곡은 `tempo_refine.refine_timing`으로 bpm·첫 박을 고친 뒤 MIDI를 씀
4. `uv run python scripts/ncs_inspect.py`: 곡별 박자 칸·원곡 시각 차이·빈 구간·패드 비율 점검 표 `data/ncs/inspect.csv`
5. `uv run python scripts/ncs_register.py --bulk data/ncs/bulk --all`: 관리자 API로 숨김 등록 → 3난이도·반주 확인 → 공개. `--replace-fixed`면 bpm 고친 곡을 지우고 다시 등록. 토큰은 관리자 access 토큰을 `SSAPLASH_ADMIN_TOKEN`에 넣거나 실행할 때 입력
6. 공용 곡 전부 지우고 다시 올릴 때: `scripts/builtin_reset.py` `backup` → `delete-all` → `restore-catalog`(BE 카탈로그 곡과 받아 둔 반주·커버) → 5번

## 채보 워커 실행 (S15P31A307-171)

BE 채보 작업 워커 API(`/internal/v1/chart-jobs`, S15P31A307-160)에서 작업을 가져가 음원 분리와 드럼 채보를 돌리고 결과를 돌려주는 상시 프로세스다. 작업 하나를 분리 → 채보까지 한 워커가 처리하고, 한 번에 작업 하나만 한다. 실제 모델이 필요하므로 `uv sync --extra models --extra transcribers`가 끝난 환경에서 돌린다.

흐름: claim → 원곡 내려받기(크기·sha256을 배정과 대조) → 음악 여부 검사(아래 "분리 전 음악 여부 검사") → 분리(`duration_ms`로 BE 길이에 맞춤) → flac 두 개를 서명 URL로 올리기 → 분리 결과 제출 → 같은 claim 재조회로 TRANSCRIBING 배정 받기 → 채보(로컬 드럼 트랙의 sha256이 배정과 같으면 그대로 쓰고, 박은 작업 폴더에 남은 원곡에서 찾음) → 채보 결과 제출. heartbeat는 별도 스레드에서 10초마다 보내고 진행률은 분리 0~49, 분리 인수 뒤 50, 채보 50~99다. 분리·채보 모델과 음악 여부 검사 분류 모델은 첫 claim 전에 한 번 올린다.

| 환경 변수 | 필수 | 기본값 | 뜻 |
| --- | --- | --- | --- |
| `SSAPLASH_WORKER_BASE_URL` | 예 | — | BE 주소. 뒤에 `/internal/v1/chart-jobs`를 붙여 부른다 |
| `SSAPLASH_WORKER_ID` | 예 | — | BE `CHART_WORKER_CREDENTIALS`에 등록된 workerId |
| `SSAPLASH_WORKER_TOKEN` | 예 | — | 그 workerId의 토큰. UTF-8 32바이트 이상 |
| `SSAPLASH_WORK_DIR` | 예 | — | 작업 파일 부모. `<WORK_DIR>/worker/<jobId>-<attempt 앞 8자>/`에 원곡·flac·chart.json을 두고 끝나면 지운다 |
| `SSAPLASH_WORKER_POLL_SEC` | | 5 | 대기 작업이 없을 때(204) 다음 claim까지 |
| `SSAPLASH_WORKER_HEARTBEAT_SEC` | | 10 | heartbeat 주기 |
| `SSAPLASH_WORKER_KEEP_FILES` | | false | 참이면 작업 폴더를 지우지 않는다(문제 추적용) |
| `SSAPLASH_WORKER_SEND_REASON` | | false | 참이면 실패 보고 본문에 사용자에게 보여 줄 사유 `reason`을 넣는다. BE가 reason을 저장·노출하고 실제 연동을 확인한 뒤 켠다 |
| `SSAPLASH_NARRATIVE_ENABLED` | | false | 참이면 채보 작업이 없을 때 LLM 총평 작업을 가져간다(아래 "LLM 총평 작업") |
| `SSAPLASH_NARRATIVE_MODEL` | 켰을 때 | — | 같은 서버의 모델 서버에 올라 있는 모델 이름(Ollama는 `ollama list`) |
| `SSAPLASH_NARRATIVE_LLM_URL` | | `http://127.0.0.1:11434` | 모델 서버 주소. 같은 서버를 가리킨다 |
| `SSAPLASH_NARRATIVE_LLM_API` | | `ollama` | `ollama` 또는 `openai`(OpenAI 호환: vLLM, llama.cpp 서버) |
| `SSAPLASH_CHART_DEVICE`, `SSAPLASH_MODELS_DIR`, `SSAPLASH_CHART_MODEL` | | | 추론 모듈이 읽는 기존 변수. `SSAPLASH_CHART_MODEL`로 채보 모델을 고름 |

```bash
# 환경 변수·설정 yaml 검사, 분리·채보 모델과 음악 여부 검사 모델 올려 보기. BE는 부르지 않는다
uv run ssaplash-worker check
# 상시 실행. --once는 작업 하나만 처리하고 종료, --max-jobs N은 N개
uv run ssaplash-worker run
```

연주 중 LLM 구간 코칭 워커 `ssaplash-worker live-run`과 그 환경 변수 `SSAPLASH_LIVE_*`는 [docs/live-coach-llm.md](docs/live-coach-llm.md)에 있다.

종료 코드는 0 정상, 1 설정·모델 오류, 2 인증 실패(401)다. 로그는 표준 오류로 나가며 토큰과 서명 URL은 남기지 않는다. 종료 신호(Ctrl+C, SIGTERM)를 한 번 받으면 처리 중인 작업을 끝내고 멈추고, 두 번 받으면 바로 끝낸다(임대가 만료되면 BE가 다시 배정한다). 분리 모델 설정(`configs/chart/separation.yaml`)의 출력은 BE 계약대로 flac 44,100Hz여야 하며 아니면 시작하지 않는다.

| 실패 | BE 보고 `code` | `retryable` | `reason` | 뒤처리 |
| --- | --- | --- | --- | --- |
| 원곡 파일 못 읽음·길이 초과·무음, 배정 길이가 0 이하·600초 초과 | `INPUT_INVALID` | 거짓 | `SOURCE_INVALID` | BE가 FAILED |
| 분리한 드럼 트랙이 무음, 1분당 노트 수가 기준 미만, 박 추적 실패 | `INPUT_INVALID` | 거짓 | `NOT_TRANSCRIBABLE` | BE가 FAILED |
| 모델 올리기·추론 중 GPU 메모리 부족 | `MODEL_FAILED` | 참 | `GPU_OUT_OF_MEMORY` | BE가 다시 배정(단계별 최대 2회) |
| 모델 올리기·추론 중 그 밖의 예외, 워커 내부 예외 | `MODEL_FAILED` | 거짓 | `INTERNAL_ERROR` | BE가 FAILED |
| 채보 JSON 검증 실패, 출력 파일 128MiB 초과 | `OUTPUT_INVALID` | 거짓 | `INTERNAL_ERROR` | BE가 FAILED |
| heartbeat 409(임대 상실), 409·422 응답, 503·연결 오류 재시도(2·5·15초) 소진, 서명 URL 재발급 3회 실패, 내려받은 파일의 크기·sha256이 3번 다 배정과 다름 | 보고 안 함 | — | — | 작업을 놓는다. 임대가 끝나면 BE가 다시 배정 |
| 분리 전 음악 여부 검사에서 음악이 아닌 파일로 판단 (아래 "분리 전 음악 여부 검사") | `INPUT_INVALID` | 거짓 | `NOT_TRANSCRIBABLE` | 분리를 돌리지 않고 BE가 FAILED |

`reason`은 `SSAPLASH_WORKER_SEND_REASON`이 참일 때만 보낸다. 내려받은 파일의 크기·sha256이 다르면 다운로드가 잘렸거나 스토리지 파일이 바뀐 경우라 같은 URL로 다시 받고, 다를 때마다 jobId·attemptId·role·크기·sha256 앞 12자리를 WARNING 로그로 남긴다. 채보 가능 검사 기준은 `configs/chart/transcription.yaml`의 `drum_check`에 있고, `min_notes_per_minute`를 비워 두면 노트 수 검사는 하지 않는다. 서비스 설정값은 1분당 92개이고, 이보다 적으면 `NOT_TRANSCRIBABLE`로 끝난다.

결과 봉투의 `payloadHash`는 `result`만 BE와 같은 규칙(키 UTF-16 순 정렬, 공백 없음, Decimal 숫자)으로 정규화한 SHA-256이고 요청 본문도 그 정규 바이트다. 503이면 같은 `resultId`·`payloadHash`로 다시 보내 기존 Receipt를 받는다. 메모리 지표는 모듈이 MiB로 재고 BE는 MB(1,000,000바이트)라 워커가 환산한다.

### 분리 전 음악 여부 검사

노래가 아닌 파일(말소리, 소음, 해설이 대부분인 영상)을 올리면 분리와 채보가 GPU로 끝까지 돈 뒤 노트가 없는 채보가 만들어진다. 이를 막으려고 워커가 원곡을 내려받은 직후, 분리를 시작하기 전에 CPU로 검사 한 번을 돌린다. 걸린 파일은 분리를 돌리지 않고 실패 보고(`stage` `SEPARATING`, `reason` `NOT_TRANSCRIBABLE`)로 끝낸다. 실패 보고 본문 형식은 그대로라 BE·FE 변경이 없다.

- 원곡의 20·40·60·80% 위치에서 10초 구간 4개를 뽑아, 소리 종류를 맞히도록 학습된 분류 모델 AST(`MIT/ast-finetuned-audioset-10-10-0.4593`)로 구간마다 "음악일 확률"과 "말소리일 확률"을 구한다. 두 확률은 서로 독립이라 합이 1이 아니다
- 4구간 평균으로 판정한다. **음악 확률 평균이 0.28 미만이거나 말소리 확률 평균이 0.44 이상이면 실패**다. 구간 하나로 판정하지 않는 이유는 정상 랩 곡도 구간 하나는 말소리 확률이 0.5를 넘기 때문이다
- 드럼이 없는 음악은 이 검사로 못 거른다. 분류 모델이 섞인 소리에서 드럼 유무를 가르지 못했다. 그런 곡은 채보 뒤 노트 수 검사(`drum_check.min_notes_per_minute`)가 맡는다

기준값 0.28과 0.44는 "정상 곡이 1만 곡 중 1곡꼴로만 잘못 걸리는 값"이다. 정상 곡 782개의 두 확률을 구해 분포의 평균과 표준편차를 계산하고(확률을 logit으로 바꾼 값 기준), 1만 곡 중 1곡에 해당하는 위치를 기준값으로 삼았다. 2026-11-11 측정 결과는 아래와 같다.

| 파일 종류 | 파일 수 | 음악 확률 | 말소리 확률 | 검사에 걸림 |
| --- | --- | --- | --- | --- |
| 정상 곡: Songsterr 공용 곡, MUSDB18-HQ test, NCS 전자음악, 랩 곡 등 | 782 | 최소 0.38 | 최대 0.32 | 0 |
| 한국어 말소리 | 100 | 최대 0.01 | 최소 0.61 | 100 |
| 한국어 말소리에 실제 곡을 배경음악으로 깐 파일. 음악 크기는 말소리와 같거나 10·20·30dB 작게 | 120 | 최대 0.61 | 최소 0.46 | 120 |
| 소음·비명 | 8 | 최대 0.70 | 최대 0.50 | 8 |
| 축구 하이라이트 영상 | 1 | 0.11 | 0.57 | 1 |

- 정상 곡 가운데 음악 확률이 가장 낮은 곡은 발 구르기와 박수로 된 Queen의 We Will Rock You(0.38), 말소리 확률이 가장 높은 곡은 말로 시작하는 Van Halen의 Hot for Teacher(0.32)였다
- 말소리보다 배경음악이 더 큰 파일은 측정하지 않았다
- 분류 모델을 바꾸면 확률 분포가 달라지므로 기준값을 다시 정해야 한다

```bash
uv sync --extra models --extra transcribers --extra music-check   # 분류 모델 실행 패키지 transformers 추가
uv run ssaplash-chart music-check song.mp3    # 파일 하나의 두 확률과 판정. 걸리면 종료 코드 2
```

- 설정은 `configs/chart/music_check.yaml`이다. `min_music_prob`·`max_speech_prob`를 둘 다 비우면 검사를 하지 않고 분류 모델도 올리지 않는다. 워커에서 다른 설정 파일을 쓰려면 `--music-check-config <경로>`, 검사 없이 띄우려면 `--music-check-config ""`
- 분류 모델 가중치 330MB는 처음 올릴 때 Hugging Face에서 받아 사용자 캐시 폴더에 둔다
- 검사 시간은 곡 하나에 2~5초다(원곡 읽기 포함, 개발 PC CPU 기준). 정상 곡은 이만큼 처리 시간이 늘어난다. GPU는 쓰지 않는다
- 워커가 시작할 때 분류 모델을 올리지 못하면(패키지 없음, 가중치 내려받기 실패) 워커를 멈추지 않고 검사 없이 채보 작업을 계속한다. 검사가 빠진 채 도는 것은 세 곳에서 알 수 있다
  - 시작 로그에 ERROR 한 줄: `분리 전 음악 여부 검사 모델을 올리지 못해 검사 없이 계속함: <사유>`
  - 작업마다 WARNING 한 줄: `작업 <번호> 음악 여부 검사 없이 분리로 넘어감: 워커 시작 때 검사 모델을 올리지 못함 (<사유>)`
  - `uv run ssaplash-worker check` 출력의 `음악 여부 검사:` 줄. 정상이면 `켜짐`, 못 올렸으면 `[주의] 모델을 올리지 못해 검사 없이 돎`, 설정으로 껐으면 `꺼짐`
- 곡을 검사하다가 분류 모델 실행이 실패하면 그 곡만 WARNING `작업 <번호> 음악 여부 검사를 건너뛰고 분리로 넘어감: <사유>`를 남기고 분리로 넘어간다
- 검사가 도는지 확인하는 명령: `grep "음악 여부 검사" ~/ssaplash/results/worker.log | tail`
- 통과한 곡도 워커 로그에 `음악 여부 검사 통과: 음악 확률 0.80, 말소리 확률 0.02, 2118 ms`처럼 한 줄이 남는다. 운영 곡의 분포를 다시 확인할 때 쓴다

### LLM 총평 작업 (선택, COACH-003 후속)

규칙 총평을 같은 GPU 서버의 **로컬 오픈소스 모델**이 쓴 코치 문장으로 바꾼다(외부 유료 API 없음). 워커가 채보 작업이 없을 때
BE의 `/internal/v1/coach-narratives`에서 작업을 가져와 모델 서버에 문장을 부탁하고, 가드레일(`coach/narrative.py`)을 통과하면 제출한다.
실패하거나 BE에 이 API가 아직 없으면(404) 규칙 총평이 그대로 남고 채보 작업에는 영향이 없다. 계약과 가드레일은 `docs/coach-narrative.md`.

1. 같은 서버에 모델 서버를 띄우고 후보 모델을 받는다(예: Ollama). 모델 라이선스는 고를 때 확인한다.
2. 후보를 같은 사실로 비교한다(문장은 사람이 읽어 고른다):
   `uv run python scripts/eval_narrative.py --model <후보1> --model <후보2> --repeats 5 --out data/results/narrative-compare.md`
3. 모델을 정하면 워커 환경에 `SSAPLASH_NARRATIVE_ENABLED=true`, `SSAPLASH_NARRATIVE_MODEL=<이름>`을 넣고 워커를 다시 띄운다.

### 모델 없이 전체 흐름 확인 (fake BE)

BE 접속 정보가 없어도 혼자 끝까지 돌려 볼 수 있게 BE 대역을 넣어 뒀다. 6개 API와 저장소 GET/PUT을 흉내 내고, 토큰·attempt·임대·payloadHash·flac 길이·채보 JSON을 BE처럼 검사한다. 개발용이라 운영 코드가 아니다.

```bash
# 터미널 1: 곡을 작업으로 넣고 BE 대역을 띄운다. 작업이 다 끝나면 요약을 찍고 종료한다
uv run ssaplash-worker fake-be --song data/synth_v1/funk_108/mixture.wav --out data/fake_be
# 터미널 2: 터미널 1이 출력한 환경 변수 3개와 SSAPLASH_WORK_DIR을 넣고 워커를 돌린다
uv run ssaplash-worker run --once --separation-config configs/chart/separation_mock.yaml --transcription-config configs/chart/transcription_mock.yaml --music-check-config ""
uv run pytest tests/worker
```

`--music-check-config ""`는 분리 전 음악 여부 검사를 끈다. 켜 두면 실제 분류 모델을 올리고, 합성곡은 음악이 아닌 파일로 걸릴 수 있다. 실제 모델로 같은 흐름을 보려면 세 `--*-config` 인자를 빼면 된다. `data/fake_be/job-<번호>/`에 BE 대역이 받은 flac 두 개와 결과 JSON이 남는다.

### GPU 서버에서 띄우기

워커는 사내 GPU 서버(`~/ssaplash/S15P31A307/AI`, git 체크아웃)에서 `nohup`으로 상시 가동하고 EC2의 BE를 pull한다. 재부팅 뒤 자동 재시작은 없으므로 같은 순서로 다시 띄운다. 비밀 값은 저장소가 아니라 `~/ssaplash/worker.env`(권한 600)에 둔다.

서버 주의 두 가지. 서버 드라이버는 570(CUDA 12.8)인데 `uv sync`는 lock의 기본 PyPI torch(CUDA 13 휠)를 깔아 `libcusparseLt.so.0` 오류로 import가 깨진다. `uv sync` 뒤에는 아래처럼 torch를 CUDA 12.8 휠로 다시 깔고, 그다음부터는 `uv run --no-sync`로 실행해 `uv run`이 다시 lock에 맞추지 않게 한다. 작업 폴더에는 `separation.json`·`transcription.json`(시간·메모리)이 남으며 `SSAPLASH_WORKER_KEEP_FILES=1`일 때만 보존된다.

```bash
# 서버 코드 폴더는 브랜치 없이 origin/main을 꺼낸 상태라 git pull이 실패한다 (2026-11-12 확인). 아래처럼 받는다
cd ~/ssaplash/S15P31A307/AI && git fetch origin main && git checkout --detach origin/main
uv sync --extra models --extra transcribers --extra music-check
uv pip install --reinstall "torch==2.8.0" "torchaudio==2.8.0" --index-url https://download.pytorch.org/whl/cu128
uv run --no-sync python -c "import torch; print(torch.__version__, torch.cuda.is_available())"   # 2.8.0+cu128 True
# ~/ssaplash/worker.env 내용 (값은 BE·인프라에게 받음):
#   SSAPLASH_WORKER_BASE_URL=https://k15a307.p.ssafy.io
#   SSAPLASH_WORKER_ID=worker1
#   SSAPLASH_WORKER_TOKEN=<토큰>
#   SSAPLASH_WORK_DIR=$HOME/ssaplash/work
#   SSAPLASH_CHART_DEVICE=cuda
#   SSAPLASH_CHART_MODEL=strum           # 채보 모델. 이전 모델로 되돌릴 때는 songsterr_avg로 바꾸고 워커를 다시 띄움
#   CUDA_VISIBLE_DEVICES=6
#   OMP_NUM_THREADS=16              # CPU 스레드 수. 네 줄 모두 16
#   MKL_NUM_THREADS=16
#   OPENBLAS_NUM_THREADS=16
#   NUMEXPR_NUM_THREADS=16
chmod 600 ~/ssaplash/worker.env && set -a && source ~/ssaplash/worker.env && set +a
uv run --no-sync ssaplash-worker check
mkdir -p ~/ssaplash/results
setsid nohup taskset -c 0-127 uv run --no-sync ssaplash-worker run >> ~/ssaplash/results/worker.log 2>&1 < /dev/null &
sleep 3; pgrep -f "\.venv/bin/ssaplash-worker run" | tee ~/ssaplash/worker.pid   # 숫자 하나만 나와야 함
grep Cpus_allowed_list /proc/$(cat ~/ssaplash/worker.pid)/status                 # 0-127
tail -f ~/ssaplash/results/worker.log        # 상태
kill -TERM $(cat ~/ssaplash/worker.pid)      # 멈추기. 한 번만 보낸다. 두 번 보내면 처리 중인 곡을 버리고 바로 끈다
```

채보 모델 `strum`의 가중치는 이 서버에서 학습한 파일을 복사해 둔다. `SSAPLASH_MODELS_DIR`을 주지 않으면 가중치 폴더는 `AI/data/models`다. `worker.env`에 `SSAPLASH_CHART_MODEL`이 적혀 있으면 채보 설정 기본값보다 그 값이 우선이므로, 모델을 바꿀 때는 그 줄을 고치고 워커를 다시 띄운다. 띄운 뒤 워커 로그의 "채보 모델 선택:" 줄로 확인한다.

```bash
mkdir -p ~/ssaplash/S15P31A307/AI/data/models/strum_ft/songsterr_egmd
cp ~/ssaplash/ext_ft/runs/strum_p3_RE/best.pt ~/ssaplash/S15P31A307/AI/data/models/strum_ft/songsterr_egmd/best.pt
sha256sum ~/ssaplash/S15P31A307/AI/data/models/strum_ft/songsterr_egmd/best.pt   # 8b40efb11ef5…로 시작
```

워커는 CPU 0~127번 코어에 묶어 띄운다. 이 서버는 CPU 0~127번과 128~255번이 서로 다른 NUMA 노드인데, 2026-11-10 측정에서 128~255번 코어에서 돌면 같은 곡이 26.8초에서 265.2초로 10배 느려졌다. 묶지 않으면 리눅스가 고르는 코어에 따라 처리 시간이 40초에서 545초까지 달라진다. CPU 스레드 수를 정하지 않으면 워커가 코어를 수십 개 쓰면서 오히려 느려지므로 `worker.env`에 16을 넣는다. 처리 시간이 다시 늘어나면 [docs/트러블슈팅-워커-처리-속도.md](docs/트러블슈팅-워커-처리-속도.md)의 "다시 확인하는 법" 명령으로 두 노드를 다시 비교한다.

## 약점 구간 분석 (COACH-003, S15P31A307-138)

BE가 플레이 후 호출하는 통계 규칙 엔진이다(학습 모델 없음). `POST /analysis/weak-segments`로 `hits[]`를 받아
`weakSegments[]`를 돌려준다. 호출 형식·패턴 규칙·임계값 위치·시험 방법은 [docs/coach-weak-segments.md](docs/coach-weak-segments.md)에 있다.
악보 연습을 느리게 친 기록은 요청의 `playbackRate`(없으면 1)로 노트 시각을 곡 시각에 맞춘다(`tMs − deltaMs × playbackRate`).

```bash
uv run uvicorn ssaplash_ai.server.app:app --port 8000
uv run pytest tests/coach tests/server/test_weak_segments.py
```

### 약점 분석 합성 평가 (S15P31A307-139)

실제 플레이 로그가 없는 동안 규칙을 검증하는 도구다. 약점을 심은 가짜 플레이 로그를 만들어 `analyze()`가 찾는지(탐지율),
약점 없는 로그에서 잘못 찾는지(오탐률)를 잰다. 개발·평가 전용 패키지(`src/ssaplash_ai/coach_eval/`)다. 서버 이미지에는 소스 파일로 들어가지만 서버가 가져다 쓰지 않는다.
결과와 해석은 [docs/coach-eval/weak-segments-2026-10-29/summary.md](docs/coach-eval/weak-segments-2026-10-29/summary.md)에 있다.
합성 데이터 기준이라 "규칙이 설계대로 동작하는가"의 근거이지 정확도 주장이 아니다.

```bash
uv run python -m ssaplash_ai.coach_eval.cli --out docs/coach-eval/weak-segments-2026-10-29 --mlflow
uv run pytest tests/coach_eval
```

- 같은 `--base-seed`면 결과가 같다. 규칙·임계값을 바꾼 뒤에는 같은 명령으로 다시 돌려 비교한다(날짜 폴더를 새로 만든다).
- `--mlflow`는 실험 `coach-weak-segments-eval`에 기록한다. 주소는 `--tracking-uri`나 환경 변수 `MLFLOW_TRACKING_URI`이고 없으면 로컬 `mlruns/`(git 미추적)다.
- 시나리오(심는 약점)와 강도는 `coach_eval/scenarios.py`, 연주 모델은 `player.py`에 있다. 새 패턴을 켜면 시나리오를 하나 추가한다.

### 약점 분석 실측 보정 (COACH-003)

동의한 사용자의 **비식별** 연주 기록(BE 뷰 `coach_export_v`)으로 임계값 **후보**를 만들어 MLflow에 기록하는 배치다. 임계값을 자동으로 바꾸지 않고,
사람이 기록을 검토·승인한 뒤 `config.py`를 고치는 MR로만 바뀐다. 데이터 출처·제외 규칙·정책 파일·기록 규약·승인 절차는
[docs/coach-calibration.md](docs/coach-calibration.md)에 있다.

```bash
uv run pytest tests/coach_calibration
uv run python -m ssaplash_ai.coach_calibration.cli --help
```

- 접속 문자열은 환경 변수 `SSAPLASH_COACH_EXPORT_DSN`(읽기 전용 계정)으로만 받는다. 명령줄에 쓰지 않는다.
- 실행 끝에 `coach-calibration status=OK|SKIPPED|FAIL ...` 한 줄을 남긴다(알림이 이 줄을 본다).
- 정책 파일(`configs/coach/calibration_policy.yaml`)은 서버 이미지에 들어가지 않는다. 컨테이너에서는 마운트하고 `SSAPLASH_CALIBRATION_POLICY`로 경로를 준다.
- 뷰와 읽기 전용 계정이 서버에 적용되기 전에는 실제 DB 연결을 시험하지 못했다. 모든 시험은 뷰를 모사한 메모리 행으로 한다.

### 실시간 코칭 거름 모델 (COACH-001)

실시간 코칭이 띄운 지적이 진짜 경향인지 우연한 쏠림인지 점수를 내는 작은 모델이다. 문구를 만들지 않고 규칙이 낸 지적을 뺄 수만 있다.
지금은 학습 산출물을 FE 번들에 넣는다. 서버에서 모델을 받아 FE 배포 없이 바꾸는 구조(설계 COACH-001 2단계)를 위해 MLflow 등록까지 한다.

```bash
uv sync --extra coach-live
uv run --extra coach-live python -m ssaplash_ai.coach_live_model.cli --out runs/coach-live
uv run --extra coach-live pytest tests/coach_live_model
# MLflow에 기록하고 레지스트리에 새 버전으로 등록(서버 MLflow는 SSH 터널을 연 뒤)
MLFLOW_TRACKING_URI=http://localhost:5000 uv run --extra coach-live python -m ssaplash_ai.coach_live_model.cli --out runs/coach-live --register
```

- `--register`는 실험 `coach-live-gate`에 실행을 남기고(파라미터·지표·`report.json`), 레지스트리 모델 `coach-gate-mlp16`(`--model-name`으로 바꿈)에 새 버전을 만든다. 모델 폴더에는 브라우저가 받을 `coachGate.json`, `coachGate.onnx`, `meta.json`만 넣는다. 게시 도구가 모델 폴더를 그대로 복사하기 때문이다.
- 게시는 따로 서버에서 한다: `docker compose -p infra exec mlflow publish-model publish coach-gate-mlp16 <버전>`(`Infra/mlflow/README.md`). CLI가 등록한 버전으로 이 명령을 출력한다.
- `meta.json`: `task`(`gate`), `modelVersion`, `featureVersion`(입력 계산 버전, `dataset.py`의 `FEATURE_VERSION`), `inputNames`, `runtime`(이 버전에 든 실행 파일 목록: `json`·`onnx`), `threshold`, `trainedOn`(`SYNTHETIC`). FE는 `featureVersion`이 자기 값과 다르면 그 모델을 쓰지 않는다. `features()`의 순서·식을 바꾸면 `FEATURE_VERSION`을 올린다.
- 실험 설정(`coach-live-config`): 어떤 모델을 몇 %에게 어떤 모드로 쓸지 정하는 파일이다. 모델처럼 등록·게시하고 롤백한다. 예시는 `configs/coach/coach_live_config.json`(그림자 모드, `coach-gate-mlp16` 100%)이다.

  ```bash
  uv run python -m ssaplash_ai.coach_live_model.experiment check configs/coach/coach_live_config.json
  MLFLOW_TRACKING_URI=http://localhost:5000 uv run python -m ssaplash_ai.coach_live_model.experiment register configs/coach/coach_live_config.json
  ```

  형식은 FE `coach/live/models/experiment.ts`와 같다(`gate.mode`는 `off`·`shadow`·`on`, `arms[].share` 합 100, `rolloutPercent` 0~100). 등록할 때 실험군 모델이 레지스트리에 있는지 확인한다.
- 로컬 파일 저장소로 학습 → 등록 → `publish-model` 게시 → `manifest.json`(파일별 `sha256`)까지 이어지고, 그 폴더를 FE `refreshCoachModels`가 받아 실험군 모델을 고르는 것까지 확인했다. 서버 MLflow 등록과 게시는 아직 하지 않았다.

- `replay.py`는 FE `coach/live`의 창·규칙·표시 정책·판정 단계·놓침 원인을 옮긴 것이다. FE 규칙을 바꾸면 `tests/fixtures/coach_live/fe_replay.json`을 다시 뽑아 맞춘다. 기록은 띄운 시점·대상·지표에 더해 단계, 원인 후보, 고른 원인까지 FE와 같아야 한다.
  - 판정 단계: 판정 4개 전에는 띄우지 않고, 4~7개는 연속 놓침만, 8개부터 전부. 위 학습 데이터도 이 단계로 재생한다.
  - 놓침 원인: 2단계(8개)부터 놓침 지적에 원인 후보를 계산하고 규칙 순서(다른 패드 → 패드 이동 → 빠른 구간 → 늦어짐)로 하나를 고른다. 근거가 없으면 `UNKNOWN`. 패드 이동은 같은 패드를 다른 곳에서 넘어와 친 노트와 비교해 2.5배 이상 더 놓칠 때만 본다(비교 대상이 없으면 보지 않는다). 원인 계산에는 노트 시각, 직전 시점의 패드·간격, 채보 밖 타격, 곡의 노트 간격 중앙값이 필요하고 `replay(notes, strays, note_gap_median_ms)`로 넘긴다.
- 원인 합성 시나리오(`dataset.py`의 `cause_plays`, `build_cause_rows`): 다른 패드(탐1 대신 탐2), 패드 이동(하이햇 → 스네어), 빠른 구간(400ms 사이 150ms 몰아치기), 늦어지다 놓침, 대조군(원인 없이 자주 놓침)을 만든다. 행은 원인을 고른 놓침 지적마다 하나이고 라벨은 심은 원인(대조군은 `UNKNOWN`)이다. 원인 모델 학습(R1)의 자료다.
- 학습 데이터는 합성 연주다. 시나리오가 심은 약점과 같은 지적이 1, 약점이 없는 연주에서 뜬 지적이 0이다. 판 단위로 나눠 평가한다.
- 산출물은 `coachGate.json`, `coachGate.onnx`, `meta.json`, `report.json`이다. 앞의 둘은 같은 모델이고 두 파일의 출력 차이가 `1e-5` 이하인지 확인한다.

합성 결과(판 2,580개, 지적 13,932건, 진짜 11,636건, 오탐 2,296건):

| 모델 | AUC | 탐지 95%에서 남는 오탐 | 탐지 98%에서 남는 오탐 |
| --- | --- | --- | --- |
| 로지스틱 회귀 | 0.943 | 25.9% | 40.5% |
| MLP 16 | 0.980 | 10.1% | 15.2% |
| MLP 32×16 | 0.980 | 10.0% | 14.8% |

**합성 성능은 실제 성능이 아니다.** 합성 연주는 판 내내 오차 분포가 같고 실제 사람은 곡 중간에 변한다. 켜기 전에 그림자 평가로 확인한다.

### 놓침 원인 모델 (COACH-001)

놓침 지적에 원인 후보가 여럿 걸렸을 때 규칙 순서(다른 패드 → 패드 이동 → 빠른 구간 → 늦어짐) 대신 무엇을 고를지 학습한 작은 모델이다. 규칙이 낸 후보와 `UNKNOWN`(근거 없음) 중에서만 고르고, 없는 원인을 만들지 않는다.

```bash
uv run --extra coach-live python -m ssaplash_ai.coach_live_model.cause_model --out runs/coach-cause
MLFLOW_TRACKING_URI=http://localhost:5000 uv run --extra coach-live python -m ssaplash_ai.coach_live_model.cause_model --out runs/coach-cause --register
```

- 데이터: 원인 합성 시나리오(`build_cause_rows`). 입력은 원인별 후보 강도, 3단계 여부, 패드 놓침 여부(`cause_features`, `CAUSE_FEATURE_VERSION`=1). 라벨은 심은 원인.
- 로지스틱 회귀와 MLP16을 판 단위 5겹 교차 검증으로 규칙 순서와 비교하고, 정확도가 같으면 로지스틱을 고른다. 모델이 규칙보다 낫지 않으면 경고를 출력한다.
- 산출물: `coachCause.json`(표준화 값과 층 `layers[{w,b,act}]`, softmax), `meta.json`(`task: cause`, `classes`), `report.json`. `--register`는 실험 `coach-live-cause`, 모델 이름 `coach-cause-<구조>`로 등록한다. `--fixture`는 FE 계산 비교용 표본을 쓴다(FE `coach/live/models/cause.parity.fixture.json`).
- 서비스에서 쓰려면 게시한 뒤 실험 설정의 `cause.arms`에 넣는다.

합성 결과(시나리오당 강도 3 × 20판, 원인을 고른 놓침 지적 1,542건, 후보가 겹친 지적 64건):

| | 정확도 | 후보가 겹친 지적 | 대조군에서 UNKNOWN |
| --- | --- | --- | --- |
| 규칙 순서 | 94.8% | 92.2% | 90.3% |
| 로지스틱 | 95.1% | 98.4% | 93.5% |
| MLP16 | 95.1% | 98.4% | 93.5% |

- 개선은 후보가 겹친 지적과 대조군에서 나온다. 전체 차이가 작은 건 겹친 지적이 4%뿐이어서다.
- 남은 오류(늦어짐 약 8%, 패드 이동 약 10%)는 규칙이 후보를 내지 못한 지적이라 이 모델로는 고칠 수 없다. 규칙 문턱을 운영 기록으로 고쳐야 한다.
- 합성 데이터의 원인은 한 판에 하나씩 심었다. 실제 사람은 여러 원인이 섞이므로 운영 `LIVE_CAUSE`로 다시 학습한다.

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
| `--no-warmup` | 모델 로드 뒤 첫 곡 워밍업 분리를 생략 | 꺼짐 |
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

모델 yaml은 어댑터(`msst`, `demucs`, `openunmix`, `ensemble`, `mock`)와 가중치 위치, 코드·가중치 라이선스 문자열을 적는다. 라이선스 두 필드는 필수다. MSST 가중치는 첫 실행 때 `data/models/<모델>/`(환경 변수 `SSAPLASH_MODELS_DIR`이 있으면 그 아래)에 내려받고, demucs·openunmix 가중치는 torch hub 캐시에 받는다. 다운로드 시간은 로드 시간(`loadSec`)에 넣지 않는다.

### 실제 곡 분리 품질 평가 (S15P31A307-166)

음원 분리 모델을 실제 드러머 녹음에 돌린 결과와 해석은 `docs/bench/separation-real-2026-10-29/evaluation.md`에 있다. 드럼 SDR은 ENST-Drums minus-one 64곡으로 재고, MDB Drums는 드럼 단독 트랙이 완성곡 속 드럼과 달라 타격 보존율만 본다. ENST 로더는 `bench/datasets/enst.py`, 설정은 `enst_minus_one.yaml`이다.

ENST 드럼과 반주를 녹음된 음량 그대로 더한 조건과 확인 스크립트는 ENST가 있는 PC에서 돌린다.

```bash
# ENST 드럼과 반주를 녹음된 음량 그대로 더해 분리, 분리 wav 64곡 저장
uv run ssaplash-bench run --models configs/bench/models/msst/bs_roformer_sw.yaml --dataset configs/bench/datasets/enst_minus_one_gain1.yaml --save-wav 64 --run-id sep-enst-gain1 --mlflow-uri none

# 정답 드럼 파일·분리하지 않은 완성곡·분리한 드럼 세 입력의 타격 보존율을 같은 정답으로 비교
uv run python scripts/check_onset_merged.py configs/bench/datasets/enst_minus_one_gain1.yaml --separated data/results/sep-enst-gain1/separated/bs_roformer_sw --out data/results/onset_merged_enst_gain1.csv

# MDB 드럼 단독 트랙과 같은 녹음의 MUSDB18 train 드럼 스템 비교 (MUSDB18-HQ train이 data/musdb18hq/train에 있어야 함)
uv run python scripts/compare_mdb_musdb_stems.py --out data/results/mdb_musdb_stems.csv
```

### 드럼리스 MR 품질 비교 (S15P31A307-165)

드럼리스 MR(반주)이 원곡보다 작고 먹먹하게 들리는 원인을 찾고 개선 후보를 비교한 결과는 `docs/bench/mr-quality-2026-10-31/summary.md`에 있다. 정답 MR이 정확한 ENST 64곡(드럼과 반주를 녹음된 음량 그대로 더함)과 MUSDB18-HQ test 50곡(곡마다 30~60초)으로 잰다. MR 지표는 아래 "지표 정의" 표의 `mr*` 열이다.

후보는 모델 yaml 필드로 만든다. 서비스 기본값은 모두 첫 줄의 기본값이다.

| 필드 | 뜻 | 기본 |
| --- | --- | --- |
| `accomp_mode` | 반주 만드는 방식. `subtract`는 원곡 − 드럼, `sum_others`는 드럼 외 스템의 합 | `subtract` |
| `accomp_drum_ratio` | `subtract`일 때 원곡에서 뺄 드럼 비율. 드럼 트랙은 그대로 | 1.0 |
| `output_limiter` | 반주에 서비스 저장과 같은 리미터를 걸고 잼 | false |
| `high_return_hz` | 이 주파수 위 드럼 트랙에서 길게 이어지는 소리를 반주로 되돌림 | 없음 |
| `use_tta` | 극성을 뒤집은 입력과 좌우를 바꾼 입력을 더 분리해 평균 (msst). 분리 시간 약 3배 | false |
| `weights_name` | 같은 가중치를 설정만 바꿔 쓸 때 원래 모델 이름 | `name` |

두 모델 드럼 평균은 `configs/bench/models/ensemble/`의 `ensemble` 어댑터(`members`에 모델 yaml 목록)로 만든다.

ENST가 있는 PC에서 후보 하나를 돌리는 명령은 아래와 같다.

```bash
# ENST를 MUSDB 폴더 모양으로 한 번 내보냄
uv run python scripts/export_enst_as_musdb.py configs/bench/datasets/enst_minus_one.yaml data/enst_gain1_musdb/test --accomp-gain 1.0

# 후보 하나 × ENST 64곡, 결과는 data/results/mrq-enst-limit/
uv run ssaplash-bench run --models configs/bench/models/msst/bs_roformer_sw_limit.yaml --dataset configs/bench/datasets/enst_gain1_musdb.yaml --run-id mrq-enst-limit --mlflow-uri none
```

## 채보 벤치마크 실행 (S15P31A307-109)

채보 모델은 드럼 소리를 넣으면 "몇 초에 어느 드럼을 쳤는지" 목록을 적어 주는 모델이다. 이 하네스는 채보 모델 여러 개를 같은 곡으로 돌려 정답 타격(아래 "채보 벤치마크 정답 데이터")과 맞춰 보고 점수표를 만든다. 분리 벤치마크와 같은 뼈대(모델 yaml × 데이터셋 yaml → 곡마다 CSV 한 줄 → 보고서 → MLflow)이고, 다른 점은 세 가지다.

- **입력이 세 가지**다. `--input drums`(정답 드럼 트랙), `mixture`(원곡 그대로), `separated`(분리 모델이 뽑은 드럼). 한 번 실행에 하나만 고르고, 결과표에서 합쳐 본다. `separated`는 `--separator`로 분리 모델 yaml을 주면 곡마다 분리해 `separated/<분리 모델>/<곡>/drums.wav`에 저장해 두고 다음부터는 읽기만 한다. 다른 run 폴더의 그 파일을 쓰려면 `--separated-dir`.
- **모델이 내는 드럼 이름을 우리 패드 9종으로 바꾸는 표**가 모델 yaml의 `labels`에 있다. 값은 패드 이름(`KICK`…`RIDE`, `HIHAT_PEDAL`. `HIHAT_PEDAL`은 없어도 8패드 점수를 매긴다), 탐 3종을 못 나누면 `tom`, 크래시·라이드를 못 나누면 `cymbal`, 패드에 없는 타격(클랩·카우벨 등)은 `__drop__`. `tom`·`cymbal`이 있으면 8패드 점수는 매기지 않고 5가지 점수만 낸다.
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
| `--dataset` | 타격 정답이 있는 데이터셋 yaml (synth_v1, gmd_test, mdb_drums, mdb_drums_unseen, egmd·star_drums·enst·public_songs 계열). MUSDB는 정답이 없어 거부 | 필수 |
| `--input` | `drums` / `mixture` / `separated` | `drums` |
| `--separator`, `--separated-dir` | separated일 때 분리 모델 yaml / 이미 분리된 wav 폴더 | 없음 |
| `--save-midi N` | 모델당 예측 타격을 MIDI로 저장할 곡 수 (`midi/<모델>/<곡>.mid`, 청취·플레이 평가용) | 0 |
| `--out`, `--device`, `--clip`, `--run-id`, `--no-warmup`, `--mlflow-uri` | 분리 벤치마크와 같음. `--run-id`로 이어하기(키는 묶음·모델·입력·분리 모델·곡) | |

결과 폴더 `data/results/<runId>/`

| 파일 | 내용 |
| --- | --- |
| `results.csv` | 곡 × 모델 × 입력당 1행. 5가지·8패드 기준 맞힌·헛것·놓친 개수(±50ms·±25ms)와 곡 단위 F1, Perfect 폭 적중률, 시각 오차, 세기 상관, 채보 시간·RTF·로드 시간·메모리, `eightPad`(8패드를 다 내는지), `input`·`separator`, 실패 시 `error` |
| `hits_by_class.csv` | 기준(`scheme`: five·pads·pads9)과 라벨별 개수. pads9에는 페달 혼동 수 행 둘. 보고서의 패드별 F1 표 재료 |
| `summary.md` | 데이터 묶음별 비교표(5가지 F1, 8패드 F1, 분리 후 F1 변화, Perfect 폭 적중률, RTF, 피크 GPU 메모리, 가중치 라이선스), 보조값, 패드별·5가지별 F1, 실패 목록 |
| `per_song.csv`, `f1_by_model.png`, `rtf_vs_f1.png` | 곡별 값, 정답 드럼 입력의 모델별 F1 막대, RTF 대 F1 산점도(기준선 0.15). 그래프는 묶음마다 칸 하나 |
| `separation_effect.png` | 입력을 둘 이상 넣은 묶음만. 모델별로 정답 드럼·분리 드럼·원곡을 넣었을 때의 F1 막대 |
| `separated/`, `inputs/`, `midi/` | 분리 드럼 캐시, 별도 환경 모델에 넘긴 입력 wav, 저장한 예측 MIDI |

MLflow 실험 이름은 `transcription-bench`다. 모델 yaml의 `labels`가 바뀌면 `configHash`가 바뀌어 기록에 남는다.

### 채보 모델과 환경

| 모델 | yaml | 어댑터 | 환경 | 8패드 | 비고 |
| --- | --- | --- | --- | --- | --- |
| ADTOF | `adtof/adtof.yaml` | adtof | extra `transcribers` | 5가지만 | 가중치 패키지 포함. CC BY-NC-SA |
| ADTOF + 드럼 킷 분리 | `adtof_drumsep/adtof_drumsep.yaml`, `adtof_drumsep/adtof_drumsep_ds_ov2.yaml`(드럼 킷 분리 조각 겹침 4 → 2, 서비스 되돌리기 대상 `original`) | adtof_drumsep | extra `models` + `transcribers` | 8 | ADTOF 결과의 탐·심벌을 MDX23C DrumSep 6스템(첫 실행 때 437MB 다운로드)과 규칙(곡 안 탐 음높이를 묶어 이름 붙이기, 크래시·라이드 스템 에너지)으로 나눔. DrumSep 가중치 라이선스 미명시 |
| ADT_STR | `external/adt_str_tau08.yaml` (tau 0.4·0.6 변형도 있음) | external | `.venv-adt-str` + `ext/ADT_STR` | 8 | torch 2.8 고정이라 별도 환경. HF `Pierfrancesco/adt-str`에서 가중치 자동 다운로드. CC BY-SA |
| Inverse Drum Machine | `external/idm.yaml` | external | `.venv-idm` + `ext/inverse-drum-machine` | 8 | numpy<2 등 고정이라 별도 환경. 가중치 저장소 포함. Apache-2.0 |
| STRUM 8종 온셋 CRNN | `strum/strum_crnn_songsterr_egmd.yaml` | strum_crnn | extra `models` | 8 | STRUM `drums_phase3`(42M)을 실제 곡과 E-GMD로 이어 학습한 가중치 + 킥 규칙. 서비스 기본. 가중치 169MB는 직접 넣는다. 코드·공개 가중치 MIT |
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
# pyaudio·vamp·pyfluidsynth를 직접 깔므로 Linux에서는 apt로 portaudio19-dev·fluidsynth를 먼저 둔다
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

### 채보 규칙 분석 도구 (S15P31A307-163)

ADTOF + 드럼 킷 분리 모델(2026-11-10까지 서비스 기본, 지금은 되돌리기 대상 `original`)은 탐 3종·크래시/라이드를 규칙으로 나눈다(`configs/bench/transcribers/adtof_drumsep/adtof_drumsep.yaml`의 `rules`). 서비스 기본 STRUM의 규칙은 `bench/transcribers/strum_rules.py`에 있고 이 도구의 대상이 아니다. 규칙값을 바꿔 가며 다시 재는 일을 빠르게 하기 위해, 무거운 계산(ADTOF·드럼 킷 분리)은 곡마다 한 번만 GPU로 돌려 저장하고 규칙 비교는 CPU로 몇 초 안에 한다.

```bash
# 1. 특징 저장 (GPU, 한 번). 정답 드럼 트랙 입력으로 ADTOF 타격 시각·프레임별 확신 점수와 드럼 킷 분리 트랙 전부(kick·snare·toms·hh·ride·crash)를 data/rule_features/<데이터셋>/<곡>.npz 에 둔다. 있으면 건너뜀.
#    2026-10-27 전에 만든 파일은 점수와 kick·snare·hh 트랙이 없으므로 --overwrite 로 다시 만든다 (탐 시각 다시 고르기·거르기 분모 옵션에 필요)
uv run ssaplash-bench rule-features --dataset configs/bench/datasets/gmd_test.yaml configs/bench/datasets/mdb_drums.yaml
# 2. 정답 탐 타격의 음높이 분포·경계 후보·곡 하나 빼고 확인. 후보는 candidates.yaml로 나와 3번에 바로 넣는다
uv run ssaplash-bench tom-pitch --dataset configs/bench/datasets/mdb_drums.yaml configs/bench/datasets/gmd_test.yaml --out data/results/tom-pitch
# 3. 규칙 후보 비교 (CPU). 후보 하나 = MLflow run 하나(실험 chart-rules). 후보 rules에 모델 yaml의 rules를 그대로 넣으면 그 yaml로 돌린 벤치마크 hits_by_class.csv와 같은 개수가 나와야 한다
uv run ssaplash-bench rule-eval --dataset configs/bench/datasets/gmd_test.yaml configs/bench/datasets/mdb_drums.yaml --candidates data/results/tom-pitch/candidates.yaml --out data/results/rule-eval --mlflow-uri mlruns
```

후보 yaml은 `candidates: [{name, rules}]` 목록이거나 `{name, rules}` 하나이며 `rules`는 모델 yaml의 `rules`와 같은 키만 쓴다(없는 키는 기본값). 결과 폴더에 `candidates.csv`(후보 × 데이터셋: 패드별 F1, 탐·심벌 배정 정확도, 정답 없는 탐 수, 버린 탐 수), `confusion.csv`·`summary.md`(혼동표), `by_song.csv`(곡마다 버린 탐 수 `tomDropped`, 묶음 수·중앙값 `tomClusters`·`tomClusterHz`)가 생긴다. `--two-tom-upper MID_TOM`을 주면 정답에 탐 패드가 둘뿐이고 하나가 플로어탐인 곡의 나머지 탐 이름을 미드로 바꿔 채점한다(전자 드럼 데이터가 탐 둘 연주의 위쪽 탐을 스몰로 적는 것을 실제 킷 표기에 맞추는 용도. 2026-10-28 결정). 배정 정확도는 정답과 시각이 맞은 타격 중 패드를 맞게 붙인 비율로, 모델이 놓치거나 잘못 잡은 것은 빼고 규칙만의 성능을 본다. `run-transcription`도 이제 MLflow에 패드별 F1(`f1_KICK` 등)과 규칙값(`rules.tom_bands` 등)을 함께 남겨 run끼리 패드 단위로 비교할 수 있다.

탐 규칙에는 아래 선택 키가 있다 (S15P31A307-164 실험). 코드 기본값은 전부 꺼져 있어 안 넣으면 결과가 전과 같다. `adtof_drumsep.yaml`과 서비스 되돌리기 대상 `adtof_drumsep_ds_ov2.yaml`은 2026-10-31부터 `tom_gate_ratio 0.10`·`tom_peak_mode raw`·`tom_mode relative`·`tom_relative_method peaks`·`tom_relative_naming hybrid`·`tom_relative_min_gap 3.0`·`cymbal_crash_weight 0.7`을 켠다(결과 `docs/chart-rules/tom-finetune-2026-10-31/`). 거르기를 켜려면 어댑터 입력 드럼이 필요하며, `rule-eval`·`tom-pitch`는 데이터셋의 정답 드럼 트랙을 자동으로 읽어 쓴다.

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
| `tom_kick_exclude_st` | 없음 | 켜면 곡의 킥 음높이를 재서, 탐 음높이의 가장 큰 피크가 킥 음높이 ±이 반음 안이면 그 밖의 가장 큰 피크가 최대의 `tom_kick_exclude_ratio`(0.2)배 이상일 때 그쪽을 쓴다. `tom_kick_cluster_st`(1.0)가 있으면 곡 안 탐 묶음 중 중앙값이 킥 음높이 ±1반음 안인 묶음의 타격만 다시 재고 다시 묶는다. 킥 음높이는 ADTOF 킥 시각에서 `tom_kick_pitch_source`(`kick` 트랙 또는 `input`)의 피크 중앙값, `tomKickHz` 열. 킥을 높게 조율한 세트(ENST 드러머 1, 킥 101Hz)에서 킥 울림이 탐 묶음으로 잡혀 이름이 밀리는 경우 대응 |
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

곡 안 탐 그룹 나누기·이름 붙이기 값을 다시 고를 때는 스크립트 세 개를 쓴다. `tom_rule_grid.py`가 `adtof_drumsep.yaml` 규칙에서 탐 그룹 키만 바꾼 후보 yaml을 만들고, `tom_rule_eval_stream.py`가 곡마다 특징을 읽어 후보 전부를 rule-eval과 같은 계산으로 채점한다. rule-eval은 특징을 한꺼번에 메모리에 올려서 E-GMD test 1,170개처럼 큰 데이터는 이 스크립트를 쓴다. `tom_rule_pick.py select`는 E-GMD 키트마다 탐 이름 정확도를 내고 키트 평균으로 후보를 고른 뒤 키트 하나 빼기를 반복하고, `enst`는 ENST에서 지금 규칙 대비 차이와 같은 곡끼리 다시 뽑은 95% 구간을 드러머별로 낸다. 결과는 `docs/chart-rules/tom-rule-retune-2026-11/`. 서비스처럼 원곡을 분리한 드럼으로 특징을 만들 때는 `scripts/rule_features_separated.py --separator <분리 모델 yaml> --dataset <데이터셋 yaml> --out <특징 폴더>`를 쓴다. 채보에 넣은 분리 드럼을 `stem_input`으로 같이 저장해 채점 스크립트가 거르기 입력으로 쓴다.

```bash
uv run python scripts/tom_rule_grid.py --out docs/chart-rules/tom-rule-retune-2026-11
uv run python scripts/tom_rule_eval_stream.py --dataset configs/bench/datasets/egmd_test_acoustic.yaml --features data/rule_features --candidates docs/chart-rules/tom-rule-retune-2026-11/candidates_part1.yaml --two-tom-upper MID_TOM --workers 16 --out data/results/tom-rule-retune/stream_egmd_test.csv
uv run python scripts/tom_rule_pick.py select --egmd data/results/tom-rule-retune/stream_egmd_test.csv --candidates docs/chart-rules/tom-rule-retune-2026-11/candidates_part1.yaml --out docs/chart-rules/tom-rule-retune-2026-11/pick.json
uv run python scripts/tom_rule_pick.py enst --pick docs/chart-rules/tom-rule-retune-2026-11/pick.json --set enst_drums=data/results/tom-rule-retune/stream_enst_drums.csv:0.828 --set enst_mix_g100=data/results/tom-rule-retune/stream_enst_sep.csv:0.782 --out docs/chart-rules/tom-rule-retune-2026-11/enst.md
```

### 실제 곡(Songsterr 인기곡)으로 채보 평가

데이터셋 `kind: songsterr`는 Songsterr 드럼 탭을 원곡 박에 맞춘 정답과 서비스 분리 모델이 뽑은 드럼을 읽는다. 곡 폴더는 `data/songsterr/{곡}/final/`이다. 시험 31곡 `public_songs.yaml`, 학습·검증용 새 곡 `public_songs_train_*.yaml`·`public_songs_val.yaml`, 확인용 처음 보는 곡 `public_songs_holdout38.yaml`이 있다. 결과와 결론은 `docs/bench/public-songs-2026-11/expand.md`, 후처리 후보는 `docs/chart-rules/postproc-2026-11/summary.md`.

| 스크립트 | 하는 일 |
| --- | --- |
| `public_songs_eval.py features` | 분리 드럼으로 채보 특징을 만들고 `stem_input`으로 입력 드럼을 같이 저장 |
| `public_songs_eval.py score`, `report` | 후보 json마다 곡별 8패드 tp·fp·fn csv / 전체·패드별·곡별 F1과 95% 구간 |
| `make_songsterr_splits.py` | 정렬 결과가 좋은 새 곡을 검증·학습 목록으로 나누고 학습 설정 `configs/train/songsterr_*.yaml`을 만듦 |
| `postproc_eval.py` | 규칙 값·문턱값·후처리 후보를 곡마다 채점하고, 같은 곡끼리 다시 뽑은 95% 구간으로 비교 |
| `ensemble_eval.py` | ADTOF 가중치·입력 여러 개의 점수를 열마다 평균해 채보. `--pads`로 크래시·라이드 이름을 8패드 모델 것으로 바꾼 줄도 냄 |
| `pad_combo_eval.py` | ADTOF + 드럼 킷 분리(`adtof_drumsep.yaml`) 채보와 8패드 학습 모델을 패드별로 섞어 채점 |
| `tom_merged_eval.py` | 탐 3종을 하나로 합쳐 채점 |
| `repeat_consensus_eval.py` | 비슷한 마디끼리 ADTOF 점수를 섞어 채보 |
| `hit_error_breakdown.py`, `time_offset_eval.py` | 틀린 타격 종류별 개수, 타격 시각을 일정하게 밀었을 때 점수 |

위 표의 스크립트가 말하는 규칙은 `adtof_drumsep.yaml` 규칙이다. 11/07 파인튜닝·후처리 실험에 쓴 `adtof_ckpt_eval.py`, `make_egmd_overlay.py`, `make_egmd_separated.py`, `render_stemgmd_kits.py`, `cymbal_context_eval.py`의 결과는 `docs/chart-rules/finetune-sep-2026-11/`와 `docs/chart-rules/cymbal-context-2026-11/`에 있다.

```bash
uv run python scripts/public_songs_eval.py features --songs data/songsterr --out data/rule_features/public_songs
uv run python scripts/ensemble_eval.py --dataset configs/bench/datasets/public_songs_holdout38.yaml --pads data/models/songsterr_ft/pads_all_noguard/last.pth --cand base=default@drums --cand avg_five_notom=default@drums,data/models/songsterr_ft/five_all/last.pth@drums:kshc --out data/results/ensemble/holdout38.csv
```

### 오디오 LLM 마디 단위 하이햇·라이드 시험 (S15P31A307-325)

소리를 직접 듣는 LLM에 한 마디 길이 오디오를 들려주고 박을 세는 심벌이 하이햇인지 라이드인지 물어, 같은 마디의 당시 서비스 채보·8패드 모델·분리 트랙 에너지와 비교했다. 2026-11-10 결과로 채택하지 않았다. 6개 모델 모두 기존 방법보다 낮았다(`docs/chart-rules/audio-llm-cymbal-2026-11/summary.md`). 실험 스크립트 `cymrole_audio_*.py`와 서버 노트북은 저장소만으로는 돌지 않아 S15P31A307-324에서 뺐고, MR !411 이력에 남아 있다.

### 채보 모델 파인튜닝 (S15P31A307-164)

ADTOF Frame_RNN(파라미터 45만 개, 되돌리기 대상 `original`이 쓰는 모델)을 E-GMD·STAR Drums의 정답 드럼 트랙으로 더 학습시켜 탐 검출을 올린다. 2026-10-31 결과로 파인튜닝 가중치는 채택하지 않았다. MDB 탐은 올랐지만 학습에 안 쓴 실제 녹음 ENST에서 탐이 떨어졌다(`docs/chart-rules/tom-finetune-2026-10-31/summary.md`). 되돌리기 대상 `original`은 기본 가중치 그대로이고 아래 도구는 재시도용으로 남긴다. 모델 구조·입력 특징은 그대로이고 가중치 파일만 바뀌므로 어댑터·벤치마크·서비스 추론은 yaml의 `checkpoint_path`만 바꾸면 그대로 돈다. 원본 ADTOF 학습 코드는 Keras이고 학습 데이터는 신청제라 학습 코드를 새로 썼다(`src/ssaplash_ai/train/`). 학습은 GPU 서버에서 돌리고, 로컬은 pytest의 합성 데이터 몇 스텝(CPU)까지만 한다.

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
| `train_datasets` / `val_datasets` | 데이터셋 yaml과 뽑을 비율(`weight`) / 검증에 쓸 yaml과 곡 수(`n_songs`, 고정 시드). 검증은 E-GMD validation·STAR validation 20곡씩이고 MDB·ENST·GMD test·E-GMD test·STAR test는 학습 뒤 한 번만 본다. 학습 항목에 `ignore_classes: [pedal]`처럼 적으면 그 데이터셋 윈도에서 해당 클래스 손실을 뺀다(주석에 페달 표시가 없는 ENST용) |
| `tom_window_frac` / `tom_weight_mult` | 탐 강조 둘. 윈도 중 정답 탐 타격을 가운데 두고 자르는 비율(0.5) / 탐 클래스 가중치 배수(2.0). 안 쓰려면 0과 1 |
| `pedal_weight_mult` | 페달 클래스 가중치 = 하이햇 가중치 × 이 값(2.0). `five_pedal`·`five_pedal_cym`·`pads`만 |
| `accomp_mix_prob` / `accomp_gain_range` | 반주가 있는 곡(STAR)에서 반주를 섞을 확률(0.3)과 게인(0.05~0.3). 분리 결과에 남는 반주 소리를 흉내 냄 |
| `select_metric` | 검증에서 best.pth를 고르는 기준. 기본 `tom_f1`(탐 검출 F1). `f1`은 5가지 합계, `tom_pedal_f1`은 탐 F1과 페달 F1의 평균, `focus_f1`은 탐·페달·크래시·라이드 F1의 평균(`five_pedal_cym`) |
| `guard_drop` | 학습 시작 전에 기본 가중치를 5클래스로 검증한 점수가 기준값. 5가지 클래스 F1 중 하나라도 기준값보다 이만큼(0.02) 넘게 떨어진 에폭은 best.pth로 고르지 않음. log.csv의 `guard` 열과 에폭 -1 줄(학습 시작 가중치 점수)로 확인. 조건을 넘는 에폭이 없으면 마지막 가중치를 저장하고 경고 |
| `fit_thresholds` | 학습 끝에 검증 곡으로 클래스별 문턱값(0.10~0.60, 0.02 간격)을 맞춰 체크포인트 `model_info.thresholds`에 저장. 어댑터가 그 값을 읽고, yaml `thresholds`가 있으면 그것이 우선 |
| `freeze_cnn` | 켜면 CNN 블록은 고정하고 GRU·출력층만 학습 |

끊긴 학습은 같은 명령에 `--resume`을 붙이면 `--out`의 `last.pth`·`log.csv`에서 이어 간다. 최고점·안 오른 에폭 수·학습률은 `log.csv`로 다시 계산하고, 옵티마이저 상태는 저장하지 않아 새로 시작한다. GPU 서버에서는 학습을 하나씩 돌리는 `scripts/train_queue.py`(`start`·`status`·`stop`)를 노트북 5·6번 셀이 부른다. 학습마다 실행 폴더에 코드 사본을 풀어 돌리므로, 학습 중에 공유 코드 폴더를 다시 풀어도 도는 학습은 바뀌지 않는다. `start`에 `--parallel 4`를 주면 넷까지 같이 돌리고, `--cpus 0-95`를 주면 학습과 데이터 읽기 작업을 그 코어에만 묶어 Jupyter가 쓸 코어를 남긴다.

#### 실제 녹음 학습 확인 실험

학습 데이터에 실제 녹음 드럼이 없어서 ENST 탐이 떨어졌는지 확인하는 실험이다(2026-10-31 MDB·ENST 제공 측에서 학생 학업용 학습 허락). ENST 드러머 하나와 MDB 묶음 하나를 빼고 학습해 뺀 곡으로 평가하는 것을 세 번 하고(`configs/train/real_check/tom_6cls_real_no_d{1,2,3}.yaml`), 데이터는 그대로 두고 탐 강조 설정만 끈 학습(`tom_6cls_plain.yaml`)과 비교한다. 묶음 표는 `configs/train/real_check/folds.yaml`, 데이터셋 yaml은 `configs/bench/datasets/real_check/`, 채보 어댑터는 `configs/bench/transcribers/adtof_drumsep/real_check/`에 있다. 서버 실행은 `notebooks/real_drum_check_server.ipynb`. 결과는 학습마다 안 본 곡만 모아 합친다. ENST 드러머 1·2·3과 MDB 23곡을 모두 넣은 학습은 `tom_6cls_real_full.yaml`이고 같은 노트북 FULL 절로 돌린다. 학습에 안 쓴 실제 녹음이 없어 실제 녹음 점수는 no_d* 세 학습의 합친 결과로 대신한다.

패드별 가중치 조합(`adtof_drumsep_realrec.yaml`, 실험용)은 드럼 킷 분리는 한 번, ADTOF는 가중치 셋으로 세 번 돌려 패드별로 가져온다. 킥·스네어·하이햇은 실제 녹음 학습 모델(`tom_6cls_real_full`), 탐 3종은 원래 ADTOF 가중치(`tom_checkpoint_path: default`), 크래시·라이드는 7클래스 실제 녹음 학습 모델(`tom_7cls_real_full`, `cymbal_checkpoint_path`)이다. 채보 JSON을 만들 때 하이햇 페달은 하이햇으로 합친다. 드럼 분리 입력 8패드 F1이 MDB 0.844 → 0.886, ENST 0.790 → 0.830으로 올랐으나, 실제 발매곡인 PDO 무료 5곡 악보와 노트 단위로 비교하면 0.647 → 0.608로 떨어져 서비스에는 쓰지 않는다(2026-11-03). 이 조합으로 워커를 띄우려면 `SSAPLASH_MODELS_DIR/adtof_ft/` 아래에 두 파인튜닝 가중치가 있어야 한다.

실제 곡 점수 평균 조합(`adtof_drumsep_songsterr_avg.yaml`, 모델 이름 `songsterr_avg`, `strum` 전 서비스 기본)은 ADTOF를 세 번 돌린다. 원래 가중치와 Songsterr 인기곡 83곡으로 이어 학습한 5종 가중치의 프레임별 점수를 킥·스네어·하이햇·심벌 열만 평균하고(`average_checkpoints`, 탐 열은 원래 것), 그 점수로 `adtof_drumsep.yaml`과 같은 규칙을 돌린 뒤 크래시·라이드 이름만 같은 곡으로 학습한 8패드 가중치 판정으로 바꾼다(`cymbal_mode: name`). 원래 모델 대비 8패드 F1은 처음 보는 Songsterr 38곡 +0.025, 시험 31곡 +0.013, ENST +0.008·+0.013, MDB +0.022, PDO 무료 5곡 +0.006이다. 같은 곡의 ADTOF 입력 특징은 한 번만 만들어 세 가중치가 같이 쓰므로, 시험 31곡 채보 단계 시간은 원래 모델과 차이가 측정 흔들림보다 작았다. 2026-11-10부터 `strum`으로 바꾸기 전까지 서비스 기본이었다. `SSAPLASH_MODELS_DIR/songsterr_ft/` 아래 `five_all/last.pth`, `pads_all_noguard/last.pth`가 있어야 하고, 없으면 워커가 모델을 올리다 실패하므로 `SSAPLASH_CHART_MODEL=original`로 띄운다. 모델 yaml로 데이터셋을 서비스 어댑터 그대로 채보해 비교할 때는 `scripts/model_yaml_eval.py`를 쓰고, `--separator`를 주면 원곡을 분리한 드럼부터 돌린다.

```bash
uv run python scripts/model_yaml_eval.py --dataset configs/bench/datasets/mdb_drums.yaml --model configs/bench/transcribers/adtof_drumsep/adtof_drumsep.yaml --model configs/bench/transcribers/adtof_drumsep/adtof_drumsep_songsterr_avg.yaml --out data/results/model_yaml/mdb.csv
```

STRUM 학습 가중치(`configs/bench/transcribers/strum/strum_crnn_songsterr_egmd.yaml`, 모델 이름 `strum`, 서비스 기본, S15P31A307-326)는 [STRUM](https://github.com/opria123/strum)(코드·공개 가중치 MIT)의 8종 온셋 CRNN `drums_phase3`(42M)을 Songsterr 인기곡 457곡과 E-GMD 어쿠스틱 킷으로 이어 학습한 것이다. 드럼 트랙 하나로 8패드 온셋 점수를 바로 내므로 ADTOF와 드럼 킷 분리를 돌리지 않는다. 어댑터는 `strum_crnn`(`bench/transcribers/strum_transcriber.py`)이고, 모델 정의는 STRUM 저장소 파일을 그대로 둔 `bench/transcribers/strum/drums_v13.py`다. 별도 가상환경 없이 워커와 같은 환경(torch·torchaudio)에서 돈다.

채보 흐름은 드럼 트랙 채널 평균 → 로그 멜(n_fft 2048, hop 512, 멜 128) → 10초 구간을 5초씩 밀어 가며 계산해 겹친 곳 평균 → 패드별 피크 → 킥 규칙 → 패드별 문턱값이다(`bench/transcribers/strum_rules.py`). 킥 규칙은 문턱값을 넘는 탐이 킥보다 많은 곡에서만 킥 점수를 키우고, 그 킥에서 30ms 안에 있는 탐을 지운다. ENST 드러머 1처럼 킥이 탐으로 잡히는 드럼 세트를 고치려는 규칙이고 실제 발매곡 69곡 중 5곡, ENST 64곡 중 19곡, MDB 23곡 중 0곡에 걸린다. ENST·MDB를 보고 만든 규칙이라 두 묶음 점수는 이 규칙의 공정한 시험이 아니다. 문턱값(검증 10곡에서 고름), 킥 규칙 값, 가중치 sha256은 모델 yaml에 있고, 가중치 파일의 sha256이 yaml과 다르면 모델을 올리다 오류로 끝난다.

| 묶음 (8패드 F1, ±50ms) | `songsterr_avg` | `strum` | 차이 (곡 재추출 95% 구간) |
| --- | --- | --- | --- |
| Songsterr 시험 31곡 | 0.791 | 0.809 | +0.018 (+0.006 ~ +0.031) |
| 처음 보는 Songsterr 38곡 | 0.828 | 0.840 | +0.012 (+0.002 ~ +0.022) |
| MDB 23곡 | 0.877 | 0.904 | +0.028 (−0.003 ~ +0.064) |
| ENST 64곡 드럼 단독 | 0.836 | 0.861 | +0.025 (+0.009 ~ +0.043) |
| ENST 64곡 원곡 분리 | 0.798 | 0.818 | +0.020 (−0.000 ~ +0.040) |

평가 곡은 학습 457곡·검증 10곡과 겹치지 않는다. 패드별로 실제 발매곡 두 묶음은 하이햇·탐 3종·크래시·라이드가 오르고(시험 31곡 크래시 0.741 → 0.815, 라이드 0.547 → 0.662, 플로어 탐 0.200 → 0.429) 킥·스네어가 0.007 ~ 0.017 내려간다. MDB는 탐과 크래시가 내려가고(미드 탐 0.708 → 0.074, 플로어 탐 0.680 → 0.372, 크래시 0.760 → 0.644) 스네어가 0.815 → 0.922로 오른다. ENST 드럼 단독은 스몰 탐이 0.523 → 0.215로 내려간다.

채보 단계 시간은 로컬 RTX 4070에서 시험 31곡 곡당 중앙값 1.9초(최대 3.7초, 곡 길이의 0.008배), 최대 GPU 메모리 1,005MiB다(처음 보는 38곡 묶음에서는 1,495MiB). CPU만 쓰면 230초 곡 하나가 27초 걸린다(스레드 8개). 같은 PC에서 fake BE 전체 흐름으로 실제 발매곡 3곡(230 ~ 314초)을 돌리면 채보 단계가 2.3 ~ 2.8초(`songsterr_avg` 17.2 ~ 30.8초), 분리를 포함한 곡당 전체가 49.7 ~ 63.0초(`songsterr_avg` 68.4 ~ 79.9초)다. 분리 모델 패키지(msst)가 켜 두는 `cudnn.benchmark`는 입력 모양이 곡마다 달라지는 STRUM에서 곡당 8 ~ 15초를 더 쓰게 하므로 어댑터가 계산하는 동안만 끈다. 가중치는 Songsterr 탭(학습·교육 목적, 비상업 조건)으로 학습했으므로 `songsterr_avg`와 같은 범위에서만 쓴다.

서비스 어댑터를 곡 목록에 돌려 채보 시간·GPU 메모리를 측정하고 실험 때 저장한 노트와 비교할 때는 `scripts/strum_service_check.py`를 쓴다. 곡 목록(`songs[].drums`가 드럼 트랙 경로인 json)과 실험 노트는 학습 실험을 한 PC의 `data/`에 있다. 실험 채점은 채널 평균을 16비트로 다시 쓴 모노 파일로 했으므로 `--mono16`을 주면 같은 입력이 된다. 실험은 프레임별 점수를 float16으로 저장해 피크가 한 프레임(11.6ms) 옮겨진 노트가 0.4 ~ 0.6% 있어서, 같은 노트로 보는 시각 차이를 `--tolerance-ms 12`로 주면 다섯 묶음 모두 99.96% 이상 같다. 워커처럼 드럼 트랙을 그대로 넣으면(`--mono16` 없이, 1ms 기준) 98.9 ~ 99.6%가 같고, 8패드 F1은 다섯 묶음 모두 소수 셋째 자리까지 같다.

```bash
uv run python scripts/strum_service_check.py --manifest data/ext_train/test31.json --reference data/results/ext_notes/strum_p3_RE_sg --mono16 --tolerance-ms 12
```

서비스와 같은 입력(BS-Roformer SW로 뽑은 드럼)으로 원래 ADTOF + 드럼 킷 분리 모델(`adtof_drumsep.yaml`, 결과 표의 이름은 "현재 사용 중 모델"), 실제 녹음 학습 모델, 조합(탐만 원래 모델)을 비교할 때는 GPU 서버에서 `run-transcription --save-midi`로 곡별 예측 MIDI를 만들고 로컬에서 채점한다. 실제 녹음 학습 모델은 곡마다 그 곡을 학습에 안 쓴 버전(`configs/bench/transcribers/adtof_drumsep/sep_compare/realrec_heldout_d{1,2,3}.yaml`)으로 채점한다.

```bash
uv run python scripts/score_sep_compare.py --results data/results/sep_compare --out data/results/sep_compare/compare.md
```

같은 예측 MIDI로 원래 ADTOF + 드럼 킷 분리 모델의 `HIHAT` 노트에 실제 녹음 학습 모델의 페달 예측을 붙이는 방법(가까우면 이름 바꾸기, 실제 녹음 학습 모델도 하이햇을 안 냈을 때만 바꾸기, 페달을 넣고 근처 하이햇 지우기)을 MDB·ENST에서 비교한다. ENST는 페달만 밟은 하이햇도 `chh`로 적어서 정답에 페달이 없다. ENST 표의 페달은 전부 틀린 것으로 세지만 실제 페달 소리일 수 있어, ENST는 페달을 몇 개 냈는지만 참고로 본다.

```bash
uv run python scripts/score_pedal_relabel.py --results data/results/sep_compare --out data/results/pedal-relabel.md
```

```bash
uv run python scripts/score_heldout.py --run tom_6cls_real_no_d1=data/results/real_check/rule-eval-tom_6cls_real_no_d1 --run tom_6cls_real_no_d2=data/results/real_check/rule-eval-tom_6cls_real_no_d2 --run tom_6cls_real_no_d3=data/results/real_check/rule-eval-tom_6cls_real_no_d3 --compare base=data/results/finetune_results_new/rule-eval-base-pedal --compare tom_6cls=data/results/finetune_results_new/rule-eval-ft-tom_6cls --compare tom_6cls_plain=data/results/real_check/rule-eval-tom_6cls_plain --folds configs/train/real_check/folds.yaml --out data/results/real_check/heldout.md
```

ENST 64곡·MDB 23곡의 탐 3종 F1, 정답에 없는 탐 수, MDB 페달 정밀도·재현율·F1을 비교 모델과 같은 곡으로 나란히 놓고, `tom_6cls` 대비 차이에 곡 단위 95% 구간과 판정 줄을 붙인다. MDB는 모두 MusicDelta 녹음이라 묶음끼리 같은 킷일 수 있어, MDB 결과는 처음 보는 곡 기준으로 읽는다.

체크포인트는 기본 가중치 파일과 같은 `{'model_weights': state_dict, 'model_info': {...}}`이고 `model_info`에 `class_set`(five·five_pedal·five_pedal_cym·pads)·`classes`(원래 라벨: five 계열은 MIDI 피치, 9패드는 패드 이름)·`thresholds`·학습 설정·검증 점수가 들어간다. `adtof` 어댑터는 `checkpoint_path`의 이 정보를 읽어 출력 수·라벨·문턱값을 정하고, 정보가 없는 옛 파일은 지금처럼 5클래스·저장소 기본 문턱값으로 돈다. 9패드 체크포인트는 `configs/bench/transcribers/adtof/adtof_ft_9cls.yaml`처럼 `labels`에 `KICK: KICK`으로 적는다. 페달 출력이 있는 체크포인트를 드럼 킷 분리 어댑터에 쓸 때는 `adtof_drumsep_ft6.yaml`처럼 `labels`에 `HIHAT_PEDAL: HIHAT_PEDAL`을 더한다. 파인튜닝한 가중치의 라이선스는 원본과 같은 CC BY-NC-SA 4.0이다.

### STRUM 채보 모델 학습 (S15P31A307-326)

서비스 기본 채보 모델 `strum`의 가중치를 만든 학습과 채점이다. STRUM의 8종 온셋 CRNN을 실제 발매곡으로 이어서 학습하고, ADTOF + 드럼 킷 분리 모델(`original`)과 같은 곡으로 채점한다. 서비스 가중치는 GPU 서버 학습 `strum_p3_RE`의 `best.pt`이고, 모델 yaml의 패드별 문턱값과 킥 규칙 기준값은 이 채점에서 나온 값이다. 결과는 `docs/bench/other-models-2026-11/summary.md`에 있다. 스크립트는 전부 `scripts/train_ext/`에 있다.

```bash
# 1. 곡 목록 만들기. STRUM은 가상환경이 달라 음원 경로와 정답을 파일로 풀어 둔다 (data/ext_train/<이름>.json)
uv run python scripts/train_ext/export_manifest.py --dataset configs/bench/datasets/public_songs_train_full.yaml --name train457
uv run python scripts/train_ext/export_manifest.py --dataset configs/bench/datasets/public_songs_val.yaml --name val10
# 2. 학습. 곡 목록 뒤에 :비율을 붙이면 그 비율로 섞는다. best.pt·last.pt·train_log.jsonl이 --out에 생기고 다시 실행하면 이어 간다
.venv-strum/Scripts/python.exe scripts/train_ext/strum_crnn.py train --train data/ext_train/train457.json --val data/ext_train/val10.json --out data/models/ext_ft/strum_p3 --batch 4 --seconds 10 --lr 3e-5 --spec-augment --mem-fraction 0.85
# 3. 검증·평가 곡의 프레임별 점수 저장 (data/ext_train/acts/<태그>/<목록>/<곡>.npz)
.venv-strum/Scripts/python.exe scripts/train_ext/strum_crnn.py dump --tag strum_p3 --checkpoint data/models/ext_ft/strum_p3/best.pt --manifest data/ext_train/val10.json --manifest data/ext_train/test31.json --manifest data/ext_train/holdout38.json --manifest data/ext_train/mdb.json --manifest data/ext_train/enst.json --manifest data/ext_train/enst_sep.json
# 4. 채점. 검증 10곡으로 시각 옮김과 문턱값을 고르고 평가 데이터 다섯 묶음을 ADTOF + 드럼 킷 분리 모델과 비교한다
uv run python scripts/train_ext/eval_run.py --tag strum_p3
# 5. 킥이 탐으로 잡히는 곡 규칙을 붙여 다시 채점
uv run python scripts/train_ext/song_gain.py --src strum_p3 --dst strum_p3_sg --kind p3 --params data/results/ext_notes/rules_strum_p3.json
uv run python scripts/train_ext/eval_run.py --tag strum_p3_sg --notes-ready
```

- 평가 묶음 다섯 개의 곡 목록(`test31`·`holdout38`·`mdb`·`enst`·`enst_sep`)도 1번과 같은 스크립트로 만든다. 묶음별 데이터셋 yaml은 `eval_run.py`의 `SETS`에 있다
- GPU 서버에서는 `notebooks/ext_models_finetune_server.ipynb`의 1번 셀 하나로 파일 확인부터 학습, 채보, 결과 묶기까지 돈다. 실제 곡만 쓴 `strum_p3_R`과 E-GMD를 30% 섞은 `strum_p3_RE` 두 개를 학습한다. 노트북은 `scripts/train_ext/make_server_notebook.py`가 만들고, 서버에 올릴 zip은 `pack_server_data.py`·`pack_server_models.py`가 묶는다
- 로컬 GPU 메모리가 8GB면 학습에 `--mem-fraction 0.85`를 준다. 메모리가 넘치면 그 학습만 오류로 끝난다
- 노트 시각 옮김 값은 허용 오차 ±25ms 점수로 고른다(`scripts/ext_rule_eval.py fit`)
- 결과 문서에는 같은 때 측정한 Inverse Drum Machine·YourMT3+·ADT_STR의 점수도 있다. 서비스에 쓰지 않는 모델이라 그 학습·채점 코드는 저장소에 넣지 않았다

## 팀 MLflow에 기록하기

팀 MLflow 서버는 SSH 터널로만 붙는다(`Infra/mlflow/README.md`). 터널을 연 PC에서 벤치마크를 돌리면 `--mlflow-uri http://localhost:5000`으로 바로 기록한다. 코랩·학교 GPU 서버는 팀 서버에 못 붙는다. 코랩은 드라이브 `mlruns/`에 기록하고 학교 GPU 서버는 `--mlflow-uri none`으로 돌린 뒤, 결과 폴더나 mlruns를 PC로 가져와 `relog`로 올린다. 결과 파일이 원본이고 MLflow 기록은 거기서 다시 만든다.

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

`--recursive`는 `check-*`·`local-*`·`*-check`·`combined*`·`tom-pitch*`·`tom-detect-*`·`smoke_*` 폴더와 `separated`·`midi`·`inputs`·`separation_demo`·`mlruns` 폴더에 들어가지 않는다. 같은 runId가 있어도 새로 기록하려면 `--force`를 준다. 다시 올린 run에는 `relogged=true`·`sourceDir` 태그가 붙고, 원래 실행 때만 알 수 있던 `clip`·`nSkipped`는 비어 있다. `dataset` 파라미터는 yaml 이름이 아니라 CSV의 `dataset` 값이다. `rule-eval`은 이제 후보 yaml을 결과 폴더에 `candidates.yaml`로 남겨, 다시 올릴 때도 규칙값이 `rules.*` 파라미터로 붙는다(그 전 결과 폴더는 후보 이름만).

## 지표 정의

분리 벤치마크 지표. 곡 단위 값이고 모델 단위 값은 곡 값들의 중앙값이다. 자세한 계산 규칙은 `src/ssaplash_ai/bench/metrics/` 각 파일 머리말에 있다.

| CSV 열 | 뜻 | 계산 |
| --- | --- | --- |
| `sdrDrums`, `sdrAccomp` | 분리 품질 (dB). 정답과 예측이 얼마나 가까운지 | museval(BSS Eval v4)에 정답·예측 드럼과 반주 2소스를 넣고 1초 프레임 값의 중앙값. 예측 반주 = 원곡 − 예측 드럼 |
| `sirAccomp`, `sarAccomp` | 반주에 남은 드럼 누설, 인공음 (dB) | 같은 museval 호출. 드럼 쪽 `sirDrums`·`sarDrums`도 보조로 기록 |
| `siSdrDrums`, `siSdrAccomp` | 배율 불변 SDR (dB) | 곡 전체 1회 |
| `onsetF1`, `onsetPrecision`, `onsetRecall` | 타격 보존율. 정답 타격 시각을 예측 드럼에서 얼마나 되찾는지 | librosa 스펙트럼 플럭스 온셋 검출(hop 512 샘플)을 예측 드럼에 적용, mir_eval로 ±50ms 매칭. 정답 온셋은 합성곡이면 MIDI, MDB·ENST면 사람 주석, MUSDB면 정답 드럼 스템에 같은 검출기 적용. MIDI·주석 정답은 동시에 친 타격이 같은 시각으로 여러 줄 들어 있어 30ms 안 시각을 하나로 합친 뒤 채점한다 (S15P31A307-166) |
| `onsetF1Tight` | 같은 것, ±25ms | |
| `attackSlopeDistortion` | attack slope는 드럼을 친 직후 10ms 동안 소리가 커지는 기울기(Beyond SDR 논문 용어). 분리한 드럼의 이 기울기가 정답 드럼과 얼마나 달라졌는지를 잼. 0이면 원음 그대로, 클수록 타격 앞머리가 뭉개진 것. 뭉개지면 채보 모델이 타격 시각을 늦게 잡거나 놓치므로 봄 | 정답 온셋마다 온셋 후 10ms 구간을 1ms 블록 최댓값 포락선으로 만들고 최소제곱 기울기를 구해 \|ln(예측 기울기 / 정답 기울기)\|를 평균. Beyond SDR 논문의 attack slope를 단순화한 것이라 논문 수치와 직접 비교하지 않는다 |
| `separateSec`, `rtf` | 분리 시간(초), RTF = 분리 시간 / 곡 길이 | 벽시계. 모델 로드 제외. 로드 직후 첫 곡을 한 번 분리하고 버려(워밍업, `--no-warmup`으로 생략) GPU 커널 준비 시간을 뺀다 |
| `loadSec` | 모델 로드 시간 | 가중치 다운로드 제외. 곡마다 같은 값 반복 |
| `mrFullness` | 드럼리스 MR에서 있어야 할 소리가 덜 빠졌을수록 높음 (0~100) | 정답 MR과 예측 MR을 STFT(n_fft 4096, hop 1024) → mel 512칸 → dB로 바꿔 칸마다 예측 − 정답을 구함. 예측이 더 작은 칸의 평균 a(음수)로 100 / (1 − a). 분리 커뮤니티(MVSEP, MSST `bleed_full`)와 같은 계산 (S15P31A307-165) |
| `mrBleedless` | 드럼리스 MR에 드럼 같은 남는 소리가 적을수록 높음 (0~100) | 같은 차이에서 예측이 더 큰 칸의 평균 b로 100 / (1 + b) |
| `mrFullnessHigh` | `mrFullness`를 5kHz 위 mel 칸에서만 계산 | 고음이 빠졌는지만 따로 보려고 붙인 값 |
| `mrLufsDiff` | 예측 MR 음량 − 정답 MR 음량 (LUFS). 0에 가까울수록 좋음 | ITU-R BS.1770 적분 음량, pyloudnorm |
| `mrClipRatio` | 예측 MR에서 절댓값 1 이상이라 16비트 저장 때 잘릴 샘플 비율 | |
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

`AI/data/`는 git이 추적하지 않고 빈 폴더만 `.gitkeep`으로 둔다. 아래 두 데이터셋과 MDB Drums는 직접 받아 둔다. E-GMD·STAR Drums·ENST·Songsterr 곡은 아래 표와 각 설정 yaml 주석을 본다. 모두 교육·연구 목적으로만 쓰고 저장소나 Notion에 음원을 올리지 않는다.

| 데이터셋 | 용도 | 받는 곳 | 크기 | 라이선스 | md5 |
| --- | --- | --- | --- | --- | --- |
| MUSDB18-HQ | 분리 벤치마크의 기본 평가 데이터. test 50곡을 평가에 쓰고, train 100곡은 합성곡 반주 재료로 쓴다 | [Zenodo 3338373](https://zenodo.org/records/3338373) `musdb18hq.zip` | 22.7GB (22,656,664,047 바이트) | 교육·연구 목적 전용, 상업 사용 금지 | `12d4f2ecd55245a4688754dd76363103` (Zenodo 기재) |
| GMD (Groove MIDI Dataset) v1.0.0 | 합성곡 드럼 재료이자 채보 평가용 연주 45개(`gmd_test.yaml`). 연주 MIDI가 같이 있어서 타격 시각과 악기 정답을 그대로 얻는다 | [Magenta](https://magenta.tensorflow.org/datasets/groove) `groove-v1.0.0.zip` | 4.8GB (5,111,599,714 바이트) | CC BY 4.0 (Google LLC) | `99db7e2a087761a913b2abfb19e86181` (2026-10-19 직접 계산) |

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
├─ mdb_drums/                         채보 벤치마크용. 아래 "MDB Drums" 절
│   └─ MDB Drums/{annotations,audio/drum_only,audio/full_mix}/
├─ enst/, e-gmd/, star_drums/, songsterr/   채보 평가·학습 데이터. 아래 표와 각 설정 yaml 주석
├─ enst_gain1_musdb/                  ENST를 MUSDB 폴더 모양으로 내보낸 것 (드럼리스 MR 품질 비교용)
├─ models/                            모델 가중치 (환경 변수 SSAPLASH_MODELS_DIR의 기본 위치)
├─ results/, rule_features/           벤치마크·실험 결과, 규칙 분석 특징
└─ upload/                            GPU 서버에 올릴 묶음
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

채보 모델은 "몇 초에 어느 패드를 쳤는지"를 맞혀야 하므로 타격 시각과 패드가 적힌 정답이 필요하다. 패드는 스틱 통신 프로토콜 v0.7과 같은 이름의 9종 `KICK, SNARE, HIHAT, SMALL_TOM, MID_TOM, FLOOR_TOM, CRASH, RIDE, HIHAT_PEDAL`이고(`bench/datasets/pads.py`. 옛 `HI_TOM`은 2026-10-26부터 `SMALL_TOM`). `HIHAT_PEDAL`은 페달만 밟아 난 하이햇 소리(GMD·E-GMD 44번, MDB·STAR `PHH`)로 2026-10-30부터 정답에서 따로 읽는다. 8패드 점수(`pads` 기준)는 지금까지와 같게 정답·예측의 `HIHAT_PEDAL`을 `HIHAT`에 합쳐 내고, 페달 점수는 `pads9` 기준(`hits_by_class.csv`의 `scheme` 열, 혼동 수 `PEDAL_AS_HIHAT`·`HIHAT_AS_PEDAL` 행은 짝 수를 `tp` 칸에)과 rule-eval의 `f1Pedal`·`pedalAsHihat` 등 열에 따로 낸다, 카우벨·클랩·탬버린처럼 패드에 없는 타격은 정답에서 빼고 개수만 센다. 아래 묶음을 쓰며 묶음마다 점수를 따로 낸다. Songsterr 공용 곡 묶음(`kind: songsterr`)은 위 "실제 곡(Songsterr 인기곡)으로 채보 평가" 절에 있다.

| 설정 | 내용 | 역할 |
| --- | --- | --- |
| `synth_v1.yaml` | 합성곡 5곡. 원곡·정답 드럼·MIDI 타격 정답 | 분리 모델을 거친 뒤 채보 점수가 얼마나 떨어지는지 |
| `gmd_test.yaml` | GMD test split 드럼 연주 45개(52분). 드럼만 있는 전자 드럼 녹음 + MIDI 타격 정답 | 드럼 트랙 입력 채보, 8패드별 점수 |
| `mdb_drums.yaml` | MDB Drums 23곡(22분). 실제 밴드 녹음, 원곡·드럼 트랙·사람이 적은 타격 정답 | 논문 수치와 검산 |
| `mdb_drums_unseen.yaml` | 위 23곡 중 MUSDB18 train에 없는 11곡 | 분리 모델을 거치는 평가는 이 묶음만 (아래 참고) |
| `egmd_test_acoustic.yaml` | E-GMD(GMD 연주를 Roland TD-17 킷 43개로 다시 녹음, CC BY 4.0) test 분할 중 `gmd_test.yaml`의 연주 45개 × 어쿠스틱 음색 킷 26개 = 1170개(22.7시간). 로더는 `bench/datasets/gmd.py`의 `EgmdDataset`, 곡 id는 오디오 파일 이름 | 킷이 바뀔 때 탐 규칙 검증 (S15P31A307-164). 96GB 전체는 GPU 서버에 받고 목록 csv 9.6MB만 로컬에 둬도 곡 목록은 뽑힘 |
| `star_drums_test.yaml`, `star_drums_validation.yaml` | STAR Drums(Weber 외 2025) test·validation 분할. 실제 반주에 샘플 킷 20개(어쿠스틱 15·전자 5)로 합성한 드럼, 탐 3종(HT·MT·LT) 정답. 미리보기 1곡은 `star_drums_preview.yaml` | 킷이 바뀔 때 탐 규칙 검증 (S15P31A307-164). 오디오는 CC BY-NC-SA·개별 라이선스라 평가·연구용. 181GB 전체는 GPU 서버에 받고 로더는 `bench/datasets/star.py` |
| `enst_minus_one.yaml` | ENST-Drums(Gillet & Richard 2006) 중 반주가 있는 minus-one·MIDI-minus-one 64곡. 실제 드러머 3명 녹음, 탐 약 2,600타. 입력 드럼은 `wet_mix`, mixture는 `wet_mix` + 반주 × `extra.accomp_gain`(0.5). 드러머 3은 탐 넷이라 `extra.tom4`로 패드 3개에 대응(랙탐 둘은 스몰·미드, 플로어탐 둘은 플로어). 로더는 `bench/datasets/enst.py` | 실제 녹음에서 탐 규칙·파인튜닝 전후 비교 (S15P31A307-164). 이용 조건은 본인만·연구용·변형물 금지이고, 2026-10-31 제공 측 회신으로 학생 학업용 학습은 허락받음. 학습한 가중치는 실험 전용. 데이터는 공유하지 않음. 주석에 페달 하이햇 라벨이 없음. 결과 공개 시 Gillet & Richard ISMIR 2006 인용. 데이터는 GPU 서버에 있고, 다른 PC에서 돌릴 때는 `data/enst/`에 따로 받아 둔다 |
| `real_check/*.yaml` | 실제 녹음 학습 확인 실험용 분할. ENST 학습용 `enst_train_no_d{N}`(드러머 N을 뺀 둘의 hits·phrase·solo·minus-one 전체)·`enst_train_all`(드러머 셋 전체), 평가용 `enst_minus_one_d{N}`, 반주 없는 연주만 `enst_practice_d{N}`(subset `practice`), MDB 학습용 `mdb_train_no_f{N}`·평가용 `mdb_fold{N}`(묶음 표 `configs/train/real_check/folds.yaml`) | 탐·페달 하락이 데이터 때문인지 확인 (S15P31A307-164). 서버에만 있음 |
| `gmd_train.yaml`, `egmd_train_acoustic.yaml`, `egmd_validation_acoustic.yaml`, `star_drums_training_ismir04.yaml`, `star_drums_training_mtg.yaml` | 채보 모델 탐 파인튜닝의 학습·검증 분할. GMD train 846개(beat+fill), E-GMD train 어쿠스틱 26킷 21,294개(206시간)·validation 3,042개, STAR training ISMIR04 약 1,228곡·MTG-Jamendo 약 4,807곡. GMD·E-GMD 로더는 `subset`(train·validation·test)과 `extra.beat_type`(beat·fill·all·목록)으로 분할을 고름. `gmd_train.yaml`은 학습 설정에서 뺐다(GPU 서버에는 GMD test 분할만 있고, 같은 연주를 26킷으로 친 것이 E-GMD train에 있음. 2026-10-30) | 파인튜닝 학습 (S15P31A307-164). 평가 분할(GMD test·MDB·ENST·E-GMD test·STAR test)과 겹치지 않음. 서버에만 있음 |

GMD 연주는 `list-gmd --split test --min-sec 30 --hits`로 패드별 타격 수를 보고 골랐다. test split만 쓰는 이유는 채보 후보 중 셋(OaF Drums·YourMT3+·Inverse Drum Machine)이 GMD를 다시 녹음·렌더링한 E-GMD·StemGMD의 train split로 학습했기 때문이다. 밴드 장르만 고르면 크래시 73개·미드탐 34개뿐이라 재즈 2개·라틴 3개 연주를 더해 탐·심벌이 각 100개 이상 되게 했다. 합성곡에 쓴 연주 5개는 뺐다.

```bash
# 묶음 점검 (곡 수·길이·누락·패드별 타격 수)
uv run ssaplash-bench check-data configs/bench/datasets/synth_v1.yaml configs/bench/datasets/gmd_test.yaml configs/bench/datasets/mdb_drums.yaml
```

### MDB Drums

MedleyDB 23곡에 드럼 타격 시각과 종류(세부 분류 21종)를 사람이 적은 공개 데이터셋. 채보 논문들이 점수 비교에 쓰는 표준 평가곡이다. 라이선스는 **CC BY-NC-SA 4.0**이라 음원·주석을 저장소나 Notion에 올리지 않는다. 벤치마크에 필요한 폴더 세 개만 받으면 331MB다.

```bash
cd AI/data
git clone --depth 1 --filter=blob:none --sparse https://github.com/CarlSouthall/MDBDrums.git mdb_drums
cd mdb_drums
git sparse-checkout set "MDB Drums/annotations" "MDB Drums/audio/drum_only" "MDB Drums/audio/full_mix"
rm -rf .git                  # 받은 뒤 안쪽 .git은 지운다. 남겨 두면 우리 저장소 git status에 잡힌다
```

주의: 23곡 중 12곡(80sRock·Beatles·Britpop·Country1·Disco·Gospel·Grunge·Hendrix·Punk·Reggae·Rock·Rockabilly)은 같은 MedleyDB 녹음이 MUSDB18 train에도 들어 있다. 분리 모델이 학습 때 본 곡이라, 분리 모델을 거치는 평가에는 나머지 11곡(`mdb_drums_unseen.yaml`)만 쓴다. 세부 분류를 패드로 바꾸는 표는 `bench/datasets/mdb.py`에 있고, 탬버린(TMB) 32개는 패드 밖이라 뺀다. 탐 타격이 23곡 합쳐 90개뿐이라 탐별 점수는 GMD 묶음이 맡는다.

## 곡 추천 R3 PoC (오프라인 실험)

그래프 임베딩이 인기·규칙·비슷한 곡보다 다음에 칠 곡을 더 잘 맞히는지 확인하는 실험이다. 운영 API·DB 접속·서빙은 하지 않는다.
입력 파일 스키마, 데이터 출처 단계(합성·내부·일반 사용자), 로더가 멈추는 조건, 시간순 분할은 `docs/recommend-poc.md`.
코드는 `src/ssaplash_ai/recommend/`, 시험은 `uv run pytest tests/recommend`.

## 관련 문서

- 공통 명세서: `Docs/Service Design/공통 명세서.md` (11장 AI 활용 계획, 15장 기술 검증 포인트)
- Jira: 에픽 `[CHART] 채보` (S15P31A307-29). 분리 벤치마크(-101~-105)는 스토리 CHART-004 음원 드럼 분리 (S15P31A307-69), 채보 벤치마크(-106~-110)는 스토리 CHART-003 음원 → 채보 생성 (S15P31A307-62). 서비스 추론 모듈은 분리(-167·-168)가 CHART-004, 채보(-169~-171)가 CHART-003
