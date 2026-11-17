# MLflow와 모델 게시

실험 기록·모델 레지스트리(MLflow)와, 만든 모델을 브라우저에 배포하는 경로(`/models`)다.

## 구성

- **MLflow 서버**: `Infra/docker-compose.yml`의 `mlflow`. 이미지는 `Infra/mlflow/Dockerfile`로 버전을 고정해 직접 만든다(`mlflow==3.17.2`).
  - 백엔드 DB는 기존 PostgreSQL의 **`mlflow` DB**다. `mlflow-db-init`이 없으면 만들고, 있으면 건너뛴다.
  - 아티팩트는 SeaweedFS의 **`airdrum-mlflow` 버킷**에 저장한다. 서버가 대신 저장하므로(`--serve-artifacts`) 클라이언트가 스토리지 키를 가질 필요가 없다.
- **모델 게시**: 서버의 `models` 볼륨을 Nginx가 `/models/`로 읽기 전용 서빙한다. 쓰기는 `mlflow` 컨테이너의 게시 도구(`publish-model`)만 한다.
- **MLflow는 외부에 공개하지 않는다.** UI에 인증이 없어 공개하면 누구나 실험과 모델을 지울 수 있다. 서버의 `127.0.0.1:5000`에만 열려 있다.

## MLflow 접속

SSH 터널로 접속한다. 서버 접속 권한이 필요하다.

```
ssh -i <키 파일> -L 5000:localhost:5000 ubuntu@k15a307.p.ssafy.io
```

터널이 열린 상태에서 내 PC 브라우저로 `http://localhost:5000`을 연다. 학습·실험 코드는 `MLFLOW_TRACKING_URI=http://localhost:5000`으로 같은 터널을 쓴다.

## 모델 게시

MLflow에 모델을 등록한 뒤(레지스트리의 모델 이름과 버전), 서버에서 게시한다.

```
docker compose -p infra exec mlflow publish-model publish <모델 이름> <MLflow 모델 버전>
```

- 모델 이름은 영문 소문자·숫자·점·하이픈·밑줄만, 버전은 숫자만 쓴다.
- 게시하면 `/models/<이름>/<버전>/`에 파일이 복사되고, 각 파일의 `sha256`과 크기가 매니페스트에 기록된다. 게시한 버전이 현재 버전이 된다. 게시만 하고 현재 버전은 그대로 두려면 `--no-activate`를 붙인다.
- 한 번 게시한 버전 폴더는 바꾸지 않는다. 같은 버전을 다시 게시하려면 새 MLflow 버전으로 등록한다.
- 게시된 모델 목록은 `publish-model list`로 본다.

브라우저는 먼저 `/models/manifest.json`을 읽고, `current` 버전의 파일을 `/models/<이름>/<버전>/<파일 경로>`에서 내려받는다.

### 매니페스트

| 필드 | 뜻 |
| --- | --- |
| `updated` | 마지막 갱신 시각(UTC) |
| `models[].name` | 모델 이름 |
| `models[].current` | 브라우저가 쓸 버전 |
| `models[].versions[].version` | 게시된 버전 |
| `models[].versions[].files[]` | 파일 경로(`path`), `sha256`, 크기(`size`) |
| `models[].versions[].publishedAt` | 게시 시각 |

- FE `coach/live/models/manifest.ts`가 이 필드를 읽는다. 이름·버전·경로가 위 규칙에 맞지 않는 항목은 쓰지 않는다.
- `manifest.json`은 캐시하지 않는다(롤백이 바로 반영되어야 한다). 버전 폴더의 파일은 바뀌지 않으므로 오래 캐시한다.

## 이전 버전으로 되돌리기(롤백)

```
docker compose -p infra exec mlflow publish-model rollback <모델 이름> [<게시된 버전>]
```

- 버전을 생략하면 현재 버전 바로 앞에 게시된 버전으로 되돌린다.
- 파일을 지우지 않고 매니페스트의 `current`만 바꾸므로 즉시 반영된다. 브라우저는 다음 로드부터 이전 모델을 받는다.

## 실시간 코칭 모델과 실험 설정 (COACH-001)

실시간 코칭의 거름 모델과 실험 설정을 이 게시 구조로 운영한다. FE 배포 없이 모델을 바꾸고 실험군으로 비교하고 되돌린다. 코드는 AI `coach_live_model`(학습·등록)과 FE `coach/live/models`(받기·검증·배정)에 있다.

