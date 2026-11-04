# LLM 총평 작업 (COACH-003 후속, 오픈소스 모델)

규칙 총평(`summary.source=RULE`)을 **교내 GPU 서버의 로컬 오픈소스 모델**이 쓴 코치 문장(`source=LLM`)으로 바꾸는 흐름이다.
외부 유료 API를 쓰지 않는다. 사용자는 항상 규칙 총평을 먼저 보고, LLM 문장은 준비되면 그것을 **덮어쓴다.**
GPU 서버가 꺼져 있거나 모델이 실패하면 규칙 총평이 그대로 남는다.

- 코드: `src/ssaplash_ai/coach/narrative.py`(사실→프롬프트→가드레일→폴백). 모델은 이 모듈이 모르며 `TextGenerator` 함수로 끼운다.
- 구조는 채보 워커(`/internal/v1/chart-jobs/`)와 같은 **pull 방식**이다: BE가 작업을 큐에 넣고 GPU 워커가 가져가 결과를 제출한다.
  EC2에서 교내망으로 건너가는 접속 경로가 필요 없다.

## 흐름

```
업로드 → BE가 weak-segments 호출(3초) → 규칙 총평 저장 (사용자에게 바로 보임)
       → BE가 총평 작업 생성 → GPU 워커 claim → 로컬 모델이 문장 작성 → 가드레일 검사
       → result 제출 → BE가 coach_summary.text를 LLM 문장으로 덮어씀 (source=LLM)
                     └ 실패/가드레일 거절 → failure 제출 → BE는 규칙 총평 유지
```

## BE가 만들 API (워커용, 채보 워커와 같은 인증)

경로 접두어 `/internal/v1/coach-narratives`. 인증은 채보 워커와 같다(`Authorization: Bearer 토큰`, `WorkerTokenFilter`).
Nginx는 `^~ /internal/v1/chart-jobs/`처럼 이 경로 하나를 같은 IP 허용으로 열어야 한다(Infra가 추가한다).

| 호출 | 요청 | 성공 응답 |
| --- | --- | --- |
| `POST /claim` | `{ "workerId": "worker1", "claimRequestId": "<uuid>" }` | 작업이 없으면 `204`. 있으면 `200` `{ "jobId": 7, "attemptId": "<uuid>", "leaseExpiresAt": "ISO-8601", "facts": { … } }` |
| `POST /{jobId}/result` | `{ "attemptId", "text", "model", "generationMs" }` | `200` `{ "status": "DONE" }` |
| `POST /{jobId}/failure` | `{ "attemptId", "code", "retryable", "summary" }` | `200` `{ "status": "FAILED" 또는 "QUEUED" }` |

- 같은 `claimRequestId`로 다시 부르면 같은 배정을 돌려준다(채보 `claim`과 같은 멱등성).
- 임대는 120초다. 추론이 짧아서 heartbeat는 두지 않는다. 임대가 끝나면 BE가 작업을 되돌려 다시 배정한다. 시도는 최대 2번이다.
- `result.text`: BE가 **1~500자**, 제어 문자 없음으로 검증한다(워커는 400자 이하만 보낸다). `model`은 모델 이름 문자열(로그용, 37자 이하), `generationMs`는 0 이상 정수.
- `failure.code`는 `INPUT_INVALID`·`MODEL_FAILED`·`OUTPUT_INVALID`(가드레일 거절 포함) 중 하나, `summary`는 200자 이하 한 줄. 입력 값은 담지 않는다.
- 결과를 받으면 BE는 `coach_summary`에서 `level`·`focusPattern`은 **그대로 두고** `text`만 바꾸며 `source`를 `LLM`으로 바꾼다.
  작업이 실패하거나 만료되면 아무것도 바꾸지 않는다(규칙 총평 유지).
- 리포트 한 건에 총평 작업은 하나만 만든다. 이미 만들어진 리포트에는 소급하지 않는다.

## `facts` (claim 응답에 담기는 사실)

타격 원본(`hits`)·회원 번호·`playId`·`songId`·곡 제목은 **넣지 않는다.** BE가 저장된 리포트에서 만든다.

