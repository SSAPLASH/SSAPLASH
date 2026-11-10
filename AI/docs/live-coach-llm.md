# 연주 중 LLM 구간 코칭 (COACH-001)

연주 중 4·8·16마디 구간이 끝날 때마다, 그 구간의 연주 기록을 요약한 **구간 사실**로 안내 칸 문구 한 장(제목 8자, 보조 16자)을 쓴다.
모델은 **리포트 LLM 총평과 같은 로컬 오픈소스 모델**(교내 GPU 서버의 Ollama, 지금은 `gemma3:4b`)이다. 외부 유료 API를 쓰지 않는다.
판정마다의 규칙 코칭은 그대로이고, LLM 문구가 늦거나 실패하면 그 구간은 규칙 코칭만 쓴다. 설계는 `.claude/plans/COACH-001-연주중-LLM-코칭-설계.md`(개인 문서).

- 코드: `src/ssaplash_ai/coach/live_narrative.py`(사실 → 프롬프트 → 가드레일), `src/ssaplash_ai/worker/live_coach_job.py`(BE 호출, 실행기, 전용 루프).
- 구조는 총평과 같은 **pull 방식**이다: FE가 BE에 구간 사실을 넣고, GPU 워커가 가져가 문구를 제출하고, FE가 짧은 주기로 결과를 조회한다.
- 총평 워커(`ssaplash-worker run`)는 채보 작업이 없을 때만 총평을 가져간다. 채보는 몇 분씩 걸려서 연주 코칭은 **별도 프로세스**(`ssaplash-worker live-run`)가 1초 주기로 연주 코칭 큐만 본다. 모델 서버는 함께 쓴다.

## 흐름

```
구간 끝(FE) → POST /api/v1/live-coach/segments (BE 큐, 202)
            → GPU 워커 live-run이 claim (1초 주기) → 로컬 모델 → 가드레일 → result 또는 failure
            → FE가 GET /api/v1/live-coach/segments/{requestId}를 0.5초마다 조회 → 기한 안이면 다음 구간에 띄움
```

예상 지연은 2~4초다(큐 대기 평균 0.5초, 모델 약 1~2초). 모델이 GPU에서 내려가 있으면 첫 요청은 약 14초 더 걸린다(Ollama는 5분 안 쓰면 내린다).

## 구간 사실 (`facts`)

FE가 만들고 BE는 모양(객체, `contractVersion` 1, 4KB 이하)만 검사한다. 타격 원본·회원 번호·`playId`·곡 정보는 넣지 않는다.

| 필드 | 내용 |
| --- | --- |
| `segment` | `index`, `fromBar`, `toBar` |
| `input` | `stick` 또는 `keyboard` |
| `counts` | 이 구간의 `perfect`·`good`·`miss` |
| `timing` | `meanDeltaMs`(늦음 +), `stdDeltaMs`, `sameSignRatio` |
| `pads` | 놓침·오차가 큰 패드 최대 3개(`pad`, `notes`, `misses`, `meanDeltaMs`) |
| `hands` | `weakHand`(`LEFT`·`RIGHT`), `ratio`(스틱만) |
| `ruleCoach` | 이 구간에 규칙이 띄운 지적 태그(`tags`)와 고른 원인(`causes`) |
| `previous` | 직전 구간 `counts`와 직전에 띄운 LLM 문구 `lastTip`(`title`, `sub`) |
| `stage` | 판정 단계 0~3 |

프롬프트에는 숫자를 그대로 주지 않고 말로 풀어 준다(안내 칸 문구에는 숫자를 쓰지 않는다). 패드 이름은 화면 키트와 같은 탐1·탐2다.

## 가드레일 (`live_narrative.check`)

하나라도 어기면 다시 한 번 쓰게 하고(첫 시도의 문제를 알려 줌), 또 어기면 실패로 보고한다.

| 검사 | 기준 |
| --- | --- |
| 형식 | JSON `{"title", "sub"}` 하나(코드 울타리·앞뒤 말은 허용) |
| 길이 | 제목 1~8자, 보조 16자 이하 |
| 숫자 | 쓰지 않는다 |
| 금지어 | 리포트 총평과 같은 목록(점수·비난·단정)과 정확도 |
| 글자 | 영어·외국 글자·마크다운 없음(특수 토큰·이모지는 지운다) |
| 입력 방식 | 키보드면 스틱·손목·떨구기·팔 표현 없음 |
| 패드 | 사실의 `pads`에 나온 패드만. 킥은 박의 기준으로 말해도 된다 |
| 반복 | 직전 LLM 문구와 제목이나 보조가 같으면 안 된다 |

## 워커 실행 (GPU 서버)

총평 워커와 같은 환경 변수를 쓰고, 모델 설정도 총평과 같다(`SSAPLASH_NARRATIVE_LLM_URL`, `SSAPLASH_NARRATIVE_LLM_API`, `SSAPLASH_NARRATIVE_MODEL`). 채보 모델은 올리지 않는다.

```bash
uv run ssaplash-worker live-run
```

| 환경 변수 | 기본 | 뜻 |
| --- | --- | --- |
| `SSAPLASH_LIVE_POLL_SEC` | 1.0 | 연주 코칭 큐를 보는 주기(초) |
| `SSAPLASH_LIVE_LLM_TIMEOUT_SEC` | 8.0 | 모델 한 번 호출의 시간 제한(초). 늦은 답은 버려지므로 짧게 둔다 |

- BE 호출은 재시도하지 않는다(늦은 답은 쓸모없다). 연결이 안 되면 5초 쉬고, API가 없으면(404) 5분 동안 묻지 않는다. 401이면 종료 코드 2로 끝난다.
- 실패 코드: `INPUT_INVALID`(사실 모양이 틀림), `MODEL_FAILED`(모델 서버 오류·시간 초과), `OUTPUT_INVALID`(가드레일 거절). 실패 요약에 사실 값은 담지 않는다.
- Nginx는 `^~ /internal/v1/live-coach-jobs/`를 채보·총평 워커 경로와 같은 GPU 서버 IP 허용으로 열어야 한다.
- 모델을 연주 시간대에 GPU에 올려 두려면 Ollama의 `keep_alive`를 길게 둔다(GPU 메모리 여유 확인 필요).

## 켜고 끄기

- BE: `LIVE_COACH_LLM_ENABLED`(기본 꺼짐), 판당·분당 상한은 `LIVE_COACH_LLM_PER_RUN`·`LIVE_COACH_LLM_PER_MINUTE`(BE README).
- FE: 실험 설정 `coach-live-config`의 `llm`(`off`·`shadow`·`on`, `rolloutPercent`). `shadow`는 요청·기록만 하고 화면에 띄우지 않는다.
- 처음에는 `shadow`로 켜서 플레이 로그 `LIVE_LLM`의 늦음·실패 비율과 지연을 본 뒤 `on`으로 바꾼다.