| 게시 이름 | 파일 | 내용 |
| --- | --- | --- |
| `coach-gate-mlp16` (실험군마다 이름이 다를 수 있다) | `coachGate.json`, `coachGate.onnx`, `meta.json` | 거름 모델. `meta.json`의 `featureVersion`이 FE와 다르면 FE가 쓰지 않는다 |
| `coach-cause-logistic` (구조에 따라 `coach-cause-mlp16`) | `coachCause.json`, `meta.json` | 놓침 원인 모델. 규칙이 낸 원인 후보 중 무엇을 화면에 말할지 고른다. `meta.json`의 `task`가 `cause`, `featureVersion`·`classes`가 FE와 맞아야 쓴다 |
| `coach-live-config` | `config.json` | 모드(`off`·`shadow`·`on`), 거름 실험군(`gate.arms`)과 원인 실험군(`cause.arms`), 비율(`share`, 합 100), 모델을 쓰는 사용자 비율(`rolloutPercent`), 연주 중 LLM 구간 코칭(`llm: {mode, rolloutPercent}`, 없으면 off) |

**처음 켜는 순서** (내 PC에서 등록, 서버에서 게시)

1. 터널을 열고 거름 모델을 학습·등록한다. 출력의 버전을 적어 둔다.

   ```bash
   cd AI
   MLFLOW_TRACKING_URI=http://localhost:5000 uv run --extra coach-live python -m ssaplash_ai.coach_live_model.cli --out runs/coach-live --register
   ```

2. 서버에서 모델을 게시한다: `docker compose -p infra exec mlflow publish-model publish coach-gate-mlp16 <버전>`
3. 실험 설정을 검사·등록한다. 처음에는 그림자 모드(판단만 기록하고 문구는 그대로)로 둔다(`AI/configs/coach/coach_live_config.json`).

   ```bash
   MLFLOW_TRACKING_URI=http://localhost:5000 uv run python -m ssaplash_ai.coach_live_model.experiment register configs/coach/coach_live_config.json
   ```

4. 서버에서 설정을 게시한다: `docker compose -p infra exec mlflow publish-model publish coach-live-config <버전>`
5. 확인: `curl -s https://<도메인>/models/manifest.json`에 두 이름이 있고, 연주 한 판 뒤 플레이 로그 `liveCoachEvents`의 첫 행이 `LIVE_ARM`(`{"arm":"coach-gate-mlp16"}`)이고 `LIVE_GATE_*`에 `"model":"coach-gate-mlp16@<버전>"`이 있다.

**바꾸기와 되돌리기**

| 하려는 것 | 방법 |
| --- | --- |
| 새 모델로 교체 | 새로 학습·등록해 게시한다(게시하면 현재 버전이 된다). 다음 연주부터 반영 |
| 두 모델 비교 | 두 번째 모델을 다른 이름(예: `coach-gate-logistic`)으로 등록·게시하고, 설정의 `arms`를 50/50으로 바꿔 새 설정을 게시한다 |
| 원인 모델 켜기 | `cause_model --register`로 학습·등록하고(출력에 규칙 대비 정확도가 나온다) 게시한 뒤, 설정의 `cause.arms`에 넣어 새 설정을 게시한다. 거름 모드와 무관하게 쓰인다. 확인: `LIVE_ARM`에 `causeArm`, `LIVE_CAUSE`에 `"by":"MODEL"`과 모델 이름 |
| 연주 중 LLM 구간 코칭 켜기 | ① GPU 서버에서 `ssaplash-worker live-run`을 띄운다(총평과 같은 모델 설정, `AI/docs/live-coach-llm.md`) ② 서버 `.env`에 `LIVE_COACH_LLM_ENABLED=true`, `api` 재생성 ③ 설정에 `"llm": {"mode": "shadow", "rolloutPercent": 100}`을 넣어 새 설정을 게시한다. 이 기능은 MLflow 모델이 아니라 로컬 LLM을 쓰므로 설정만 게시하면 된다. 확인: `LIVE_ARM`에 `llmArm`, 구간마다 `LIVE_LLM`(`SHADOW`·`LATE`·`FAILED` 비율과 `latencyMs`)을 보고 `on`으로 바꾼다 |
| 문구를 실제로 빼기 | 그림자 기록을 본 뒤 설정의 `mode`를 `on`으로 바꿔 게시한다 |
| 일부 사용자만 | 설정의 `rolloutPercent`를 낮춘다. 비율 밖은 규칙만 쓰고 `LIVE_ARM`에 `rule`로 남는다 |
| 되돌리기 | `publish-model rollback coach-live-config` 또는 `publish-model rollback coach-gate-mlp16` |
| 모델을 아예 끄기 | `mode`를 `off`로 한 설정을 게시하거나, 설정을 롤백한다 |

