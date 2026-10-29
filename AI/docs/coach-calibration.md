# 약점 분석 실측 보정 (COACH-003)

약점 분석 규칙(`ssaplash_ai.coach`, 통계 규칙 엔진)의 임계값은 실제 플레이 로그 없이 정한 가정값이다. 이 배치는 **동의한 사용자의 비식별 연주 기록**으로
임계값 **후보**를 만들어 MLflow에 기록한다. 임계값을 자동으로 바꾸지는 않는다. 사람이 기록을 검토·승인하고, 승인한 값을 `config.py`에 반영하는 MR로만 바뀐다.

## 1. 흐름

| 단계 | 누가 | 하는 일 |
| --- | --- | --- |
| 1 | 자동 | 비식별 뷰에서 읽는다. 허용 목록 밖의 열이 하나라도 있으면 읽지 않고 실패한다 |
| 2 | 자동 | 지난 성공 실행 이후 새로 쌓인 세션이 기준(기본 50개) 미만이면 건너뛴다 |
| 3 | 자동 | "진짜 플레이가 아닌 것"을 제외한다(4절) |
| 4 | 자동 | 현재 규칙으로 패턴별 걸림 비율과 오차·놓침·세기 분포를 계산한다 |
| 5 | 자동 | 임계값을 바꿔 가며 같은 세션에 다시 분석해 what-if를 만들고, 정책에 목표가 있으면 후보를 고른다 |
| 6 | 자동 | 후보가 있으면 합성 평가 도구(`coach_eval`)로 재평가한다 |
| 7 | 자동 | MLflow에 기록한다. 후보가 있으면 `approval=pending` |
| 8 | **사람** | MLflow에서 기록을 검토해 `approved`/`rejected`로 바꾼다 |
| 9 | **사람** | 승인했다면 `config.py` 임계값과 `ANALYZER_VERSION`을 고치는 MR을 올린다 |

코드 위치: `src/ssaplash_ai/coach_calibration/`. 서버(`ssaplash_ai.server`)는 이 패키지를 가져다 쓰지 않는다.

## 2. 데이터 출처: 비식별 뷰 `coach_export_v`

BE가 만드는 읽기 전용 뷰다(마이그레이션 V19 예정). AI 배치는 원본 테이블에 접근하지 못하고 이 뷰만 읽는다.

| 구분 | 내용 |
| --- | --- |
| 행 조건 | `consent = true`인 세션. **탈퇴한 사용자의 세션도 포함**(BE 탈퇴 정책이 동의한 기록을 남긴다). 팀원 시험 계정은 `users.role = 'ADMIN'`으로 제외(운영 `ADMIN_EMAILS`에 팀원 등록). 사용자당 최근 10개만. `RHYTHM`/`SHEET`만 |
| 세션 열 | `session_key`(소금 해시, 원본 `id`로 되돌릴 수 없음), `mode`, `input_source`, `song_ref`(개인 곡은 `NULL`), `song_origin`(`PUBLIC`/`PRIVATE`), `difficulty`, `perfect_ms`, `good_ms`, `played_date`(날짜까지, KST), `payload_schema_version` |
| 타격 열 | `seq`, `t_ms`, `stick_id`, `pad`, `velocity`, `peak_accel`, `judgement`, `matched_note_id`, `delta_ms` |
| 없는 것 | 회원 정보 전부, 키트·보정·`client_meta`, 원본 키, `payload_hash`, 정확한 시각, `pitch`·`yaw`, `baseline_pad`·`predicted_pad` |

- 허용 열 목록은 `source.py`의 `ALLOWED_COLUMNS`에 있고 시험이 BE와 합의한 목록과 같은지 고정한다. 열을 늘리려면 BE와 먼저 합의한다.
- `difficulty`는 BE가 확인하는 동안 선택 열이다. 나머지 열은 필수이고 하나라도 없으면 실패한다.
- 동의 철회는 "철회 이후 세션부터 `consent=false`"다. 어제 있던 `session_key`가 오늘 없을 수 있다. 그래서 세션 키를 저장하지 않고 **세션 수의 증감**으로만 다시 돌릴지 판단한다(줄어든 만큼은 새 세션이 가려져 실행이 늦어질 수 있다).

## 3. 실행

```bash
uv run python -m ssaplash_ai.coach_calibration.cli
```

