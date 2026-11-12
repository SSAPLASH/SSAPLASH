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
| `aim` (선택) | 스틱 끝 방향 치우침 최대 3개(`pad`, `hits`, `wrongPad`, `vertical` `HIGH`·`LOW`, `horizontal` `LEFT`·`RIGHT`, `size` `SLIGHT`·`CLEAR`, `hand`). 각도 숫자는 넣지 않는다. 없으면 빈 목록으로 본다. `contractVersion`은 1 그대로라 BE 변경이 없다 |

프롬프트에는 숫자를 그대로 주지 않고 말로 풀어 준다(안내 칸 문구에는 숫자를 쓰지 않는다). 패드 이름은 화면 키트(FE `PAD_META.label`)와 같은 스몰탐·미드탐·플로어탐이다.

## 가드레일 (`live_narrative.check`)

하나라도 어기면 다시 한 번 쓰게 하고, 또 어기면 실패로 보고한다. 두 번째 시도에는 어긴 규칙, 실제 글자 수(예: "지금 공백 포함 27자, 16자 이하로 줄이세요"), 앞선 답을 함께 준다. 거절 이유는 워커 로그의 실패 줄에도 남는다(규칙 이름과 글자 수뿐이라 사실 값은 없다).

| 검사 | 기준 |
| --- | --- |
| 형식 | JSON `{"title", "sub"}` 하나(코드 울타리·앞뒤 말은 허용) |
| 길이 | 제목 1~8자, 보조 16자 이하(공백 포함) |
| 숫자 | 쓰지 않는다 |
| 금지어 | 리포트 총평과 같은 목록(점수·비난·단정)과 정확도 |
| 글자 | 영어·외국 글자·마크다운 없음(특수 토큰·이모지는 지운다) |
| 입력 방식 | 키보드면 스틱·손목·떨구기·팔 표현 없음. 스틱이면 "누르다" 없음(스틱은 친다) |
| 자세 | 손목·팔·어깨·젖히기·꺾기·기울이기·스틱 끝 같은 자세 지시는 사실에 `aim`(스틱 끝 방향)이나 약한 손이 있을 때만 |
| 방향 | 사실과 반대로 말하지 않는다: 늦은 구간에 "천천히·늦춰", 빠른 구간에 "서둘러·빨리·당겨", 스틱 끝이 낮은데 "낮게", 높은데 "높게", 왼쪽인데 "왼쪽" |
| 패드 | 사실의 `pads`·`aim`에 나온 패드만. 킥은 박의 기준으로 말해도 된다 |
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

## GPU 서버 모델 서버 (2026-11-11 운영 적용)

교내 GPU 서버는 여러 팀이 같이 쓴다. 기본 포트 11434에는 **다른 사용자의 Ollama**가 떠 있어서, 우리 Ollama는 **127.0.0.1:11435**로 띄우고 워커가 그 주소를 보게 한다. 기본 주소로 두면 연주 사실이 다른 사용자의 프로세스로 간다. 우리 팀이 쓸 수 있는 GPU는 **6번**이다.

```bash
CUDA_VISIBLE_DEVICES=6 OLLAMA_VULKAN=0 OLLAMA_CONTEXT_LENGTH=4096 OLLAMA_KEEP_ALIVE=-1 \
OLLAMA_HOST=127.0.0.1:11435 OLLAMA_MODELS=$HOME/ollama-models OLLAMA_LLM_LIBRARY=cuda_v12 OLLAMA_NO_CLOUD=1 \
setsid nohup ~/ollama/bin/ollama serve >> ~/ssaplash/results/ollama.log 2>&1 < /dev/null &
# 모델을 미리 GPU에 올린다(시간 제한 없음)
curl -s http://127.0.0.1:11435/api/generate -d '{"model":"gemma3:4b","keep_alive":-1,"options":{"num_ctx":4096}}' >/dev/null
OLLAMA_HOST=127.0.0.1:11435 ~/ollama/bin/ollama ps   # 100% GPU, CONTEXT 4096, UNTIL Forever
```

`worker.env`에는 `SSAPLASH_NARRATIVE_LLM_URL=http://127.0.0.1:11435`, `SSAPLASH_NARRATIVE_MODEL=gemma3:4b`를 둔다. 총평 워커(`run`)와 연주 코칭 워커(`live-run`)가 같은 모델 서버를 쓴다.

| 설정 | 이유 |
| --- | --- |
| `CUDA_VISIBLE_DEVICES=6`, `OLLAMA_VULKAN=0` | GPU 8장과 Vulkan 장치를 모두 찾다가 시작 시 GPU 찾기가 30초 제한을 넘겨 CPU로 내려갔다(로그 `GPU discovery watchdog timed out`, `ollama ps`의 `100% CPU`). 6번 한 장만 보게 하고 Vulkan 찾기를 끄면 GPU에 올라간다. 로그에는 `CUDA0`으로 찍힌다 |
| `OLLAMA_CONTEXT_LENGTH=4096` | 워커는 요청마다 `num_ctx` 4096을 보낸다. 모델이 다른 문맥 길이로 올라가 있으면 요청 때 다시 올린다 |
| `OLLAMA_KEEP_ALIVE=-1` | 모델 올리기는 약 15초 걸리는데 워커는 요청을 8초만 기다린다. 요청이 끊기면 Ollama도 올리던 모델을 버려서(`client connection closed before llama-server finished loading`), 모델이 한 번 내려가면 다시 올라오지 못하고 모든 요청이 실패한다. 그래서 내리지 않는다(GPU 메모리 약 4GB 상주) |

