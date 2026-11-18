# 실시간 코칭 거름·놓침 원인 모델 첫 운영 등록 (2026-11-10, COACH-001)

실시간 코칭의 거름 모델과 놓침 원인 모델을 처음으로 운영 MLflow에 등록하고 서버 `/models`에 게시한 기록이다.
두 모델 모두 **합성 데이터**로 학습했다. 실제 사용자 연주로 학습한 모델이 아니므로, 운영에서는 그림자 모드로 먼저 기록을 본다.
학습 보고서 원본은 같은 폴더의 `gate-report.json`·`cause-report.json`, 게시한 메타 파일은 `gate-meta.json`·`cause-meta.json`이다.

## 등록·게시 결과

| 항목 | 거름 모델 | 놓침 원인 모델 |
| --- | --- | --- |
| 게시 이름 | `coach-gate-mlp16` | `coach-cause-logistic` |
| MLflow 모델 버전 | 1 | 1 |
| MLflow 실험 | `coach-live-gate` | `coach-live-cause` |
| MLflow 실행 | `05fba1ca1e6b4af996e0a585ebc3fed0` | `7ccc4d887cbe4e67842f5c21304d729f` |
| `modelVersion` | `coach-gate-0.1` | `coach-cause-0.1` |
| `featureVersion` | 1 | 1 |
| 학습 데이터 | 합성(`SYNTHETIC`), 칸마다 60판 | 합성(`SYNTHETIC`), 칸마다 40판 |
| 게시 파일 | `coachGate.json`, `coachGate.onnx`, `meta.json` | `coachCause.json`, `meta.json` |
| 서버 게시 | `publish-model publish coach-gate-mlp16 1` | `publish-model publish coach-cause-logistic 1` |

- 코드 기준은 `main` `aff87e3c`(2026-11-10 배포)다.
- 실험 `coach-live-gate`에는 실패로 닫은 실행 `3e2f1494944d48449742c92dba39e875`가 하나 더 있다. Windows 콘솔 인코딩 오류로 등록 전에 멈춘 실행이고, 모델 버전은 만들지 않았다(아래 "재현할 때 주의").

## 거름 모델 (`coach-gate-mlp16`)

규칙이 낸 지적 하나하나가 진짜 문제인지, 잘못 짚은 지적인지 고른다. 입력 20개(타이밍 통계, 최근 놓침, 패드·손 치우침, 진행 위치, 지적 태그).

- 지적 13,936건: 진짜 11,635건, 잘못 짚은 지적 2,301건(약 17%)
- 태그별 건수: `LIVE_EARLY` 3,002, `LIVE_LATE` 2,968, `LIVE_PAD_MISS` 2,113, `LIVE_HAND_WEAK` 1,773, `LIVE_PAD_EARLY` 1,285, `LIVE_PAD_LATE` 1,230, `LIVE_UNSTEADY` 1,190, `LIVE_MISS_STREAK` 375
- 기준: 진짜 지적을 95% 이상 남기는 문턱에서, 잘못 짚은 지적이 얼마나 통과하는지 본다(`maxRecallDrop` 0.05).

| 구조 | AUC | 진짜 95% 남길 때 잘못 짚은 지적 통과 | 진짜 98% 남길 때 |
| --- | --- | --- | --- |
| logistic | 0.942 | 25.9% | 40.9% |
| **mlp16 (게시)** | **0.981** | **9.4%** | **14.7%** |
| mlp32x16 | 0.980 | 10.6% | 15.1% |

- `mlp16`을 골랐다. 더 큰 `mlp32x16`보다 낫거나 같고 작다.
- 문턱은 0.8163(`meta.json`의 `threshold`).
- JSON 실행과 ONNX 실행의 출력 차이는 최대 4.16e-07이다.

## 놓침 원인 모델 (`coach-cause-logistic`)

놓침 지적이 나왔을 때 규칙이 낸 원인 후보(`WRONG_PAD`, `TRANSITION`, `DENSE`, `DRIFT_LATE`) 중 화면에 무엇을 말할지 고른다. 후보 밖의 원인은 고르지 않고, 확신이 없으면 `UNKNOWN`이다. 입력 6개(원인 후보 4개의 강도, 판정 단계 3 여부, 패드 놓침 여부).

- 원인 지적 3,094건. 이 가운데 후보가 둘 이상 겹친 지적 129건
- 라벨별 건수: `DRIFT_LATE` 1,192, `WRONG_PAD` 946, `TRANSITION` 502, `DENSE` 329, `UNKNOWN`(대조군) 125

| 구조 | 정확도 | 후보가 겹친 지적 | 대조군을 `UNKNOWN`으로 |
| --- | --- | --- | --- |
| 규칙 순서(비교 기준) | 94.6% | 91.5% | 90.4% |
| **logistic (게시)** | **95.0%** | **99.2%** | **92.8%** |
| mlp16 | 95.0% | 99.2% | 92.8% |

시나리오별 정확도:

| 시나리오 | 규칙 순서 | logistic |
| --- | --- | --- |
| `WRONG_PAD` | 100% | 100% |
| `DENSE` | 96.7% | 99.7% |
| `DRIFT_LATE` | 92.0% | 92.0% |
| `TRANSITION` | 90.2% | 90.0% |
| 대조군(`NONE`) | 90.4% | 92.8% |