| 환경 변수 | 뜻 |
| --- | --- |
| `SSAPLASH_COACH_EXPORT_DSN` | 뷰를 읽는 **읽기 전용 계정**의 접속 문자열(필수). 명령줄에 쓰지 않는다. 로그와 오류에 나오지 않는다 |
| `MLFLOW_TRACKING_URI` | MLflow 주소. 없으면 로컬 `mlruns/`(git 미추적). 서버 안에서는 `http://mlflow:5000` |
| `SSAPLASH_CALIBRATION_POLICY` | 정책 파일 경로. 경로를 주었는데 파일이 없으면 실패한다 |

| 옵션 | 뜻 |
| --- | --- |
| `--policy` | 정책 파일(환경 변수보다 우선) |
| `--min-new` | 다시 돌릴 최소 신규 세션 수(기본 50) |
| `--tracking-uri` | MLflow 주소(환경 변수보다 우선) |
| `--view` | 뷰 이름(기본 `coach_export_v`) |
| `--skip-reeval` | 후보의 합성 재평가를 건너뜀 |
| `--force` | 새 세션이 모자라도 돌린다(뷰가 비어 있으면 돌지 않음). 정책을 바꾼 뒤 후보를 바로 보고 싶을 때 쓴다 |

끝에 **한 줄 상태**를 표준 출력에 남긴다. 알림이 이 줄을 본다.

- `coach-calibration status=OK sessions=… valid=… candidates=… sample=… approval=… run=…`
- `coach-calibration status=SKIPPED reason=NOT_ENOUGH_NEW_SESSIONS sessions=… new=…`
- `coach-calibration status=FAIL error=<예외 종류> [columns=<열 이름>]`

OK·SKIPPED는 종료 코드 0, FAIL은 1이다. 실패 줄에는 예외 **종류**와 열 이름만 담고 메시지·접속 정보·값은 담지 않는다.

기본 정책 파일 `configs/coach/calibration_policy.yaml`은 **서버 이미지에 들어가지 않는다**(Dockerfile이 `src`만 복사). 컨테이너에서는 정책 파일을 읽기 전용으로 마운트하고
`SSAPLASH_CALIBRATION_POLICY`로 경로를 준다.

## 4. 이상치 제외

"진짜 플레이가 아닌 것"만 뺀다. **점수가 낮거나 많이 놓친 플레이는 빼지 않는다.** 서툰 사용자의 기록을 지우면 코칭이 필요한 사람이 표본에서 사라져 임계값이 실제보다 낙관적으로 쏠리기 때문이다.
위에서부터 처음 걸린 이유 하나로 센다.

| 이유 | 기준 |
| --- | --- |
| `CORRUPT` | 같은 세션의 값이 서로 다름, `seq` 중복, `seq` 순서와 시각이 거꾸로, 판정 폭 없음·0 이하, 알 수 없는 입력 종류, 요청 형식 검증 실패 |
| `TOO_LARGE` | 타격 행 50,000 초과(서버 상한과 같음) |
| `UNSUPPORTED_MODE` | `RHYTHM`/`SHEET`이 아닌 모드(정상이면 0건) |
| `TOO_FEW_NOTES` | 노트 20개 미만(분석 엔진이 분석하지 않는 기준과 같음) |
| `IDLE` | 노트 중 놓침이 90% 이상(자리 비움) |

키보드 입력은 시험용이라 제외하지 않고 **드럼과 따로** 집계한다(섞으면 오차·세기 분포가 흐려진다). 후보는 드럼 세션으로만 만든다.

## 5. 걸림 비율과 분포

- **걸림 비율**: 현재 규칙으로 세션을 분석해 패턴마다 몇 %의 세션에 걸리는지 센다. 한 세션은 같은 패턴을 여러 구간에서 내도 한 번만 센다. 95% 윌슨 구간을 함께 낸다. 정답 라벨이 없는 실제 로그에서 쓸 수 있는 지표다.
- **분포**(5·25·50·75·95 분위수): 세션 단위는 놓침 비율, 여분 타격 비율, 오차 평균·표준편차, 손 세기 비율, 노트 수, 판정 폭. 타격 단위는 오차와 세기. 오차는 `goodMs` 비율로 맞춘다.
- **소규모 셀 가림**: 기록에 남기는 값은 개인 한 명의 값이 드러날 수 있는 작은 집계를 가린다.
  - 걸린 세션이 1~4건이면 정확한 횟수와 비율 대신 상한만 남긴다(0건은 그대로).
  - 분포는 기여한 세션이 5개 미만이면 전체를 가린다. 가려진 값은 MLflow 지표로도 올리지 않는다.