- 로그인 사용자는 같은 실험군에 계속 남는다. 비율을 올려도 이미 들어온 사람의 실험군은 바뀌지 않는다. 비로그인은 판마다 무작위다.
- 매니페스트나 설정을 못 받으면 FE는 빌드 설정(`VITE_COACH_GATE`)대로 동작한다. 실험군 모델 파일의 `sha256`·크기·`featureVersion`이 맞지 않으면 그 판은 규칙만 쓴다.
- `sha256`은 손상·섞임을 거르는 것이지 서명이 아니다. 게시는 서버의 `publish-model`로만 한다(`Infra/SECURITY.md` 21절).

## GPU 서버 기록 이동 절차 (검증 전)

GPU 서버는 오프라인이라 노트북을 거쳐 옮긴다. **이 절차는 아직 검증하지 못했다.** `mlflow-export-import`와 이 MLflow 버전의 호환성이 확인되지 않았다.

1. GPU 서버에서 `mlflow-export-import`로 실험·모델을 내보낸다(패키지는 오프라인이라 휠 파일을 미리 반입한다).
2. 내보낸 폴더를 묶어 노트북으로 옮기고, 노트북에서 EC2로 `scp`한다.
3. EC2에서 MLflow 서버에 연결해 가져오기(import)를 실행하고 MLflow UI에서 조회한다.

호환되지 않으면 재기록 스크립트로 대체한다(실행 기록의 파라미터·지표·아티팩트를 새 MLflow에 다시 기록한다). 어느 쪽으로 갈지는 GPU 서버의 MLflow 버전을 확인한 뒤 정한다.

## 서버 반영 시 알아 둘 것

- 처음 반영하면 `mlflow-db-init`이 `mlflow` DB를 만들고 `seaweedfs-init`이 `airdrum-mlflow` 버킷을 만든다. 둘 다 일회성이라 끝나면 `Exited (0)`이 정상이다.
- 백엔드 DB 주소에 `POSTGRES_PASSWORD`를 그대로 넣는다. 비밀번호에 `@`, `/`, `:`, `%` 같은 문자가 있으면 주소가 깨지므로 영문·숫자 비밀번호를 쓴다(서버는 `openssl rand -hex`로 만든다).
- MLflow 3.x는 요청의 호스트 이름(`Host` 헤더)을 검사하고, 기본으로 `localhost`와 사설 IP만 받는다. 다른 컨테이너가 `http://mlflow:5000`으로 접속하면 `403 Invalid Host header - possible DNS rebinding attack detected`로 거부된다(2026-11-17 추천 배치에서 확인, `Infra/TROUBLESHOOTING.md` I9). 그래서 compose의 `mlflow` 명령에 `--allowed-hosts mlflow,mlflow:5000,localhost,localhost:5000,127.0.0.1,127.0.0.1:5000`을 준다. 이 값은 기본 목록을 대신하므로 SSH 터널·게시 도구가 쓰는 `localhost`·`127.0.0.1`도 함께 적는다. 새 호스트 이름으로 접속해야 하면 이 목록에 더한다. `*`는 쓰지 않는다.
- `models` 볼륨은 배포로 지워지지 않는다. `docker volume prune`이나 `docker system prune --volumes`를 실행하지 않는다(멈춘 서비스의 데이터가 삭제된다).

## 실패 시 대안

- MLflow가 요구에 맞지 않으면 실험 기록은 파일(`mlruns`)로만 남기고 모델 게시 경로(`/models`)는 그대로 쓴다. 게시 도구는 MLflow 모델 레지스트리를 입력으로 쓰므로, 이 경우 모델 파일을 `/models`에 직접 복사하고 매니페스트를 수동으로 갱신한다.

## 문제 해결

| 증상 | 원인과 해결 |
| --- | --- |
| `mlflow`가 시작하지 않음 | `docker compose -p infra logs mlflow --tail 40`. 백엔드 DB 접속 오류면 `mlflow-db-init`이 끝났는지, 스토리지 접속 오류면 `seaweedfs-init`이 끝났는지 확인한다 |
| 아티팩트 저장 시 접속 오류 | 스토리지 키 변수(`OBJECT_STORAGE_WRITE_*`)와 `airdrum-mlflow` 버킷을 확인한다 |
| 게시가 `이미 게시된 버전` | 버전 폴더는 바뀌지 않는다. 새 MLflow 버전으로 등록해 게시한다 |
| `/models/manifest.json`이 404 | 아직 게시한 모델이 없다. `publish-model list`로 확인한다 |
