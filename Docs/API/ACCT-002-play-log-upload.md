# ACCT-002 플레이 로그 업로드 v1

관련 작업: [S15P31A307-98](https://ssafy.atlassian.net/browse/S15P31A307-98).

이 문서는 BE 구현의 연동 계약이다. 2026-10-21 사용자가 BE 계약을 먼저 구현하고 다른 파트가 맞추도록 지시했다. 기존 FE가 이미 이 형식이라는 뜻은 아니다. 요청 DTO는 `BE/src/main/java/com/ssafy/airdrum/play/PlayUploadRequest.java`, OpenAPI는 `/v3/api-docs`에서 확인한다.

## 전송 순서

1. 플레이 시작 시 UUID `playId`를 한 번 생성한다. 사용한 `chartVersionId`, 프리셋, 캘리브레이션, 판정 규칙을 고정한다.
2. 종료 시 요약과 전체 hits를 `POST /api/v1/plays`로 보낸다. 종료마다 다른 UUID로 재시도하지 않는다.
3. 요약이 201 또는 200이면 원본 JSON을 최초 한 번 직렬화해 로컬에 보관하고 gzip으로 압축한다. `POST /api/v1/plays/{playId}/raw`로 보낸다.
4. 원본 204를 확인한 뒤 로컬 재전송 데이터를 정리한다. 전송 실패·응답 유실 시 같은 UUID·내용으로 재전송한다. 요약과 원본의 성공 여부를 별도로 저장한다.

모든 요청은 기존 인증의 `Authorization: Bearer <accessToken>`이 필요하다. 회원은 토큰으로 결정한다. body에 `userId`를 넣지 않는다. raw 원본에는 센서 수집값만 넣으며 키보드·MISS에 센서값을 만들어 넣지 않는다.

실행 가능한 형식 예제: [요약 JSON](examples/play-summary-v1.json), [원본 JSON](examples/play-raw-v1.json). 예제 UUID는 실제 플레이마다 새로 생성한다. 원본 파일의 바이트를 그대로 gzip으로 압축해 file part에 넣는다.

`consent`는 AI 학습 활용 동의다. false여도 서비스용 플레이 요약·원본은 접수하며, false 원본을 학습 대상으로 사용하면 안 된다. 이 작업은 학습 추출이나 회원 탈퇴 후 보관 정책을 구현하지 않는다. 원본 bucket은 비공개여야 한다.

## 요약: POST /api/v1/plays

Content-Type: `application/json`. HTTP Content-Encoding 압축은 사용하지 않는다.

| 필드 | 계약 |
| --- | --- |
| schemaVersion | 필수 정수 `1` |
| playId | 필수 UUID, 플레이 시작 시 생성·재전송 때 유지 |
| mode | `RHYTHM`, `SHEET`, `FREE`, `TEMPO` |
| inputSource | `KEYBOARD`, `STICK`. pointer/phone을 실제 스틱으로 표기하지 않음 |
| songId / chartVersionId | RHYTHM·SHEET는 양의 정수 둘 다 필수. FREE·TEMPO는 둘 다 null |
| kitPresetId | 본인 서버 프리셋 ID 또는 null. 로컬 ID를 전송하지 않음 |
| kitPresetSnapshot | `{name,pads,keyBindings}` 또는 null. pads는 패드별 `{pitch,yaw}`, keyBindings는 키→패드 맵 |
| calibration | `{audioOffsetMs,pads}` 또는 null. pads는 패드별 적용 기준 자세 `{pitch,yaw}` |
| judgementContext | 아래 판정 컨텍스트. RHYTHM·SHEET 필수, FREE·TEMPO는 null |
| startedAt / endedAt | 필수 ISO-8601 오프셋 시각 문자열. 숫자 epoch는 거부. 종료 ≥ 시작, 최대 2시간. 소수초 최대 6자리의 유효 정밀도 |
| consent | 필수 boolean. 누락을 false로 처리하지 않음 |
| summary | RHYTHM·SHEET의 `{score,accuracy,maxCombo,judgementCounts}`, 나머지 null |
| hits | 필수 전체 이벤트 배열. 빈 배열 허용, seq 0부터 연속 |
| liveCoachEvents | `{tMs,tag,text}` 배열. 최대 1,000건. 누락/null은 빈 배열 |
| clientMeta | `{endReason,lastSongTimeMs,elapsedActiveMs,appVersion,firmwareVersion}` 또는 null. 앞 3개 필수, 버전 문자열은 선택 |

clientMeta.endReason은 `COMPLETED`, `ABORTED`, `DISCONNECTED` 중 하나다. elapsedActiveMs는 pause를 제외한 음수 아닌 경과시간이다. appVersion·firmwareVersion과 tag는 최대 64자, text는 최대 2,048자다. 임의 환경 정보·토큰·URL 필드는 받지 않는다. 자세 단위는 도(degree), audioOffsetMs는 ms다. 스냅샷은 실제 적용값만 보낸다.

v1 패드 코드는 `HIHAT`, `SNARE`, `HI_TOM`, `MID_TOM`, `FLOOR_TOM`, `CRASH`, `RIDE`, `KICK`이다. 기존 FE 7종에 `MID_TOM`을 추가하는 서버 계약으로 정했다. FE·EMB의 기존 합의 완료를 주장하지 않으며 키트/센서 어댑터가 이 코드에 맞춰야 한다. padMapping/keyBindings는 최대 32개, 패드별 자세는 최대 8개다.

### hits

| 필드 | 계약 |
| --- | --- |
| seq | 정수, 0부터 1씩 증가. FE 이벤트 처리 순서, tMs로 재정렬하지 않음 |
| tMs | 유한 실수 ms. 당시 음원/세션 위치, 카운트인 음수 허용 |
| pad | 위 8종 중 하나 |
| stickId | 실제 센서 손 0 또는 1. 키보드/페달 등 비센서 입력은 null |
| velocity | 실제 타격 정수 0~127. MISS는 null |
| baselinePad / predictedPad | 실제 수집한 패드 코드 또는 null |
| peakAccel / pitch / yaw | 실제 수집한 유한 실수 또는 null. DB float32 정밀도 |
| judgement | PERFECT, GOOD, MISS 또는 null |
| matchedNoteId | 고정 chartVersion의 noteId 또는 null. 같은 세션에서 중복 불가 |
| deltaMs | PERFECT/GOOD의 `tMs - note.timeMs`, 유한 실수. 나머지 null |

- PERFECT/GOOD에는 noteId·velocity·deltaMs가 필요하다. 노트의 pad와 hit.pad가 같아야 한다.
- MISS에는 noteId가 필요하고 tMs는 노트의 timeMs다. deltaMs·stickId·velocity·baselinePad·predictedPad·peakAccel·pitch·yaw는 모두 null이다.
- 미매칭 타격은 judgement·matchedNoteId·deltaMs가 모두 null이고 velocity는 필수다.
- inputSource=KEYBOARD이면 모든 hits의 센서 필드는 null이다. STICK 세션에는 비센서 킥 입력이 섞일 수 있다.
- notes.timeMs는 이미 오프셋 반영 값이다. BE가 offsetMs를 다시 더하지 않는다. 수치 일치 허용 오차는 0.001ms이며 저장값은 반올림하지 않는다.

### 판정 컨텍스트와 집계

`judgementContext` 예:

```json
{
  "schemaVersion": 1,
  "judgementVersion": "SCORE_V1",
  "timingWindows": {"perfectMs": 25, "goodMs": 60},
  "playbackRate": 1,
  "padMapping": {}
}
```

판정 폭은 이 요청에서 실제 사용한 값이며 25/60ms가 성능 실측값이라는 뜻은 아니다. `0 ≤ perfectMs < goodMs ≤ 1000`, `0 < playbackRate ≤ 4`다. 판정 폭과 deltaMs는 모두 음원 위치 ms 기준이다. 속도 변경 시 FE가 이 시간축으로 변환해 기록한다.

SCORE_V1은 PERFECT=100점, GOOD=60점, MISS=0점이다. `abs(deltaMs) ≤ perfectMs`는 PERFECT, 그 밖에서 goodMs 이하는 GOOD이다. BE는 FE 판정을 수정하지 않고 모순된 요청을 거부한다.

- `score`: 전송한 PERFECT/GOOD 점수 합계.
- `accuracy`: `score / 전체 채보 noteCount`, 백분율 0~100, 소수 둘째 자리 HALF_UP. noteCount=0이면 0. 입력의 유효 소수 자릿수는 최대 2자리이며 뒤의 0은 허용한다. 해시 계산 전에 범위를 검사하고 동등한 숫자 표현은 DB 저장 전에도 정규화한다.
- `judgementCounts`: `{perfect,good,miss}`, 명시적으로 전송한 행 수와 같음.
- `maxCombo`: seq 순서의 PERFECT/GOOD 연속 최대. MISS가 끊고 미매칭 타격은 영향을 주지 않음.
- 중도 중단 시 미래 노트를 MISS로 만들지 않는다. 채보 전체 노트 수를 분모로 쓰므로 중도 중단 accuracy가 낮아질 수 있다.

### 응답과 멱등성

신규 201, 동일 내용 재전송 200:

```json
{"playId":"9da79b76-5d88-4875-bc71-c826c3fb4293","rawLogStatus":"PENDING"}
```

원본 접수 뒤에는 rawLogStatus가 `UPLOADED`다. `PENDING`은 원본 미접수를 뜻하며 실패/원본 불필요 여부를 따로 표현하지 않는다. 센서 없는 플레이의 원본을 생략할 수 있고 이 경우 PENDING이 유지된다. 원본까지 전송할 경우 raw.hits는 빈 배열이다. reportId는 반환하지 않는다. 리포트 생성·조회는 별도 기능이다.

서버는 회원·요청의 의미값을 SHA-256으로 보존한다. JSON 키 순서, 동일 시각의 다른 오프셋 표기, 동등 숫자 표현, 선택 필드 누락/null 차이는 정규화한다. 배열 순서·동의·원래 프리셋 ID도 해시에 포함한다. 같은 UUID에 다른 내용은 409다. 저장 후 프리셋/곡이 삭제되거나 원본 상태가 바뀌어도 최초 내용의 재전송은 성공한다. schemaVersion이 같으면 해시 정규화 규칙도 유지한다.

## 원본: POST /api/v1/plays/{playId}/raw

multipart/form-data의 파일 part `file` 하나. 파일 내용은 **단일 gzip member 안의 단일 UTF-8 JSON 문서**다. 파일명은 저장 key로 사용하지 않는다. 추가 파일/폼 필드·잘못된 CRC·연결 gzip·후행 압축 데이터는 거부한다.

정상 접수와 동일 원본 재전송은 모두 204이며 body가 없다. 같은 플레이에 다른 원본은 409다. **압축을 푼 바이트를 해시하므로 gzip 헤더/압축률은 바뀌어도 되지만 JSON 공백·키 순서를 바꾸면 다른 원본이다.** FE는 최초 직렬화 JSON 바이트를 보관해야 한다.

```json
{
  "schemaVersion": 1,
  "playId": "9da79b76-5d88-4875-bc71-c826c3fb4293",
  "clockContext": {
    "sensorTickHz": 1000,
    "browserClock": "PERFORMANCE_NOW",
    "audioClock": "SONG_POSITION"
  },
  "hits": [{
    "seq": 0,
    "stickId": 0,
    "hitId": "sensor-1",
    "tHit": 1000,
    "tRecv": 1200.25,
    "tResolved": 1201.5,
    "tAudio": -10.125,
    "swingWindow": {
      "sampleRateHz": 100,
      "accelScale": 0.001,
      "gyroScale": 0.001,
      "samples": [[-32768,32767,0,1,2,3],[0,0,0,0,0,0]]
    }
  }]
}
```

위 수치들은 포맷 예제이며 센서의 실제 설정값이 아니다.

| 값 | 의미·제한 |
| --- | --- |
| raw hits | 요약에서 stickId가 있는 모든 행과 seq·stickId가 정확히 대응하고 tAudio도 tMs와 일치(오차 0.001ms). 누락/추가/중복 거부 |
| hitId | 실제 센서 이벤트 식별자, 세션 내 유일한 1~64자 |
| tHit | 센서 tick의 음수 아닌 정수, JS 안전 정수 이하. sensorTickHz로 초 환산 |
| tRecv / tResolved | 브라우저 performance.now 기준 ms. 음수 불가, resolved ≥ recv |
| tAudio | 음원/세션 위치 ms. 카운트인 음수 허용 |
| sensorTickHz | 실제 센서 tick 주파수. 0보다 크고 1e9 이하. 센서 행이 없는 원본은 null 가능 |
| sampleRateHz | 실제 센서 샘플링 Hz. 0 초과 10,000 이하 |
| accelScale / gyroScale | int16 원시값에 곱해 각각 m/s², rad/s로 변환하는 양수. 10,000 이하 |
| samples | 1~512개 샘플, 각각 `[ax,ay,az,gx,gy,gz]` 6축 int16 정수 |

원본의 시계·단위·스케일은 실제 수집값을 명시한다. 센서 펌웨어가 다른 형식이면 수집 어댑터에서 이 포맷으로 변환한다. 실제 기기의 지원 여부는 아직 통합 검증하지 않았다.

## 오류와 재시도

기존 공통 `application/problem+json` 형식을 사용한다.

| HTTP / code | 처리 |
| --- | --- |
| 400 PLAY_PAYLOAD_INVALID | 구조·시간·집계·센서 대응 오류. 데이터 수정 필요 |
| 401 UNAUTHORIZED | access 토큰 갱신 후 같은 요청 재시도. 탈퇴 회원은 저장 불가 |
| 404 PLAY_NOT_FOUND | 없는/타인 세션·곡·프리셋·접근 불가 버전 |
| 409 PLAY_PAYLOAD_CONFLICT / PLAY_RAW_PAYLOAD_CONFLICT | 이미 저장된 내용과 충돌. 기존 값은 유지. 무조건 자동 반복하지 않음 |
| 409 PLAY_SCHEMA_UNSUPPORTED | 지원하지 않는 schemaVersion 또는 judgementVersion |
| 409 PLAY_STATE_CHANGED | 동시 변경·만료·세션 삭제 경합. 같은 요청을 제한적으로 재시도 |
| 413 PLAY_UPLOAD_TOO_LARGE | 허용 크기 초과. 컨테이너의 multipart 초과는 공통 413 형식일 수 있음 |
| 503 PLAY_UPLOAD_BUSY | Retry-After(초) 이후 재시도 |
| 503 PLAY_RAW_STORAGE_UNAVAILABLE | 원본 설정 미완료/저장소 장애. 요약은 이미 저장될 수 있으므로 원본만 재시도 |

실패 시 로컬 데이터를 삭제하지 않는다. 네트워크 실패는 서버 commit 실패를 뜻하지 않으므로 새 UUID를 만들어 재전송하지 않는다. 재전송 큐는 FE 구현 범위다.

## 제한과 저장 방식

- 요약: 비압축 본문 5 MiB, hits 50,000행, 최대 2시간. 세 제한을 모두 만족해야 한다. 50,000행이 5 MiB에 들어간다는 보장은 없다.
- 원본: gzip 파일 20 MiB, 전체 multipart 21 MiB, 해제 후 64 MiB. Content-Length 외 실제 읽은 바이트도 검사한다.
- JSON: 최대 깊이 16, 문자열 2,048자, 숫자 토큰 64자. 일부 필드는 위 표처럼 더 작다. 알 수 없는 필드·중복 키·숫자 문자열·NaN/Infinity는 거부한다.
- 파싱·집계·노트 맵 검사는 쓰기 트랜잭션 전에 한다. 트랜잭션에서 ACTIVE·참조를 재확인하고 세션+hits를 500행씩 같은 연결에서 저장한다. 중간 배치 실패 시 전체 rollback이다.
- 원본 검사에 쓰는 세션 해시·센서 hits는 단일 조회의 같은 스냅샷에서 읽는다. 원본 접수 트랜잭션에서 해시를 다시 비교하여 검증 중 삭제·다른 내용으로 재생성된 세션에는 원본을 연결하지 않는다.
- 원본은 전체 문자열/JSON 트리를 생성하지 않는다. gzip/JSON 토큰을 스트리밍 검사하고 multipart 임시 파일을 재사용한다. 인스턴스당 기본 2개 처리 슬롯을 인증 후 multipart 파싱 전에 제한한다.
- 임시 파일은 프로세스 전용 디렉터리와 파일 잠금으로 분리한다. 다른 실행 중인 인스턴스 파일은 건드리지 않고, 비정상 종료 잔여 파일만 다음 기동 때 정리한다.

## Infra 설정·장애 복구

| 환경변수 | 기본·설명 |
| --- | --- |
| PLAY_RAW_ENABLED | false. 설정 전 원본 저장은 503 |
| PLAY_RAW_ENDPOINT | S3 호환 endpoint |
| PLAY_RAW_REGION | us-east-1 |
| PLAY_RAW_BUCKET | 원본 전용 비공개 bucket |
| PLAY_RAW_ACCESS_KEY / PLAY_RAW_SECRET_KEY | 서버 전용 자격 증명. 저장소에 커밋하지 않음 |
| PLAY_RAW_PRIVATE_BUCKET_CONFIRMED | false. Infra가 비공개 접근 정책을 확인한 뒤 true |
| PLAY_RAW_CONCURRENT_UPLOADS | 인스턴스당 2, 1~32 허용. 확장 시 전체 디스크·동시 요청 예산도 증가 |

필요 권한은 지정 bucket의 GetBucketVersioning, 객체 Put/Head/Delete다. 버전 관리가 Enabled 또는 Suspended이면 이 어댑터는 원본을 받지 않는다. 버전 관리 API가 지원되지 않아도 활성화하지 않는다. 공개 정책 확인은 Infra의 책임이며 이 설정이 정책을 바꾸지는 않는다. 인그레스 본문 제한을 multipart 21 MiB 이상으로 맞추고 외부 연결의 시간/동시성 제한도 설정한다.

새 V9는 `play_raw_uploads` 접수 기록과 조회 인덱스를 추가한다. V1~V8은 변경하지 않는다. 접수 상태 UPLOADING → ACCEPTED/RETIRED이며, 세션의 UPLOADED 전환과 ACCEPTED를 같은 트랜잭션에서 commit한다. 저장소 PUT 중에는 DB 잠금을 유지하지 않는다. PUT 제한은 60초, 접수 만료는 5분, SDK PUT 재시도는 없다. 새 시도는 새 UUID key를 사용한다.

정리는 기존 `file_cleanup_tasks`의 RAW_LOG 역할만 사용한다. raw 시도 UUID를 chart_job_attempts FK인 attempt_id에 넣지 않는다. 복구기는 기본 1분 간격·최대 100건으로 만료/삭제된 세션의 시도를 퇴역시키고, 선점 lease와 갱신 토큰으로 중복 실행을 제어한다.

DELETE 후 늦은 PUT이 파일을 다시 만들 수 있다. 생산자의 완료 확인과 DELETED 작업의 주기 HEAD 재확인으로 이를 재삭제한다. 재확인 간격은 1분부터 최대 24시간으로 늘며, 쓰기 종료 보장이 없는 key의 추적 기록은 자동 만료하지 않는다. ACCEPTED 원본은 정리하지 않는다. 즉시 소거 보장이 아니며 복구기/저장소가 계속 장애면 회수가 지연된다.

관측 지표: `play.raw.cleanup.failed`, `play.raw.cleanup.oldest.seconds`, `play.raw.cleanup.recreated`. 기본 운영 HTTP 노출은 기존 설정대로 health만 유지하므로 모니터링 수집은 별도 설정한다.