## 6. 후보와 what-if

임계값 하나(knob)가 한 그룹을 좌우한다. 각 그룹의 임계값을 현재 값의 0.5~1.5배(0.05 간격)로 바꿔 같은 세션에 다시 분석하고, 그룹의 걸림 비율을 what-if 표로 기록한다.

| 그룹 | `Thresholds` 필드 | 영향받는 pattern | 값을 키우면 |
| --- | --- | --- | --- |
| `TIMING` | `timing_mean_ratio` | `TIMING_LATE`, `TIMING_EARLY` | 걸림 감소 |
| `PAD` | `pad_mean_ratio` | `PAD_LATE`, `PAD_EARLY` | 감소 |
| `TRANSITION_LATE` | `transition_late_ratio` | `TRANSITION_LATE` | 감소 |
| `TRANSITION_MISS` | `transition_miss_rate` | `TRANSITION_MISS` | 감소 |
| `HAND_WEAK` | `hand_ratio_max` | `HAND_WEAK` | **증가**(기준 비율 미만이면 약함) |
| `MISS_CLUSTER` | `cluster_miss_rate` | `MISS_CLUSTER` | 감소 |
| `UNSTEADY` | `unsteady_std_ratio` | `UNSTEADY` | 감소 |

**정책 파일** (`configs/coach/calibration_policy.yaml`, 사람이 정한다)

| 키 | 뜻 |
| --- | --- |
| `targets` | 그룹별 `[최소, 최대]` 걸림 비율(0~1). **비워 두면 후보를 만들지 않고 what-if 표만 기록한다**(처음 상태) |
| `max_change` | 한 번에 현재 값에서 움직일 수 있는 비율(±, 기본 0.25, 최대 0.5) |
| `min_sample` | 이보다 적은 드럼 세션이면 후보도 what-if도 만들지 않는다(`INSUFFICIENT_SAMPLE`, 기본 50) |

**후보 선택 규칙**
1. 현재 걸림 비율이 이미 목표 범위 안이면 `KEEP`(바꾸지 않음).
2. 허용 변경 폭(`max_change`) 안에서 목표 범위에 들어오는 값이 있으면 그중 **현재 값에 가장 가까운 것**이 `CHANGE`(변경 폭이 같으면 목표 중심에 더 가까운 쪽).
3. 닿지 못하면 `OUT_OF_REACH`(목표에 가장 가까운 점을 참고로 기록).
4. 정책에 그 그룹의 목표가 없으면 `NO_TARGET`.

후보가 하나라도 있으면 합성 평가 도구로 같은 합성 로그에 현재 값과 후보 값을 각각 돌려, **탐지율이 가장 많이 떨어진 크기**와 **정상 로그 오탐률이 가장 많이 오른 크기**를 함께 기록한다.
실측 걸림이 좋아져도 합성 탐지율이 크게 떨어지면 후보를 조정한다.

후보는 걸림 비율의 **점추정**으로 고른다. 세션이 50개 안팎이면 95% 구간이 ±14%p쯤 되므로 승인할 때 기록의 구간을 같이 본다.
what-if는 (격자 21점 × 7그룹) × 세션 수번의 분석이라 세션이 수백 건까지는 문제 없고 수천 건이면 분 단위다.

## 7. MLflow 기록

- 실험 `coach-weak-segments-calibration`, run 이름 `calib-{날짜}-n{유효 드럼 세션 수}`.
- **행 단위 데이터는 올리지 않는다.** 지표와 산출물은 집계값이고 작은 셀은 가려진 채로만 올라간다.

| 종류 | 이름 |
| --- | --- |
| 태그 | `approval`, `sampleStatus`(`OK`/`INSUFFICIENT_SAMPLE`), `runDecision`, `analyzerVersion`, `filterVersion`, `profileVersion`, `candidatesVersion`, `dataSnapshot`(`마지막 날짜:세션 수`) |
| 파라미터 | `dataMaxDate`, `viewSessionCount`(다음 실행의 기준), `newSessions`, `minNew`, `validDrumSessions`, `validKeyboardSessions`, `maxChange`, `minSample`, `policyTargets`, `thresholds`(실행 때의 임계값 전체), `countDecreased` |
| 지표 | `flagRate/{DRUM\|KEYBOARD}/{ANY\|pattern}`, `dist/{그룹}/{이름}/q05…q95`(이름: `sessionNotes`, `goodMs`, `missRate`, `strayRate`, `deltaNorm`, `sessionDeltaMean`, `sessionDeltaStd`, `velocity`, `handRatio`), `sessions/{그룹}`, `notes/{그룹}`, `meanSegments/{그룹}`, `current/{TIMING 등}`, `threshold/{…}`, `candidateThreshold/{…}`, `candidateRate/{…}`, `excluded/{이유}`, `count/{TOTAL\|KEPT_DRUM\|KEPT_KEYBOARD}`, `reeval/worstRecallDrop`, `reeval/worstFpRise` |
| 산출물 | `summary.md`(사람이 읽는 요약), `profile.json`, `candidates.json`(what-if 포함), `reeval.json`(후보가 있을 때) |

