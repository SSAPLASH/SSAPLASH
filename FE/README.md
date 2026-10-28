# FE — SSAPLASH 웹 클라이언트

에어드럼 리듬 게임의 브라우저 클라이언트. 센서(IMU 스틱)가 오기 전에는 키보드와 포인터 모의 IMU로 세팅·기준 자세 보정·게임 흐름을 개발한다.

## 스택

| 항목 | 선택 |
| --- | --- |
| 프레임워크 | React 19 + TypeScript, Vite |
| 상태 | zustand (설정은 localStorage에 영속) |
| 화면 | Canvas 2D (키트·노트 레인), Web Audio (발음) |
| 센서 연결 | Web Bluetooth (BLE 직접), WebSocket (브리지 대안) |
| BE 연동 | `fetch` 공통 래퍼(`api/http`). 로그인은 BE OAuth + refresh 쿠키, access 토큰은 메모리 |
| 검사 | oxlint, vitest |

Node 20 이상, npm 사용.

## 실행

```bash
npm install
npm run dev        # http://localhost:5173
```

로그인이 필요하므로 BE도 함께 켠다(`BE/README.md` 로컬 실행: PostgreSQL·Redis·`.env`). 개발 서버는 `/api` 요청을 `VITE_API_PROXY_TARGET`(기본 `http://localhost:8080`)으로 넘겨 운영처럼 같은 출처가 된다.

BE 없이 게임 화면만 만질 때는 `.env.local`(git 무시)에 한 줄 둔다. 모든 화면이 로그인 없이 열리고 상단바에 로그인 표시가 사라진다.

```bash
VITE_AUTH_REQUIRED=false
```

## 검증 (커밋 전 모두 통과)

```bash
npm run lint       # oxlint
npm test           # vitest — domain·input 순수 로직 단위 테스트
npm run build      # tsc 타입 검사 + vite 번들
```

## 폴더 구조

```
src/
├─ main.tsx     Vite 엔트리. app/bootstrap·app/presetBootstrap·app/authBootstrap을 부르고 렌더
├─ app/        앱 조립 — 아래 전부를 알아도 되는 유일한 곳
│   ├─ App.tsx       라우터. /login·/auth/callback 밖의 화면은 RequireAuth 아래
│   ├─ sources.ts         키보드 소스 · inputManager 단일 인스턴스
│   ├─ sensorRegistry.ts  센서 소스 디스크립터 등록·조회, 인스턴스 지연 생성
│   ├─ sensors.ts         센서 소스 등록 한 줄씩 (새 소스는 여기에 추가)
│   ├─ bootstrap.ts       설정 ↔ 소스 ↔ 스토어 ↔ 오디오 접착, 표면 연결(bindSensorSurface), 오디오 언락
│   ├─ authBootstrap.ts   앱 시작 시 로그인 복원, 토큰 소실 → authStore 연결, AUTH_REQUIRED 상수
│   ├─ presetBootstrap.ts 로그인 상태(authStore) → 프리셋 저장소(서버/로컬) 전환, 목록 읽기, 기본 프리셋 적용
│   └─ playSync.ts        플레이 로그 서버 업로드·상태·재전송, 리포트 미리 받기·조회 오류 분류
├─ pages/      라우트 단위 화면 — Home · Setup · Play · FreePlay · Result · Report(상세 분석) · Studio(곡 작업실) · My(마이페이지) · Login · AuthCallback
├─ components/ 공용 UI — AppShell · RequireAuth · SensorOptionsPanel · KitCanvas · NoteHighway · DebugOverlay · PublicLayout · ProfileMenu · SongPicker(곡 선택) · useChartParam(URL 곡 선택 훅) · SheetStrip(5선 악보 Canvas) · sheetStripDraw(그리기 순수 함수) · SheetSnippet(결과 페이지 약점 마디 미니 악보) · PauseOverlay(일시정지) · usePauseTriggers(끊김·메뉴 자동 일시정지 훅) · ReportEntry(결과 → 상세 분석 진입부) · studio/(AudioDropzone·JobStageStrip·MySongRow·MySongList, 내 곡 화면) · mypage/(MySongList·RecentPlays, 마이페이지)
│   ├─ report/       상세 분석 섹션 — ReportSummary · PadAccuracyChart · TimingHistogram · NoteTimeline · AnalysisPlaceholder
│   └─ shell/        상단 바 공용 위젯 — Metronome(칩·팝오버) · SoundToggle · PublicLayout · ProfileMenu · WithdrawDialog(회원 탈퇴 확인)
├─ store/      zustand — settingsStore(영속) · liveStore(실시간) · presetStore · localPresetSource · authStore(로그인 상태, 영속 안 함) · songStore(곡 목록·상세·`loadChart`) · chartJobStore(음원 업로드·채보 생성 작업 폴링, 활성 작업 1개 영속)
├─ api/        BE 호출 — http(공통 래퍼·ApiError) · auth(access 토큰·refresh·logout) · users(me) · songs·charts(곡·채보 조회, BE 96) · presets(프리셋 CRUD, BE 90 — PresetSource 서버 구현) · plays(플레이 로그 요약 업로드, BE 98) · reports(리포트 조회·화면 타입 변환, BE 157)
├─ input/      입력 소스와 매퍼 (인스턴스는 만들지 않는다 → app/sensorRegistry · app/sources)
│   ├─ InputSource         공통 인터페이스 · ClockSync
│   ├─ SourceDescriptor    입력 소스 디스크립터 타입 (id·라벨·설정 항목·동작 버튼 선언)
│   ├─ KeyboardPadSource   키 코드 타격 (항상 켜짐)
│   ├─ PointerStickSource  마우스 위치 → 자세, 키/클릭 → 타격 (모의 IMU) + 디스크립터
│   ├─ BleStickSource      Web Bluetooth GATT + 디스크립터
│   ├─ WebSocketStickSource  허브 · PC 브리지 + 디스크립터
│   ├─ WebSerialStickSource  USB 직결(Web Serial) + 디스크립터
│   ├─ serialFraming       직결 프레이밍(SOF·LEN·CRC8) 인코더·디코더
│   ├─ stickProtocol       BLE/WS 공용 바이너리 패킷
│   ├─ padMapper           키 매퍼(keyMap) · 자세 매퍼(배치에서 유도한 판정 프로필)
│   └─ InputManager        소스 합성 → 매퍼 → ResolvedHit 발행
├─ engine/     ReferenceCapture · RhythmSession(일시정지 포함) · playLog · playRecorder(타격·MISS 처리 순번) · telemetry
├─ audio/      AudioEngine · soundSets(사운드 세트) · kitConfig(kit-config.json 스키마)
├─ domain/     순수 타입·함수. React·브라우저 API 의존 없음 (단위 테스트 대상)
│   pads · kitLayout · preset · events · keyMap · calibration · kitMapping · chart · songCatalog(곡 타입·난이도 정렬) · chartMapping(BE 채보 → Chart) · judgement · hitStats · auth · playUpload(로그 → 업로드 본문) · report(리포트 화면 타입)
└─ styles/     전역 CSS
```

예약 폴더(첫 파일이 생길 때 만든다): `hooks/` 페이지 공유 훅, `assets/` 이미지·샘플.

### 의존 방향

위에서 아래로만 import한다. 같은 줄끼리는 import하지 않는다.

| 층 | 폴더 | import 허용 |
| --- | --- | --- |
| 조립 | `app`, `main.tsx` | 전부 |
| 화면 | `pages` | hooks · components · store · engine · audio · domain · monitor · app(인스턴스·언락) |
| 공용 UI | `components`, `hooks` | store · engine · audio · domain (+ `app/sensorRegistry` 조회만: AppShell · SensorOptionsPanel) |
| 상태 | `store` | domain · api |
| 코어 | `input`, `engine`, `audio`, `api` | domain |
| 모니터 | `monitor` | input · domain (판정 경로와 분리. `pages/monitor`만 읽는다) |
| 도메인 | `domain` | 없음 |

- store 내부: `presetStore` → `settingsStore` 단방향은 허용한다(같은 줄끼리 import 금지의 예외). `localPresetSource`도 `settingsStore`를 읽는다.

