# 약점 구간 분석 (COACH-003, S15P31A307-138)

플레이가 끝난 뒤 BE가 호출하는 **통계 규칙 엔진**이다. 학습 모델을 쓰지 않는다.
플레이 로그(`hits[]`)에서 노트별 오차·놓침·세기를 계산하고, 판정 폭 `goodMs`에 비례한 임계값과 비교해
"어디서 무엇이 약한지"를 한국어 문장과 함께 돌려준다.

- 코드: `src/ssaplash_ai/coach/`(엔진), `src/ssaplash_ai/server/weak_segments.py`(API)
- 임계값: `src/ssaplash_ai/coach/config.py` 한 곳. 수치는 가정값이며 QA(합성 평가, 이후 실제 로그) 뒤 조정한다.
- 이 문서의 계약은 BE와 합의했다(2026-10-27). 합의 문서는 팀 위키 파트 간 인터페이스에 등록할 예정이다.

## 호출

`POST /analysis/weak-segments` (`Content-Type: application/json`). 서버 내부망에서만 접근한다(인증 없음, 외부 포트 없음).
BE는 연결 1초·응답 3초 제한으로 부르고, 5xx·시간 초과는 1회 재시도한다. 4xx는 재시도하지 않는다.

### 요청

```json
{
  "playId": "6f1c2d3e-0a1b-4c5d-8e9f-001122334455",
  "songId": 12,
  "chartVersionId": 34,
  "difficulty": "NORMAL",
  "mode": "RHYTHM",
  "timingWindows": { "perfectMs": 25.0, "goodMs": 50.0 },
  "hits": [
    { "seq": 0, "tMs": 2014, "stickId": 0, "pad": "HIHAT", "velocity": 90,
      "judgement": "PERFECT", "matchedNoteId": "n0001", "deltaMs": 14 }
  ]
}
```

| 필드 | 설명 |
| --- | --- |
| `mode` | `RHYTHM`, `SHEET`만 받는다. 그 밖은 400 |
| `timingWindows.goodMs` | 이 플레이의 판정 폭. **임계값 계산에 쓴다.** 사용자가 30~150ms로 바꿀 수 있다 |
| `hits[].judgement` | `PERFECT`/`GOOD`/`MISS`/`null`. FE가 확정하고 BE가 검증한 값을 **그대로** 쓴다(다시 판정하지 않음) |
| `hits[].deltaMs` | 노트와의 오차(ms). **양수 늦음, 음수 빠름.** `PERFECT`/`GOOD`에는 반드시 있다(없으면 400) |
| `hits[].tMs` | 타격 시각. `MISS` 행은 **놓친 노트의 시각** |
| `hits[].pad` | 패드. 정식 이름 9개 + 옛 이름 `HI_TOM`(→`SMALL_TOM`). 모르는 이름은 `OTHER`로 모아 계산한다 |
| 모르는 필드 | 무시한다(`pitch`, `yaw` 등) |

`judgement`가 `null`인 행(노트와 맞지 않은 여분의 타격)은 노트가 아니라서 표본 수에 세지 않는다.

### 응답 (200)

```json
{
  "analyzerVersion": "weak-rules-0.3",
  "reason": "OK",
  "weakSegments": [
    {
      "fromMs": 7000.0, "toMs": 12000.0, "pattern": "MISS_CLUSTER",
      "description": "7~12초 구간에서 노트의 40%를 놓쳤어요.",
      "detail": "이 5초 동안 노트 10개 중 4개를 놓쳤어요. 곡의 다른 부분은 괜찮을 수 있으니 이 구간에 집중해 보세요.",
      "tip": "놓친 부분만 따로 떼어 느린 템포로 반복해 보세요. 한 번에 한 마디씩 익히면 곡 전체가 쉬워져요.",
      "severityLevel": "MEDIUM",
      "causeTags": ["MISS", "CLUSTER"], "pads": ["SNARE"],
      "metrics": { "severity": 0.67, "missRate": 0.4, "missCount": 4, "noteCount": 10, "scope": "SEGMENT" }
    }
  ],
  "summary": {
    "level": "FAIR",
    "text": "기본기는 잘 잡혀 있어요. 조금만 다듬으면 훨씬 좋아질 거예요. 먼저 7~12초 구간부터 연습해 보세요.",
    "focusPattern": "MISS_CLUSTER",
    "source": "RULE"
  }
}
```