`approval` 값: `pending`(제안한 후보가 있어 승인 대기), `approved`·`rejected`(사람이 바꿈), `superseded`(새 실행이 나와 대체됨), `NOT_APPLICABLE`(제안한 후보가 없어 승인할 것이 없음).
새 실행이 기록되면 이전의 `pending`은 `superseded`로 바뀐다.

## 8. 승인 절차

1. MLflow에서 최근 실행의 `summary.md`를 연다. 제외 현황, 걸림 비율(구간 포함), 후보 표, 합성 재평가를 본다.
2. 처음에는 정책 `targets`가 비어 있다. 분포를 보고 그룹별 목표 범위를 정해 정책 파일에 적는 MR을 올린다. **목표 범위는 사람이 정하는 정책 결정**이다.
   신규 세션이 기준만큼 쌓여야 다시 돌기 때문에, 정책을 반영한 뒤 후보를 바로 보려면 `--force`로 한 번 돌린다(실행 이유가 `FORCED`로 기록된다).
3. 후보를 채택하면 실행의 태그 `approval`을 `approved`로, 반려하면 `rejected`로 바꾸고 이유를 태그 `approvalNote`에 적는다.
4. 승인했다면 `src/ssaplash_ai/coach/config.py`의 임계값을 고치고 `ANALYZER_VERSION`을 올리는 MR을 올린다(BE의 `reports.generator_version`에 기록되는 값). MR 본문에 실행 링크와 `reeval.json` 결과를 붙인다.
5. 적용한 뒤에는 합성 평가(`docs/coach-eval/`)를 같은 명령으로 다시 돌려 비교한다.

## 9. 개인정보와 보안

- 분석에 쓰는 것은 동의한 기록이고, 읽는 곳은 비식별 뷰뿐이다. 읽기 전용 계정은 뷰 외에 권한이 없고 접속 문자열은 환경 변수로만 받는다.
- 세션 키(소금 해시)는 기록과 산출물에 남기지 않는다.
- 비식별 집계는 동의 철회·회원 탈퇴 이후에도 개인별로 찾아 지울 수 없다. 동의 문구에 이 점을 적는다.
- 법적 기준(가명정보 처리 요건)은 팀·멘토 확인이 필요하다. 이 문서는 법적 판단을 하지 않는다.

## 10. 한계

- **실제 DB 연결은 아직 시험하지 않았다.** 모든 시험은 뷰를 모사한 메모리 행으로 했다. BE 뷰가 서버에 적용되고 읽기 전용 계정이 만들어진 뒤 연결 시험이 필요하다.
- 정답 라벨이 없으므로 탐지율·오탐률은 잴 수 없다. 걸림 비율은 "몇 %에게 보여 줄지"의 정책 판단 근거이지 정확도가 아니다.
- 표본이 작으면(50개 안팎) 비율의 구간이 넓다. 후보는 점추정으로 고른다.
- 한 임계값을 바꿔도 다른 그룹의 걸림이 변할 수 있다(후보 선택과 중복 줄이기 때문). 후보를 여러 그룹에 동시에 적용한 효과는 합성 재평가로만 본다.
- 키보드(시험용) 세션은 후보 계산에 쓰지 않는다.

## 11. 시험

```bash
uv run pytest tests/coach_calibration
```

- 허용 열 고정, 허용 밖 열 거부(값 미노출), 제외 규칙과 경계, 분포의 알려진 값, 소규모 셀 가림, 후보 선택 규칙, 정책 파일 검증
- 끝에서 끝까지: 뷰 모사 → 제외 → 분포 → 후보 → 임시 MLflow 기록(산출물에 세션 키·행 단위 값이 없음, 신규 세션이 없으면 건너뜀, 새로 쌓이면 이전 `pending`을 `superseded`로)
- 진입점: 상태 줄, 종료 코드, 실패 줄에 비밀이 없음
