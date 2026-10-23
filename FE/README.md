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
│   └─ presetBootstrap.ts 로그인 상태(authStore) → 프리셋 저장소(서버/로컬) 전환, 목록 읽기, 기본 프리셋 적용
├─ pages/      라우트 단위 화면 — Home · Setup · Play · FreePlay · Result · Login · AuthCallback
├─ components/ 공용 UI — AppShell · RequireAuth · SensorOptionsPanel · KitCanvas · NoteHighway · DebugOverlay · PublicLayout · ProfileMenu · SongPicker(곡 선택) · useChartParam(URL 곡 선택 훅) · SheetStrip(5선 악보 Canvas) · sheetStripDraw(그리기 순수 함수) · SheetSnippet(결과 페이지 약점 마디 미니 악보) · PauseOverlay(일시정지) · usePauseTriggers(끊김·메뉴 자동 일시정지 훅)
│   └─ shell/        상단 바 공용 위젯 — Metronome(칩·팝오버) · SoundToggle · PublicLayout · ProfileMenu
├─ store/      zustand — settingsStore(영속) · liveStore(실시간) · presetStore · localPresetSource · authStore(로그인 상태, 영속 안 함) · songStore(곡 목록·상세·`loadChart`)
├─ api/        BE 호출 — http(공통 래퍼·ApiError) · auth(access 토큰·refresh·logout) · users(me) · songs·charts(곡·채보 조회, BE 96) · presets(프리셋 CRUD, BE 90 — PresetSource 서버 구현)
├─ input/      입력 소스와 매퍼 (인스턴스는 만들지 않는다 → app/sensorRegistry · app/sources)
│   ├─ InputSource         공통 인터페이스 · ClockSync
│   ├─ SourceDescriptor    입력 소스 디스크립터 타입 (id·라벨·설정 항목·동작 버튼 선언)
│   ├─ KeyboardPadSource   키 코드 타격 (항상 켜짐)
│   ├─ PointerStickSource  마우스 위치 → 자세, 키/클릭 → 타격 (모의 IMU) + 디스크립터
│   ├─ BleStickSource      Web Bluetooth GATT + 디스크립터
│   ├─ WebSocketStickSource  허브 · PC 브리지 + 디스크립터
│   ├─ stickProtocol       BLE/WS 공용 바이너리 패킷
│   ├─ padMapper           키 매퍼(keyMap) · 자세 매퍼(배치에서 유도한 판정 프로필)
│   └─ InputManager        소스 합성 → 매퍼 → ResolvedHit 발행
├─ engine/     ReferenceCapture · RhythmSession(일시정지 포함) · playLog · telemetry
├─ audio/      AudioEngine · soundSets(사운드 세트) · kitConfig(kit-config.json 스키마)
├─ domain/     순수 타입·함수. React·브라우저 API 의존 없음 (단위 테스트 대상)
│   pads · kitLayout · preset · events · keyMap · calibration · kitMapping · chart · songCatalog(곡 타입·난이도 정렬) · chartMapping(BE 채보 → Chart) · judgement · hitStats · auth
└─ styles/     전역 CSS
```

예약 폴더(첫 파일이 생길 때 만든다): `hooks/` 페이지 공유 훅, `assets/` 이미지·샘플.

### 의존 방향

위에서 아래로만 import한다. 같은 줄끼리는 import하지 않는다.

| 층 | 폴더 | import 허용 |
| --- | --- | --- |
| 조립 | `app`, `main.tsx` | 전부 |
| 화면 | `pages` | hooks · components · store · engine · audio · domain · app(인스턴스·언락) |
| 공용 UI | `components`, `hooks` | store · engine · audio · domain (+ `app/sensorRegistry` 조회만: AppShell · SensorOptionsPanel) |
| 상태 | `store` | domain · api |
| 코어 | `input`, `engine`, `audio`, `api` | domain |
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

옛 이름(`HI_TOM` → `SMALL_TOM`)은 `normalizePadId`·`normalizePadKeys`가 한 곳에서 변환한다. 서버 채보(`chartMapping`)·서버 프리셋(`api/presets`)·설정 마이그레이션(v10)·플레이 로그 로드가 이 함수를 거치므로 BE·AI 데이터가 옛 이름이어도 깨지지 않는다. 부족한 패드 배치는 `kitLayout.fillLayout`이 기본값으로 채운다. 프로토콜 패드 번호(0~8, EMB v0.7)는 화면 순서와 별개로 `input/stickProtocol`에 둘 예정이다(스틱 프로토콜 갱신 작업에서 추가).

## 입력 구조

- **소스**는 "어느 스틱이 언제 얼마나 세게 어떤 자세로 쳤는가"만 낸다. 어느 패드인지는 모른다.
- **매퍼**가 패드를 정한다. 키보드 타격은 키 매퍼(고정 키), 센서 타격은 자세 매퍼(배치에서 유도한 판정 프로필).
- **키보드는 항상 켜져 있고**, 센서 소스는 세팅에서 하나만 고른다(없음 / 레지스트리에 등록된 소스: 포인터 모의 IMU · BLE · WebSocket). 센서를 켜도 Space 킥과 키보드 타격은 그대로 동작한다.
- 하드웨어가 오면 BLE 소스 연결을 검증하고 기준 자세 보정으로 시작 위치를 맞추면 된다. 고정 키·소리·게임 코드는 바뀌지 않는다.

## 새 입력 소스 추가 방법

센서 소스를 추가하는 데 필요한 변경은 파일 1개와 등록 1줄이다. 세팅 화면 목록·설정 패널·라벨 표시는 디스크립터를 읽어 자동으로 따라온다.

1. `src/input/` 에 소스 파일을 만든다(예: `SerialStickSource.ts`). `BaseInputSource`를 상속한 클래스와, 파일 끝에 `SourceDescriptor` 상수를 export 한다.
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
- **플레이 로그:** `chartVersionId`·`songNumericId`·`chartId`(다시 하기 URL용)·`presetId`가 같이 저장된다. 내장 곡은 null.

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

리듬 게임은 내장 채보 3곡을 고른 뒤 Enter로 시작한다(1마디 카운트인). 일시정지는 Esc·스틱 연결 끊김·메뉴 요청 3종이고(`PauseOverlay`, 악보 연주와 같은 정책) 그동안 노트가 멈추며 재개·처음부터·나가기(준비 화면)를 고른다. 곡이 끝나면 결과 화면으로 가며 플레이 로그는 localStorage에 최근 20건 남는다. 결과에서 Enter는 같은 곡 다시 하기.

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
- **로그아웃:** 상단바 아바타 메뉴의 "로그아웃" → `POST /api/auth/logout`(204) → 메모리 토큰 폐기 → `/login`.
- **오류 코드(`/login?error=`):** BE가 붙이는 `access_denied`(동의 취소)·`oauth_failed`, FE가 붙이는 `no_session`(콜백 뒤 refresh 실패)·`session_expired`·`network`(서버 연결 실패). 문구는 `domain/auth.ts`에 있다.
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