- `reason`: `OK` / `NO_WEAKNESS`(약점 없음, 빈 배열) / `INSUFFICIENT_HITS`(노트 20개 미만, 빈 배열). 모두 200이다.
- BE 저장 규칙: `weakSegments` 배열 그대로 저장한다. **null = 미분석·실패, `[]` = 분석했으나 약점 없음.**
- `fromMs`/`toMs`: 시작 포함·끝 미포함. 전체 플레이 패턴(`scope: WHOLE`)은 첫 노트 시각 ~ 마지막 노트 시각 + 1.
- `description`은 FE가 그대로 표시하는 한국어 문장이다. `metrics`는 근거 수치(자유 객체)이며 `severity`(0~1)가 항상 있다.
- `tip`(`weak-rules-0.2`부터)은 연습 방법 한두 문장이다. **선택 필드**라서 문구가 없는 `pattern`이면 키 자체가 없다. FE가 그대로 표시한다. 아래 "연습 조언" 참고.
- `detail`·`severityLevel`·`summary`(`weak-rules-0.3`부터)는 모두 **선택 필드**다. 아래 "상세 설명·심각도 단계·종합 총평" 참고.
- 최대 5개(같은 `pattern`은 2개까지), `fromMs` 오름차순.

### 오류

| 상태 | 본문 | 경우 |
| --- | --- | --- |
| 400 | `{"error": "INVALID_REQUEST", "fields": ["mode"]}` | 필수 필드 누락·타입 오류·`mode` 불허·`PERFECT`/`GOOD`에 `deltaMs` 없음. **필드 이름만** 담고 입력 값은 담지 않는다 |
| 400 | `{"error": "INVALID_JSON"}` | JSON이 아님 |
| 413 | `{"error": "TOO_MANY_HITS"}` | `hits`가 50,000건 초과 |
| 413 | `{"error": "BODY_TOO_LARGE"}` | 본문이 5 MiB 초과(실제로는 약 2.5만 건 안팎에서 먼저 걸린다) |
| 500 | `{"error": "INTERNAL_ERROR"}` | 예기치 못한 오류 |

## 분석 방법

1. **노트 표 만들기.** `PERFECT`/`GOOD`/`MISS` 행이 채보의 노트 한 개씩이다. 노트 시각은 `PERFECT`/`GOOD`이 `tMs − deltaMs`, `MISS`가 `tMs`.
   노트 시각 순으로 정렬한다.
2. **패턴별 통계 계산.** 아래 표. 임계값의 ms는 `goodMs = 50` 기준이고 실제로는 `goodMs`에 비례한다.
3. **심한 정도(`severity`) 계산 → 중복 정리 → 선택.** `severity` 내림차순으로 최대 5개를 고른 뒤 시간순으로 정렬한다. 같은 입력은 항상 같은 출력이다.

### 패턴 6종 (처음 켜는 것)

| `pattern` | 알고 싶은 것 | 통계량 | 걸리는 조건 | `severity` |
| --- | --- | --- | --- | --- |
| `TIMING_LATE/EARLY` | 전체적으로 늦거나 빠르다 | 유효 타격 `deltaMs` 평균, 같은 부호 비율 | 유효 타격 ≥ 20, 평균 \|오차\| ≥ 0.3×goodMs(15ms), 같은 부호 ≥ 65% | `min(1, \|평균\| ÷ (1.2×goodMs))` |
| `PAD_LATE/EARLY` | 특정 패드가 늦거나 빠르다 | 패드별 평균 vs 전체 평균 | 그 패드 ≥ 8개, 평균 ≥ 0.4×goodMs(20ms), 전체와의 차이 ≥ 0.24×goodMs(12ms), **차이의 방향이 평균과 같을 때만** | 위와 같음 |
| `TRANSITION_LATE/MISS` | 패드가 바뀔 때(A→B) 늦거나 놓친다 | 같은 전환 노트들의 평균 오차·놓침 비율 | 전환 ≥ 6번, 평균 ≥ 0.5×goodMs(25ms, 유효 타격 ≥ 3) 또는 놓침 ≥ 30% | 늦음은 위와 같음, 놓침은 `min(1, 비율 ÷ 0.6)` |
| `HAND_WEAK` | 한쪽 손이 약하다 | 스틱(0/1)별 `velocity` 평균의 비 | 양손 각 ≥ 15개, 약한 쪽 ÷ 센 쪽 < 0.75 | `min(1, (0.75 − 비율) ÷ 0.4)` |
| `MISS_CLUSTER` | 특정 구간에서 몰려 놓친다 | 5초 창(첫 노트부터 1초씩 이동)의 놓침 비율 | 창 안 노트 ≥ 4, 놓침 ≥ 40%. 겹치는 창은 묶고 **묶음마다 비율이 가장 높은 창 하나**(동률이면 가운데) | `min(1, 비율 ÷ 0.6)` |
| `UNSTEADY` | 박자가 들쭉날쭉하다 | `deltaMs` 표준편차 | 유효 타격 ≥ 20, 표준편차 ≥ 0.5×goodMs(25ms) | `min(1, 표준편차 ÷ (0.8×goodMs))` |