```json
{
  "contractVersion": 1,
  "level": "FAIR",
  "focusPattern": "MISS_CLUSTER",
  "counts": { "perfect": 20, "good": 10, "miss": 10 },
  "strengthPad": "KICK",
  "segments": [
    {
      "pattern": "MISS_CLUSTER", "severityLevel": "MEDIUM", "pads": ["SNARE"],
      "fromMs": 7000.0, "toMs": 12000.0, "scope": "SEGMENT",
      "metrics": { "severity": 0.67, "missRate": 0.4, "missCount": 4, "noteCount": 10 }
    }
  ],
  "history": {
    "sameSongPlays": 3,
    "previous": { "counts": { "perfect": 20, "good": 10, "miss": 18 }, "topPatterns": ["TIMING_LATE"] }
  }
}
```

| 필드 | 출처 | 내용 |
| --- | --- | --- |
| `level`, `focusPattern` | 저장된 규칙 총평 | 그대로 |
| `counts` | 리포트의 판정 개수 | `perfect`/`good`/`miss` |
| `strengthPad` | 저장된 규칙 총평의 `strengthPad` | 규칙 총평이 "잘한 점"으로 꼽은 패드. 없으면 null |
| `segments` | 저장된 `weakSegments` | `pattern`, `severityLevel`, `pads`, `fromMs`, `toMs`, `metrics`에서 `scope`와 수치만. 최대 5개 |
| `history` | BE가 집계 | **같은 사용자, 같은 곡**의 이전 플레이. 없으면 null |

`history` 규칙

- `sameSongPlays`: 이번을 뺀 같은 곡 이전 플레이 횟수(1 이상). 없으면 `history` 전체를 null로 둔다.
- `previous`: **바로 직전** 플레이의 판정 개수와 상위 약점 `pattern`(최대 3개). 직전 플레이에 리포트가 없으면 그 앞의 리포트 있는 플레이를 쓴다.
- 문장은 주어진 숫자의 비교("지난번보다 놓침이 줄었어요")만 쓴다. 최근 N회 추이가 필요하면 `previous`를 배열로 늘리는 것이 다음 변경이다.
- 개인 식별 정보(회원 번호, `playId`, 시각)는 넣지 않는다.

## 워커가 하는 일

1. `claim`으로 `facts`를 받는다. 모양이 맞지 않으면 `INPUT_INVALID`로 `failure`.
2. 로컬 모델로 문장을 쓴다(`write_narrative`). 가드레일에 걸리면 이유를 알려 주고 한 번 더 쓴다.
3. 통과하면 `result`, 둘 다 걸리면 `OUTPUT_INVALID`로 `failure`, 모델 실패는 `MODEL_FAILED`(재시도 가능)로 `failure`.

가드레일(`narrative.check`): 400자 이하 한 문단, 마크다운·목록·영어·한자·가나·이모지 없음, 점수·정확도 말하지 않음, 비난·단정 표현 없음,
문장의 숫자는 `facts`의 숫자나 그 산술(백분율, 구간 길이, 두 평균의 차이, 놓침 비율의 변화)만, `facts`에 없는 패드 이름 없음,
기록이 없는데 지난번과 비교하지 않음, 지난번보다 놓침이 늘었는데 나아졌다고(또는 그 반대로) 쓰지 않음.

## 워커 설정 (GPU 서버)

환경 변수 `SSAPLASH_NARRATIVE_ENABLED`(기본 꺼짐), `SSAPLASH_NARRATIVE_MODEL`, `SSAPLASH_NARRATIVE_LLM_URL`(기본 `http://127.0.0.1:11434`),
`SSAPLASH_NARRATIVE_LLM_API`(`ollama` 또는 `openai`). 표와 순서는 `README.md`의 "LLM 총평 작업". 코드는 `coach/llm_local.py`(모델 서버 호출),
`worker/narrative_job.py`(BE 호출·실행). 채보 작업이 없을 때만 총평 작업을 가져가며, BE가 404를 주면 5분 동안 묻지 않는다.

## 미결

- 모델 확정: 후보를 같은 골든 샘플로 비교한 뒤 정한다(GPU 서버에서 실행, 라이선스 확인).
- 총평 작업의 큐 테이블·재시도 정책의 세부는 BE가 정하고 이 문서의 API 모양만 지킨다.