- 재부팅하면 자동으로 다시 뜨지 않는다. Ollama → 모델 미리 올리기 → 채보·총평 워커(`run`) → 연주 코칭 워커(`live-run`) 순서로 다시 띄운다.
- 상태 확인: `pgrep -u "$USER" -af "ssaplash-worker (run|live-run)$"`와 `OLLAMA_HOST=127.0.0.1:11435 ~/ollama/bin/ollama ps`.
- **2026-11-11 측정:** GPU 6번 사용률이 다른 사용자 작업 때문에 99%일 때 `gemma3:4b`가 초당 6.8토큰(2026-11-04 단독 측정은 185토큰)이었다. 구간 문구 한 장에 6~9초가 걸려 8초 제한에 대부분 걸렸고, 골든 평가는 끝까지 돌리지 못했다. 그래서 연주 중 LLM은 그림자 모드로 켜고 플레이 로그 `LIVE_LLM`의 늦음·실패 비율을 본 뒤 `on`을 정한다.

## 켜고 끄기

- BE: `LIVE_COACH_LLM_ENABLED`(기본 꺼짐), 판당·분당 상한은 `LIVE_COACH_LLM_PER_RUN`·`LIVE_COACH_LLM_PER_MINUTE`(BE README).
- FE: 실험 설정 `coach-live-config`의 `llm`(`off`·`shadow`·`on`, `rolloutPercent`). `shadow`는 요청·기록만 하고 화면에 띄우지 않는다.
- 처음에는 `shadow`로 켜서 플레이 로그 `LIVE_LLM`의 늦음·실패 비율과 지연을 본 뒤 `on`으로 바꾼다.

## 평가 (GPU 서버에서 실행)

골든 구간 사실 10가지(늦음, 빠름, 흔들림, 패드 놓침, 패드 이동, 빠른 구간, 늦어지다 놓침, 약한 손, 키보드 늦음, 잘 친 구간)로 모델을 여러 번 돌려 가드레일 통과율, 첫 시도 통과율, 거절 이유, 지연 중앙값·95백분위, 통과 문구의 서로 다른 제목 비율을 잰다. 거절된 행에는 마지막으로 거절된 문구와 글자 수가 남는다. 코드는 `coach_eval/live_tip_compare.py`. 운영 워커와 같게 토큰 상한 80, JSON 출력(`format: json`)으로 부른다.

```bash
uv run python -m ssaplash_ai.coach_eval.live_tip_compare --model gemma3:4b --repeat 10 --out data/results/live-tip-compare.md
uv run python -m ssaplash_ai.coach_eval.live_tip_compare --model gemma3:4b --mlflow   # MLflow 실험 coach-live-tip
uv run python -m ssaplash_ai.coach_eval.live_tip_compare --model gemma3:4b gemma3:12b   # 모델마다 <out>-<모델>.md
```

모델 서버 주소 기본값은 우리 Ollama `http://127.0.0.1:11435`다. 11434는 다른 사용자의 Ollama이므로 주소를 바꿀 때 주의한다.

- 목표(확정 전): 통과 90% 이상, 지연 95백분위 4초 이하, 제목 다양성 50% 이상. 보고서 첫 줄에 충족 여부가 나온다.
- 통과율은 가드레일이 잡는 것만 센다. 문구가 사실과 맞는지(예: 잘 친 패드를 지적하지 않는지), 코치다운지는 보고서 표의 문구를 사람이 읽어서 본다.
- 채보 작업과 같은 GPU를 쓰므로, 채보가 도는 중에도 한 번 재서 지연이 얼마나 느는지 본다.
- 2026-11-11 GPU 서버에서 처음 돌렸으나 GPU가 다른 작업으로 바빠 요청 대부분이 시간 제한에 걸려 끝까지 재지 못했다("GPU 서버 모델 서버" 절). 평가에도 `--url http://127.0.0.1:11435`를 준다.
- **2026-11-12 운영 실패 원인:** 운영 `live_coach_jobs`가 모두 `FAILED`였고 워커 로그는 전부 `OUTPUT_INVALID, 시도 2`(1초 안쪽)였다. GPU가 한가할 때(사용률 0%) 골든 30회도 통과 0%: 보조가 16자를 넘음 30, 숫자 3, 키보드 스틱 표현 3. 보조는 22~34자였고, 제목은 10개 중 9개가 "손목"이었다. 시간 초과가 아니라 프롬프트 문제였다. 숫자 3건은 옛 패드 이름 "탐1"의 숫자를 숫자 검사가 잡은 것이다. 프롬프트에 길이에 맞는 예시를 넣고, 근거 없는 자세 지시를 막고, 재시도 힌트에 글자 수를 주고, 패드 이름을 화면 키트 이름으로 바꿨다(설계 `COACH-001-연주중-LLM-각도-실측평가-설계.md`, 개인 문서).