- **스틱 정보가 없는 입력**(키보드, `stickId` null)은 `HAND_WEAK`에서 제외된다. 키보드는 시험용이라 드럼 입력과 같다고 가정한다.
- `HAND_WEAK` 문구는 "한쪽 손"이다. `stickId`가 어느 손인지 문서에 없어서 어느 스틱인지는 `metrics.weakStickId`로 알린다.
- 전환·구간 패턴의 범위: 전환은 첫 전환의 앞 노트 시각부터 마지막 전환 노트 시각 + 1, 몰림은 선택한 5초 창.

### 정의만 해 두고 아직 켜지 않은 4종

`TEMPO_DRIFT_FAST/SLOW`, `VELOCITY_FADE`, `PAD_CONFUSION`, `DENSE_WEAK`. 응답 형식과 `pattern` 이름은 같은 규칙을 따른다.
구현은 후속이며, 실제 로그로 오탐률을 본 뒤 설정으로 켠다. 연습 조언 문구는 켜질 때 바로 붙도록 미리 정해 두었다.

### 연습 조언 (`tip`, `weak-rules-0.2`)

`description`이 "무슨 일이 있었는지"를 말한다면 `tip`은 "어떻게 연습할지"를 말한다. `src/ssaplash_ai/coach/advice.py`가
`pattern`으로 문장을 고르고 패드 이름만 채운다. 새 숫자를 만들지 않고 타격 데이터를 읽지 않아서 같은 입력은 항상 같은 문장이다.

- **문구 원칙:** 초보자 눈높이(전문 용어를 풀어 쓰고 BPM 대신 "느린 템포"), 박·템포·마디·반복 구간·손목 반동 같은 실제 연습 방법,
  "~해 보세요/~좋아요" 말투, 사용자의 실수를 단정하지 않는다. 실시간 코칭 문구(FE `coach/live/copy.ts`)와 어휘를 맞춘다.
- **길이:** 한 항목 100자 이하(`config.MAX_TIP_CHARS`). 화면 폭에 맞는지는 FE와 확인한다.
- **패드 이름과 조사:** 패드 한글 이름은 `config.PAD_LABELS_KO`를 쓰고, `로/으로`·`을/를`은 받침으로 고른다(예: "스몰탐으로", "킥을").
- **`HAND_WEAK`:** 왼손/오른손을 단정하지 않고 "약한 쪽 손"이라고 쓴다(`description`과 같은 이유).
- **새 규칙을 켤 때:** `config.ENABLED_PATTERNS`에 넣는 `pattern`마다 `advice.py`에 문구가 있어야 한다(없으면 시험이 실패한다).
  문구가 없는 `pattern`이 응답에 나가면 `tip` 키만 빠지고 응답은 정상이다.
- **하위 호환:** 요청 형식과 기존 필드는 그대로다. BE는 `weakSegments` 항목의 모르는 필드를 거르지 않고 그대로 저장·전달한다
  (`AnalysisClient.valid()`는 필수 필드의 존재와 타입만 본다). 이 왕복은 아직 BE·DB를 붙인 통합 시험으로 확인하지 않았다.
- 문구는 가정이다. 첫 배포 뒤 사용자 반응을 보고 `advice.py`에서만 고친다.

### 상세 설명·심각도 단계·종합 총평 (`weak-rules-0.3`)

드럼 코치가 초보 연주자에게 직접 이야기해 주는 느낌으로 쓴 규칙 문장이다. 학습 모델·LLM을 쓰지 않으며 같은 입력은
항상 같은 문장이다. 문구와 임계값은 가정이고 첫 배포 뒤 피드백으로 `advice.py`·`summary.py`·`config.py`에서만 고친다.

| 필드 | 위치 | 내용 |
| --- | --- | --- |
| `severityLevel` | 약점 항목 | `metrics.severity`(0~1)를 `LOW`(0.4 미만)·`MEDIUM`(0.7 미만)·`HIGH`로 옮긴 값. 경계값은 윗단계. FE는 "조금/보통/많이" |
| `detail` | 약점 항목 | 그 약점이 무슨 뜻이고 얼마나 넓게 나타나는지 한두 문장(120자 이하). 숫자는 `metrics` 값이나 그 산술만 쓴다. 전체 경향(`scope: WHOLE`)이면 "곡 전체" 경향임을 밝힌다. 문구가 없는 `pattern`이거나 `metrics`가 없으면 키 생략 |
| `summary` | 응답 루트 | 종합 총평. `INSUFFICIENT_HITS`이면 키가 없다 |

`summary` 객체