- `types/`·`utils/`는 두지 않는다. 타입은 쓰는 도메인 파일 옆에 둔다(`domain/keyMap.ts`, `domain/events.ts`). 전용 타입 폴더는 "어디 있는지 찾기"와 순환 import를 만들고, 범용 유틸은 아직 없다.
- 경로 별칭 `@/` = `src/` (`tsconfig.app.json` · `vite.config.ts` · `vitest.config.ts`에 같이 설정). 다른 폴더는 `@/`, 같은 폴더는 `./`로 가져온다.
- `inputManager`·키보드 소스는 `app/sources.ts`에서, 센서 소스 인스턴스는 `app/sensorRegistry.ts`가 디스크립터의 `create`로 만든다. 화면은 `input/` 클래스를 직접 new 하거나 소스 id 문자열을 비교하지 않고, 레지스트리의 디스크립터(라벨·가용성·설정 항목)를 읽는다.
- BE는 `api/http`의 `apiFetch`로만 부른다. 화면·store는 401을 직접 처리하지 않는다(아래 [로그인](#로그인)). `api/` 안에서 `http`가 `auth`를 쓰고 `auth`는 `fetch`를 직접 쓴다 — 순환 없음. 로그인 시작·복귀 경로 같은 브라우저 동작은 `store/authStore`의 액션으로 두어 화면이 `api/`를 모른다.

## 패드

패드 enum은 `domain/pads.ts`의 `PadId` 9개(공통 명세서 5장·미결 #9 결정)다. 스틱 7개(`CRASH`·`HIHAT`·`SNARE`·`SMALL_TOM`·`MID_TOM`·`FLOOR_TOM`·`RIDE`)와 페달 2개(`KICK`·`HIHAT_PEDAL`). 목록은 용도별로 세 가지다.

| 목록 | 개수 | 쓰는 곳 |
| --- | --- | --- |
| `ALL_PADS` | 9 | 저장·enum 검증·통계·악보 줄 |
| `LANE_PADS` | 8 | 노트 레인·킷 캔버스·칩 목록. 페달 입력 장치가 정해지기 전까지 `HIHAT_PEDAL` 제외 |
| `STICK_PADS` | 7 | 캘리브레이션·스틱 패드 테이블(`stick: true`) |

옛 이름(`HI_TOM` → `SMALL_TOM`)은 `normalizePadId`·`normalizePadKeys`가 한 곳에서 변환한다. 서버 채보(`chartMapping`)·서버 프리셋(`api/presets`)·설정 마이그레이션(v10)·플레이 로그 로드가 이 함수를 거치므로 BE·AI 데이터가 옛 이름이어도 깨지지 않는다. 부족한 패드 배치는 `kitLayout.fillLayout`이 기본값으로 채운다. 프로토콜 패드 번호(0~8, EMB v0.7)는 화면 순서와 별개로 `input/stickProtocol`에 둔다(`PAD_CODE`·`padFromCode`, 0xFF·9 이상은 null).

## 입력 구조

- **소스**는 "어느 스틱이 언제 얼마나 세게 어떤 자세로 쳤는가"만 낸다. 어느 패드인지는 모른다.
- **매퍼**가 패드를 정한다. 키보드 타격은 키 매퍼(고정 키), 센서 타격은 자세 매퍼(배치에서 유도한 판정 프로필).
- **키보드는 항상 켜져 있고**, 센서 소스는 세팅에서 하나만 고른다(없음 / 레지스트리에 등록된 소스: 포인터 모의 IMU · BLE · WebSocket · Web Serial). 센서를 켜도 Space 킥과 키보드 타격은 그대로 동작한다.
- **프로토콜(v0.7)**: HIT는 20바이트이고 시각은 µs(`timestampUs`)다. 스틱이 판정한 패드가 `pad` 필드로 오며, `decodePacket`이 전체 필드를, `parsePacket`이 `StickEvent`(시각 ms)로 좁힌 값을 낸다. 명령 0x14~0x17·파라미터 표(`STICK_PARAMS`)도 같은 파일에 있다.
- **스틱 판정 우선 규칙**: HIT `pad`가 있으면 자세 매퍼보다 우선해 그 패드로 재생한다(`judgedBy: 'stick'`). `pad`가 0xFF면 자세 매퍼(`'pose'`).
  채보 후보가 있고 `pad`가 후보 밖일 때만, 스틱이 애매하다고 했거나(`ambiguous`) `marginDeg`가 `AMBIGUOUS_MARGIN_DEG`(10°) 미만이면 가장 가까운 후보로 보정한다(`'chart'`). 확신 있는 오타는 그대로 두어 리듬 세션이 MISS 처리한다.
  세기는 스틱 `velocity`를 그대로 쓰고(펌웨어 곡선), 없을 때만 FE 가속도 곡선을 쓴다. 판정 출처는 `ResolvedHit.judgedBy`·텔레메트리에 남는다.
- **Web Serial(USB 직결)**: 921600 8N1, 프레이밍은 `input/serialFraming`(SOF 0xA5 · LEN · payload · CRC8). 직결 CRC·재동기 통계는 모니터가 표시한다.
- **`packetTap`**: 소스가 프레이밍을 벗긴 payload를 파싱 직전(수신)·송신 직후에 `input/packetTap`으로 publish한다. 모니터가 구독할 예정이며, 구독자가 없으면 아무 비용도 들지 않는다.
- **패드 테이블 동기화**(`input/padTableSync`): 센서가 연결되거나 판정 프로필(배치·보정·튜닝)이 바뀌면 스틱 패드 중심을 `SET_PAD_TABLE`(지우고 시작, 3개씩)로 보낸다. 소수 2자리 기준으로 직전과 같으면 보내지 않고, `sendCommand`가 없는 소스(키보드·포인터)는 무동작이다.
- 확인은 `PARAM_ACK_PAD_TABLE`(0x20, value = 적용 개수)을 500ms 창 안에 받아 `acked`로 남긴다. 연결이 끊기거나 소스를 바꾸면 기록을 지운다.
- 표시: 상태(`PadTableStatus`, `domain/calibration`)를 bootstrap이 `liveStore.padTable`로 옮기고, 세팅 화면 "스틱 연결" 카드가 "적용됨 / 적용 n개 / 확인 없음 / 전송 중"을 보인다. input은 store를 import하지 않으므로 `onStatus` 콜백으로 주입한다.
- **방위각 드리프트 보정**(`input/yawDriftMonitor`): 스틱 방위각은 자이로 적분이라 시간이 지나면 밀린다. 센서 타격(`pad` 있음, `judgedBy`가 `stick`·`chart`이거나 `pose`이고 반경 안, 앵커 있음)의 `wrap180(pose.yaw − 앵커.yaw)`를 스틱별 링 12개에 모은다.
- 8개 이상이고 중앙값 절대값 ≥ 6°, 중앙절대편차 ≤ 5°이면 `SET_YAW_OFFSET(적용값 − 중앙값)`(절대값 설정)을 보내고 링을 비운다. 송신 뒤 10초는 재송신하지 않고 `PARAM_ACK_YAW_OFFSET`(0x21)으로 적용값을 확인한다. 임계값은 `domain/tuning`(실측 뒤 조정).
- 연결 직후엔 `SET_YAW_OFFSET(0)`을 보내 기억을 맞추고, `inputManager.resetPose()`(펌웨어가 오프셋을 0으로 되돌림) 때는 FE 상태도 0으로 비운다. 상태(`YawDriftStatus`)는 `liveStore.yawDrift`로 옮겨 세팅 화면 "스틱 연결" 카드에 보인다.
- 하드웨어가 오면 BLE 소스 연결을 검증하고 기준 자세 보정으로 시작 위치를 맞추면 된다. 고정 키·소리·게임 코드는 바뀌지 않는다.

## 새 입력 소스 추가 방법

센서 소스를 추가하는 데 필요한 변경은 파일 1개와 등록 1줄이다. 세팅 화면 목록·설정 패널·라벨 표시는 디스크립터를 읽어 자동으로 따라온다.

1. `src/input/` 에 소스 파일을 만든다(예: `WebSerialStickSource.ts`). `BaseInputSource`를 상속한 클래스와, 파일 끝에 `SourceDescriptor` 상수를 export 한다.
2. `src/app/sensors.ts` 에 `sensorRegistry.register(...)` 한 줄을 더한다.

디스크립터가 선언하는 것(`input/SourceDescriptor.ts`):

| 필드 | 필수 | 내용 |
| --- | --- | --- |
| `id` | 필수 | 저장·조회 키. 설정 저장 키이므로 바꾸지 않는다. `none`·`keyboard`는 예약어 |
| `label` · `description` | 필수 | 화면 표시 이름 · 세팅 화면 한 줄 설명 |
| `availability()` | 필수 | 이 브라우저에서 쓸 수 있는지. 아니면 `reason`을 경고로 보여준다 |
| `create()` | 필수 | 인스턴스 생성. 인자 없음, 레지스트리가 1회만 부른다 |
| `options` | 선택 | 설정 항목(`text`·`number`·`key`·`boolean`)과 기본값. 값은 `sensorOptions[id]`에 저장된다 |
| `applyOptions(인스턴스, 값)` | 선택 | 설정이 바뀔 때마다 호출. 기본값이 병합된 값이 온다 |
| `reservedKeys(값)` | 선택 | 센서가 점유해 키보드 소스에서 뺄 키 코드 |
| `actions` | 선택 | 사용자 제스처가 필요한 동작 버튼(BLE 페어링, 포트 선택 등) |
| `note` · `usageGuide(값)` | 선택 | 설정 패널 아래 안내 문구 · 자유 연주 화면의 조작 안내 |

소스 클래스가 `setSurface(el)`을 구현하면(포인터처럼 화면 좌표를 쓰는 소스) 자유 연주·세팅의 캔버스가 `bindSensorSurface`를 통해 자동으로 연결된다. 소스를 지우거나 이름을 바꿀 때도 이 두 곳만 고친다. 저장된 `sensorKind`가 등록되지 않은 id면 앱 시작 때 `none`으로 되돌아간다.

## 기준 자세 보정

센서(포인터 모의 IMU 포함)를 쓸 때는 스틱을 든 채 자세를 3초 유지해 시작 위치를 잡는다. `engine/ReferenceCapture`가 최근 300ms 샘플의 퍼짐이 3° 이하인 구간을 3초 채우면 완료로 보고, 중간에 흔들리거나 자세 스트림이 300ms 넘게 끊기면 처음부터 다시 센다. 완료되면 호출하는 쪽이 `inputManager.resetPose()`를 불러 그 자세를 기준(캔버스 중앙)으로 삼고, 이후 자세는 기준 대비 상대 각도가 된다.

패드 위치는 보정이 아니라 배치(`kitLayout`)가 정한다. 패드마다 스틱을 가져가 앵커를 잡는 캘리브레이션은 없앴고, 판정 프로필은 배치와 각도 범위에서 유도한다(`domain/kitJudge`). 시스템은 보정이 맞았는지 판정하지 않는다 — 쳐 보고 어긋나면 다시 맞춘다. 연결이 끊긴 뒤에는 `liveStore.referenceStale`로 다시 맞추라고 안내만 하고 강제하지 않는다.

재보정은 통합 설정 페이지(`/setup`)에서 한다. `/calibration`은 `/setup`으로 이동한다.

## 통합 설정(프리셋·캘리브레이션)

`/setup` 한 페이지에서 연결·보정·배치·저장을 끝낸다. 어느 영역이든 언제나 조작할 수 있고 순서를 강제하지 않는다(보정 중에는 보정 카드만 진행 상태가 된다). 2열 레이아웃(좌: 배치·타격 확인, 우: 나머지 카드)이며 960px 미만에서는 1열이다.

- ① **스틱 연결** — 입력 소스 선택과 소스 옵션 패널, 연결 상태 문구. 연결이 끊겼다 돌아오면(`referenceStale`) 시작 위치를 다시 맞추라는 안내만 낸다.
- ②⑥ **시작 위치 보정** — 센서일 때 "시작 위치 맞추기"로 3초 자세 유지(`ReferenceCapture`, 진행 바·퍼짐 표시). 완료하면 `resetPose()`와 함께 `referenceSetAt`을 기록한다. 이미 보정했다면 같은 버튼이 "다시 맞추기"가 된다. 키보드만 쓰면 "보정이 필요 없습니다"만 보인다. 보정 중 연결이 끊기면 처음부터 다시 센다.
- ③ **프리셋 목록** — 이름·기본(★)·"적용 중" 배지, 적용·기본으로·삭제.
- ④ **드럼 배치** — 패드 드래그, 배치 칩 3개, 사운드 세트, 세기 선택. 캔버스가 포인터 기준면(`bindSensorSurface`)이며 배치가 곧 판정이다.
- ⑤ **타격 확인** — 센서 타격이 바로 울리고 마지막 타격을 한 줄로 보여준다. 연결이 끊기면 "스틱 입력 중단"을 표시한다.
- ⑦ **저장·적용** — 적용 중인 프리셋 이름과 변경 여부. **변경사항 저장**(적용 프리셋이 있고 변경됐을 때만), **다른 이름으로 저장**(이름 검증 문구: 빈 이름·50자 초과·중복). 저장 중에는 버튼이 잠기고, 실패하면 오류 코드별 문구와 닫기 버튼을 보여주며 편집값은 그대로다.
- ⑧ **설정 완료** — 아래 조건을 채우면 활성. 누르면 `firstSetupDone = true`로 두고 복귀 경로로 이동한다.

⑥(다시 맞추기)은 ② 카드의 버튼 라벨이 바뀐 것이다. 판정 반경 상한·판정 폭·오디오 오프셋 같은 연주 환경 슬라이더는 8영역 밖의 보조 카드로 아래에 둔다.

**설정 완료 조건**: 키보드만(`sensorKind === 'none'`)이면 항상 가능. 센서면 스틱 연결(`connected[0] || connected[1]`) + 시작 위치 보정(`referenceSetAt`) + 적용된 프리셋(`activePresetId`)이 모두 필요하며, 모자라면 버튼 아래에 남은 조건을 적는다.

**복귀 규칙**: 홈·곡 연주 준비의 바로가기는 `navigate('/setup', { state: { returnTo } })`로 들어오고, 설정 완료는 `sanitizeReturnTo(state.returnTo)`로 이동한다(없으면 `/`).

**이탈 확인**: 변경사항이 저장되지 않았고(`selectDirty`) 보정 중이 아닐 때 다른 경로로 가려 하면 "저장하지 않은 변경이 있습니다" 팝업(나가기 / 계속 편집)이 뜬다. 설정 완료로 인한 이동은 막지 않으며 `beforeunload`는 쓰지 않는다. `useBlocker`는 데이터 라우터에서만 동작하므로 `main.tsx`는 `createBrowserRouter`로 `App`을 splat 라우트 아래에 둔다.

## 준비 조건

연주 전 준비 조건은 세 가지다: 스틱 연결(`connected[0] || connected[1]`), 최초 설정 완료(`settings.firstSetupDone`), 적용된 프리셋(`activePresetId`). 판정은 `domain/readiness.ts`의 `readiness()`가 하고, 키보드 전용(`sensorKind === 'none'`)은 면제라 안내가 뜨지 않는다. 홈과 자유 연주는 `ReadinessNotice`로 미비 항목과 "설정으로" 버튼만 보여주고 진입은 막지 않는다. 리듬 게임·악보 연습은 곡을 고른 준비 단계에서 같은 안내를 보여주고 조건이 모자라면 시작 버튼과 Enter를 막는다. "설정으로"는 `returnTo`를 넘겨 설정 완료 시 그 화면으로 돌아온다(곡 선택이 URL에 있어 같은 곡의 준비 화면으로 돌아온다).

## 곡·채보 조회

- **출처:** 기본은 BE(`/api/v1/songs`·`charts`·`chart-versions`). `VITE_SONGS_SOURCE=builtin`으로 빌드하면 BE 없이 내장 3곡(`BUILTIN_CHARTS`)만 쓰고 SongPicker의 "내 곡" 탭은 숨는다. 내장 소스의 곡·채보 id는 둘 다 `-(인덱스+1)`(음수)이고 `chartVersionId`는 null이다.
- **곡 선택은 URL:** `/play?song=12&chart=34`, `/sheet?song=…&chart=…`. SongPicker에서 난이도 칩을 누르면 `useChartParam.select`가 URL을 바꾸고, 페이지는 쿼리가 있으면 `loading` 단계에서 `loadChart`로 채보를 읽은 뒤 준비 화면으로 간다. 쿼리만으로 준비 화면이 복원되므로 통합 설정에 다녀와도 곡이 유지된다(`ReadinessNotice`의 `returnTo`는 `pathname + search`). 로드 실패는 `ApiError.detail`을 보이고 "곡 선택으로"가 쿼리를 지운다.
- **변환:** `domain/chartMapping.chartFromDetail`이 BE 채보를 `Chart`로 바꾼다. 알 수 없는 pad는 버리고 경고 1회, `timeMs`에 `offsetMs`를 더하지 않으며, `durationMs`가 null이면 마지막 노트 + 1마디, `tempoMap`·`timeSignatureMap`이 둘 이상이면 `variableTempo`로 표시하고 고정 BPM으로 다룬다.
- **버전 고정:** 곡 선택 직후 `getChartLatest`는 한 번만 부른다. 이후(재시작·자산 갱신)는 `chart.chartVersionId`로 `getChartVersion`·`getChartAssets`를 부른다. store는 채보를 캐시하지 않는다.
- **assets:** `loadChart`가 채보와 함께 `getChartAssets`를 부른다. 실패해도 채보는 돌려주고 `assets`가 null이다. `accompanimentUrl`이 있으면 `chart.hasAccompaniment = true`. 서명 URL은 메모리에만 둔다(반주 재생은 아래 "반주 재생" 절).
- **플레이 로그:** `chartVersionId`·`songNumericId`·`chartId`(다시 하기 URL용)·`presetId`가 같이 저장된다. 내장 곡은 null. 채보 노트의 `noteId`와 BE 전체 노트 수(`sourceNoteCount`)도 남긴다(업로드용).

## 곡 작업실(음원 업로드·채보 생성)

- **화면:** `/studio`(상단 메뉴·제목 "내 곡"). 한 화면에 두 섹션이다. 위 "음원 올리기"(MP3·WAV, 50 MiB·10분 이내, `POST /api/v1/songs/audio` 202 `{jobId, songId, status}`), 아래 "내 곡" 목록(`songStore` MINE). 회원당 활성 작업은 하나다(초과 시 429 `AUDIO_BUSY`). 오른쪽 열의 "어떻게 되나요" 안내는 폰 폭에서 아래로 내려간다.
- **목록 행:** 처리 중 → 실패 → 완료 순, 같은 상태 안에서는 최신순. 활성 작업은 202 직후 목록에 아직 없어도 임시 행으로 맨 위에 보이고, 그 행에만 4칸 단계 띠가 있다. 완료 행은 [악보 확인](`/sheet?scope=MINE&song=`)·[플레이](`/play?scope=MINE&song=`), 실패 행은 [다시 올리기]. 활성 작업이 도는 동안 드롭존은 "「제목」을 만드는 중입니다" 안내 줄로 접힌다. 곡도 작업도 없으면(첫 방문) 큰 드롭존과 4단계 안내만 보인다.
- **완료 시 이동:** `chartJobStore.doneSource`로 갈린다. 이 화면에서 폴링하다 완료를 보면(`live`) `/sheet?scope=MINE&song={id}`로 이동한다. 복원(`resume`·429 복원) 뒤 **첫 조회**에서 완료를 보면(`restored`) 이동하지 않고 목록을 다시 읽어 그 행을 2초 강조한다. 곡 생성 실패(`JOB_FAILED`)는 목록을 다시 읽어 실패 행으로 보이고, 업로드 단계 실패·404는 드롭존 안에 오류가 보인다.
- **실패 재업로드:** 실패 행의 [다시 올리기]는 드롭존으로 스크롤하고 제목·아티스트를 미리 채운다(파일만 다시 고른다). 드롭존 위 "「제목」 다시 올리기" 줄의 [취소]로 되돌린다.
- **사전 검사:** `domain/chartJob.precheckAudio`가 빈 파일·크기 초과·확장자(MIME)를 전송 전에 거른다. 제목 기본값은 파일명(확장자 제거, 100자).
- **멱등 키:** 파일·제목·아티스트 조합마다 UUID 하나를 `Idempotency-Key` 헤더로 보낸다. 네트워크·503 실패의 **다시 시도**는 같은 키, 내용이 바뀌면 새 키. 같은 키에 다른 내용(409)은 새 키로 한 번 자동 재전송한다.
- **진행 표시:** BE 진행 WebSocket(161)이 아직 없어 `GET /api/v1/songs/{id}`의 `status`(PROCESSING→READY/FAILED)를 폴링한다(30초까지 3초, 10분까지 5초, 그 뒤 15초. 탭이 숨겨지면 멈추고 다시 보이면 즉시 1회). 4칸(접수·드럼 분리·채보 생성·완료) 중 폴링만으로는 분리·생성을 구분할 수 없어 두 칸을 함께 "처리 중"으로 칠한다(`JobProgress.stageKnown=false`). WS가 붙으면 `chartJobStore`에 소스만 추가한다.
- **복원:** 활성 작업 하나를 `localStorage`(`ssaplash.chartJob.v1`)에 두고 새로고침·재방문 때 이어서 폴링한다. 429인데 기록이 없으면(다른 브라우저) "내 곡" 목록의 PROCESSING 곡으로 복원한다. 끝난 작업 기록은 이 화면이 `clear`로 지운다. 실패 사유는 BE가 주지 않아 기본 문구만 보인다.
- **제외(후속):** MIDI 업로드(BE 151), 개인 곡 이름 변경·삭제(BE 162), 진행 WebSocket(BE 161).

## 플레이 기록 업로드·상세 분석

- **흐름:** 연주 종료 → 로컬 저장 → 결과 화면(로컬 값, 기다리지 않음). 동시에 `app/playSync.startPlaySync`가 `POST /api/v1/plays`(ACCT-002 요약)를 보낸다. 성공하면 리포트 요약과 노트 첫 페이지를 미리 받아 두고 결과 화면의 **상세 분석 보기**가 `/result/:playId/report`로 열린다.
- **playId:** 연주마다 UUID(`newPlayId`). 이전 로그(`play-…`)는 업로드하지 않는다.
- **seq:** `engine/playRecorder`가 활성 타격과 MISS 판정에 처리 순서대로 번호를 매긴다. 서버가 seq 순서로 maxCombo를 다시 계산하므로 이 순서가 어긋나면 400이다.
- **본문 조립:** `domain/playUpload.buildUploadBody`. 판정 타격 `tMs` = 노트 시각 + Δ, MISS `tMs` = 노트 시각, 정확도는 `score / 전체 노트 수` 백분율 소수 둘째 자리 HALF_UP. 입력은 실제 스틱(ble·webserial·websocket)만 `STICK`, 키보드·포인터는 `KEYBOARD`(센서 필드 null). `consent`는 정책이 정해질 때까지 `false`.
- **업로드하지 않는 경우(SKIPPED):** 내장 곡, 이전 로그, 변환에서 버린 노트가 있는 채보, 자유 연주, 50,000행 초과. 결과 화면 버튼에 사유가 나온다.
- **실패·재전송:** 상태는 로그의 `upload`(UPLOADING·DONE·FAILED·SKIPPED)에 저장한다. 처음 조립한 본문을 보관해 같은 playId로 그대로 다시 보낸다(같은 UUID에 다른 내용은 409). 네트워크·5xx·401·`PLAY_STATE_CHANGED`는 재시도 가능, 400·404·그 밖의 409·413은 불가. 결과 화면에 들어올 때 한 번 자동 재전송하고 이후는 **다시 시도** 버튼.
- **상세 분석:** 서버 데이터만 쓴다. `api/reports`가 정확도(0~100 → 0~1)·패드 옛 이름·null을 변환하고, 노트는 `limit` 1000으로 `nextAfterSeq`가 null일 때까지 받아 시간순으로 정렬한다(seq는 시간순이 아니다). 약점·추천 자리는 `analysisStatus`에 따라 안내만 보인다.

## 반주 재생

- **버퍼 재생:** `audio/Accompaniment`가 서명 URL을 fetch해 `decodeAudioData`로 전부 디코드하고 `AudioBufferSourceNode`로 예약 재생한다. 소스는 전용 `accBus` 게인(`AudioEngine.accompanimentBus`, `master` 직결, 패드 음소거와 무관)에 연결한다. 같은 URL이면 다시 받지 않는다. 일시정지는 소스를 멈추고 위치를 기억하며 재개는 새 소스를 그 위치에서 예약한다(위치 계산은 `domain/accompanimentClock`).
- **시각 변환:** `AudioEngine.perfToContextTime`·`contextToPerfTime`이 `getOutputTimestamp` 기반으로 performance.now ↔ AudioContext 시각을 바꾼다(`trigger`·`click`도 같은 메서드를 쓴다).
- **PlayClock:** `engine/sessionClock.PlayClock`이 `RhythmSession`·반주·박 클릭 예약을 묶는다(클릭·반주는 주입). `begin()`은 반주 0초 = `now + lead(300ms) + 카운트인`으로 `RhythmSession.start(at)`과 `accompaniment.start(at, 0)`을 같이 부른다. `start(at)`의 `at`은 곡 0ms가 울리는 performance.now 시각이다. `pause(reason)`·`resume()`·`restart()`·`stop()`·`onFrame(now)`·`songTime(now)`·`state`·`sync`를 제공한다. 재개는 예약 여유 50ms를 두고 세션 시계도 같은 만큼 뒤로 맞춘다.
- **개발용 반주 주입:** `VITE_ACCOMPANIMENT_OVERRIDE=/dev-accompaniment.wav`(`.env.local`)를 두면 `/play`가 모든 곡에 그 URL을 반주로 쓴다. 로컬 BE에 S3가 없을 때 쓴다. 반주가 없으면 클릭만으로 진행한다.
- **동기 Δ 디버그:** 연주 중 HUD에 `반주 동기 Δ`(반주 0초 시각 − 세션 0ms 시각)와 마지막 `재개 Δ`가 ms로 보인다. 목표는 둘 다 ±10ms 이내다.

## 키보드 입력 (개발·시연용, 고정)

| 패드 | 왼손 (스틱 0) | 오른손 (스틱 1) |
| --- | --- | --- |
| 스네어 | F | J |
| 하이햇 | D | K |
| 스몰탐 | E | I |
| 미드탐 | W | O |
| 플로어탐 | C | M |
| 크래시 | R | U |
| 라이드 | T | Y |
| 킥 | — | Space |
| 하이햇 페달 | — | B |

Shift를 같이 누르면 악센트. 사용자가 바꿀 수 없는 고정 매핑이며 `domain/keyMap.ts`의 `KEY_MAP` 상수로만 정의한다.

자유 연주 화면은 치면 바로 울리고 최근 타격과 패드별 횟수를 보여준다. 배치가 판정에 맞게 반영됐는지 확인하는 화면이기도 하다.

리듬 게임은 내장 채보 3곡을 고른 뒤 Enter로 시작한다(1마디 카운트인). 일시정지는 Esc·스틱 연결 끊김·메뉴 요청 3종이고(`PauseOverlay`, 악보 연주와 같은 정책) 그동안 노트가 멈추며 재개·처음부터·나가기(준비 화면)를 고른다. 곡이 끝나면 결과 화면으로 가며 플레이 로그는 localStorage에 계정별 최근 20건 남는다. 결과에서 Enter는 같은 곡 다시 하기.

게임 뷰는 곡 선택 화면에서 고른다(설정에 저장). **노트 하이웨이**는 노트가 레인을 따라 판정선으로 떨어지는 기본 뷰, **킷 위 연주**는 세팅한 킷 배치의 패드 위로 링이 줄어들어 판정 시각에 패드 테두리에 닿는 뷰다. 두 뷰 모두 같은 `RhythmSession`을 읽으므로 판정·점수·결과 저장은 같다.

악보 연주(`/sheet`, 상단 "악보 연습")는 반주에 맞춰 가로로 흐르는 5선 악보를 보며 치는 모드다. 점수·콤보는 화면에 없고 판정은 리듬 게임과 같은 `RhythmSession`이 한다.

화면은 Claude Design 「악보 연주 화면」(https://claude.ai/artifact/AFPSrCXxQsZULivgY5FsZE)의 4개 보드(곡 선택·준비·연주 중·일시정지)를 따른다. 페이지 루트에 `.sheet-mode`를 붙여 `--sm-*` 변수와 `.sm-*` 클래스(`styles/global.css` 끝 블록)를 그 안에서만 쓰고, 앱 셸·다른 페이지의 `--ink`·`--brass` 계열 테마는 건드리지 않는다. 악보 Canvas는 `readColors(canvas)`로 `--sm-*`를 상속받아 읽고(없으면 앱 공통 변수) 기준선은 사이언 2px + 글로우다. 일시정지 다이얼로그(`PauseOverlay`)는 `.sheet-mode` 밖에서도 보이도록 자체 클래스(`.sm-scrim`·`.sm-dialog`·`.pause-dialog`)에 색을 직접 둔다. 곡 선택 표의 "최근 정확도"와 준비 화면의 "최근 기록"은 로컬 플레이 로그(`latestSheetLog`)에서 읽는다.

- **URL·단계:** `/sheet?song=&chart=`. 단계는 `select`(곡 선택) → `loading`(채보 + 반주 디코드, 반주는 `VITE_ACCOMPANIMENT_OVERRIDE ?? assets.accompanimentUrl`) → `ready`(곡 메타·준비 안내·시작) → `play`(+ 일시정지). 단계는 URL 파라미터·세션에서 렌더 중 파생한다. 반주 로드가 실패하면 "반주 없이 계속"(클릭만)과 "곡 선택으로"를 고른다. 변박 곡은 준비 화면에 "고정 템포로 표시" 안내가 뜬다.
- **반주·시계:** `PlayClock`이 세션·반주·박 클릭을 묶는다(`begin`에서 메트로놈 잠금, 종료·나가기·언마운트에서 해제). 카운트인 뒤 반주 0초 = 세션 0ms. HUD 아래 작은 글씨로 동기 Δ(시작·재개)를 보인다.
- **스트립:** 판정 색은 `noteStates` 배열을 판정마다 새 배열로 갱신해 `SheetStrip`에 넘긴다. HUD는 진행 행(시간·진행 바·마디), 판정 6칸 타일(노트·Perfect·Good·Miss·채보 밖·최근 Δ), 범례 줄로 구성한다.
- **일시정지 3종(`components/PauseOverlay`):** Esc(`user`), 스틱 연결 끊김(`disconnected` — `liveStore.connected`가 둘 다 false로 바뀌고 센서 모드일 때만), `liveStore.pauseRequested === 'menu'`(E0 사이드바가 올리는 자리. 페이지가 일시정지 후 `null`로 되돌림). 재개는 준비 조건이 충족될 때만 활성(미충족이면 `ReadinessNotice`), 처음부터는 카운트인부터 다시(메트로놈 잠금 유지), 나가기는 기록 없이 준비 화면으로 돌아간다. 오버레이가 열린 동안 타격은 소리만 나고 세션에는 들어가지 않는다.
- **종료:** 곡이 끝나면 `mode: 'SHEET'` 로그(`chartVersionId`·`presetId` 포함)를 저장하고 `/result/:playId`로 이동한다. 결과 페이지는 SHEET 로그에서 점수·콤보 대신 정확도·판정 분포를 앞에 두고, 규칙 기반 피드백 카드(최대 3개)와 패드별 요약을 보여 준다. "같은 곡 다시"(Enter)는 `/sheet?song=&chart=`로 간다.

피드백 규칙과 임계값 상수는 `src/domain/feedback.ts`에 있다(AI 스코어링이 오면 이 생성기를 교체). 로그에 BPM·박자가 없어 결과 페이지는 채보 없이 피드백을 만들므로 마디 범위가 필요한 규칙은 나오지 않는다.
악보 렌더(`components/SheetStrip`)는 클라이언트 Canvas 5선이며 마디당 320px(`SHEET_BAR_PX`) 시간 비례로 가로로 흐르고, 고정 기준선(화면 폭 35%)이 지금 칠 위치다. 글리프 배치(보표 위치·머리·빔)는 `domain/sheet.layoutBar`, 시간 → x와 보이는 마디 범위는 `components/sheetStripMath`의 순수 함수이며 컴포넌트가 자체 rAF로 `getSongTime()`을 읽어 그린다.
결과 페이지는 피드백 카드가 가리키는 약점 마디를 `components/SheetSnippet`(정지 Canvas, 마디 폭 180~320px)으로 보여 준다. 그리기는 `components/sheetStripDraw`의 `drawSheet`를 `SheetStrip`과 공유하고, 채보는 다시 조회하지 않고 로그에서 `domain/feedback.chartFromLog`로 만든다(`bpm`이 없는 이전 로그는 스니펫 없음). 카드를 누르면 구간이 바뀐다.

포인터 모의 IMU를 켜면 마우스 위치가 스틱 자세가 되고, F(왼손)/J(오른손) 또는 좌/우클릭이 타격이다. 이 두 키는 그동안 고정 키에서 제외된다. 방향키로도 자세를 움직일 수 있다.

## 로그인

자체 가입은 없고 소셜 로그인(Google·SSAFY)만 있다. 계약은 BE README "소셜 로그인"·"인증과 토큰" 절과 같다.

- **시작:** `/login`의 버튼이 `GET /api/auth/{provider}/login`으로 브라우저를 통째로 보낸다(fetch 아님). BE가 제공자 동의 화면으로 302한다. 돌아올 경로는 `sessionStorage`(`ssaplash.auth.returnTo`)에 두며 앱 안의 절대 경로만 허용한다(`domain/auth.ts` `sanitizeReturnTo`).
- **콜백:** 제공자 → BE 콜백 → BE가 refresh 쿠키(`refresh_token`, HttpOnly, `Path=/api/auth`, 14일)를 심고 `/auth/callback`으로 302. 이 화면은 앱 시작 복원을 기다렸다가 저장해 둔 경로로 간다. 토큰은 주소에 실리지 않는다.
- **복원:** 앱이 뜰 때마다 `authBootstrap`이 `POST /api/auth/refresh` → `GET /api/users/me`로 로그인을 복원한다(`authStore.restore`). access 토큰(30분)은 `api/auth` 모듈 메모리에만 있고 localStorage·sessionStorage에 쓰지 않는다. 복원 결과(`authenticated`/`anonymous`)에 따라 `app/presetBootstrap`이 프리셋 저장소를 서버/로컬로 맞춘다([프리셋](#프리셋)).
- **만료:** 보호 API가 401이면 `apiFetch`가 refresh를 한 번 하고 같은 요청을 다시 보낸다. 동시에 여러 401이 나도 refresh는 한 번이다. refresh가 401이면 300ms 뒤 한 번 더 시도하고(두 탭이 동시에 회전하면 진 탭이 이긴 탭의 새 쿠키로 성공한다), 그래도 401이면 `authStore`가 `anonymous`가 되고 `RequireAuth`가 `/login?error=session_expired`로 보낸다.
- **로그아웃:** 상단바 아바타 메뉴의 "로그아웃" → `POST /api/auth/logout`(204) → 메모리 토큰·활성 채보 작업 기록 폐기 → `/login`.
- **마이페이지(`/me`):** 아바타 메뉴의 "마이페이지". 프로필(닉네임·로그인 제공자·가입일), 내 곡(`GET /api/v1/songs?source=MINE`, 상태 배지: 완료 → 플레이, 채보 생성 중 → 곡 작업실, 생성 실패 → 다시 올리기 안내), 이 계정의 최근 플레이 5건(→ 결과 화면), 회원 탈퇴를 둔다.
- **플레이 기록은 계정별이다:** 로컬 플레이 로그 키는 로그인 계정마다 `ssaplash.playlogs.u{userId}`, 비로그인(인증 끔 개발 모드)은 `ssaplash.playlogs`. `app/authBootstrap`이 로그인 상태에 맞춰 `engine/playLog`의 주인을 바꾼다. 다른 계정의 기록은 최근 플레이·결과·악보 기록에 보이지 않는다. 계정 키가 생기기 전 기존 키의 기록은 계정으로 옮기지 않는다(누구 것인지 알 수 없다).
- **회원 탈퇴:** 마이페이지 하단 "회원 탈퇴" → 확인 대화상자(`components/shell/WithdrawDialog`) → `DELETE /api/users/me`(204, BE가 refresh 쿠키를 지운다) → 메모리 토큰·활성 채보 작업 기록(`ssaplash.chartJob.v1`, 로그아웃 때도 지운다)·그 계정의 로컬 플레이 로그 폐기 → `/login?error=withdrawn`. 안내 문구: 학습 활용에 동의한 플레이 기록만 식별 정보를 제거해 보관(BE 153). 204만 탈퇴로 본다. 401은 탈퇴 근거가 아니라 인증 만료로 처리한다 — 토큰을 비우고 `/login?error=session_expired`로 가며 로컬 기록은 지우지 않는다. 네트워크·5xx는 대화상자에 문구를 보이고 다시 시도할 수 있다. 되돌릴 수 없고 같은 소셜 계정으로 다시 로그인하면 새 회원이다.
- **오류 코드(`/login?error=`):** BE가 붙이는 `access_denied`(동의 취소)·`oauth_failed`, FE가 붙이는 `no_session`(콜백 뒤 refresh 실패)·`session_expired`·`network`(서버 연결 실패)·`withdrawn`(탈퇴 완료 안내, 오류 색 없이 표시). 문구는 `domain/auth.ts`에 있다.
- **보호 라우트:** `/login`·`/auth/callback`을 뺀 모든 화면은 `RequireAuth` 아래다. `VITE_AUTH_REQUIRED=false`면 검사 없이 통과한다([실행](#실행)).
- **주의:** BE `.env`에 그 제공자의 키가 없으면 버튼을 눌렀을 때 BE의 404(problem+json)가 그대로 보인다 — 브라우저 이동이라 FE가 가로챌 수 없다. Safari는 `http://localhost`의 Secure 쿠키를 거부할 수 있어 로컬에서는 Chrome·Firefox로 확인한다.
- **화면:** `/login`·`/auth/callback`은 `components/shell/PublicLayout` 아래 셸(nav·메트로놈·연결 상태) 없는 전체 화면이다. 로그인 화면은 2분할 카드이고, 제공자 버튼은 `VITE_LOGIN_PROVIDERS`(쉼표 구분, 예 `google`)로 거른다. 미설정이면 google·ssafy 전부 보이므로 BE에 키가 없는 제공자는 빼 둔다.
- **프로필:** 상단바 우측 아바타(`components/shell/ProfileMenu`)를 누르면 닉네임·제공자 배지·로그아웃 메뉴가 열린다. 프로필 이미지가 없으면 닉네임 첫 글자를 보인다. 바깥 클릭·Esc로 닫힌다.

## 디버그

플레이 중 `` ` `` 키를 누르면 타격별 수신·판정·오디오 구간 지연을 보여주는 디버그 창이 열린다.

### 튜닝 (디버그 창)

디버그 창의 "튜닝" 구역(접힘이 기본)에서 센서 판정·세기 파라미터 9개를 플레이 중에 바꾼다. 바꾼 값은 다음 타격부터 반영되고 localStorage(설정 `tuning`)에 저장된다. 재캘리브레이션은 필요 없다 — 판정 프로필은 배치(kitLayout)와 각도 범위에서 유도한다(설계 `SETUP-unified-setup.md` D1). 반경은 현재 튜닝으로 매번 다시 계산한다.

| 값 | 기본값 | 범위 | 의미 |
| --- | --- | --- | --- |
| `radiusFactor` | 0.55 | 0.30~0.80 | 앵커 반경 = 가장 가까운 앵커 거리 × 계수 |
| `maxRadiusDeg` | 22 | 8~40 | 반경 상한(°). 세팅 화면의 "판정 반경 상한"과 같은 값 |
| `velocity.minAccelG` | 0.8 | 0.2~4 | 이 가속도(g) 이하는 벨로시티 1 |
| `velocity.maxAccelG` | 8 | 2~32 | 이 가속도(g) 이상은 127. min 이하로 내리면 min + 0.5 |
| `velocity.gamma` | 0.8 | 0.3~2 | 곡선 모양. 1 미만이면 약한 타격이 더 크게 |
| `sensorOffsetMs` | 0 | -150~150 | 센서 타격 시각에 더하는 값. 키보드 타격에는 적용 안 됨 |
| `outsidePolicy` | `mute` | `mute` / `nearest` | 앵커 반경 밖 센서 타격: 무음 / 가장 가까운 패드 |
| `angleRange.yawDeg` | 60 | 20~120 | 화면 가로 전체가 몇 도의 팔 움직임인지(±). 포인터 모의 IMU와 배치 → 판정 변환이 같이 쓴다 |
| `angleRange.pitchDeg` | 35 | 10~80 | 화면 세로 전체가 몇 도의 팔 움직임인지(±) |

- 기본값과 슬라이더 범위는 `src/domain/tuning.ts`(`DEFAULT_SENSOR_TUNING`, `TUNING_RANGES`)에만 있다. 실측값을 찾으면 여기만 고친다. 이미 저장된 값은 자동으로 덮어쓰지 않으므로 "기본값으로" 버튼으로 받는다.
- 기본값은 모두 **하드웨어(스틱) 도착 전 초안**이다. 포인터 모의 IMU로 동작만 확인했고 실측 전이다.
- 튜닝 값은 키 프리셋에 포함되지 않는다(기기·펌웨어별 값).

## 스틱 패킷 모니터 (EMB용, 숨김 주소)

스틱이 보내는 패킷을 판정 경로와 별개로 그대로 들여다보는 페이지. 주소는 `/monitor/stick`이고 네비게이션에 없다. 빌드 플래그 `VITE_MONITOR=true`일 때만 라우트가 등록된다(미설정 빌드에는 페이지 자체가 없다).

### EMB PC에서 띄우기 (BE 없이)

1. Node 24, `cd FE && npm install`
2. `FE/.env.local`에 세 줄:
   ```
   VITE_AUTH_REQUIRED=false
   VITE_SONGS_SOURCE=builtin
   VITE_MONITOR=true
   ```
3. 브리지 실행(다른 터미널): `pip install pyserial websockets` → `python EMB/tools/ws_bridge.py COM5` (기본 921600, `ws://localhost:8765`)
4. `npm run dev` → 브라우저에서 **세팅**(`/setup`) → 스틱 연결 "WebSocket 브리지" 선택 → `/monitor/stick`
5. 하드웨어가 없으면 모니터 상단 바의 **모의 스틱** 토글로 가짜 패킷을 흘려 화면을 확인한다(`monitor/mockStick`).

### 2스틱 WS 연동

브리지는 스틱 1개당 1개(포트 따로)다. 스틱 둘을 함께 쓰려면 브리지를 둘 띄운다.

1. `python EMB/tools/ws_bridge.py COM5` (왼손, `ws://localhost:8765`)
2. `python EMB/tools/ws_bridge.py COM8 --port 8766` (오른손)
3. 세팅 → WebSocket 브리지 → **오른손 브리지 주소**에 `ws://localhost:8766` 입력 → 입력 방식을 다시 선택

첫째 주소는 왼손, 둘째 주소는 오른손으로 고정한다. 링크마다 시계 동기화(SYNC)를 따로 하고, 명령은 손에 맞는 링크로 보낸다(손 지정이 없으면 두 링크 모두). 한쪽 링크만 연결에 실패하면 연결은 유지하고 상태 메시지로 경고한다. 오른손 주소를 비우면 지금처럼 링크 1개를 두 손이 함께 쓴다.

### 화면 구성

데이터 흐름 순서로 섹션을 나눴다. 왼쪽 사이드바 점은 단계 상태다(초록 정상 · 노랑 주의 · 빨강 이상 · 회색 데이터 없음, 점에 마우스를 올리면 이유).

| 섹션 | 위 지표 카드(필수) | 아래 접힌 패널(상세) |
| --- | --- | --- |
| 개요 | ①~⑥ 단계 상자(상태·대표 숫자·이유, 누르면 그 섹션) | — |
| ① 전송 | 마지막 수신 · 패킷 레이트 · POSE/HIT seq 유실 · CRC·재동기화 | 원시 hex·LOG, 브리지 통계 원본 |
| ② 센서 | STATUS 경과 · 거른 스윙 · ambiguous 비율, 그 아래 HIT 표 | POSE·자세 평면, 원시 파형(SWING), 세기 산점 |
| ③ 시계 | 채택 오프셋 · 오프셋 기울기 · SYNC rtt · 짝 실패 · futureMs | 동기화 추이 |
| ④ 판정 | 패드 판정 출처 비율 · 펌웨어 pad ≠ FE pad(최근 50건) · 바운더리 안 비율·판정 거리 중앙값 · 패드 없음 건수 | 세기 곡선(스틱 velocity → FE velocity 산점) |
| ⑤ 채점 | 세션 정보 줄 · 판정 카운트·점수·콤보·stray · delta 평균·표준편차(최근 50판정), 그 아래 최근 판정 목록(stray·무타격 표시) | delta 히스토그램(판정 창 띠 겹침) |
| ⑥ 출력 | 구간 지연 p50/p95(센서→수신·수신→판정·판정→오디오·전체) · 오디오 base·output latency | 구간 지연 시계열 |
| 타격 추적 | 왼쪽 최근 타격 목록(최신순), 오른쪽에 고른 타격의 ① 전송 ~ ⑥ 출력 카드(없는 단계는 이유 표시), 같은 seq의 SWING 파형 | — |
| 제어 | 파라미터 표 · 명령 바 | — |

- ④ 판정·⑤ 채점·⑥ 출력은 `engine/diagTap`(진단 탭)을 같은 창에서 구독해 채운다. 판정·채점 결과는 연주 화면(`/play`·`/sheet`)이 `engine/diagReport`로 내고, 입력 소스가 낸 타격(resolved)은 `app/bootstrap`이 낸다. 구독자가 없으면 publish는 즉시 반환해 운영 빌드에 영향이 없다. 모니터와 연주 화면이 같은 창이 아니면 ⑤는 비어 있다 — 아래 "연주 창 따라보기"로 채운다.
- 상태 기준(임계값)은 `monitor/health.ts` 맨 위 `HEALTH_THRESHOLDS` 한 곳에 있다. 지금 값은 가정값이고 실기 기록을 보고 조정한다.
- 타격 추적은 ② HIT 표 행이나 ⑤ 판정 목록 행을 누르거나 사이드바 "타격 추적"에서 목록으로 고른다. 고른 타격은 사이드바 하단 카드로 남고(누르면 타격 추적으로 이동), ←/→로 이전·다음 타격으로 옮긴다. 모의 스틱 타격은 판정 경로 밖이라 ①②③만 채워지고 ④⑤⑥은 이유가 표시된다. 키보드·포인터 타격은 패킷이 없어 ④⑤⑥만 채워진다. "지우기"는 선택도 비운다.
- 마지막으로 연 섹션과 패널 펼침 상태는 브라우저에 기억한다. HIT 행을 누르면 ② 센서의 원시 파형 패널이 열리고 같은 hitSeq 스윙을 고른다.

### 핵심 수치 바와 도착 표현

- 상단 바 바로 아래 고정 띠(`pages/monitor/layout/KeyMetricsBar`)가 어느 섹션에서나 스틱 L·R의 SYNC 왕복(최근·중앙값), 도착(수신−정지) 중앙값, HIT 유실(최근 1분), 수신 패킷/초를 큰 글씨로 보인다. 값마다 상태 색(`monitor/health` 기준 재사용)과 작은 기준 표기가 붙고, 값이 없으면 "–"와 이유(스틱 없음·동기화 전)가 나온다. 1초마다 갱신하며 따라보기·재생에서도 같다.
- **도착(수신−정지)** = 수신 시각 − 보정 timestamp(ms)다. 내부 필드 `futureMs`(보정 timestamp − 수신 시각)의 부호만 반대로 보이는 것이고, 필드와 녹화 형식은 그대로다. 스틱별 최근 HIT 중앙값이 −11 ~ 0이면 정상(수신이 추정 정지 시각보다 조금 먼저), 0 초과면 주의(전송 지연), −20 미만이면 주의(너무 이름 — tsCorrUs·시계 확인), 최대 +20 초과면 이상이다. 기준은 `HEALTH_THRESHOLDS.clock`의 한 곳이고 HIT 표 색도 같은 기준을 쓴다.

### 녹화 재생

제어 섹션 "녹화 요약"의 **녹화 파일 열기·재생**으로 `.jsonl`을 열면 입력 방식이 "녹화 재생"으로 바뀌고, 요약을 보이면서 바로 재생을 시작한다(녹화 중에는 요약만).

- 재생 바(상단 바 아래): 재생/일시정지, 처음부터, 배속(1·2·4×), 진행 막대(경과/전체), 파일 이름, 닫기. 패킷·진단 줄을 원래 간격대로 흘리므로 ①②③ 섹션·파형·수치 바(모의 스틱 녹화), ④⑤⑥(키보드 녹화)가 녹화 때와 같은 모양으로 채워진다. 진단 줄이 없는 이전 형식 파일도 재생된다(④⑤⑥은 빈 채).
- 시각은 재생 시작 시점 기준으로 옮기고, 진단의 hit 시각 필드(`tHit`·`tRecv`·`tResolved`·`tAudio`)도 같은 차이만큼 옮긴다(따라보기와 같은 방식). 시계 오프셋은 녹화의 SYNC 송신(t0)·SYNC_ACK 짝(`monitor/syncPair`)에서 스틱별로 다시 구해(rtt 최소 표본, `(t0 + t2) / 2 − t1`) 도착·③이 채워진다.
- 재생 중에는 이 창의 센서 연결을 해제하고, 명령 송신·녹화·모의 스틱이 막힌다. "닫기"나 입력 방식 변경 시 화면 상태(패킷 로그·판정·선택)를 비우고 원래 입력 방식으로 돌아간다. "처음부터"도 화면 상태를 비우고 다시 시작한다. 구현은 `monitor/replay`(순수: 시간표·상태기·오프셋)와 `monitor/feed`의 `replay` 모드다.

### 연주 창 따라보기

연주 화면(`/play`·`/sheet`)을 띄운 채 다른 창에서 ④ 판정·⑤ 채점·⑥ 출력과 패킷을 실시간으로 본다. `VITE_MONITOR=true` 빌드에서만 동작한다.

1. 연주 창 상단 바의 **모니터 새 창** 버튼을 누른다(`/monitor/stick?follow=1`이 팝업으로 열리고 따라보기로 시작). 이미 열린 모니터는 상단 바 **입력 방식**에서 "따라보기"를 고르면 된다. "직접 연결"로 돌아오면 저장된 센서를 다시 연다.
2. 상단 바에 `연주 창: {소스} · 연결됨`이 보이면 정상이다. 연주 창이 없거나 hello(1초 주기)가 3초 넘게 없으면 "연주 창 없음". 연주 창이 여러 개면 가장 최근 hello를 보낸 창 하나만 따른다.
3. **같은 브라우저·같은 출처(origin)의 창끼리만** 된다(BroadcastChannel `ssaplash-monitor`). 다른 PC·기기에서는 볼 수 없다.
4. **읽기 전용**이다. 따라보기 중 이 창은 센서를 열지 않고(설정의 센서 종류는 그대로), 모의 스틱·명령 송신·파라미터 쓰기는 꺼진다. 소스 연결은 연주 창이 가진다.
5. 시각은 두 창의 `performance.timeOrigin` 차이만큼 옮겨 이 창 기준으로 보인다. 시계 오프셋·전송 통계는 연주 창이 hello로 보낸 값이다.

relay(`app/monitorRelay`) 비용은 모니터를 보지 않을 때 0이다. 모니터가 1초마다 보내는 `watch`가 있는 동안(마지막 watch 후 3초)만 packetTap·diagTap을 구독하고, 이벤트를 50ms마다 한 묶음으로 보낸다. watch가 끊기면 구독과 타이머를 모두 푼다. `/monitor` 경로의 창은 응답하지 않는다. `VITE_MONITOR` 미설정 빌드에는 relay·모니터 청크와 "모니터 새 창" 버튼이 들어가지 않는다.

### 동작 원리

- 입력 소스(WS·BLE·Web Serial)가 프레이밍을 벗긴 payload를 `input/packetTap`에 publish하면 `monitor/packetLog`가 구독해 `decodePacket`으로 풀고 링버퍼(2,000건)에 쌓는다. 판정 경로(`parsePacket` → `InputManager`)는 그대로 돌고, 모니터는 복제본만 본다. 모니터를 켜도 소리·판정 지연은 바뀌지 않는다.
- 통계는 1초 슬라이딩 창: 타입별 패킷/초, HIT·POSE seq 유실, 브리지 CRC(0x7E `BRIDGE_STATS`)와 직결 CRC(Web Serial `transportStats`), SYNC→SYNC_ACK 지연, `timestamp − 수신 시각`(미래 ms), LOG `drop`·`I2C REC`·`BOOT` 집계.
- 제어 섹션: GET_PARAMS → PARAM_ACK 14개 + 종료 표시(0x00). SET_PARAM 응답 500ms 대기. SET_PAD_TABLE·SET_YAW_OFFSET·RESET_POSE 적용 확인(0x20·0x21·0x22)은 명령 바에 쌓인다.
- 파라미터 기본값은 펌웨어별 표다(`stickParamDefault`). STATUS의 fwMajor가 0이면 NUCLEO, 1이면 Feather(nRF52840)이고 STATUS를 받기 전에는 Feather 표를 쓴다(스틱 2개의 fwMajor가 다르면 마지막 STATUS 기준). 차이는 minDecel 30/60, maxSwingMs 400/160, tsCorrUs 3000/800, velMax 1000/1200(NUCLEO/Feather)이다. "기본값 복원"은 이 표를 쓰고, 패널 머리글에 지금 쓰는 표를 보여 준다. 현재값은 항상 GET_PARAMS 결과다.
- 스틱 USER 버튼으로 정면 보정을 하면 요청 없이 PARAM_ACK 0x22가 온다. 열린 확인 창이 없을 때 온 0x22는 명령 바 확인 목록에 "스틱 버튼 정면 보정(요청 없음)"으로 기록된다(명령 응답과 구분).
- ② 센서 "IMU·바이어스" 항목: 스틱별 마지막 LOG `BIAS x y z`(0.1°/s)는 정상, `BIAS default`는 주의(부팅 때 흔들려 바이어스 기본값), `IMU FAIL`은 이상이다. 다음 `BOOT`에서 초기화된다. `drop short`는 기존 거른 스윙으로 집계하고, `hold still...` 등 그 밖의 LOG는 텍스트로 남는다.
- 동기화 추이(③ 시계 패널): SYNC_ACK의 `t0Ms`로 요청과 짝지은 왕복마다 관측 오프셋·rtt를 점으로, 소스가 채택한 오프셋을 계단선으로, POSE 유실률을 회색 막대로 그리며 120초/10분 전환·기울기 ms/분 요약. 세기 산점(② 센서 패널)은 HIT 최근 300건의 velocity × peakSpeed/decel/swingMs와 스피어만 상관을 그린다. 개요의 ③ 상자를 누르면 동기화 추이 패널이 열린 채로 이동한다.
- 모의 스틱(Feather fw 1.0 모사): LOG `BOOT 1.0 nrf52` 뒤 스틱별 `BIAS` 줄, STATUS 5초(fwMajor 1·배터리 없음), POSE 50Hz 13바이트(100번째마다 seq 1 건너뜀), HIT 1초(10번째마다 seq 건너뜀, 20번째마다 판정 애매, 50번째마다 19바이트 오류 패킷), `drop` LOG(`weak`·`slow`·`short`), BRIDGE_STATS 1초. GET_PARAMS·SET_PAD_TABLE 명령에는 PARAM_ACK로 답한다.

### 녹화 파일 (JSONL)

"녹화" → "정지"로 `stick-YYYYMMDD-HHMMSS.jsonl`을 내려받는다. CSV는 없다(EMB 재생 도구는 펌웨어 녹화 모드의 IMU CSV만 받는다).

| 줄 | 내용 |
| --- | --- |
| 1 | meta — `startedAt`(ISO), `source`(종류·주소), `firmware`(마지막 STATUS `major.minor`), `build`(마지막 `BOOT` LOG 원문), `profile`(패드별 중심·반경), `note` |
| 2~ | 패킷 — `t`(`performance.now()` ms), `dir`(`in`/`out`), `transport`, `stick`, `hex`, `decoded`(`decodePacket` 결과, 수신분만). 수신 순서 그대로, 송신·`bridgeStats` 포함 |
| 패킷 줄 사이 | 진단 — `{"kind":"diag","t":<ev.t>,"ev":{…t를 뺀 이벤트}}`. `resolved`·`judged`·`missed`·`session`·`notes`(diagTap 이벤트). 직접 연결·따라보기 모두 기록하고 패킷과 도착 순서대로 섞인다. `resolved`의 `tAudio`는 발행 뒤에 채워지므로 정지 시점에 직렬화한다 |

meta의 `inputMode`(`direct`/`follow`)는 녹화 시작 시점의 입력 방식이다. 되읽기(`parseJsonl`)는 `kind`가 없으면 패킷 행, `diag`면 진단, 그 밖의 `kind`는 건너뛰므로 이전 형식 파일도 그대로 읽힌다(진단은 없음).

#### 녹화 요약

제어 섹션의 "녹화 요약" 패널이 녹화의 구간 지연·SYNC rtt·채점 delta 분포를 표로 보여준다. 녹화 정지 직후 방금 녹화가 표시되고, "녹화 파일 열기"로 이전 `.jsonl`을 열 수 있다(읽기 실패 시 오류 문구 표시). "표 복사"는 Wiki에 붙여넣을 Markdown 표를 클립보드에 넣는다. 각 지표 옆 "기준"은 `HEALTH_THRESHOLDS`의 대응 값이다(rtt p50 ≤ `clock.rttWarnMs`, 판정→오디오 p95 ≤ `output.audioP95WarnMs`, 센서→오디오 p95 ≤ `output.totalP95WarnMs`, delta |평균| ≤ `score.deltaMeanWarnMs`). rtt는 송신 SYNC의 t0와 SYNC_ACK `t0Ms`를 packetLog와 같은 규칙(`monitor/syncPair`)으로 짝지어 구한다. 진단 줄이 없는 이전 파일은 패킷 수·rtt만 채워진다.

### 텔레메트리 전송 (ADMIN 진단)

스틱 연결 진단(지연·시계·연결 품질)용 HIT·STATUS 이벤트를 BE `POST /api/telemetry/batches`로 보낸다. 운영 모니터링이 아니라 ADMIN이 켠 동안만 도는 진단 수집이다. `VITE_MONITOR=true` 빌드에만 들어가고, 일반 빌드 번들에는 이 코드(`telemetry/*`)가 없다(bootstrap이 동적 import).

- **켜는 법**: 모니터 제어 섹션의 "텔레메트리" 패널에서 **켜기**. 켜기 값은 브라우저 localStorage 키 `airdrum.monitor.telemetry`(`1`/`0`) 하나이고, 같은 출처의 다른 창은 `storage` 이벤트로 따라간다(모니터 창에서 켜면 연주 창이 보낸다).
- **전송 조건**: 켜기 ∧ 로그인 사용자 role이 `ADMIN`. 로그아웃하거나 ADMIN이 아니면 멈추고, ADMIN 로그인이 복원되면 켜기 값에 따라 재개한다. 서버가 403을 주면 자동으로 끄고(저장소 값 `0`) 패널에 사유를 보인다.
- **이벤트 원천 창에서만 전송**: 이벤트는 센서를 연 창(연주 창 또는 직접 연결 모니터 창)에서 만들어 그 창이 보낸다. 따라보기 모니터 창은 이벤트를 만들지 않으므로 패널 카운터(이 창 기준)가 0이다.
- **전송 규칙 요약**: 큐 적재는 동기, 전송은 1초 타이머 또는 100건 도달 때 배치 하나(1~100건·128 KiB 이하, 동시 요청 1개, 타임아웃 5초). 큐 상한 1,000건·대기 TTL 10초, 넘치면 오래된 것부터 폐기하고 사유(`overflow`·`ttl`·`oversize`)별로 센다. 401은 refresh 뒤에도 그 배치를 다시 보내지 않고 폐기한다. 타임아웃·네트워크·5xx·429는 결과 불명으로 세고 같은 배치를 재전송하지 않으며 1·2·4초(최대 10초) 쉬었다 다음 배치를 보낸다(429는 Retry-After 우선). 끌 때와 페이지를 떠날 때(`pagehide`)는 남은 큐를 한 번 보내 보고(최선 노력) 끌 때는 큐를 비운다.
- **미확정**: BE 152번(수신 API) 병합 전이라 경로(`telemetry/sender.ts`의 `TELEMETRY_PATH`)와 오류 `code` 문자열은 확정 전이다. 지금은 HTTP 상태로만 분기하며, 병합 뒤 맞춘다.

## 프리셋

배치·사운드를 이름 붙여 저장한 것이 프리셋이다(최대 10개, 이름 1~50자·중복 불가, 기본 프리셋 1개). 저장소는 `domain/preset`의 `PresetSource` 인터페이스(`list`·`create`·`update`·`remove`·`setDefault`, 오류는 `PresetError.code`) 뒤에 있고 구현이 둘이다.

- **서버(`api/presets`의 `ServerPresetSource`)** — 로그인 상태에서 쓴다. BE README "키트 프리셋" API(`/api/presets`)를 `apiFetch`로 부른다. 응답 `id`(숫자)는 문자열로, `sounds.soundSetId`는 `soundSetId`로 올리고 모르는 세트 id는 `ssaplash`로 보정한다. 본문은 `name`·`layout`·`sounds`·`schemaVersion`뿐이며 `calibration`은 보내지도 읽지도 않는다(공통 명세서 미결 #23, 10/22: 캘리브레이션은 기기·세션 값). 오류는 `PRESET_NAME_DUPLICATE → NAME_DUPLICATE`, `PRESET_LIMIT_EXCEEDED → LIMIT_EXCEEDED`, `PRESET_NOT_FOUND → NOT_FOUND`, `PRESET_CONFLICT → CONFLICT`, 그 밖(네트워크·5xx·다른 4xx) → `NETWORK`.
- **로컬(`store/localPresetSource`)** — `settingsStore.presets[]`(localStorage). 익명 상태에서만 쓴다. 운영 빌드는 `/setup`이 로그인 뒤라 사실상 `VITE_AUTH_REQUIRED=false` 개발 빌드 전용이다. 로그인해도 로컬 프리셋을 서버로 옮기지 않는다(10/23 합의).

어느 저장소를 쓸지는 `app/presetBootstrap`이 `authStore.status`를 구독해 정한다. `authenticated`면 서버, `anonymous`면 로컬, 복원 중(`unknown`·`restoring`)이면 기다린다. 저장소를 바꾸면 목록을 다시 읽고 적용 프리셋(`activePresetId`)을 맞춘다 — 목록에 있으면 유지, 없으면 기본 프리셋 적용, 기본도 없으면 비움. 읽기에 실패하면 `status = 'error'`만 남기고 적용 프리셋은 두지 않는다. 전환은 순서대로 처리되고 같은 상태가 다시 와도 다시 읽지 않는다. 로그아웃·세션 만료로 `anonymous`가 되면 서버 목록은 비워지고 로컬로 돌아간다.

화면은 `presetStore`(`items`·`status`·`error`, 액션 `refresh`·`apply`·`saveChanges`·`saveAs`·`setDefault`·`remove`)만 부르며, 실패하면 `status = 'error'`·`error = 코드`만 바꾸고 편집 중인 `kitLayout`·`soundSetId`는 건드리지 않는다. 서버는 첫 프리셋도 기본으로 만들지 않으므로 `saveAs`가 생성 뒤 `setDefault`를 한 번 더 부른다. 변경 여부(`dirty`)는 상태가 아니라 `selectDirty(settings, presets)`로 현재 편집값과 적용 프리셋을 비교해 얻으며, 적용 프리셋이 없으면 저장할 것이 있는 것으로 보아 true다.

## 사운드 세트

패드 소리는 사운드 세트가 정한다. 세팅 화면의 "사운드 세트"에서 `SSAPLASH 키트`(샘플)와 `합성음(임시)`을 고르며 선택은 설정(`soundSetId`)에 저장된다.

- 샘플 세트는 `public/sounds/<id>/kit-config.json`과 `audio/*.wav`를 읽는다. 패드별 게인·재생 속도는 코드가 아니라 이 JSON이 정한다. 키트를 교체하려면 파일과 JSON만 바꾼다. 키트 항목 → 패드 매핑표는 `src/audio/kitConfig.ts`에 있다(`high`=스몰탐, `mid`=미드탐). 샘플이 없는 패드는 `audio/soundSets`의 폴백표를 따라 다른 패드 샘플을 작게 쓴다(하이햇 페달 → 하이햇 0.7배), 폴백도 없으면 합성음.
- 첫 소리(오디오 언락) 이후에 샘플을 불러온다. 불러오는 동안과 파일 하나가 실패한 패드는 합성음으로 울린다. 한 번 불러온 세트는 다시 고를 때 재다운로드하지 않는다.
- 세기는 게인으로 반영한다(`패드 게인 × 키트 masterVolume × v^1.4`). 사용자 볼륨 슬라이더는 마스터 게인에 따로 곱해진다.
- 세팅 화면에서 패드를 톡 치면(이동 6px 이내) 소리와 타격 이펙트가 나온다. 이 타격(`source: 'preview'`)은 텔레메트리·통계에 남지 않는다.

## 메트로놈·사운드 토글

상단 바에 전역 메트로놈 칩(비트 점 · BPM · 재생/정지)과 "패드 소리" 스위치가 있다. 스케줄러는 `engine/Metronome` 싱글턴이고, 칩(`components/shell/Metronome`)은 `liveStore.metronome`을 읽고 엔진 메서드만 부른다.

- 칩의 ▶/■는 재생·정지, 칩 본체를 누르면 팝오버가 열린다(바깥 클릭·Esc로 닫힘). 팝오버: BPM 슬라이더(40~240)·`-5/+5`·박자(4/4 · 3/4)·탭 템포.
- 탭 템포는 버튼을 누를 때마다 최근 최대 8번의 평균으로 BPM을 정한다(2번째 탭부터 반영). 2초 이상 쉬면 새로 센다. 첫 박은 악센트(높은 음, 점 색 다름).
- 재생 중 페이지를 이동해도 유지된다(엔진이 React 밖 싱글턴, 칩은 `AppShell`에 있음). 새로고침 후에는 정지 상태로 시작한다.
- 리듬 게임·악보 연습에서 세션을 시작하면 메트로놈이 곡에 잠긴다(`Metronome.lock`): 칩이 곡 BPM·박자와 "곡" 배지를 보이고 슬라이더·박자·탭 템포는 비활성이며, 점은 세션이 `pulse`로 알리는 박에 깜빡이고 ▶/■는 세션 클릭(`settings.metronome`)을 켜고 끈다.
- 세션이 끝나거나 나가면 `unlock`으로 사용자 BPM·박자(정지 상태)로 돌아온다. 잠금 중 값은 설정에 저장되지 않는다.
- 사운드 토글은 패드 소리만 음소거한다. 메트로놈 클릭은 계속 난다.
- 설정 `metronomeBpm`·`metronomeBeatsPerBar`·`soundOn`이 localStorage에 저장된다.
- 개발 모드에서는 콘솔에서 `window.__metronome.stats`(`scheduled`·`late`·`maxDriftMs`)로 예약 지터를 읽을 수 있다.

## 키보드 입력(임시)

키보드는 스틱이 오기 전까지의 임시 입력이다. 키 매핑 카드는 10/22에 제거했고 매핑은 `domain/keyMap.ts` 상수 하나다. 환경변수 `VITE_KEYBOARD_INPUT=false`로 빌드하면 키 안내와 키보드 소스 등록이 함께 빠진다(기본은 켜짐, 예시는 `.env.example`). 안정화 후에는 `keyboardSource`·`domain/keyMap.ts`를 지운다.
