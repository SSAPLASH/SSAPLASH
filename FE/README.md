# FE — SSAPLASH 웹 클라이언트

에어드럼 리듬 게임의 브라우저 클라이언트. 센서(IMU 스틱)가 오기 전에는 키보드와 포인터 모의 IMU로 세팅·기준 자세 보정·게임 흐름을 개발한다.

## 스택

| 항목 | 선택 |
| --- | --- |
| 프레임워크 | React 19 + TypeScript, Vite |
| 상태 | zustand (설정은 localStorage에 영속), 서버 데이터 캐시는 TanStack Query |
| 화면 | Canvas 2D (키트·노트 레인), Web Audio (발음) |
| 센서 연결 | Web Bluetooth (BLE 직접), WebSocket (브리지 대안) |
| BE 연동 | `fetch` 공통 래퍼(`api/http`). 로그인은 BE OAuth + refresh 쿠키, access 토큰은 메모리 |
| 모션 | motion — `LazyMotion`(features 지연 로드, `strict`)이라 컴포넌트는 `m.*`만 쓴다(`motion.*` 금지). 공급자는 `app/MotionProvider`, 모션 줄이기 설정도 여기서 처리 |
| 팝오버 등 | Radix UI(`@radix-ui/react-popover`) — 스타일 없는(headless) 라이브러리. 모양은 기존 토큰 CSS로 입힌다 |
| PDF | pdf.js(`pdfjs-dist`) — 악보 뷰어 라우트에서만 지연 로드(뷰어 페이지·pdf.js·worker가 메인 번들과 따로 나뉜다) |
| 검사 | oxlint, vitest, testing-library(상호작용 테스트, happy-dom) |

Node 20 이상, npm 사용.

## 실행

```bash
npm install
npm run dev        # http://localhost:5173
```

로그인이 필요하므로 BE도 함께 켠다(`BE/README.md` 로컬 실행: PostgreSQL·Redis·`.env`). 개발 서버는 `/api` 요청을 `VITE_API_PROXY_TARGET`(기본 `http://localhost:8080`)으로 넘겨 운영처럼 같은 출처가 된다.

BE 없이 게임 화면만 만질 때는 `.env.local`(git 무시)에 두 줄 둔다. 모든 화면이 로그인 없이 열리고(상단바에 로그인 표시도 사라진다) 곡은 내장 3곡만 쓴다.

```bash
VITE_AUTH_REQUIRED=false
VITE_SONGS_SOURCE=builtin
```

두 플래그 모두 곡 선택과 리포트의 추천 곡·약점 연계 연습 줄을 끈다(요청도 나가지 않는다). 내장 곡 소스에는 추천 API가 없고, 로그인 검사를 끄면 인증 상태가 `authenticated`가 되지 않는다.

리포트의 약점 연계 연습은 분석이 `DONE`인 뒤 `DRILL` 추천을 최대 3곡 요청한다. 빈 결과·오류·5초 초과는 숨기며 카드 선택 시 추천 채보로 이동한다. 기존 추천 곡·비슷한 곡은 별도로 유지한다.

## 검증 (커밋 전 모두 통과)

```bash
npm run lint       # oxlint
npm test           # vitest — domain·input 순수 로직 단위 테스트
npm run build      # tsc 타입 검사 + vite 번들
npm run measure    # build 뒤 첫 로드 JS gzip 합계 확인 (예산 235kB, 넘으면 exit 1)
```

`npm run measure`는 `dist/index.html`의 entry 스크립트와 modulepreload JS를 읽어 파일별 raw·gzip 크기와 합계를 찍는다(`scripts/measure-first-load.mjs`). CI에는 연결하지 않은 로컬 확인용이다. 화면이나 셸에 정적 import를 추가해 합계가 늘면 아래 「코드 분할」 규칙대로 지연 로드를 먼저 검토한다.

### 상호작용 테스트

기본 테스트 환경은 node(`renderToStaticMarkup` 스타일)다. 클릭·포커스 같은 상호작용은 파일 단위로 happy-dom을 쓴다.

- 파일명은 `*.interaction.test.tsx`, 첫 줄은 `// @vitest-environment happy-dom`.
- `@testing-library/react`(`render`·`screen`)와 `@testing-library/user-event`(`userEvent.setup()`)를 쓴다.
- vitest globals를 켜지 않았으므로 자동 cleanup이 없다. 파일마다 `afterEach(cleanup)`을 둔다.
- **Node 22 이상(특히 26)에서 localStorage 테스트가 `Cannot read properties of undefined (reading 'setItem')`로 깨지면** Node의 실험적 webstorage 전역이 happy-dom의 `localStorage`를 가린 것이다. `NODE_OPTIONS=--no-experimental-webstorage npm test`로 돌린다. CI(낮은 Node)에는 없는 문제다.
- happy-dom은 Web Animations를 완전히 지원하지 않는다. `animate` 등으로 실제 애니메이션을 돌리는 컴포넌트를 테스트하면 cleanup 시 `AbortError`(unhandled rejection)가 날 수 있으니, 애니메이션 값이 아니라 상태·DOM 결과를 검증한다.
- 예시: `src/app/MotionProvider.interaction.test.tsx`

### 열린 하이햇 악보와 로컬 결과

채보의 HIHAT `hihatOpen: true`는 악보와 결과 미니 악보에 원으로 표시한다. 연결된 페달을 밟고 열린 노트를 정확히 치면 원을 400ms 강조하며, 점수와 타이밍 판정은 바꾸지 않는다. 페달 스냅샷은 보정 전 타격 시각으로 조회하고, 서버 플레이 업로드 형식에는 추가하지 않는다.

악보 연습 결과의 열린 하이햇 수치는 연주 시작 시 페달이 연결되고 상태를 알고 있었으며 끝까지 관측된 경우에만 표시한다. 중간 연결·끊김이나 열린 노트 타격 상태 미상은 측정 불완전으로 표시한다. 일시정지 중 끊긴 경우도 불완전으로 기록한다. 연결되지 않은 연주와 구 로그에는 수치를 표시하지 않는다. 중도 종료 결과의 분모는 전체 채보 기준이다.

### 실시간 코칭 문구

연주 중 코칭은 "옆에 앉은 드럼 선생님"처럼 말한다(설계 COACH-001). 화면 문구는 모두 `src/coach/live/copy.ts`의 문구 표에서만 고친다(모듈의 `text`는 플레이 로그 전용).

- 행동을 먼저 말한다: 제목은 구령("스틱을 낮게"), 이유·방법은 보조 줄. 지적 구령은 8자, 칭찬·세팅 13자, 보조 16자 이내.
- 상태 알림·격려("놓쳤어요", "놓친 건 잊어요")보다 몸의 어디를 어떻게 할지와 따라 할 기준을 말한다: 늦음 "스틱을 낮게 / 높이는 주먹 하나만큼", 빠름 "힘 빼고 떨궈요 / 스틱 무게로 떨어뜨려요", 박 흔들림 "입으로 세요 / 하나 그리고 둘 그리고", 연속 놓침 "킥·스네어만! / 박이 잡히면 다시 다 쳐요". 원인 보조는 "빠른 곳은 양손 번갈아 쳐요", "스네어 치며 스몰탐을 봐요", "마디 첫 박에 다시 맞춰요". 지시 어휘는 QA 전 가정이다.
- 키보드 입력이면 스틱 전용 지시(스틱 높이, 손목, 떨구기)를 쓰지 않고 손가락과 키 이름으로 말한다: 늦음 "키 위에 손가락 / 손가락을 키에 올려 둬요", 빠름 "닿을 때 눌러요 / 노트가 선에 닿을 때 눌러요", 패드만 늦음 "F·J 키에 손가락 대기", 다른 패드 원인 "스몰탐은 E·I 키예요", 빠른 구간 원인 "빠른 곳은 손가락 번갈아요".
- 말투는 "~해요" 존댓말. 점수·정확도 언급, "틀렸어요/못" 단정, 영어는 쓰지 않는다(`copy.test.ts`가 길이·금지어를 검사한다).
- 바쁠 땐 구령만: 리듬 게임은 직후 1초에 노트가 4개 이상이면 최대 1.5초 미루고, 그래도 바쁘면 보조 없이 띄운다(`features/play/components/stage/coach/coachDisplay.ts`). 악보 연습은 미루지 않고 항상 보조까지 보인다.
- 가리키며 말한다: 패드 대상이면 키트의 그 패드에 링(`DrumKit`의 `coachPad`), 손 대상이면 킷 왼쪽 아래에 왼손/오른손 칩. 문구와 함께 사라진다.
- 칭찬은 근거가 있을 때만: 해소 칭찬은 무엇이 고쳐졌는지 보조로 말하고(`CoachMessage.recoveredFrom`), 일반 칭찬(`LIVE_GOOD_KEEP`)은 직전 문구 후 20초·최근 12판정 놓침 0일 때만 뜬다(`config.ts`의 `praise.keepMinGapMs`).

## 폴더 구조

「공유는 층으로, 기능은 한 폴더로」 나눈다(설계 TECH-fe-feature-scaffolding, Jira 364). 한 기능만 쓰는 코드는 `features/기능/` 안에 화면·부품·상태·API 호출·순수 로직을 함께 두고, 여러 기능이나 app이 쓰는 코드와 계층 간 공용 계약은 `src` 바로 아래의 층 폴더에 둔다. `pages/` 폴더는 없다 — 화면 파일(`XxxPage.tsx`)은 기능 폴더에 있다.

### 구조도

```
src/
├─ main.tsx              Vite 엔트리
├─ app/                  조립 — 라우터·지연 로드 표·시작 접착(bootstrap)·프로바이더·AppShell. 전부를 import할 수 있는 유일한 곳
├─ config/               값·순수 함수 — AUTH_REQUIRED(auth)·개발용 반주 URL(accompaniment)·미리 받기 지연값(prefetch)·청크 복구(chunkRecovery). 누구나 import, 자신은 다른 폴더를 모른다
│
├─ features/             기능 폴더 — 서로 import하지 않는다
│   ├─ play/             리듬 게임·악보 연습 (곡 선택 → 시작 확인 → 연주)
│   │   ├─ PlayPage.tsx · SheetPage.tsx
│   │   ├─ components/   연주 흐름 부품 (picker/ 곡 선택 (+ guide/ 안내 줄·lesson/ 학습 코스), start/ 시작 확인 창, stage/ 연주 화면, pause/ 일시정지, diag/ 진단 자동 연주)
│   │   ├─ domain/       이 기능만 쓰는 순수 로직
│   │   ├─ api/          이 기능만 쓰는 BE 호출
│   │   └─ *.ts          화면 접착 훅(useBestRecords · hapticMode …)
│   ├─ setup/            드럼 세팅·위치 보정 (components/ + components/calibration/)
│   ├─ free/             자유 연습·반주 (components/ 무대 부품, domain/ 키트 가이드 이름표)
│   ├─ studio/           라이브러리 — 곡 올리기·채보 생성·악보 보관·악보 뷰어 (components/ 아래 songs/·upload/·sheet/·accompaniment/, store/, api/, domain/, media/)
│   ├─ result/           결과·상세 리포트·곡 추천 (components/ + components/report/)
│   ├─ history/          연주 기록 — 플레이 기록 탭·녹음 목록 탭
│   ├─ lesson/           학습 코스 알아보기 레슨 화면
│   ├─ mini/             미니게임 — 목록·게임 화면 (components/ 공용 부품 + 게임별 components/speed/·dynamics/·sight/·tempo/·oneshot/, store/ 최고 기록, domain/ 집계·기록·단계)
│   ├─ settings/         설정
│   ├─ landing/          랜딩·로그인·가입 동의 (components/ + components/auth/, domain/)
│   ├─ admin/            공용 곡 관리(관리자)
│   ├─ monitor/          스틱 패킷 모니터(EMB용) — 화면 + core/(판정 경로와 분리된 수집·분석) · layout/ · sections/
│   └─ dev/              개발 전용 화면(FX 랩)
│
├─ components/           공유 UI — 여러 기능·app이 쓰는 부품과 디자인 시스템. 바로 아래에 파일을 두지 않는다
│   ├─ ui/               디자인 시스템(Figma 01). store·domain·api를 모른다
│   ├─ shell/            앱 셸 — Sidebar · TopBar · GlassDock · RequireAuth · RouteErrorBoundary · NotFoundPage
│   ├─ metronome/        메트로놈 박 분할 선택(Dock 패널·시작 확인 창이 같이 씀)
│   ├─ song/             곡 표시·재생 조작 — SongCover · SeekBar · PlaybackTransport · StudioIcons
│   ├─ drum/             드럼 킷 그리기 — DrumKit · Pad
│   │   └─ acoustic/     실물 스킨 — 이미지 패드(AcousticPad) · 조각 이미지 표(sprites) · persp/·top/*.webp(도구가 만든 조각, 원근·위에서 본 그림)
│   ├─ fx/               타격 이펙트
│   ├─ stick/            자유 연습과 연주가 쓰는 끊김 표시 CSS
│   ├─ calibration/      재정렬·박자 맞추기 창(세팅·설정·연주가 같이 씀)
│   ├─ recording/        녹음 버튼·저장 창·저장 토스트(셸이 얹는다). 녹음 목록은 features/history
│   ├─ lesson/           학습 코스 초대·악보 표기와 공용 스타일
│   └─ sheetmusic/       악보 띠 그리기(연주·결과가 같이 씀)
├─ runtime/              앱에 하나뿐인 인스턴스·세션 — 입력 소스(sources·sensorRegistry·sensorSession·reconnectPolicy)·타격음 스위치(hitSound)·공통 조회 훅(useApiQuery)·쿼리 캐시(queryClient)·녹음(recordingStore·recordingSync)·업로드(playSync)·보정(calibrationSession·timingCalSession)·박 분할 예시 소리(metronomePreview)·키보드 드럼·오디오 켜기(audioUnlock)
├─ store/                공유 상태(zustand) — settings · live · auth · shell · preset · song …
├─ api/                  BE 호출 — 바로 아래는 http·error 공통 래퍼만, 나머지는 account/ · kit/ · song/ · play/
├─ input/                입력 소스와 매퍼
├─ engine/               판정·세션·플레이 로그
├─ audio/                오디오 엔진·사운드 세트·반주
├─ coach/                실시간 코칭 규칙(live/)
├─ telemetry/            진단 수집·전송
├─ domain/               공유 순수 타입·함수 (React·브라우저 API 의존 없음). 바로 아래에는 events만, 나머지는 kit/ · song/ · time/ · play/ · account/ · hitFx/
├─ styles/               tokens.css · motion.css · global.css
└─ test/                 구조 테스트(architecture.test.ts)·테스트 보조

scripts/
└─ kit-art/              실물 드럼 조각 이미지·자리 표(domain/kit/kitArt.ts)를 만드는 개발용 Python 도구. 원본 그림이 바뀔 때만 돌리며 원본 이미지는 커밋하지 않는다

public/
├─ fonts/                Space Grotesk · Bebas Neue 로컬 폰트(OFL 라이선스 파일 동봉)
└─ sounds/               사운드 세트
```

### 기능 폴더와 에픽

폴더 이름은 에픽 prefix가 아니라 코드가 쓰는 기능 이름이다. 에픽·스토리와는 이 표로 잇는다.

| 기능 폴더 | 화면(라우트) | 대응 에픽·스토리 |
| --- | --- | --- |
| `features/play` | `/play` · `/sheet` | PLAY · MODE-001 · MODE-003 · COACH-001(화면) |
| `features/setup` | `/setup` | SETUP · PLAY-004 |
| `features/free` | `/free` | MODE-002 |
| `features/studio` | `/studio` · `/studio/sheets/:id` | CHART |
| `features/result` | `/result/:playId` · `/result/:playId/report` | COACH-002 · COACH-004 |
| `features/history` | `/history` | COACH(기록 조회) · REC(녹음 목록) |
| `features/lesson` | `/sheet/lesson/:songId` | 학습 코스 알아보기 레슨(331) |
| `features/mini` | `/play/mini` · `/play/mini/speed` · `/play/mini/dynamics` · `/play/mini/sight` · `/play/mini/tempo` · `/play/mini/crescendo` · `/play/mini/oneshot`(이벤트 빌드만) | MODE-006 미니게임(405~410, 「어디까지 올라가는 거예요?」) |
| `features/settings` | `/settings` | ACCT |
| `features/landing` | `/` · `/login` · `/signup` · `/welcome` · `/auth/callback` | ACCT · UX-353 |
| `features/admin` | `/admin/songs` | 공용 곡 관리(262) |
| `features/monitor` | `/monitor/stick` | MONITOR |
| `features/dev` | `/dev/fx` | — |

### 어디에 둘까

- **쓰는 기능이 하나면 그 기능 폴더, 둘 이상이면 공유 층.** 미리 공유 자리에 두지 않는다. 두 번째 기능이 쓰게 되는 순간 공유 층으로 옮기고, 옮기는 커밋은 따로 둔다.
- **기능 폴더 안은 `src`의 축소판이다.** 화면 파일은 기능 폴더 바로 아래, 그 밖은 `components/`·`store/`·`api/`·`domain/`(필요한 것만). 모든 소스 폴더에서 바로 아래 프로덕션 `.ts`·`.tsx` 파일이 15개를 넘으면 응집도에 따라 하위 폴더 분리를 검토한다(테스트·CSS 제외, CI 강제 규칙 아님).
- **새 기능 폴더**는 자기 화면(라우트)이 있을 때 만든다. 화면 없이 여러 기능이 쓰는 묶음은 `components/이름/` 공유 폴더로 둔다(`recording`·`lesson`처럼). 공유 부품의 CSS는 부품 옆 파일로 둔다(`components/ui/action/Button.css`·`components/song/SeekBar.css`) — 기능 CSS 파일에 넣지 않는다.
- **새 화면**은 `features/기능/XxxPage.tsx`로 만들고 `app/routeModules` 표와 `app/App.tsx`에 연결한다.
- 폴더별 `index.ts`(배럴)는 두지 않는다. 테스트와 CSS는 소스 옆에 둔다(CSS 클래스 접두사는 원래 폴더 이름을 유지한다, 예 `studio-`·`play-`).
- `common`·`types`·`utils` 폴더는 두지 않는다. 기능 폴더 밖이 곧 공통이고, 타입은 쓰는 파일 옆에 둔다.

### 의존 방향

위에서 아래로만 import한다.

| 층 | 폴더 | import 허용 |
| --- | --- | --- |
| 조립 | `app`, `main.tsx` | 전부 |
| 기능 | `features/*` | 공유 UI · runtime · 공유 상태 · 코어 · 도메인 · config. **다른 기능 폴더는 금지**. app도 금지 |
| 공유 UI | `components/*` | runtime · store · engine · audio · domain · config. 기능 폴더와 app은 금지 |
| 런타임 | `runtime` | store · 코어 · domain · config. 기능·app·공유 UI는 금지 |
| 상태 | `store` | domain · api · config |
| 코어 | `input`, `engine`, `audio`, `api`, `coach`, `telemetry` | domain · config |
| 도메인 | `domain`, `features/*/domain` | 다른 domain 파일만(패키지도 안 된다). 기능 domain은 공유 domain과 같은 기능의 domain만 |
| 설정값 | `config` | 다른 config 파일만 |

- **구조 테스트가 규칙을 검사한다**(`src/test/architecture.test.ts`, `npm test`에 포함). R1 기능끼리의 import, R2 공유 층(runtime·config 포함)에서 기능·app으로 가는 import, R3 domain에서 domain 밖·패키지로 가는 import, R4 `components/ui`에서 store·domain·api로 가는 import, R5 config에서 config 밖으로 가는 import, R6 runtime에서 공유 UI로 가는 import, R7 상태·코어·domain에서 runtime으로 가는 import, R8 기능에서 app으로 가는 import, `pages/`나 `components/` 바로 아래 파일이 생기면 실패한다. 개발 전용 `features/dev`만 다른 기능을 import할 수 있다. 공유 화면 컴포넌트와 engine·audio·coach의 값 구현은 전이 소비 경로도 검사해 한 기능만 쓰면 실패한다. app 소비, 다른 공유 계층이 쓰는 코어 구현과 `components/ui` 기본 부품은 공용으로 보고 dev 진단 화면의 소비는 기능 수에 세지 않는다. domain·api와 타입 전용 계약은 이 소비 수 검사에서 제외한다.
- **예외(`ALLOWED`)는 지금 0건이다.** 새 예외는 막을 수 없는 이유를 주석으로 함께 적고, 풀리면 목록에서 지운다(남겨 두면 테스트가 실패한다).
- 「앱에 하나뿐인 것」은 `runtime/`에 둔다. 아래 층(store·코어·domain)만 읽으면 runtime, 라우트 표나 기능 폴더를 알아야 하면 `app/`이다. 예: 미리 받기(`app/prefetchRoute`)는 라우트 표를 알아서 app에 남고, 사이드바는 AppShell이 넘겨주는 `onPrefetch`로 부른다.
- 화면 여러 개가 같이 쓰는 조립은 `app/`이 한다. `AppShell`은 녹음 저장 창·입문 코스 초대처럼 기능·공유 부품을 한데 얹으므로 `app/`에 있다.
- `monitor`는 판정 경로와 분리한다. `features/monitor/core`는 input·domain만 읽고, 다른 기능은 monitor를 읽지 않는다.
- store 내부: `presetStore` → `settingsStore` 단방향은 허용한다(같은 줄끼리 import 금지의 예외). `localPresetSource`도 `settingsStore`를 읽는다.
- 경로 별칭 `@/` = `src/` (`tsconfig.app.json` · `vite.config.ts` · `vitest.config.ts`에 같이 설정). 다른 폴더는 `@/`, 같은 폴더는 `./`로 가져온다.
- `inputManager`·키보드 소스는 `runtime/sources.ts`에서, 센서 소스 인스턴스는 `runtime/sensorRegistry.ts`가 디스크립터의 `create`로 만든다. 화면은 `input/` 클래스를 직접 new 하거나 소스 id 문자열을 비교하지 않고, 레지스트리의 디스크립터(라벨·가용성·설정 항목)를 읽는다.
- BE는 `api/http`의 `apiFetch`로만 부른다. 화면·store는 401을 직접 처리하지 않는다(아래 [로그인](#로그인)). `api/` 안에서 `http`가 `account/auth`를 쓰고 `auth`는 `fetch`를 직접 쓴다 — 순환 없음. 로그인 시작·복귀 경로 같은 브라우저 동작은 `store/authStore`의 액션으로 두어 화면이 `api/`를 모른다.

### 폴더별 구성(상세)

공유 층을 먼저, 기능 폴더를 뒤에 적는다. 경로는 `src/` 기준이다.

#### 조립·설정값·런타임

- `app/` — 앱 조립 — 아래 전부를 알아도 되는 유일한 곳
  - `App.tsx` — 라우터. 랜딩(`/`·`/login`·`/signup`·`/welcome`, `features/landing/LandingPage` 지연 로드)과 /auth/callback 밖의 화면은 RequireAuth 아래. 로그인 상태의 `/`→`/free`, `/me`→`/settings`, `/calibration`→`/setup` 이동. 관리자 전용 `/admin/songs`는 RequireAdmin 아래(Jira 262). 악보 뷰어 `/studio/sheets/:id`는 지연 로드(278)
  - `routeModules.ts` — 화면별 지연 로드 표(라우터와 미리 받기가 같이 쓴다)
  - `AppShell.tsx` — 셸 조립. 녹음 저장 창·입문 코스 초대처럼 기능·공유 부품을 한데 얹는다
  - `sensors.ts` — 센서 소스 등록 한 줄씩 (새 소스는 여기에 추가)
  - `bootstrap.ts` — 설정 ↔ 소스 ↔ 스토어 ↔ 오디오 접착(타격 핸들러·연결 상태·메트로놈). 센서 세션은 `runtime/sensorSession`
  - `authBootstrap.ts` — 앱 시작 시 로그인 복원, 토큰 소실 → authStore 연결
  - `signupGate.ts` — 403 SIGNUP_INCOMPLETE 알림 → /me 재조회 연결(bindSignupIncomplete)
  - `presetBootstrap.ts` — 로그인 상태(authStore) → 프리셋 저장소(서버/로컬) 전환, 목록 읽기, 기본 프리셋 적용
  - `prefetchRoute.ts` — 메뉴 미리 받기(화면 코드·대표 데이터). AppShell이 Sidebar에 `onPrefetch`로 넘긴다
- `config/` — 값·순수 함수 — `auth.ts`(AUTH_REQUIRED) · `accompaniment.ts`(ACCOMPANIMENT_OVERRIDE) · `prefetch.ts`(PREFETCH_HOVER_MS) · `chunkRecovery.ts`(청크 로드 실패 판별·자동 새로고침)
  - 모니터 스위치(`VITE_MONITOR`)처럼 동적 import를 감싸는 빌드 스위치는 쓰는 파일 안에서 `import.meta.env`를 직접 읽는다. 공용 상수로 모아 import하면 Vite가 동적 import를 지우지 못해 모니터 청크가 운영 번들에 들어간다(2026-11-18 실험: 산출 파일 101 → 112개).
- `runtime/` — 앱 단일 인스턴스·세션
  - `sources.ts` — 키보드 소스 · inputManager 단일 인스턴스
  - `sensorRegistry.ts` — 센서 소스 디스크립터 등록·조회, 인스턴스 지연 생성
  - `sensorSession.ts` — 센서 하나 켜고 끄기(activateSensor)·다시 열기(connectSensor)·입력 표면 등록(bindSensorSurface), 활성 인스턴스·배터리 기록·재연결 동작. `reconnectPolicy.ts`는 재시도 간격·기기 복귀 대기
  - `hitSound.ts` — 공용 타격음 스위치 · `useApiQuery.ts` — 공통 조회 훅
  - `queryClient.ts` — TanStack Query 캐시 인스턴스와 공통 정책
  - `playSync.ts` — 플레이 로그 서버 업로드·상태·재전송, 리포트 미리 받기·재조회(refreshReport)·프리패치 구독(usePrefetchedReport)·조회 오류 분류
  - `recordingStore.ts`·`recordingSync.ts` — 녹음 상태 기계와 서버 저장
  - `calibrationSession.ts`·`timingCalSession.ts` — 2타 보정·재정렬, 박자 맞추기 세션
  - `keyboardDrum.ts` — 키보드 드럼 켜기·끄기(연주 화면과 드럼 세팅 화면이 켠다. 겹쳐 쓰는 곳 수를 세어 마지막이 떠날 때 끈다)
  - `audioUnlock.ts` — 첫 제스처의 오디오 켜기(unlockAudio)와 사운드 세트 적용(applySoundSet)

#### 공유 UI (`components/`)

- `components/ui/` — action/·feedback/·form/·layout/·overlay/로 나눈 도메인을 모르는 기본 부품(Figma 01 Design System과 같은 이름) — Button(`buttonStyle`의 `buttonClassName`으로 링크에도 같은 모양) · IconButton · Card · Chip(필터) · StatusPill(상태 표시) · EmptyState(빈 상태, `headingLevel`·`size="sm"`) · ErrorState(패널형 오류) · InlineError(알림 줄형 오류) · Toggle · Checkbox(네이티브 input + label) · Segmented · Pagination(쪽 번호, 10개 묶음·« ‹ › ») · Slider · Input · Dialog(배경·포커스 순환·Esc, `useDialogFocus`·`focusCycle`) · Menu(바깥 클릭·Esc 팝오버) · Toast · Countdown(화면 가운데 카운트다운 숫자·「시작!」, 배경 dim·clear. 리듬 게임·악보 연습·미니게임이 같이 쓴다) · table.css(`.ui-table`)
- `components/shell/` — 앱 셸 (`nav/`·`dock/`·`account/`로 분류) — Sidebar(+ SidebarToggleIcon) · TopBar · GlassDock(dockMotion·dockAutoCollapse) · RequireAuth · RequireAdmin(ADMIN 아니면 /free, 표시만 — 권한은 BE) · RouteErrorBoundary · NotFoundPage · PublicLayout · ProfileMenu · RecommendationConsentDialog · useShell(페이지가 제목·전체 화면 선언) · useMediaQuery(`useSidebarCollapsed` · `TABLET_QUERY`(≤1024) · `MOBILE_QUERY`(≤640)) · defaultTitles(라우트별 기본 제목) · SoundToggle(+ SoundIcon) · MetronomePanel(Dock 메트로놈 패널, 리듬 게임에서는 `gameDisabled`로 조작 비활성, metronomeRoute) · StickStatusIndicator · DebugOverlay·TuningPanel(디버그 창)
- `components/metronome/` — 메트로놈 박 분할 선택 — SubdivisionPicker(자동·4분음표·8분음표 선택 칸 + 풀이 한 줄, Dock 패널과 시작 확인 창이 같이 쓴다) · PreviewDots(예시 소리의 박 표시)
- `components/song/` — 곡 표시·재생 조작 — SongCover · LevelBadge(연습 단계 EASY·NORM·HARD 배지) · SongStatusBadge · DeletedSongChip(삭제된 곡 칩) · useDeletedSongIds(삭제된 BE 곡 id 집합 훅) · MarqueeTitle(재생 중이고 칸보다 긴 제목만 흐름, 그 밖에는 말줄임 span) · PlayingEq(제목 옆 재생 중 이퀄라이저) · PlaybackIcons(10초 뒤로·앞으로·재생·일시정지 글리프와 반주 [바꾸기]용 `PickListIcon`) · PlaybackTransport(조작부 [10초 뒤로][재생/일시정지][10초 앞으로] + 누름·회전·pop 모션, 라이브러리 재생바와 반주 바 공용) · SeekBar(진행 막대, `layout="ends"`는 반주 바·라이브러리 재생바용, `label`로 읽히는 이름을 바꿔 녹음 보관함 재생바도 같이 쓴다) · useFreeAccompaniment(반주 재생 훅)·accompanimentError · StudioIcons(더보기·닫기·업로드·플러스·재생)
- `components/drum/` — 드럼 킷 그리기 — DrumKit(코칭 대상 패드 링 `coachPad`, 스킨별 킷 상자·`fitContain`·하이햇 `hihatClosed`·`pedalOff`, 킷 크기 래퍼 `.drum-kit-fx` 안 깔개·덮개 자리 `underlay`·`overlay`) · Pad · ElectronicPad · NeonPad(곡 선택 안내의 네온 킷) · flatParts·flatGeometry(평면 패드 부품과 페달 좌표) · padRing(링 기하, 실물이면 패드별 자리 표를 읽는다) · KitGuideLabels·KitGuideLabels.css(패드 이름표 알약 묶음, 자유 연습 키트 가이드·드럼 세팅 키 안내 공용) · LiveDrumKit(하이햇 페달 구독을 가둔 DrumKit 래퍼) · StageLights·StageLights.css(무대 조명: `StageBeam` 페이지 전체 빛줄기 · `StageFloor` 킷 바닥 빛, 자유 연습·드럼 세팅 공용, 클래스는 `free-lights`·`free-beam`·`free-floor`) · useHihatPedal·usePedalHitSeq(페달 상태·밟는 순간) · usePadStates · padStateMachine·useRecentHits · drum.css · `acoustic/`(실물 스킨: AcousticPad 이미지 패드 · sprites 조각 이미지 import 표·미리 받기 · `persp/`·`top/` 조각 12장씩은 도구가 만든다)
- `FE/scripts/kit-art/` — 실물 드럼 조각 이미지·자리 표(`domain/kit/kitArt.ts`)를 만드는 개발용 Python 도구(build.py · regions.json · README). 원본 그림이 바뀔 때만 돌리고, 원본 이미지는 커밋하지 않는다
- `components/fx/` — 타격 이펙트 — FxCanvas · fxEngine · fxDraw · fxSheets(연속 그림 보관소) · fxSource · judgeColors
- `components/stick/` — 자유 연습과 연주에서 함께 쓰는 끊김 표시 CSS
- `components/calibration/` — 세팅·설정·연주가 같이 쓰는 보정 창 — RealignPrompt·useRealign·calibrationText(스네어 재정렬) · TimingCalDialog·timingCalText(박자 맞추기)
- `components/recording/` — 셸이 얹는 녹음 UI — RecordButton(recordButtonRoute) · SaveRecordingDialog · RecordingToast(toastContent). 녹음 목록·재생은 `features/history`
- `components/lesson/` — 학습 코스 — LessonInvite(초대) · PadNotation(4개를 넘으면 오선을 줄로 나눈다. 같은 파일의 `ReadStaff`는 알아보기 화면의 음표 줄, `SoloStaff`는 미니게임 「악보 보고 빨리 치기」의 한 음표 오선) · 공용 스타일
- `components/sheetmusic/` — 악보 띠 그리기 순수 함수 — sheetStripDraw · sheetStripMath (연주·결과가 같이 씀)

#### 상태·코어

- `store/` — 공유 zustand 상태 — settingsStore(영속) · liveStore(실시간) · shellStore(셸 제목·전체 화면·Dock 패널, 영속 안 함) · presetStore · localPresetSource · authStore(로그인 상태, 영속 안 함) · recommendationConsentStore(맞춤 곡 추천 학습 동의 상태, 서버 원본·영속 안 함) · recommendationStore · lessonStore · songStore(곡 소스·마지막 곡 선택 탭·상세·`loadChart`, 목록은 `api/queries`) · chartJobStore(음원 업로드·채보 생성 작업 폴링, 활성 작업 1개 영속) · reconnectStore(스틱 재연결 상태 기계 idle·trying(n/3)·failed·reconnected와 자동·수동 액션, 실제 동작은 `app/bootstrap`이 끼운다). 한 기능만 쓰는 상태는 기능 폴더에 있다(`features/studio/store`, `features/admin`의 adminSongStore·adminBulkStore)
- `api/` — 여러 기능이 쓰는 BE 호출. 바로 아래에는 공통 래퍼만 두고(구조 테스트가 검사한다) 나머지는 domain과 같은 개념 이름의 하위 폴더로 묶는다 — http(공통 래퍼) · error(ApiError)
  - `account/` 로그인·회원 — auth(access 토큰·refresh·logout) · users(me·signup-consent·recommendation-consent)
  - `kit/` — presets(프리셋 CRUD, BE 90 — PresetSource 서버 구현)
  - `song/` 곡·채보·추천 — songs·charts(곡·채보 조회, BE 96) · jobs(채보 생성 작업) · recommendations · similarSongs · songQueries(곡 목록 조회 키와 훅)
  - `play/` 연주 기록·리포트·녹음·학습 코스 — plays(플레이 로그 요약 업로드, BE 98) · reports(리포트 조회·화면 타입 변환, BE 157) · recordings · lessons · playQueries·recordingQueries(쪽 단위 목록 조회 키와 훅)
  - 한 기능만 쓰는 호출은 그 기능 폴더에 있다(악보 보관 `features/studio/api`, 관리자 곡 `features/admin/adminSongs`)
- `input/` — 입력 매퍼와 `source/`의 입력 소스 (인스턴스는 만들지 않는다 → runtime/sensorRegistry · runtime/sources)
  - `InputSource` — 공통 인터페이스 · ClockSync(센서 시각 펼치기) · 주기 SYNC 간격
  - `clockEstimate` — 시계 오프셋 추정(최근 10초 창의 최소 왕복 표본 → 목표, 적용값은 초당 1ms로 따라감)
  - `deviceState` — 기기별 상태(role 0~3 네 칸: 시계·SYNC 대기·연결·배터리/설정 전 보류). 이벤트는 손(0·1)은 status·hit·pose, 발(2·3)은 pedalStatus·hit(foot)·pedal
  - `SourceDescriptor` — 입력 소스 디스크립터 타입 (id·라벨·설정 항목·동작 버튼 선언)
  - `KeyboardPadSource` — 키 코드 타격 (항상 켜짐)
  - `PointerStickSource` — 마우스 위치 → 자세, 키/클릭 → 타격 (모의 IMU) + 디스크립터
  - `BleStickSource` — Web Bluetooth GATT + 디스크립터
  - `WebSocketStickSource` — 허브 · PC 브리지 + 디스크립터
  - `WebSerialStickSource` — USB 직결·동글(Web Serial) + 디스크립터. LINK 네 비트(손 2 + 발 2)·STATUS 비트 5 처리, 페달(role 2·3) 수신, reopen, 재장착(connect 이벤트) 자동 재열기
  - `serialFraming` — 직결 프레이밍(SOF·LEN·CRC8) 인코더·디코더
  - `stickProtocol` — BLE/WS 공용 바이너리 패킷(v0.8.1: PEDAL 0x08, role 2·3 해석)
  - `padMapper` — 키 매퍼(keyMap) · 자세 매퍼(손별 앵커에서 유도한 판정 프로필)
  - `InputManager` — 소스 합성 → 매퍼 → ResolvedHit 발행
- `engine/` — HitCapture(2타 보정) · SnareRealign(스네어 재정렬) · RhythmSession(일시정지 포함) · hitMatch · Metronome · diagTap·diagReport(진단) · playLog · telemetry. 한 기능만 쓰는 것은 기능 폴더에 있다(연주 시계·기록기 `features/play`, 자동 연주 `features/play/components/diag`, 기준 자세 캡처 `features/setup/components/calibration`, 녹음 재생 `features/history`)
- `coach/` — 실시간 코칭(COACH-001) 규칙 모듈 — live/(config · window · rules · policy · cause · noteContext · LiveCoach · copy(화면 문구 표) · models(서버 모델·실험군)). 순수 TypeScript, domain만 import
- `audio/` — AudioEngine · soundSets(사운드 세트) · kitConfig(kit-config.json 스키마). 결과 구간 재생은 `features/result/audio/SegmentPlayer`
- `domain/` — 공유 순수 타입·함수. React·브라우저 API 의존 없음 (단위 테스트 대상). **바로 아래에는 `events`(센서 → 브라우저 타격 이벤트, 공통 명세서 9-1)만 두고** 나머지는 개념별 하위 폴더로 묶는다(구조 테스트가 검사한다). 새 파일은 맞는 하위 폴더에 두고, 맞는 폴더가 없을 때만 새 하위 폴더를 만든다. 한 기능만 쓰는 순수 로직은 `features/<기능>/domain/`에 둔다
  - `kit/` 킷 배치·판정·기기·준비 (`calibration/`·`device/`로 관련 로직 분류) — pads(패드 정의) · kitLayout(판정용 배치) · drumKit(연주 화면 킷 표시 배치·크기) · keyMap · calibration(보정 프로필·기준선 판정) · tuning(센서 튜닝 값) · preset · devices(기기 이름·연결 문구) · pedalStatus · kitModel · kitMapping · kitJudge · kitPerspective · kitFrame · kitArt(실물 그림 패드 자리 표) · setupSteps · readiness · timingCalibration · stickStatus · hihatPedalCoverage · soundSet · dockChip · keyTarget
  - `song/` 곡·채보·반주·추천 — recommendation(추천 곡·비슷한 곡 타입·카드 모델) · chart(채보) · sheet(악보 격자) · songCatalog(곡 목록·상세 타입) · chartJob · chartMapping(BE 채보 → Chart) · builtinSongs · songEdit(곡 정보 검증·바뀐 필드·오류 문구·상태별 ⋯ 메뉴) · songAvailability(연주 기록의 곡 삭제 판정) · midiUpload · freeAccompaniment · marquee
  - `time/` 박자·시계 — tempo · metronome · audioClock · audioTimeline · accompanimentClock · leadIn · formatTime(시각 표기: formatDuration m:ss 반올림 · formatClock m:ss 내림, 1시간 이상 h:mm:ss · formatElapsed mm:ss 내림)
  - `play/` 연주 판정·기록·결과·학습 코스 — judgement(판정 규칙) · playLog(연주 기록 모양) · recording(녹음) · report(리포트 화면 타입) · playUpload(로그 → 업로드 본문) · playLogView(날짜·모드 표기·필터·검색, 날짜 묶음, 기간 → 서버 날짜(한국 시간), 서버에 없는 기록 고르기·섞기, 저장 상태, 정확도 단계) · playRetry · bestRecord(내장 개발 소스 로컬 최고 기록) · hitStats · coachBasis · dataConsent(연주 기록 활용 동의 판 일치·이관·업로드 consent 규칙) · recordingView · miniGame(미니게임 경로·게임 id, 사이드바·곡 고르기·features/mini가 같이 쓴다) · lesson
  - `account/` 로그인·가입·동의 — auth(로그인·회원 타입) · signupTerms(가입 약관·동의 규칙) · signupGate(가입 필요 판단·라우트 결정) · recommendationConsent(추천 학습 동의)
  - `hitFx/` 타격 이펙트 계산

#### 기능 폴더 (`features/`)

- `features/play/` — 리듬 게임·악보 연습
  - 바로 아래 — PlayPage · SheetPage · useBestRecords · hapticMode · dataConsent · diagSessionOpts · sessionClock(연주 시계 PlayClock) · playRecorder(타격·MISS 처리 순번)
  - `api/` — serverBestRecord(서버 최고 기록 → 모드별 곡·채보 최고값) · liveCoach
  - `coach/` — shadowCoach(연주 전용 코칭 실험)
  - `domain/` — guideScript(곡 선택 안내 애니메이션 예시 마디·시간표·시각 → 상태 순수 함수, 게임은 `GAME_GUIDE_OPTIONS`로 노트가 판정선 위 4칸에서 내려오게 시작 위치를 앞당긴다) · highwayLanes(하이웨이 9레인 순서 HP \| HH CR SN ST KK MT FT RD, 하이햇 페달 맨 왼쪽·간격 16px(`highwayGeometry.HIGHWAY_PEDAL_GAP`), 노트·레인 플래시·MISS 파편 색 = 네온 3색 `LANE_COLOR`: 심벌 #ffc24a · 북 #22e4ff · 킥 #ff3ec8; 킷 그림·결과·리포트는 `PAD_META.color` 그대로) · comboFx · haptics · padCue · timingBar · playShared(PlayPage·SheetPage·useChartParam이 같이 쓰는 `parseId`·`GO_MS`·`NO_LESSONS`)
  - `components/` — 흐름 단계로 나눈다. 여러 단계가 같이 쓰는 `play.css`를 바로 아래에 둔다
    - `picker/` 곡 선택 — SongPicker(두 모드 공용, 안내 접이 바(안내 줄과 구분선), 악보 연습의 학습 코스는 숨김) · SongTable·SongDetailPane(곡 선택 표·상세, 두 모드 모두 단계 세그먼트 + [플레이] 모양, 기록 칸은 `quickStart.bestKind`) · StaffLegend · BestRecordsNotice · useChartParam(URL 곡 선택 훅)
    - `picker/lesson/` 학습 코스 — LessonCourse(코스 본문) · CoursePicker(입문·중급 칸) · StageMap
    - `picker/guide/` 곡 선택 안내 줄(설계 MODE-001-MODE-003-song-picker-guide) — PickerGuide가 `mode='sheet'`이면 [SheetGuideScene \| StaffLegend], `mode='play'`이면 [GameGuideScene \| LaneLegend]를 조립한다. SheetGuideScene(악보 한 마디 SVG + 실제 `DrumKit`(사용자 `kitSkin` 0.85배) + 음표→패드 연결선) · GameGuideScene(9레인 띠에서 노트가 떨어져 판정선에 닿으면 레인이 빛나고 `NeonPad` 네온 킷(킷 스킨과 무관, 글자는 `PAD_META`)의 같은 패드로 점선이 이어지며 번쩍인다. 레인 x는 `highwayGeometry.laneLeft`를 그대로 쓴다) · 두 장면 모두 논리 좌표 760×470을 폭에 맞춰 줄이고 소리·이펙트 없음 · LaneLegend(StaffLegend와 같은 `play-sl` 2열 카드 CSS 재사용, 강조색은 `laneColorOf`) · GuideControls(단계 칩 ①②·◀ 일시정지/재생 ▶·「지금 칠 것」 줄) · useGuideClock(rAF 누적·일시정지·`stepTo`·화면 밖/탭 숨김 정지·모션 줄이기면 첫 칸에 멈춰 시작) · guideKitPlace(악보 안내 장면의 스킨별 킷 자리) · GuideFold(안내 줄 위의 높이 44px 접이 바. 바 전체가 버튼이고 접으면 안내 줄·구분선이 접혀 바에 한 줄 요약이 남는다. 처음에는 펼침, 접힘 여부는 모드별로 localStorage `airdrum.picker.guideFold.{play|sheet}`에 기억. 접힌 동안 안내는 마운트된 채 `inert`이고 시계는 `useGuideClock`의 `active=false`로 멈춘다. 높이는 grid 0fr↔1fr, `--motion-move`×2.1·`--ease-sheet`)
    - `start/` 시작 확인 — StartDialog(악보 연습 시작 확인 창이자 리듬 게임의 기기 준비·오류·재정렬 팝업, `variant` play·setup, `options`가 없으면 옵션 구역을 그리지 않는다) · DeviceCheck(기기 준비 카드) · ReadinessNotice·useReadiness · PlayOptions(연주 옵션 줄 목록)
    - `stage/` 연주 화면 — PlayStage(골격) · PlayHud(HUD game/sheet) · NoteHighway·highwayGeometry · SheetPager(마디 고정 5선 악보 Canvas)·sheetPagerMath · kitSoundStage · ComboDisplay · TimingBar · GuideSlot(안내·코칭 칸, 구령+보조 두 줄) · CoachHandChip · coachDisplay(밀집 구간 유예·구령만 판단) · useCoachLine·coachLineTimer(코칭 문구 3초 표시) · ScreenGate·screenFit · AudioWaitNotice·useAudioClockGate · StageFade · strayMissSource · useJudgementHaptic · useNextBeatLabels
    - `stage/` 안의 highway/ · sheet/ · kit/ · coach/ · link/는 각 연주 화면 부품을 묶는다. link/는 리듬 게임의 레인·패드 연결(laneLinkGeometry 경로 계산 · LaneLinkLayer 캔버스 층 · useGameKitScale 킷 배율)이다. HitReadout은 stage/에 둔다
    - `pause/` 일시정지 — DisconnectNotice · PauseOverlay(포커스는 `ui/overlay/useDialogFocus`) · usePauseTriggers(끊김·메뉴 자동 일시정지 훅) · useReconnectResume(재연결 이어 하기) · popupLook
    - `diag/` 진단 자동 연주 — ChartAutoplayControl · lazyChartAutoplay · chartAutoplay
- `features/setup/` — 드럼 세팅·위치 보정 — SetupPage
  - `components/` — stage/·preset/·calibration/으로 관련 부품 분류 — StepDialog · StickCard · StatusTile · SensorOptionsPanel · PresetChips·PresetNameDialog·PresetSlotDialog · HitLog·hitLogFormat · ReturnBanner · UnsavedLeaveDialog · useStageFit(`stage/`, 드럼 그림 영역 높이를 화면에 맞춤) · enterKey · setup.css
  - `components/calibration/` — CalibrationDialog(패드 보정 팝업 껍데기) · CalibrationStage(팝업 본문·재정렬 본문) · CaptureNotice·useCaptureNotice(팝업 첫 안내와 열림 상태) · `hint/`(실수 안내: hintPick 고르기 · hintGeometry 좌표 · CaptureHint·SamePointHint·MoveAwayHint 드럼 그림 위 안내 · AimGuide 방향 그림 · hint.css) · ReferencePoseGuide·referencePose·useReferenceCapture·ReferenceCapture · GapBanner · usePoseStream
- `features/free/` — 자유 연습 — FreePlayPage · AccompanimentBar(글래스 캡슐 반주 바 5변이 + ≤640 미니 바) · AccompanimentPicker(반주 고르기 창·≤640 바텀 시트) · useAccompanimentSongs(선택 창 목록 훅) · DisconnectBand(한 손·페달 끊김 띠) · freeStage · free.css. 진행 막대(SeekBar)·반주 재생 훅(useFreeAccompaniment)은 `components/song/`
  - `components/` 무대 부품 — KitGuide(`KitGuideSwitch` 「키트 가이드」 스위치. 패드 이름표 알약 `KitGuideLabels`는 드럼 세팅도 써서 `components/drum/`에 있다) · FreeHud(무대 아래 최근 타격·세션 통계) (조명 `StageBeam`·`StageFloor`는 자유 연습과 드럼 세팅이 함께 써서 `components/drum/StageLights`에 있다)
  - 이름표 목록·자리 %·키를 만드는 순수 함수 `kitGuide`는 드럼 세팅도 써서 `domain/kit/kitGuide`에 있다
- `features/studio/` — 라이브러리 — StudioPage · SheetViewerPage
  - `components/` — 곡 올리기(UploadPanel·UploadDialog·AudioDropzone·MidiUploadForm·SheetUploadForm·ActiveJobCard) · 내 곡(MySongList·MySongRow·MySongCard·SongMenu·PlayModeMenu·SongPlayBar·CoverPlayer·AccompanimentBadge·useAccompanimentPolling·accompanimentPoller) · 곡 편집(EditDialog·SongMetaDialog·SongCoverDialog·SongDeleteDialog) · 악보(SheetItemRow·SheetItemCard·SheetCover·SheetMenu·sheetItemText) · LibraryEmpty(곡·악보 없을 때 빈 안내) · StudioToast · dateLabel · studio.css
  - `components/` 아래 songs/ · upload/ · sheet/ · accompaniment/로 나눈다. `media/coverImage`는 커버 이미지 변환을 맡는다
  - `components/sheet/` — 악보 뷰어 — SheetViewer · PdfPages · SheetTitleDialog · SheetDeleteDialog
  - `store/`(songEditStore · midiUploadStore · sheetLinkStore) · `api/`(sheets · queries/sheets) · `domain/`(sheetMusic · songPlayback · songCover)
- `features/result/` — 결과·상세 리포트 — ResultPage · ReportPage · analysisPoller
  - `components/` — 결과 화면 — LessonResultBand · RecommendRow · ResultSummaryCard · JudgeBars · TimingHistogram · FeedbackCard · PadSummaryTable · SheetSnippet(약점 마디 미니 악보) · SetupHintCard · RecordCelebration·CelebrationFx · ReportEntry(결과 → 상세 분석 진입부) · result.css
  - `components/report/` — 연주 리포트(설계 COACH-002 리포트 화면 개편) — ReportHero(머리: 총평 제목·점수·노트 판정 막대) · ReportHighlights(하이라이트: 최대 콤보·평균 박자·연주 시간·지난번보다) · NoteFlowChart(전체 노트 흐름: 5초 막대·툴팁·놓친 구간 캡슐) · FocusPanel(선택 구간 확대: 제목·근거·AI 문구·패드 줄 노트 표시·노트 넘겨 보기·재생 조작) · ReportSections(ObservationList 관찰 목록 · PadTable 패드별 기록 · AnalysisNotice 분석 상태 안내) · TimingHistogram(리포트용, 결과 화면의 것과 다른 컴포넌트) · useSegmentPlayer(구간 재생 상태) · report.css(`rp-` 접두사)
  - `domain/` — timingHistogram(타이밍 분포·평균 Δ) · feedback · reportView · confetti · celebrate · segmentPlayback
- `features/history/` — 연주 기록 — HistoryPage · PlayLogTab·PlayLogRow·playLogRows(행에 보일 값)·usePlayLogList(서버 쪽 단위 조회)(플레이 기록 탭) · RecordingList·RecordingPlayBar(라이브러리와 같은 모양의 녹음 재생바)·useRecordingList·useRecordingPlayback·recordingPlayer(녹음 재생)·RecordingTitleDialog·RecordingDeleteDialog·recordingMutation(녹음 목록 탭) · `media/downloadFile`(Blob 내려받기) · `domain/`(recordingMidi · midiFile)
- `features/lesson/` — LessonReadPage(학습 코스 알아보기 레슨 화면)
- `features/mini/` — 미니게임(MODE-006, 아래 「미니게임」 절) — MiniListPage(목록) · SpeedGamePage(「누구보다 빠르게」) · DynamicsGamePage(「강약중강약」) · SightGamePage(「악보 보고 빨리 치기」) · TempoGamePage(「인간 메트로놈」) · tempoCountIn(「인간 메트로놈」의 예비 박 예약기) · CrescendoGamePage(「어디까지 올라가는 거예요?」) · OneShotGamePage(「정적 뒤 한 방」, 이벤트 빌드만) · oneShotAudio(「정적 뒤 한 방」의 음원 재생기) · useMiniFlow(안내 → 카운트다운 → 플레이 → 마무리 → 결과 단계 훅, 모든 게임 공용) · mini.css(`mini-` 접두사)
  - `components/` — 게임 공용 부품 — MiniCard(목록 카드) · MiniIntro(시작 전 안내: 시작을 막는 사유·[시작하기] 줄의 조작·안내 한 줄을 게임이 넘긴다) · MiniResultHero(결과 머리: 제목 두 줄·점수 칸·꼬리표·가운데 버튼을 게임이 넘긴다) · StatCells(숫자 칸 묶음)
  - `components/speed/` — 「누구보다 빠르게」 — SpeedStage(플레이 화면) · SpeedResult(결과 본문) · SecondBars(초별 타수 막대) · SpeedArt(카드·안내 그림)
  - `components/dynamics/` — 「강약중강약」 — DynamicsStage(플레이 화면: 감 잡기·숫자 맞추기 두 단계) · VelocityGauge(세로 세기 눈금 하나: 목표 선·내 세기 표시·내 타격·상태 문구) · FeelStrip(「내 세기 약·중·강」 한 줄) · DynamicsResult(결과 본문 「타격별 세기」) · DynamicsArt(카드·안내 그림, 스타일은 mini.css) · dynamics.css(`mini-dyn-` 접두사, 이 게임 화면에서만 받는다)
  - `components/sight/` — 「악보 보고 빨리 치기」 — SightStage(플레이 화면: 진행 점·문제 판·옆 칸·드럼 판) · ProblemDots(진행 점 10개와 「4 / 10」) · SightClock(이번 문제 시간, 음표가 떠 있으면 프레임마다 흐른다) · SightResult(결과 본문 「문제별 반응 시간」) · SightArt(카드·안내 그림, 스타일은 mini.css) · sight.css(`mini-sight-` 접두사)
  - `components/tempo/` — 「인간 메트로놈」 — TempoStage(플레이 화면: 꼬리표·큰 빠르기 숫자·문구·점 줄) · CountDots(4개씩 묶은 점 줄과 「7 / 16」, 예비 박 점과 타격 점에 같이 쓴다) · TempoResult(결과 본문: 칸 3개와 그림) · ErrorChart(타격마다 벗어난 정도 그림, 화면 낭독기용 목록 포함) · TempoArt(카드·안내 그림, 스타일은 mini.css) · tempo.css(`mini-tempo-` 접두사)
  - `components/oneshot/` — 「정적 뒤 한 방」 — OneShotStage(플레이 화면: 곡 줄·큰 문구·반주 판·판정) · OneShotSongPick(곡 줄: 곡이 하나면 이름만, 둘 이상이면 고르기) · BackingStrip(반주 판: 막대·「정적」 선·「지금 위치」 선) · OneShotResult(결과 본문: 그림과 곡별 기록) · ShotChart(정답 자리와 내 타격 그림) · OneShotArt(카드·안내 그림, 스타일은 mini.css) · oneshot.css(`mini-oneshot-` 접두사)
  - `components/crescendo/` — 「어디까지 올라가는 거예요?」 — CrescendoStage(플레이 화면: 머리 문구·횟수·세로 눈금·방금 친 세기) · StepLadder(세로 눈금 하나: 받은 계단의 가로선·직전 계단 아래의 어두운 칠·끝낸 타격) · CrescendoResult(결과 본문: 칸 3개와 「세기 계단」 막대) · CrescendoArt(카드·안내 그림, 스타일은 mini.css) · crescendo.css(`mini-cres-` 접두사)
  - `store/` — miniRecordStore(최고 기록, localStorage 계정별 키) · sightHintPref(「악보 보고 빨리 치기」에서 마지막에 고른 힌트 값) · oneShotSongPref(「정적 뒤 한 방」에서 마지막에 고른 곡)
  - `domain/` — miniCatalog(게임 목록 표) · miniFlow(단계 상태 기계·카운트다운 길이) · miniRecord(기록 타입·갱신 판정·저장 값 검증·카드에 보일 기록) · hitTime(집계에 쓸 타격 시각) · speedRound(타수 집계·결과 문구) · velocityShot(세기 게임 공용: 받을 타격·다른 패드·받은 세기 모으기·눈금 자리·시작 가능 판정. 「강약중강약」과 「어디까지 올라가는 거예요?」가 같이 쓴다) · dynamicsRound(내 세기 모으기·목표 범위·숫자 목표 뽑기·오차 합·문구) · crescendoRound(계단 만들기·끝난 까닭·횟수·평균 간격·문구·기록 값) · sightRound(출제·타격 가리기·문제 시간·평균·표시 형식·문구·막대 눈금) · sightPlay(문제 진행 상태 기계: 대기 → 제시 → 확인) · timingError(박자 오차 공용 계산: 부호 있는 오차·빠름/늦음·표시 글·평균. 408·409가 같이 쓴다) · tempoRound(빠르기 뽑기·받아들일 타격·타격과 박 짝짓기·평균 오차·흐름·그림 눈금·문구) · oneShotSongs(곡 표: 음원 파일 이름과 정적 시작·정답 위치, 음원 주소, 길이 검사) · oneShotRound(보정값 고르기·한 타 판정·기록 값·표시 글·그림 자리)
- `features/settings/` — SettingsPage · SettingRow · `components/`(HitFxPicker · KitSkinCarousel · WithdrawDialog) · `domain/`(carouselStep: 캐러셀 순환 이동)
- `features/landing/` — 랜딩(설계 UX-353)·로그인·가입 동의 — LandingPage · AuthCallbackPage
  - `components/` — landing.css(전부 `.lp` 아래·`lp-` 접두사) · HeroScene(히어로+와이프) · StatementScene(점 글자 채움) · StickScene(센서 스틱 3단계 글·진행 막대) · StickStage(스틱 캔버스 무대) · stickStageDraw(캔버스 그리기, 순수) · ChartScene(음원→드럼→채보) · ModesScene(카드 비행·전광판 네온) · ResultSection · CtaSection(둘 다 reveal) · LandingNav · ScrollCue · useSceneProgress(스크롤 진행도 0~1) · useStickSwing(rAF 루프, 경과 초 전달) · useReveal(화면 진입 시 나타남) · landingArt(파형·채보·악보 SVG 데이터) · landingContent(모드·문구·이미지 경로. 히어로 제목은 `h1` 안의 워드마크 이미지로 그리고 `alt`가 서비스명이며, 뒤에 청록·자홍 흐린 네온이 6초 주기로 숨 쉰다. 모션 줄이기면 멈춤) · LandingView(전체 조립)
  - `components/auth/` — LoginDialog·SignupConsentDialog(랜딩 위 팝업) · ProviderIcons(Google 공식 4색 고정·SSAFY 자리표시) · TermsItem(약관 한 항목, 96 높이 스크롤 상자) · SignupConsentCard(가입 동의 카드, 동의 상태 보관·`initialAgreed`로 선택 항목 미리 켜기) · auth.css
  - `domain/` — landingMotion(장면별 구간·이징 수치) · landingRoute · 스틱 무대(설계 DESIGN-landing-stick-stage): stickSpace(벡터·카메라·투영·무대 맞춤) · stickModel(스틱 치수·반지름·재질 구간·띠 음영) · stickStroke(박자·스트로크 곡선·시각에서 포즈·타격 목록) · stickLayout(구도 A 카메라·패드·스틱 배치)
- `features/admin/` — 공용 곡 관리(관리자, Jira 262) — AdminSongsPage · AdminSongTable · AdminSongAddDialog · AdminBulkDialog(CSV 일괄 추가·양식 받기) · adminSongStore(목록·등록·행별 반주 업로드) · adminBulkStore(CSV 일괄 추가 순차 실행·줄별 결과) · adminSongs(BE 156·262 호출) · adminSong(타입·입력 검사·첫 박 시각·반주 파일 검사·오류 문구) · adminBulk(CSV 파싱·인코딩 판별·양식·파일 짝 맞추기·줄별 판정) · admin.css
- `features/monitor/` — 스틱 패킷 모니터(EMB용) — StickMonitorPage와 그래프·표 부품은 바로 아래, `core/`(판정 경로와 분리된 수집·분석, input·domain만 읽는다) · `layout/`(Sidebar·Fold·KeyMetricsBar·MetricRow·ReplayBar·sections) · `sections/`(Overview·Sensor·Clock·Transport·Resolve·Score·Trace·Output·Control·FreeMeasure 구역). 자세한 내용은 아래 「스틱 패킷 모니터」 절
- `features/dev/` — 개발 전용 FX 랩(`/dev/fx`) — FxLabPage · fxLabPatterns. 다른 기능을 import할 수 있는 유일한 기능 폴더
- `styles/` — tokens.css(디자인 토큰·모션 토큰·폰트·텍스트 유틸) · motion.css(공통 키프레임·역할 클래스) · global.css(전역·셸 레이아웃)

## 디자인 토큰

Figma 01 Design System의 변수·텍스트 스타일을 `src/styles/tokens.css`에 옮겼다(`global.css`가 맨 위에서 `@import`한다).

- **새 화면 코드는 새 이름만 쓴다:** `--bg-canvas·base`, `--surface-1..3`, `--line`·`--line-strong`, `--text-1..3`, `--brand`·`--brand-text`·`--brand-on`·`--brand-sub`, `--perfect`·`--good`·`--miss`, `--radius-control·panel·dock`, `--space-xs·s·m·l·xl`, `--font`·`--font-num`·`--font-display`. 손 색은 `--left`(sub)·`--right`(brand).
- **옛 이름**(`--stage`·`--brass`·`--ink`·`--sm-*`·`--surface`·`--radius` 등)의 임시 별칭은 삭제했다. CSS와 Canvas 색 읽기(`readColors`·모니터 `cssVar`) 모두 `tokens.css`의 이름만 쓴다.
- **텍스트 유틸 클래스 7종:** `.t-display-64`(Bebas Neue)·`.t-display-20`(Space Grotesk, 숫자)·`.t-title-24`·`.t-title-20`·`.t-body-16`·`.t-body-14`·`.t-caption-12`(Pretendard).
- **폰트:** Pretendard는 `index.html`의 CDN 링크, Space Grotesk·Bebas Neue는 `public/fonts/`의 로컬 파일(OFL, 라이선스 파일 동봉)을 `tokens.css`의 `@font-face`로 불러온다.
- **모션 토큰·역할 클래스:** 시간·이징은 `tokens.css`의 `--motion-press`(80ms)·`--motion-fast`(120ms)·`--motion-base`(200ms)·`--ease-out`·`--ease-in-out`·`--ease-sheet`(바텀 시트 곡선)과, 용도별 별칭 `--motion-move`(이동·확대·회전)·`--motion-fade`(투명도)만 쓰고 규칙에 ms·s·`ease`를 직접 쓰지 않는다. `styles/motion.css`는 키프레임 4종(`motion-fade-in`·`pop-in`·`drop-in`·`rise-in`)과 역할 이름 클래스 `.motion-overlay`(배경 페이드)·`.motion-dialog`(페이드+확대)·`.motion-menu`(페이드+아래로 드롭)·`.motion-toast`(페이드+위로 라이즈)·`.motion-lift`(hover 시 2px 떠오름, hover 가능한 기기만)를 둔다. 화면 코드는 효과가 아니라 역할 클래스만 붙인다. 진입 애니메이션만 있고 퇴장은 없다. 전역 `button`·`.btn-*`·`.sm-btn`은 hover 색(`--motion-fast`)·눌림 `scale(0.98)`(`--motion-press`)·키보드 포커스 외곽선을 공통으로 따른다.
- **모션 줄이기(`prefers-reduced-motion: reduce`):** `tokens.css`가 `--motion-press`·`--motion-fast`·`--motion-move`를 0ms로 다시 정의해 이동·확대·회전은 즉시 적용하고 투명도 페이드(`--motion-fade`)만 남긴다. 새 규칙은 토큰만 쓰면 자동으로 따른다. 토큰으로 끌 수 없는 무한 반복 애니메이션(스피너·단계 점 펄스 등)은 규칙마다 `animation: none`을 둔다. 옛 전역 `* { transition: none !important }`는 없다.

## 앱 셸

`app/AppShell`이 사이드바 + workarea(TopBar + 본문)를 짜고, Dock·StickStatus·아바타는 셸 루트에 `fixed`로 한 인스턴스만 둔다(전체 화면 전환 때 언마운트되지 않는다).

- **Sidebar:** 펼침 240px · 접힘 80px(아이콘만, `title` 툴팁). 실제 접힘 = 설정 `sidebarCollapsed` 또는 태블릿 폭(≤1024px, `useSidebarCollapsed`)이라 ≤1024에서는 강제로 접히고 펼치기 버튼이 없다. 본문 여백은 40, 태블릿은 24. 데스크톱 헤더는 높이 56px로 페이지 제목·Dock과 중심이 같고 첫 메뉴는 y=72px이다. 펼치면 사이드바에 `SSAPLASH` 워드마크 이미지(`public/images/ssaplash-wordmark.webp`, 높이 18px. 랜딩 상단 바도 같은 이미지를 높이 22px로 쓴다)와 접기 버튼이 보이고, 접으면 펼치기 버튼만 남는다. 로고 `S` 심벌 이미지(`public/images/ssaplash-symbol.webp`, 워드마크의 첫 S와 세 줄무늬, 높이 24px, 장식이라 `alt=""`)는 사이드바 상태와 관계없이 상단 바 페이지 제목 왼쪽에 12px 간격으로 표시한다. 태블릿은 강제로 접히고 사이드바 토글이 없다. 접을 때는 라벨이 먼저 사라지고(opacity) 폭이 200ms 줄며, 펼칠 때는 폭이 먼저 늘고 라벨이 뒤따른다(접힌 라벨은 `aria-hidden`). 토글의 `aria-expanded`는 펼침 상태를 나타낸다. 토글 아이콘(`SidebarToggleIcon`)은 하나이고 화살표만 접힘에서 오른쪽을 가리키도록 180° 회전한다. 하단에는 설정만 있고 로그아웃은 프로필 메뉴에 있다. Dock은 `left` 대신 `transform`으로 본문 가운데를 따라간다.
- **악보 연습 하위 메뉴(S15P31A307-337):** 메뉴는 평평하지만 예외가 하나 있다. 사이드바가 펼쳐져 있고 악보 연습 안(`/sheet`, `/sheet/lesson/…`)에 있으면 「악보 연습」 바로 아래에 곡 범위 네 항목(기본 곡·내 곡·AI 추천곡·학습 코스)이 펼쳐진다(`ul.side-sub`). 항목은 주소 링크다: `/sheet` · `/sheet?scope=MINE` · `/sheet?tab=recommend` · `/sheet?tab=lessons`. 지금 범위에 `aria-current="page"`가 붙고(알아보기 레슨 화면은 학습 코스), 곡 고르기 안에서 범위만 바꿀 때는 방문 기록을 쌓지 않는다. AI 추천곡·학습 코스는 로그인했고 곡 출처가 서버일 때만 보이고, 내장 곡 출처면 하위 메뉴가 없다. 접힘·태블릿(≤1024px)·다른 화면에서는 보이지 않는다. 곡 고르기의 화면 위 범위 버튼은 사이드바가 펼쳐져 있어도 항상 보인다(11/13 요청으로 다시 둠, 하위 메뉴와 같은 주소를 바꾸므로 항상 같은 항목이 켜진다). 모양은 세로 선·숫자 없이 들여쓰기(글자 24px 시작)와 고른 항목의 배경색(`--brand-tint`)뿐이고, 현재 위치 표시(`.side-active-mark`)는 부모 「악보 연습」에만 둔다. 사이드바와 곡 고르기는 서로를 모르고 같은 순수 함수(`domain/song/sheetCategory`: 주소 값 ↔ 범위, 보일 범위, 표시 이름)와 주소만 같이 본다. 내 곡 범위 이름이 「내 곡」인 것은 사이드바에 이미 「라이브러리」(곡 작업실) 메뉴가 있어서다. 화면 위 버튼도 같은 이름(`SHEET_CATEGORY_LABEL`)을 써서 악보 연습·리듬 게임 모두 「기본 곡 · 내 곡 · AI 추천곡 · 학습 코스」다.
- **리듬 게임 하위 메뉴(S15P31A307-405):** 악보 연습과 같은 규칙으로, 사이드바가 펼쳐져 있고 리듬 게임 안(`/play`와 그 아래)에 있으면 「리듬 게임」 바로 아래에 기본 곡·내 곡·AI 추천곡·**미니게임**이 펼쳐진다(`ul.side-sub`, `aria-label="리듬 게임 메뉴"`). 앞의 셋은 곡 고르기의 범위 링크(`/play` · `/play?scope=MINE` · `/play?tab=recommend`)이고 「미니게임」은 `/play/mini`다. AI 추천곡은 로그인했고 곡 출처가 서버일 때만 보이고, 내장 곡 출처라 범위가 없어도 「미니게임」은 보인다. 현재 표시는 미니게임 경로(`domain/play/miniGame.isMiniPath`)면 「미니게임」에만, 아니면 주소의 범위에 붙는다. 미니게임 화면에서도 부모 「리듬 게임」이 활성이다(`/play` 아래 경로). 접힘·태블릿에서는 하위 메뉴가 보이지 않으므로 리듬 게임 곡 고르기의 범위 줄 옆에 「미니게임」 링크를 따로 둔다. 보일 범위는 `domain/song/sheetCategory.visiblePlayCategories`(학습 코스 제외)가 정한다.
- **TopBar:** 높이 56. 제목은 페이지가 알린 값, 없으면 `defaultTitles`의 라우트별 기본값(예: `/studio` "내 곡", `/setup` "드럼 세팅").
- **라우트 전환:** 본문(`<Outlet/>`)은 `key={pathname}`의 `.route-view.route-fade` 래퍼 안에서 160ms(`--motion-route`) 페이드 인한다(쿼리만 바뀌면 그대로, 나가는 화면 연출 없음). 같은 화면 안 단계 전환도 `StageFade`(`.stage-fade`, 같은 페이드·토큰)로 감싼다 — 리듬 게임·악보 연습의 로딩·곡 선택·준비는 페이드, 준비 → 연주(immersive)는 즉시. 사이드바 현재 위치 표시는 `layoutId="side-active"` `m.span` 하나가 활성 항목으로 200ms ease-out 미끄러진다(motion 기능 도착 전에는 제자리에 바로 보이고, 모션 줄이기에서는 즉시 이동). 연주 화면도 같은 래퍼이고 immersive 전환(사이드바·TopBar 언마운트)은 즉시다. 경로가 바뀐 뒤에는 스크롤을 맨 위로 올리고 포커스를 옮긴다 — 셸 화면은 TopBar 제목 `h1`, immersive 화면은 본문 래퍼(둘 다 `tabIndex={-1}`, 외곽선 없음). 첫 로드에는 옮기지 않는다.
- **코드 분할 (S15P31A307-349):** 첫 진입 화면인 자유 연습(`/free`)·로그인 콜백만 정적 import하고(랜딩은 로그인 사용자가 쓰지 않으므로 지연 로드), 나머지 화면은 `app/routeModules`의 import 표를 거쳐 `lazy(() => loadRoute(key))`로 지연 로드한다. 새 화면은 표에 키를 추가하고 `App.tsx`에서 연결한다(페이지는 named export 그대로). `loadRoute`는 키마다 Promise를 하나만 만들어 두고, 실패하면 캐시에서 지워 다음 이동에서 다시 받는다. Suspense 경계는 AppShell의 `key={pathname}` 래퍼 **바깥**과 PublicLayout의 Outlet 바깥에 하나씩, 랜딩 라우트에 하나 있다(fallback 없음). 라우터가 이동을 transition으로 처리하므로 다음 화면 코드가 올 때까지 지금 화면이 그대로 남는다. 경계를 keyed 래퍼 안이나 라우트마다 두면 이동할 때 본문이 비니 옮기지 않는다. 새로고침·직접 진입처럼 첫 렌더가 지연 화면이면 셸이 먼저 보이고 본문이 이어서 뜬다. 셸에서 조건부로만 뜨는 UI(DebugOverlay·추천 동의 창)도 지연 로드한다. `VITE_MONITOR`·`import.meta.env.DEV` 조건 화면은 상수 삼항으로 감싸 미설정 빌드에 청크가 생기지 않는다.
- **청크 로드 실패 복구:** 배포로 옛 청크가 사라진 뒤 열려 있던 탭에서 이동하면 화면 import가 실패한다. AppShell·PublicLayout의 `RouteErrorBoundary`(Suspense 바깥, `resetKey={pathname}`)가 받아 `config/chunkRecovery.isChunkLoadError`로 판별하고, 청크 오류면 `tryAutoReload`로 그 경로를 1회 새로고침한다. 같은 경로에서 30초(`RELOAD_GUARD_MS`) 안에 다시 실패하거나, 녹음 중·저장 대기 중이거나, sessionStorage를 쓸 수 없으면 새로고침하지 않고 본문 자리에 「새 버전이 있어요」와 [새로고침]을 보인다(셸은 그대로, 다른 메뉴로 이동하면 풀린다). 화면 CSS·의존 청크 미리 받기 실패(`vite:preloadError`)도 같은 규칙이다. 청크가 아닌 렌더 오류는 자동 새로고침 없이 「화면을 불러오지 못했어요」를 보이고 콘솔에 남긴다. 셸 밖 오류는 `main.tsx`의 `errorElement`(`RouteErrorElement`)가 같은 안내를 전체 화면으로 그린다. 판별 문구를 늘릴 때는 `chunkRecovery.test.ts`에 같이 추가한다.
- **모르는 주소(404):** `app/App.tsx` 라우트 표의 마지막 `path="*"`가 `components/shell/NotFoundPage`를 그린다. 셸 안·`RequireAuth` 아래라서 로그인한 사용자는 사이드바가 보이는 채로 「페이지를 찾을 수 없어요」와 [자유 연습으로](`/free`)를 보고, 로그인하지 않은 사용자는 다른 보호 화면처럼 `/login`으로 간다. `/studio/abc`처럼 아는 경로 아래의 모르는 주소도 같은 화면이다. `/result/없는id`처럼 경로는 맞고 대상만 없으면 각 화면이 「찾을 수 없어요」를 그린다. 지연 로드하지 않는다(메인 묶음). 새 경로를 추가할 때는 이 줄 위에 둔다.
- **오류·빈 상태 고르는 기준:** 보여 줄 내용이 원래 없는 것(빈 목록·필터 결과 없음·대상 없음)은 `ui/EmptyState`(목록 자리의 한 줄 안내는 `size="sm"`). 불러오기 실패는 그 구역에 다른 내용이 하나도 없으면 `ui/ErrorState`(패널: 오류 아이콘 + 제목 17px + 설명 + 작은 보조 버튼, `onRetry`를 주면 [다시 시도]), 목록·카드·머리 등 다른 내용이 남아 있으면 `ui/InlineError`(내용 폭만큼만 차지하는 높이 32 캡슐: 아이콘 + 문구 + [다시 시도] 글자 버튼, 버튼은 항상 문구와 같은 줄. 곡 카드·재생 바처럼 좁은 자리는 바탕 없는 `plain`). 둘 다 `role="alert"`를 스스로 갖는다. 화면에 다른 제목이 없으면 `headingLevel={2}`를 준다. 화면·탭 본문 가운데에 혼자 뜨는 자리는 둘 다 `size="lg"`를 줘서 여백·글자·버튼을 함께 키운다(알림 줄 높이 44, 패널 제목 22px). 오류 문구에 버튼을 직접 붙여 그리지 않는다. 폼·창 안의 제출 오류(재시도 버튼 없음)는 지금처럼 `notice error`를 쓴다.
- **라이브러리 청크:** `vite.config.ts`의 `build.rolldownOptions.output.codeSplitting.groups`가 react·react-dom·scheduler·react-router(-dom)·zustand를 `vendor-react`로, entry에서 정적으로 닿는 motion 모듈만(`tags: ['$initial']`) `vendor-motion`으로 묶는다. 앱 코드만 바뀐 배포에서는 두 파일 이름이 그대로라 브라우저 캐시를 다시 쓴다. motion의 `domMax`(`app/motionFeatures`)는 지연 청크로 남는다. `chunkSizeWarningLimit`은 올리지 않는다.
- **페이지 제목(`ui/PageHeader`):** 곡 선택(리듬 게임·악보 연습)·라이브러리·연주 기록·설정·연주 환경 설정은 같은 머리를 쓴다. 제목은 h2 `t-title-36`(36/700, ≤560px 28)이고 제목 아래 설명 줄은 두지 않는다. 제목 옆 작은 정보는 `meta`, 오른쪽 끝 버튼·진행 표시는 `actions`. 화면 이름 h1은 상단 바가 맡는다. 공용 곡 관리(관리자)는 기존 머리 그대로.
- **⋯ 메뉴·프로필 메뉴 틀(`ui/overlay/Menu`, `ui/overlay/MoreMenu`):** Radix Popover(`@radix-ui/react-popover`)로 그린다. 팝오버는 body 끝(portal)에 떠서 `.studio-list`·창의 `overflow`에 잘리지 않고, 트리거 아래로 펼치되(`side=bottom`, `sideOffset 4`) 화면·스크롤 영역 아래 공간이 모자라면(`collisionPadding 8`) 위로 뒤집힌다(`data-side="top"`, 진입 모션도 반대 방향 `motion.css`). 위치는 CSS가 아니라 Radix가 정하고 `.ui-more-menu-list`·`.profile-menu`는 모양만 가진다. 트리거가 공용 Dialog(`.dialog`) 안에 있으면 그 창 요소 안에 그려 `useDialogFocus`의 포커스 가두기와 충돌하지 않게 한다. 바깥 클릭·Esc로 닫히고, Esc·항목 선택 뒤 초점은 트리거로 돌아온다(바깥 클릭으로 닫힌 때는 가져오지 않는다). 열 때 초점은 트리거에 그대로 둔다. 바깥 API(`renderTrigger`·`align`·`menuClassName`·`menuLabel`·`onOpenChange`, `role="menu"`)는 그대로다.
- **GlassDock:** 상단 가운데 글래스 Dock(음량 토글·메트로놈 칩·BPM ±·프리셋 이름). 모드는 `shell`(일반) / `play`(전체 화면 연주, 일시정지 버튼 추가) × 접힘 여부 4변이다. 칩 본체를 누르면 `MetronomePanel`(Dock 아래 오른쪽 360, `shellStore.dockPanel`)이 열리고, 열려 있는 동안 칩 전체(아이콘·숫자·스위치)를 은은한 브랜드 색으로 감싼다(`.dock-metro-chip.open`, Dock 폭은 그대로). 칩의 BPM 숫자는 정수로 반올림해 보인다 — 곡 BPM이 소수(78.43)면 40px 칸을 넘어 스위치와 겹치기 때문이다(계산은 원래 값). **접기**는 줄이기가 아니라 왼쪽 슬라이드다: 오른쪽 끝 «(「Dock 접기」)를 누르면 메트로놈 칩·BPM ±·녹음 버튼 묶음이 폭 0으로 미끄러져 사라지고(0.2s, 모션 줄이기면 즉시) Dock은 가운데 정렬 그대로 좁아진다. 접혀도 높이 48·버튼 32·아이콘 20은 그대로이고 음소거·메트로놈 아이콘 스위치·(녹음 버튼이 있는 화면이면 녹음 상태 아이콘 — 꺼짐은 흐린 원, 녹음 중은 빨간 원, 표시만)·(연주 화면이면 일시정지)·»(「Dock 펼치기」)만 남는다. 남은 아이콘은 접힌 채로 바로 조작되고 Dock을 펼치지 않는다. 스틱 연결이 필요한 센서인데 한 손이라도 끊기면 프리셋 칩이 「● L ● R 준비 필요」(amber)로 바뀐다(`domain/kit/device/dockChip`, 키보드 전용·포인터 모의 IMU는 제외).
- **StickStatusIndicator·ProfileMenu:** 오른쪽 위 고정.
- **페이지 선언:** 페이지는 `useShell({ title, immersive })`로 제목과 전체 화면 여부를 알린다. `immersive`면 Sidebar·TopBar가 사라지고 본문이 전폭이 된다. 언마운트하면 자기가 바꾼 필드만 기본값으로 돌아간다. 이 상태는 `store/shellStore`에 있고 영속하지 않는다(현재 `/settings`·`/history`가 사용, 나머지 화면은 아직 기본 제목).
- **영속 설정 키:** `sidebarCollapsed`·`dockCollapsed`. 같은 settings v12에 `liveCoach`(실시간 코칭, 기본 켬)도 추가됐다. v12의 `statsConsent`(브라우저 저장 동의)는 v14에서 삭제했다 — 연주 기록 활용 동의는 가입 때 필수라 서버 값만 쓴다.

## 드럼 컴포넌트

- **`components/drum/DrumKit`:** 연주 화면용 드럼 킷 SVG. 킷 상자는 스킨마다 다르다(`domain/kit/drumKit`의 `kitBoxFor(skin)`): 실물 `acoustic`은 760×486.9, 전자·네온은 760×300이고 여기에 `scale`을 곱한다. **실물(`acoustic`)**은 조각 이미지를 자리 표(`domain/kit/kitArt`)대로 놓은 **9패드**(하이햇 페달 포함, 그리는 순서는 뒤 → 앞)이고 `DRUM_KIT_PADS`가 이 표에서 만들어진다. 패드마다 헤드(중심·반지름)가 따로 있어 누름 영역(헤드 타원, 조각 상자끼리는 겹친다)·상태 링·라벨·판정 글자·타격 이펙트 자리를 이 값으로 잡는다. 심벌(크래시·라이드·하이햇)의 원판은 받침과 별도 조각이라 타격 때 원판만 흔들린다. **전자·네온**은 지금처럼 벡터 8패드(하이햇 페달 제외, 760×300)다. `fitWidth`면 부모 폭에 맞춰 `scale`까지 줄이고, `fitContain`이면 부모 폭·높이 모두에 들어가게 맞춘다. 자유 틀 `frame`(드럼 세팅 편집·보정)은 `scale`·`fitWidth`·`fitContain`을 무시하고 패드별 헤드 가로 반지름이 원근 타원과 같아지도록 조각 크기를 정한다(`domain/kit/kitFrame`, 자유 틀은 늘 원근 그림). 패드별 `states`(`idle`·`hit`·`perfect`·`good`·`miss`)와 `badges`(+`highlight`)를 받고 `labels`·`onPadClick`을 쓴다. 고정 배치(`frame` 없음)는 판정 배치(`kitLayout`)와 무관한 표시 전용이다 — 드럼 세팅의 「내 드럼」과 보정 팝업도 이 고정 그림을 쓴다.
- **하이햇 닫힘·페달 없음 표시(실물 스킨, 설계 `.claude/plans/DESIGN-acoustic-kit-image.md` 3-5·4-4):** 화면이 `useHihatPedal()`로 `liveStore.pedal`에서 값 둘을 읽어 `DrumKit`의 `hihatClosed`·`pedalOff`로 넘긴다(킷이 스토어를 직접 구독하지 않는다). 닫힘은 소리와 같은 규칙이다 — 왼발 페달이 연결되어 있고 밟지 않았을 때만 열림, 그 밖에는 닫힘. 페달이 연결되어 있지 않으면(키보드·터치만, 끊김 포함) 닫힌 하이햇에 발판을 어둡게(밝기 32%) 그린다. `hihatClosed`를 넘기지 않는 킷(스킨 고르기·안내 그림)은 닫힌 그림으로 고정한다. 윗판이 아래로 28px(원근 원본 픽셀) 내려가 닫히고(80ms, `--motion-press`) 올라올 때는 120ms(`--motion-fast`)이며 발판도 같이 눌린다. 하이햇 페달 타격(`pedalHitSeq`, 키보드 B처럼 밟힘 상태가 안 오는 입력 포함)은 윗판이 4px 더 눌렸다 돌아오는 「칙」 모션을 낸다. 닫힌 하이햇은 흔들림 각도가 절반이다. 판정 링·글자·이펙트는 `LiveDrumKit`처럼 페달 값을 넘기는 화면에서도 하이햇에 그대로 뜬다. 모션 줄이기에서는 전환 없이 자리만 바뀐다(토큰이 처리).
- **실물 드럼 그림과 조각 이미지:** 그림은 원본 이미지 한 장을 패드별 조각(WebP 12장: 하이햇은 받침·윗판, 심벌은 원판 조각이 따로 있다)으로 잘라 `components/drum/acoustic/persp/`(위에서 본 그림은 `top/`)에 두고(`sprites.ts`의 `spriteUrl(name)`이 import 표), 패드 한 개를 그리는 `AcousticPad`가 이미지를 놓는다. 조각 이름·헤드·링·라벨·고정 배치 자리는 `domain/kit/kitArt.ts`(원근 `KIT_ART_PERSP`)에 있다 — **이 파일은 도구가 만드는 생성물이라 손으로 고치지 않는다.** 조각 이미지는 `components/drum/acoustic/`에서만 import하고(해시 파일명이라 그림을 바꿔도 옛 캐시가 남지 않는다) `domain`은 숫자만 가진다. 실물 스킨이면 `app/bootstrap`이 시작 뒤 한가할 때(`requestIdleCallback`, 없으면 1.5초 뒤) `preloadSprites()`로 두 벌(24장)을 미리 받는다(한 번만). 이미지가 오기 전에도 킷 크기와 누름 영역은 같아서 치는 동작과 소리는 된다. 벡터 실물 그림은 없앴다(전자·네온만 벡터).
- **그림 만드는 도구(`FE/scripts/kit-art/`):** 원본 그림이 **바뀌었을 때만** 한 번 돌리는 개발용 Python 도구다(앱이 부르지 않고 빌드에 들어가지 않는다). 원본을 `FE/scripts/kit-art/source/persp.png`에 두고 `pip install pillow numpy scipy` → `python FE/scripts/kit-art/build.py`를 돌리면 조각 이미지와 `domain/kit/kitArt.ts`가 나오고, `out/persp-check.jpg`(조각을 제자리에 다시 놓고 헤드 타원을 그린 확인용 그림)에서 타원이 헤드에 맞는지 본 뒤 결과 파일을 커밋한다. 영역 표는 `regions.json`이다. **원본 이미지는 용량 때문에 저장소에 올리지 않는다**(`source/`는 `.gitignore`). 자세한 절차는 `FE/scripts/kit-art/README.md`.
- **작은 킷의 위에서 본 그림(`view="top"`):** 실물 스킨에서 `DrumKit`의 `view`를 `'top'`으로 주면 위에서 본 그림(자리 표 `KIT_ART_TOP`, 킷 상자 760×650.7, 조각은 `acoustic/top/*.webp` 12장)으로 그린다. 기본은 `'persp'`(원근, 큰 킷)이고, 전자·네온과 자유 틀(`frame`, 늘 원근)은 `view`를 무시한다. `view`는 킷 상자·viewBox·고정 배치표(`kitPadsFor(skin, view)`, 위에서 본 표는 `DRUM_KIT_PADS_TOP`)·조각 이미지 폴더(`spriteUrl(name, view)`)·`FxCanvas`(`view` 속성, 엔진 `setSkin(skin, view)`, `fxGeoOf(pad, skin, view)`의 바닥선)에 같이 내려간다. 위에서 본 그림의 하이햇은 `closeDy`가 없어 윗판이 오르내리지 않고(페달 밟힘 자세·「페달 없음」 어둡게·심벌 흔들림은 그대로) 글자·배지는 킷이 작아 최대 2.4배까지 키운다(원근은 1.6배). 작은 연주 킷은 `smallKitSpec(screen, skin)`이 `{ view, scale }`을 정한다 — 실물은 `top`이고 리듬 게임(`PlayPage`) 233.6×200 · 악보 연습(`SheetPage`) 245.3×210이며, 전자·네온은 기존 그대로(게임 0.5배 380×150, 악보 0.7배 532×210)다. 악보 연습은 이 크기가 최소이고 화면 높이에 맞춰 더 키운다 — 킷 칸 크기는 `PlayStage`의 `kitSize`로 넘긴다(아래 「악보 연습 화면 배치」). 악보 연습 안내 장면(`SheetGuideScene`)은 `guideKitPlace(skin)`으로 실물이면 위에서 본 그림을 킷 칸 높이(255)에 맞춰 가운데에 놓고 연결선 끝도 같은 변환으로 계산한다. 그 밖의 고정 킷(스킨 고르기·타격 이펙트 미리보기·레슨·보정 안내)은 원근 그림이다. 스킨 고르기·이펙트 미리보기는 세 스킨의 높이가 달라 카드가 뛰지 않도록 미리보기 상자를 220px로 고정하고 `fitContain`으로 맞춘다.
- **악보 연습 악보 배율·HUD 자리:** 악보 연습 악보(`SheetPager`)는 칸 높이에 맞춰 1.2배부터 칸 폭이 허락하는 최대(1.6~2.6배, `staffScale(높이, 폭)`)까지 키워 그리고, HUD는 리듬 게임과 같은 1060px 열에 위 줄(Dock·칩) 아래(y 64)부터 둔다. 악보는 칸의 세로 가운데에 놓는다(`staffOffsetY`): 그림 좌표는 보표 위가 비어 있어 위로 올려 맞추고, 칸이 악보보다 낮으면 위 끝(마디 번호)을 칸 위에 맞춘다. 타이밍 막대를 켜면 칸 아래 막대 자리(`OVERLAY_RESERVE_PX` 28px — 얇은 막대 18 + 아래 여백 8 + 틈 2)를 빼고 배율과 위치를 정해 박 번호가 막대에 가리지 않는다. HUD와 악보 사이는 구분선 위아래 8px이다. 결과 화면 `SheetSnippet`은 배율 1 그대로다.
- **악보 연습 화면 배치(악보 칸·킷 높이 나누기, 설계 `MODE-003-practice-speed` D18~D20):** HUD 아래 세로 높이를 악보 칸과 킷이 빈 곳 없이 나눠 쓴다(화면이 100vh를 꽉 채운다). `features/play/components/stage/kit/sheetKitFit`이 창 크기에서 킷이 쓸 상자를 낸다(`useSheetKitFit`): 악보 칸 몫은 남는 높이의 43 %(최소 274px, 최대는 그 폭에서 악보가 가장 크게 그려지는 높이 `sheetAreaMax` — 넓은 화면 422px), 킷은 그 나머지(높이 210~640, 폭은 양옆 칸 280씩을 뺀 나머지)다. `smallKitSpec('sheet', skin, fit)`이 그 상자에 들어가는 배율을 정하고(기본 크기보다 작아지지 않는다) `SheetPage`가 킷 크기를 `PlayStage`의 `kitSize`로 넘기면 CSS 변수 `--kit-w`·`--kit-h`가 킷 칸과 드럼 줄 높이가 된다. 악보 칸은 CSS에서 남는 높이를 모두 갖는다(`flex: 1`) — 킷이 최대 크기에 닿았거나 가로로 긴 네온·전자 킷이라 높이를 다 못 쓰면 그 높이는 악보 칸으로 간다. 악보는 칸 높이에 맞춰 커지되 최대 배율은 칸 폭이 정한다(`staffScaleMax`: 논리 폭이 494 아래로 내려가지 않는 만큼, 1.6~2.6배 — 이때 한 화면은 두 마디이고 마디 폭이 네 마디 배치의 가장 좁은 마디보다 좁아지지 않는다). 타이밍 막대는 박 번호 바로 아래에 얇게(`TimingBar`의 `thin` — 막대 6px, 색은 진하게) 두고 양 끝에 「빠름」·「늦음」 글자를 단다(`labels`). 칸이 악보보다 높으면 악보는 칸 가운데에 놓이고 막대도 그만큼 올라간다(`overlayLift` → CSS 변수 `--sheet-overlay-lift`). 킷 이펙트 캔버스가 화면 아래로 넘치지 않게 악보 연습 화면은 `overflow: clip`이다. 실제 크기(실물 킷): 1280×860 악보 칸 276·킷 429×367, 1920×1080 악보 칸 371·킷 575×492, 1629×1282 악보 칸 425(악보 2.6배)·킷 748×640, 1024×768 악보 칸 274·킷 324×277, 1280×680 악보 칸 253·킷 246×210(예전 크기). 리듬 게임의 막대와 킷은 그대로다.
- **드럼 모양:** 설정 › 연주의 "드럼 모양"(실물 `acoustic` / 전자 `electronic` / 네온 `neon`)을 `DrumKit`의 `skin`이 받는다. 값은 설정 스토어 `kitSkin`에 기기별로 로컬 저장하고 서버 동기화 대상이 아니다. `hitSeq`는 패드별 타격 모션 재생용이다. `onPadDown`이 있으면 킷이 터치 표면이 되어 `touch-action: none`을 쓰고 포인터 모의 IMU는 이 킷을 무시한다(`data-no-pointer-strike`).
- **타격 이펙트 테마:** 설정 › 연주의 "타격 이펙트"(기본 `auto` / 전기 `electric` / 물 `water` / 불 `fire`)를 설정 스토어 `hitFxTheme`에 기기별로 로컬 저장한다(settings v20). `DrumKit`에 `effects`가 있으면 SVG 위에 캔버스(`components/fx/FxCanvas`)를 겹쳐 그린다. 타격은 liveStore를 직접 구독해 React 렌더 없이 파티클 엔진(`fxEngine`, 동시 200개 상한, 비면 rAF 정지)에 들어간다. 테마 정의·생성 함수·세기 변환은 순수 함수(`domain/hitFx/`)다. 패드 흔들림은 테마와 무관하게 세기 100 이상 드럼·킥에서 동작한다. 잉크 `ink`·픽셀 `pixel`은 랩 전용이다.
- **연속 그림 타격 이펙트(물·불·전기, 설계 `.claude/plans/MODE-002-water-splash-fx.md`):** 세 테마는 한 타를 「연속 그림(스프라이트 시트) 1회 재생 + 입자 몇 개」로 낸다. 솟는 덩어리(물막·불길·방전)는 미리 계산해 둔 그림이, 그림 밖으로 날아가는 방울·불티·불꽃과 헤드 섬광은 입자가 맡는다. 그림은 파티클의 한 종류(`kind: 'sheet'`, 재생 한 번이 파티클 한 개이고 배열 맨 앞)이고 입자 중 날아가는 것은 `drop`(속도 방향으로 늘어난 캡슐)이다. 묶음은 테마마다 4개(`side-a`·`side-b`·`cymbal`·`front`)이며 표(`domain/hitFx/sheets.ts`)에 길이·시간표 지수·크기(`span`)·헤드 중심(`cy`)이 있다. 24장·6열·한 장 256px의 WebP이고 `public/fx/<id>.v1.webp`에 있다. 재생할 때는 시간표를 거꾸로 풀어 이웃한 두 장을 섞어 그린다(느린 재생에서도 끊기지 않는다). 패드가 킥이거나 헤드 세로÷가로가 0.85 이상(전자·네온·위에서 본 그림)이면 정면 그림, 심벌이면 심벌 그림, 그 밖의 드럼은 옆 그림 둘 중 하나를 난수로 고른다. 하이햇 페달은 그림 없이 입자만의 작은 이펙트(`spawn/*Lite.ts`)를 쓴다. 옆·심벌 그림은 실물 킷의 큰 그림(헤드 비율 약 0.7, 44° 위에서 본 각도)에 맞춰 그렸다. 심벌(하이햇·크래시·라이드) 그림은 세 테마 모두 가장자리에서 사방으로 튀는 모양이다: 물은 가는 물보라(자주 치는 작은 패드라 드럼보다 덜 튀게 솟는 높이·퍼지는 거리를 75%로 줄였고 앞 보케가 없다), 불은 가장자리 고리가 번쩍인 뒤 불똥이 사방으로 튀어 식으며 떨어지고, 전기는 가장자리에서 바깥으로 방전이 뻗고 불꽃이 튄다. 심벌의 입자도 가장자리에서 바깥으로 튀는 `drop`이다(불 불똥 최대 9개, 전기 불꽃 최대 9개). 그림은 투명 바탕에 색이 구워져 있고(이펙트 캔버스가 킷 위의 투명한 층이라 검은 바탕이면 킷을 가린다) 더하기 합성으로 얹으며, 좌우 뒤집기·기울기·크기를 seq 난수로 조금씩 바꾼다. 게임·악보 모드는 그림 ×0.72·재생 ×1.3이고 앞 보케가 없다.
  - **보관소(`components/fx/fxSheets`):** 엔진이 고른 테마의 묶음만 불러와 디코드하고(`setTheme` → `use`), 테마를 바꾸거나 캔버스를 떼면 놓아준다. 같은 묶음은 한 번만 받고, 여러 소유자(캔버스) 중 하나라도 쓰면 유지한다. 준비되기 전·실패·`Image`가 없는 환경·기기 메모리 4GB 미만이면 입자만의 대체 함수(`spawnLite`)로 낸다. 모션 줄이기는 그림 없이 덩어리 1개만이다.
  - **상한:** 한 타는 판정 파티클 수 + 테마 `maxSpawn`(물 16·불 12·전기 12·나머지 24), 살아 있는 그림은 12개까지(넘으면 오래된 것부터), 전체 200개는 그대로다. 수명 상한(`maxLifeMs`)은 물·불 640ms, 전기 360ms다. 캔버스 위쪽 여백은 테마가 정한다(`bleedTop`: 물 0.4·불·전기 0.35·나머지 0.12, 좌우·아래 0.12).
  - **그림 다시 만들기:** `scripts/fx-sheets/`의 Python 스크립트가 12장을 계산한다(실행법·설정·씨앗은 그 폴더의 README). 빌드는 스크립트를 돌리지 않고 결과 WebP만 쓴다. 그림을 바꿨으면 `build.py`의 `VERSION`과 `sheets.ts`의 파일 이름을 같이 올린다.
- **판정별 이펙트 차등·타이밍 막대:** 리듬 게임·악보 연습에서는 페이지의 `onHit`이 `judgedFxEvent`로 판정(PERFECT·GOOD)·헛침·비판정 이벤트를 만들어 패드·하이웨이(또는 악보) emitter에 보내고, 놓친 노트(MISS)는 `onJudgement`에서 하이웨이·악보로만 보낸다. 패드 이펙트는 판정 배율(PERFECT 크고 하늘색 링, GOOD 작고 초록 링, 헛침은 회색 퍼짐)을, 하이웨이는 판정선 흡수 폭발과 놓친 노트 깨짐을, 악보는 노트 머리 고리·파편과 친 위치 눈금을 받는다. 판정 색은 `--perfect`·`--good`·`--miss` 토큰이고 판정 이펙트는 테마와 무관하다(`domain/hitFx/judgeFx`). 설정 › 연주의 "타이밍 막대"(`timingBar`, 기본 켬)는 게임 판정선 아래·악보 영역 아래에 최근 20타의 빠름/늦음을 눈금과 최근 10타 평균 삼각형으로 보인다. 판정 범위(±goodMs) 밖으로 친 채보 밖 타격 가운데 앞뒤 2 × goodMs 안에 같은 패드의 아직 치지 않은 노트가 있는 것은 막대 양 끝 바깥에 MISS 색 점(왼쪽 너무 빠름·오른쪽 너무 늦음)으로 2초간 보인다(`StrayHitEvent.nearDeltaMs` → `strayMissSource`). 이미 친 노트 옆의 추가 타격·다른 패드 타격·치지 않은 노트는 점이 없고, 점은 평균에 넣지 않는다. 캔버스는 막대 240 + 좌우 점 자리 12씩(264×14).
- **FX 랩(개발 전용):** 개발 서버에서 `/dev/fx`. 테마 A/B 비교, 판정 선택(PERFECT·GOOD 빠름/늦음·헛침·섞기)·깨짐 미리보기, 자동 연주 패턴(8비트·16분 필인·크래시 연타·스트레스), 세기 고정, 발광 끄기·모션 줄이기 강제, 이펙트 처리 시간(평균·p95)·파티클 수 표시. 콘솔에서 `window.__fxLab`으로 같은 조작·측정을 할 수 있다. 콤보 미리보기(2 → 10 → 50 → MISS 순서, 위치 A/B 선택)·축하 미리보기 버튼과 `window.__fxLab.playCombo(seq)`·`celebrate()`도 있다(축하 캔버스의 처리 시간은 합계에 들어간다). 재생 속도(1·0.5·0.25·0.1배)·일시정지·한 프레임 넘김(16.7ms)으로 연속 그림 이펙트를 느리게 볼 수 있다(`engine.setTimeScale`·`setPaused`·`stepFrame`, 이펙트 엔진 안의 가상 시계에만 걸리고 소리·판정 시각·프레임 통계는 그대로. `window.__fxLab`에도 같은 조작이 있다). 프로덕션 빌드에는 라우트·코드가 들어가지 않는다.
- **점수·판정 스탬프·콤보·결과 축하(MODE-001, 설계 `.claude/plans/MODE-001-score-combo-fx.md`):** 게임 HUD 점수는 `PlayHud.ScoreValue`가 `MotionValue`로 240ms 카운트업하며 DOM 텍스트만 바꾼다(판정 1회 = React 렌더 1회, 올라갈 때 브랜드색 번쩍). 하이웨이 판정 팝업은 캔버스 안에서 네온 `--fx-*` 색으로 그린다(PERFECT 스케일 오버슈트, GOOD 작은 스탬프+±ms, MISS 좌우 흔들림, 글로우는 `shadowBlur` 없이 굵은 반투명 stroke, 동시 16개; 시간 곡선은 순수 함수 `features/play/components/pause/popupLook`). 콤보는 하이웨이 상단 `play/ComboDisplay`(≥2 두 줄, 10배수 pulse, 50·100·이후 50배수 burst, 10 이상 MISS면 흔든 뒤 숨김)가 `features/play/domain/comboFx.comboStage` 결과대로 재생한다 — 위치 A(상단 중앙 상시)가 기본이고 `placement="stage"`(클래스 `combo-display--stage`)로 B(단계 때만)로 바꾼다. 악보 모드는 콤보 연출이 없다. 결과는 연주 시작 시점의 치기 전 최고값(GOOD 폭이 같은 로컬 로그 + 기본 폭일 때만, 시작 확인 창이 열린 동안 받은 서버 스냅샷)을 `navigate` state `prevBest`로 받아 `domain/play/bestRecord.bestRecordDelta`로 비교해 "첫 기록"·"최고 기록 갱신 · 이전 → 현재" 칩을 보이고, 갱신이면 숫자 카운트업(900ms)과 `result/RecordCelebration`을 도착 때 한 번만 낸다. `RecordCelebration`은 창 전체를 덮는 층을 body에 올려, 색종이(`features/result/domain/confetti` — 가운데 아래 폭죽 90조각 + 양쪽 아래 모서리 50조각씩, 위치는 시각의 닫힌 식이라 결정적)가 터져 팔랑팔랑 떨어지고 가운데에 네온 글자 「NEW BEST · 최고 기록 갱신 · 이전 → 현재」가 깜빡이며 켜졌다 꺼진다(약 3.5초, 클릭을 막지 않음). 요약 카드 안 작은 폭발 `result/CelebrationFx`(고리+점 3회)는 FX 랩에서만 쓴다. 새로고침·기록 화면에서 연 결과는 이 판보다 먼저 친 로컬 로그로 칩만 다시 계산한다. 모션 줄이기(OS)에서는 카운트업 즉시 반영, 스탬프·pulse·burst·흔들림·폭발 없이 색·칩만 나온다.
- **`usePadStates(session?)`:** `liveStore.hitSeq`마다 해당 패드를 hit으로 220ms(`HIT_MS`) 켜고, `RhythmSession` 판정마다 perfect/good/miss를 400ms(`JUDGE_MS`) 보인다(판정이 hit보다 우선). 타이머 규칙은 순수 모듈 `padStateMachine`이 맡는다.
- **`features/play/components/stage`: ** `GuideSlot`(드럼 영역 왼쪽 안내·코칭 칸. 악보 연습의 코칭 문구는 `size="lg"` — 킷 왼쪽 빈 곳으로 칸을 최대 340까지 넓혀 제목 26/800·보조 17/600과 종류별 색 면으로 보인다. 드럼 줄이 [안내 칸 · 킷 · 최근 타격] 3열 격자라 문구가 뜨든 안 뜨든 킷의 크기와 가운데 자리는 같고, 화면이 좁으면 안내 칸이 먼저 준다. 리듬 게임은 지금 크기 그대로다)·`HitReadout`(최근 타격, 연주용 `stack`. 자유 연습은 `features/free/components/FreeHud`를 쓴다).

## 패드

패드 enum은 `domain/kit/pads.ts`의 `PadId` 9개(공통 명세서 5장·미결 #9 결정)다. 스틱 7개(`CRASH`·`HIHAT`·`SNARE`·`SMALL_TOM`·`MID_TOM`·`FLOOR_TOM`·`RIDE`)와 페달 2개(`KICK`·`HIHAT_PEDAL`). 목록은 용도별로 세 가지다.

| 목록 | 개수 | 쓰는 곳 |
| --- | --- | --- |
| `ALL_PADS` | 9 | 저장·enum 검증·통계·악보 줄 |
| `LANE_PADS` | 9 | 노트 레인·킷 보기·칩 목록. 레인 순서는 크래시 · 하이햇 페달 · 하이햇 · 스네어 · 스몰탐 · 미드탐 · 플로어탐 · 라이드 · 킥(페달은 하이햇 왼쪽). 실제 게임 노트 하이웨이는 이 표가 아니라 `HIGHWAY_LANES`(하이햇 페달 · 하이햇 · 크래시 · 스네어 · 스몰탐 · 킥 · 미드탐 · 플로어탐 · 라이드)를 쓴다. 킷 보기는 이 순서가 아니라 배치 좌표로 그린다. 레인에 없는 패드 노트는 노트 하이웨이에 그리지 않는다 |
| `STICK_PADS` | 7 | 캘리브레이션·스틱 패드 테이블(`stick: true`) |

페달 두 패드는 센서 모드에서 동글에 붙은 페달 보드로 들어온다. 키보드 Space(킥)·B(하이햇 페달)는 키보드 전용 모드(`sensorKind === 'none'`)의 입력이고 개발·시연용으로 센서 모드에서도 눌리지만, 페달 보드와 동시에 쓰면 두 타격이 된다.

| 패드 | 센서 입력(동글, 프로토콜 v0.8.1) | 키보드 |
| --- | --- | --- |
| `KICK` | role 3(오른발) `HIT` pad 7 | Space |
| `HIHAT_PEDAL` | role 2(왼발) `HIT` pad 8, 같은 순간 `0x08 PEDAL` state 1 | B |

페달 타격은 자세 매퍼·채보 후보 보정을 거치지 않고 패킷의 pad·velocity(100) 그대로 `judgedBy: 'stick'`으로 나간다. 손이 아니므로 `ResolvedHit.stickId`는 `null`이고 `foot: 2 | 3`이 기기를 나타낸다(`0 | 1`이던 `stickId` 타입이 `StickId | null`로 넓어졌다). 타격 시각에는 스틱과 같은 `sensorOffsetMs`를 더한다(페달 전용 보정값은 통합 테스트 실측 뒤 정한다).

옛 이름(`HI_TOM` → `SMALL_TOM`)은 `normalizePadId`·`normalizePadKeys`가 한 곳에서 변환한다. 서버 채보(`chartMapping`)·서버 프리셋(`api/kit/presets`)·설정 마이그레이션(v10)·플레이 로그 로드가 이 함수를 거치므로 BE·AI 데이터가 옛 이름이어도 깨지지 않는다. 부족한 패드 배치는 `kitLayout.fillLayout`이 기본값으로 채운다. 프로토콜 패드 번호(0~8, EMB v0.7)는 화면 순서와 별개로 `input/stickProtocol`에 둔다(`PAD_CODE`·`padFromCode`, 0xFF·9 이상은 null).

## 입력 구조

- **소스**는 "어느 스틱이 언제 얼마나 세게 어떤 자세로 쳤는가"만 낸다. 어느 패드인지는 모른다.
- **매퍼**가 패드를 정한다. 키보드 타격은 키 매퍼(고정 키), 센서 타격은 자세 매퍼(**손별** 판정 프로필 — 왼손 타격은 왼손 앵커, 오른손 타격은 오른손 앵커. `InputManager.setProfiles`·`profileFor`).
- **키보드는 항상 켜져 있고**, 센서 소스는 세팅에서 하나만 고른다(없음 / 레지스트리에 등록된 소스: 포인터 모의 IMU · BLE · WebSocket · Web Serial). 센서를 켜도 Space 킥과 키보드 타격은 그대로 동작한다.
- **터치 입력(`TouchPadSource`, `kind: 'touch'`)**: 자유 연습의 드럼 킷만 켠다(`DrumKit`의 `onPadDown`). 패드를 누르는 즉시(pointerdown) `strike(pad)`가 이벤트를 내고, 자세 매퍼가 이벤트의 `pad`를 그대로 쓴다. 세기는 100 고정, `stickId`는 0·1 교대다. 키보드처럼 항상 붙어 있다.
- **센서 판정은 `domain/events`의 `isSensorSource`로만 한다**: keyboard·preview·touch는 센서가 아니다. `source !== 'keyboard'`처럼 직접 비교하지 않는다(센서 시각 오프셋·드리프트 보정·센서 통계가 오염된다). `'touch'`는 `sensorRegistry` 예약어다.
- **프로토콜(v0.7)**: HIT는 20바이트이고 시각은 µs(`timestampUs`)다. 스틱이 판정한 패드가 `pad` 필드로 오며, `decodePacket`이 전체 필드를, `parsePacket`이 `StickEvent`(시각 ms)로 좁힌 값을 낸다. 명령 0x14~0x17·파라미터 표(`STICK_PARAMS`)도 같은 파일에 있다.
- **페달 타격**: role 2·3 HIT는 `InputManager`의 별도 경로(`handleFootHit`)로 매퍼를 건너뛰고 `ResolvedHit`이 된다([패드](#패드)). 플레이 로그·업로드 본문(`stickId: null`)·텔레메트리·이펙트(`hand` null)에는 손 없음으로 남고, 녹음은 `stickId` 키 자체를 생략한다(서버가 null을 400으로 거부).
- **타격 진동(PLAY-006)**: 스틱이 패드를 판정한 순간 직접 울린다(펌웨어 로컬 트리거, 패드 밖 타격은 진동 없음). FE는 타격마다 HAPTIC을 보내지 않는다 — 브라우저를 거친 명령이 늦게 도착해 펌웨어 진동을 끊고 한 타격에 두 번 울렸다. `InputManager.haptic`은 모니터 진동 테스트에만 쓴다.
  - **곡 연주 판정 진동**: 리듬 게임·악보 연습은 `useJudgementHaptic` 훅 하나로 같은 규칙을 따른다. 연주 단계 전체(카운트인·일시정지·복귀 카운트다운 포함) 동안 스틱 로컬 진동을 끄고(`hapticEnable` 0x05 = 0), PERFECT·GOOD 판정 즉시 그 손에만 라이브러리 파형 1회(`InputManager.hapticWave`, HAPTIC `[0x12, 파형, 0]`)를 보낸다. MISS·키보드·터치 판정은 보내지 않는다.
  - **방식 비교 스위치**(설계 `.claude/plans/PLAY-006-haptic-ab-status-warn.md`): 설정 `playHaptic`(`judgement` 기본 / `local`)으로 연주 중 진동 방식을 고른다. `local`이면 `attachJudgementHaptic`이 판정 모드에 들어가지 않아(스틱 로컬 진동 `hapticEnable` = 1 유지) FE 판정 파형도 보내지 않는다. 값은 연주 단계에 들어갈 때 한 번 읽어 그 판 동안 고정한다. 스위치(「타격 진동 방식」: 판정 진동 / 스틱 즉시 진동)는 설정 「연주」 구역에 **모니터 빌드(`VITE_MONITOR=true`)에서만** 보이고, 일반 빌드는 동작이 그대로다(모니터 빌드가 아니면 저장값과 무관하게 판정 진동. `hapticMode.effectivePlayHaptic`이 한 곳에서 정한다). 그 판의 값은 진단 `session` 줄의 `haptic`에 남는다(`diagSessionOpts`). 설정 버전은 올리지 않고 저장분에 없거나 모르는 값은 `judgement`로 읽는다.
  - 로컬 진동 모드(`features/play/hapticMode`: `local`/`judgement`)는 진입 횟수로 관리해 마지막 이탈에서만 `local`(= 1)로 돌아가고, 손이 새로 붙거나 설정 전(비트 5)일 때마다 `bootstrap`이 `onStickLinked`로 그 손에 현재 모드 값을 다시 보낸다. 탭을 닫을 때(`pagehide`)도 `local` 전송을 시도한다. 파형 번호(`features/play/domain/haptics`의 `HIT_WAVE`)는 EMB 제안값(PERFECT 14 Strong Buzz, GOOD 17 Strong Click 1, 스틱 로컬 진동 강·중과 같은 파형)이며 실기기 QA에서 바꿀 수 있다.
  - **기기 시각 차이 경고**: 센서 타격마다 도착 지연(수신 − 타격 시각)을 기기(왼손·오른손·페달)별로 모은다(`runtime/arrivalSkewWatch`, 판정 규칙은 순수 함수 `domain/kit/device/arrivalSkew`). 기기마다 최근 30초·60개, 표본 5개 이상인 기기만 비교에 넣고, 유효 기기 중앙값의 최대 − 최소가 20ms를 넘는 상태가 30초 이어지면 경고 상태(`liveStore.clockSkew`)다. 20ms 이하가 30초 이어지거나 그 기기가 다시 연결되면(`resetDevice`) 끝난다. 어긋난 기기는 나머지 둘의 평균에서 가장 먼 기기(`outlier`)이고, 기기가 둘뿐이면 가르지 못해 둘 다 어긋난 것으로 본다. 경고 중에는 상단 기기 상태(`StickStatusIndicator`)에서 그 기기의 점이 주황(`.stick-dot.on.warn`)이 되고 title·aria-label에 「시간 어긋남」이 붙는다. 문구(`clockSkewText`)는 연주 화면에는 없고 **시작 확인 창(`notices`)과 연주를 마치고 도착한 결과 화면의 띠(`lesson-band`)** 에만 한 줄 보인다. PlayPage는 경고 중이면 기기가 준비돼도 시작 확인 창을 띄운다(자동 시작하지 않고, [▶ 플레이]로 그대로 시작할 수 있다). 시작·끝에 진단 `arrivalSkew` 줄을 남긴다. 키보드·터치 타격은 표본에서 뺀다.
- **스틱 판정 우선 규칙**: HIT `pad`가 있으면 자세 매퍼보다 우선해 그 패드로 재생한다(`judgedBy: 'stick'`). `pad`가 0xFF면 자세 매퍼(`'pose'`).
  채보 후보가 있고 `pad`가 후보 밖일 때만, 스틱이 애매하다고 했거나(`ambiguous`) `marginDeg`가 `AMBIGUOUS_MARGIN_DEG`(10°) 미만이면 가장 가까운 후보로 보정한다(`'chart'`). 확신 있는 오타는 그대로 두어 리듬 세션이 MISS 처리한다.
  세기는 스틱 `velocity`를 그대로 쓰고(펌웨어 곡선), 없을 때만 FE 가속도 곡선을 쓴다. 판정 출처는 `ResolvedHit.judgedBy`·텔레메트리에 남는다.
- **Web Serial(USB 직결)**: 921600 8N1, 프레이밍은 `input/serialFraming`(SOF 0xA5 · LEN · payload · CRC8). 직결 CRC·재동기 통계는 모니터가 표시한다.
- **`packetTap`**: 소스가 프레이밍을 벗긴 payload를 파싱 직전(수신)·송신 직후에 `input/packetTap`으로 publish한다. 모니터가 구독할 예정이며, 구독자가 없으면 아무 비용도 들지 않는다.
- **패드 테이블 동기화**(`input/padTableSync`, 손별): 손이 연결되거나 그 손의 판정 프로필(앵커·튜닝)이 바뀌면 그 손에만(`push(profile, { stickId })`, ROUTE로 감싸 패킷당 2개) `SET_PAD_TABLE`(지우고 시작)을 보낸다. 해시는 손별이라 같은 표는 다시 보내지 않고, `sendCommand`가 없는 소스(키보드·포인터)는 무동작이다. 2타 보정을 시작할 때는 `clear(stickId)`로 지우기 전용 패킷(`[0x15, 0x80]`)을 보내 보정 중 HIT의 `pad`가 0xFF가 되게 한다(PLAY-004 D6).
- 확인은 `PARAM_ACK_PAD_TABLE`(0x20, value = 적용 개수)을 손별 500ms 창 안에 받아 `acked`로 남긴다(패킷 role 또는 BLE 레코드의 손으로 가른다). 연결이 끊기거나 소스를 바꾸면 기록을 지운다.
- 표시: 손별 상태(`[PadTableStatus | null, PadTableStatus | null]`)를 bootstrap이 `liveStore.padTable`로 옮기고, 세팅 화면 "스틱 연결" 카드가 "스틱 패드 표 · 왼손 7개 적용됨 · 오른손 7개 적용됨"처럼 보인다. input은 store를 import하지 않으므로 `onStatus` 콜백으로 주입한다.
- **방위각 드리프트 보정**(`input/yawDriftMonitor`): 스틱 방위각은 자이로 적분이라 시간이 지나면 밀린다. 센서 타격(`pad` 있음, 스틱이 직접 판정한 `judgedBy === 'stick'`이고 패드 안 `inside === true`, 앵커 있음)의 `wrap180(pose.yaw − 앵커.yaw)`를 스틱별 링 12개에 모은다.
  - **표본 좁히기·보정량 상한·흔들림 정지**(설계 `.claude/plans/PLAY-004-yaw-drift-guard.md`): 악보로 짐작한(`chart`) 타격과 자세로 가린(`pose`) 타격은 기준 패드가 틀릴 수 있어 표본에서 뺐다. 한 번 보정은 오차를 ±8°(`DRIFT_MAX_STEP_DEG`)로 잘라 보내고 남은 오차는 다음 표본 모음에서 다시 본다. 직전 자동 보정과 부호가 반대인 보정이 2번 연달아(`DRIFT_FLIP_LIMIT`) 나오려 하면 두 번째는 보내지 않고 그 손의 자동 보정을 멈춘다(+, −, + 순서면 세 번째에서 멈춤. 같은 부호가 나오면 세던 횟수는 0). 멈춘 손은 표본도 모으지 않고 `YawDriftStatus.halted`가 된다. `bootstrap`이 `onHalt`를 받아 `yawHalt` 진단 줄을 내고 그 손의 `realignNeeded`를 켜므로, 다음 곡 시작 확인 창(자유 연습은 띠)에 「방향이 흔들렸어요. 스네어를…」 재정렬 안내가 뜬다. 연주 화면에는 아무것도 띄우지 않는다. 멈춤은 재정렬(`correct`)을 마치거나 곡을 시작할 때(`addPlayStartHook` → `beginRun()`, 진단 구독과 무관) 풀린다. 세팅 상태 줄에는 「자동 보정 멈춤(방향 흔들림)」이 뜨고, 녹화 요약은 `yawHalt` 줄이 있으면 「자동 보정 멈춤: 왼손 N번 · 오른손 M번」 한 줄을 낸다.
  - **켜고 끄기:** 자동 보정은 항상 동작한다. 11/12에 켬·끔 비교용 스위치(기본 끔)를 넣었으나 끄면 방위각이 흘러 패드가 틀어져 11/13에 스위치를 없앴다.
- 8개 이상이고 중앙값 절대값 ≥ 6°, 중앙절대편차 ≤ 5°이면 `SET_YAW_OFFSET(적용값 − 중앙값)`(절대값 설정)을 보내고 링을 비운다. 송신 뒤 10초는 재송신하지 않고 `PARAM_ACK_YAW_OFFSET`(0x21)으로 적용값을 확인한다. 임계값은 `domain/kit/calibration/tuning`(실측 뒤 조정).
  - **적용값 기억**(설계 `.claude/plans/PLAY-004-yaw-ack-hand-routing.md`): 보정은 FE가 기억한 적용값에서 오차를 뺀 절대값으로 나간다. 기억값이 스틱의 실제 오프셋과 다르면 다음 보정·재정렬이 그 차이만큼 튄다.
    - `0x21` 응답은 손별로 가려 받는다. 순서는 수신 기록의 손(BLE·WS 링크) → 패킷 role(flags 비트 0–1이 0·1) → 확인 창이 열린 손이고, 모두 없으면 버린다(`padTableSync`와 같은 규칙). Web Serial 수신 기록에는 손 정보가 없어 role로 가린다. 양손에 한꺼번에 덮어쓰지 않는다.
    - 같은 소스가 끊기거나 포트를 다시 열 때는 링·쿨다운·확인 창만 비우고 적용값은 남긴다. 꺼지지 않은 스틱은 오프셋을 그대로 갖고 있기 때문이다. 꺼졌다 켜진 스틱(STATUS 비트 5)은 `onConnected`가 0으로 다시 맞춘다. 소스를 바꾸거나 떼면 모두 잊는다.
    - 꺼지지 않은 스틱(STATUS 비트 5 = 0)이 붙으면 `onLinked`가 그 손에 `GET_PARAMS`를 한 번 보내 현재 오프셋을 읽는다. 스틱 FW 1.12부터 응답의 끝 표시 앞에 `0x21`(현재 방위각 오프셋)이 오고, 위 규칙대로 그 손 적용값에 들어간다. 페이지를 새로 고쳐 FE 기억이 0이 된 경우가 이렇게 맞춰진다. 이 응답은 확인 창·쿨다운·링을 건드리지 않는다.
    - 스틱 FW 1.11 이하는 `0x21`을 답하지 않는다. 이때는 FE 기억이 그대로이고(새로 고친 뒤면 0), 첫 재정렬이 어긋난 뒤 한 번 더 하면 맞는다.
- 꺼졌다 켜진 스틱(비트 5 = 1)이나 비트 5 정보가 없는 소스(BLE 직결)가 붙으면 `SET_YAW_OFFSET(0)`을 보내 기억을 맞추고, `inputManager.resetPose()`(펌웨어가 오프셋을 0으로 되돌림) 때는 FE 상태도 0으로 비운다. 상태(`YawDriftStatus`)는 `liveStore.yawDrift`로 옮겨 세팅 화면 "스틱 연결" 카드에 보인다.
- 보정·재정렬 중에는 `pause()`로 감시를 멈추고(그 타격은 샘플이 아니다) 끝나면 `resume()`(링 비움). 스네어 재정렬은 `correct(stickId, d)`로 쿨다운 없이 `SET_YAW_OFFSET(적용값 − d)`를 바로 보낸다.
- **스틱 USER 버튼 보정(0x22)**: FE가 `RESET_POSE`를 보낸 뒤 1초 안에 온 `PARAM_ACK 0x22`는 그 응답, 밖에서 온 것은 버튼 보정으로 보고 `InputManager.onResetPose('button', stickId)`로 알린다. 보정 중이면 처음부터, 아니면 그 손이 "재정렬 필요"가 된다.

## 새 입력 소스 추가 방법

센서 소스를 추가하는 데 필요한 변경은 파일 1개와 등록 1줄이다. 세팅 화면 목록·설정 패널·라벨 표시는 디스크립터를 읽어 자동으로 따라온다.

1. `src/input/` 에 소스 파일을 만든다(예: `WebSerialStickSource.ts`). `BaseInputSource`를 상속한 클래스와, 파일 끝에 `SourceDescriptor` 상수를 export 한다.
2. `src/app/sensors.ts` 에 `sensorRegistry.register(...)` 한 줄을 더한다.

디스크립터가 선언하는 것(`input/source/SourceDescriptor.ts`):

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

## 드럼 위치 보정(2타)·스네어 재정렬 (PLAY-004)

판정은 **손별 앵커**(`settingsStore.stickAnchors` = 적용 중 프리셋의 앵커 사본, 기기 로컬)가 맡는다. 앵커는 프리셋마다 `settingsStore.presetAnchors[프리셋 id]`에 기기 로컬로 저장되고(UX-64 D2, 서버 프리셋 스키마에는 없다) `presetStore.apply`가 사본을 갈아끼운다. 시스템 기본 프리셋(`SYSTEM_PRESET_ID = 'system'`)은 사본이 비어 3D 모델 기본 앵커로 판정한다. 앵커 = 한 손이 한 패드를 칠 때의 스틱 방향(고도 `pitch`·방위 `yaw`)의 중심과 판정 반경 `radius`. 손별 앵커 7개가 곧 그 손에 보내는 `SET_PAD_TABLE` 한 장이고 FE 판정 프로필(`domain/kit/kitJudge.anchorsToProfile`)도 같은 값이다. 거리·평균은 방향 벡터(대원 각도, `domain/kit/calibration/calibration.angleBetween`·`meanPose`)로 계산해 방위각 ±180° 끊김이 없다. 보정 안 한 손은 3D 드럼셋 모델(`domain/kit/kitModel`: 패드 위치·손 출발점 미터 좌표, 수치는 가정값)에서 유도한 기본 앵커를 쓴다. 반경 = 같은 손의 가장 가까운 다른 앵커까지 각도 × `radiusFactor`를 `[minRadiusDeg, maxRadiusDeg]`로 자른 값(기본 0.6 · 15° · 35°, EMB 실측).

- **2타 보정**(보정 팝업 `CalibrationDialog`, `runtime/calibrationSession.startCapture({ target, pads? })`): 연결된 스틱 전부 `RESET_POSE` → 드리프트 감시 pause → 손마다 표 지우기(`padTableSync.clear`) → 공용 소리 끄기. 그 뒤 `engine/HitCapture`가 스네어→하이햇→스몰탐→미드탐→플로어탐→크래시→라이드 순으로 연결된 손마다 2타를 받는다(2타 각도 차 > 8°면 그 손의 그 패드만 다시). **패드가 차면 400ms 뒤 자동으로 다음 패드로 넘어간다.** 간격 경고(이웃 패드와 너무 가까움)도 보정을 멈추지 않는다: 경고 배너(팝업 아래쪽)가 뜬 채 400ms 뒤 다음 패드로 가고, 다음 패드의 첫 수락 타격에서 배너가 사라진다. 실수 안내용으로 스냅샷에 손별 연속 퍼짐 횟수 `spreadStreak`(그 손이 채우거나 패드가 바뀌면 0)와 `gapHints`(`redo(pad)` 시점에 그 패드가 이웃과 20° 미만이었다는 기록, 그 패드가 채워져 넘어가면 비움)를 싣는다. 다시 치려면 배너의 [◯◯ 다시](`redo`)를 누른다. 마지막 패드의 경고는 결과 화면 배너로 이어지고, 결과 화면에서는 [저장](`finish()`)을 누른다(PLAY-004 D3). 보정 중 센서 타격은 bootstrap 타격 핸들러 맨 앞의 `calibrationSession.intercept(hit)`가 가로채 소리는 "지금 치라고 한 패드"로 내고 판정·텔레메트리에는 넣지 않는다(키보드·페달은 정상 경로). 대상이 둘이다(UX-64 D4): `target: 'active'`(사용자 프리셋의 머리 줄 [다시 보정])는 `finish()`가 손별 앵커·시각을 사본과 `presetAnchors[적용 id]`에 저장 → 손별 프로필·표 전송(`applySettings`) → 앵커에서 유도한 배치를 `kitLayout`에 써서 프리셋 `layout`으로 저장될 값으로 둠(배치는 표시 전용) → 감시 resume → 소리 켜기. `target: 'new'`(머리 줄 [새로 보정])는 `finish()`가 초안 `CaptureDraft`(앵커·기본 배치에서 유도한 배치·시각)를 돌려주고 세션을 접을 뿐 설정을 바꾸지 않는다 — 화면이 이름 창을 열어 `presetStore.saveAs(name, draft)`로 새 프리셋을 만들고 앵커를 기록한 뒤 적용한다. 취소·끊김·초안 버림 때는 적용 프리셋의 표를 다시 보내고 소리를 켠다. 시스템 기본이 적용 중이면 `'active'` 보정은 열리지 않는다. 한 손만 연결이면 그 손만 보정하고, 다른 손이 붙으면 ②가 다시 "보정 필요"가 된다(`domain/kit/device/readiness.calibrationReady`).
- **패드별 보정 손**(PLAY-004 ①, `domain/kit/calibration/captureHands`·`engine/HitCapture`): 패드마다 받을 손을 표(`CAPTURE_HANDS`)로 정한다. 라이드는 오른손만, 나머지 6패드(하이햇·크래시·스네어·스몰탐·미드탐·플로어탐)는 양손이라 패드·손 조합이 14개에서 13개가 된다. 실제 받을 손은 지정 손 중 이번 보정에 참여한 손이고, 하나도 없으면 참여한 손 전부다(왼손만 연결하면 라이드를 왼손이 받는다). 패드는 받을 손이 모두 2타를 채우면 끝난다. 받을 손이 아닌 손이 치면 받지 않고 스냅샷 `wrongHand`만 남기며, 화면이 2초 동안 「라이드는 오른손으로 쳐요」를 힌트 자리에 보인다. 큰 안내는 받을 손이 둘이면 「…를 양손으로 2번씩 타격하세요」, 하나면 「라이드를 오른손으로 2번 타격하세요」이고 타수 점은 받을 손(`targetHands`) 줄만 그린다. 「보정 중 n / 7」 같은 패드 수 표시는 그대로다.
- **다른 손 앵커 만들기**(PLAY-004 ①, `deriveSingleHandAnchors`): 이번 보정에서 지정 패드(라이드)를 한 손만 쳤으면 저장 때 다른 손의 앵커를 만든다. 다른 손 앵커 = 친 손 앵커 + (다른 손 스네어 − 친 손 스네어)로, pitch는 ±90°로 자르고 yaw는 ±180°로 접는다. 두 손의 스네어 앵커가 모두 있고 다른 손의 앵커 묶음이 있어야 하며(없으면 만들지 않고 기존 값을 둔다), 만든 앵커는 `derived: true`·`samples: 0`이다. `radiusOverride`는 복사하지 않고 반경은 손별 `computeBoundaries`로 다시 계산한다. `derived` 앵커는 간격 경고 비교에서 뺀다. 저장은 `calibrationSession.finish()`의 활성·새 프리셋 양쪽에서 기존 앵커와 합친 뒤에 한다.
- **유저별 최소 타격 세기**(PLAY-004 ③, `domain/kit/calibration/minPeak`): 보정 중 센서 타격의 `peakSpeedDps`(°/s)를 손별로 모은다(받을 손이 아닌 손·다시 친 타격 포함). 저장 때 손별로 중앙값 × `MIN_PEAK_RATIO`(0.4)를 반올림해 250(`MIN_PEAK_FLOOR_DPS`)~400(`MIN_PEAK_DEFAULT_DPS`)으로 자른 값을 `settingsStore.stickMinPeak[손]`에 저장한다. 유한한 양수 표본이 `MIN_PEAK_MIN_SAMPLES`(6) 미만이면 그 손 값은 바꾸지 않는다(패드 하나만 다시 칠 때 값이 흔들리지 않게). 값은 기기에 손별로 하나만 두고 프리셋 전환에서는 건드리지 않으며, `clearStickAnchors()`가 지운다(설정 버전은 그대로, 저장분에 없으면 `null`). 전송은 `runtime/sensorSession.pushMinPeak(stickId)`가 `SET_PARAM 0x03`(`minPeak`)을 그 손에만 보낸다: 저장값이 없으면 펌웨어 기본 400을 보내 스틱에 남은 이전 사용자 값을 되돌리고, 손별로 마지막에 보낸 값과 같으면 생략한다. 손이 새로 붙을 때(`bootstrap`의 연결 분기, 패드 표 전송 바로 뒤)는 `force`로 항상 보내고, 설정이 바뀔 때(`applySettings`)는 연결된 손에 같은 방식으로 보낸다(보정 중에도 막지 않는다). 보낼 때마다 `minPeak` 진단 줄을 남긴다(아래 진단 줄 표).
- **판정 반경 슬라이더**(UX-64 D9): 보정 카드와 선택 패드 카드의 「판정 범위」는 그 패드의 판정 반경(°, 고급 설정 하한~상한)이다. 보정 중에는 `calibrationSession.setRadiusOverride(pad, deg)`가 세션에 두었다가 저장 때 양손 앵커의 `radiusOverride`가 되고, 일반 편집은 `settingsStore.setRadiusOverride`가 사본·프리셋 기록에 바로 쓴다. `computeBoundaries`는 `radiusOverride`가 있으면 자동값 대신 그 값을 하한·상한으로 잘라 `radius`에 넣으므로 스틱 표에도 같이 간다. 영역이 이웃과 겹치면 더 가까운 패드가 이긴다(`resolvePad`). 표시 반지름 `layout.r`은 건드리지 않는다.
- **무대 배치**(SETUP-fixed-kit-noir D4·D6): 「내 드럼」 무대(`.setup-kit`)는 카드 면·테두리가 없다. 머리 줄(`.setup-stage-head`, 자유 연습 `.free-stage-head`와 같은 모양: 제목 15px + 「프리셋: 이름 · 8패드」 + 오른쪽 [다시 보정]·[새로 보정]) → 프리셋 칩 줄 → 무대 컨테이너(`.setup-kit-stage`, 가로 컨테이너 쿼리) → 안내 한 줄 순이다. 그림 영역(`.setup-kit-zone`)의 높이는 `min(--setup-stage-maxh, 폭/1.6)`이고 260px 밑으로는 줄이지 않는다. `--setup-stage-maxh`는 `useStageFit`이 정한다: 한 화면에 맞춘 높이가 500px(`STAGE_TARGET_H`) 이상이면 그대로, 화면이 낮아 모자라면 500px까지 키운다(페이지가 스크롤되고, 스크롤했을 때 상단바와 하단 바 사이에 다 보이는 높이는 넘지 않는다). 재지 못하면(jsdom) CSS 폴백(`100dvh − 450px`, 복귀 띠가 있으면 `− 530px`)을 쓴다. 안쪽 `LiveDrumKit`은 `fitContain`·`effects`·`scale` 1.6으로 그림 영역에 맞춰 가운데에 놓이고, 센서 면 `ref={bindSensorSurface}` 래퍼(`.setup-kit-surface`)가 `data-no-pointer-strike`를 달아 마우스 클릭은 타격하지 않는다. 결과 화면의 겹침 경고는 `CaptureSnapshot.base`(세션 밖 패드의 기존 앵커)를 합쳐 계산해 패드 단위 재보정에서도 보이고, 보정 중에는 하단 바 [저장]을 숨긴다(D13·D14).
- **보정 팝업**(`features/setup/components/calibration/CalibrationDialog` + `CalibrationStage`, SETUP-fixed-kit-noir D5·D11): `calibration.mode === 'capture'`인 동안 SetupPage가 마운트하는 `ui/Dialog`(폭 min(92vw, 1100px) · 높이 최대 92vh, 글래스 `--surface-float`)다. 바깥을 눌러도 닫히지 않고(`closeOnBackdrop={false}`) Esc와 [그만하기]만 `calibrationSession.cancelCapture()`를 부른다. 위에서 아래로: 작은 라벨(「새 프리셋 보정 · 드럼 위치」 / 「{프리셋 이름} 다시 보정 · 드럼 위치」) + [그만하기] → 큰 안내 「하이햇을 양손으로 2번씩 타격하세요」(`calibrationText.captureHeadline`, 패드 이름만 브랜드색) → 진행 점(패드마다 하나: 끝남 `--good`, 지금 `--brand`) → 드럼 그림(`LiveDrumKit` 고정 배치, 진행 중에는 `dimAll` 0.18 + 지금 칠 패드만 `lit`, 높이 300px 이상) → 손별 타격 점(`HitDots`) · 약한 타격 안내 · 퍼짐 경고 · 간격 경고 배너(`GapBanner`). 그림은 칠 패드와 친 패드에만 불이 들어오고 패드가 옮겨지지 않는다. 팝업이 열리면 드럼 그림 한가운데에 첫 안내(`CaptureNotice`) 두 줄 「양 스틱 모두 동일한 지점을 타격해 주세요. / 타격 시 스틱과 손목의 각도가 패드 형성에 반영됩니다.」가 큰 글씨로 겹쳐 뜬다(강조할 말만 은은한 네온 색, 나머지는 네온 화이트). 보정은 뒤에서 그대로 진행되고, 첫 타격이 수락된 뒤 3초(`NOTICE_MIN_MS`)가 지나면 사라지며 그 팝업에서는 다시 뜨지 않는다(`useCaptureNotice`). 줄은 흐림에서 또렷하게 올라오고 강조할 말 위로 빛이 지나간다. **실수 안내**(`hint/`, PLAY-004 v0.4): 평소에는 없고 실수가 이어질 때만 `hintPick.pickCaptureHint`가 하나를 고른다(순서 ① → ② → ③, 첫 안내가 떠 있는 동안·자동 진행 대기·결과 화면에서는 없음). ① 같은 패드에서 한 손의 퍼짐 경고가 2번 연속(`CaptureSnapshot.spreadStreak`)이면 그 패드 위에 빛 알갱이 둘이 하나로 합쳐지는 그림과 「동일한 지점」. ② 이웃과 20° 미만이던 패드를 [◯◯ 다시]로 다시 치는 동안(`CaptureSnapshot.gapHints`, 결과 화면의 [다시] 포함) 이웃 패드가 빛나고 칠 자리 윤곽이 이웃 반대쪽으로 밀려나는 그림과 「하이햇에서 더 멀리」 — 방향은 드럼 그림에서 이웃 → 칠 패드. ③ 스틱은 움직이는데 6초(`STUCK_HINT_MS`) 넘게 수락된 타격이 없으면 그림 영역 위쪽 모서리(칠 패드의 반대편)에 위·옆 방향 그림 `AimGuide`(방향은 `kitModel.handPoseTo` 가정값, 각도 숫자 없음). ①②는 `DrumKit`의 `overlay` 자리에 킷 상자 좌표로 그리고, 셋 다 누름을 받지 않는다. 움직임 줄이기에서는 정지 그림이다. 결과 화면(`phase === 'done'`)은 「7곳 모두 잡았어요」 + 같은 손에서 20° 미만인 쌍을 문구(`overlapPairText`: 「스네어와 스몰탐이 너무 가까워요(14°)」)와 쌍에 든 패드마다 [◯◯ 다시](`redo`)로 알리고 그 패드에 `--warn` 테두리를 그린 뒤 [저장]이다. [저장]: 적용 프리셋(active)이면 저장하고 팝업이 닫히며, 새 프리셋(new)이면 팝업이 닫히고 슬롯 창 → 이름 창이 이어진다. 유령(`ghost`)은 재정렬 화면(② 단계 팝업 안 `CalibrationStage`)에 쓴다.
- **스네어 재정렬**(`engine/SnareRealign`, `startRealign()`): 스틱이 다시 켜져 방위각 기준이 사라진 손(STATUS 비트 5 재연결 또는 버튼 보정 0x22를 받았고 앵커가 있는 손 = `liveStore.realignNeeded`)은 전체 보정 대신 스네어를 한 번 친다. `d = wrap180(친 방위각 − 저장 스네어 방위각)`를 `yawDriftMonitor.correct(stickId, d)`로 `SET_YAW_OFFSET(적용값 − d)` 전송. 고도각·저장 표는 그대로다. 대상이 아닌 손의 타격은 정상 판정이다(자유 연습에서 다른 손은 계속 친다).
- **재정렬 진입점 네 곳**이 같은 `RealignPrompt`(손 점 L·R + 문구 + [건너뛰기], variant card/row/band)와 훅 `components/calibration/useRealign(enabled)`을 쓴다: 세팅 ② 카드, 시작 확인 창의 기기 준비 줄(재정렬 프롬프트), 곡 연주 끊김 복귀 카드(「재연결 성공!」 뒤 재정렬이 걸려 있으면 `useReconnectResume`이 `realigning`으로 카운트다운을 미루고, 치거나 건너뛰면 3·2·1 → 자동 재개), 자유 연습 띠. 준비 조건(`readiness`)은 막지 않는다. [건너뛰기]는 동글만 다시 꽂아 방향이 안 바뀐 경우를 위한 것이다.
- **패드 단위 재보정**(후속 T9, UX "디폴트에서 옮겨서 저장"): (세팅 화면의 [이 드럼 다시 치기] 버튼은 고정 배치 개편으로 없어졌다. 엔진 옵션 `pads`는 남아 있다) 사용자 프리셋에서 패드를 골라 `startCapture({ target: 'active', pads: [pad] })`로 그 패드만 연결된 손마다 2타를 받는다(바로 [저장]). 완료하면 그 손들의 그 패드 앵커·배치만 바뀌고 나머지는 유지된다(반경은 합친 집합으로 다시 계산). 표 지우기·소리·완료 부작용은 전체 보정과 같고, 화면에는 세션 밖 패드가 현재 자리에 그대로 보인다.
- 화면 기본 배치 `DEFAULT_KIT_LAYOUT`은 사람이 디자인한 고정값(후속 T8)이고, 3D 모델은 보정 전 판정 앵커에만 쓴다.
- **드럼 세팅의 드럼 그림**(SETUP-fixed-kit-noir D1·D2·U2): 메인 「내 드럼」과 보정 팝업은 같은 `LiveDrumKit`(자유 연습과 같은 부품·스킨·바닥 빛 `StageFloor`)을 **고정 배치**(`frame`을 주지 않는 `DrumKit`의 실물·전자·네온 고정 그림)로 그린다. 프리셋·보정·저장된 `kitLayout`이 바뀌어도 그림은 움직이지 않는다. 판정은 손별 앵커가, 배치(`kitLayout`)는 표시 전용이고, 저장·전송하는 값(`settingsStore.kitLayout`·프리셋 `layout`·`calibrationSession`의 앵커→배치 유도)은 그대로다 — 서버 프리셋의 `layout`이 기기 사이에서 보정 방향을 옮기는 유일한 사본이라 지우지 않는다. 스틱 끝 점·L/R 표시와 손별 판정 범위 원, 패드 선택·좌표 카드·패드별 반경 슬라이더·끌기 편집·[이 드럼 다시 치기]·[기본 배치로]는 없앴다(전역 판정 반경 상·하한은 고급 설정). 키 안내는 실물 스킨이면 `KitGuideLabels` 이름표 알약(키보드 입력이 켜져 있으면 키 글자 포함, 항상 보임), 전자·네온이면 내장 글자(`labels`)다. 타격 점등은 `usePadStates`·`usePadHitSeq`다. 자유 틀(`frame`, `domain/kit/kitFrame`)과 원근 계산(`domain/kit/kitPerspective`)은 공유 domain에 남아 있다.
- **드럼 배치 원근 보기**(`domain/kit/kitPerspective` 계산·`kitFrame`; 옛 세팅 편집 캔버스 `KitCanvas`·`kitPerspectiveDraw`는 고정 배치 개편으로 없어졌고 드럼 세팅 화면은 지금 이 그림을 쓰지 않는다. 아래 설명은 계산 규칙의 기록): 저장 값(프리셋 `layout`의 x·y, 손별 앵커)과 판정은 그대로 두고 **그릴 때만** 3D로 바꾼다. 패드의 3D 점은 배치 x·y → 방향(`screenToPose`) → 두 손 출발점의 가운데(`AIM_ORIGIN`)에서 그 방향으로 3D 모델(`kitModel.PAD_POINTS`)의 패드별 거리만큼 간 점이다. 그림 자리(`Camera.place`)는 세로 자리·크기·깊이만 이 점의 원근 투영을 쓰고, **가로 자리는 기준점에서 본 방위각에 비례하게 편다**: 스틱은 방향만 알기 때문에 같은 각도면 가까운 패드든 먼 패드든 같은 가로 자리에 오고, 배치 가로 끝(x 0.05·0.95)이 그림 영역 좌우 끝(기준 길이의 10% 안쪽, `VIEW_EDGE`)이 된다. 원근 투영을 그대로 쓰면 가까운 패드(스네어·하이햇)는 좌우로 조금만 움직여 이동 범위가 역삼각형이 됐다. 바닥 격자도 같은 규칙으로 그린다(방위각 15°마다 세로 줄, 바닥 거리 0.3m마다 가로 줄). 스틱은 방향만 알기 때문에 거리는 가정값이고, 그래서 깊이는 실제 드럼과 다를 수 있다. 시점은 고정이다: 내려다보는 각도 50°(`VIEW_PITCH_DEG`), 바라보는 점 (0.03, 0.5, −0.1) m, 거리 2.15 m. 화각 배율은 0.765(`VIEW_FOCAL`), 그림 세로 중심은 높이의 56%(`VIEW_CENTER_Y`)다. 심벌을 배치 위쪽 끝(y 0.05)에 올려도 판 안쪽 여백까지 쓰면 위아래가 잘리지 않는 값이다(`kitFrame.test`가 가로로 넓은 판에서 확인). 스틱 패드는 바닥 그림자를 그리고, 킥은 바닥에 세워진 원판이고 자리가 고정이다(발로 치는 패드라 배치 좌표를 쓰지 않는다: 화면 가로 가운데, 탐 뒤쪽 앞 1.7m, 반지름 0.26m. 탐 위로 윗부분이 보인다. `isMovablePad`), 하이햇 페달은 납작한 발판이고 하이햇에 붙어 다닌다(배치의 페달 좌표를 쓰지 않는다: 자리와 크기는 실물 그림에서 페달 조각이 하이햇 받침 그림의 빈 네모에 맞물리는 비율 `kitArt.HIHAT_PEDAL_FIT`을 그대로 써서 이음매 없이 한 그림으로 보인다. `pedalShape`)(실물 크기는 `PAD_SOLIDS`, 배치의 `r`은 쓰지 않는다). 먼 패드부터 그리고 클릭은 앞에 보이는 패드부터 잡는다(윗면 타원 + 통 옆면). **끌기**는 그림 가로 자리를 그대로 배치 x로 바꾸고(`Camera.layoutXAt`), 세로는 그 x에서 화면 세로 자리가 포인터에 가장 가까운 배치 y를 찾아 `onMovePad(pad, x, y)`를 부른다(스토어는 그대로). 킥과 하이햇 페달은 끌 수 없다(눌러 고르기만). 하이햇을 옮기면 페달이 따라간다. 손별 판정 범위(점선 원)는 그 손 출발점(`HAND_ORIGINS`)에서 앵커 방향으로 간 자리에 반지름 = 거리 × tan(판정 범위)로 그리고, 내 포인터는 스틱이 가리키는 끝점에 L·R 표식만 그린다(손에서 잇는 선은 없다. `poseTip`: 끝점 거리는 방향이 가까운 패드들의 거리를 섞는다). 포인터 모의 IMU는 마우스 자세에 손 구분이 없어 두 손 가운데에서 그린다(`posesFromCenter`). 캔버스는 기준면을 등록할 때 화면 → 자세 변환(`screenPointToPose`)을 함께 넘겨(`bindSensorSurface(el, toPose)` → `PointerStickSource.setSurface`) 패드 위에 마우스를 두면 그 패드의 배치 자세가 된다. 변환을 넘기지 않는 화면(자유 연주)은 지금처럼 각도 범위에 선형으로 편다. 평면 원 그리기는 없앴다. 시스템 기본 배치(`DEFAULT_KIT_LAYOUT`)는 원근 그림에서 패드가 겹치지 않게 넓혔고(스네어 정면 아래·하이햇 왼쪽·플로어탐 오른쪽, 킥은 가운데 가까이, 하이햇 페달은 하이햇 아래), 옛 기본 배치 그대로인 저장 값은 설정 v23 이행에서 새 값으로 바뀐다(손으로 옮긴 배치·프리셋은 그대로). 3D 모델(`kitModel.PAD_POINTS`)은 **가정값**이고 실제 드럼 세트처럼 넓혀 두었다(좌우 1m 남짓). 시스템 기본 배치의 스틱 패드 x·y는 이 모델 타격점을 두 손 가운데에서 본 방향이라 그림 자리와 보정 전 기본 판정이 같은 모델에서 나온다(`kitModel.test`가 확인). EMB 실측값을 받으면 `PAD_POINTS`·`HAND_ORIGINS`·`PAD_SOLIDS`·`DEFAULT_KIT_LAYOUT`을 함께 바꾼다.
- **선택 패드 카드 표기**: X·Y·Z는 몸 기준 cm(가슴 원점, X 오른쪽·Y 앞·Z 위 — 그림에 놓인 점 그대로라 추정치다), 「판정 범위 n°」는 패드 중심 방향에서 벗어나도 그 패드로 치는 각도다(방위각이 아니다). 보정한 패드는 양손 앵커 반경의 평균, 보정 전에는 3D 모델 기본 앵커의 손별 평균을 보이고 페달은 「–」다. 보정 결과 카드(`CalibrationStage`)도 같은 틀로 X·Y·Z를 보인다(이쪽 좌표는 손별 앵커에서 구한 `padPointOf`라 편집 화면과 몇 cm 다를 수 있다).
- **배치 끌기 편집**(없어짐, SETUP-fixed-kit-noir D1): 세팅 화면에서 패드를 끌어 옮기던 편집은 고정 배치 개편으로 없어졌다. `settingsStore.movePad`·`resetLayout`·`kitModel.moveAnchorsForPad`는 스토어·도메인에 남아 있을 뿐 화면이 부르지 않는다. 시스템 기본이 적용 중일 때 하단 바·이탈 확인은 `selectDirty`가 기본 배치와 다르면 변경 있음으로 보는 규칙을 그대로 두므로, 저장된 `kitLayout`이 기본과 다르게 들어와 있으면(예: 옛 편집값) 기존처럼 [새 프리셋으로 저장] 흐름이 뜬다.
- **시작 위치 맞추기**(② 카드, 3초 유지): [시작 위치 맞추기]를 누르면 `features/setup/components/calibration/useReferenceCapture`가 연결된 손마다 `features/setup/components/calibration/ReferenceCapture`(최근 300ms 자세 퍼짐 3° 이하로 3초 유지)를 돌린다. 진행률은 손별 최소, 흔들림은 손별 최대로 진행 막대와 「유지 중 n.n초 · 흔들림 n.n°」에 보이고, 흔들리면 처음부터 다시 센다. 연결된 손이 모두 3초 유지하면 `calibrationSession.resetPose()`(연결된 스틱 전부 `RESET_POSE`, 드리프트 감시 reset, `referenceSetAt` 갱신, 재정렬 필요 표시 해제)를 한 번 부른다. 진행 중 연결된 손이 바뀌면 처음부터, 모두 끊기면 취소하고 오류 문구. [취소]는 기준 자세를 바꾸지 않는다. 2타 보정·재정렬 중에는 시작할 수 없다. 앵커는 "정면 기준" 값이라 그대로 유효하다.
- **자세 안내 그림**(② 팝업 맨 위, `features/setup/components/calibration/ReferencePoseGuide`): 제목 「편안히 들고 스틱 끝을 모아 주세요」, 그림 두 장(위에서 본 모습·옆에서 본 모습), 세 줄 안내. 대기에서는 두 손이 가운데로 모이고 스틱 끝이 맞닿아 ∧ 모양이 되는 동작을 되풀이하고, 유지 중에는 모은 자세로 멈추며(점선 파랑), 흔들려 진행률이 0으로 돌아가면 스틱이 떨리고(점선 빨강), 완료하면 체크와 초록 테두리가 나온다. 그림은 안내용 고정 동작이라 센서 값과 무관하다. 자세 계산은 `features/setup/components/calibration/referencePose`(순수 함수)이고, 움직임 줄이기 설정에서는 정지 그림에 벌어진 자세 윤곽을 겹친다. 키보드 모드·스네어 재정렬 중에는 나오지 않는다.
- **내 포인터(자세 마커)**: 세팅 화면에 있고 센서 모드에 스틱이 연결돼 있는 동안만 `features/setup/components/calibration/usePoseStream`이 `inputManager.setPoseStream(true)`(SET_MODE 1)로 POSE 패킷을 켜고, 연결된 손 수가 바뀌면(재연결·재부팅) 다시 보내며, 화면을 떠나면 끈다(연주 화면 무선 대역 보호). 자세 스트림은 시작 위치 보정(기준 자세 잡기)에 쓰고 드럼 그림에는 그리지 않는다(스틱 끝 점·L/R 표식은 없앴다). 포인터 모의 IMU는 마우스 위치가 자세다.
- 세션 스냅샷은 `liveStore.calibration`(`mode: 'idle' | 'capture' | 'realign'`, `target: 'new' | 'active' | null`)이고 화면은 이것만 읽는다. `liveStore.referenceSetAt`은 마지막 보정·재정렬·시작 위치 맞추기 시각이다. `/calibration`은 `/setup`으로 이동한다.

## 박자 맞추기(판정 타이밍 자동 보정) (PLAY-004)

설계 `.claude/plans/PLAY-004-timing-offset-calibration.md`. 타격음은 친 순간보다 65~70ms 늦게 들리고(전송 + 처리 + 출력 지연), 에어드럼은 닿는 감각이 없어 유저가 소리로 박자를 맞춘다. 그래서 드럼 소리를 노래에 맞추면 그만큼 일찍 치게 된다. 박자 맞추기는 그 어긋남을 재서 `settingsStore.audioOffsetMs`에 넣는다. 판정 식은 그대로 `tHit − audioOffsetMs − 곡 시작 시각`이라 이르게 치는 유저는 음수가 들어간다.

- **절차**(`runtime/timingCalSession`): 100BPM 클릭 16박(약 10초). 앞 4박은 듣기만 하고 뒤 12박을 잰다. 아무 패드나 친다. 클릭은 전역 메트로놈과 같은 방식(창 100ms·틱 25ms)으로 예약하고, 시작할 때 전역 메트로놈을 멈춘다. 측정 중 타격은 `bootstrap` 타격 핸들러가 `timingCalSession.intercept`로 가로채 **타격음만 내고** 판정·텔레메트리·`resolved` 진단·방위각 드리프트 감시에는 넘기지 않는다. 패드 보정·재정렬 중에는 시작할 수 없다(가로채기 순서는 패드 보정이 먼저).
- **계산**(`domain/kit/calibration/timingCalibration`, 순수 함수): 측정 박마다 ±250ms 안 가장 가까운 타격 하나를 짝짓고 (타격 `tHit` − 클릭이 실제 예약된 시각)의 중앙값을 낸다. 짝이 8개 미만이면 표본 부족, 흩어짐(중앙값 절대편차)이 25ms를 넘으면 다시 하기이고 두 경우 값은 바뀌지 않는다. 성공하면 중앙값을 5ms로 반올림하고 −250~+100ms로 잘라 저장값으로 삼는다.
- **조정하는 값**: `TIMING_CAL_MAX_MAD_MS`(25), `TIMING_OFFSET_MIN_MS`·`MAX_MS`(−250·+100), `TIMING_CAL_MIN_PAIRS`(8), `OUTPUT_LATENCY_WARN_MS`(100)는 시작값이다. EMB와 실연주로 확인한 뒤 `domain/kit/calibration/timingCalibration.ts`의 상수만 고치면 계산·저장 범위·수동 칸 범위·안내가 함께 바뀐다. 고치면 설계 문서 3-1 표도 맞춘다.
- **화면**(`components/calibration/TimingCalDialog`): 안내 → 박 점 16개 진행 → 결과(성공: 지금 값 → 새 값과 [적용]·[다시 하기]·[취소] / 실패: 이유와 [다시 하기]). 닫거나 화면을 떠나면 측정을 멈춘다. 진입점은 드럼 세팅(`/setup`) 상단 상태 타일 셋째 칸 「박자 맞추기」(맞춤 · 값 / 안 맞춤, 안 맞췄으면 상태 글자가 주의색 `is-todo`)이다. 문구는 `timingCalText`.
- **저장**: [적용]을 누르면 `audioOffsetMs`와 마지막 측정 기록 `settingsStore.timingCal`(측정 시각·중앙값·흩어짐·짝 수·입력·그때 보고된 출력 지연)을 이 기기에 저장한다. 프리셋에는 넣지 않는다. 다음 곡 시작부터 판정에 쓰이고, 플레이 로그의 `calibration.audioOffsetMs`에도 같은 값이 실린다. 저장분의 `audioOffsetMs`가 범위 밖이면(범위를 바꾸기 전 값) 읽을 때 자른다(`sanitizeTimingSettings`).
- **안내**: 측정한 입력(스틱·키보드)과 지금 입력 방식이 다르면 설정에 다시 맞추라는 문구를, 브라우저가 보고한 출력 지연(`AudioContext.outputLatency`)이 100ms를 넘으면 유선 출력을 권하는 문구를 보인다.
- **진단**: `audio` 진단 줄(`app/diag/audioDiag`)이 판정 타이밍 보정과 오디오 지연을 곡 시작 직후와 10초마다 낸다(아래 녹화 파일 표).
- **스틱·킥 값 분리**(설계 `.claude/plans/PLAY-004-timing-cal-stick-kick.md`): 11/12 실측에서 같은 사람이 쳐도 킥이 스틱보다 10~40ms 이르게 판정돼 값을 둘로 나눴다.
  - 값: `audioOffsetMs`는 이름을 그대로 두고 스틱·기본 값으로 쓴다. 킥용 `kickOffsetMs`(null이면 스틱 값을 따름)를 따로 둔다. 고르는 함수는 `kickOffsetOrStick`.
  - 측정: 시작할 때 킥 페달이 연결돼 있으면 듣기 4박 → 스틱 12박 → 전환 4박 → 킥 12박(32박, 약 19초)으로 클릭을 멈추지 않고 이어서 잰다. 연결이 없거나 키보드 모드면 위의 16박 그대로다. 구간마다 그 입력의 타격만 계산한다(스틱 구간의 킥, 킥 구간의 스틱, 하이햇 페달은 소리만 낸다). 전환 박은 짝짓지 않는다.
  - 적용(`timingCalApply`): 스틱이 성공하면 스틱 값을 넣는다. 킥도 성공하면 킥 값을 넣고, 킥 구간이 없었거나 실패하면 `kickOffsetMs`를 null로 둔다. 스틱이 실패하면 아무것도 바꾸지 않는다. 두 중앙값 차가 60ms(`TIMING_CAL_RECHECK_DIFF_MS`)를 넘으면 「한 번 더 재 볼까요?」를 보이되 적용은 막지 않는다.
  - 판정(`engine/RhythmSession.hitSongTimeMs`): 발 타격(`foot` 2 하이햇 페달·3 킥, `isFootHit`)은 킥 값, 손 타격과 키보드·화면 터치는 스틱 값을 뺀다. IMU 후보 패드 계산은 스틱 값이다.
  - 기록: 플레이 로그에 `kickOffsetMs`가 남는다. BE 업로드 `calibration.audioOffsetMs`에는 스틱 값만 간다(BE 파서가 모르는 필드를 거부한다). 타격별 `deltaMs`에는 입력별 값이 반영돼 있다.
  - 화면: 드럼 세팅 고급 설정의 「판정 타이밍」 묶음에 「스틱 판정 타이밍」「킥 판정 타이밍」 두 칸(킥 값이 없으면 스틱 값을 보이고, 움직이면 따로 저장), 드럼 세팅 상태 줄은 킥 값이 있으면 「맞춤 · 스틱 … · 킥 …」.
- **첫 연주 전 권유**(`components/calibration/useTimingCalGate`, `domain/kit/calibration/timingCalPrompt`. 리듬 게임·악보 연습과 미니게임 「정적 뒤 한 방」이 같이 쓴다): 박자 맞추기를 직접 찾아 누르지 않으면 보정값이 0으로 남아서, 측정 기록이 없는 센서 사용자에게 첫 연주 직전에 한 번 띄운다.
  - 상태는 설정 `timingCalPrompt`(이 기기에만 저장): `none` 아직 권하지 않음 → 첫 시작에서 [적용]하면 `done`, [나중에 하기]·닫기면 `skipped` → 다음 결과 화면에서 한 번 권한 뒤 `done`. 옛 저장분은 측정 기록이 있으면 `done`, 없으면 `none`으로 읽는다.
  - 관문은 `PlayPage`·`SheetPage`의 `startPlay`(모든 시작 경로가 거치는 곳)에 있다. 조건(센서 입력 + 측정 기록 없음 + `none`)이면 연주 대신 `TimingCalDialog`를 권유 모드(`intro`)로 연다. 닫으면 연주를 자동으로 시작하지 않고 시작 확인 창이나 곡 선택으로 돌아가며, 다시 시작하면 바로 연주한다. 키보드 모드와 [다시 하기]에는 걸지 않는다. 연주 시작을 막는 것은 이 한 번뿐이다.
  - 건너뛴 사용자가 연주를 마치고 도착한 결과 화면에는 권유 띠(「박자 맞추기를 하면 판정이 더 정확해져요.」 + [박자 맞추기])를 한 번 보인다. 연주 기록에서 옛 결과를 열 때는 보이지 않는다.
- **초보 판정 폭**(`domain/play/judgement.appliedWindows`, `domain/play/lesson.isBeginnerChart`): 난이도 EASY 채보와 학습 코스(입문·중급) 연주 레슨은 GOOD 폭을 ±90ms(`BEGINNER_GOOD_MS`)까지 넓힌다. 넓히기만 하므로 사용자가 더 넓게 둔 값은 그대로 쓰고, PERFECT 폭은 바꾸지 않는다.
  - 연주 화면이 적용 폭을 한 곳에서 계산해 판정 세션에 넘기고, 타이밍 막대·실시간 코칭·진단 `session` 줄·플레이 로그 `timing`·업로드 `timingWindows`는 세션의 값(`RhythmSession.windows`)을 쓴다. 코칭 기준 폭(60ms 고정)은 그대로다.
  - 넓혀진 판은 시작 확인 창에 「판정 여유 ±90ms」, 결과 화면에 「판정 여유 ±90ms로 연주한 기록이에요」를 보인다. 최고 기록 비교는 GOOD 폭이 같은 기록끼리만 한다(`bestRecord.localPrevBest`의 `goodMs`). 넓힌 폭으로 연주한 판은 서버 최고값을 비교에 쓰지 않고(서버 응답에 판정 폭이 없다, `prevBestFor`) 이 브라우저의 로그로만 비교한다. 연주 기록 목록에는 이 브라우저에 로그가 남은 판만 「판정 여유 ±Nms」가 보인다.

## 통합 설정(프리셋·캘리브레이션)

`/setup` 한 페이지에서 연결·보정·프리셋·배치를 끝낸다. 위에서 아래로 (시작 확인 창에서 왔을 때만) 복귀 띠 → 머리("연주 환경 설정 · 2단계 중 n단계 완료") → 상태 타일 3장(스틱 연결·시작 위치 보정·박자 맞추기를 한 줄에, 앞 둘은 누르면 단계 팝업, 셋째는 박자 맞추기 창, 1024px 이하는 세로) → 「내 드럼」 무대(머리 줄 [다시 보정]·[새로 보정] + 프리셋 칩 줄 + 고정 배치 드럼 그림 + 타격 확인 + 안내 한 줄, 보정은 팝업) → 접힌 고급 설정 → 하단 고정 바 순이다(UX-64: ③ 프리셋 카드는 「내 드럼」 무대의 칩 줄로 합쳐졌다). 순서를 강제하지 않아 어느 영역이든 언제나 조작할 수 있다.

- **상태 타일**(`features/setup/components/StatusTile`, Figma Setup / StatusTile 505:2449, UX-44·UX-64, PLAY-004 D8) — 2열 한 줄 타일. 점 + 제목 + 상태 한 단어(「연결됨」「보정됨」/「연결 안 됨」「보정 필요」/「필요 없음」), 한 줄 요약, 오른쪽 아래 버튼 문구([연결하기]·[보정하기]·완료면 [보기]). on(완료)=초록 점·상태 글자, 모자란 단계=노랑 점·옅은 노랑 바탕(`is-attention`), 복귀 띠가 떠 있는 필요 단계=빨강, 그 외=회색(테두리 없음). 타일은 펼쳐지지 않고 누르면 **단계 팝업**(`features/setup/components/StepDialog`, `ui/overlay/Dialog`를 감싼 틀: 제목·[닫기]·본문)이 열린다. 닫으면 포커스가 연 타일로 돌아온다(`useDialogFocus`). 진입 때나 재정렬이 필요해질 때 팝업을 자동으로 열지 않고 타일 강조만 한다(사용자가 이미 연 ② 팝업 안에서 재정렬이 진행되는 것은 유지). 보정(2타 캡처) 중에는 ② 타일이 비활성이라 팝업을 열 수 없다. 판정·요약 문구는 `domain/kit/calibration/setupSteps.setupSteps()`가 `readiness()`의 `missing`에서 유도한다(규칙 중복 없음).
  - ① **스틱 연결**(팝업 본문) — 왼손·오른손 `StickCard` 2장(연결 점·배터리), 입력 소스 선택, 소스 옵션 패널, 패드 표·방위각 문구. 센서를 쓰면 **양손이 모두 연결**돼야 완료다. 연결이 끊겼다 돌아오면(`referenceStale`) 시작 위치를 다시 맞추라는 안내만 낸다. 스틱은 버튼으로 켜면 동글에 자동으로 붙고, 동글↔브라우저는 한 번 허락한 포트를 페이지를 열 때 자동으로 다시 연다. 센서가 Web Serial이면 두 손 카드 아래에 페달 줄이 붙고("페달 연결됨 · 82%" / "페달 연결 안 됨 · 페달을 켰다면 동글을 다시 꽂아 주세요") 페달도 완료 조건이다. Web Serial이면 맨 위에 동글 줄을 둔다: 포트가 안 열렸으면 [동글 연결](처음 한 번 포트 선택), 열렸으면 "동글이 연결됐어요"(스틱 0개면 "스틱 버튼을 눌러 켜 주세요")와 [다른 동글 연결], LINK가 3초 넘게 끊기면 "동글 응답이 없어요". 키보드만 쓰면 "필요 없음"이지만 [보기]로 팝업을 열어 센서를 고를 수 있다.
  - ② **시작 위치 보정**(UX-64 D7, 팝업 본문) — 기준 자세(정면)와 스네어 재정렬을 맡는다. 상태: 키보드만("필요 없음") / 보정 필요(사용자 프리셋인데 연결된 손의 앵커가 없음: "드럼 위치를 아직 잡지 않았어요 · 드럼 배치에서 보정하세요", 본문은 [시작 위치 맞추기](3초 유지) + 「내 드럼」의 [다시 보정]·[새로 보정] 안내) / 재정렬 중("오른손 스틱이 다시 켜졌어요 · 스네어를 한 번 쳐 주세요", 스네어 유령 킷 + 프롬프트 + [처음부터 보정]) / 완료("HH:MM에 보정했어요", 시스템 기본이고 시각이 없으면 "시스템 기본 배치 · 보정 없이 바로 칠 수 있어요"). 완료 조건은 `domain/kit/device/readiness.calibrationReady`: 재정렬이 필요한 손이 없고, 시스템 기본이거나 연결된 손마다 앵커가 있는 것. 2타 보정은 여기서 하지 않고 드럼 배치 카드에서 한다.
- **내 드럼 무대** — 머리 줄: 제목 「내 드럼」 + 보조 「프리셋: {적용 프리셋 이름} · 8패드」, 센서 모드면 오른쪽에 [다시 보정](`startCapture({ target: 'active' })`, 시스템 기본이거나 연결된 손이 없거나 저장 중이면 비활성)과 주 버튼 [새로 보정](`startCapture({ target: 'new' })`, 연결된 손이 없거나 보정·저장 중이거나 슬롯 5개가 차면 비활성 「슬롯이 다 찼어요…」). 그 아래 **프리셋 칩 줄**(`features/setup/components/preset/PresetChips`, UX-64): [시스템 기본 · 고정] + 저장 프리셋 칩(누르면 `presetStore.apply`) | 오른쪽 완료 시각 pill(「완료 14:02」, 사용자 프리셋인데 앵커가 없으면 「보정 필요」, 키보드만이면 「키보드만」) + [프리셋 관리](프리셋 슬롯 창을 연다. 키보드만이어도 있다). 보정 시작·진행·취소는 칩 줄이 아니라 머리 줄 버튼과 보정 팝업(위 「보정 팝업」)이 맡는다. [새로 보정] → 패드별 2타 → 팝업 [저장] → **프리셋 슬롯 창**(`PresetSlotDialog`, Figma 772:33828·Setup / PresetSlot 505:2501: 0번 시스템 + 저장 슬롯 5개, 초안 모드라 빈 슬롯만 활성, 하단 바 「보정 완료 · 빈 슬롯을 눌러 저장해요」) → 빈 슬롯 → 이름 창(`PresetNameDialog`, 기본값 「새 프리셋 k」, 바 「보정 완료 · 슬롯 k에 저장할 이름을 정해요」) → `saveAs(name, draft)`로 새 프리셋이 적용된다. 슬롯 창의 [닫기]·이름 창 [취소]는 초안을 버린다. **프리셋 관리**: [프리셋 관리]로 연 슬롯 창(초안 없음)에서는 슬롯을 누르면 적용, 빈 슬롯을 누르면 지금 배치를 새 프리셋으로 저장, 저장 슬롯 오른쪽 위 휴지통을 누르면 그 카드가 삭제 확인(「'이름' 프리셋을 지울까요?」 [취소] [삭제])으로 바뀐다. [삭제]는 `presetStore.remove(id)`를 부르고, 적용 중이던 프리셋을 지우면 시스템 기본으로 돌아간다. 실패하면 창 아래에 오류 문구가 뜬다. 초안 모드(새로 보정 뒤)에는 휴지통이 없다. 창 아래 왼쪽에 「저장 n / 5」를 보인다. 슬롯 창은 드럼 무대 크기(폭 최대 1040px, 슬롯 높이 200px, 좁으면 2열)이고 카드 내용은 가운데 정렬이다. 적용 중 슬롯은 은은한 시안 네온(`--brand`, 3.6초 숨쉬기)으로 빛나고, 휴지통은 카드에 올리면 보인다(터치 화면은 늘 보임). 그 아래 고정 배치 드럼 그림(`LiveDrumKit`, 위 「무대 배치」·「드럼 세팅의 드럼 그림」 참고): 치면 그 패드에 불이 들어온다(센서·키보드). 마우스는 칠 수 없다(포인터 모의 IMU의 클릭 타격도 `data-no-pointer-strike`로 막음), 래퍼가 포인터 기준면 `bindSensorSurface`. 그림 아래 안내 한 줄 「아무 패드나 쳐 보세요. 맞게 잡히면 그 자리에 불이 들어와요.」(시스템 기본 + 센서 모드면 「기본 자리예요. 내 자리로 맞추려면 [새로 보정]을 눌러요.」). 사운드 세트 선택 UI는 없고 값은 `ssaplash` 고정이다. **타격 확인**(`HitLog`) — 패드·세기·경과 시각(손 열은 없다), 새 타격이 위, 구독은 `components/drum/useRecentHits(n)`. 자리는 CSS 컨테이너 쿼리(`.setup-kit-stage`)가 고른다: 무대 폭 720px 이상이면 그림 가운데 위(킥 위 탐 사이 빈자리, 크래시를 가리지 않게)의 폭 220px 글래스 카드(`--surface-float` + blur 14, 3행, 포인터를 받지 않음), 좁으면 그림 아래 5행. 연결이 끊기면 「스틱 연결 끊김」(큰 글씨) + 「연결 상태를 확인해주세요.」 두 줄 알림이 타격 확인 안에 뜬다. 평소 카드 설명 문장은 없다.
- **고급 설정**(카드 + [펼치기], 접힘이 기본) — 스틱·기기에 맞추는 값만 둔다. 「판정 타이밍」 묶음(스틱·킥 판정 타이밍 각 −250~+100ms 5ms 단위, 해당할 때만 입력 불일치·출력 지연 안내, 오디오 지연 실측)과 「패드 인식 범위」 묶음(최소·최대 = `tuning.minRadiusDeg`·`maxRadiusDeg`, 옛 이름 판정 반경 하한·상한). 음량·판정 폭·노트 낙하·카운트다운·메트로놈 같은 앱 동작 값은 설정 화면에 있다(설계 `.claude/plans/UX-settings-setup-regroup.md`). 설정 스토어에 즉시 저장되므로 미저장 판정 대상이 아니다. 묶음 둘은 얇은 테두리로 감싸 한 줄에 나란히 두고(1024px 이하는 위아래), 묶음마다 짧은 안내 한 줄만 둔다. 글자는 다른 카드보다 크고 슬라이더는 이름과 값을 한 줄에 둔다(`.setup-adv` 범위에서만 `ui-slider` 배치를 덮는다). 펼치면 내용이 하단 바에 가려지지 않게 스크롤해 보인다. 펼칠 때 묶음이 차례로 떠오르고, 묶음에 마우스를 올리거나 슬라이더에 초점이 가면 테두리가 메인 색으로 바뀌며 빛줄기가 한 번 지나간 뒤 네온 빛이 천천히 숨 쉰다(움직임 줄이기에서는 페이드만).
- **하단 고정 바** — 4상태 + 보정 중(`domain/kit/calibration/setupSteps.setupBarView`): 변경 없음 「이름」 사용 중 + [저장] 비활성(시스템 기본은 항상 이 상태) / 변경 있음 노랑 점 + "「이름」 변경 있음 · 저장하지 않으면 다음에 사라져요" + [저장] / 적용 프리셋이 목록에 없음 "아직 프리셋으로 저장하지 않았어요" + [새 프리셋으로 저장] / 변경이 있는 채로 나가려 해 이탈 확인이 열린 동안 빨강 "저장하지 않은 변경 사항이 있어요…" / 보정 중 「새 프리셋 보정 중 · 7개 중 n번째」(또는 「「이름」 보정 중 …」) + [저장] 비활성. 화면 아래에 sticky로 붙는다.

**스타일(느와르 톤, SETUP-fixed-kit-noir D8~D10·D13):** 맨 아래 `setup.css`의 「느와르 톤」 블록이 아래 애플 스타일을 덮는다. 페이지 첫 자식으로 `StageBeam`(`on` = 센서 모드면 스틱이 하나라도 연결, 키보드 전용이면 늘 켬)을 깔고 나머지 직계 자식은 `z-index: 1`로 위에 둔다(복귀 띠·하단 바는 제외, 자기 sticky 유지). 「내 드럼」 무대는 면·테두리 없이 배경과 한 면이고, 상태 타일·선택 안 된 프리셋 칩·떠 있는 타격 확인 카드·보정 팝업·고급 설정·하단 바는 `--surface-float` + `blur(14px)` + `--line` 글래스(hover `--line-strong`)다. 새 토큰은 없다. 움직임 줄이기면 빛줄기 깜빡임을 끈다.

**울림·팝업(애플 톤 v2):** 프리셋 슬롯 카드와 상태 타일은 `features/setup/components/StrikeButton`이다. 마우스를 올리면 떠오르며 가운데서 옅은 시안 링이, 누르면 누른 자리에서 진한 링과 짧은 눌림이 난다(터치는 누름만, 움직임 줄이기면 링·움직임 없음). 단계 팝업(`StepDialog`, 스틱 연결·시작 위치 보정)은 폭 860px, 박자 맞추기는 세팅에서 열 때만 `className="setup-timing-dialog"`로 폭 680px·가운데 정렬·큰 박 점(지금 박은 시안 네온)을 입는다. 둘 다 82% 반투명 + blur 24, 모서리 28px, 46px 알약 버튼이고 `setup.css` 맨 끝 「세팅 팝업 키움·애플 톤 v2」 블록이 맡는다. 다른 화면의 박자 맞추기 창은 기본 모양 그대로다.

**스타일(PLAY-004 D12, 애플 스타일):** 드럼 세팅 화면은 `setup.css`·`calibration.css` 안에서만 규칙을 적용한다(`tokens.css`·`components/ui/*`는 그대로, `.setup-page`·`.setup-step-dialog` 아래로 범위를 한정해 덮는다). 카드(타일·드럼 배치)는 테두리 없이 `--surface-1` 바탕·모서리 20px·여백 24px, 캔버스 판은 `--bg-canvas`·모서리 16px, 정보 카드·경고 배너·하단 바·단계 팝업은 바탕 72% 반투명 + `backdrop-filter: blur(20px) saturate(1.4)`·흰색 8% 머리카락 테두리(경고는 `--warn` 12% 혼합 + 왼쪽 점), 이 화면 버튼은 알약형(주 버튼 채움, 보조는 옅은 채움·테두리 없음), 프리셋 칩 줄은 세그먼트 컨트롤(선택 칩만 떠 있는 바탕), 떠 있는 요소는 180ms 페이드 + 6px 위로 등장(모션 줄이기면 페이드만).

[설정 완료] 버튼은 없다. 센서를 쓰는 화면에서 준비 조건이 처음 갖춰지면 `firstSetupDone = true`로 기록하고, 복귀 띠로 돌아갈 때도 켠다.

**복귀 규칙**: 홈·시작 확인 창(악보 연습)·기기 준비 팝업(리듬 게임)의 바로가기는 `navigate('/setup', { state: { returnTo, returnLabel? } })`로 들어온다(`returnLabel`은 "악보 연습 · 곡 제목" 같은 띠용 이름, 없으면 경로로 짓는다). `returnTo`가 있으면 상단에 복귀 띠가 고정되고, 남은 조건 한 줄과 [곡 선택으로 돌아가기]가 보인다. 조건이 모두 채워지면 버튼이 활성이 되고 Enter로도 돌아간다(입력 칸·버튼 포커스, 대화상자 열림, 보정 중에는 무시). 이동은 `sanitizeReturnTo`를 거친다. `returnTo` 없이 메뉴로 들어오면 띠 없이 같은 단계 카드가 보인다.

**이탈 확인**: 변경사항이 저장되지 않았고(`selectDirty`) 보정 중이 아닐 때 복귀 버튼·메뉴 이동·뒤로 가기를 하면 `UnsavedLeaveDialog`가 뜬다. [취소]는 머물고, [저장 안 함]은 적용 프리셋의 배치·사운드로 되돌린 뒤 이동한다(적용 프리셋이 없으면 편집값을 둔 채 이동). [저장하고 나가기]는 적용 프리셋이 있으면 변경을 저장한 뒤 이동하고(실패하면 창 안에 오류 문구를 띄우고 머문다), 없으면 이름 창을 열어 저장 성공 후 이동한다. `beforeunload`(새로고침·탭 닫기 경고)는 쓰지 않는다. `useBlocker`는 데이터 라우터에서만 동작하므로 `main.tsx`는 `createBrowserRouter`로 `App`을 splat 라우트 아래에 둔다.

## 준비 조건

**스틱 연결·배터리 판정(Web Serial 동글, 프로토콜 v0.8):** 동글 하나(포트 하나)에 두 스틱이 붙고 `flags` role(0 왼손·1 오른손)로 가른다. 손별 연결은 동글이 1초마다·바뀔 때 보내는 `0x07 LINK` 마스크가 기준이고, LINK를 한 번 받은 뒤엔 STATUS는 배터리만 바꾼다(첫 LINK 전 = 예전 동글 펌웨어는 STATUS가 오면 연결). LINK가 3초 넘게 안 오면 동글 문제(`liveStore.dongle = 'stale'`)로 보고 양손을 끊김으로 둔다. 배터리는 STATUS(5초) 최근 3개 평균이고 20% 이하 주황, 10% 이하 빨강·"곧 꺼짐"(`domain/kit/device/stickStatus`). 시계 동기화는 손별(스틱마다 시계가 다름), 한 손용 명령(방위각 보정·진동·패드 표 재전송)은 LINK 확인 뒤 동글 `0x70 ROUTE`로 감싼다(감싼 SET_PAD_TABLE은 패킷당 패드 2개). 기기별 상태는 `input/deviceState`의 role 0~3 네 칸이고, role 2·3(발)도 같은 네 칸을 쓰며 이벤트는 `pedalStatus`·`pedal`로 낸다(아래 "페달 보드").

**시계 동기화(PLAY-002, 설계 `.claude/plans/PLAY-002-stick-clock-drift.md`):** 스틱 시계는 흐르므로(FW 1.8 분당 약 29ms, FW 1.9 분당 1ms 안팎) 오프셋을 계속 다시 잡는다. 세 소스(Web Serial·WebSocket·BLE) 모두 `SYNC_INTERVAL_MS`(1초)마다 SYNC를 1회 보내고, 연결·시계 초기화 직후에는 종전대로 50~60ms 간격 5회를 보낸다. `input/clockEstimate`가 가장 최근 표본 기준 10초 창(최대 32개)을 들고, 창 안 최소 왕복 + 1ms 이하 표본 가운데 가장 최근 것의 오프셋을 **목표**로 삼는다. 타격 시각 환산에 쓰는 **적용** 오프셋은 목표 쪽으로 초당 최대 1ms씩 따라가며, 첫 표본·첫 표본 뒤 2초(연속 SYNC 구간)·목표와 50ms 이상 벌어졌을 때는 즉시 맞춘다. 기울기 추정은 하지 않는다. `ClockSync.offset`·`clockOffsetOf`는 적용 오프셋, `targetOffset`은 목표, `rtt`는 창 안 최소 왕복이다. 양손과 페달(role 0~3)이 같은 규칙을 쓴다. 센서 시각 u32 µs는 71.6분마다 한 바퀴 도는데, `ClockSync`가 HIT·SYNC_ACK를 같은 펼침 상태로 편다. 기기 사이 고정 어긋남(손·페달의 도착 중앙값 차이)은 이 규칙으로 잡히지 않는다(EMB 실측 뒤 따로 정함).

**페달 보드(PLAY-002, 설계 `.claude/plans/PLAY-002-pedal-input.md`, 프로토콜 v0.8.1):** 킥·하이햇 페달은 동글에 붙은 페달 보드 하나지만 프로토콜이 role 2(왼발 하이햇)·3(오른발 킥) 두 기기처럼 보내므로 FE도 두 칸으로 둔다. `0x07 LINK` 마스크는 bit0~1 손, bit2 왼발, bit3 오른발이고, role 2·3 STATUS는 배터리만 싣는다(비트 5 없음 — 발은 설정 재전송 대상이 아니고 시계 초기화만 한다). SYNC_ACK는 role별로 와서 각 칸 시계가 따로 맞는다(LINK 0→1 때 그 칸 시계 초기화 + SYNC 5회는 손과 같다). `0x08 PEDAL`(state 0 뗌·1 밟음)은 하이햇(role 2)만 오고 시각을 그 칸 시계로 환산해 `pedal` 이벤트로 낸다. 상태는 `liveStore.pedal { connected: [왼발, 오른발], battery, hihatClosed }`에 둔다(배터리는 최근 3개 평균, 왼발이 끊기면 `hihatClosed`는 true로 되돌린다).

- **필수 기기:** 페달은 동글(`webserial`) 소스에서만 필수다(`domain/kit/device/pedalStatus.pedalRequired`). 페달 보드가 동글로만 붙으므로 포인터·BLE·WebSocket 소스는 요구하지 않는다(올 수 없어 영구 미준비가 된다). 키보드 전용도 면제다.
- **준비 조건:** 동글 소스는 손 둘에 더해 두 발이 모두 붙어야 하고(`pedalConnected`), 빠지면 `readiness.missing`에 `'pedal'`("페달을 연결하세요")이 들어간다.
- **끊김:** 센서 모드에서 발이 연결→끊김이 되면 손과 같이 자동 일시정지(`usePauseTriggers.pedalDropped`)·자동 재연결이 시작되고, 손·발 네 칸이 모두 돌아와야 `settle()`한다.
- **동글 탐색 제약:** 동글은 첫 기기가 붙은 뒤 10초만 새 기기를 찾는다(EMB 231). 페달을 나중에 켜면 붙지 않으므로 페달 끊김 상태의 세팅 화면이 "동글을 다시 꽂아 주세요"로 안내한다.
- **기기 이름·연결 문구(`domain/kit/device/devices.ts`, UX-device-naming-unify):** 왼손·오른손·페달의 이름(왼손·오른손·페달)·칩 글자(왼·오·페달)·점 글자(L·R·P)는 `DEVICE_META` 하나에서 가져온다. 상태 단어는 「연결됨」「연결 안 됨」뿐이고(연주 중 사건 제목 「~ 연결이 끊겼어요」만 예외), 여러 기기 상태 한 줄은 `deviceListText`(모두 붙음 「왼손·오른손·페달 연결됨」, 일부 빠짐 「오른손·페달 연결 안 됨」, 순서 왼손→오른손→페달, 페달은 `pedalRequired`일 때만)로 만든다. 묶음 이름은 `deviceGroupName`(동글 소스 「스틱·페달」, 아니면 「스틱」: 셸 칩 aria-label, 기기 준비 카드 줄 이름, 세팅 ① 타일·팝업 이름, 자유 연습 대기 안내), 끊김 제목은 `disconnectTitle` 하나를 끊김 카드와 자유 연습 띠가 같이 쓴다(양손 「양손 스틱 연결이 끊겼어요」). 연결 안내는 「~을 연결해 주세요」로 같다(`readiness`·`lesson`).
- **화면:** 셸 칩 오른쪽에 "페달 ● 82%"(동글 소스면 항상, 끊김은 빨간 점, `StickStatusIndicator`), 세팅 ① 카드의 두 손 카드 아래 페달 줄(`pedalSetupLine`), 시작 확인 창 「기기 준비 필요」 변형의 P 점(`DeviceCheck`, 문구 `deviceListText` 규칙), 끊김 카드(`DisconnectNotice`)·자유 연습 띠(`DisconnectBand`)의 P 점과 "페달 연결이 끊겼어요" 제목. 왼발·오른발을 따로 보이지 않고 "페달" 하나로 묶는다. 실기기 확인은 11/6 통합 테스트(239).

**재연결·설정 재전송(S15P31A307-281, 설계 `.claude/plans/PLAY-002-stick-reconnect.md`):** 설정 원본은 웹 하나이고 스틱 플래시에 저장하지 않는다. 재부팅한 스틱은 STATUS `flags` 비트 5(설정 전)를 보내고, FE는 그 손에만 ROUTE로 패드 표를 강제 재전송(같은 표여도)하고 방위각 오프셋을 0으로 맞춘다(비트 5가 1인 STATUS마다, 손별 1초 쿨다운). 동글 순서상 비트 5 STATUS가 LINK보다 먼저 오므로 안 붙은 손의 배터리·비트 5는 보류했다가 LINK로 붙는 순간 함께 올린다. LINK 비트 0→1이거나 비트 5를 본 기기는 시계 보정(`ClockSync`)을 초기화하고 SYNC를 50ms 간격 5회 보낸다(2초 안 중복은 건너뜀) — 재부팅한 스틱은 시계가 0부터라 옛 offset을 쓰면 안 된다. 비트 5 = 0인 재연결(잠깐 끊김)은 시계만 초기화하고 패드 표·오프셋은 보내지 않는다. SET_PARAM은 게임 화면이 보내지 않으므로 재전송 대상이 아니다.

연주 중 한 손이 끊기면(리듬 게임·악보 연습은 자동 일시정지, 자유 연주는 띠) `app/bootstrap`이 `reconnectStore.start()`로 자동 재연결을 시작한다. 시도 하나 = 웹 쪽 재연결 동작 + 기기 복귀 3초 대기(`runtime/reconnectPolicy`, 손 둘, 동글이면 발 둘까지 네 칸): Web Serial 동글은 포트를 닫고 다시 열고(`reopen`), 포트가 닫혔으면 허락된 포트를 다시 열고(`autoConnect`), BLE 직결은 보관한 기기에 `gatt.connect()`, WS는 재접속한다. 모두 사용자 제스처가 필요 없는 동작이다. 최대 3회(약 10초) 뒤 `failed`가 되고 끊김 카드는 소스별 안내(`hint`: 동글 "동글을 뺐다 다시 꽂아 주세요")와 [드럼 세팅에서 연결하기]를 보인다. 시도 중 [다시 연결]을 누르면 대기를 끊고 다음 시도로 간다. 동글을 뺐다 꽂으면 `navigator.serial`의 `connect` 이벤트로 클릭 없이 포트를 다시 연다. 필요한 기기가 모두 돌아오면 `settle()` → `reconnected`(약 1초, 카드에 「재연결 성공!」·「3초 뒤 이어서 연주해요」) → 리듬 게임·악보 연습은 카운트다운 3·2·1·시작! 뒤 자동으로 이어 연주한다(사용자 클릭 없음). 실기기 확인은 11/6 통합 테스트(239)에서 한다.

연주 전 준비 조건은 두 가지다: 스틱 연결(`connected[0] && connected[1]`, 왼손·오른손 모두, 동글 소스는 두 발 `pedal.connected`도), 최초 설정 완료(`settings.firstSetupDone` + 적용 프리셋 기준 보정 완료 `calibrationReady`). 프리셋은 조건이 아니다 — 시스템 기본(`'system'`)이 항상 적용돼 있다(UX-64 D1). 판정은 `domain/kit/device/readiness.ts`의 `readiness()`가 하고, 키보드 전용(`sensorKind === 'none'`)은 면제라 안내가 뜨지 않는다. 홈은 `ReadinessNotice`로 미비 항목과 "설정으로" 버튼만 보여주고 진입은 막지 않는다. 리듬 게임·악보 연습 모두 시작 확인 창의 「기기 준비 필요」 창에서 같은 안내를 보여주고 조건이 모자라면 시작 버튼과 Enter를 막는다. "설정으로"는 `returnTo`를 넘겨 복귀 띠로 그 화면으로 돌아온다(곡 선택이 URL에 있고 `start=1`을 실어 같은 곡·단계의 시작 확인 창으로 돌아온다).

## 곡·채보 조회

- **서버 데이터 캐시(TanStack Query, 350·351):** 공통 정책은 `runtime/queryClient`에 있다. 다시 받지 않고 쓰는 시간 30초, 보관 5분, 창 포커스 때 자동 재조회 끔(연주 중 탭 전환 대비), 재시도는 네트워크 오류·5xx만 1회(1초 뒤)이고 4xx·취소는 재시도하지 않는다(401은 `apiFetch`가 refresh 뒤 다시 보낸다). 화면은 `runtime/useApiQuery`로 읽는다 — 상태는 `loading`·`ready`·`error`, 오류는 BE `detail` 문장이다. 이 훅은 앱 캐시 인스턴스를 직접 쓰므로 테스트에서 Provider로 감싸지 않아도 되고, 테스트마다 `queryClient.clear()`로 비운다. 쿼리 키·조회 옵션은 `api/queries/*`에 두고 기존 `api/*.ts` 함수를 감싼다. 적용된 목록과 다시 받는 시점(키는 `api/queries/*`):
  - **곡 목록** `['songs','list',조건,소스]` — SongPicker(플레이 후보)와 `/studio` 내 곡(조건 없음). 곡 업로드·삭제·정보 수정·악보 연결 뒤 `['songs']` 무효화. 같은 탭에서 검색어·곡 난이도만 바뀌는 동안 이전 목록을 유지하고, 탭이 바뀌면 이전 탭 곡을 보이지 않는다. 반주 폴링(`useAccompanimentPolling`)은 캐시된 모든 곡 목록의 같은 곡 상태 필드를 고친다(`patchSongStatus`).
  - **내 악보** `['sheets','list']` — 악보 업로드·삭제·제목 수정·곡 연결 뒤 무효화.
  - **연주 기록** `['plays','list',userId,조건]` 쪽 단위(infinite, 조건 = 검색어·기간·모드·정렬·size) — `usePlayLogList`. 연주 업로드 DONE(`playSync`)에서 `['plays']` 무효화.
  - **녹음 보관함** `['recordings','list',조건]` 쪽 단위(infinite) — `useRecordingList`의 반환 형태는 그대로다. 제목 변경·삭제는 캐시 행을 고치고(삭제는 total − 1), 녹음 저장 성공(`recordingSync`) 뒤 무효화, `reload`는 이어 받은 쪽을 버리고 page 0부터 다시 읽는다. 503은 공통 재시도 정책이 맡는다.
  - `songStore`에는 곡 소스·마지막 곡 선택 탭(`scope`, 라이브러리에 들어오면 MINE)·`selectSong`·`loadChart`만 남고 목록 상태는 없다.
- **메뉴 미리 받기(351):** 사이드바 메뉴에 커서가 100ms 머물거나 포커스가 오면 `app/prefetchRoute`가 그 화면 코드(`loadRoute`)와 대표 데이터를 미리 받는다 — `/play`·`/sheet`는 곡 목록(마지막 탭·플레이 후보), `/studio`는 내 곡·악보, `/history`는 연주 기록의 기본 조건(전체·최신순) 첫 쪽(`api/play/playQueries.DEFAULT_PLAY_LIST`, 화면과 같은 키). 비로그인, 연주 중(전체 화면·녹음 중·메트로놈 재생), 데이터 절약(`navigator.connection.saveData`), 2G 이하면 받지 않는다. 화면 코드 파일은 FE `nginx.conf`가 `/assets/` 1년 immutable·`index.html` no-cache라 미리 받은 파일을 그대로 쓴다.
- **사용자 변경:** 로그아웃·세션 만료·다른 계정 로그인으로 사용자가 바뀌면 `app/queryAuthBinding`이 캐시를 모두 비운다(첫 로그인 복원은 비우지 않음).
- **출처:** 기본은 BE(`/api/v1/songs`·`charts`·`chart-versions`). `VITE_SONGS_SOURCE=builtin`으로 빌드하면 BE 없이 내장 3곡(`BUILTIN_CHARTS`)만 쓰고 SongPicker의 "라이브러리" 탭은 숨는다. 내장 소스의 곡·채보 id는 둘 다 `-(인덱스+1)`(음수)이고 `chartVersionId`는 null이다.
- **곡 선택은 URL:** `/play?song=12&chart=34`, `/sheet?song=…&chart=…`. SongPicker에서 난이도 칩을 누르면 `useChartParam.select`가 URL을 바꾸고, 쿼리는 곡·단계를 골라 둘 뿐이다. 악보 연습은 `start=1`일 때 `loadChart`로 채보를 읽어 시작 확인 창이 열린다(아래 「악보 연습」). 리듬 게임은 `start`를 쓰지 않는다 — [▶ 플레이]를 누른 화면 안 「시작 대기」 동안에만 채보를 읽고, `/play?song=&chart=` 링크는 창·자동 시작 없이 곡·단계만 골라 둔 채 열린다(아래 「리듬 게임」). 쿼리만으로 곡·단계와 창이 복원되므로 통합 설정에 다녀와도 곡이 유지된다(`ReadinessNotice`의 `returnTo`는 `pathname + search`). 로드 실패는 `ApiError.detail`을 보이고 "곡 선택으로"가 쿼리를 지운다. `?scope=MINE`이면 "라이브러리" 탭에서 시작하고, `?scope=MINE&song={id}`면 그 곡(READY일 때)을 펼친 채 연다. "라이브러리" 탭에서 READY가 아닌 곡은 상태 배지와 함께 흐려지고 눌리지 않으며, 아래에 "라이브러리" 안내가 붙는다.
- **곡 난이도·플레이 후보:** SongPicker는 목록을 `playableOnly=true`로 읽어 READY이면서 곡 난이도(`songLevel`)가 있는 곡만 받는다. 그래서 "라이브러리" 탭의 처리 중·실패 곡은 목록에 없고, 라이브러리 탭에 고를 곡이 0곡일 때만 표 본문에 「처리 중·실패한 곡은 라이브러리에서 확인하세요.」를 보인다. 0곡이면 표 머리글과 「총 0곡」은 그대로 두고 본문 자리에 안내를 둔다(`SongTable` `emptyState`, 난이도로 비면 「이 난이도의 곡이 없어요」). 칩·검색·탭은 둘러보기라 사용자가 고른 곡은 목록에서 빠져도 선택한 곡 패널에 남고 [준비]가 된다(표에는 강조 행 없음). 패널은 [프리셋 · 준비] 한 줄이고 스틱 연결 문구는 두지 않는다(상단 바 스틱 상태로 확인). 검색창 옆 칩(전체·입문·중급·고급, `ui/Chip`)은 서버 쿼리 `songLevel`로 거르고, 표의 「곡 난이도」 열(폭 74)과 선택한 곡 패널 메타 줄(「BPM 120 · 3:24 · 입문」)에 표기한다(`null`은 표 「—」, 패널은 생략). 곡 난이도는 연습 단계(EASY·NORM·HARD)와 다른 값이라 `LevelBadge`를 쓰지 않는다. 내 곡(`/studio`)은 조건 없이 읽는다. 내장 소스(`VITE_SONGS_SOURCE=builtin`)는 난이도가 없어 `playableOnly`를 무시한다. **배포 순서:** 운영 DB의 기존 곡 backfill(BE 269) 전에 배포하면 곡 선택 목록이 빈다.
- **곡 선택 추천 — [AI 추천곡] 탭·라벨·비슷한 곡(COACH-004):** `VITE_SONGS_SOURCE`가 `builtin`이 아니고 로그인 상태(`authenticated`)이면 SongPicker 범위 버튼이 [기본 곡][내 곡][AI 추천곡]이 된다(아니면 탭 2개·추천 없음). 곡 선택에 들어올 때 탭과 무관하게 `GET /api/v1/songs/recommendations`(`context=SONG_PICKER`, `mode`는 `/play`=RHYTHM·`/sheet`=SHEET, `size=10`)를 한 번만 부르고(`store/recommendationStore`가 키당 1회), 탭·검색·칩을 바꿔도 다시 부르지 않는다. 연주 뒤 곡 선택으로 돌아오면(재마운트) 새로 부른다. **AI 추천곡 탭:** 곡 목록 API를 부르지 않고 받은 추천을 BE 순서 그대로 표에 보인다. 검색·곡 난이도 칩은 `domain/song/recommendation.filterRecommended`로 FE에서 거른다(제목·아티스트 부분 일치, `songLevel` 일치). 불러오는 중은 스피너, 빈 결과·오류·5초 시간 초과는 표 틀 안에 「아직 추천할 곡이 없어요 / 연주 기록을 모아서 실력에 맞는 곡을 추천해 드릴게요.」다. 추천 이유 문구는 보이지 않는다. 이 탭에서 고른 곡(처음 자동 선택된 곡 포함)의 [플레이]·더블클릭·Enter는 추천 `chartId`(곡 상세에 없으면 기본 채보)로 가고 `POST /api/v1/recommendations/{requestId}/clicks`를 기다리지 않고 보낸다(실패 무시). **기본 곡 탭 라벨:** 추천 결과가 있으면 그 곡 행의 제목 옆에 「✦ AI 추천」(`SongTable` `isRecommended`, 12px `--brand-text`, 간격 8, 제목만 말줄임)을 붙인다. 라벨 곡의 [플레이]는 기본 채보이고 클릭 기록이 없다. 라이브러리·AI 추천곡 탭과 추천 실패 때는 라벨이 없다. **선택한 곡 패널 비슷한 곡:** 선택이 300ms 그대로이면 그 곡으로 `GET /api/v1/songs/{songId}/similar`(`size=3`, `difficulty`는 상세를 읽었으면 기본 채보 단계)를 한 번 부르고(키 `SONG_PICKER:SIMILAR:${songId}`), 선택한 곡이 아닌 첫 항목을 [플레이] 줄 아래 구분선과 「✦ 이 곡과 비슷한 곡 · 제목 · 아티스트 · 곡 난이도 · 비슷한 이유」 + [이 곡 보기]로 보인다(`SongDetailPane` `similar`). 결과가 없거나 실패면 구분선까지 없다. [이 곡 보기]는 클릭을 기록하고 탭·검색·칩은 그대로 둔 채 그 곡을 선택한 곡으로 바꾸며(목록에 없으면 강조 행 없이 패널만), 그 곡의 [플레이]는 기본 채보다. 화면을 떠나면 추천 키와 읽은 비슷한 곡 키를 `clear`한다. 필터 아래 추천 카드 줄(`RecommendRow`)은 곡 선택에서 쓰지 않는다(리포트만 쓴다). 테스트: `SongPicker.interaction.test.tsx`(탭·라벨·거르기·빈 상태·[플레이] 채보·클릭·비슷한 곡 300ms·[이 곡 보기]·builtin·비로그인), `play/SongTable.test.tsx`, `play/SongDetailPane*.test.tsx`, `domain/song/recommendation.test.ts`.
- **리포트 하단 추천·비슷한 곡(COACH-004):** 리포트(`/result/:playId/report`) 맨 아래에 "AI 추천 연습곡" 카드가 붙는다. 리포트 요약을 처음 성공으로 받은 직후 `GET /api/v1/songs/recommendations`(`context=REPORT`, `mode`=리포트 모드(`SHEET`만 SHEET, 그 밖은 RHYTHM), `playId`, `size=5`)를 부르고, 키 `REPORT:${playId}`당 1회만 나간다 — store `load`는 키가 없거나 idle일 때만 요청하므로 [다시 시도] 재마운트·PENDING 폴링·StrictMode에도 1회이고, 키는 바깥 `ReportPage`가 `playId` 변경·언마운트 때 `clear`한다. 분석이 PENDING·FAILED여도 보이지만 리포트 로드가 실패하면 요청이 없다. **보이는 조건:** 내장 곡 빌드(`VITE_SONGS_SOURCE=builtin`)가 아니고 로그인 상태이며 결과가 1개 이상일 때만이다(빈 결과·오류·404·5초 초과는 줄만 숨는다). 카드를 누르면 클릭 기록을 기다리지 않고 보낸 뒤 `recommendationPathOf`로 `/play?song=&chart=`(SHEET 리포트는 `/sheet`)로 이동한다. 결과 화면에는 붙이지 않는다. **"방금 친 곡과 비슷한 곡"**은 리포트 응답의 선택 필드 `songId`(`api/play/reports`가 없으면 null)가 있을 때만 추천 카드 아래 별도 카드로 보인다 — `GET /api/v1/songs/{songId}/similar?difficulty=&size=5`(difficulty 없으면 쿼리 생략, 서버 기본 NORMAL). 필드가 없으면(BE 반영 전) 요청도 줄도 없다.
- **비슷한 곡 줄(COACH-004):** 리듬 게임 준비 화면이 없어져 그 아래 가로 카드 줄(`useSimilarSongs`)도 함께 없앴다. 곡 선택 카드 안의 한 줄(위 항목)만 남는다. 가로 카드 줄(`features/result/components/RecommendRow`)은 리포트 화면의 추천이 쓴다. 테스트: `features/result/ReportPage.interaction.test.tsx`(리포트 추천·비슷한 곡), `store/recommendationStore.test.ts`, `api/song/similarSongs.test.ts`, `domain/song/recommendation.test.ts`.
- **변환:** `domain/song/chartMapping.chartFromDetail`이 BE 채보를 `Chart`로 바꾼다. 알 수 없는 pad는 버리고 경고 1회, `timeMs`에 `offsetMs`를 더하지 않으며, `durationMs`가 null이면 마지막 노트 + 1마디, `tempoMap`·`timeSignatureMap`이 둘 이상이면 `variableTempo`로 표시한다. `tempoMap`이 둘 이상이고 `ppq`가 있으면 `domain/time/tempo.tempoSegmentsFrom`이 tick을 곡 시각으로 바꿔 `Chart.tempoSegments`(빠르기 구간)를 채운다. 식은 BE `ChartDocumentReader.milliseconds`와 같다(tick 0 = `offsetMs`).
- **버전 고정:** 곡 선택 직후 `getChartLatest`는 한 번만 부른다. 이후(자산 갱신)는 `chart.chartVersionId`로 `getChartAssets`를 부른다. store는 채보를 캐시하지 않는다.
- **assets:** `loadChart`가 채보와 함께 `getChartAssets`를 부른다. 실패해도 채보는 돌려주고 `assets`가 null이다. `accompanimentUrl`이 있으면 `chart.hasAccompaniment = true`. 서명 URL은 메모리에만 둔다(반주 재생은 아래 "반주 재생" 절).
- **플레이 로그:** `chartVersionId`·`songNumericId`·`chartId`(다시 하기 URL용)·`presetId`가 같이 저장된다. 내장 곡은 null. 채보 노트의 `noteId`와 BE 전체 노트 수(`sourceNoteCount`)도 남긴다(업로드용).

## 곡 작업실(음원 업로드·채보 생성)

- **화면:** `/studio`(상단 메뉴·제목 "라이브러리"). 본문은 라이브러리 목록(`songStore` MINE)이고, 카드 보기·목록 보기 모두 본문 전체 폭이다(카드 보기 오른쪽 안내 패널은 QA 요청으로 없앴다). 제목 오른쪽 끝 [곡 올리기](primary md)가 **업로드 창**(모달)을 열고, 요약 "곡 n개 · 생성 중 n"은 제목 바로 오른쪽에 작은 글씨(16, `ui/PageHeader` `meta`)로 붙는다. 창에는 탭 "음원"(기본)·"MIDI"가 있고 마지막에 고른 탭을 다시 열 때 유지한다. 음원 탭은 MP3·WAV·M4A·OPUS(50 MiB·10분 이내, `POST /api/v1/songs/audio` 202 `{jobId, songId, status}`)이고 회원당 활성 작업은 하나다(초과 시 429 `AUDIO_BUSY`). 업로드 중에는 탭 전환·닫기·Esc·배경 클릭이 잠긴다. 음원 202를 받으면 창이 닫히고 목록을 다시 읽는다.
- **MIDI·MusicXML 업로드:** MIDI·MusicXML 탭은 파일(MIDI `.mid`·`.midi` 1 MiB 이하, 드럼 MusicXML `.musicxml`·`.xml`·`.mxl` 5 MiB 이하)·제목(파일명 기본값)·아티스트로 `POST /api/v1/songs/midi` 또는 `POST /api/v1/songs/musicxml`(293, 확장자로 가름. 둘 다 multipart `title`·`artist`(비면 생략)·`file`)를 한 번 보낸다. 작업(job) 없이 동기 처리라 음원 생성 중에도 올릴 수 있다(그동안 음원 탭은 "「제목」 생성이 끝나면 올릴 수 있어요" 안내). 중복 방지 키가 없어 자동 재시도하지 않는다. 사전 검사는 빈 파일·크기 초과만 하고 내용 판별은 BE에 맡긴다(`domain/song/midiUpload`). 201이면 창을 닫고 이동 없이 목록을 다시 읽어 새 곡 행을 2초 강조한다. 오류는 400 `MIDI_INVALID`·413 `MIDI_TOO_LARGE`·422 `MIDI_UNSUPPORTED`(BE `detail`)·422 `MIDI_NO_DRUM_NOTES` 문구를 창 안에 보이고, 네트워크·5xx는 "업로드 결과를 확인하지 못했습니다" 안내와 함께 목록을 다시 읽는다([다시 시도] 없음, 목록을 보고 직접 다시 올린다). MIDI 곡은 카드의 배지 행에 "MIDI" 칩, MusicXML 곡(`source=MUSICXML`)은 "MusicXML" 칩이 붙는다(목록 행에는 없다). MusicXML 오류는 `MUSICXML_*` 코드(`domain/song/midiUpload`의 문구 표. `MUSICXML_UNSUPPORTED`는 BE `detail` = AI 변환기 메시지, 503 `MUSICXML_UNAVAILABLE`은 곡이 안 생긴 것이 확실해 "변환 서버에 연결할 수 없어요" 고정 문구). 모르는 확장자·크기 초과는 보내기 전에 거절한다. 반주는 BE가 드럼 외 트랙으로 비동기 합성한다(아래 "반주 상태"). 상태는 `midiUploadStore`(`idle`·`uploading`·`done`·`failed`).
- **반주 상태:** 곡 목록·상세·MIDI 업로드 201의 `accompanimentStatus`(`GENERATING`·`READY`·`FAILED`·`NONE`)를 `SongSummary.accompanimentStatus`로 읽는다. 필드가 없거나 모르는 값이면 `hasAccompaniment`로 `READY`/`NONE`을 정한다(`domain/song/songCatalog.accompanimentStatusOf`). 채보 `READY` 곡 중 `GENERATING`은 "반주 생성 중", `FAILED`는 "반주 생성 실패" 배지를 상태 배지 옆에 붙인다(`AccompanimentBadge`, Figma `SongStatusBadge`의 processing·failed 모양). 내 곡 화면은 생성 중 곡만 3초 간격·화면 진입당 최대 20회 곡 상세를 한 곡씩 다시 읽어 상태 필드만 반영한다(`useAccompanimentPolling` → `AccompanimentPoller`, 곡 목록 캐시 갱신, 목록 스켈레톤 없음). 탭이 숨겨지면 멈추고 보이면 남은 횟수로 이어가며, 404 곡은 빼고 다른 실패는 그 회차만 건너뛴다. 상한 뒤에도 생성 중이면 배지를 두고 재진입·새로고침 때 다시 읽는다. 본인 MIDI 곡의 반주 생성 실패 배지는 모양을 유지하는 재시도 버튼이다(접근성 이름·툴팁 「반주 생성 다시 시도」). 누르면 `POST /api/v1/songs/{id}/accompaniment/retry`를 한 번 보내고 대기 중 중복 요청을 막는다. 202 접수나 409 충돌 뒤 상세를 다시 읽어 캐시와 폴링을 갱신하며, 상세 조회 실패면 목록을 다시 읽는다. 결과·오류는 알림으로 보여 주고 계정이 바뀌면 이전 요청의 응답을 적용하지 않는다. 악보 연습 시작 확인 창의 연주 옵션 "반주 재생" 줄은 반주를 못 쓰면 `GENERATING`이면 "(반주 생성 중)", 나머지는 "(반주 없음)"이다.
- **목록 행:** 처리 중 → 실패 → 완료 순, 같은 상태 안에서는 최신순(정렬 안내 문구는 화면에 두지 않는다). 활성 작업은 202 직후 목록에 아직 없어도 맨 위 `ActiveJobCard`(커버·제목·4칸 단계 띠·경과 시간, 한 줄 전체 폭)로 보이고 카드·행 목록에서는 빠진다. 완료 행은 [악보 연습](`/sheet?scope=MINE&song=`)·[플레이](`/play?scope=MINE&song=`), 실패 행은 [다시 올리기]. 목록 보기 행에도 ⋯ 메뉴가 있다(기능 스위치 켜짐일 때). 활성 작업이 도는 동안에도 [+ 곡 올리기]는 켜 두고 창의 음원 탭만 안내로 바뀐다. 곡·악보·진행 작업이 모두 없으면 같은 틀(헤더 [올리기]·보기 전환)을 그대로 두고 카드·목록 자리에 빈 안내 「나만의 곡과 악보를 추가해 봐요!」만 보인다(버튼 없음). 악보 목록을 읽는 동안에는 안내를 띄우지 않고, 항목이 하나라도 생기면 사라진다.
- **완료 시:** 어느 경우든 화면을 옮기지 않고 라이브러리에 머문다(QA). 목록을 다시 읽어 그 행을 2초 강조하고, 이 화면에서 폴링하다 완료를 봤으면(`chartJobStore.doneSource` `live`) 화면 아래 알림 "「제목」 악보가 만들어졌어요"도 띄운다. 복원(`resume`·429 복원) 뒤 첫 조회에서 완료를 본 경우(`restored`)는 알림 없이 강조만 한다. 곡 생성 실패(`JOB_FAILED`)는 목록을 다시 읽어 실패 행으로 보이고, 업로드 단계 실패·404는 창의 음원 탭 안에 오류가 보인다.
- **가수 비움:** 가수를 비워 올리면 저장은 빈 값(null) 그대로 두고, 화면(라이브러리 카드·목록, 곡 선택 표·상세·추천, 시작 확인 창·연주 화면 머리, 자유 연습 반주 고르기)에서만 「알 수 없음」으로 보인다(`domain/song/songCatalog`의 `artistLabel`). 곡 정보 수정 창의 입력칸은 빈 칸 그대로다.
- **실패 재업로드:** 실패 행의 [다시 올리기]는 업로드 창을 음원 탭으로 열고 제목·아티스트를 미리 채운다(파일만 다시 고른다). 양식 위 "「제목」 다시 올리기" 줄의 [취소]로 되돌린다.
- **사전 검사:** `domain/song/chartJob.precheckAudio`가 빈 파일·크기 초과·확장자(MIME)를 전송 전에 거른다. 제목 기본값은 파일명(확장자 제거, 100자).
- **멱등 키:** 파일·제목·아티스트 조합마다 UUID 하나를 `Idempotency-Key` 헤더로 보낸다. 네트워크·503 실패의 **다시 시도**는 같은 키, 내용이 바뀌면 새 키. 같은 키에 다른 내용(409)은 새 키로 한 번 자동 재전송한다.
- **진행 표시:** 작업 ID가 있으면 `GET /api/v1/jobs/{jobId}`의 단계·진행률과 revision을 폴링한다. revision이 증가한 응답만 반영하며 재시도로 진행률이 낮아질 수 있다. 복원에서 작업 ID를 모르면 `GET /api/v1/songs/{id}`를 쓰고 분리·생성 두 칸을 함께 표시한다. 폴링 간격은 30초까지 3초, 10분까지 5초, 그 뒤 15초이며 탭이 숨겨지면 멈추고 다시 보이면 즉시 조회한다. 404·인증 오류는 중단하고 안내하며 일시 오류는 기존 표시를 유지한다. WebSocket은 사용하지 않는다.
- **복원:** 활성 작업 하나를 `localStorage`(`ssaplash.chartJob.v1`)에 두고 새로고침·재방문 때 이어서 폴링한다. 429인데 기록이 없으면(다른 브라우저) 라이브러리의 PROCESSING 곡으로 복원한다. 끝난 작업 기록은 이 화면이 `clear`로 지운다.
- **카드 보기·목록 보기:** 목록 위 오른쪽 [카드 | 목록] 토글로 바꾸고(기본 카드) 고른 값은 `localStorage`(`airdrum.studio.view`)에 기억한다(접근이 막히면 기본값). 카드(Figma `Studio / SongCard` layout=play, 11/11 확정)는 위에서부터 큰 정사각 커버 → 제목 줄(전체 폭, 1줄 말줄임) → 정보 줄(왼쪽에 아티스트와 줄바꿈되는 배지 줄 — 상태 배지·반주 배지·MIDI 칩, 실패 곡은 배지 줄 끝에 사유 한 줄(BE 실패 코드를 사용자 문구로 변환하며, 사유가 없거나 알 수 없으면 "채보를 만들지 못했어요"). 오른쪽에 완료 곡의 사각 [▶ 플레이]) → 맨 아래 버튼이다. 정보 줄 왼쪽 칸이 72px보다 좁아지면 [플레이]가 다음 줄 오른쪽으로 내려간다. 카드에는 날짜가 없다(목록 보기에만). **[▶ 플레이](`studio/PlayModeMenu`):** 누르면 버튼 아래 오른쪽 끝에 맞춰(아래가 모자라면 위로) 글래스 메뉴가 뜨고 「리듬 게임」 → `/play?scope=MINE&song={id}`, 「악보 연습」 → `/sheet?scope=MINE&song={id}`로 간다(곡을 골라 둔 곡 선택 화면, `start` 없음). 열리면 첫 항목에 초점, ↑/↓·Home/End 이동, Enter 선택, Esc는 닫고 버튼으로 초점 복귀, 바깥 클릭은 닫기만 한다(공용 `ui/overlay/Menu`의 `focusFirstItem`·`arrowNav` 옵션). 처리 중·실패 곡에는 없다. **맨 아래 버튼:** 완료 곡은 악보가 있으면 [악보 보기](→ `/studio/sheets/{sheetId}`), 없으면 [악보 올리기](텍스트 버튼, 올리기 창의 악보 칸), 악보 연결 스위치가 꺼져 있으면 비활성 [악보 보기](카드 높이 유지), 실패 곡은 [다시 올리기]. **마우스 올림·카드 안 포커스·플레이 메뉴가 열린 동안**은 테두리가 브랜드색이 되고 네온처럼 번진다(`--brand-glow` 18px · `--brand-glow-soft` 64px, 움직임 줄이기면 전환 없음). 메뉴는 portal에 떠서 카드 `:hover` 밖이므로 열린 동안은 `is-menu-open` 클래스로 유지한다. 그리드는 열 최소 200px·최대 5열(`auto-fill` + `minmax(max(200px, (100% − 간격 4개) ÷ 5), 1fr)`)이라 본문 최대 폭에서 5열이고, 폭이 줄면 4·3·2·1열로 준다. 로딩 스켈레톤도 같은 열 규칙이다. 실패 카드는 커버가 흐리다. 커버(`SongSummary.coverUrl`, 서명 URL 1시간)가 없거나 불러오지 못하면 모든 곡에 같은 CD 기본 커버(`SongCover`의 SVG)를 그린다. 직접 올린 커버만 이미지로 보인다. 커버 이미지를 못 불러오면(서명 URL 만료) 목록을 다시 읽어 새 URL을 받는다(카드 여럿이 실패해도 1분에 한 번, `songCover.coverRefreshDue`). 목록 보기는 한 패널 안의 64 높이 행(커버 44·제목·보조 줄·상태 배지·날짜·동작·⋯)이다. 로딩은 스켈레톤 카드, 목록 오류는 안내 카드와 [다시 시도]다. 스타일은 `features/studio/components/studio.css`에 있다.
- **내 곡 편집:** 카드 커버 오른쪽 위(목록 보기는 행 끝)에 ⋯ 메뉴(`aria-haspopup="menu"`, Esc·바깥 클릭으로 닫힘)가 생긴다. 완료 곡 = [커버 변경] [곡 정보 수정] [곡 삭제](맨 위에 [악보 보기 | 악보 올리기]가 더해진다 — Figma 화면 순서), 실패 곡 = [곡 삭제]만, 처리 중 곡은 메뉴가 없다(`songEdit.menuKinds`, BE는 처리 중 곡의 커버 변경을 허용하지만 FE는 열지 않는다). 항목마다 작은 창(머리에 제목과 ✕)이 따로 열리고 저장·삭제 중에는 입력·✕·Esc·배경 클릭이 잠긴다. 오류는 창 안 문구로 보인다.
  - **커버 변경:** 지금 커버(없으면 기본 커버) 미리보기 · [이미지 고르기](JPG·PNG·WebP, 원본 10 MiB 이하) · [커버 지우기](기본 커버일 때 비활성) · [취소] [저장]. 고르면 가운데를 정사각형으로 잘라 512×512 JPEG(품질 0.85)로 줄여 미리본다(`features/studio/media/coverImage`, 크기 계산은 `songCover.centerSquareCrop`). 바뀐 게 없으면 저장이 꺼진다.
  - **곡 정보 수정:** 제목(1~100자, trim 후)·아티스트(0~100자), 칸 아래 글자 수 안내. 바뀐 필드만 PATCH로 보내고 아티스트를 비우면 `""`를 보낸다(`domain/song/songEdit`).
  - **곡 삭제:** "「제목」을 삭제할까요?" + "채보·반주·커버가 함께 지워지고 되돌릴 수 없습니다. 연주 기록과 결과는 남아요." 확인 후 [삭제](위험 버튼, 진행 중 "삭제 중…"). 끝나면 화면 아래 알림 "「제목」을 삭제했습니다."(3초, `StudioToast`, `role="status"`)를 띄우고 목록을 다시 읽는다. 지운 곡이 `chartJobStore`의 활성 작업이면 그 기록도 `clear`한다.
  - **삭제된 곡의 기록:** BE는 곡을 소프트 삭제해 연주·리포트를 남기고, 지운 곡의 상세는 404 `SONG_NOT_FOUND`다. 결과 화면은 BE 곡 로그면 곡 상세를 한 번 조회해 404일 때만 제목 옆에 "삭제된 곡"을 붙이고 [다시 하기]·Enter를 숨긴다([다른 곡]·[자유 연습]·상세 분석은 그대로). 다른 실패(네트워크·5xx·401)는 삭제로 보지 않는다(`api/song/songs.checkSongAvailability`, `domain/song/songAvailability`).
  - **성공 후:** 창 닫기 → `songEditStore.reset` → 목록 다시 읽기 → 편집한 카드 2초 강조(삭제는 강조 없음). 403 `SONG_FORBIDDEN`·409 `SONG_BUSY`·400·413·415·503 `COVER_UNAVAILABLE`(저장소 장애)는 창 안에 문구, 404 `SONG_NOT_FOUND`는 문구와 함께 목록을 다시 읽고, 네트워크·5xx·알 수 없는 코드는 "결과를 확인하지 못했습니다. 목록을 확인해 주세요."와 함께 목록을 다시 읽는다. 상태는 `songEditStore`(`idle`·`saving`·`done`·`failed`, 실행 중 재호출 무시).
  - **API(BE 187 합의, 운영 반영됨):** `PATCH /api/v1/songs/{id}` JSON `{title?, artist?}` → 200 상세 · `PUT /api/v1/songs/{id}/cover` multipart `file`(≤ 2 MiB) → 200 `{coverUrl}` · `DELETE /api/v1/songs/{id}/cover` → 204 · `DELETE /api/v1/songs/{id}` → 204. 오류 코드는 `SONG_INVALID`·`SONG_FORBIDDEN`·`SONG_NOT_FOUND`·`SONG_BUSY`·`COVER_INVALID`·`COVER_TOO_LARGE`·`COVER_UNSUPPORTED`·`COVER_UNAVAILABLE`. 목록·상세 응답에는 `coverUrl: string | null`(서명 URL, 1시간)이 더해진다. 커버는 2 MiB·4096px·400만 픽셀 이하. 곡 삭제는 소프트 삭제다.
- **제외(후속):** 곡 선택 창의 커버 표시, 진행 WebSocket(BE 161).
- **곡 재생바·제목 흐름(S15P31A307-327, 카드 개편 363):** 곡 READY + 반주 READY인 곡만 들을 수 있다(`features/studio/domain/songPlayback`의 `canListen`). **카드 보기**는 커버 아래쪽에 재생 UI(`studio/CoverPlayer`)를 겹쳐 그린다: 아래로 어두워지는 바탕(투명 → 86%) 위에 [10초 뒤로 22][재생/일시정지 28][10초 앞으로 22](버튼 틀 32, 간격 18, `song/PlaybackTransport`의 `skipIconSize`)와 폭 전체 시간 바(`free/SeekBar`의 `layout="bare"`: 시간 글자 없이 3px, 마우스 올림 5px, 끄는 중·키보드 포커스 7px, 끌기·클릭·←/→ 5초·Home/End). 재생 UI는 마우스 올림·카드 안 포커스·플레이 메뉴 열림 때 아래에서 8px 올라오며 보이고, 그 곡이 재생 대상(불러오는 중·재생 중·일시정지·오류)이면 `is-pinned`로 계속 남는다. 터치 기기(`@media (hover: none)`)는 항상 보인다. 쉬는 상태는 ▶만 눌리고(10초 버튼은 보이되 비활성, `skipsDisabled`) 빈 막대이며, ▶를 누르면 그 곡이 재생 대상이 된다(다른 곡은 꺼진다). 불러오는 중은 세 버튼 비활성 + 막대 흐름 효과, 오류는 조작 줄 자리에 오류 한 줄 + [다시 시도]다. MIDI 등 반주가 없는 곡에는 재생 UI가 없고 테두리만 켜진다. 재생 UI 조작은 주소를 바꾸지 않는다. **목록 보기 줄**은 재생바(`studio/SongPlayBar`)가 제목 칸 오른쪽에 항상 보인다(제목 칸 1 : 재생바 2). 쉬는 상태는 ▶ + 빈 막대 + 「0:00 · −곡 길이」이고, ▶를 누르면 [10초 뒤로][재생/일시정지][10초 앞으로] + 진행 막대(`SeekBar` `layout="ends"`: 손잡이 없는 3px 막대, 끄는 동안 7px, 막대 아래 양끝에 경과·남은 시간, 불러오는 중·오류 [다시 시도])로 바뀐다. 760px 이하 목록 줄은 막대와 10초 버튼을 숨겨 ▶만 남긴다. 재생 대상 곡은 제목 옆에 이퀄라이저(`song/PlayingEq`)가 붙는다(재생 중이면 움직이고 멈추면 납작한 회색). 재생기는 `StudioPage`가 자유 연습의 `useFreeAccompaniment` 하나를 들어 한 번에 한 곡만 울리고, 탭을 숨기면 일시정지·화면을 떠나면 해제한다. 듣던 곡이 목록에서 사라지면 끈다. 상태·조작 묶음은 `SongPlayback`(없으면 듣기 UI를 그리지 않음 — `VITE_SONGS_SOURCE=builtin`). 소리가 나는 동안(playing)이고 제목이 칸보다 길 때만 제목이 `song/MarqueeTitle`로 흐른다. 칸에 들어가는 제목은 재생 중에도 그대로다(`domain/song/marquee`의 `marqueeOverflows`로 판단, 한 바퀴 시간은 `marqueeDurationSec` — 초당 40px·최소 6초). 움직임 줄이기 설정이면 흐르지 않고 말줄임이다. 글리프는 `song/PlaybackIcons`의 `PlayGlyph`·`PauseGlyph`·`Back10Icon`·`Forward10Icon`(흰색). 페이지 연결은 `StudioPage.listen.interaction.test.tsx`, 카드는 `MySongCard.layout.interaction.test.tsx`·`CoverPlayer.interaction.test.tsx`·`PlayModeMenu.interaction.test.tsx`가 본다.

## 내 악보 보관·보기 (CHART-001, 278번)

회원이 드럼 악보(이미지·PDF)를 올려 두고 라이브러리에서 골라 본다. 음원 없이 악보만 보관해 합주실·연습실에서 꺼내 보는 것이 주 용도다. BE 155 `/api/v1/sheets`(`features/studio/api/sheets`), 도메인은 `features/studio/domain/sheetMusic`.

- **악보-곡 연결 제약:** 곡 하나에 악보 하나이다(409 `SHEET_ALREADY_LINKED`). 곡을 지우면 BE가 악보는 남기고 연결만 끊으므로(BE 회신 3, `PATCH /api/v1/sheets/{id}`의 `songId`와 함께 11/13 릴리즈) FE는 곡 삭제 뒤 악보 목록도 다시 읽고, 삭제 안내는 「…연결된 악보와 연주 기록·결과는 남아요」다.
- **올리기:** 헤더 [올리기] 창 맨 위 [음원·MIDI | 악보] 전환(마지막 섹션은 localStorage `airdrum.studio.uploadSection`). [악보]는 이미지(JPG·PNG·WEBP) 1~20장 또는 PDF 1개 + 제목(1~100자). 고른 순서가 쪽 순서다. 섞음·21장 이상·형식·크기(이미지 10 MiB, PDF 20 MiB)는 요청 전에 `validateSheetFiles`로 막고, 화소 상한·한도(100개·500 MiB)는 BE 응답 문구를 보인다(`sheetErrorText`). 헤더에서는 곡 없이 올린다.
- **라이브러리 악보 항목:** 곡에 연결되지 않은 악보는 카드·목록 보기에 곡과 섞여 한 항목으로 보인다(`mergeLibraryItems`, 정렬은 내 곡 규칙의 「그 밖」 그룹). 썸네일(이미지 1쪽, PDF는 자리표시) · 「악보 · 이미지 n쪽」/「악보 · PDF」 · 「악보만」 칩 · [악보 보기]. 곡 카드·곡 행과 같은 틀·같은 높이이고 비활성 ▶·[악보 연습]·설명 문구는 두지 않는다(상태 줄은 「악보만」 칩뿐). ▶ 자리에 같은 크기의 원형 업로드 버튼(브랜드 외곽선·아이콘, `aria-label="「제목」 곡 올리기"`)이, 목록 보기에는 [악보 보기] 다음에 [⤒ 곡 올리기](브랜드 외곽선)가 생긴다. ⋯ = [제목 수정 | 악보 삭제]. 악보 목록만 실패하면 곡은 그대로 두고 「악보를 불러오지 못했어요 [다시 시도]」 한 줄. 곡 고르기(리듬 게임·악보 연습)는 곡 API만 읽으므로 악보 항목이 나오지 않는다.
- **곡 연결:** 완료 곡 ⋯ 메뉴에 `sheetId`가 있으면 [악보 보기], 없으면 [악보 올리기](창이 [악보] 섹션으로 열리고 `songId`를 보낸다). 409 `SHEET_ALREADY_LINKED`·404 `SONG_NOT_FOUND`는 창 안 문구. 곡에 붙은 악보는 따로 항목으로 보이지 않는다.
- **나중 연결(D15~D17):** [곡 올리기]는 `features/studio/store/sheetLinkStore`에 대상 악보를 정하고 업로드 창을 「곡 올리기」 제목·[음원·MIDI] 양식으로 연다(섹션 전환 없음, 창 위 「「악보 제목」 악보에 연결돼요」, 제목 기본값 = 악보 제목, 다시 올리기 안내 없음). 곡이 등록되면 응답의 곡 id(음원 202 `songId`·MIDI·MusicXML 201 `id`)로 `PATCH /api/v1/sheets/{id}` `{songId}`를 한 번 보내고(`features/studio/api/sheets.linkSheetToSong`) 곡·악보 목록을 다시 읽으며 「곡을 올리고 악보를 연결했어요」 토스트를 보인다. 연결이 실패하면 곡은 남고 목록 위에 「곡은 올렸지만 악보를 연결하지 못했어요 [다시 연결]」이 보이며 [다시 연결]은 PATCH만 다시 보낸다(재시도 대상은 메모리에만 있어 새로고침하면 사라진다). 창을 닫거나 헤더 [올리기]·곡 ⋯ [악보 올리기]·다시 올리기로 열면 대상 지정이 풀린다.
- **뷰어 `/studio/sheets/:id`(`features/studio/SheetViewerPage`, `components/sheet`):** 셸을 숨긴 전체 화면. 이미지는 한 쪽씩(← → 키, 좌우 밀기, 좌우 25% 가장자리 탭, 다음 쪽 미리 받기), PDF는 `PdfPages`가 쪽을 화면 폭에 맞춰 세로로 그리고 화면 근처 쪽만 그린다. 바에 n/m, 가운데 탭으로 몰입 모드(바 숨김, n/m 칩만). ⋯로 제목 수정·삭제(삭제 뒤 `/studio`로 가며 토스트). 600px 이하에서는 뒤로 아이콘만 남기고 좌우 버튼·종류 배지를 숨긴다.
- **서명 URL(1시간):** 만료 2분 전에 상세를 다시 읽어 URL만 바꾼다(보던 쪽 유지, 최소 30초 간격). 그림·PDF 읽기 실패는 상세를 1회 다시 읽고 또 실패하면 [다시 시도]. 404 `SHEET_NOT_FOUND`는 「지워졌거나 주소가 틀렸어요」 + [라이브러리로]. URL·파일은 메모리에만 둔다.

## 결과·연주 기록

- **결과(`/result/:playId`, Figma 112:1194):** 로컬 로그(`engine/playLog.getPlayLog`)를 읽어 요약 카드(`result/ResultSummaryCard` — 왼쪽 제목·메타, 오른쪽 지표 묶음 [점수/최고 콤보 | 세로선 | 정확도 64], 간격 48·아래 정렬) → 상세 분석 진입(`ReportEntry`) → 판정 분포(`JudgeBars`)·타이밍 분포(`TimingHistogram`, 계산 `features/result/domain/timingHistogram`) → 피드백 카드 최대 3장(`FeedbackCard`, 악보 모드 + 업로드 대상 아님만)·약점 마디 미니 악보 → 패드별 표(`PadSummaryTable`, 모든 모드) → 버튼 행 순으로 그린다. 악보 모드는 요약 카드에 점수 블록과 세로선이 없다. 패드별 표의 정확도·평균 세기는 `features/result/domain/feedback.summarizeByPad`가 계산하고(평균 세기 = 판정된 노트에 매칭된 타격 velocity 평균 → 0~100, 로그에 hits가 없으면 「—」), 평균 타이밍 열은 ≤1024px에서 숨긴다. 기록이 없는 id는 `ui/EmptyState`로 안내한다. 삭제된 곡이면 제목 옆에 `song/DeletedSongChip`을 붙이고 [다시 하기]·Enter를 숨긴다.
- **연주 기록(`/history`) 플레이 기록 탭 (338, 설계 `.claude/plans/COACH-연주-기록-화면-개편.md`):** 표가 아니라 라이브러리 목록과 같은 **행 목록**이고 종료 시각 기준으로 **날짜별로 묶는다**(오늘·어제·날짜, 묶음 머리에 판 수).
  - **서버 검색·필터:** 곡 제목 검색(300ms 디바운스)·모드(전체·리듬 게임·악보 연습)·기간(전체 기간·7일·30일)·정렬(최신·오래된)은 `GET /api/v1/plays?q&from&to&mode&sort&page&size`(BE 309)가 처리하고 20건씩 받아 [더 보기]로 이어 붙인다(`usePlayLogList`, 녹음 보관함과 같은 방식). 기간은 한국 시간 날짜(`periodRange`, 오늘 포함)로 보낸다. 건수는 서버 전체 건수 + 아래 "서버에 없는 기록" 수다. 서버 검색은 접근할 수 있는 곡 제목만 찾는다(삭제된 곡의 기록은 검색에 안 잡힌다).
  - **행(`PlayLogRow`, 값은 `playLogRows`):** 제목 + 난이도 배지(리듬 게임·악보 연습 모두) + 칩(「중단」 = 끝까지 치지 않음, 「삭제된 곡」·「이용할 수 없는 곡」) / 보조 줄(모드·종료 시각·연주 길이) / 정확도(큰 숫자 24px + 막대 8px, 리듬 게임은 점수도) / 오른쪽 링크(테두리 상자). 제목 17px·정확도 숫자 24px·막대 8px(11/12 팀 의견으로 키움). **넓은 화면(901px 이상)은 한 줄 행**(72px)이다: 제목을 세로 가운데에 두고 모드·시각·길이를 제목 바로 뒤에 이어 붙여, 빈 자리가 정확도 왼쪽 한 곳으로 모인다(긴 제목은 제목이 먼저 `…`으로 줄어든다). 그보다 좁으면 보조 줄이 제목 아래로 내려간다(84px). 녹음 행의 정보 칸도 같은 규칙이고 그 오른쪽에 재생바가 놓인다. 막대 색은 판정 색과 같은 뜻이다: 90% 이상 `--perfect`, 70% 이상 `--good`, 그 아래 `--miss`(`accuracyTier`, 70은 입문 코스 통과 기준). 왼쪽 모드 그림은 없다.
  - **이동:** 행은 누르는 곳이 아니다. 테두리 상자 링크 「리포트 ›」(서버에 리포트 있음 → `/result/:playId/report`) 또는 「결과 ›」(이 브라우저에 로그가 있음 → `/result/:playId`)만 이동하고, 둘 다 없으면 「리포트 없음」.
  - **아직 서버에 없는 기록:** 이 브라우저의 로그(계정별 저장) 중 받은 서버 쪽에 없고 업로드 상태가 `DONE`이 아닌 것(`unsavedLogs`). `DONE`인 로그는 서버에 있으므로 아직 받지 않은 쪽에 있어도 섞지 않는다. 같은 검색·모드·기간을 화면에서 적용하고, 다음 쪽이 남았으면 받은 시각 범위 안의 것만 시각 순서로 섞는다(`mergeUnsaved`). 행 오른쪽에 저장 상태를 보인다(라이브러리 「채보 생성 중」과 같은 방식): `UPLOADING` → 「저장 중…」(탭에 들어올 때 끊긴 업로드는 다시 보낸다), 다시 보낼 수 있는 `FAILED` → 「저장 실패」 + [다시 시도](`startPlaySync`), 그 밖(`SKIPPED`·다시 못 보내는 실패·옛 로그) → 「저장 안 됨」. 저장이 끝나면 `['plays']` 무효화로 서버 행으로 바뀐다.
  - **상태:** 조건 없이 기록이 없으면 큰 빈 상태 + [리듬 게임 시작], 조건에 맞는 기록이 없으면 작은 빈 상태 + [조건 지우기], 서버 오류는 다시 시도(서버에 없는 기록이 있으면 그 위에 오류 줄). 서버가 접근 불가로 반환한 곡은 제목을 흐리게 하고 안내 칩을 붙이며, 로컬 기록은 기존 곡 삭제 검사를 쓴다. 비로그인 개발 모드는 서버 없이 이 브라우저의 기록만 쪽 나눔 없이 보이고 저장 상태는 표시하지 않는다. 계정이 바뀌면 키가 달라 이전 계정 응답이 섞이지 않는다.
  - **좁은 화면(≤720px):** 점수와 녹음의 타격 수를 숨기고 정확도·링크는 남긴다. 녹음 재생바는 막대·10초 버튼을 숨겨 ▶만 남긴다(라이브러리 목록 줄과 같은 규칙).

## 연주 녹음·녹음 보관함 (REC-001, `src/components/recording`)

- **녹음이란:** 타격 시퀀스(`tMs`·`pad`·`velocity`·`stickId`)만 저장한다. 소리·화면 녹화가 아니고 재생은 FE가 드럼 소리로 다시 연주한다. 타입·본문 조립·기본 제목(`{곡 제목} · {M월 D일 HH:mm}`, 자유 연습은 `자유 연습 · …`, 100자 자르기)은 `domain/play/recording`, 화면 문구(모드명·요약·타격 수)는 `domain/play/recordingView`, 경과 시간 `mm:ss`는 `domain/time/formatTime.formatElapsed`.
- **Dock 녹음 버튼(`recording/RecordButton`, Figma Navigation / DockRecord 523:31016):** `/free`·`/play`·`/sheet`에서만 [BPM +] 오른쪽에 보인다(`recordButtonRoute.recordButtonVisible`). 자유 연습은 누를 때마다 시작·정지(`녹음 중 · mm:ss` 경과 표시), 리듬 게임·악보 연습은 연주 전에 켜 두는 스위치(`녹음 켬`)로 연주 단계(카운트인 포함)에는 잠긴다(`locked-on` "녹음 중" / `locked-off` 흐림). 저장 창이 열린 동안도 잠긴다. 점은 모든 상태에서 같은 빨간 원이고 상태는 글자·테두리·흐림으로만 구분한다. 접힘 Dock은 녹음 버튼이 있는 화면에서 메트로놈 아이콘 옆에 녹음 상태 아이콘을 늘 보인다(꺼짐은 흐린 원, 녹음 중은 빨간 원, 누를 수 없음). 상태 기계(idle → armed/recording → pendingSave → saving → idle/failed)는 `runtime/recordingStore`.
- **저장 흐름:** 자유 연습은 정지 때, 게임·악보는 곡이 끝난 뒤 플레이 로그 타격(`PlayRecorder.hits`의 `tSongMs`)에서 본문을 만들어 결과 화면 위에 저장 창(`recording/SaveRecordingDialog`, AppShell에 한 번 마운트, 폭 560, Esc·배경 클릭으로 닫히지 않음)이 뜬다. 제목 입력칸은 기본 제목이 전체 선택된 채 열리고, 비우면 기본 제목. [저장] → `POST /api/v1/recordings`(`runtime/recordingSync`: 503은 같은 본문·같은 `clientKey`로 1·2·4초 최대 3회 자동 재시도, 네트워크·5xx·401은 [다시 시도], 409·400·404·413은 [닫기]만, 코드 없는 Nginx 413은 "너무 길어 저장하지 못했어요"). 게임·악보는 플레이 로그 업로드가 `DONE`일 때만 `playId`를 싣는다. 타격 0개면 저장 창 대신 토스트. 자유 연습은 50,000타·2시간에 닿으면 자동 정지. 저장 완료 토스트(`recording/RecordingToast`, 하단 중앙 4초)의 [보관함]은 `/history?tab=recordings`로 간다. 미전송 녹음은 메모리에만 있어 새로고침하면 사라진다(설계 U4).
- **녹음 보관함(연주 기록 [녹음] 탭, `features/history/RecordingList`, 338 개편):** `GET /api/v1/recordings`를 제목 검색(300ms 디바운스)·모드 단추(전체·자유 연습·리듬 게임·악보 연습)·정렬(최신·오래된)로 20건씩 받고 [더 보기]로 이어 붙인다(`useRecordingList`). 플레이 기록 탭과 같은 행 목록이다: 제목(타격이 없으면 「타격 없음」 칩) + 보조 정보(모드·곡 제목 + 난이도 배지·녹음 시각) · 재생바 · 타격 수 · ⋯. 정보 칸은 플레이 기록 행과 같은 배치(넓은 화면은 제목 뒤에 한 줄로 이어 붙임, 좁으면 제목 아래 줄)이고, 재생바에 폭을 내주므로 보조 정보는 줄바꿈 없이 두고 자리가 모자라면 곡 제목이 먼저 `…`으로 줄어든다. 저장할 때 붙는 기본 제목(`{곡 제목} · {M월 D일 HH:mm}`)을 그대로 둔 녹음은 곡 제목·녹음 시각이 보조 정보와 겹치므로 이름만 제목으로 보이고(곡 녹음은 곡 제목 + 난이도 배지, 자유 연습은 「자유 연습」만) 겹치는 칸을 뺀다(`domain/play/recordingView.recordingRowLabel`). 표시만 바꾸며 저장된 제목·⋯ 메뉴 라벨·제목 변경 창은 그대로다. **재생바(`RecordingPlayBar`):** 라이브러리 목록 줄의 곡 재생바(`studio/SongPlayBar`)와 같은 모양으로 모든 행에 항상 보인다 — 조작부 `song/PlaybackTransport`([10초 뒤로][재생/일시정지][10초 앞으로])와 막대 `song/SeekBar`(`layout="ends"`: 손잡이 없는 3px, 끄는 동안 7px, 막대 아래 양끝에 경과·남은 시간, 이름 「녹음 위치」)를 그대로 쓰고, 기능 폴더끼리 import하지 않으므로 틀(`rec-playbar-*`, `.song-playbar`와 같은 값)만 따로 둔다. 쉬는 상태는 ▶ + 빈 막대 + 「0:00 · −녹음 길이」(길이 칸은 따로 없다)이고, ▶를 누르면 상세(`GET /recordings/{id}`)를 받아 그 녹음이 재생 대상이 된다(준비 중 = 상세 조회부터 소리가 실제로 시작될 때까지 한 번에 이어지며, 그동안 쉬는 모양을 그대로 두고 `aria-busy`만 건다. 보통 수십 ms라 문구·비활성으로 바꾸면 깜빡임만 남기 때문이다. 1초 넘게 걸릴 때만 ▶가 흐려지고, 그 사이 다시 누르기는 무시한다). 재생은 `features/history/recordingPlayer`가 100ms 창 look-ahead로 드럼 소리를 예약해 재연주한다(`useRecordingPlayback`, 한 번에 한 행). 재생 대상 행의 가운데 버튼은 일시정지 ↔ 이어 재생(`pause`·`resume`, 붙잡은 위치부터)이고, 막대 끌기·누르기·←/→ 5초·Home/End와 10초 버튼으로 위치를 옮긴다(`seek`, 0~길이로 자름, 일시정지 중에도 가능). 다른 행을 재생하면 그 행이 처음부터 재생되고, 끝까지 재생하거나 화면을 떠나면 쉬는 상태로 돌아간다. 일시정지·옮기기 때도 이미 예약된 0.1초 안의 소리는 난다. 재생 중에는 위치가 매 프레임 바뀌므로 행은 `memo`이고 표시부(`RecordingBoard`)가 고정된 콜백을 넘긴다 — 재생 대상 행만 다시 그린다(전부 다시 그리면 화면이 끊긴다). 행에 새 prop을 넘길 때는 매번 새로 만들어지는 값(인라인 함수·객체)을 넘기지 않는다. 흐름과 이 규칙은 `RecordingList.playback.interaction.test.tsx`가 본다. ⋯ 메뉴(`ui/overlay/MoreMenu`, Figma Studio / MoreMenu `kind=recording` 799:37487)는 [MIDI로 내보내기](타격 0개면 숨김, 아래 항목)·[제목 변경](`RecordingTitleDialog`, 1~100자, `PATCH`)·[삭제](`RecordingDeleteDialog`, 확인 창, `DELETE`). 404 `RECORDING_NOT_FOUND`면 "이미 지워진 녹음이에요" 토스트 뒤 목록을 다시 받는다. 보관함은 계정당 200개(저장 413 `RECORDING_QUOTA_EXCEEDED`).
- **MIDI 내보내기 (REC-002):** ⋯ → [MIDI로 내보내기]를 누르면 상세(`GET /recordings/{id}`)를 받아 `features/history/domain/recordingMidi.recordingToMidi`가 SMF Type 0(트랙 1개, 트랙 이름 "Drums", 채널 10)을 만들고 `features/history/media/downloadFile.downloadBlob`이 `{제목}.mid`로 내려받는다(파일명은 `\ / : * ? " < > |`·제어 문자를 빼고 80자, 비면 `recording-{id}.mid`). 바이트 쓰기는 `features/history/domain/midiFile.writeMidiFile`, 외부 라이브러리는 쓰지 않는다. 노트는 패드마다 GM 번호 하나(BE 시드의 대표 피치): KICK 36 · SNARE 38 · HIHAT 42 · HIHAT_PEDAL 44 · SMALL_TOM 50 · MID_TOM 47 · FLOOR_TOM 43 · CRASH 49 · RIDE 51. 친 시각은 퀀타이즈하지 않는다. 게임·악보 녹음은 상세 `timing`(녹음 당시 채보 버전)의 `ppq`·`tempoMap`·`timeSignatureMap`을 넣고 `offsetMs`를 1마디 1박에 맞추며, 그보다 앞에 친 타격이 있으면 첫 박자표 길이로 앞 마디를 덧붙인다(tick 0에 첫 템포·박자표도 둔다). `timing`이 없거나 값이 이상하면(자유·박자 모드 포함) 120 BPM · 4/4 · ppq 480 · 원점 0ms이고, 곡 녹음이 이렇게 나가면 "곡 빠르기 정보가 없어 120 BPM으로 내보냈어요" 토스트가 뜬다. 분모가 2의 거듭제곱이 아닌 박자표는 4/4 하나로 바꾼다(템포는 유지). 세기는 1~127(0은 note-off로 읽혀 1로 올림), 노트 길이는 `ppq/8`이되 같은 노트의 다음 타격 1 tick 전에 끝내고, 같은 tick 같은 노트는 하나로 합친다(세기는 큰 쪽). 같은 녹음을 내보내는 중에는 다시 눌러도 조회하지 않는다. 테스트: `features/history/domain/midiFile.test.ts`, `features/history/domain/recordingMidi.test.ts`, `recording/RecordingList.midi.interaction.test.tsx`.
- **로컬 확인:** BE(256·257 포함)를 띄운 뒤, 자유 연습에서 녹음 → 저장(201) → 연주 기록 [녹음] 탭에서 목록·재생·MIDI 내보내기·제목 변경·삭제를 확인한다.

## 플레이 기록 업로드·상세 분석

- **흐름:** 연주 종료 → 로컬 저장 → 결과 화면(로컬 값, 기다리지 않음). 동시에 `runtime/playSync.startPlaySync`가 `POST /api/v1/plays`(ACCT-002 요약)를 보낸다. 성공하면 리포트 요약과 노트 첫 페이지를 미리 받아 두고 결과 화면의 **상세 분석 보기**가 `/result/:playId/report`로 열린다.
- **playId:** 연주마다 UUID(`newPlayId`). 이전 로그(`play-…`)는 업로드하지 않는다.
- **seq:** `features/play/playRecorder`가 활성 타격과 MISS 판정에 처리 순서대로 번호를 매긴다. 서버가 seq 순서로 maxCombo를 다시 계산하므로 이 순서가 어긋나면 400이다.
- **점수 규칙:** `domain/play/judgement.JUDGEMENT_SCORE` — PERFECT 100 · GOOD 80 · MISS 0, 버전 `SCORE_RULE = 'SCORE_V2'`(업로드 `judgementContext.judgementVersion`). GOOD은 11/12 팀 결정으로 60(`SCORE_V1`)에서 80으로 올렸다(330번, 하나도 놓치지 않고 전부 GOOD이면 80%라 입문 코스 통과 70%를 넘는다). 세션 점수·HUD·결과·피드백·업로드가 모두 이 상수를 쓴다. 값을 바꾸면 버전을 올리고 BE `ScoreRule`에 같은 버전을 더한다(서버가 버전별 규칙으로 검산). 지난 기록은 다시 계산하지 않는다.
- **본문 조립:** `domain/play/playUpload.buildUploadBody`. 판정 타격 `tMs` = 노트 시각 + Δ, MISS `tMs` = 노트 시각, 정확도는 `score / 전체 노트 수` 백분율 소수 둘째 자리 HALF_UP. 입력은 실제 스틱(ble·webserial·websocket)만 `STICK`, 키보드·포인터는 `KEYBOARD`(센서 필드 null). `consent`는 플레이 시작 시점에 로그에 저장해 둔 값(`PlayLog.consent`)을 `domain/play/dataConsent.logConsent`로 싣는다. 필드가 없는 옛 로그는 `false`.
- **업로드하지 않는 경우(SKIPPED):** 내장 곡, 이전 로그, 변환에서 버린 노트가 있는 채보, 자유 연주, 50,000행 초과. 결과 화면 버튼에 사유가 나온다.
- **실패·재전송:** 상태는 로그의 `upload`(UPLOADING·DONE·FAILED·SKIPPED)에 저장한다. 처음 조립한 본문을 보관해 같은 playId로 그대로 다시 보낸다(같은 UUID에 다른 내용은 409). 네트워크·5xx·401·`PLAY_STATE_CHANGED`는 재시도 가능, 400·404·그 밖의 409·413은 불가. 결과 화면에 들어올 때 한 번 자동 재전송하고 이후는 **다시 시도** 버튼.
- **상세 분석:** 서버 데이터만 쓴다. `api/play/reports`가 정확도(0~100 → 0~1)·패드 옛 이름·null을 변환하고, 노트는 `limit` 1000으로 `nextAfterSeq`가 null일 때까지 받아 시간순으로 정렬한다(seq는 시간순이 아니다).
- **리포트 화면 구성(S15P31A307-329, 애플 스타일 개편 S15P31A307-403):** 순서는 메타 줄 → 머리(총평 · 점수) → 하이라이트 → 전체 노트 흐름 → 선택 구간 확대 → 관찰(패드 전환 · 그 밖) | 패드별 기록(넓은 화면 두 칸, 타이밍 분포는 접기) → 추천. 시각 언어는 큰 글자 제목, 판정 막대, 둥근 묶음 면(`--surface-1`, 반경 20px) 위의 차트·목록, 안쪽 조작은 캡슐(`--surface-2`)이다. **머리(`ReportHero`):** 총평 첫 문장(코치 한마디)이 제목(h1, 22~28px 굵게·540px 이하 22px)이자 머리의 주인공이다. 나머지 문장은 구분선 아래 「자세한 분석」 칸에 문장마다 한 줄로 보인다(19px 보통 굵기·보조색·줄 간격 1.6, 540px 이하 17px, `reportView.splitSentences`). 한 문장뿐인 총평이면 칸 없이 한마디만 보인다(`reportView.splitSummary`: 줄바꿈·연속 공백은 공백 하나로 잇고 「. ! ?」 뒤 공백을 문장 끝으로 본다. 문장부호 없이 이어 쓴 LLM 총평은 「어요·세요·니다·었다」 같은 어미 뒤 공백에서도 나누고, 둘 다 있으면 앞선 쪽을 쓴다. 「필요·중요」처럼 요로 끝나는 낱말에서는 나누지 않는다). AI weak-rules-0.5부터는 짧은 곡에도 서버 총평이 온다(노트 1~7개 간단 총평, 8~19개 짧은 곡 분석). 그 전에 친 짧은 곡(판정 노트 20개 미만)이나 총평 없이 분석이 끝난(DONE) 판에는 FE가 판정 개수로 고른 템플릿 총평을 대신 둔다(`reportView.shortPlaySummary`: 레벨 경계는 AI 규칙 총평과 같아 놓침 40% 이상 NEEDS_WORK, 놓침 10% 미만·정확 50% 이상 GOOD, 그 사이 FAIR이고 빠름·늦음·놓침 중 많은 쪽을 짚는다. source `FE_TEMPLATE`라 「AI가 작성했어요」를 붙이지 않는다). 분석 중(`PENDING`)이거나 첫 응답 전이면 곡 이름 대신 자리 표시(`HeroPending`: 「코치가 연주를 살펴보고 있어요」 h1 + 회색 줄 2개, `aria-busy`, 모션 줄이기면 깜빡임 없음)를 두어 총평이 들어올 자리를 잡는다. 재조회를 다 썼거나 실패해 총평이 없으면 곡 이름이 제목이고, 오류일 때는 메타 줄의 h1이 제목이다. 오른쪽은 점수(60px)와 노트 판정 한 줄 막대(정확·빠름늦음·놓침 비율은 서버 `counts`, 빠름·늦음 나누기는 노트를 받은 뒤 `judgementSplit`). 막대가 들어올 때 왼쪽부터 한 번 채워지는 것이 화면의 유일한 자동 움직임이다(모션 줄이기면 없음). **하이라이트(`ReportHighlights`):** 둥근 면을 칸으로 나누고 데이터가 있는 칸만 그린다 — 최대 콤보(전체 노트 대비 막대), 평균 박자(맞힌 노트 오차 5개 이상일 때, `timingSummary`: 평균 = 흰 점, 25~75% = 초록 띠, 눈금 반폭 = 그 판의 GOOD 폭), 연주 시간(이 브라우저 기록의 곡 길이, 없으면 마지막 노트 시각, 격자가 있으면 마디 수), 지난번보다(로그인·API 곡 소스일 때 `listPlays`를 곡 제목·모드로 한 번 부르고 `recentAccuracies`가 같은 곡·모드·연습 단계의 최근 5번을 고른다. 목록 정확도는 0~100이라 0~1로 바꾸고, 변화 %p는 화면에 보이는 반올림 퍼센트끼리 뺀다. 2번 미만·실패면 칸 없음). **노트 흐름:** 칸 폭 60%의 사각 막대, 토막 사이 2px 틈, 윗모서리만 둥글게(60칸 초과 80%·2px·1px, 120칸 초과 100%·0·0). 높이는 px(`FLOW_CHART_H` 160)로 계산한다 — 버튼 안의 % 높이는 사파리에서 0이 될 수 있다. 확대 중인 구간과 겹치는 칸만 진하고 나머지는 흐리다. 놓친 구간은 차트 아래 캡슐 버튼 줄이고 차트 위 점선 테두리로 자리를 보인다. **선택 구간:** 넓은 화면은 두 칸(왼쪽 제목·근거·AI 문구 17px·「연습 방법」 면, 오른쪽 패드 줄·재생 조작). [정답 듣기]는 흰 캡슐, 배속은 분할 버튼이다. **관찰·패드 기록:** 둥근 면 안의 줄과 들여쓴 구분선(묶음 목록), 패드 정확도 칸에는 짧은 막대를 붙인다(540px 이하 숨김). 화면용 계산은 `features/result/domain/reportView`(순수 함수)다. 노트를 5초 칸으로 묶고(`flowBins`), 약점을 자리별로 나눈다(`splitSegments`: `MISS_CLUSTER`·SEGMENT = 놓친 노트가 모인 구간, `TRANSITION_MISS`·`TRANSITION_LATE` = 패드 전환 관찰, 나머지 = 그 밖의 관찰). 유형은 자리 배치에만 쓰고 문구는 서버 `description`·`detail`·`tip` 그대로다. `metrics`의 숫자(`missCount`·`noteCount`·`missRate`·`transitionCount`·`meanDeltaMs`)는 있으면 문구에 쓰고 없으면 그 문구만 뺀다. 확대해서 보는 구간은 `Focus`(kind: cluster·transition·segment·bin)이고 `ReportPage`가 든다. 처음에는 첫 놓친 구간 → 첫 전환 → 놓침이 가장 많은 5초 칸 순으로 정하고(`initialFocus`), 사용자가 고른 뒤에는 분석이 늦게 와도 바꾸지 않는다. 막대를 누르면 항상 그 5초 칸이 선택되고(`focusOfBin`), 놓친 구간은 막대 아래 구간 버튼으로 연다. 전환의 [예시 보기]는 그 전환을 가장 많이 놓친 8초 창을 연다(`transitionWindow`). 판정 이름은 이 화면에서 「정확 / 빠름 / 늦음 / 놓침」이다(`VERDICT_LABEL`, 설계 `COACH-002-report-timing-direction`). GOOD을 오차 부호로 나눠(`noteVerdict`: 음수 빠름, 그 밖 늦음) 「타이밍이 어긋났다」가 아니라 빨랐는지 늦었는지를 보인다 — 확대 구간의 노트 표시는 정확 ● · 빠름 ◀ · 늦음 ▶ · 놓침 ×이고(아래 범례 `rp-note-key`도 같은 모양·색 그림 + 이름, 노트 흐름 범례와 같은 배치) 「구간 내 판정」도 넷으로 센다(`verdictCounts`). 고른 노트 한 줄은 빠름·늦음이면 이름 없이 「0:46.00 · 킥 · 39ms 빠름」이다. 5초 막대는 색 3개 그대로이고(범례 「정확 · 빠름·늦음 · 놓침」) 빠름·늦음의 수는 칸의 툴팁과 읽어 주는 글에서 나눈다(`FlowBin.early`·`late`). 놓침은 오차가 없어 방향을 보이지 않는다. **마디 표기:** 이 브라우저에 그 연주의 기록이 있으면(`reportGrid`: 기록의 BPM·박자·격자 원점) 구간 시각 앞에 마디를 붙인다 — 놓친 구간 버튼 「7~9마디 · 0:12.3–0:17.3」, 확대 제목·「확대 구간」 줄·관찰 목록의 구간 줄과 [예시 보기](`withBars`·`focusRangeText`, 계산은 `domain/play/report.segmentBars`). 기록이 없으면(다른 기기에서 친 기록) 시각만 보이고, 5초 칸과 시간축은 항상 시각만이다. 위치가 곡 시각이라 연습 속도로 친 기록도 원래 BPM으로 세며, 빠르기가 바뀌는 곡은 근사값이다(결과 화면의 약점 마디와 같은 식). **연습 속도로 친 기록:** 노트 시각은 PERFECT·GOOD이 `tMs − deltaMs × playbackRate`, MISS가 `tMs`다(`api/play/reports.toReportNote`, BE·AI와 같은 식). 배율은 `runtime/playSync.loadAllReportNotes`가 미리 받은 리포트 본문에서 읽어 넘기고(본문을 다시 요청하지 않는다, 본문 조회 실패 시 1), 「전체 노트 흐름」 제목 옆에 「시각은 원래 빠르기 기준이에요」를 보인다. 색·글꼴은 프로젝트 토큰을 쓴다.
- **AI 약점 구간(COACH-003):** 리포트의 `weakSegments`를 `api/play/reports.toWeakSegments`가 화면 타입으로 바꾼다(배열이 아니면 null, 깨진 요소만 버리고 서버 순서 유지, 모르는 `pattern`·추가 `metrics` 키는 그대로 통과). 화면에서는 위 「리포트 화면 구성」대로 자리를 나눈다. 약점을 고르면 확대 영역 제목 아래에 서버 `description`·`detail`·「연습 방법」(`tip`)과 심각도 배지(`domain/play/report.segmentLevel`·`levelBadge`: HIGH 주의 · MEDIUM 보통 · LOW 없음)가 나온다. 구간 재생은 확대 창 범위를 `features/result/domain/segmentPlayback.planSegment`로 일정으로 바꿔 `useSegmentPlayer`(페이지에 하나, 한 번에 한 구간, 배속 1·0.75, 반복)가 재생한다. 버튼은 [정답 듣기]·[내 연주 듣기](각각 재생 중이면 [정지])·[1배]·[0.75배]·[반복]이고 구간을 바꾸면 멈춘다. 정답·내 연주는 같은 재생기를 키(`{구간 키}#answer`·`#mine`)로 나눠 쓰므로 한쪽이 울리는 중에 다른 쪽을 누르면 앞의 재생을 멈추고 바꿔 튼다. [내 연주 듣기]의 재료는 이 브라우저의 연주 기록이 있으면 그 기록의 타격 전부(헛친 타격 포함, `playedHitsFromLog`), 없으면 서버 노트의 PERFECT·GOOD 타격만이다(`playedHitsFromNotes`, MISS는 소리 없음). 판정된 타격의 시각은 「노트 시각 + 오차 × 연습 배율」, 구간 소속은 짝지어진 노트 시각 기준이라 구간 첫 박을 일찍 친 타격도 잘리지 않는다(`planPlayed`). 구간에 들려줄 타격이 없거나 재료가 없으면 버튼이 꺼지고 이유 문구가 나온다. 분석 상태 안내(`AnalysisNotice`)는 놓친 구간 버튼 자리에 한 줄로 나온다: PENDING 「AI가 연주를 분석하고 있어요」(재조회를 다 쓰면 [새로고침]) · FAILED · NOT_REQUESTED · 결과 없음 · 약점 없음 · 곡이 짧음(판정 수 `MIN_NOTES_FOR_ANALYSIS` 8개 미만. AI가 8~19개는 짧은 곡 분석을 하므로 그 판에서 약점이 없으면 「약점 없음」이다). 코치 총평은 화면 머리(`ReportHero`)의 제목이다(위 「리포트 화면 구성」). 마디 환산은 `domain/play/report.segmentBars`(격자 원점을 받는다)를 `reportView`의 구간 글자가 쓴다(위 「마디 표기」). `segmentRangeText`는 새 화면에서 쓰지 않는다.
- **PENDING 재조회:** 리포트 페이지가 `features/result/analysisPoller`로 2초 간격 최대 5회 `GET /report`만 다시 받는다(`playSync.refreshReport`, 프리패치 캐시의 리포트만 교체하고 노트는 유지). 5회 뒤에도 PENDING이면 "잠시 뒤 다시 확인" 안내와 **새로고침** 버튼(5회 재시작). 결과 화면은 재조회하지 않는다.
- **결과 화면 분석 일원화:** 플레이마다 분석 생성기는 하나다. 업로드 대상 플레이(`domain/play/report.isUploadTarget`: 서버 형식 로그이고 SKIPPED·재시도 불가 FAILED가 아님)는 결과 화면에 로컬 피드백 카드·미니 악보·패드 요약 표를 보이지 않고, **상세 분석 보기** 버튼 설명이 프리패치 리포트의 분석 상태를 보여 준다(`domain/play/report.analysisTeaser`: "분석 중" / "AI가 약점 n곳을 찾았어요" / "뚜렷한 약점 없음" / "분석 실패"). 업로드가 생략되거나 재시도 불가로 실패한 플레이만 "간단 피드백" 제목으로 로컬 카드를 보여 준다.

## 실시간 코칭 (COACH-001, `src/coach/live`)

플레이 중 최근 판정 흐름에서 경향(계속 늦음, 한쪽 손 약함 등)을 뽑아 짧은 문구로 알리는 **규칙 모듈**이다. 서버를 거치지 않고 브라우저에서만 동작한다. 모듈은 판정 한 건을 받아 문구 후보(`tag`+대상)를 돌려주고, 리듬 게임(`PlayPage`)과 악보 연습(`SheetPage`)이 이를 받아 연주 안내 칸(`GuideSlot`)에 띄우고 플레이 로그에 남긴다. 규칙·문구·표시 정책은 두 모드 공통이고 로그는 업로드 본문 `mode`(`RHYTHM`/`SHEET`)로 가른다. 모듈 폴더(`coach/`)는 FE가 관리하고, 고치면 AI 파트에 알린다.

- **쓰는 법:** `new LiveCoach({ goodMs, enabled? })`로 만들고, 판정(`onJudgement`)마다 `push({songTimeMs, noteTimeMs, judgement, deltaMs, pad, stickId, velocity})`를 부른다. 문구를 띄울 때만 `{tag, text, severity, tMs, displayMs, target, repeat}`를 돌려주고 아니면 `null`이다. `events()`는 업로드 본문 `liveCoachEvents[]`에 그대로 담을 `{tMs, tag, text}` 목록이다. 재시작(다시 하기)에서 `reset()`. 일시정지 중에는 `push`를 부르지 않는다. 코칭 오류로 플레이가 멈추지 않도록 `push`는 예외를 던지지 않는다.
- **연결(`PlayPage`·`SheetPage`):** `new LiveCoach({ goodMs: settings.timing.goodMs, enabled: settings.liveCoach })`를 만들어 설정값을 고정한다(도중 설정 변경은 다음 플레이부터). 리듬 게임은 곡 선택 시점, 악보 연습은 준비 세션을 `useMemo`로 만들어 곡 선택 시점이 따로 없으므로 연주 시작(`begin`) 시점에 만든다. 안내 칸 기본 문구(리듬 게임 「노트에 맞춰 연주」, 악보 연습 「악보 연습」)로 돌아오는 규칙은 같다. `onJudgement`에서 기록·팝업·HUD 갱신 뒤에 `push`하고, 문구가 나오면 `coachCopy`로 화면 문구를 만들어 `useCoachLine`(`features/play/components/stage/coach`, 타이머 규칙은 순수 모듈 `coachLineTimer`)에 `displayMs`(3초) 동안 올린다. 다시 하기에서 `reset()`과 문구 비움, 종료 시 `events()`를 `buildPlayLog`의 `liveCoachEvents`로 넘긴다. 변환·표시는 try/catch로 감싸 코칭 오류가 플레이를 막지 않는다.
- **화면 문구(`coach/live/copy.ts`):** 모듈의 `text`는 로그 전용이고 화면은 `coachCopy(message)`가 돌려주는 짧은 제목(지적 ≤8자, 칭찬 ≤13자)·보조(≤16자)·모드를 쓴다. 같은 태그가 다시 뜨면 `message.repeat` 순서로 제목을 돌려 쓴다(연속 놓침은 보조도 함께). 대상이 있는 태그는 `message.target`(패드 또는 손)으로 "{패드} 먼저"·"{왼손/오른손} 높이!"를 만든다. `GuideSlot` 모드는 태그로 정한다 — `LIVE_MISS_STREAK`·`LIVE_PAD_MISS`는 `coach-warn`, 나머지는 `coach-info`(`severity`는 아직 화면에 쓰지 않는다). 안내 칸(220×51)은 코칭 모드에서 라벨을 화면 낭독용으로만 두고(보이지 않음) 제목과 보조 두 줄을 보인다. 문구·톤은 이 파일에서만 고친다.
- **손·세기:** `RhythmSession`의 `JudgementEvent`에 `stickId`·`velocity`가 있다. `handleHit`이 `ResolvedHit`에서 채우고, MISS(`tick`)와 키보드 타격(`source === 'keyboard'`, 손이 자리값이고 세기가 고정이라 뜻이 없음)은 둘 다 null이다. 손 정보가 없으면 손별 규칙만 제외된다.
- **패드 규칙 대상:** `STICK_PADS`(스틱 7개)만 평가한다. 킥·하이햇 페달은 평가하지 않는다(COACH-001 D5). 페달 판정은 손·세기가 null이라 손별 규칙에서도 자연히 빠진다.
- **패드 이름(`coach/live/padName.ts`):** 코칭은 `PAD_META.label`(스몰탐·미드탐·플로어탐) 하나만 쓴다. 드럼 그림(`domain/kit/drumKit`)의 라벨·태그(ST·MT)도 같은 출처이고, `domain/padNameUnify.test.ts`가 FE 소스에 「탐1·탐2·하이탐·미들탐」 표기가 남지 않는지 지킨다(샘플 원본 이름 「Polmuz 탐 1 F」는 화면에 안 나오므로 예외). 패드 놓침의 보조 문구는 키보드면 키(`E·I`), 스틱이면 위치(왼쪽 탐)를 알려 준다.
- **세팅 안내**(`setupHints.ts`): 연주가 아니라 세팅이 원인으로 보일 때 안내한다. `LIVE_SETUP_OFFSET`(최근 16개가 모두 유효 타격이고 평균 |오차| 45ms 이상, 표준편차 20ms 미만, 같은 부호 90% 이상), `LIVE_SETUP_PADS`(최근 16개 중 MISS 50% 이상이고 채보 밖 타격이 MISS의 절반 이상). 스틱 입력(`ble`, `websocket`)에서만, 태그별 한 번, 지적보다 먼저 뜬다. 결과 화면의 `SetupHintCard`가 설정의 박자 맞추기나 `/setup`으로 보낸다.
- **플레이 로그(`liveCoachEvents`) 문구 형식:** 띄운 문구는 `{"key","text"}`, 경향 해소(`LIVE_RECOVERED`)는 `{"key"}` JSON 한 줄이다. `key`는 대상까지 담은 상태 키(예: `LIVE_PAD_LATE:SNARE`)라 BE가 무엇을 지적했는지 집계할 수 있다. 코칭을 끈 판의 `LIVE_OFF`만 일반 문장이다.
- **거름 판단 기록:** `LIVE_GATE_KEEP`(남긴 지적, 지적 행 바로 뒤), `LIVE_GATE_DROP`(뺀 지적. `on`이면 지적 행이 없다), `LIVE_GATE_FALLBACK`(점수가 100ms 안에 오지 않거나 실패해 규칙대로 띄움). 문구는 `{"tag","key","score" 또는 "reason","threshold","model","runtime","mode","ms"}` JSON이다. 칭찬과 세팅 안내에는 남기지 않는다. **집계할 때 `LIVE_GATE_*`는 띄운 지적으로 세지 않는다.**
- **거름(`coach/live/gate`):** 규칙이 낸 지적을 작은 모델 점수로 뺄 수 있다. 칭찬과 세팅 안내는 거르지 않는다. `VITE_COACH_GATE`(비움·`json`·`onnx`)로 실행 방식을, `VITE_COACH_GATE_MODE`(`shadow`·`on`)로 동작을 고른다. `shadow`는 판단만 진단 이벤트 `coachGate`로 남긴다. `onnx`는 점수가 비동기로 와서 `on`이면 문구가 늦게 뜨고, 100ms 안에 오지 않거나 실패하면 규칙 판단대로 띄운다. 꺼진 빌드에는 모델과 런타임이 들어가지 않는다. 모델 파일은 AI `coach_live_model`의 산출물이고 `parity.fixture.json`으로 입력과 점수가 AI와 같은지 확인한다. 아래 서버 실험 설정이 있으면 이 빌드 설정보다 서버 설정이 먼저다.
- **서버 모델과 실험군(`coach/live/models`):** 서버가 게시한 모델(`/models/manifest.json`, 게시는 `Infra/mlflow/README.md`)을 받아 FE 배포 없이 거름 모델을 바꾸고 실험군으로 비교한다.
  - 연주 화면에 들어올 때와 연주를 시작할 때마다 `refreshCoachModels()`가 매니페스트를 다시 읽는다(캐시하지 않음). 그래서 `current`를 바꾸거나 롤백하면 다음 연주부터 반영된다. 받는 동안은 앞서 받은 것을 쓴다. 한 번 받은 버전은 다시 받지 않는다.
  - 실험 설정은 모델처럼 `coach-live-config`(파일 `config.json`)로 게시한다: `{"gate":{"mode":"off|shadow|on","arms":[{"model":"coach-gate-mlp16","share":100}]},"cause":{"arms":[]},"rolloutPercent":100}`. `share` 합은 100이고, 형식이 틀리면 설정이 없는 것으로 본다.
  - 배정(`chooseCoachModel(userId)`): 로그인 사용자는 id의 해시로 0~99 구간을 정해 같은 사람이 같은 실험군에 남는다. 비율(`rolloutPercent`)과 실험군은 다른 해시라서 비율을 올려도 이미 들어온 사람의 실험군은 그대로다. 비로그인은 판마다 무작위다.
  - 검증: 파일마다 매니페스트의 크기·`sha256`이 맞아야 하고, `meta.json`의 `task`가 `gate`, `featureVersion`이 `GATE_FEATURE_VERSION`(`gate.ts`, AI `FEATURE_VERSION`과 같은 값), 입력 수가 맞아야 한다. 서버 모델은 JSON 실행기만 쓴다(동기, ONNX 런타임 불필요). 기준값은 `meta.json`의 `threshold`를 쓴다.
  - 실패: 설정이나 매니페스트가 없으면 빌드 설정(`VITE_COACH_GATE`)대로, 실험군 모델을 받지 못했거나 검증에 실패하면 그 판은 규칙만 쓴다. 코칭 오류가 연주를 막지 않는다.
  - 기록: 서버 설정을 따른 판은 시작에 `LIVE_ARM`(`{"arm":"coach-gate-mlp16"}`, 규칙만이면 `"rule"`)을 한 건 남기고, `LIVE_GATE_*`에도 `arm`과 모델 이름(`이름@버전`)을 담는다. 집계할 때 `LIVE_ARM`은 띄운 지적으로 세지 않는다.
  - 단위 시험에서는 `fetch`를 넘기지 않은 호출이 네트워크로 나가지 않는다(`import.meta.env.MODE === 'test'`).
  - **원인 모델**(`models/remoteCause.ts`): 설정의 `cause.arms`에 게시된 원인 모델(`task: cause`, 파일 `coachCause.json`)을 넣으면, 놓침 지적에 후보가 하나 이상일 때 모델이 후보와 `UNKNOWN` 중에서 고른다. 없는 원인은 만들지 않고, 근거가 약하면 후보가 있어도 `UNKNOWN`을 고를 수 있다. 입력은 원인별 후보 강도, 3단계 여부, 패드 놓침 여부(`causeFeatures`, AI `cause_features`와 같고 `CAUSE_FEATURE_VERSION`=1). 계산이 AI와 같은지 `cause.parity.fixture.json`(AI `cause_model --fixture` 산출물)으로 확인한다. 원인 실험군은 거름과 같은 비율 해시에 다른 실험군 해시를 쓰고, 거름이 `off`여도 원인 모델은 따로 쓴다. 모델이 없거나 검증·실행에 실패하면 규칙 순서로 고른다.
  - 원인 기록: 모델이 고르면 `LIVE_CAUSE`에 `"by":"MODEL"`과 `"model":"이름@버전"`, 규칙이면 `"by":"RULE"`. 원인 실험군이 있으면 `LIVE_ARM`에 `causeArm`(못 받았으면 `"rule"`)을 담는다.
- **연주 중 LLM 구간 코칭(`coach/live/segment.ts`, `llmCoach.ts`, `features/play/api/liveCoach.ts`):** 마디 구간(1~4, 5~8, 9~16, 17~32, 이후 16마디씩)이 끝날 때마다 그 구간의 연주 기록을 요약해 BE에 보내고, 리포트 총평과 같은 로컬 LLM이 쓴 안내 칸 문구를 다음 구간에 띄운다. 판정마다의 규칙 코칭은 그대로다. 계약은 AI `AI/docs/live-coach-llm.md`, BE API는 BE README.
  - 켜기: 실험 설정 `coach-live-config`의 `llm: { "mode": "off" | "shadow" | "on", "rolloutPercent" }`(없으면 off). 로그인 사용자만, 사용자 id 해시로 배정한다. BE의 `LIVE_COACH_LLM_ENABLED`도 켜져 있어야 한다.
  - 구간 끝: 마디 시각은 채보 빠르기 변화(`tempoSegments`)를 따르고, 구간 끝 + 사용자 판정 폭이 지나면(놓침 판정까지 다 들어오면) 구간 사실을 만든다. 판정 8개 미만 구간은 요청하지 않는다. 사실에는 판정 개수, 타이밍 요약(판정 폭 `goodMs` 포함, AI가 늦음·빠름의 정도를 이 폭 대비로 말한다), 문제 패드 최대 3개(놓친 노트 ±GOOD 폭 안의 채보 밖 타격으로 센 "대신 가장 많이 친 패드" `instead`, 키보드 타격 포함), 약한 손, 이번 구간에 노트가 2개 이상 있던 패드 `playedPads`(AI가 습관이 나아졌는지 볼 때 쓴다), 이 구간의 규칙 지적·원인, 직전 구간 판정 수와 직전에 띄운 LLM 문구만 담는다(타격 원본·`playId`·곡 정보 없음).
  - 스틱 끝 방향(`aim`, 선택 필드): 스틱 입력이면 구간 안 타격의 스틱 끝 방향(`pitch`·`yaw`)을 손별 캘리브레이션 기준 자세와 비교해, 판정 반경 대비 30% 이상 치우친 패드를 방향(`HIGH`·`LOW`·`LEFT`·`RIGHT`)과 정도(`SLIGHT`·`CLEAR`, 60% 이상)로 넣는다. 패드당 4타 이상, 최대 3개. 놓친 노트 ±GOOD 폭 안에서 다른 패드로 잡힌 채보 밖 타격은 그 노트 패드의 `wrongPad`로 센다. 방위각 드리프트가 8도 넘게 남은 손은 좌우를 말하지 않는다(`features/play/liveAim.ts`). 각도 숫자는 넣지 않고 `contractVersion`은 1 그대로다(BE 변경 없음). 계산은 AI `coach_eval/live_segments.py`와 같다.
  - 요청·조회: `LlmCoach`가 요청하고 0.5초마다 조회한다. 기한은 다음 구간 길이의 절반이고, 지나면 `LATE`로 버린다. 429(상한) 뒤에는 그 판의 남은 구간을 요청하지 않는다. 다시 하기는 새 판 번호(`runId`)로 다시 세고, 종료·다시 하기·화면 이탈 뒤 온 결과는 버린다.
  - 표시 순서: 규칙 지적이 떠 있으면(표시 시간 안) LLM 문구는 기다렸다가 다음 칭찬 자리에 띄운다. 규칙 지적이 먼저다. LLM 문구 표시 시간은 4초이고 화면 문구는 LLM이 쓴 그대로(워커 가드레일 통과분)다. `shadow`는 띄우지 않고 기록만 한다.
  - 기록: 구간마다 `LIVE_LLM` 한 건(`{"segment","status":"SHOWN"|"SHADOW"|"LATE"|"FAILED"|"SKIPPED","title"?,"sub"?,"model"?,"latencyMs"?}`), `LIVE_ARM`에 `llmArm`(`"llm"` 또는 `"rule"`). 집계할 때 띄운 지적으로 세지 않는다.
- **규칙 6종**(`rules.ts`): `LIVE_PAD_MISS`(최근 16개에서 전체 놓침 4개 이상, 한 패드가 3개 이상이고 놓침의 60% 이상이며 그 패드 노트의 50% 이상을 놓침. 스틱 패드만, 전체 놓침보다 먼저 뜬다) · `LIVE_MISS_STREAK`(연속 3번 또는 최근 6개 중 4개 놓침) · `LIVE_LATE`/`LIVE_EARLY`(최근 12개 평균이 `0.3 × goodMs` 이상이고 같은 부호가 75% 이상) · `LIVE_PAD_LATE`/`LIVE_PAD_EARLY`(한 패드가 나머지 패드보다 `0.45 × goodMs` 이상 늦거나 빠름) · `LIVE_HAND_WEAK`(한 손 평균 세기가 다른 손의 70% 미만) · `LIVE_UNSTEADY`(편차가 `0.5 × goodMs` 이상).
- **판정 단계**(`config.ts`의 `stages`, `coachStage`): 한 판에서 쌓인 판정 수로 단계를 정한다. 4개 전에는 아무것도 띄우지 않고, 1단계(4~7개)는 연속 놓침(`LIVE_MISS_STREAK`)만, 2단계(8개부터)는 모든 규칙과 칭찬, 3단계(16개부터)는 원인 후보 전부를 쓴다. 재시작하면 처음부터다.
- **놓침 원인**(`cause.ts`, `noteContext.ts`): `LiveCoach.missCauses(pad?)`가 창 안 기록을 노트 시각 순으로 정렬해 원인 후보를 낸다. 2단계는 다른 패드(`WRONG_PAD`, 대신 친 패드까지)와 빠른 구간(`DENSE`), 3단계는 패드 이동(`TRANSITION`)과 늦어지다 놓침(`DRIFT_LATE`)까지. 패드 이동은 같은 패드를 다른 곳에서 넘어와 친 노트(비교 대상)가 2개 이상 있고, 그 이동의 놓침 비율이 비교 대상의 2.5배 이상일 때만 본다. 록 비트처럼 같은 이동만 반복되면 무작위 놓침도 이동 탓처럼 보이기 때문이다(AI 합성에서 원인 없는 연주의 패드 이동 오탐 55% → 12%). 화면은 `chartCoachContext(chart.notes)`로 노트마다 직전 시점의 패드·간격을 미리 계산해 `JudgedNote`에 펼쳐 넣고, 곡의 간격 중앙값을 `LiveCoach`의 `noteGapMedianMs`로, `RhythmSession.onStray`의 채보 밖 타격을 `pushStray`로 넘긴다. 2단계부터 놓침 지적(`LIVE_PAD_MISS`, `LIVE_MISS_STREAK`)을 띄울 때 후보를 계산하고 규칙 순서(다른 패드 → 패드 이동 → 빠른 구간 → 늦어짐)로 하나를 골라 `CoachMessage.cause`에 싣는다. 근거가 없으면 `UNKNOWN`이다. 화면은 제목은 그대로 두고 보조 문구만 원인 문구로 바꾼다(`copy.ts`의 `causeSub`, 예: "스몰탐은 왼쪽 탐이에요", "스네어 치며 스몰탐을 봐요"). 원인 문구는 QA 전 가정 어휘다.
- **원인 판단 기록:** 원인을 고른 놓침 지적 행은 `{"key","text","cause"}`이고, 바로 뒤에 같은 시각으로 `LIVE_CAUSE` 행 `{"key","candidates":[{"cause","strength","pad","fromPad"?,"intoPad"?}],"picked","by":"RULE","stage"}`를 남긴다. `UNKNOWN`도 빈 후보로 남겨 학습에 쓴다. 거름이 남긴 지적은 지적 → `LIVE_CAUSE` → `LIVE_GATE_KEEP` 순서이고, 뺀 지적에는 남기지 않는다. **집계할 때 `LIVE_CAUSE`는 띄운 지적으로 세지 않는다.**
- **표시 정책**(`policy.ts`): 판정 단계를 따르고, 지적 사이 4초, 같은 키는 10초, 한 번에 하나(놓침 > 늦음·빠름 > 패드 > 손 > 박자 > 칭찬). 플레이당 상한은 없다. 띄운 뒤 거두는 문턱(예: 늦음 평균 `0.15 × goodMs` 미만)을 만족하면 쿨다운 없이 다시 띄울 수 있다. 거둔 것은 로그에 `LIVE_RECOVERED`로만 남는다.
- **칭찬**(`rules.ts`의 `evaluatePraise`, `policy.ts`): 지적 후보가 없을 때만 뜬다. `LIVE_GOOD_RECOVERED`(지적한 경향이 사라지고 연주가 안정됨, 직전 문구에서 4초) · `LIVE_GOOD_STEADY`(창에 놓침 없고 평균·표준편차가 거두는 문턱 안) · `LIVE_GOOD_KEEP`(창의 놓침 2개 이하). 뒤의 둘은 직전 문구에서 6초 뒤에 뜬다. 창의 놓침이 3개 이상이거나, 활성 지적이 지금도 조건을 만족하거나 쿨다운 안이면 칭찬하지 않는다. 칭찬은 지적을 늦추지 않아서, 칭찬이 떠 있어도 지적이 바로 대신 뜬다. 화면 모드는 `coach-good`이다.
- **로그 태그:** 위 규칙 태그 + 칭찬 태그(`isPraiseTag`로 구분, 효과 평가와 방식 비교에서는 뺀다) + `LIVE_RECOVERED` + `LIVE_CAUSE`·`LIVE_GATE_*`(판단 기록) + `LIVE_OFF`(코칭을 끈 플레이에 시작 시각 0으로 한 건. 효과 평가에서 "코칭 없음" 대조군을 가른다). BE는 `tMs`(유한 수)·`tag`(≤ 64자)·`text`(≤ 2048자)·최대 1,000개를 검증한다. `PlayLog.liveCoachEvents`(`engine/playLog`의 `LiveCoachEvent`, `coach`를 import하지 않는 구조적 타입)에 저장되고 업로드 본문(`domain/play/playUpload`)에는 `log.liveCoachEvents ?? []`로 실린다 — 기능 도입 전 로그는 빈 배열이라 "코칭 켬·문구 0개"와 구분되지 않으니 효과 평가는 `clientMeta.appVersion`·업로드 날짜로 거른다(AI에 회신함).
- **수치 고치는 곳:** 모든 임계값은 `coach/live/config.ts` 한 곳에 있다. 판정 폭에 비례하는 값은 `goodMs`에 곱하는 계수라서 사용자가 판정 폭(30~150ms)을 바꿔도 같은 비율로 따라간다. 수치는 가정값이므로 직접 플레이해 보며 여기서 고친다.
- **검증:** `npm test`(합성 플레이 시험·문구 표·타이머 규칙 포함: 계속 늦음에서 `LIVE_LATE`, 경향 없는 100플레이에서 지적 평균 0.5개 이하, 간격 준수, 거짓 칭찬 방지, 계산 시간 중앙값 0.2ms 이하).

## 반주 재생

- **버퍼 재생:** `audio/Accompaniment`가 서명 URL을 fetch해 `decodeAudioData`로 전부 디코드하고 `AudioBufferSourceNode`로 예약 재생한다. 소스는 전용 `accBus` 게인(`AudioEngine.accompanimentBus`, `master` 직결, 패드 음소거와 무관)에 연결한다. 같은 URL이면 다시 받지 않는다. 일시정지는 소스를 멈추고 위치를 기억하며 재개는 새 소스를 그 위치에서 예약한다(위치 계산은 `domain/time/accompanimentClock`).
- **시각 변환:** `AudioEngine.perfToContextTime`·`contextToPerfTime`이 `getOutputTimestamp` 기반으로 performance.now ↔ AudioContext 시각을 바꾼다(`trigger`·`click`도 같은 메서드를 쓴다).
- **PlayClock:** `features/play/sessionClock.PlayClock`이 `RhythmSession`·반주·박 클릭 예약을 묶는다(클릭·반주는 주입). `begin()`은 반주 0초 = `now + lead(300ms) + max(0, 카운트인 − offsetMs)`로 `RhythmSession.start(at)`과 `accompaniment.start(at, 0)`을 같이 부른다. `start(at)`의 `at`은 곡 0ms가 울리는 performance.now 시각이다. 카운트인 클릭은 격자 원점 `offsetMs`(1마디 1박) 직전 1마디에 놓이고 곡 중 박 클릭도 `offsetMs + k·박`에 난다(`RhythmSession.originMs`). `offsetMs = 0`(내장 곡·MIDI)이면 전부 종전과 같고, `offsetMs`가 카운트인보다 길면 반주(인트로)가 먼저 시작돼 1마디 직전에만 클릭이 난다. `pause(reason)`·`resume()`·`restart()`·`stop()`·`onFrame(now)`·`songTime(now)`·`state`·`sync`를 제공한다. 재개는 예약 여유 50ms를 두고 세션 시계도 같은 만큼 뒤로 맞춘다.
- **오디오 시계 기준 연주(S15P31A307-323):** `/play`·`/sheet`의 `PlayClock`은 `audioReading`·`clickAt`을 받으면 오디오 시계(AudioContext) 하나로 돈다. `begin()`이 곡 0ms를 울릴 오디오 시계 시각 `ctxZero`를 정하고, 반주는 `Accompaniment.startAtContext(ctxZero, 0)`, 박 i 클릭은 `AudioEngine.clickAtContext(ctxZero + beatTimeMs(i)/1000)`로 오디오 시계에 바로 예약한다. 화면 시계를 거치지 않으므로 출력 지연(`outputLatency`)이 얼마든 클릭과 반주는 같은 기준에 놓인다. 예전에는 클릭을 화면 시계 시각으로 200ms 앞서 예약했는데, 출력 지연이 200ms를 넘으면 바꾼 오디오 시각이 이미 지나 `Math.max(currentTime, …)`가 "지금"으로 당겨 클릭이 최대 184ms 늦게 울렸다(11/11 측정: 출력 지연이 재생 중 80ms → 392ms로 커짐). 클릭 예약 여유는 오디오 시계 기준 0.2초(탭이 가려지면 1.2초)다. 노트 위치·MISS·판정의 곡 시각은 `AudioEngine.audioReading()`의 "지금 들리는 오디오 시계 시각"(`perfToContextTime`과 같은 기준점, `getOutputTimestamp` 짝이 없거나 3초 넘게 어긋나면 `currentTime`) − `ctxZero`로 구해 `onFrame`·박 타이머마다 `RhythmSession.retime(startPerf)`로 넣는다(`domain/time/audioTimeline.sessionStartPerf`). 곡 시각은 줄지 않으므로 오디오 시계가 멈추면 노트도 멈추고 그동안 MISS가 나지 않는다. 들리는 시각 추정값은 15ms 안의 흔들림을 10%씩 고르게 따라가고, 넘으면 바로 바꾼다(`smoothOffsetMs`). 일시정지는 들리는 곡 시각을 저장하고, 재개는 그 곡 시각을 50ms 뒤 오디오 시계 시각에 다시 놓는다. 두 의존성이 없거나 시작 때 컨텍스트가 running이 아니면 예전 화면 시계 방식으로 돈다. 브라우저가 알려 주는 들리는 시각이 틀린 장치(블루투스 일부)에서는 노트·판정이 음악과 일정하게 어긋날 수 있으므로 「박자 맞추기」(판정 타이밍 보정)로 맞춘다. 클릭·반주 사이에는 영향이 없다.
- **화면 시계로 소리를 예약하는 나머지 경로(S15P31A307-323):** 전역 메트로놈(`engine/Metronome`, 자유 연습)·박자 맞추기(`runtime/timingCalSession`)·채보 자동 재생(`features/play/components/diag/chartAutoplay`)·리포트 구간 재생(`features/result/audio/SegmentPlayer`)은 화면 시계 시각으로 소리를 예약한다. 예약 여유(창 100~200ms, 시작 75~400ms)보다 오디오 시계가 들리는 시각보다 앞선 정도가 크면 위와 같이 소리가 "지금"으로 당겨져 늦고 간격이 흔들렸다(11/12 측정: 출력 지연 0.45초에서 박자 맞추기 클릭 16개 전부 339~367ms 늦음·간격 581~619ms, 자동 재생 48개 전부 250~300ms 늦음). 그래서 네 곳 모두 창·첫 박·복구 기준점·시작 여유에 `AudioEngine.renderAheadMs()`(= `currentTime` − 지금 들리는 오디오 시각, ms)를 더한다. 채보 자동 재생은 연주 시계가 오디오 시계 기준으로 돌면 `PlayClock.songTimeToContext`로 받은 오디오 시각에 `AudioEngine.triggerAtContext`로 바로 예약해 반주·클릭과 같은 기준에 놓는다. 연주 시계와 자동 재생은 탭이 가려지는 순간(`visibilitychange`) 넓은 창으로 한 번 더 예약해, 가려진 뒤 타이머가 최대 1초 늦어져도 소리를 놓치지 않는다. `getOutputTimestamp` 짝을 버리는 기준은 1초에서 3초로 넓혀 출력 지연이 1초를 넘는 장치에서도 지연 보정을 유지한다. 자유 연습 반주 재생기는 다른 소리와 맞출 필요가 없고 재생 위치를 실제 시작 시각으로 계산하므로 그대로 둔다.
- **시작·재개 전 오디오 시계 대기(S15P31A307-332):** 브라우저가 오디오 출력을 막 깨운 직후(페이지의 첫 입력이 시작 버튼일 때, 탭을 오래 숨겼다 돌아온 직후)에는 `state`가 running이어도 `currentTime`이 0.5~1.2초 흐르지 않는다. 그동안 시계를 움직이면 카운트인 클릭이 몰리고(25ms마다 변환 기준이 바뀐다) 한 번만 예약하는 반주는 곡 내내 늦는다. 그래서 `/play`·`/sheet`는 `clock.begin()`·`resume()`·`restart()` 전에 `features/play/components/stage/useAudioClockGate`의 `wait(phase)`로 `AudioEngine.whenClockFlowing()`을 기다린다. 판단은 `domain/time/audioClock.clockFlowing`(순수 함수): 20ms마다 읽은 표본에서 최근 150ms 동안 오디오 시계가 화면 시계 경과의 90% 이상 흘렀고, 출력 시각(`getOutputTimestamp().performanceTime`)이 지금과 100ms 안이거나 최근 500ms 내내 90% 이상 흘렀으면 통과. 최대 3초를 넘으면 그냥 진행하고(`timedOut`), 컨텍스트가 없거나 running이 아니면 기다리지 않는다(`skipped`). 평소 대기는 약 150ms다. 출력이 한동안 조용했을 때는 원인이 하나 더 있다: Chrome은 출력이 30~45초 넘게 무음이면 장치를 쉬게 하고, 다음 첫 소리가 나기 시작한 0.06~0.15초 뒤에 오디오 시계가 0.4~0.8초 멈춘다(탭을 숨기지 않아도 생긴다 — 곡 선택 화면에서 1분 넘게 고르다 시작하는 경우). 소리를 내기 전에는 시계가 멀쩡히 흘러 위 판단만으로는 통과해 버린다. 그래서 최근 20초(`SOUND_RECENT_MS`) 안에 소리(클릭, 음소거가 아닌 패드 소리)를 낸 적이 없으면 들리지 않는 신호(30Hz, 음량 0.0005)로 장치를 먼저 깨우고 350ms(`PRIMED_MIN_WAIT_MS`) 이상 기다린다(`primed`). 기다리는 중 다시 부르거나 화면을 떠나면 `wait`가 거짓을 돌려주고, 호출자는 대기 뒤에 곡·시계·준비 조건을 다시 확인한다. 대기가 400ms를 넘으면 `AudioWaitNotice`(「오디오 준비 중…」)가 뜬다. 진단 탭에는 대기 결과 `audioClockWait`(phase·waitedMs·timedOut·skipped·primed)와, 곡 도중 (화면 시계 − 오디오 시계) 차이가 50ms 넘게 커진 흔적 `audioClockStall`(jumpMs)이 나간다. 곡 도중 멈춤은 오디오 시계 기준 연주에서는 노트가 같이 멈추므로 따로 처리하지 않는다. `resume()`은 다시 부르지 않는다(사용자 제스처 안의 `unlockAudio()`가 한다).
- **개발용 반주 주입:** `VITE_ACCOMPANIMENT_OVERRIDE=/dev-accompaniment.wav`(`.env.local`)를 두면 `/play`가 모든 곡에 그 URL을 반주로 쓴다(`config/accompaniment.ACCOMPANIMENT_OVERRIDE` 한 곳에서 읽고 PlayPage·SheetPage가 import한다). 로컬 BE에 S3가 없을 때 쓴다. 반주가 없으면 클릭만으로 진행한다.
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

Shift를 같이 누르면 악센트. 킥·하이햇 페달의 센서 입력은 페달 보드다([패드](#패드)). 사용자가 바꿀 수 없는 고정 매핑이며 `domain/kit/keyMap.ts`의 `KEY_MAP` 상수로만 정의한다.

자유 연습(`/free`)은 치면 바로 울린다. 화면은 반주 바 → 무대(`section.free-stage` 「연주 캔버스」, 카드 면·테두리 없이 배경과 한 면) 순이고 무대 안은 머리 줄(「드럼 킷」·프리셋 이름 · 오른쪽 「키트 가이드」 스위치) → 킷 영역(`LiveDrumKit` `fitContain` 최대 1.6 — 폭과 남은 높이에 모두 맞춰 스크롤 없이 킷 전체가 들어온다. 1440×900에서 킷 폭 약 990px) → HUD(왼쪽 아래 최근 타격 패드·손·세기, 오른쪽 아래 세션 통계 타격 수·평균 세기, 상자 없이 글자) 순이다(설계 `.claude/plans/MODE-002-free-stage.md`).

- **조명:** 페이지 전체에 랜딩과 같은 빛줄기(`StageBeam`)가 깔리고 킷 아래에 바닥 빛(`StageFloor`, `DrumKit underlay`)이 고인다. 연결 전(빈 상태)에는 조명이 꺼지고 킷이 어두워진다(밝기 0.3·채도 0.6). 스틱이 연결되는 순간(꺼짐 → 켜짐)에만 빛줄기가 1.1초 깜빡이며 켜지고, 킥을 밟으면 바닥 빛이 0.5초 밝아진다(둘 다 Web Animations, 움직임 줄이기면 재생하지 않는다).
- **키트 가이드:** 설정 `kitGuide`(기본 켬, `settingsStore` v24, 기기별 로컬)로 켜고 끈다. 실물 스킨은 킷 위 덮개(`DrumKit overlay`)에 패드 이름표 알약을 얹고(`domain/kit/kitGuide`가 그림 자리 표의 `label` 자리로 계산, 글자는 킷 폭에 비례 `clamp(11px, 1.25cqw, 13px)`), 키보드로 칠 때(센서 없음 + `KEYBOARD_INPUT_ENABLED`)만 이름 옆에 키를 붙인다. 친 패드의 이름표는 잠깐 브랜드색으로 켜진다(하이햇 페달은 페달 이름표). 전자·네온 스킨은 알약 없이 내장 글자(`labels`)를 스위치로 켜고 끈다. 빈 상태에서는 이름표를 숨긴다.
- **HUD**(`features/free/components/FreeHud`): 손 칸은 스틱으로 치지 않는 패드(킥·하이햇 페달)면 「발」, 왼손·오른손은 손 점 색(`--left`·`--right`)으로 구분하고, 손을 모르는 입력(키보드·터치)은 손 칸 없이 세기만 보인다. 타격 전에는 패드 「—」이고 손·세기 줄을 숨긴다.

- **반주 바**(`features/free/AccompanimentBar`, `S15P31A307-201` · 글래스 캡슐 `S15P31A307-361`, Figma Play / AccompanimentBar 226:5485)는 없음·불러오는 중·재생 중·일시정지·오류 5변이다. 높이 64·radius 32의 글래스 캡슐(`--surface-float` + blur 14, `--line-strong` 테두리, `--shadow-dock`)이고 `width:100%; max-width:1152px; margin-inline:auto`로 무대와 같은 가로 중심에 둔다. 왼쪽부터 커버(`SongCover` 44, 없으면 기본 디스크) · 제목 칸(제목 + `PlayingEq`, 둘째 줄 「아티스트 · 드럼 뺀 반주」) · 조작부(`song/PlaybackTransport`: 10초 뒤로·재생/일시정지·10초 앞으로) · 진행부(`SeekBar layout="ends"`: 손잡이 없는 3px 막대, 끄는 동안 7px, 아래 양끝에 경과 「1:12」·남은 「-2:12」) · [바꾸기](`PickListIcon`)·[끄기](×) 아이콘 버튼(둘 다 aria-label·툴팁 「반주 바꾸기」「반주 끄기」)이다. 없음은 문구 + [반주 고르기](`onPick`이 없으면 비활성), 불러오는 중은 조작부 비활성 + 앞 25% 옅은 빈 막대 + 빛 훑기(커버에도) + 「반주를 불러오는 중…」([바꾸기]는 보인다), 오류는 miss 문구(`role="alert"`) + [다시 시도][다른 곡] + ×다. 10초 이동은 `onSeek(위치 ± SKIP_MS)`(`domain/song/freeAccompaniment`, 10초)만 알리고 0 미만·끝(길이 − 250ms) 자르기는 `seekTarget`이 한다. 제목은 playing일 때만 `MarqueeTitle`로 흐르고 일시정지·불러오는 중·오류에서는 말줄임이며 `PlayingEq`도 playing에서만 움직인다. 움직임 줄이기 설정이면 흐름·회전·pop·빛 훑기를 끈다. ≤640(`MOBILE_QUERY`)에서는 `useMediaQuery`로 다른 마크업인 56px 미니 바를 그린다: 커버 40 · 제목·`PlayingEq`·「드럼 뺀 반주」 · 재생/일시정지 · 10초 앞으로 · ×와 캡슐 안 아래 2px 진행선(`aria-hidden`, 누를 수 없음)만 있고 막대·시간·10초 뒤로는 없다. 제목 칸(커버+제목)이 [반주 바꾸기] 버튼이라 누르면 고르기 시트가 열린다. 없음·불러오는 중·오류의 미니 모양은 Figma에 없어 같은 56px 캡슐에 줄여 담았다(후속 Figma 변이 추가 필요). 보조 줄은 모든 곡이 「드럼 뺀 반주」다.
  - **재생기**는 자유 연습 페이지가 하나 들고(`useFreeAccompaniment`) 떠나면 `unload`한다. 새로고침하면 없음으로 시작하고, 화면이 숨겨지면(`visibilitychange`) 일시정지하며 돌아와도 자동 재개하지 않는다. 곡이 끝나면 처음 위치에서 일시정지한다. 반주 URL은 곡 단위 API(`getSongAccompaniment`)로 받는다. `VITE_SONGS_SOURCE=builtin` 빌드에서는 [반주 고르기]가 비활성이다.
  - **진행 막대**(`SeekBar`)는 네이티브 range다. 누르기·끌기(손을 뗄 때 한 번 적용)·←/→ 5초·Home·End로 탐색하고, 일시정지 중 탐색한 위치는 [재생] 때 시작 위치가 된다. 문자·숫자 키(드럼 연주 키)는 막대가 쓰지 않는다.
  - **고르기 창**(Figma 802:35314 · 모바일 시트 803:35356)은 공용 곡·내 곡 섹션을 같은 검색어(300ms 디바운스, 100자)로 따로 받고 섹션별 [더 보기]가 있다. 목록은 전역 곡 스토어를 쓰지 않고 `listSongs`(`withAccompaniment=true`)를 직접 부른다. 반주 없음·실패 곡은 거르고, 만드는 중인 곡은 비활성 행에 「반주 만드는 중」 배지(`SongStatusBadge`의 선택 prop `label`)를 보일 뿐 고를 수 없다. BE가 필터를 반영하기 전에는 FE가 거른 뒤 비면 다음 페이지를 이어 받는다(최대 3페이지). 모양: 데스크톱은 폭 520 가운데 창(머리 「반주 고르기」 + × `IconButton`, 검색은 공용 `Input compact` + 선택 prop `trailing`으로 칸 안 오른쪽에 「검색어 지우기」 ×), 행은 `SongCover` 40(커버 없으면 기본 디스크). 지금 곡 행은 brand 14% 칠 + `--brand-text` 제목 + `PlayingEq`(prop `currentPlaying`이 참이면 움직이고 아니면 멈춘 점) + 「재생 중」이다. ≤640은 Dialog 클래스 `free-picker is-sheet` + 손잡이 막대의 바텀 시트(아래에서 360ms `--ease-sheet`로 올라옴, 스크림 배치는 `.dialog-backdrop:has(> .free-picker.is-sheet)`)이고 지금 곡 행은 이퀄라이저만 보인다. 처음 포커스는 검색창, Esc·바깥 클릭으로 닫고, 지금 곡을 다시 누르면 `onPick` 없이 창만 닫는다.
  - 반주 오류 문구: 반주 파일 없음 / 곡 없음·삭제됨 / 곡 준비 중(409) / 그 밖 「반주를 불러오지 못했어요」. 오류여도 연주는 계속된다.
- **화면 상태**는 `features/free/freeStage`가 정한다: 스틱 센서 + 양손 미연결이면 어두운 킷 위 유리 모양 빈 상태 카드(「연결되면 무대에 조명이 켜집니다.」)와 [드럼 세팅에서 연결하기](복귀 띠로 돌아옴), 한 손만 끊기면 킷 영역 위쪽 가운데에 `DisconnectBand`(연주 계속, [다시 연결]은 `reconnectStore`). 키보드 전용·포인터 모의 IMU는 항상 연주 상태다.
- 준비 안내(`ReadinessNotice`)는 이 화면에 두지 않는다 — 빈 상태·끊김 띠가 대신한다.
- 앵커 거리·패드별 횟수 같은 실측 표는 모니터 빌드의 「자유 연습 실측」 섹션(`features/monitor/sections/FreeMeasureSection`)으로 옮겼다.

리듬 게임(`/play`)은 곡 선택(`SongPicker mode="play"`, 선택 곡 카드에서 연습 단계 EASY｜NORM｜HARD와 그 단계의 최고 점수를 보고 [플레이], 설계 `.claude/plans/MODE-001-play-quick-start.md` v0.2) → [플레이]·표 더블클릭·Enter → 기기가 준비돼 있으면 시작 확인 창 없이 바로 카운트다운(`components/ui/feedback/Countdown`, 카운트인 마디의 남은 박 수를 화면 가운데 숫자로, 끝나면 「시작!」 0.4초) → 연주 순이다. 반주가 있는 곡은 항상 재생하고 끄는 옵션은 없다. 연주 중(`play` 단계)은 셸(사이드바·TopBar)을 숨긴 전체 화면이고 `PlayStage`(HUD·하이웨이·미니 킷)로 그린다. 게임 화면은 창 높이를 꽉 채우고 남는 높이를 모두 하이웨이가 갖는다: 상단 Dock과 HUD는 자리를 차지하지 않고 하이웨이 위쪽에 겹쳐 뜨며(HUD 배경 없음, 레인 이름·콤보는 `NoteHighway topInset`만큼 내려 HUD 아래에 둔다), 킷은 0.5배(380×150)다. HUD의 점수·콤보·정확도는 오른쪽 끝에 고정 폭(150·76·122px)으로 오른쪽 정렬한다. 판정 글씨는 레인 위 PERFECT 32px·GOOD/MISS 26px(양 끝 레인에서는 캔버스 안쪽으로 당긴다), 패드 위 16px이다. 일시정지는 Esc·스틱 연결 끊김·메뉴 요청(Dock ‖) 3종이고(`PauseOverlay`, 악보 연주와 같은 정책, HUD에는 일시정지 버튼이 없다) 그동안 노트가 멈추며 재개·처음부터·나가기(곡·단계를 골라 둔 곡 선택)를 고른다. 곡이 끝나면 결과 화면으로 가며 플레이 로그는 localStorage에 계정별 최근 20건 남는다.

**시작 대기(리듬 게임):** 주소에 `start`를 쓰지 않는다. `SongPicker onStart`가 불리면 `PlayPage`가 주소에 `?song=&chart=`만 싣고, 화면 안 상태 `startTarget`(시작하려는 곡·단계)을 기억하고, 그 클릭 안에서 `unlockAudio()`를 미리 부른다. 주소가 그 곡·단계로 바뀐 뒤에만 시작 대기가 열려 채보를 읽는다(주소에 남아 있던 이전 곡으로 시작하지 않게). 채보·반주는 시작 대기(또는 연주) 중에만 읽는다(`useChartParam({ enabled })`). 불러오는 동안은 팝업 없이 카드의 [▶ 플레이]가 스피너(`QuickStartProps.starting`, `SongPicker starting`)이고, 기기가 준비돼 있고 세션과 서버 최고 기록 조회(ready·error·idle)가 끝나면 자동으로 `begin()`한다(신기록 판정이 서버 응답보다 앞서지 않게). `StartDialog`(옵션 줄 없음)는 기기 준비가 안 됐을 때(setup 변형, [취소][다시 연결][드럼 세팅으로]), 불러오기에 실패했을 때(오류 문구 + [다시 시도]), 스네어 재정렬이 걸려 있을 때(재정렬 프롬프트)만 뜬다. 팝업이 한 번이라도 뜬 뒤에는 기기가 이어지거나 재시도가 끝나도 자동 시작하지 않고 팝업의 [▶ 플레이]·Enter를 기다린다. [취소]·Esc는 시작 대기만 끄고 곡·단계 선택은 남긴다. 결과 [다시 하기]·Enter는 곡 선택을 거치지 않고 같은 곡·단계의 카운트다운으로 바로 들어간다 — `ResultPage`가 `retryPathOf` 주소에 navigate state `RETRY_AUTOSTART_STATE`(`{ autoStart: true }`)를 실어 보내고, `PlayPage`가 그것을 보고 도착하자마자 시작 대기에 들어간 뒤 state를 비운다(주소에는 싣지 않아 새로고침·뒤로 가기로는 다시 시작하지 않는다). 추천 카드(`recommendationPathOf`, `/sheet`에만 `&start=1`)·드럼 세팅·일시정지 복귀는 곡·단계를 골라 둔 곡 선택으로 오고, 그 곡이 있는 쪽을 연 채(`SongTable revealId`) [▶ 플레이]에 포커스를 주고 선택 곡 카드 전체가 보이게 스크롤한다(`QuickStartProps.focusStart`). 내장 곡(음수 id)도 주소로 골라 둔다. 시작 대기 중에만 서버 최고 점수를 읽어 두었다가 시작 때 치기 전 최고값으로 고정한다(결과 화면 신기록 판정).

**메트로놈·녹음(리듬 게임):** 곡 중 메트로놈 클릭을 내지 않는다 — `PlayClock`의 `clickOn`이 항상 false이고, 카운트다운(카운트인) 박 소리는 `PlayClock`이 `clickOn`과 무관하게 원점 전 박을 항상 울려 그대로 난다. 게임 중 Dock·메트로놈 패널의 켜기·BPM·박자·탭은 비활성이다(`components/shell/dock/metronomeRoute`의 `/play` 판정, 안내 「리듬 게임에서는 메트로놈을 쓰지 않아요」). 악보 연습은 지금처럼 토글이 곡 중 클릭을 켜고 끈다. 게임은 녹음하지 않는다 — `PlayPage`는 `recordingStore`에 연결하지 않고(연주 잠금·`finishSong`·`disarm` 없음), `recordButtonVisible`에서 `/play`가 빠져 Dock에 녹음 버튼·상태 표시가 없다. 다른 화면에서 켠 녹음 대기(armed)는 그대로 남지만 게임이 녹음을 시작하거나 저장 창을 띄우지 않는다. 보관함의 예전 녹음은 그대로다(연주 로그용 `PlayRecorder`는 녹음 기능과 별개). 결과에서 Enter는 같은 곡 다시 하기.

**키보드 규칙(리듬 게임·악보 연습·결과):** 전역 keydown 핸들러(`PlayPage`·`SheetPage`·`ResultPage`·`KeyboardPadSource`)는 포커스된 조작 요소가 소유한 키를 가로채지 않고, `preventDefault`는 실제로 처리했을 때만 한다. 소유 판정은 `domain/kit/keyTarget.isKeyOwnedByTarget(target, code)` 하나로 통일한다 — 입력 칸·`[role=dialog]` 안은 모든 키, button·a·`role=button|tab|link`는 Enter·NumpadEnter·Space만 소유하고 Esc 같은 그 밖의 키는 전역이 받는다. 새 전역 핸들러는 `e.isComposing`·`e.defaultPrevented`·이 함수를 먼저 확인한다. 연주 중(일시정지 아님)에는 포커스가 `body`여야 Space(킥)가 버튼 클릭으로 새지 않는다. 일시정지 다이얼로그(`PauseOverlay`)는 `components/ui/overlay/useDialogFocus`로 열릴 때 [재개]에 초점을 주고 Tab·Shift+Tab을 다이얼로그 안에서 순환시키며(계산은 `components/ui/overlay/focusCycle`) Esc는 재개이고 Enter·Space는 포커스된 버튼의 기본 동작이다. 닫힐 때는 이전 요소로 복원하지 않고 `body`로 보낸다(`returnFocus: 'blur'`, 기본값은 `'restore'`). 새 다이얼로그는 `components/ui/overlay/Dialog`로 감싼다(이 훅이 들어 있다). 내장 곡 결과의 [다시 하기]는 로그에 id가 없어도 `domain/play/playRetry.retryPathOf`가 `songId`로 내장 음수 id를 복구해 같은 곡·단계의 시작 확인 창이 열린 곡 선택(`start=1`)으로 보낸다.

연주 화면은 항상 노트 하이웨이 + 미니 킷이다(설계 D5).

- **게임 킷과 레인·패드 연결(설계 `.claude/plans/MODE-001-game-neon-link.md`):** 리듬 게임의 킷은 설정 `kitSkin`과 무관하게 네온으로 그린다. 킷은 하이웨이 바로 아래 가운데에 붙고 크기는 화면 높이 820px 이상이면 0.7배(532×210), 미만이면 0.6배(456×180)다(`useGameKitScale`, CSS `--game-kit-w/h`). 판정선 아래는 80px(`highwayGeometry.JUDGE_FROM_BOTTOM`)이고 하이웨이의 그 구간은 `mask-image`로 사라진다. 그 자리와 킷 위에 `LaneLinkLayer`(`PlayStage`의 `link` 슬롯, 캔버스)가 레인 아래 끝에서 패드까지 꺾인 길을 그린다. 길은 `laneLinks`가 계산한다: 세로 → 가로 → 세로로 꺾고 모서리를 9px 깎으며, 꺾이는 높이는 가는 방향으로 나눠(오른쪽으로 가는 선은 왼쪽 레인일수록, 왼쪽으로 가는 선은 오른쪽 레인일수록 낮게) 선이 엇갈리지 않는다. 치면 레인 플래시가 이 길을 따라 패드까지 띠로 이어지고 0.42초에 사라진다(띠 폭은 노트 폭과 패드 지름 65% 중 작은 값, 하이햇 페달은 0.6배). 타이밍 막대는 판정선 아래 가운데 그대로이고, 하이웨이를 흐리게 하는 마스크는 테두리·바탕(`::before`)과 캔버스에만 걸어 막대는 흐려지지 않는다.
- **리듬 게임 가이드:** 설정 `gameGuide`(기본 끔, `settingsStore` v25, 기기별 로컬)를 켜면 악보 연습과 같은 다음 박 배지(`useNextBeatLabels`)가 패드에 붙고, 그 레인에서 패드까지 흐르는 점선이 나온다(타격 띠 위에 그리고, 가까운 순서로 굵고 진하게, 움직임 줄이기면 흐르지 않는다). 하이햇 페달의 배지는 하이햇 패드에 붙는다.

악보 연주(`/sheet`, 상단 "악보 연습")는 반주에 맞춰 마디가 고정된 5선 악보를 커서가 지나가는 것을 보며 치는 모드다. 점수·콤보는 화면에 없고 판정은 리듬 게임과 같은 `RhythmSession`이 한다.

화면은 Figma 05 악보 연습 흐름을 리듬 게임과 같은 공유 부품으로 조립한다(`SheetPage`가 `PlayPage` 구조를 따르되, 시작은 시작 확인 창을 거친다). 곡 선택은 `SongPicker mode="sheet"`(선택 곡 카드에서 연습 단계 EASY｜NORM｜HARD까지 고르고 [플레이], 설계 `.claude/plans/MODE-001-MODE-003-picker-quick-start.md`), 시작 확인은 곡 선택 위에 뜨는 `play/StartDialog`(준비 화면은 없다. 리듬 게임도 같다 — 안내는 곡 선택의 「악보 읽는 법」. 리듬 게임은 이 창 없이 바로 시작한다), 연주는 `PlayStage variant="sheet"`(`PlayHud sheet`·`SheetPager`·`DrumKit`)다. 연주 중은 셸을 숨긴 전체 화면이다. 악보 Canvas의 색은 `readColors(canvas)`가 `tokens.css`의 글자·브랜드·판정 토큰을 읽는다. 선택 곡 카드의 최고 정확도는 서버 최고 기록 API의 SHEET·고른 단계(chartId)에서 읽는다(273번, 아래 참고).

- **URL·단계:** `/sheet`는 곡 선택, `?song=&chart=`는 곡 선택에서 그 곡·단계를 골라 두고(내 곡이면 `scope=MINE`, AI 추천곡이면 `tab=recommend`, 학습 코스면 `tab=lessons`와 고른 코스 `course`가 함께 남는다. 악보 연습은 이 주소 값이 곡 범위의 단일 기준이라 값이 없으면 항상 기본 곡이고 — 리듬 게임도 같다(405부터 `/play`의 `scope`·`tab`이 범위의 기준이고, 값 없이 들어오면 마지막에 본 범위가 아니라 기본 곡에서 연다) — 사이드바 하위 메뉴나 링크가 주소만 바꿔도 범위가 따라 바뀐다), `&start=1`이 더해지면 곡 선택 위에 시작 확인 창이 열린다(추천 카드·학습 코스 [플레이]·결과 [다시 하기]·드럼 세팅에서 돌아올 때). 단계는 `select`(곡 선택, 창이 닫혀 있음) → `loading`(창이 열려 채보 + 반주 디코드 중, 반주는 `VITE_ACCOMPANIMENT_OVERRIDE ?? assets.accompanimentUrl`) → `ready`(창에서 ▶ 플레이·Enter 가능) → `play`(+ 일시정지)이고 URL 파라미터·세션에서 렌더 중 파생한다. `useChartParam({ enabled })`는 `start=1`이거나 연주 중일 때만 채보를 읽고, `reload()`가 같은 주소의 채보를 다시 읽는다(오류 [다시 시도]). ▶ 플레이로 시작하면 주소에서 `start`가 빠져 뒤로 가기·나가기가 창을 다시 열지 않고, 일시정지 [곡 선택]은 곡·단계를 골라 둔 채 곡 선택으로 돌아간다. 창을 닫으면(Esc·[취소]·배경) `start`만 지워진다. 채보·반주를 못 읽으면 창 안에 오류와 [다시 시도]가 뜨고, 반주 오류는 옵션에서 반주를 끄면 바로 시작할 수 있다. 변박 곡은 창에 "고정 템포로 표시" 안내가 뜬다.
- **시작 확인 창(`play/StartDialog`):** 악보 연습은 [플레이]를 누르면 항상 열린다(리듬 게임은 기기 준비·오류·재정렬일 때만 옵션 없는 팝업으로 쓴다, 위 「시작 대기」). 준비 조건(`useReadiness`)으로 변형이 정해지고 열린 동안 준비 상태가 바뀌면 따라간다. `play`는 곡 한 줄 요약·연주 옵션(`PlayOptions` `rows`로 고른다. 악보 연습은 메트로놈·패드 박 번호·반주·녹음, 리듬 게임은 `options`를 넘기지 않아 옵션 구역이 없다)·재정렬 프롬프트·카운트다운 안내·[취소][▶ 플레이]이고 Enter = 플레이(불러오는 중·오류 중에는 막고, [취소] 같은 버튼에 초점이 있으면 그 버튼이 처리하지만 옵션 줄의 스위치·선택 칸에서는 Enter가 플레이다 — 바꾸는 키는 Space·화살표)다. 옵션은 상자 없이 가는 선으로 나눈 스위치 줄(높이 60, 줄 어디를 눌러도 바뀐다)이고, 메트로놈을 켜면 그 아래 박 분할 선택(`components/metronome/SubdivisionPicker`, 자동·4분음표·8분음표 + 「BPM 72 곡이라 8분음표로 울려요」 풀이)이 펼쳐진다. 분할을 고르면 `runtime/metronomePreview`가 그 곡의 BPM으로 두 박을 들려주고 창이 닫히면 끊는다. 모양은 일시정지 창과 같은 톤이다: 같은 스크림(`Dialog`의 `backdropClassName`으로 캔버스 40% + 흐림 20), 모서리 32, 가운데 머리, 캡슐 버튼(높이 52). 창 폭은 480이고 글자를 키우고 굵게 했다(제목 28/800, 옵션 이름 18/700). `setup`은 「기기 준비가 필요해요」·빠진 항목(`DeviceCheck`)·[취소][다시 연결][드럼 세팅으로]이며 플레이 버튼이 없다. [드럼 세팅으로]는 `returnTo`에 `start=1`을 실어 돌아오면 같은 곡·단계의 창이 다시 열린다. 초점 가둠·Esc는 `ui/overlay/Dialog`(`useDialogFocus`)가 맡는다.
- **반주 끄기:** 설정 `accompaniment`(기본 켬, `settingsStore` v22)가 꺼져 있으면 `SheetPage`가 반주를 불러오지도 재생하지도 않는다. 옵션 줄의 「반주 재생」 체크가 이 값을 바꾸고, 반주가 없는 곡은 비활성 + 「반주 없음」/「반주 생성 중」이다. 녹음 줄은 `recordingStore.toggleArm`을 그대로 쓴다.
- **연습 속도(50~100 %, `domain/song/practiceRate`):** 시작 확인 창에서 반주가 꺼져 있거나 반주가 없는 곡이면 반주 줄 아래에 「연습 속도」가 펼쳐진다(−/+ 5 % 단위, 배율 옆에 「BPM 120 → 84」). 반주를 켜면 접히고 100 %로 돌아간다 — 느린 반주는 음정이 내려가기 때문이다. 학습 코스의 연주 레슨 채보(`domain/play/lesson.lessonOfChart`)에서는 이 줄을 내지 않고 항상 100 %로 시작한다 — 레슨 통과는 원래 빠르기 기록만 세기 때문이다. 반주 설정(`accompaniment`)의 기본값은 끔이다.
  - 느리게 치는 방법은 채보를 늘리는 것 하나다: `scaleChart(chart, rate)`가 노트 시각·길이·원점·빠르기 구간 시각을 배율로 나누고 BPM에 배율을 곱한 채보를 만들고, 악보 페이지는 그 채보로 세션을 만든다. 엔진·곡 시계·악보·패드 박 번호·메트로놈·코칭은 고치지 않았고 같이 느려진다. 박 분할 자동도 실제 BPM으로 판정된다(120 × 0.7 = 84 → 8분). 판정 폭은 실제 ms 그대로다.
  - 고른 값은 저장하지 않는다(`features/play/store/practiceRate`). 같은 채보를 이어 치는 동안(다시 하기 포함)만 유지되고 다른 곡·단계에서는 100 %다.
  - 기록: 로그(`engine/playLog.buildPlayLog`)는 위치 값(노트 시각·타격 곡 시각·코칭 시각·길이·BPM·원점)을 원래 채보의 축으로 되돌려 남기고, 빠름·늦음(`deltaMs`)과 판정 폭·경과 시간은 실제 값 그대로 둔다. `playbackRate`를 같이 적는다(원래 빠르기면 필드가 없다). 결과 화면은 「70% 속도로 연습」 칩을 보이고 최고 기록과 비교하지 않는다(`domain/play/bestRecord`의 최고값 계산도 느린 판을 뺀다).
  - 업로드: 로그를 그대로 올린다. 판정 타격의 `tMs`는 노트 시각 + `deltaMs` × 배율이라 서버 검사식 `(tMs − note.timeMs) / playbackRate = deltaMs`에 맞는다. BE는 이 식과 최고 기록·추천 제외를 develop-BE에 반영했다(`S15P31A307-386`, mail `MODE-003_연습-속도-기록-처리` 합의). **그 BE가 배포된 서버에서만 느린 연주의 업로드가 통과한다.** AI의 노트 시각 계산은 아직이다(mail `COACH-003_느린-연주-노트시각-계산`) — 그때까지 느린 연주의 약점 구간 위치가 최대 약 30ms 어긋난다.
  - 연주 화면 HUD의 BPM은 실제 BPM이고 옆에 노란 배율 배지(「70%」)가 붙는다.
  - 연주 기록 목록은 행 보조 줄에 「70% 속도」를, 상세 리포트는 머리 줄에 「70% 속도로 연습」을 적는다. 서버 응답의 `playbackRate`(연주 목록 항목·리포트 본문, 옛 기록은 1)를 읽고, 서버에 아직 없는 기록은 이 브라우저 로그의 값을 쓴다(`practiceRate.slowRateOf`).
- **반주·시계:** `PlayClock`이 세션·반주·박 클릭을 묶는다(`begin`에서 메트로놈 잠금, 종료·나가기·언마운트에서 해제). 반주 0초 = 세션 0ms이고 카운트인은 격자 원점 `offsetMs`에서 끝난다. 박 i의 시각은 `domain/time/tempo.beatTimeMs`로 구해 빠르기 구간이 있는 곡은 구간마다 그 BPM으로 클릭한다(카운트인은 첫 구간 BPM). 리듬 게임 마디선(`NoteHighway`)도 `offsetMs`부터 같은 함수로 그린다. 악보 화면은 고정 BPM 그대로다.
- **화면(연주 중):** `PlayStage`가 위에서부터 HUD(`PlayHud sheet` — PERFECT·GOOD·MISS 수·경과/길이·연습 단계·BPM), 악보(`SheetPager`, 높이 420·전폭), 드럼 영역(안내 `GuideSlot`·`DrumKit` 0.7배·최근 타격 `HitReadout`)을 놓는다. 판정 색은 `noteStates` 배열을 판정마다 새 배열로 갱신해 `SheetPager`에 넘기고, 패드 위 다음 박 배지는 `play/useNextBeatLabels`가 `RhythmSession.notes`를 매 프레임 읽어 `DrumKit badges`로 낸다. 카운트인은 `Countdown` 숫자(남은 박 수, 끝나면 「시작!」 0.4초)다.
- **일시정지 3종(`features/play/components/pause/PauseOverlay`):** Esc 또는 Space(`user` — Space는 킥을 페달로 치는 입력(동글)일 때만 일시정지 키다. 키보드 전용·페달 없는 입력에서는 Space가 키보드 킥이라 그대로 두고, 버튼·다이얼로그에 초점이 있으면 그 요소의 Space다. `pause/useSpacePause`가 캡처 단계에서 받아 그 입력의 곡 중 Space가 킥으로 새지 않게 한다), 스틱·페달 연결 끊김(`disconnected` — `liveStore.connected`에서 어느 한 손, 또는 `liveStore.pedal.connected`의 어느 한 발이 true→false가 되고 센서 모드일 때만), `liveStore.pauseRequested === 'menu'`(E0 사이드바가 올리는 자리. 페이지가 일시정지 후 `null`로 되돌림). 재개는 준비 조건이 충족될 때만 활성(미충족이면 `ReadinessNotice`), 처음부터는 카운트인부터 다시(메트로놈 잠금 유지), 나가기는 기록 없이 그 곡·단계를 골라 둔 곡 선택으로 돌아간다(리듬 게임·악보 연습 공통, 시작 확인 창은 열리지 않는다). 드럼 세팅으로 갔다 돌아오는 주소(`returnTo`)는 악보 연습이면 `start=1`이 실려 창이 다시 열리고, 리듬 게임이면 `start` 없이 곡·단계만 골라 둔 곡 선택이다. 오버레이가 열린 동안 타격은 소리만 나고 세션에는 들어가지 않는다.
- **종료:** 곡이 끝나면 `mode: 'SHEET'` 로그(`chartVersionId`·`presetId` 포함)를 저장하고 `/result/:playId`로 이동한다. 결과 페이지는 SHEET 로그에서 점수·콤보 대신 정확도·판정 분포를 앞에 두고, 업로드가 생략된 플레이(내장 곡 등)에 한해 규칙 기반 "간단 피드백" 카드(최대 3개)와 패드별 요약을 보여 준다(업로드 대상 플레이는 리포트의 AI 약점 분석으로 일원화 — 위 "플레이 기록 업로드·상세 분석" 절). "같은 곡 다시"(Enter)는 `/sheet?song=&chart=`로 간다.

피드백 규칙과 임계값 상수는 `src/domain/feedback.ts`에 있다. 서버 AI 분석이 붙은 뒤로는 업로드가 안 되는 플레이의 폴백으로만 쓴다. 패드 Δ 표준편차 규칙의 기준은 35ms 고정이 아니라 `0.5 × goodMs`(goodMs 50이면 25ms)다 — 오차가 판정 폭 안에 갇혀 있어 고르게 흩어져도 표준편차가 약 0.58×goodMs라 고정값은 거의 걸리지 않았다(AI 쪽과 같은 수정). 로그에 BPM·박자가 없어 결과 페이지는 채보 없이 피드백을 만들므로 마디 범위가 필요한 규칙은 나오지 않는다.
악보 렌더(`features/play/components/stage/sheet/SheetPager`)는 클라이언트 Canvas 5선이며 마디가 화면에 고정되고 커서가 왼쪽에서 오른쪽으로 곡 시각에 맞춰 지나간다. 한 페이지는 악보 영역 폭 900px 미만이면 2마디, 이상이면 4마디이고, 커서가 지나간 슬롯은 1박 뒤 다음 페이지의 마디로 흐리게 바뀌어 항상 앞을 읽을 수 있다(커서가 다음 페이지로 넘어가면 모두 정상으로 돌아온다). 연주 화면 아래의 드럼 킷(`DrumKit` + `useNextBeatLabels`)은 패드 위에 그 패드를 칠 다음 박 라벨(`1`·`1e`·`1&`·`1a`)을 보인다. 그 음이 판정(Perfect·Good·Miss)되면 다음 라벨로 바뀌고, 음표가 커서에 닿는 순간 해당 패드에 "지금" 링이 뜬다. 라벨은 시작 확인 창의 연주 옵션(설정 `sheetPadCount`)에서 끌 수 있고, `prefers-reduced-motion`이면 커서가 박 단위로 이동한다. 계산은 순수 함수로 분리했다: 박 라벨 `domain/song/sheet.countLabel`, 패드 큐 `features/play/domain/padCue.padCues`, 페이지·슬롯·커서 `features/play/components/stage/sheet/sheetPagerMath`.

**격자 원점(`offsetMs`):** BE 채보의 `notes[].timeMs`는 반주 0ms 기준 절대값이고 BE는 양자화하지 않는다. FE는 `timeMs − offsetMs`(격자 시각)로 16분 칸·마디 번호·커서·박 라벨·마디 수를 계산한다(`domain/song/sheet`의 `gridOriginMs`·`gridTimeOf`·`stepIndexOf`·`barCountOf`, `SheetModel.originMs`). 음원 곡만 `offsetMs`가 0이 아니다(MIDI·내장 곡은 0이라 결과가 같다). 격자 시각이 0보다 작은 동안(카운트인·인트로) 커서는 첫 슬롯 왼쪽에 서고 박 라벨은 남은 박 수를 센다. 가장 가까운 칸 중심에서 `stepMs / 4`(32분음의 절반, BE 솎기 허용 오차와 같음)보다 먼 노트는 `offGrid`로 표시해 라벨은 가장 가까운 칸을 쓰되 패드 배지 오른쪽 위와 악보 머리 옆에 작은 점을 찍는다(라벨을 끄면 점도 없다). 원점보다 앞선 노트는 0마디 0칸에 모으고 `offGrid`다(못갖춘마디 표시는 AI의 `offsetMs` 정의 회신 뒤 후속). 판정·업로드는 원본 `timeMs`를 그대로 써 점수에는 영향이 없다. 변박 곡(`variableTempo`)은 지원하지 않고 안내만 한다. 플레이 업로드 본문에 `padCountGuide`는 넣지 않는다(서버가 400으로 거부, `playUpload.test.ts`로 고정). 마디 그리기는 `drawSheet`를 슬롯마다 clip해 한 번씩 호출해 재사용하고, 패드 그리기는 리듬 게임 킷 뷰와 같은 `components/drum/kitPadPaint`를 쓴다. 글리프 배치(보표 위치·머리·빔)는 `domain/song/sheet.layoutBar`다.
결과 페이지(로컬 카드가 보이는 경우)는 피드백 카드(`result/FeedbackCard`)가 가리키는 약점 마디를 `features/result/components/SheetSnippet`(정지 Canvas, 마디 폭 180~320px)으로 보여 준다. 그리기는 `components/sheetmusic/sheetStripDraw`의 `drawSheet`를 `SheetPager`와 공유하고, 채보는 다시 조회하지 않고 로그에서 `features/result/domain/feedback.chartFromLog`로 만든다(`bpm`이 없는 이전 로그는 스니펫 없음). 플레이 로그에는 `offsetMs`가 남아 약점 마디 번호(`buildFeedback`)와 미니 악보가 악보 화면과 같은 격자 원점을 쓴다(`offsetMs`가 없는 이전 로그는 0). 카드를 누르면 구간이 바뀐다.

포인터 모의 IMU를 켜면 마우스 위치가 스틱 자세가 되고, F(왼손)/J(오른손) 또는 좌/우클릭이 타격이다. 클릭 타격은 드럼 킷 영역(`data-pointer-strike`: 킷 그림 `DrumKit`·자유 연습 킷 칸·연주 화면 `PlayStage` 전체) 안에서만 치고, 시작 확인 창 배경이나 다른 화면 클릭은 무시한다(QA 352). 그 안이라도 버튼·입력·`data-no-pointer-strike`(터치 킷·드럼 세팅 그림)는 제외. 이 두 키는 그동안 고정 키에서 제외된다. 방향키로도 자세를 움직일 수 있다. 리듬 게임·악보 연습은 입력 종류(키보드·스틱·포인터·터치)와 상관없이 드럼 킷이 보이는 단계(준비 미리보기·연주)에서만 타격음을 내고, 곡 선택·불러오는 중에는 울리지 않는다(`features/play/components/stage/kit/kitSoundStage`, QA 352). 그 밖의 화면은 공용 타격음 스위치(`runtime/hitSound`)가 자유 연습·연주 환경 설정에서만 켠다.

## 로그인

자체 가입은 없고 소셜 로그인(Google·SSAFY)만 있다. 계약은 BE README "소셜 로그인"·"인증과 토큰" 절과 같다.

- **시작:** 랜딩의 로그인 팝업(`/login`) 버튼이 `GET /api/auth/{provider}/login`으로 브라우저를 통째로 보낸다(fetch 아님). BE가 제공자 동의 화면으로 302한다. 돌아올 경로는 `sessionStorage`(`ssaplash.auth.returnTo`)에 두며 앱 안의 절대 경로만 허용한다(`domain/account/auth.ts` `sanitizeReturnTo`).
- **콜백:** 제공자 → BE 콜백 → BE가 refresh 쿠키(`refresh_token`, HttpOnly, `Path=/api/auth`, 14일)를 심고 `/auth/callback`으로 302. 이 화면은 앱 시작 복원을 기다렸다가 저장해 둔 경로로 간다. 토큰은 주소에 실리지 않는다.
- **복원:** 앱이 뜰 때마다 `authBootstrap`이 `POST /api/auth/refresh` → `GET /api/users/me`로 로그인을 복원한다(`authStore.restore`). access 토큰(30분)은 `api/account/auth` 모듈 메모리에만 있고 localStorage·sessionStorage에 쓰지 않는다. 복원 결과(`authenticated`/`anonymous`)에 따라 `app/presetBootstrap`이 프리셋 저장소를 서버/로컬로 맞춘다([프리셋](#프리셋)).
- **만료:** 보호 API가 401이면 `apiFetch`가 refresh를 한 번 하고 같은 요청을 다시 보낸다. 동시에 여러 401이 나도 refresh는 한 번이다. refresh가 401이면 300ms 뒤 한 번 더 시도하고(두 탭이 동시에 회전하면 진 탭이 이긴 탭의 새 쿠키로 성공한다), 그래도 401이면 `authStore`가 `anonymous`가 되고 `RequireAuth`가 `/login?error=session_expired`로 보낸다.
- **로그아웃:** 상단바 아바타 메뉴의 "로그아웃" → `POST /api/auth/logout`(204) → 메모리 토큰·활성 채보 작업 기록 폐기 → 랜딩(`/`).
- **설정(`/settings`, 옛 마이페이지 `/me`는 여기로 이동):** 소리·메트로놈·판정·진행·화면 표시·꾸미기·계정·데이터 활용 순서의 설정 구역이다. 앱 동작·표시 값만 두고, 스틱·기기에 맞추는 값(기기 연결·프리셋·보정·박자 맞추기·판정 타이밍·패드 인식 범위)은 드럼 세팅(`/setup`)에서 관리한다. 넓은 화면은 두 열(왼쪽 소리·메트로놈·판정·진행, 오른쪽 화면 표시·꾸미기, 그 아래 줄에 계정·데이터 활용), 좁은 화면은 한 열이다. 소리는 전체·드럼(0~200%)·노래(0~100%) 음량, 메트로놈은 플레이 중 메트로놈·박 분할, 판정·진행은 판정 폭 Perfect(±10~60ms)·Good(±30~150ms)·노트 낙하 시간(600~3000ms)·카운트다운, 화면 표시는 실시간 코칭·타이밍 막대·리듬 게임 가이드, 꾸미기는 드럼 모양·타격 이펙트를 제공한다. 계정과 데이터 활용은 로그인 상태에 따라 표시하고 회원 탈퇴 버튼은 하단에 둔다. 최근 플레이는 연주 기록(`/history`)이 맡는다.
- **플레이 기록은 계정별이다:** 로컬 플레이 로그 키는 로그인 계정마다 `ssaplash.playlogs.u{userId}`, 비로그인(인증 끔 개발 모드)은 `ssaplash.playlogs`. `app/authBootstrap`이 로그인 상태에 맞춰 `engine/playLog`의 주인을 바꾼다. 다른 계정의 기록은 최근 플레이·결과·악보 기록에 보이지 않는다. 계정 키가 생기기 전 기존 키의 기록은 계정으로 옮기지 않는다(누구 것인지 알 수 없다).
- **맞춤 곡 추천 학습 활용 동의(COACH-004):** `VITE_RECOMMENDATION_CONSENT_ENABLED=true`일 때만 신규 동의를 수집한다. 기본은 비활성이다. 공개 전 문구 확정과 BE 허용 판 반영이 필요하다. 동의 여부와 R1·R2는 독립이다. 서버의 GET/PUT이 원본이고 PUT은 항상 현재 판을 보낸다. 해당 판이 허용 목록에 없으면 422이며 기존 상태를 유지한다.
  - **설정 "데이터 활용" 구역:** 기존 동의자는 수집 비활성 중에도 상태 조회와 철회가 가능하다. 읽기 실패는 미동의로 표시하지 않고 재시도를 제공한다. 이전 판에 동의한 상태는 켜진 토글과 판 갱신 필요 안내로 표시한다. 공개된 수집에서 새 동의는 본문을 확인한 뒤 명시적으로 수행한다.
  - **기존 사용자 1회 안내:** 수집 공개 시 이 항목 이전에 가입해 한 번도 답하지 않은 사용자(`version === null`)에게 `components/shell/RecommendationConsentDialog`를 띄운다. `AppShell`이 로그인 복원(`authenticated`, `signupCompleted !== false`) 뒤 `load()`하고, 아래 억제 조건에 걸리지 않으면 마운트한다. 제목 「맞춤 곡 추천 학습에 연주 기록을 쓸까요?」, 본문은 가입 항목 요약(목적·항목·처리·철회·거절해도 기능 동일). [동의하고 사용] → `set(true)`, [괜찮아요]·Esc·배경 클릭 → `set(false)` — 둘 다 서버에 "답했음"(`version` 채움)이 남아 어느 기기에서도 다시 뜨지 않는다. 기본은 미동의라 초기 초점은 [괜찮아요]에 둔다. **억제:** `/signup` 경로, 연주 중(`immersive`)에는 띄우지 않고 벗어난 뒤 다음 렌더에 띄운다. 비로그인·`VITE_AUTH_REQUIRED=false`(status가 `authenticated` 아님)·가입 전 회원은 읽지도 띄우지도 않는다. PUT이 실패하면 `dismissForSession()` 뒤 닫고 이번 세션에는 다시 띄우지 않는다(다음 접속에 다시 뜬다). 테스트: `RecommendationConsentDialog.interaction.test.tsx`.
- **회원 탈퇴:** 설정 화면 하단의 "회원 탈퇴" 버튼 → 확인 대화상자(`features/settings/components/WithdrawDialog`) → `DELETE /api/users/me`(204, BE가 refresh 쿠키를 지운다) → 메모리 토큰·활성 채보 작업 기록(`ssaplash.chartJob.v1`, 로그아웃 때도 지운다)·그 계정의 로컬 플레이 로그 폐기 → `/login?error=withdrawn`. 안내 문구: 학습 활용에 동의한 플레이 기록만 식별 정보를 제거해 보관(BE 153). 204만 탈퇴로 본다. 401은 탈퇴 근거가 아니라 인증 만료로 처리한다 — 토큰을 비우고 `/login?error=session_expired`로 가며 로컬 기록은 지우지 않는다. 네트워크·5xx는 대화상자에 문구를 보이고 다시 시도할 수 있다. 되돌릴 수 없고 같은 소셜 계정으로 다시 로그인하면 새 회원이다.
- **오류 코드(`/login?error=`):** BE가 붙이는 `access_denied`(동의 취소)·`oauth_failed`, FE가 붙이는 `no_session`(콜백 뒤 refresh 실패)·`session_expired`·`network`(서버 연결 실패)·`withdrawn`(탈퇴 완료 안내, 오류 색 없이 표시). 문구는 `domain/account/auth.ts`에 있다.
- **보호 라우트:** 랜딩(`/`·`/login`·`/signup`·`/welcome`)·`/auth/callback`을 뺀 모든 화면은 `RequireAuth` 아래다. 로그인했어도 `domain/account/signupGate.needsSignup`이 true인 회원은 `/signup`으로 보낸다(원래 경로는 `state.from`). `VITE_AUTH_REQUIRED=false`면 검사 없이 통과한다([실행](#실행)).
- **주의:** BE `.env`에 그 제공자의 키가 없으면 버튼을 눌렀을 때 BE의 404(problem+json)가 그대로 보인다 — 브라우저 이동이라 FE가 가로챌 수 없다. Safari는 `http://localhost`의 Secure 쿠키를 거부할 수 있어 로컬에서는 Chrome·Firefox로 확인한다.
- **화면:** 비로그인 첫 화면은 랜딩(`features/landing/components`)이고, `/login`·`/signup`은 랜딩 위에 로그인·가입 동의 팝업을 연다(설계 UX-353). 모드 카드(자유·악보·게임)를 누르면 로그인 뒤 그 화면으로 돌아간다. `/auth/callback`만 `components/shell/PublicLayout` 아래다. 가입 동의 팝업은 Esc·배경으로 닫히지 않고 「다른 계정으로 로그인」(로그아웃 후 `/`)만 있다. 제공자 버튼은 Figma 로그인 카드대로 로고 + 「Google로 계속하기」·「SSAFY로 계속하기」(둘 다 `ui/Button` secondary, 카드 폭)이며 가입·로그인 버튼을 나누지 않는다. `VITE_LOGIN_PROVIDERS`(쉼표 구분, 예 `google`)로 거른다. 미설정이면 google·ssafy 전부 보이므로 BE에 키가 없는 제공자는 빼 둔다. 게스트·둘러보기 진입은 없다.
- **랜딩 연출(`features/landing/components`):** 장면(`.lp-scene`)을 높이 220·280·420·320·300vh(히어로·소개·스틱·채보·모드)로 길게 잡고 안의 `.lp-sticky`를 화면에 붙인다. `useSceneProgress`가 장면 시작~끝을 0~1 MotionValue로 주고 `useTransform`으로 `m.*` 스타일에만 연결하므로 프레임마다 React 리렌더가 없다. 스틱 3단계·채보 탭·네온 점등처럼 경계를 넘을 때만 state를 바꾼다. 스틱 그림은 `StickStage`의 Canvas 2D 한 장이다(시안 A, 연주자 시점). `useStickSwing` rAF 루프가 프레임마다 경과 초만 넘기고, `StickStage`가 그 시각에서 `domain/stick*`로 두 자루의 자세와 지난 1초의 타격을 계산해 `stickStageDraw`로 그린다(스틱 모양은 회전체를 띠로 칠하고, 타격 빛·링·팁 섬광·그림자·잔상·센서 축·블루투스 표시도 같은 캔버스). 스틱 색은 `--brand`를 읽고, 3단계 그림 층 투명도는 ref에 두고 0.3초 시간 상수로 목표값에 다가가므로 프레임마다 React 상태·렌더가 없다. IntersectionObserver로 화면 밖이면 멈추고 언마운트 때 `cancelAnimationFrame`·크기 관찰을 정리하며, `getContext('2d')`가 null이면 그리지 않는다. 결과·CTA는 `useReveal`(마운트 후에만 숨김 클래스를 붙이고, 들어오면 한 번 나타남). 구간·이징·장면별 수치는 `features/landing/domain/landingMotion` 순수 함수와 그 단위 테스트가 정한다. 모션 줄이기면 장면에 `lp-static`이 붙어 스크롤 연동 없이 최종 상태(채움 100%·카드 제자리·네온 켜짐·스틱 3단계 층)로 일반 흐름에 놓이고 스틱 그림은 정지 화면 한 장(3단계 층, 오른손 강세 직후)만 그리고 루프를 돌리지 않으며 reveal도 멈춘다.
- **가입 동의(`/signup`):** 세 필수 항목과 수집 공개 시에만 나타나는 선택 추천 학습 동의로 구성한다. 필수 일괄 동의는 선택 항목을 바꾸지 않는다. 문구와 판은 `domain/account/signupTerms`에서 관리하며 추천 문구는 검토 전 초안이다.
  - **분기:** 가입 게이트는 필수 약관만 검사한다. 공개 중 재동의로 진입한 기존 회원은 추천 동의 상태를 읽고 현재 판 동의만 미리 선택한다. 조회 실패 시 재시도를 제공하고 추천 항목을 생략해 기존 응답을 덮어쓰지 않는다.
  - **제출:** `POST /api/users/me/signup-consent`에 필수 동의를 보내며, 추천 항목이 공개된 경우에만 선택 여부와 판을 함께 보낸다. 비공개 또는 기존 상태 읽기 실패 시 선택 항목을 생략해 기존 서버 응답을 보존한다.
  - **403 `SIGNUP_INCOMPLETE`:** 동의 전 회원이 다른 API를 부르면 `api/http`가 알리고(`subscribeSignupIncomplete`), `app/signupGate`가 `authStore.refreshMe`로 `/me`를 한 번 다시 읽어 `signupCompleted=false`가 되면 `RequireAuth`가 `/signup`으로 보낸다. 이미 가입이 필요한 상태면 무시하고 `/me`가 실패해도 한 번으로 끝난다.
  - **전환기 규칙:** `/me`에 `signupCompleted` 필드가 없으면(BE 가입 동의 단계 미병합) 가입 완료로 보고 아무것도 검사하지 않는다. 필드가 있고 false일 때만 막는다.
  - `VITE_AUTH_REQUIRED=false`면 세 곳(콜백·보호 라우트·`/signup`) 모두 검사하지 않고, 제출하면 `/`로만 간다. 가입 취소 버튼은 없다 — 동의 없이 떠난 계정은 BE가 7일 뒤 삭제한다.
- **연주 기록 활용 동의(ACCT-002·ACCT-001 회신 2):** 가입 때 **필수** 동의로 확정됐고 철회는 회원 탈퇴로만 한다. 설정 화면에 토글이 없고 FE는 `PUT /api/users/me/data-consent`를 부르지 않는다. 동의의 진실은 `GET /api/users/me`의 `dataConsent { agreed, version, updatedAt }`(답한 적 없으면 셋 다 null)이고, 플레이 시작(`begin`·`restart`·악보 `resetRun`)에서 `features/play/dataConsent.readCurrentConsent()`가 `agreed === true && version === domain/account/signupTerms.dataConsentVersion()`을 읽어 `PlayLog.consent`에 저장하며 업로드 `consent`가 그 값이다(비로그인·null·판 불일치·필드 없는 옛 로그는 false). 동의 저장과 판이 바뀐 회원의 재동의는 가입 동의 화면(2단계-B, `POST /api/users/me/signup-consent`)이 맡는다. 연주 기록 활용 본문의 「동의 철회는 회원 탈퇴로 할 수 있어요.」는 배포 전에 넣어 판은 그대로다.
- **프로필:** 상단바 우측 아바타(`components/shell/account/ProfileMenu`)를 누르면 닉네임·제공자 배지·설정·로그아웃 메뉴가 열린다. 프로필 이미지가 없으면 닉네임 첫 글자를 보인다. 바깥 클릭·Esc로 닫힌다(`ui/overlay/Menu`, Esc면 아바타로 초점을 돌려주고, 공간이 모자라면 위로 펼친다).

## 디버그

플레이 중 `` ` `` 키를 누르면 타격별 수신·판정·오디오 구간 지연을 보여주는 디버그 창이 열린다.

### 튜닝 (디버그 창)

디버그 창의 "튜닝" 구역(접힘이 기본)에서 센서 판정·세기 파라미터 10개를 플레이 중에 바꾼다. 바꾼 값은 다음 타격부터 반영되고 localStorage(설정 `tuning`)에 저장된다. 재캘리브레이션은 필요 없다 — 반경은 저장된 손별 앵커에 현재 튜닝을 적용해 매번 다시 계산한다(`anchorsToProfile`). 앵커별 반경 줄은 왼손·오른손이 다르면 "왼/오"로 보인다.

| 값 | 기본값 | 범위 | 의미 |
| --- | --- | --- | --- |
| `radiusFactor` | 0.6 | 0.30~0.80 | 앵커 반경 = 같은 손의 가장 가까운 다른 앵커까지 각도 × 계수 |
| `minRadiusDeg` | 15 | 8~30 | 반경 하한(°). 세팅 화면 고급 설정의 "패드 인식 범위 최소"와 같은 값 |
| `maxRadiusDeg` | 35 | 8~45 | 반경 상한(°). 세팅 화면 고급 설정의 "패드 인식 범위 최대"와 같은 값 |
| `velocity.minAccelG` | 0.8 | 0.2~4 | 이 가속도(g) 이하는 벨로시티 1 |
| `velocity.maxAccelG` | 8 | 2~32 | 이 가속도(g) 이상은 127. min 이하로 내리면 min + 0.5 |
| `velocity.gamma` | 0.8 | 0.3~2 | 곡선 모양. 1 미만이면 약한 타격이 더 크게 |
| `sensorOffsetMs` | 0 | -150~150 | 센서 타격 시각에 더하는 값. 키보드 타격에는 적용 안 됨 |
| `outsidePolicy` | `mute` | `mute` / `nearest` | 앵커 반경 밖 센서 타격: 무음 / 가장 가까운 패드 |
| `angleRange.yawDeg` | 60 | 20~120 | 화면 가로 전체가 몇 도의 팔 움직임인지(±). 포인터 모의 IMU와 앵커 → 표시 배치 변환이 같이 쓴다 |
| `angleRange.pitchDeg` | 35 | 10~80 | 화면 세로 전체가 몇 도의 팔 움직임인지(±) |

- 기본값과 슬라이더 범위는 `src/domain/tuning.ts`(`DEFAULT_SENSOR_TUNING`, `TUNING_RANGES`)에만 있다. 실측값을 찾으면 여기만 고친다. 이미 저장된 값은 자동으로 덮어쓰지 않으므로 "기본값으로" 버튼으로 받는다.
- 반경 세 값(0.6 · 15 · 35)은 EMB 실측(11/5 메일)이고 11/6 7패드 통합 테스트 뒤 조정한다. 나머지는 하드웨어 도착 전 초안이다.
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
5. 하드웨어가 없으면 모니터 상단 바의 **모의 스틱** 토글로 가짜 패킷을 흘려 화면을 확인한다(`features/monitor/core/mockStick`). 모의 스틱은 `dongle` 옵션으로 LINK(1초 + 변화 시)를 흉내 내고, `dropHand`·`restoreHand`·`reboot`로 한 손 끊김→복귀·재부팅(STATUS 비트 5 + 시계 0부터, SET_PAD_TABLE을 받으면 비트 5 해제)을 흉내 낸다. ROUTE로 감싼 명령은 마스크의 손에만 적용한다. 페달 패킷(role 2·3 HIT·STATUS, `0x08 PEDAL`, LINK bit2·3)은 빌더(`buildPedal` 등)로 만들어 단위 테스트에서 쓴다 — 모의 스틱이 흘리는 것은 손뿐이다. 단위 테스트가 이 빌더·시나리오를 쓴다.

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
| 자유 연습 실측 | 최근 타격 상세(소스·가장 가까운 패드·앵커 거리) · 패드별 횟수·판정 없음·합계·센서 타격 평균 앵커 거리 · [초기화](섹션을 오가도 이어짐) | — |

- ④ 판정·⑤ 채점·⑥ 출력은 `engine/diagTap`(진단 탭)을 같은 창에서 구독해 채운다. 판정·채점 결과는 연주 화면(`/play`·`/sheet`)이 `engine/diagReport`로 내고, 입력 소스가 낸 타격(resolved)은 `app/bootstrap`이 낸다. 구독자가 없으면 publish는 즉시 반환해 운영 빌드에 영향이 없다. 모니터와 연주 화면이 같은 창이 아니면 ⑤는 비어 있다 — 아래 "연주 창 따라보기"로 채운다.
- 상태 기준(임계값)은 `features/monitor/core/health.ts` 맨 위 `HEALTH_THRESHOLDS` 한 곳에 있다. 지금 값은 가정값이고 실기 기록을 보고 조정한다.
- 타격 추적은 ② HIT 표 행이나 ⑤ 판정 목록 행을 누르거나 사이드바 "타격 추적"에서 목록으로 고른다. 고른 타격은 사이드바 하단 카드로 남고(누르면 타격 추적으로 이동), ←/→로 이전·다음 타격으로 옮긴다. 모의 스틱 타격은 판정 경로 밖이라 ①②③만 채워지고 ④⑤⑥은 이유가 표시된다. 키보드·포인터 타격은 패킷이 없어 ④⑤⑥만 채워진다. "지우기"는 선택도 비운다.
- 마지막으로 연 섹션과 패널 펼침 상태는 브라우저에 기억한다. HIT 행을 누르면 ② 센서의 원시 파형 패널이 열리고 같은 hitSeq 스윙을 고른다.

### 핵심 수치 바와 도착 표현

- 상단 바 바로 아래 고정 띠(`features/monitor/layout/KeyMetricsBar`)가 어느 섹션에서나 스틱 L·R의 SYNC 왕복(최근·중앙값), 도착(수신−정지) 중앙값, HIT 유실(최근 1분), 수신 패킷/초를 큰 글씨로 보인다. 값마다 상태 색(`features/monitor/core/health` 기준 재사용)과 작은 기준 표기가 붙고, 값이 없으면 "–"와 이유(스틱 없음·동기화 전)가 나온다. 1초마다 갱신하며 따라보기·재생에서도 같다.
- **도착(수신−정지)** = 수신 시각 − 보정 timestamp(ms)다. 내부 필드 `futureMs`(보정 timestamp − 수신 시각)의 부호만 반대로 보이는 것이고, 필드와 녹화 형식은 그대로다. 스틱별 최근 HIT 중앙값이 −11 ~ 0이면 정상(수신이 추정 정지 시각보다 조금 먼저), 0 초과면 주의(전송 지연), −20 미만이면 주의(너무 이름 — tsCorrUs·시계 확인), 최대 +20 초과면 이상이다. 기준은 `HEALTH_THRESHOLDS.clock`의 한 곳이고 HIT 표 색도 같은 기준을 쓴다.

### 녹화 재생

제어 섹션 "녹화 요약"의 **녹화 파일 열기·재생**으로 `.jsonl`을 열면 입력 방식이 "녹화 재생"으로 바뀌고, 요약을 보이면서 바로 재생을 시작한다(녹화 중에는 요약만).

- 재생 바(상단 바 아래): 재생/일시정지, 처음부터, 배속(1·2·4×), 진행 막대(경과/전체), 파일 이름, 닫기. 패킷·진단 줄을 원래 간격대로 흘리므로 ①②③ 섹션·파형·수치 바(모의 스틱 녹화), ④⑤⑥(키보드 녹화)가 녹화 때와 같은 모양으로 채워진다. 진단 줄이 없는 이전 형식 파일도 재생된다(④⑤⑥은 빈 채).
- 시각은 재생 시작 시점 기준으로 옮기고, 진단의 hit 시각 필드(`tHit`·`tRecv`·`tResolved`·`tAudio`)도 같은 차이만큼 옮긴다(따라보기와 같은 방식). 시계 오프셋은 녹화의 SYNC 송신(t0)·SYNC_ACK 짝(`features/monitor/core/syncPair`)을 연주 때와 같은 `ClockSync`에 넣어 스틱별로 다시 구해(10초 창 최소 왕복 + 초당 1ms 추종) 도착·③이 채워진다.
- 재생 중에는 이 창의 센서 연결을 해제하고, 명령 송신·녹화·모의 스틱이 막힌다. "닫기"나 입력 방식 변경 시 화면 상태(패킷 로그·판정·선택)를 비우고 원래 입력 방식으로 돌아간다. "처음부터"도 화면 상태를 비우고 다시 시작한다. 구현은 `features/monitor/core/recording/replay`(순수: 시간표·상태기·오프셋)와 `features/monitor/core/feed`의 `replay` 모드다.

### 연주 창 따라보기

연주 화면(`/play`·`/sheet`)을 띄운 채 다른 창에서 ④ 판정·⑤ 채점·⑥ 출력과 패킷을 실시간으로 본다. `VITE_MONITOR=true` 빌드에서만 동작한다.

1. 연주 창 상단 바의 **모니터 새 창** 버튼을 누른다(`/monitor/stick?follow=1`이 팝업으로 열리고 따라보기로 시작). 이 버튼과 **채보 확인 재생** 토글은 개발 서버(`npm run dev`)에만 있다. 배포 빌드에서는 새 탭에 주소를 직접 연다(아래 "배포 사이트에서 실연주 녹화"). 이미 열린 모니터는 상단 바 **입력 방식**에서 "따라보기"를 고르면 된다. "직접 연결"로 돌아오면 저장된 센서를 다시 연다.
2. 상단 바에 `연주 창: {소스} · 연결됨`이 보이면 정상이다. 연주 창이 없거나 hello(1초 주기)가 3초 넘게 없으면 "연주 창 없음". 연주 창이 여러 개면 가장 최근 hello를 보낸 창 하나만 따른다.
3. **같은 브라우저·같은 출처(origin)의 창끼리만** 된다(BroadcastChannel `ssaplash-monitor`). 다른 PC·기기에서는 볼 수 없다.
4. **읽기 전용**이다. 따라보기 중 이 창은 센서를 열지 않고(설정의 센서 종류는 그대로), 모의 스틱·명령 송신·파라미터 쓰기는 꺼진다. 소스 연결은 연주 창이 가진다.
5. 시각은 두 창의 `performance.timeOrigin` 차이만큼 옮겨 이 창 기준으로 보인다. 시계 오프셋·전송 통계는 연주 창이 hello로 보낸 값이다.

relay(`app/monitorRelay`) 비용은 모니터를 보지 않을 때 0이다. 모니터가 1초마다 보내는 `watch`가 있는 동안(마지막 watch 후 3초)만 packetTap·diagTap을 구독하고, 이벤트를 50ms마다 한 묶음으로 보낸다. watch가 끊기면 구독과 타이머를 모두 푼다. `/monitor` 경로의 창은 응답하지 않는다. `VITE_MONITOR` 미설정 빌드에는 relay·모니터 청크가 들어가지 않는다. 상단 셸의 "모니터 새 창" 버튼과 "채보 확인 재생" 토글은 `VITE_MONITOR=true`이면서 개발 서버(`import.meta.env.DEV`)일 때만 있다 — 모니터를 켠 배포 빌드에서도 일반 사용자 화면에는 보이지 않는다.

#### 배포 사이트에서 실연주 녹화

배포 web 이미지를 `VITE_MONITOR=true`로 빌드하면(Infra 서버 `.env`의 `FE_VITE_MONITOR=true` → `docker-compose.yml` web 빌드 인자) 배포 사이트의 실제 곡을 치면서 패킷·판정을 한 파일로 받는다. 주소는 네비게이션에 없고 로그인한 계정만 열린다.

1. 로그인 → 탭 1: 세팅에서 스틱 연결 → 곡 선택 화면까지.
2. 탭 2(같은 브라우저): `/monitor/stick?follow=1`. 상단 바 입력 방식 "따라보기", `연주 창: … · 연결됨` 확인.
3. 탭 2 [녹화 시작] → 탭 1에서 연주 → 탭 2 [녹화 정지·저장] → `stick-YYYYMMDD-HHMMSS.jsonl`.
4. **모니터 탭은 곡을 시작하기 전에 열어 둔다.** 연주 창은 모니터가 보고 있는 동안만 중계하므로 곡 시작 줄(`session`·`notes`·`anchors`)은 그때 모니터가 붙어 있어야 남는다.

### 동작 원리

- 입력 소스(WS·BLE·Web Serial)가 프레이밍을 벗긴 payload를 `input/packetTap`에 publish하면 `features/monitor/core/recording/packetLog`가 구독해 `decodePacket`으로 풀고 링버퍼(2,000건)에 쌓는다. 판정 경로(`parsePacket` → `InputManager`)는 그대로 돌고, 모니터는 복제본만 본다. 모니터를 켜도 소리·판정 지연은 바뀌지 않는다.
- 센서 시각은 바퀴 수를 세지 않고 환산한다: 원시 µs + 소스 오프셋에 한 바퀴(2^32 µs)의 정수배를 더해 **수신 시각에 가장 가까운 값**을 쓰고(`tsUnwrap.nearBrowserMs`), 관측·채택 오프셋은 그 손에서 처음 본 값과 반 바퀴 이내로 맞춘다(`normalizeOffsetMs`). 소스 `ClockSync`와 모니터가 각자 바퀴를 세면 한쪽만 초기화될 때(스틱 재연결, 로그 지우기) 정확히 한 바퀴만큼 어긋나기 때문이다.
- 페달 보드(role 2·3)는 손 L·R 통계에 섞지 않는다. SYNC 짝 실패·ACK 수는 손 응답만 세고, 페달은 ② 센서의 **페달** 칸에 배터리·fw·SYNC 왕복(최근/최소)·오프셋(관측/채택)·짝 실패를 따로 보인다. 페달 보드 하나가 두 role을 같은 시계로 보내므로 SYNC는 role 2 응답만 센다. 채택 오프셋은 직결 소스에서만 나온다(따라보기·재생은 –).
- 통계는 1초 슬라이딩 창: 타입별 패킷/초, HIT·POSE seq 유실, 브리지 CRC(0x7E `BRIDGE_STATS`)와 직결 CRC(Web Serial `transportStats`), SYNC→SYNC_ACK 지연, `timestamp − 수신 시각`(미래 ms), LOG `drop`·`I2C REC`·`BOOT` 집계.
- 제어 섹션: GET_PARAMS → PARAM_ACK 14개 + 종료 표시(0x00). 스틱 FW 1.12부터 종료 표시 앞에 현재 방위각 오프셋(0x21)이 하나 더 오고, 종료 표시의 개수에는 들어가지 않는다(모의 스틱도 같게 답한다). SET_PARAM 응답 500ms 대기. SET_PAD_TABLE·SET_YAW_OFFSET·RESET_POSE 적용 확인(0x20·0x21·0x22)은 명령 바에 쌓인다.
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
| 2~ | 패킷 — `t`(`performance.now()` ms), `dir`(`in`/`out`), `transport`, `stick`, `role`, `hex`, `decoded`(`decodePacket` 결과, 수신분만). 수신 순서 그대로, 송신·`bridgeStats` 포함. `stick`은 손(role 0·1)만 채우고 페달(role 2·3)은 `null`, `role`은 수신 패킷의 flags role(0 왼손·1 오른손·2·3 페달, role 없는 패킷·송신은 `null`). 손·페달 구분은 `role`로 한다 |
| 패킷 줄 사이 | 진단 — `{"kind":"diag","t":<ev.t>,"ev":{…t를 뺀 이벤트}}`. `resolved`·`judged`·`missed`·`session`·`notes`·`anchors`·`clock`·`audio`·`yawCorrect`·`minPeak` 등(diagTap 이벤트). 직접 연결·따라보기 모두 기록하고 패킷과 도착 순서대로 섞인다. `resolved`의 `tAudio`는 발행 뒤에 채워지므로 정지 시점에 직렬화한다 |
| 녹화 중 탭이 숨겨지거나 보일 때 | 탭 숨김 — `{"kind":"vis","t":<performance.now()>,"hidden":true\|false}`. 다른 줄의 `t`와 같은 시계다. 브라우저가 숨긴 탭의 타이머를 늦춰 그 구간 기록이 빠질 수 있어 남긴다(설계 PLAY-006). 되읽기(`parseJsonl`)는 `vis` 배열로 돌려주고, 옛 파일은 빈 배열이다 |

meta의 `inputMode`(`direct`/`follow`)는 녹화 시작 시점의 입력 방식이다. 되읽기(`parseJsonl`)는 `kind`가 없으면 패킷 행, `diag`면 진단, 그 밖의 `kind`는 건너뛰므로 이전 형식 파일도 그대로 읽힌다(진단은 없음). `role`이 없는 이전 파일도 그대로 읽고, 재생할 때 직렬(동글) 패킷의 손은 패킷의 role에서 다시 구하므로 페달이 손 통계에 섞이지 않는다.

실연주 진단용 줄(설계 PLAY-002 live-play-diagnostics). 연주 창이 내고 모니터 화면은 쓰지 않는다 — 녹화 파일에만 남는다. 모르는 `type`은 되읽기·판정 로그·요약이 건너뛴다.

| `type` | 언제 | 필드 |
| --- | --- | --- |
| `anchors` | 곡 시작(재시작 포함)마다 `session` start·`notes` 뒤 1회. `/play`·`/sheet` | `hands[2]`(0 왼손·1 오른손, 보정 안 한 손은 `null`) 원소 `{pad, pitch, yaw, radius, samples, spread}` — `radius`는 판정 프로필과 같은 값(자동 반경·override 반영). `calibratedAt`(ms), `presetId` |
| `clock` | 센서 소스가 켜져 있고 모니터가 보는 동안 10초마다 + 곡 시작 직후 1회(`app/diag/clockDiag`) | `offsets[4]` = role 0·1·2·3의 브라우저 − 센서 오프셋(ms, 미동기·미연결 `null`), `source`(센서 종류) |
| `audio` | 모니터가 보는 동안 10초마다 + 곡 시작 직후 1회(`app/diag/audioDiag`). `session` 줄은 곡 시작 순간에만 나가므로 녹화를 늦게 켜도 이 줄로 값을 알 수 있다 | `audioOffsetMs`(진행 중인 판의 판정 타이밍 보정 = 스틱 값, 판이 없으면 설정 값), `kickOffsetMs`(발 타격에 쓰는 값. 따로 재지 않았으면 `audioOffsetMs`와 같다. 옛 녹화에는 없다), `baseLatencyMs`·`outputLatencyMs`·`sampleRate`(AudioContext 보고값, 오디오를 안 켰으면 `null`), `measured`(마지막 박자 맞추기: `medianMs`·`madMs`·`pairs`·`input`·`measuredAt`, 없으면 `null`) |
| `yawCorrect` | `yawDriftMonitor`가 `SET_YAW_OFFSET`을 보낼 때(`onCorrection`) | `stickId`, `reason`(`drift` 자동 보정 · `realign` 재정렬 · `connected` 연결 직후 0 초기화), `prevDeg`(보내기 전 적용값), `sentDeg`(보낸 절대값 = wrap180(`prevDeg` − `medianDeg`)), `medianDeg`(`drift` 링 중앙값 · `realign` 요청 오차 · `connected` `null`), `madDeg`(`drift`만), `samples[]`(`drift`만: 그때 링의 스틱 yaw − 앵커 yaw), `judgedBy[]`(`samples`와 같은 순서의 판정 주체, `drift`만). `drift`는 `medianDeg`를 ±8°로 자른 만큼만 움직여 `sentDeg` − `prevDeg`가 실제 이동량이다. 적용 확인은 PARAM_ACK `0x21` 패킷 줄 |
| `yawHalt` | 부호가 연달아 뒤집혀 그 손의 자동 보정을 멈출 때 한 번(`onHalt`) | `stickId`, `flips`(연달아 뒤집힌 횟수), `medianDeg`(보내지 않은 오차), `appliedDeg`(그때 적용값). 멈춘 손은 재정렬 필요로 올라간다 |
| `minPeak` | `sensorSession.pushMinPeak`가 그 손에 최소 타격 세기(`SET_PARAM 0x03`)를 보낼 때(같은 값이면 생략). 보정 저장·손 연결·저장값 지우기 | `stickId`, `dps`(보낸 값), `medianDps`(보정 타격 중앙값. 보정 저장이 아니면 `null`), `samples`(계산에 쓴 표본 수. 보정 저장이 아니면 0), `reason`(`capture` 보정 저장 · `linked` 손이 붙음·설정 변경 · `reset` 저장값이 지워져 기본 400으로 돌아감) |
| `session` | 곡 시작·일시정지·재개·종료. `/play`·`/sheet` | `phase`, `mode`, `songId`, `title`, `windows`, `audioOffsetMs`, `kickOffsetMs`, `noteCount`, `haptic`(이 판의 타격 진동 방식 `judgement`·`local`, 옛 녹화에는 없다), end에는 `reason`·`summary` |
| `arrivalSkew` | 기기 사이 도착 지연 차이 경고가 시작·끝날 때(`app/bootstrap`) | `phase`(`start`·`end`), `spreadMs`(중앙값 최대 차), `medians`(`left`·`right`·`pedal`의 도착 지연 중앙값, 표본 부족이면 `null`), `outlier`(`left`·`right`·`pedal`, 가르지 못하면 `null`) |

#### 녹화 요약

제어 섹션의 "녹화 요약" 패널이 녹화의 구간 지연·SYNC rtt·채점 delta 분포를 표로 보여준다. 요약 값에는 마지막 `audio` 줄(`summary.audio`)이 들어가고 "표 복사"의 Markdown에 「오디오: 판정 타이밍 보정 · base · output」 한 줄로 나온다. 스틱 값과 킥 값이 다르면 보정 자리에 「스틱 … · 킥 …」로 둘 다 나오고, 같거나 옛 녹화면 값 하나만 나온다(세션 표의 오디오 오프셋 열도 같다). 녹화 정지 직후 방금 녹화가 표시되고, "녹화 파일 열기"로 이전 `.jsonl`을 열 수 있다(읽기 실패 시 오류 문구 표시). "표 복사"는 Wiki에 붙여넣을 Markdown 표를 클립보드에 넣는다. 각 지표 옆 "기준"은 `HEALTH_THRESHOLDS`의 대응 값이다(rtt p50 ≤ `clock.rttWarnMs`, 판정→오디오 p95 ≤ `output.audioP95WarnMs`, 센서→오디오 p95 ≤ `output.totalP95WarnMs`, delta |평균| ≤ `score.deltaMeanWarnMs`). rtt는 송신 SYNC의 t0와 SYNC_ACK `t0Ms`를 packetLog와 같은 규칙(`features/monitor/core/syncPair`)으로 짝지어 구한다. 진단 줄이 없는 이전 파일은 패킷 수·rtt만 채워진다. 녹화 중 탭이 숨겨졌으면(`vis` 줄) 요약에 숨김 횟수와 합계 시간(끝까지 숨겨진 채면 마지막 줄 시각까지)이 들어가고 Markdown에 「- 녹화 탭 숨김: N번, 합계 S초」 한 줄이 나온다.

**녹화 중 탭 숨김 경고(모니터 전용)**: 녹화 중에만 `visibilitychange`를 듣는다. 탭이 숨겨지면 `vis` 줄을 남기고 탭 제목을 「⚠ 녹화 탭 숨김」으로 바꾸며, 다시 보이면 제목을 되돌리고 숨겨진 시간 합계를 상단에 「녹화 중 이 탭이 N초 숨겨졌어요. 그 구간은 기록이 빠졌을 수 있어요.」로 보인다. 녹화를 멈추거나 새로 시작하면 경고와 합계를 지운다. 유저 연주 화면에는 탭 숨김 UI가 없다.

### 텔레메트리 전송 (ADMIN 진단)

스틱 연결 진단(지연·시계·연결 품질)용 HIT·STATUS 이벤트를 BE `POST /api/telemetry/batches`로 보낸다. 운영 모니터링이 아니라 ADMIN이 켠 동안만 도는 진단 수집이다. `VITE_MONITOR=true` 빌드에만 들어가고, 일반 빌드 번들에는 이 코드(`telemetry/*`)가 없다(bootstrap이 동적 import).

- **켜는 법**: 모니터 제어 섹션의 "텔레메트리" 패널에서 **켜기**. 켜기 값은 브라우저 localStorage 키 `airdrum.monitor.telemetry`(`1`/`0`) 하나이고, 같은 출처의 다른 창은 `storage` 이벤트로 따라간다(모니터 창에서 켜면 연주 창이 보낸다).
- **전송 조건**: 켜기 ∧ 로그인 사용자 role이 `ADMIN`. 로그아웃하거나 ADMIN이 아니면 멈추고, ADMIN 로그인이 복원되면 켜기 값에 따라 재개한다. 서버가 403을 주면 자동으로 끄고(저장소 값 `0`) 패널에 사유를 보인다.
- **이벤트 원천 창에서만 전송**: 이벤트는 센서를 연 창(연주 창 또는 직접 연결 모니터 창)에서 만들어 그 창이 보낸다. 따라보기 모니터 창은 이벤트를 만들지 않으므로 패널 카운터(이 창 기준)가 0이다.
- **전송 규칙 요약**: 큐 적재는 동기, 전송은 1초 타이머 또는 100건 도달 때 배치 하나(1~100건·128 KiB 이하, 동시 요청 1개, 타임아웃 5초). 큐 상한 1,000건·대기 TTL 10초, 넘치면 오래된 것부터 폐기하고 사유(`overflow`·`ttl`·`oversize`)별로 센다. 401은 refresh 뒤에도 그 배치를 다시 보내지 않고 폐기한다. 타임아웃·네트워크·5xx·429는 결과 불명으로 세고 같은 배치를 재전송하지 않으며 1·2·4초(최대 10초) 쉬었다 다음 배치를 보낸다(429는 Retry-After 우선). 끌 때와 페이지를 떠날 때(`pagehide`)는 남은 큐를 한 번 보내 보고(최선 노력) 끌 때는 큐를 비운다.
- **미확정**: BE 152번(수신 API) 병합 전이라 경로(`telemetry/sender.ts`의 `TELEMETRY_PATH`)와 오류 `code` 문자열은 확정 전이다. 지금은 HTTP 상태로만 분기하며, 병합 뒤 맞춘다.

## 프리셋

배치·사운드를 이름 붙여 저장한 것이 프리셋이다(최대 10개 — 드럼 세팅 칩 줄은 슬롯 5개(`PRESET_SLOTS`)까지 추가 허용, 이름 1~50자·중복 불가, 기본 프리셋 1개). 목록에 없는 예약 프리셋 **시스템 기본**(`SYSTEM_PRESET_ID = 'system'`, 표시 이름 `SYSTEM_PRESET_NAME`)이 항상 있어 `activePresetId`는 `null`이 되지 않는다(v18): 고정 배치 `DEFAULT_KIT_LAYOUT` + 3D 모델 기본 앵커, 편집·저장 불가, `selectDirty`는 항상 false. 프리셋별 판정 앵커는 서버가 아니라 기기 로컬 `settingsStore.presetAnchors[id]`에 두고 `apply`가 사본(`stickAnchors`)을 갈아끼운다(다른 기기에서 만든 프리셋은 앵커가 없어 모델 기본으로 판정, 세팅 ②가 "보정 필요"). `remove`는 그 기록도 지우고 적용 중이었으면 시스템 기본으로 돌아간다. 저장소는 `domain/kit/preset`의 `PresetSource` 인터페이스(`list`·`create`·`update`·`remove`·`setDefault`, 오류는 `PresetError.code`) 뒤에 있고 구현이 둘이다.

- **서버(`api/kit/presets`의 `ServerPresetSource`)** — 로그인 상태에서 쓴다. BE README "키트 프리셋" API(`/api/presets`)를 `apiFetch`로 부른다. 응답 `id`(숫자)는 문자열로, `sounds.soundSetId`는 `soundSetId`로 올리고 모르는 세트 id는 `ssaplash`로 보정한다. 본문은 `name`·`layout`·`sounds`·`schemaVersion`뿐이며 `calibration`은 보내지도 읽지도 않는다(공통 명세서 미결 #23, 10/22: 캘리브레이션은 기기·세션 값). 오류는 `PRESET_NAME_DUPLICATE → NAME_DUPLICATE`, `PRESET_LIMIT_EXCEEDED → LIMIT_EXCEEDED`, `PRESET_NOT_FOUND → NOT_FOUND`, `PRESET_CONFLICT → CONFLICT`, 그 밖(네트워크·5xx·다른 4xx) → `NETWORK`.
- **로컬(`store/localPresetSource`)** — `settingsStore.presets[]`(localStorage). 익명 상태에서만 쓴다. 운영 빌드는 `/setup`이 로그인 뒤라 사실상 `VITE_AUTH_REQUIRED=false` 개발 빌드 전용이다. 로그인해도 로컬 프리셋을 서버로 옮기지 않는다(10/23 합의).

어느 저장소를 쓸지는 `app/presetBootstrap`이 `authStore.status`를 구독해 정한다. `authenticated`면 서버, `anonymous`면 로컬, 복원 중(`unknown`·`restoring`)이면 기다린다. 저장소를 바꾸면 목록을 다시 읽고 적용 프리셋(`activePresetId`)을 맞춘다 — 시스템 기본이거나 목록에 있으면 유지, 없으면 기본 프리셋 적용, 기본도 없으면 시스템 기본. 읽기에 실패하면 `status = 'error'`만 남기고 적용 프리셋은 두지 않는다. 전환은 순서대로 처리되고 같은 상태가 다시 와도 다시 읽지 않는다. 로그아웃·세션 만료로 `anonymous`가 되면 서버 목록은 비워지고 로컬로 돌아간다.

화면은 `presetStore`(`items`·`status`·`error`, 액션 `refresh`·`apply`·`saveChanges`·`saveAs(name, draft?)`·`setDefault`·`remove`)만 부르며(`draft`는 [새로 보정] 결과 — 초안의 배치로 만들고 앵커를 새 프리셋에 기록한 뒤 적용), 실패하면 `status = 'error'`·`error = 코드`만 바꾸고 편집 중인 `kitLayout`·`soundSetId`는 건드리지 않는다. 서버는 첫 프리셋도 기본으로 만들지 않으므로 `saveAs`가 생성 뒤 `setDefault`를 한 번 더 부른다. 변경 여부(`dirty`)는 상태가 아니라 `selectDirty(settings, presets)`로 현재 편집값과 적용 프리셋을 비교해 얻으며, 적용 프리셋이 없으면 저장할 것이 있는 것으로 보아 true다.

## 사운드 세트

패드 소리는 사운드 세트가 정한다. 세팅 화면의 "사운드 세트"에서 `SSAPLASH 키트`(샘플)와 `합성음(임시)`을 고르며 선택은 설정(`soundSetId`)에 저장된다.

- 샘플 세트는 `public/sounds/<id>/kit-config.json`과 `audio/*.wav`를 읽는다. 패드별 게인·재생 속도는 코드가 아니라 이 JSON이 정한다. 키트를 교체하려면 파일과 JSON만 바꾼다. 키트 항목 → 패드 매핑표는 `src/audio/kitConfig.ts`에 있다(`high`=스몰탐, `mid`=미드탐). 샘플이 없는 패드는 `audio/soundSets`의 폴백표를 따라 다른 패드 샘플을 작게 쓴다(하이햇 페달 → 하이햇 0.7배), 폴백도 없으면 합성음. 출처·라이선스는 키트 폴더의 `SOURCE.md`에 있다(스네어·탐 3개는 CC BY 3.0이라 출처 표기가 필요하다).
- **하이햇 세 소리:** 키트 항목 `hihat`은 페달을 밟은 상태의 닫힌 타격(`HIHAT`), `hihat_pedal`은 페달을 밟는 소리 chick(`HIHAT_PEDAL`), `hihat_open`은 페달을 뗀 상태의 열린 타격(아래 열림/닫힘)이다. 기본 키트(minorr, 2026-11-04 교체)는 세 항목이 모두 있어 `HIHAT_PEDAL`도 폴백 없이 자기 샘플을 쓴다. `hihat_pedal`이 없는 키트만 위 폴백을 탄다.
- **하이햇 열림/닫힘:** 왼발 페달이 연결돼 있고 뗀 상태(`liveStore.pedal.connected[0] && !hihatClosed`)면 스틱 `HIHAT` 타격이 열림 소리다. 페달이 없거나 끊기면 닫힘(지금 소리)이다. `bootstrap`이 `pedal` 이벤트·연결 변화마다 `AudioEngine.setHihatOpen(open)`으로 알리고, 다음 `HIHAT` 타격부터 반영된다(울리는 열림 소리를 끊는 초크는 없다). 열림 소리는 `kit-config.json`의 선택 항목 `pads.hihat_open`(`file`·`gain`·`playbackRate`, 패드 항목과 같은 형식)이 있으면 그 샘플(`SoundSet.variants.HIHAT_OPEN`), 없으면 합성 열림 보이스(대역 노이즈, 감쇠를 길게)다. 샘플이 없어도 `missing`에 넣지 않는다. 기본 키트는 `hihat_open` 샘플(약 2초 울림)이 있다.
- 첫 소리(오디오 언락) 이후에 샘플을 불러온다. 불러오는 동안과 파일 하나가 실패한 패드는 합성음으로 울린다. 한 번 불러온 세트는 다시 고를 때 재다운로드하지 않는다.
- 세기는 게인으로 반영한다(`패드 게인 × 키트 masterVolume × v^1.4`). 그 뒤 버스·마스터 게인이 곱해진다.
- **음량 3단 구조(설정 화면 오디오 구역, 11/4 hotfix 294):** 타격 게인 → 패드 버스(`soundOn ? drumVolume : 0`, 드럼 음량 0~2) → 마스터(`volume`, 전체 음량) → 소프트 리미터 → 출력. 반주는 반주 버스(`songVolume`, 노래 음량 0~1) → 마스터. 메트로놈 클릭은 마스터 직결이라 전체 음량과 `metronomeVolume`만 받는다. `bootstrap.applySettings`가 설정 변경마다 `AudioEngine.setVolume / setDrumVolume / setSongVolume`을 부르고, 버스 게인이라 울리는 소리에도 즉시 반영된다. 패드 소리 끄기를 풀면 1이 아니라 `drumVolume`으로 돌아온다. 세팅 화면 톡 치기도 패드 버스를 지나므로 드럼 음량 시험에 쓸 수 있다. 저장 설정 v15에서 두 필드가 추가됐고(기본 1) 이전 설정은 마이그레이션이 채운다.
- **키트 gain 재조정(11/4):** minorr 키트 교체 때 샘플이 이전 키트보다 패드마다 5~13dB 작아지고 패드별 gain도 1.0으로 리셋돼 드럼이 작게 들렸다. 첫 100ms RMS를 재서 이전 키트의 실효 음량에 맞춘 gain(킥 1.8·하이햇 2.4·라이드 5 등)을 `kit-config.json`에 넣었다. 출력단 리미터가 있어 gain이 1을 넘어도 클리핑은 나지 않는다. 키트를 바꿀 때는 샘플 크기를 재서 gain을 같이 맞춘다.
- 세팅 화면에서 패드를 톡 치면(이동 6px 이내) 소리와 타격 이펙트가 나온다. 이 타격(`source: 'preview'`)은 텔레메트리·통계에 남지 않는다.

## 메트로놈·사운드 토글

> 셸 개편으로 칩·BPM 조작은 상단 GlassDock으로, 옛 팝오버는 Dock 칩을 누르면 열리는 `components/shell/dock/MetronomePanel`(Figma 228:5712)로 옮겼다. 패널: 제목 + 박 무늬 · 박자(4/4·3/4, 엔진이 지원하는 것만)·탭 템포 · 박 분할(자동·4분음표·8분음표) · 메트로놈 음량(0~100%, 설정 `metronomeVolume`, 클릭 게인에 곱함). 켜기 스위치와 BPM −/+는 바로 위 Dock 칩에만 있고 패널에는 없다. 면은 Dock과 같은 유리(흐림 24)·모서리 24이고 구역은 가는 선으로만 나눈다. 박 무늬는 한 마디에 클릭이 나는 자리(큰 점 = 정박, 작은 점 = 사이 박)이고 울릴 때 정박만 켜진다. 열릴 때 초점은 박자에서 고른 칸으로 간다. 바깥 클릭·Esc로 닫히고(Esc면 칩으로 초점 복귀) Dock 접기·라우트 이동 때도 닫힌다. 연주는 멈추지 않는다. 아래 「칩」·「팝오버」는 각각 Dock 칩·패널로 읽는다(슬라이더 BPM 조절은 없음).

상단 바에 전역 메트로놈 칩(비트 점 · BPM · 재생/정지)과 "패드 소리" 스위치가 있다. 스케줄러는 `engine/Metronome` 싱글턴이고, 칩(`components/shell/Metronome`)은 `liveStore.metronome`을 읽고 엔진 메서드만 부른다.

- 칩의 ▶/■는 재생·정지, 칩 본체를 누르면 팝오버가 열린다(바깥 클릭·Esc로 닫힘). 팝오버: BPM 슬라이더(40~240)·`-5/+5`·박자(4/4 · 3/4)·탭 템포.
- 탭 템포는 버튼을 누를 때마다 최근 최대 8번의 평균으로 BPM을 정한다(2번째 탭부터 반영). 2초 이상 쉬면 새로 센다. 첫 박은 악센트(높은 음, 점 색 다름).
- 재생 중 페이지를 이동해도 유지된다(엔진이 React 밖 싱글턴, 칩은 `AppShell`에 있음). 새로고침 후에는 정지 상태로 시작한다.
- 리듬 게임·악보 연습에서 세션을 시작하면 메트로놈이 곡에 잠긴다(`Metronome.lock`): 칩이 곡 BPM·박자와 "곡" 배지를 보이고 슬라이더·박자·탭 템포는 비활성이며, 점은 세션이 `pulse`로 알리는 박에 깜빡이고 ▶/■는 세션 클릭(`settings.metronome`)을 켜고 끈다.
- 세션이 끝나거나 나가면 `unlock`으로 사용자 BPM·박자(정지 상태)로 돌아온다. 잠금 중 값은 설정에 저장되지 않는다.
- **박 분할(4분·8분):** 설정 `metronomeSubdivision`(`auto`·`quarter`·`eighth`, 기본 `auto`)이 박당 클릭 수를 정한다. 자동은 기준 BPM이 90 미만이면 8분이다(`domain/time/metronome.resolveSubdivision`, 경계 `AUTO_EIGHTH_BELOW_BPM`). 기준 BPM은 자유 연습에서는 메트로놈 BPM, 악보 연습에서는 곡의 대표 BPM(`chart.bpm`)이다.
  - 예약 단위는 틱(박 × 분할)이다. 틱의 박 위치는 틱 ÷ 분할이고, 분할이 바뀌면 `retick`이 다음 틱을 같은 박 위치 이상으로 옮긴다(8분 → 4분은 다음 정박부터).
  - 클릭 소리는 3단계다: 첫 박 1600Hz · 정박 1100Hz · 사이 박 800Hz(더 작고 짧다, `audio/AudioEngine`의 `CLICK_VOICE`).
  - 박 점과 패드 박 번호는 4분음표 그대로다. `onBeat`·`pulse`는 정박에만 불린다.
  - 자유 연습: `bootstrap`이 설정과 엔진 BPM이 바뀔 때마다 풀어 `Metronome.setSubdivision`에 넣는다.
  - 악보 연습: `PlayClock`이 `subdivision()`을 예약 때마다 읽어 연주 중에 바뀌어도 한 박 안에 반영한다. 사이 박은 준비 마디를 포함해 곡 중 클릭(`settings.metronome`)이 켜져 있을 때만 난다. 빠르기 구간이 있는 곡은 사이 박도 구간 BPM의 반 박에 온다.
  - 리듬 게임(`subdivision`을 넘기지 않음)과 박자 맞추기(강·약 두 단계)는 4분음표 그대로다.
  - 고르는 자리는 세 곳이고 같은 설정 값을 읽고 쓴다: Dock 메트로놈 패널, 설정 「오디오」의 「메트로놈 박 분할」, 악보 연습 시작 확인 창의 메트로놈 줄. 선택 칸 문구(`SUBDIVISION_LABEL`)와 풀이 문구(`subdivisionHint`)는 `domain/time/metronome`에 있다.
  - **예시 소리(`runtime/metronomePreview`):** 분할을 고르면 그 자리의 BPM(창 = 곡, 패널 = 패널의 BPM, 설정 = 메트로놈 BPM)으로 두 박(`PREVIEW_BEATS`)을 들려준다. 4분이면 2번, 8분이면 4번이고 첫 박만 강세다. 다시 고르면 앞의 것을 끊는다. 메트로놈이 울리는 중이거나 곡에 잠겨 있으면 내지 않는다(`bootstrap`이 넘긴 `busy`) — 바뀐 소리가 바로 들리기 때문이다. 풀이 줄 오른쪽 점 두 개(`PreviewDots`)가 정박에 맞춰 켜진다.
- 사운드 토글은 패드 소리만 음소거한다. 메트로놈 클릭은 계속 난다.
- 설정 `metronomeBpm`·`metronomeBeatsPerBar`·`metronomeSubdivision`·`metronomeVolume`·`soundOn`이 localStorage에 저장된다.
- 개발 모드에서는 콘솔에서 `window.__metronome.stats`(`scheduled`·`late`·`maxDriftMs`)로 예약 지터를 읽을 수 있다.

## 키보드 입력(임시)

키보드는 스틱이 오기 전까지의 임시 입력이다. 키 매핑 카드는 10/22에 제거했고 매핑은 `domain/kit/keyMap.ts` 상수 하나다. 환경변수 `VITE_KEYBOARD_INPUT=false`로 빌드하면 키 안내와 키보드 소스 등록이 함께 빠진다(기본은 켜짐, 예시는 `.env.example`). 안정화 후에는 `keyboardSource`·`domain/kit/keyMap.ts`를 지운다.

## 곡 선택·시작 확인 창 최고 기록 (273번)

- 로그인한 API 곡 소스는 GET /api/v1/plays/best-records?songIds=…를 사용한다. 곡 선택 표·상세는 해당 모드의 전체 연습 단계 중 최고값(리듬: 점수, 악보: 정확도), 선택 곡 카드는 두 모드 모두 고른 단계(chartId)의 최고값을 표시한다(리듬 게임은 최고 점수 `scoresByChart`, 악보 연습은 최고 정확도 `accuraciesByChart`, 없으면 「—」). 내장 개발 소스는 로컬 로그의 단계별 최고(`domain/play/bestRecord`의 `bestScoreByChart`·`bestAccuracyByChart`)를 쓴다. 결과 화면의 신기록 비교용 치기 전 최고 점수는 곡 전체 최고(`scoresBySong`)이고 시작 확인 창이 열린 동안 담아 시작 때 고정한다. 여러 채보 버전은 서버에서 집계하며 COMPLETED만 포함한다. 이전 로컬 계산과 중도 종료 포함 여부가 달라 값이 낮아질 수 있다.
- 서버 정확도 0~100을 domain/serverBestRecord에서 0~1로 한 번 변환한다. 0은 유효한 기록이고 null·생략된 기록은 —다. API 실패를 로컬 기록으로 대체하지 않는다.
- features/play/useBestRecords는 현재 목록 ID를 중복 제거해 100개씩 순차 조회하고 모든 묶음 성공 후 표시한다. 빈 목록은 요청하지 않는다. 계정·곡 변경의 이전 응답을 무시하고 이탈 시 취소한다. 카드의 단계 변경은 이미 받은 같은 곡 결과를 재사용한다(다시 조회하지 않는다).
- 조회 중 안내와 실패 시 다시 시도를 제공하되 최고 기록 때문에 준비·연주 시작을 막지 않는다. 화면 진입 및 플레이 업로드 DONE 변화 시 조회한다. 다른 기기·탭에서 바뀐 기록은 화면 재진입 시 반영한다.
- VITE_SONGS_SOURCE=builtin 개발 소스는 기존 로컬 기록 계산을 유지한다. 서버의 기본 곡(BUILTIN) 탭은 API 소스이므로 서버 기록을 사용한다.


## 학습 코스(입문·중급) (331번, 중급 11/13)

드럼을 처음 치는 사람이 스테이지를 순서대로 통과하며 배우는 코스다. 입문 코스(킥·스네어·하이햇) 뒤에 중급 코스(크래시·라이드·탐 세 개·하이햇 페달)가 이어진다. BE `GET /api/v1/lessons`(레슨 목록·진도, 항목마다 `course`)·`POST /api/v1/lessons/{songId}/completion`(알아보기 완료)을 쓴다. 설계는 개인 문서 `.claude/plans/SETUP-입문-코스.md`·`SETUP-학습-코스-중급.md`.

- **위치:** 악보 연습 곡 선택의 네 번째 범위 [학습 코스](`features/play/components/picker/SongPicker` → `features/play/components/picker/lesson/LessonCourse`). 「악보 연습」 하위 메뉴의 「학습 코스」나 화면 위 버튼으로 들어간다. 로그인·API 곡 소스일 때만 보이고 리듬 게임 곡 선택에는 없다. `/sheet?tab=lessons`로 바로 열리고 `&course=beginner|intermediate`로 코스를 고른다(없거나 모르는 값이면 도전할 레슨이 있는 코스, 다 통과했으면 마지막 코스 — `domain/play/lesson.defaultCourse`). `useChartParam`은 곡·채보를 바꾸거나 지울 때 `tab`과 `course`를 남겨, 레슨 시작 확인 창을 닫으면 같은 코스가 그대로 남는다.
- **코스 칸:** 위에 레슨이 있는 코스마다 칸(`picker/lesson/CoursePicker`, 이름·한 줄 설명·「N개 중 M개 통과」와 진도 막대, 다 통과하면 「코스 완료」, 첫 스테이지부터 잠겼으면 자물쇠와 「입문 코스를 다 통과하면 열려요」). 칸을 누르면 주소의 `course`를 바꾼다(기록은 덮어쓴다). 잠긴 코스도 볼 수 있고 그때 카드는 「입문 코스를 먼저 통과해요」와 [입문 코스 이어 하기]다. 코스 이름·설명·맵 아래 목표 문구는 `domain/play/lesson.COURSES`에 있다. 서버에 레슨이 없는 코스는 칸이 없다.
- **화면:** 고른 코스의 원형 스테이지 맵(`StageMap`, 맨 아래 목표 문구는 코스마다 다르다)과 고른 레슨의 카드. 카드에는 설명, 레슨 음표(`PadNotation`, 위치·머리는 `domain/song/sheet`의 `staffPosOf`. 4개를 넘으면 오선을 줄로 나눠 고르게 놓고(`domain/play/lesson.notationRows`, 7개 → 4·3), 줄마다 그 줄 음표가 차지하는 높이만큼만 자리를 잡는다. 그래도 카드보다 넓으면 비율을 지킨 채 줄인다), 드럼 그림(`DrumKit`에서 레슨 패드만 `armed`), [레슨 시작하기]. 드럼 그림은 악보 아래에 둔다.
- **잠금·통과:** 서버 `passed`에 이번 접속에서 통과한 레슨(`lessonStore.localPassed`)을 더해 `domain/play/lesson.stageStates`가 전체 목록(입문 → 중급 한 줄)에서 다시 계산하고, 코스 화면은 그 결과를 코스별로 잘라 쓴다. 통과 전인 첫 스테이지만 열리므로 입문을 다 통과해야 중급 1번이 열린다. 잠금은 화면 안내이고 서버는 순서를 강제하지 않는다.
- **연주 레슨(`PLAY`):** 기존 악보 연습 흐름 그대로(`/sheet?tab=lessons&course=…&song=&chart=&start=1` — 시작 확인 창이 열리고, 코스 카드 버튼 이름은 「플레이」, 알아보기 레슨은 「레슨 시작하기」). 결과 화면은 기록의 채보가 레슨이면 `LessonResultBand`로 통과(정확도 70% 이상, 기준값은 서버 `passAccuracy`, 서버와 같은 `accuracyPercent`)·재도전과 [다음 레슨]·[코스로](그 레슨의 코스)를 보이고, 통과하면 업로드를 기다리지 않고 `localPassed`에 더한다. 입문 마지막 레슨을 통과하면 [다음 레슨] 대신 「입문 코스를 모두 마쳤어요. 중급 코스가 열렸어요.」와 [중급 코스로]다(`courseFinishText`). 코스 완료 카드: 입문은 「8비트를 칠 수 있게 됐어요」 + [기본 곡 보러 가기]·[중급 코스 시작하기], 중급은 「드럼 아홉 개를 모두 칠 수 있게 됐어요」 + [기본 곡 보러 가기].
- **알아보기 레슨(`READ`):** `/sheet/lesson/:songId`(`features/lesson/LessonReadPage`). 화면 제목·「← 입문 코스/중급 코스」·[코스로]는 그 레슨의 코스다. 악보가 흐르지 않고 음표를 한 줄로 늘어놓는다. 지금 음표의 드럼을 치면 다음으로, 틀리면 그대로 두고 답을 알려 준다(`guide`가 꺼진 레슨은 틀리기 전에는 묻기만). 소리는 자유 연습과 같은 공용 경로(`setSoundOnHit`)가 내고 화면은 `liveStore`의 마지막 타격만 본다. 드럼 그림을 눌러도 친다. 화면에 있는 동안 키보드 드럼을 켠다(`useKeyboardDrum(true)`, 자유 연습과 같음. 켜지 않으면 키보드 타격이 무시된다). 끝까지 치면 완료를 저장하고, 실패하면 이번 접속에서는 통과로 두고 [다시 저장]을 보인다.
- **끝 빈 구간 줄이기(S15P31A307-385):** 서버 곡 길이는 "마지막 노트 + 한 마디"라 짧은 레슨에서는 다 친 뒤 기다리는 시간이 길다. 악보 연습(`SheetPage`)은 학습 코스의 연주 레슨일 때만 세션을 만들기 전에 채보 길이를 "가장 늦은 노트 + `LESSON_TAIL_MS`(1400ms)"로 줄인다(`domain/play/lesson.trimLessonTail`). 엔진이 곡 길이 + 0.8초에 끝내므로 마지막 노트 약 2.2초 뒤 결과 화면으로 넘어간다. 메트로놈·악보 커서·진행 표시·시작 확인 창과 결과의 곡 길이·플레이 로그·녹음이 줄인 길이 하나를 쓴다. 엔진과 서버 곡 길이는 그대로이고, 일반 곡·알아보기 레슨·노트 하이웨이(`PlayPage`)에는 적용하지 않는다. 레슨 목록을 아직 못 읽은 채 시작한 판은 줄이지 않는다.
- **자동 넘김(S15P31A307-334):** 레슨을 통과했고 다음 레슨이 같은 코스면(`domain/play/lesson.autoAdvanceTarget`) 3초(`AUTO_ADVANCE_SECONDS`) 카운트다운 뒤 다음 레슨으로 간다. 결과 화면 띠(방금 친 결과만 — `ResultPage`가 도착 때 `location.state`에 `prevBest` 키가 있었는지를 한 번 정해 `fresh`로 넘긴다. 결과 화면은 도착 직후 state를 비우므로 매번 다시 읽으면 안 된다. 같은 결과 화면에 뒤로 가기로 돌아오면 다시 세지 않는다)와 알아보기 완료 팝업(저장 실패가 떠 있으면 세지 않는다)이 같은 훅 `components/lesson/useAutoAdvance`를 쓴다. 세는 동안에는 버튼 줄에 「3초 뒤 다음 레슨으로 넘어가요.」 글자와 [머무르기]·[지금 가기]를 두고, 화면 누르기·스크롤·터치·키(누르고 있어 반복되는 키 제외)가 오면 멈춰 원래 버튼([다음 레슨]·[코스로])으로 돌아온다. 통과 못 함·코스 마지막 레슨은 세지 않는다. 통과하지 못했을 때 띠에는 [코스로]만 두고, 다시 하기는 결과 화면 아래 [다시 하기](Enter) 하나가 맡는다 — 레슨 기록이면 `lessonPath`(학습 코스·그 코스 유지)로 간다. 자동으로 갈 때 연주 레슨 주소에는 `&auto=1`이 붙는다(`lessonPath(next, { auto: true })`). `SheetPage`는 `auto=1`이고 그 채보가 연주 레슨이며 기기가 준비됐고 설정의 카운트다운이 켜져 있으면, 채보·반주 준비가 끝나는 순간 [플레이]를 한 번 대신 누른다. 그동안에는 곡 선택·시작 확인 창 대신 준비 화면(「다음 레슨을 준비하고 있어요」)만 보여, 결과 화면에서 넘어올 때 화면이 잠깐 바뀌어 보이지 않는다. 시작하지 못하면(박자 맞추기 권유·오디오 준비 실패 등) `auto`를 지워 시작 확인 창으로 돌아온다. 조건이 하나라도 어긋나면 `auto`만 지우고 창은 그대로 두며, 나중에 기기를 연결해도 저절로 시작하지 않는다. 창을 닫거나 연주를 시작하면 `start`와 함께 `auto`도 지운다. 설계는 개인 문서 `.claude/plans/SETUP-학습-코스-자동-넘김.md`.
- **권유 카드:** `LessonInvite`(셸 본문 위). 로그인, 레슨 1개 이상, 통과한 레슨 0개, 이 브라우저에서 닫은 적 없음(`localStorage` `airdrum.lessonInvite.dismissed`), 지금 [학습 코스]가 아님일 때만 보인다. 버튼 [입문 코스 시작]은 `/sheet?tab=lessons`(처음이면 입문 코스가 보인다). [학습 코스](`LessonCourse`)에 한 번 들어오면 카드 버튼이든 다른 길이든 [닫기]와 같이 기억해 다시 띄우지 않는다. 로그인 없는 빌드·내장 곡 빌드에서는 그리지 않는다.
- **실패:** 레슨 API가 실패하면 탭 본문에 다시 시도, 0개면 「학습 코스를 준비하고 있어요」, 카드는 띄우지 않는다. 다른 탭·화면은 영향이 없다.

```powershell
npx vitest run src/domain/play/lesson.test.ts src/components/lesson src/features/play/components/picker/lesson src/features/lesson/LessonReadPage.interaction.test.tsx
```

## 미니게임 (MODE-006, 405~409번)

리듬 게임과 별개로 혼자 기록을 깨거나 친구와 번갈아 겨루는 가벼운 게임이다. 405는 다섯 게임이 같이 쓰는 틀과 첫 게임 「누구보다 빠르게」를, 406은 「강약중강약」을, 407은 「악보 보고 빨리 치기」를, 408은 「인간 메트로놈」을, 409는 이벤트용 「정적 뒤 한 방」을 넣었다. 그 뒤 「어디까지 올라가는 거예요?」(설계 `-crescendo.md`)를 더했다. 서버 API를 부르지 않는다. 설계는 개인 문서 `.claude/plans/MODE-006-minigame-speed.md`·`-dynamics.md`·`-sight.md`·`-tempo.md`·`-oneshot.md`.

- **진입·경로:** 사이드바 「리듬 게임」 하위 메뉴의 「미니게임」, 접힘·태블릿에서는 리듬 게임 곡 고르기 범위 줄 옆의 「미니게임」 링크. 목록은 `/play/mini`(`features/mini/MiniListPage`), 게임은 `/play/mini/{게임 id}`(`domain/play/miniGame`: `MINI_PATH`·`miniGamePath`·`isMiniPath`). 한 게임의 안내·카운트다운·플레이·결과는 한 경로 안의 단계이고 새로 고침하면 안내로 돌아온다. 상단 바 제목은 「미니게임」.
- **목록:** 목록 표(`features/mini/domain/miniCatalog.MINI_CATALOG`)의 게임마다 카드(`MiniCard`: 그림·꼬리표·이름·한 줄 규칙·최고 기록·[시작])를 그린다. 구현된 게임만 표에 둔다(지금은 다섯 장, 이벤트 스위치를 켠 빌드는 여섯 장). 점수를 다른 꼴로 보일 게임은 표에 `format`을, 기록이 갈래별로 따로인 게임은 `variants`를 둔다. 뒤의 게임은 표에 한 줄, 카드 그림 표(`MiniListPage`)에 한 줄을 더하면 나타난다. 기록이 없으면 「아직 기록이 없어요」. 갈래가 있는 게임은 갈래 순서대로 처음 있는 기록을 보이고 첫 갈래가 아니면 갈래 이름을 붙인다(`miniRecord.cardRecord`).
- **공용 흐름(`features/mini/useMiniFlow`):** `intro`(시작 전 안내) → `countdown`(3·2·1, 숫자마다 1초) → `playing` → `closing`(마무리) → `result`. 제한 시간(`playMs`)을 넘긴 게임은 그 시간이 지나면, 넘기지 않은 게임은 화면이 `finish()`를 부르면 마무리로 간다. 마무리 시간(`closingMs`)은 게임이 넘긴다. [다시 하기]는 목록을 거치지 않고 카운트다운으로, [그만하기]는 어느 단계에서든 안내로 돌리고 그 판을 버린다. `startedAt`은 플레이로 넘어온 순간의 `performance.now()`라 타격 시각과 바로 견준다. 전이표는 순수 함수 `domain/miniFlow.nextPhase`.
- **「누구보다 빠르게」(`SpeedGamePage`):** 10초(`SPEED_DURATION_MS`) 동안 **스네어를 친 횟수**를 센다. 다른 패드·페달·패드를 판정하지 못한 타격은 소리만 나고 세지 않는다. 타이머는 카운트다운이 끝난 순간부터 흐르고, 플레이가 시작되면 「시작!」을 0.6초(`GO_SHOW_MS`), 끝나면 「끝!」을 보인다.
  - 집계는 단계가 아니라 **시각**으로 가린다(`domain/speedRound.acceptsHit`): 타격의 집계 시각(`domain/hitTime` — 타격 시각 `tHit`과 받은 시각 `tRecv` 중 이른 값)이 시작 시각 이상, 시작 + 10초 미만이면 센다. 카운트다운 중이나 끝난 뒤에 친 타격은 여기서 걸러진다. 제한 시간이 끝난 뒤 250ms(`LATE_GRACE_MS`, 마무리 단계) 동안 늦게 도착한 타격을 더 받는다. 같은 타격은 `id`로 한 번만 센다.
  - 화면: 남은 시간(막대는 10초짜리 CSS 전환 하나, 숫자와 「지금 속도」는 0.1초마다) · 큰 타수 · 지금 속도(최근 1초 타수) · 초별 막대 · 최고 기록. 모션 줄이기면 타수 숫자의 튀는 모션을 뺀다.
  - 입력·소리: 스틱이 전제이고 화면을 눌러 치는 자리는 없다. 키보드 드럼 스위치(`useKeyboardDrum`)는 카운트다운·플레이 단계에서만 켜서 안내·결과에서는 Space·Enter로 버튼을 누를 수 있다. 화면에 있는 동안 공용 타격음(`setSoundOnHit`)을 켜고 화면이 따로 소리를 내지 않는다. 스틱이 연결돼 있지 않으면 안내에 「스틱이 연결돼 있지 않아요」와 [드럼 세팅]을 보이되 시작은 막지 않는다.
  - 결과: 제목 두 줄은 `speedRound.speedResultTitle`(첫 기록·갱신·동점·못 미침·0타 다섯 경우), 칸은 초당 평균·가장 빨랐던 1초·최고 기록, 아래에 1초마다 친 횟수 막대. 0타면 기록을 남기지 않는다.
- **「강약중강약」(`DynamicsGamePage`):** 한 판은 **두 단계**다(410, 설계 `.claude/plans/MODE-006-minigame-dynamics-match.md`). 1단계 「감 잡기」는 약 → 중 → 강을 한 번씩 쳐서 내 세기를 잰다(점수 없음). 세 번째를 받으면 2.5초(`FEEL_REVIEW_MS`) 동안 「내 세기」를 보인 뒤 2단계 「숫자 맞추기」가 저절로 시작되고, 화면이 띄운 **숫자 목표 3개**에 맞춰 친다. 세기는 스틱이 내는 1~127 눈금이다. **제한 시간이 없고** 2단계의 3타째를 받으면 화면이 `finish()`를 불러 1.2초(`DYNAMICS_CLOSING_MS`) 뒤 결과로 간다. [다시 하기]는 언제나 감 잡기부터다(앞 판의 내 세기를 들고 있지 않는다).
  - 숫자 목표(`feelRange`·`makeMatchTargets`): 내 세기의 가장 약한 값과 가장 센 값 사이에서 뽑는다(약·중·강 이름이 아니라 값으로 본다). 범위는 20~120(`MATCH_FLOOR`·`MATCH_CEIL`)으로 자르고, 폭이 45(`MATCH_MIN_SPAN`)보다 좁으면 가운데를 지키며 넓힌다. 범위를 셋으로 나눠 구간마다 가운데 60%(`MATCH_ZONE_INNER`)에서 정수 하나를 뽑고 순서를 섞는다. 예: 내 세기 42·78·109면 47~59, 69~82, 92~104에서 하나씩. 이 값들은 초안이라 스틱 실기 뒤 상수만 고친다.
  - 받는 타격(`domain/velocityShot.acceptsShot`, 세기 게임 공용): **센서 소스로 친 스네어**만. 키보드·화면 터치(세기 고정)·다른 패드·페달·패드를 판정하지 못한 타격은 받지 않는다. 받은 타격 뒤와 플레이가 시작된 직후 300ms(`SHOT_GUARD_MS`)는 다음 타격을 받지 않는다(한 번 친 것이 두 타로 들어가는 것을 막는다). 그 판에 받은 타격을 받은 순서대로 담아 두고 `collectFeel`(플레이 시작 시각 기준)과 `collectMatch`(2단계 시작 시각 기준)가 시각으로 가리므로, 카운트다운 중 타격과 두 단계 사이 2.5초 동안의 타격은 빠진다. 센서로 다른 패드를 치면 지금 차례 눈금에 「스네어를 쳐 주세요」가 1.5초 보인다.
  - 기록: **2단계 세 타의 차이(절댓값) 합**이고 **낮을수록 좋다**(`matchScore`, 목록 표의 `better: lower`). 화면에는 「오차 14」로 보인다(`formatDynamicsScore`, 목록 표의 단위는 비워 둔다). 결과 한 줄 평은 차이가 가장 큰 타의 차례와 방향을 말하고 차이 12(`NEAR_DIFF`) 이하면 「조금」, 넘으면 「많이」다. 기록의 `detail`은 내 세기 세 값(`feel`)과 2단계 세 타(`shots`: 목표·실제)다. 단계별 100점이던 예전 모양의 기록은 검증에서 걸러져 기록 없음이 된다.
  - 화면: 눈금 카드 3장(`VelocityGauge`: 친 것·지금 칠 차례·다음). 1단계는 「약」·「중」·「강」 눈금에 친 값만 보인다. 2단계는 위에 「내 세기 약 42 · 중 78 · 강 109」 줄(`FeelStrip`)이 남고, 눈금마다 목표 숫자와 목표 선, 내 약·중·강 자리의 작은 표시가 있으며 머리에 지금 차례의 숫자가 크게 뜬다(「88에 맞춰 한 번.」). 친 뒤에는 실제 값·목표·차이 문구가 나온다. 결과는 오차 합과 한 줄 평(`roundRemark`), 내 세기 줄, 타격별 행(목표 선·내 타격·실제 값·「목표 88 · 6 약함」·「오차 6」)이고 차이가 가장 큰 행을 주의 색으로 보인다.
  - 입력·소리: 세기를 재는 입력이 준비되지 않았으면(`velocityShot.canStartVelocityGame` — 키보드 전용, 또는 연결이 필요한 센서인데 양손 다 미연결) **[시작하기]를 끄고** 안내와 [드럼 세팅]을 보인다. 포인터 모의 스틱은 받는다(세기 100·127 두 값, 개발용). 키보드 드럼 스위치는 켜지 않아 어느 단계에서든 Space·Enter로 버튼을 누른다. 공용 타격음은 켠다.
  - 기록: 판 점수(높을수록 좋음), `detail.shots`에 세 타의 단계·목표·실제 세기. 세 타를 다 친 판만 남긴다. 목표 구간·띠 폭·보호 시간은 스틱 실기 뒤 상수만 고친다.
- **「악보 보고 빨리 치기」(`SightGamePage`):** 한 판은 **10문제**다. 무작위 간격(1.0~2.5초) 뒤 오선에 음표 하나가 뜨고(`components/lesson/PadNotation.SoloStaff`, 자리와 머리 모양은 악보 화면·학습 코스와 같다), 맞는 패드를 칠 때까지 걸린 시간을 잰다. 기록은 **평균 반응 시간**(10ms 단위로 반올림한 ms, 낮을수록 좋다. 화면에는 초 소수 둘째 자리)이다.
  - 출제(`domain/sightRound.makeProblems`): 스틱으로 치는 7종과 킥. 출제 패드가 모두 한 번 이상 나오고 두 번을 넘지 않으며 같은 패드가 연달아 나오지 않는다. 킥은 킥 페달을 쓸 수 있을 때만 낸다(`canAskKick` — 키보드 전용이거나 동글에 킥 페달이 연결됨). 못 내면 안내에 「킥은 빼고 낼게요」가 보인다. 출제 패드는 시작할 때 정하고 그 판 동안 바꾸지 않는다.
  - 문제 진행은 순수 상태 기계(`domain/sightPlay.stepSight`)가 맡는다: 대기(`wait`) → 제시(`shown`) → 확인(`hold`, 0.8초). 화면은 타이머·프레임·타격을 사건으로 바꿔 넘긴다. 반응 시간은 **음표를 그린 뒤 첫 프레임의 시각**(`painted`)부터 타격 시각(`domain/hitTime`)까지다. 박자 맞추기 보정은 거치지 않는다.
  - 타격 가리기(`judgeHit`): 틀린 패드는 0.5초를 더하고 문제가 이어진다. 음표가 뜨기 전과 뜬 뒤 0.1초 안의 타격은 무효 — 그 문제를 기록에 넣지 않고 지금 문제와 남은 문제를 다시 섞어(`reshuffleRest`, 방금 보인 음표가 그대로 다시 나오지 않게) 새 간격 뒤에 낸다. 패드를 판정하지 못한 타격은 세지 않는다. 한 문제는 5초까지이고 넘으면 시간 초과로 5초를 적는다(벌점을 더한 시간도 5초를 넘지 않는다).
  - 힌트: 안내에서 고른다(`store/sightHintPref`가 마지막 값을 브라우저에 기억, 처음 값은 켬). 켜면 음표가 떠 있는 동안 패드 이름과 드럼 그림 강조가 보이고, 끄면 음표만 보인다(오선의 낭독 이름도 「음표」). 맞히거나 시간이 다 된 뒤에는 어느 쪽이든 패드 이름을 알려 준다. 판이 도는 동안은 바꿀 수 없다. **기록은 힌트 켬·끔 따로**(갈래 `hint-on`·`hint-off`)이고 목록 카드는 힌트 끔 기록을, 없으면 힌트 켬 기록을 「힌트 켬」 꼬리말과 함께 보인다.
  - 화면: 진행 점 10개(맞힘·틀림 있음·지금·남음), 문제 판(한 줄 문구·오선·이번 문제 시간 — 음표가 떠 있으면 흐르고 틀리면 0.5초가 더해진다. 모션 줄이기면 흐르는 숫자를 뺀다), 옆 칸(지금까지 평균·틀림), 드럼 그림(눌러서 칠 수 없다). 결과는 평균과 한 줄 평(`sightResultTitle`), 문제별 막대(틀려서 더해진 시간은 빨간색, `barParts`)다. 한 문제도 못 맞힌 판은 기록을 남기지 않는다.
  - 입력·소리: 405와 같다(키보드 드럼 스위치는 카운트다운·플레이에서만, 공용 타격음 켬, 스틱이 없어도 시작은 막지 않는다).
- **「인간 메트로놈」(`TempoGamePage`):** 빠르기(80~120 BPM의 4 단위 11가지 가운데 무작위, 직전 판과 같은 값은 고르지 않는다)가 제시되고 **예비 박 8개**(첫 박·다섯째 박은 강세)가 울린 뒤 소리와 화면의 박 표시가 꺼진다. 그 뒤 같은 빠르기로 **16타**를 치면 끝나고, 기록은 **평균 오차**(ms, 낮을수록 좋다)다. 빠르기를 가르지 않고 기록은 하나이며 그 판의 빠르기를 `detail.bpm`에 같이 남긴다.
  - 예비 박은 화면이 직접 예약한다(`features/mini/tempoCountIn.startCountIn`). 전역 메트로놈을 켜지 않으므로 사용자의 메트로놈 빠르기·박 분할 설정이 바뀌지 않는다. 예약 방식은 전역 메트로놈과 같다(25ms마다 100ms 앞까지 `audioEngine.click`). 박마다 화면의 박 점이 켜지고, 마지막 박에서 반 박 뒤에 측정으로 넘어간다. 첫 박을 예약하지 못하면(오디오가 꺼져 있음) 그 판을 버리고 안내에 알린다.
  - 정답 시각의 기준은 **첫 타격**이다(`domain/tempoRound.placeHit`). 첫 타는 오차 0이고 평균에 넣지 않는다(2~16번째 15타의 절대 오차 평균). 그 뒤 타격은 **가장 가까운 박**과 짝짓되 앞 타의 박보다 뒤여야 한다 — 박을 건너뛰거나 센서가 타격을 놓쳐도 뒤 타격의 오차가 한 박씩 밀리지 않는다. 타격끼리만 견주므로 소리 지연·입력 지연이 서로 지워져 박자 맞추기 보정을 쓰지 않는다.
  - 세는 타격(`acceptsHit`): 패드가 판정된 타격이면 어느 패드든(킥·하이햇 페달 포함). 측정 시작(마지막 예비 박 + 반 박) 전의 타격, 패드를 판정하지 못한 타격, 앞에서 센 타격 뒤 박 간격의 40% 안에 온 타격은 세지 않는다. 플레이 단계에 받은 타격을 받은 순서대로 담아 두고 `collectTempoHits`가 시각으로 가린다. 측정 중 5초 동안 센 타격이 없으면 판을 끝내고 기록을 남기지 않는다.
  - 측정 중에는 박을 알려 주는 것을 모두 끈다: 클릭 소리, 화면의 박 점, 빠르기 숫자의 박 모션. 친 횟수 점만 채워지고 오차는 끝나고 보인다. 이 화면이 열릴 때 울리던 전역 메트로놈은 멈추고, `components/shell/dock/metronomeRoute`가 이 경로에서도 Dock 메트로놈 조작을 막는다(미니게임 화면은 지금 Dock을 켜지 않아 이 판정은 Dock을 켤 때를 위한 것이다).
  - 결과: 평균 오차와 한 줄 평(`tempoResultTitle`), 칸 셋 — 가장 벗어난 타, 끝날 때 빠르기(마지막 네 간격, 소수 한 자리), 흐름(마지막 4타의 평균 오차가 −10ms 이하면 빨라짐, +10ms 이상이면 느려짐, 그 사이면 고름) — 과 타격마다 벗어난 정도 그림(`ErrorChart`, 가운데 「정박 ±10ms」 띠). 16타를 채우지 못한 판은 머리만 보인다.
  - 박자 오차 공용 계산(`domain/timingError`)은 정답 시각을 정하는 방법과 떨어져 있어 409가 그대로 쓴다.
- **「어디까지 올라가는 거예요?」(`CrescendoGamePage`, 게임 id `crescendo`):** 약하게 시작해서 **칠 때마다 앞 타격보다 세게** 쳐야 이어진다. 첫 타는 아무 세기나 받고, 그 뒤는 직전 계단보다 1(`CRESCENDO_MIN_STEP`) 이상 세야 한다. **같거나 약하면 그 판이 끝나고**, 127을 치면 그 타격까지 세고 끝난다(꼭대기). 제한 시간은 없고, 끝나면 1.5초(`CRESCENDO_CLOSING_MS`) 뒤 결과로 간다.
  - 기록: **이어 간 횟수**(계단 수, 끝낸 타격은 세지 않는다)이고 높을수록 좋다. `detail`은 계단의 세기 목록(`steps`)과 끝낸 타격의 세기(`last`, 꼭대기에 닿아 끝났으면 null)이며, 점수가 계단 수와 같은지까지 읽을 때 확인한다(`isCrescendoRecord`).
  - 판정(`domain/crescendoRound.collectRun`): 받은 타격을 받은 순서대로 보며 세기 게임 공용 규칙(`velocityShot.collectVelocities`: 센서로 친 스네어만, 받은 타격 뒤 300ms 보호)으로 가린 뒤 계단을 쌓는다(`buildRun`). 다른 패드·패드를 판정하지 못한 타격(세게 친 뒤 튀어 오른 약한 타격)·보호 시간 안의 타격은 받지 않으므로 **판을 끝내지도 않는다.**
  - 화면: 가운데 세로 눈금(`StepLadder`)에 받은 계단마다 가로선이 쌓이고 직전 계단 아래가 어둡게 칠해진다. 머리에 「42보다 세게.」(직전 계단의 숫자를 크게), 양옆에 지금까지 횟수와 방금 친 세기. 끝나면 끝낸 타격을 주의 색으로 보이고 「42보다 세지 못했어요.」 또는 「꼭대기까지 올랐어요.」. 결과는 「9번.」과 한 줄 평(`runRemark`: 꼭대기·같았음·얼마나 약했는지, 첫 타가 64 이상이면 더 약하게 시작하라는 말), 시작·끝 세기와 평균 간격, 계단별 막대다.
  - 입력·소리는 「강약중강약」과 같다(세기를 재는 입력이 없으면 [시작하기]를 끄고, 키보드 드럼 스위치는 켜지 않고, 공용 타격음은 켠다).
- **「정적 뒤 한 방」(`OneShotGamePage`, 이벤트용):** 노래가 흐르다 끊기고, 정적 뒤 드럼이 돌아올 자리에 **한 타**를 맞힌다. 허용 범위는 **±80ms**(`SHOT_TOLERANCE_MS`)이고 안에 치면 그 순간 드럼과 후렴이 이어 나온다. 기록은 곡별(갈래 = 곡 id)이고 **성공한 판만** 남긴다(값은 오차의 절댓값 ms, 빠름·늦음을 `detail.errorMs`에 같이 둔다).
  - **이벤트 스위치:** 빌드 값 `VITE_MINI_ONESHOT_AUDIO`에 음원 폴더 주소를 주면 켜진다(`config/miniOneShot`: `ONE_SHOT_AUDIO_BASE`·`ONE_SHOT_ENABLED`). 켜기와 음원 위치를 한 값으로 둔다. 비어 있으면 목록에 카드가 없고(`MiniListPage`가 거른다), `/play/mini/oneshot` 경로와 화면 청크가 빌드에 들어가지 않는다(`app/App.tsx`가 스틱 모니터처럼 빌드 값을 직접 읽어 동적 import를 감싼다. `routeModules`에는 넣지 않는다). 지금 배포 빌드(`FE/Dockerfile`)는 이 값을 받지 않으므로 운영 화면에는 나타나지 않는다.
  - **음원(저장소에 없다):** 곡은 「I Will Always Love You」(Whitney Houston, 1992, 음반 《The Bodyguard》)의 마지막 후렴 직전 구간이다. **권리자의 사용 허락을 받지 않은 원곡 음원이라 저장소와 기본 배포물에 넣지 않고 이벤트 환경에서만 켠다.** 준비: 정적 약 10초 전부터 드럼 한 방 뒤 후렴 약 8초까지 20초 남짓을 WAV(16비트, 44.1 또는 48kHz. FLAC도 된다. MP3·AAC는 앞머리 무음 때문에 위치가 어긋나 쓰지 않는다)로 잘라 `iwaly.wav`로 저장하고, 로컬에서는 `FE/public/event-audio/`(`.gitignore`에 있음)에 둔 뒤 `VITE_MINI_ONESHOT_AUDIO=/event-audio`로 띄운다. Git Bash에서는 `/`로 시작하는 값이 경로로 바뀌므로 `.env.local`에 적거나 PowerShell에서 띄운다.
  - **곡 표(`domain/oneShotSongs`):** 곡마다 파일 이름·전체 길이·정적 시작·정답 위치·뒷부분 길이를 둔다. **지금 값은 음원 파일을 받기 전의 임시 값이다** — 파일을 받으면 파형에서 드럼이 솟는 지점(정답 위치)과 노래가 끊기는 지점을 재서 바꾼다. 받은 음원의 길이가 곡 표와 50ms 넘게 다르면 시작을 막는다(`clipMatches`). 곡을 더하려면 파일을 마련하고 표에 한 줄을 더한다. 곡이 둘 이상이면 안내에 곡 고르기와 결과에 [다른 곡]이 나타난다.
  - **재생(`features/mini/oneShotAudio`):** 음원은 안내 단계에서 미리 받아 푼다(준비 전에는 [시작하기]가 꺼지고, 받지 못하면 [다시 시도]). 사용자 제스처 전이라 오디오 컨텍스트가 없을 수 있어 풀기만 하는 `OfflineAudioContext`로 푼다. 음원을 정답 위치에서 둘로 나눠, 앞부분은 플레이 시작 0.4초 뒤의 오디오 시각에 예약하고 정답 직전에 끊으며, 뒷부분(드럼 한 방과 후렴)은 성공한 타격을 받은 순간 바로 튼다. 소리는 반주 버스로 낸다(반주 음량을 따른다).
  - **판정(`domain/oneShotRound.judgeShot`):** 노래가 시작된 뒤 처음 받은, 패드가 판정된 타격 하나로 끝난다. 타격 시각(`hitTime`)에서 박자 맞추기 값(발 타격은 킥 값)을 빼고 정답 시각과 견준다. 정적 전에 치면 「정적 전에 침」, 범위 밖이면 오차와 함께 실패, 정답 뒤 1초까지 없으면 「치지 않음」이다. 판정과 뒷부분 재생은 화면 갱신을 기다리지 않고 타격을 받은 자리에서 한다. 탭이 가려지거나 오디오가 멈추면 그 판을 버리고 안내로 돌아간다.
  - **화면:** 정적 동안에는 움직이는 것이 없다 — 반주 판의 「지금 위치」 선은 노래가 흐르는 동안만 보이고, 「정적」 선은 곡과 상관없이 오른쪽 끝까지 그어 길이를 알려 주지 않는다. 센서 입력인데 박자 맞추기를 권한 적이 없으면 [시작하기]에서 먼저 권하고(`components/calibration/useTimingCalGate`, 리듬 게임과 같은 조건·막지 않음), 측정 기록이 없는 동안 안내에 [박자 맞추기]를 보인다. Dock 메트로놈 조작은 이 경로에서도 막는다(`metronomeRoute`).
- **최고 기록(`features/mini/store/miniRecordStore`):** 게임마다 하나(갈래가 있는 게임은 갈래마다 하나), 브라우저 `localStorage`에 계정별로 둔다 — 키 `ssaplash.mini.v1.u{userId}`(로그인 계정이 없으면 `ssaplash.mini.v1`), 값 `{ v: 1, records: { [게임 id 또는 게임 id:갈래]: { gameId, variant?, score, at, detail } } }`. 결과가 확정되고 더 좋은 기록일 때만 쓴다(동점은 갱신이 아니다. 높을수록 좋은지는 목록 표의 `better`). 중간에 나간 판은 남지 않는다. 화면이 열릴 때와 계정이 바뀔 때 다시 읽는다. 깨진 값은 기록 없음으로 보되 한 기록의 `detail`만 깨졌으면 그 기록만 버린다(`miniRecord.parseRecords`, 게임 id별 검증 표). 저장하지 못해도 예외를 삼키고 결과 화면은 그대로 보인다. 입력 수단을 가르지 않는다.
- **뒤의 게임이 더할 곳:** `MiniGameId`(`domain/play/miniGame`), 목록 표 한 줄(`miniCatalog`), `detail` 모양과 검증 한 줄(`miniRecord`), 카드 그림 한 줄(`MiniListPage`), 화면과 라우트(`app/routeModules`·`app/App.tsx`).

```powershell
npx vitest run src/domain/play/miniGame.test.ts src/features/mini src/components/shell/nav/Sidebar.test.tsx src/features/play/components/picker/SongPicker.interaction.test.tsx
```

## 추천 화면과 학습 동의 공개 조건

- 곡 선택은 기본 곡 탭이 처음 보일 때 추천을 요청하며, 비슷한 곡은 서버가 고른 난이도와 채보로 이동한다. 리포트의 `songId`, `chartId`, `difficulty`는 선택 필드이며 서버가 곡 ID를 주지 않으면 비슷한 곡을 요청하지 않는다. 서버 필드와 SHEET 추천 필터 변경은 BE `feat/COACH-recommend-sheet-report`에 구현됐으며 develop-BE 병합과 배포를 기다린다.
- `VITE_RECOMMENDATION_CONSENT_ENABLED=true`일 때만 신규 추천 학습 동의를 수집한다. 기본값은 비활성이며, 확정된 문구와 BE 허용 판을 배포하기 전에는 켜지 않는다. 비활성일 때 가입 요청은 추천 동의 필드를 생략한다. 기존 동의 조회·철회는 유지한다.
- 철회도 현재 설정된 동의 판으로 PUT한다. 해당 판이 BE 허용 목록에 없으면 서버가 422를 반환하고 기존 동의 상태를 유지한다. 허용 판 배포는 FE만으로 보장할 수 없다.