| 필드 | 내용 |
| --- | --- |
| `level` | `GOOD`·`FAIR`·`NEEDS_WORK`. 놓침 비율 30% 이상이거나 `HIGH` 약점이 있으면 NEEDS_WORK, 놓침 10% 미만이고 PERFECT가 절반 이상이면 GOOD, 나머지 FAIR (가정값, `config.py`) |
| `text` | 200자 이하. 전체 인상 → 잘한 점 하나(노트 8개 이상·적중률 90% 이상인 패드 중 가장 높은 것, 약점으로 지목된 패드는 제외) → 먼저 연습할 것 하나. **점수·정확도 숫자는 쓰지 않는다**(BE 집계 값과 어긋날 수 있다) |
| `focusPattern` | 가장 심한 약점의 `pattern`. 약점이 없으면 키 생략. 연습·곡 추천이 생기면 이 값으로 연결한다(지금은 표시용이 아니다) |
| `strengthPad` | 잘한 점으로 꼽은 패드(정식 이름). 없으면 키 생략. LLM 총평 작업(`docs/coach-narrative.md`)의 사실로 쓰인다 |
| `source` | `RULE`(규칙 문장). 나중에 LLM 문장이 오면 `LLM` |

약점이 없는 경우(`NO_WEAKNESS`)도 총평이 온다. 놓침이 많은데 약점으로 잡히지 않은 경우에는 "눈에 띄는 약점은 없었어요"라고 쓰지 않고
"놓친 노트가 한 곳에 몰려 있지는 않아요. 곡 전체를 느린 템포로…"라고 쓴다.

**BE 저장:** BE는 응답 루트에서 `analyzerVersion`·`reason`·`weakSegments`만 읽으므로 `summary`는 BE가 저장·노출을 반영하기 전까지
버려진다(요청 문서 `COACH-003_리포트-총평-저장`). `severityLevel`·`detail`은 항목 안 필드라 BE 변경 없이 저장·전달된다.

**등급 분포 메모(QA 때 확인):** `MISS_CLUSTER`는 걸리는 조건이 놓침 40%이고 이때 `severity`가 0.67이라, 조건을 막 넘긴 몰림은 `MEDIUM`이고
42% 이상이어야 `HIGH`다. 전체 지연(`TIMING_*`)은 평균 15ms에서 `severity` 0.25(`LOW`), 약 42ms에서 `HIGH`다. 실제 로그로 분포를 본 뒤 조정한다.

## 한계 (QA 때 함께 본다)

- **임계값은 가정값**이다. 합성 평가(139번)와 실제 로그 뒤에 `coach/config.py`만 고쳐 조정한다.
- **`deltaMs`는 판정 폭 안에 갇힌 값**이다(폭을 넘으면 놓침이 된다). 그래서 평균 오차가 실제 지연보다 작게 나올 수 있고, 놓침 계열 패턴이 이를 보완한다.
- `MISS`·여분의 타격 행은 FE 코드상 업로드에 들어가지만(`FE/src/domain/playUpload.ts`), 실제 업로드 통합 시험은 남아 있다.
  `MISS` 행이 오지 않으면 놓침 계열 패턴이 나오지 않는다.
- 내장 채보·자유 모드는 FE가 업로드하지 않으므로 분석 대상이 아니다.

## 로그 정책

- 요청 본문(타격 데이터)과 `playId`는 **로그에 남기지 않는다.** 검증 오류 응답과 로그에도 입력 값을 담지 않는다.
- 분석 뒤 요약만 한 줄 남긴다(임계값 조정 근거): `weak-segments reason=OK notes=26 segments=[TIMING_LATE:0.36,...] goodMs=50 elapsedMs=...`

## 실행·시험

```bash
uv run uvicorn ssaplash_ai.server.app:app --port 8000     # 로컬 실행
uv run pytest tests/coach tests/server/test_weak_segments.py   # 이 기능 시험
uv run ruff check . && uv run ruff format --check .
```

- 합의 샘플 A(약점 있음)·B(없음)·C(표본 부족)의 요청과 기대 응답이 `tests/fixtures/coach/samples.json`에 있고, 골든 시험이 엔진 출력과 비교한다.
  임계값을 조정하면 이 기대값도 함께 다시 만든다.
- 시험용 합성 로그 빌더는 `tests/coach_helpers.py`다(`N(pad, delta, velocity, stick)`으로 노트를 쌓는다).
- 일부 Windows PC에서는 이벤트 루프를 만들 때 `WinError 10014`가 나서 `TestClient` 라우팅 시험 3개가 건너뛰어진다. 처리 로직 시험은 이벤트 루프 없이 실행된다.
- 성능 목표: 5,000건 1초, 50,000건 3초 이내(분석 기준). `tests/coach/test_performance.py`.