- `mlp16`과 결과가 같아서 더 단순한 logistic을 골랐다.
- 나아진 곳은 대부분 후보가 겹친 지적이다(91.5% → 99.2%). 남은 오류는 규칙이 원인 후보를 아예 내지 못한 경우(`DRIFT_LATE`, `TRANSITION`)라서 모델로는 고칠 수 없다.
- 지난 학습(합성 원인 데이터, 설계 단계 기록)의 정확도 94.8% → 95.1%, 겹친 지적 92.2% → 98.4%와 같은 경향이다. 이번 수치는 합성 데이터를 다시 만들어 학습한 값이다.

## 이 기록이 말해 주는 것과 아닌 것

- 합성 데이터로 만든 연주에서 "규칙보다 잘못 짚은 지적을 덜 띄우고, 겹친 원인을 더 잘 고른다"는 것까지다. 실제 사용자 연주에서도 그렇다는 근거가 아니다.
- 그래서 거름은 그림자 모드(판단만 기록하고 문구는 그대로)로 켠다. 플레이 로그의 `LIVE_GATE_*` 판단과 실제 연주를 대조한 뒤 `on`으로 바꾼다.
- 원인 모델은 거름 모드와 관계없이 바로 쓰인다(`LIVE_CAUSE`의 `"by":"MODEL"`).

## 운영 적용 (2026-11-11)

| 게시 이름 | MLflow 버전 | 내용 |
| --- | --- | --- |
| `coach-gate-mlp16` | 1 | 거름 모델 |
| `coach-cause-logistic` | 1 | 놓침 원인 모델 |
| `coach-live-config` | 1 | 거름 그림자 + 원인 모델 |
| `coach-live-config` | 2 | 연주 중 LLM 그림자를 넣어 등록했으나 **`llm`이 빠진 채 저장됨**(버전 1과 같은 내용) |
| `coach-live-config` | **3 (현재)** | 거름 그림자 + 원인 모델 + 연주 중 LLM 그림자(`llm: {mode: shadow, rolloutPercent: 100}`) |

- 설정 파일은 `configs/coach/coach_live_config.json`(버전 3과 같은 내용)이다.
- 게시 뒤 `/models/manifest.json`의 현재 버전: 거름 1, 원인 1, 설정 3.
- **버전 2에 `llm`이 빠진 이유:** 등록 도구 `experiment.py`의 `validate_config`가 `gate`·`cause`·`rolloutPercent`만 골라 저장해 `llm`을 버렸다. FE는 `llm`이 없으면 꺼짐으로 보므로 연주 기록 `LIVE_ARM`에 `llmArm`이 나오지 않았고, 게시된 `config.json`을 받아 보고 알았다. 등록 도구가 `llm`을 검사하고 남기도록 고친 뒤(`fix/COACH-live-config-llm`) 버전 3으로 다시 등록했다. 게시 뒤에는 `https://<도메인>/models/coach-live-config/<버전>/config.json`을 받아 실제 내용을 확인한다.
- 실제 연주 확인(2026-11-11, 설정 버전 2일 때): `LIVE_ARM`에 `arm`·`causeArm`이 남았다. 놓침 원인 지적 33건 중 규칙이 원인 후보를 낸 5건은 모델이 골랐고(`"by":"MODEL"`, `WRONG_PAD`), 후보가 없는 28건은 `UNKNOWN`이었다. 실제 연주에서는 후보 없는 놓침이 많아, 원인 규칙의 후보 생성이 다음 개선 대상이다.
- 연주 중 LLM은 BE `LIVE_COACH_LLM_ENABLED=true`, GPU 서버 `live-run` 워커와 함께 켰다. 리포트 LLM 총평도 같은 날 채보 워커에 `SSAPLASH_NARRATIVE_ENABLED=true`를 넣어 켰다. GPU 서버 실행 방법과 이날 겪은 문제는 `docs/live-coach-llm.md` "GPU 서버 모델 서버"에 있다.
- 설정 버전 3에서의 연주 중 LLM 동작(`llmArm`, `LIVE_LLM`)은 이 기록 시점에 아직 확인하지 않았다.

## 재현

`Infra/mlflow/README.md` "실시간 코칭 모델과 실험 설정"의 순서를 따른다. SSH 터널(`-L 5000:localhost:5000`)을 연 상태에서 내 PC에서 실행했다.

```bash
cd AI
MLFLOW_TRACKING_URI=http://localhost:5000 uv run --extra coach-live python -m ssaplash_ai.coach_live_model.cli --out runs/coach-live --register
MLFLOW_TRACKING_URI=http://localhost:5000 uv run --extra coach-live python -m ssaplash_ai.coach_live_model.cause_model --out runs/coach-cause --register
```

서버에서 게시했다.

```bash
docker compose -p infra exec mlflow publish-model publish coach-gate-mlp16 1
docker compose -p infra exec mlflow publish-model publish coach-cause-logistic 1
```

### 재현할 때 주의

- `--extra coach-live`를 빼면 ONNX 변환에서 `No module named 'onnx'`로 멈춘다.
- Windows 콘솔(cp949)에서는 MLflow가 실행 끝에 출력하는 이모지 때문에 `UnicodeEncodeError`가 나며, 모델 버전을 만들기 전에 멈춘다. `PYTHONIOENCODING=utf-8`을 붙여 실행한다. 멈춘 실행은 MLflow에 `RUNNING`으로 남으므로 실패로 닫아 둔다.
