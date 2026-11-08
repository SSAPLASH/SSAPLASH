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
```

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

- 행동을 먼저 말한다: 제목은 구령("조금 일찍!"), 이유·방법은 보조 줄. 지적 구령은 8자, 칭찬·세팅 13자, 보조 16자 이내.
- 말투는 "~해요" 존댓말. 점수·정확도 언급, "틀렸어요/못" 단정, 영어는 쓰지 않는다(`copy.test.ts`가 길이·금지어를 검사한다).
- 바쁠 땐 구령만: 리듬 게임은 직후 1초에 노트가 4개 이상이면 최대 1.5초 미루고, 그래도 바쁘면 보조 없이 띄운다(`components/play/coachDisplay.ts`). 악보 연습은 미루지 않고 항상 보조까지 보인다.
- 가리키며 말한다: 패드 대상이면 키트의 그 패드에 링(`DrumKit`의 `coachPad`), 손 대상이면 킷 왼쪽 아래에 왼손/오른손 칩. 문구와 함께 사라진다.
- 칭찬은 근거가 있을 때만: 해소 칭찬은 무엇이 고쳐졌는지 보조로 말하고(`CoachMessage.recoveredFrom`), 일반 칭찬(`LIVE_GOOD_KEEP`)은 직전 문구 후 20초·최근 12판정 놓침 0일 때만 뜬다(`config.ts`의 `praise.keepMinGapMs`).

## 폴더 구조

```
src/
├─ main.tsx     Vite 엔트리. app/bootstrap·app/presetBootstrap·app/authBootstrap을 부르고 렌더
├─ app/        앱 조립 — 아래 전부를 알아도 되는 유일한 곳
│   ├─ App.tsx       라우터. /login·/auth/callback 밖의 화면은 RequireAuth 아래. `/`→`/free`, `/me`→`/settings`, `/calibration`→`/setup` 이동. 새 화면 `/settings`·`/history`. 관리자 전용 `/admin/songs`는 RequireAdmin 아래(Jira 262). 악보 뷰어 `/studio/sheets/:id`는 지연 로드(278)
│   ├─ sources.ts         키보드 소스 · inputManager 단일 인스턴스
│   ├─ features.ts        빌드 기능 스위치(SONG_EDIT_ENABLED·RECORDING_ENABLED·SHEET_ARCHIVE_ENABLED·SHEET_SONG_LINK_ENABLED)
│   ├─ sensorRegistry.ts  센서 소스 디스크립터 등록·조회, 인스턴스 지연 생성
│   ├─ sensors.ts         센서 소스 등록 한 줄씩 (새 소스는 여기에 추가)
│   ├─ bootstrap.ts       설정 ↔ 소스 ↔ 스토어 ↔ 오디오 접착, 표면 연결(bindSensorSurface), 오디오 언락
│   ├─ authBootstrap.ts   앱 시작 시 로그인 복원, 토큰 소실 → authStore 연결, AUTH_REQUIRED 상수
│   ├─ dataConsent.ts     플레이 시작 시점 동의 읽기(서버 dataConsent 기준)
│   ├─ signupGate.ts      403 SIGNUP_INCOMPLETE 알림 → /me 재조회 연결(bindSignupIncomplete)
│   ├─ presetBootstrap.ts 로그인 상태(authStore) → 프리셋 저장소(서버/로컬) 전환, 목록 읽기, 기본 프리셋 적용
│   ├─ playSync.ts        플레이 로그 서버 업로드·상태·재전송, 리포트 미리 받기·재조회(refreshReport)·프리패치 구독(usePrefetchedReport)·조회 오류 분류
│   └─ analysisPoller.ts  PENDING 리포트 재조회 타이머(React 무관, 2초 × 5회)
├─ pages/      라우트 단위 화면 — Setup · Play · FreePlay · Result · Report(상세 분석) · Studio(곡 작업실) · Settings(설정) · History(연주 기록) · Login · Signup(가입 동의) · AdminSongs(공용 곡 관리, 관리자 전용 — 공용 곡 추가·반주 올리기, Jira 262) · AuthCallback (`HomePage`·`MyPage` 삭제 — `/me`는 `/settings`로 이동)
├─ components/ 공용 UI — AppShell · RequireAuth · RequireAdmin(ADMIN 아니면 /free, 표시만 — 권한은 BE) · SensorOptionsPanel · KitCanvas · NoteHighway · DebugOverlay · PublicLayout · ProfileMenu · SongPicker(곡 선택) · useChartParam(URL 곡 선택 훅) · SheetPager(마디 고정 5선 악보 Canvas) · kitPadPaint(킷 패드 그리기 공용) · sheetStripDraw(그리기 순수 함수) · SheetSnippet(결과 페이지 약점 마디 미니 악보) · PauseOverlay(일시정지, 포커스는 `ui/useDialogFocus`) · usePauseTriggers(끊김·메뉴 자동 일시정지 훅) · ReportEntry(결과 → 상세 분석 진입부) · studio/(AudioDropzone·MidiUploadForm·UploadPanel·UploadDialog·ActiveJobCard·HowtoPanel·SongStatusBadge·StudioIcons·MySongRow·MySongCard·MySongList·SongMenu·EditDialog·SongCoverDialog·SongMetaDialog·SongDeleteDialog·StudioToast·dateLabel·studio.css, 라이브러리 화면) · settings/(SettingRow · DataConsentCard, 설정 화면) · result/(ResultSummaryCard·JudgeBars·TimingHistogram·FeedbackCard·PadSummaryTable, 결과 화면 전용) · history/(HistoryTable·PlayLogTab, 연주 기록 화면 전용) · admin/(AdminSongTable·AdminSongAddDialog·AdminBulkDialog(CSV 일괄 추가·양식 받기)·admin.css, 공용 곡 관리 화면 전용) · recording/(RecordButton·SaveRecordingDialog·RecordingToast·RecordingList·RecordingTitleDialog·RecordingDeleteDialog·useRecordingList·useRecordingPlayback, 녹음 UI)
│   ├─ ui/           도메인을 모르는 기본 부품(Figma 01 Design System과 같은 이름) — Button(`buttonStyle`의 `buttonClassName`으로 링크에도 같은 모양) · IconButton · Card · Chip(필터) · StatusPill(상태 표시) · EmptyState · Toggle · Checkbox(네이티브 input + label) · Segmented · Slider · Input · Dialog(배경·포커스 순환·Esc, `useDialogFocus`·`focusCycle`) · Menu(바깥 클릭·Esc 팝오버) · Toast · table.css(`.ui-table`)
│   ├─ auth/         로그인·가입 동의 — AuthBrandPane(왼쪽 브랜드 영역) · ProviderIcons(Google 공식 4색 고정·SSAFY 자리표시) · TermsItem(약관 한 항목, 96 높이 스크롤 상자) · SignupConsentCard(가입 동의 카드, 동의 상태 보관·`initialAgreed`로 선택 항목 미리 켜기) · auth.css
│   ├─ song/         곡 표시 공통 — SongCover · LevelBadge(연습 단계 EASY·NORM·HARD 배지) · SongMeta(아티스트·BPM·길이 한 줄) · DeletedSongChip(삭제된 곡 칩) · useDeletedSongIds(삭제된 BE 곡 id 집합 훅)
│   ├─ stick/        스틱 연결 표시 — DisconnectNotice(연주 중 끊김 카드, 동글 소스면 P 점 추가, [다시 연결]은 `store/reconnectStore`) · ConnectionDots(L·R 연결 점 72×32, 설정 기기 행)
│   ├─ report/       상세 분석 섹션 — ReportSummary · PadAccuracyChart · TimingHistogram · NoteTimeline · CoachSummaryCard(총평) · WeakSegments(AI 약점 구간·상태 안내) · SegmentPlaybackPanel(구간 재생 UI) · useSegmentPlayer(구간 재생 상태)
│   ├─ shell/        앱 셸 — Sidebar · TopBar · GlassDock · useShell(페이지가 제목·전체 화면 선언) · useMediaQuery(`useSidebarCollapsed`) · defaultTitles(라우트별 기본 제목) · SoundToggle · MetronomePanel(Dock 메트로놈 패널) · StickStatusIndicator · ProfileMenu · PublicLayout · WithdrawDialog(회원 탈퇴 확인). 옛 `Metronome.tsx`(칩·팝오버)는 삭제 — 메트로놈 조작은 GlassDock이 맡는다
│   ├─ drum/         드럼 킷 그리기 — Pad · padRing(링 기하) · DrumKit(코칭 대상 패드 링 `coachPad`) · usePadStates · padStateMachine · drum.css
│   ├─ free/         자유 연습 전용 — AccompanimentBar(반주 바 5변이) · SeekBar(진행 막대) · AccompanimentPicker(반주 선택 창) · useFreeAccompaniment(반주 재생 훅) · useAccompanimentSongs(선택 창 목록 훅) · DisconnectBand(한 손·페달 끊김 띠) · free.css
│   └─ play/         연주 흐름 공용(리듬 게임·악보 연습) — SongTable·SongDetailPane(곡 선택 표·상세) · ReadyPanel(연주 준비) · PlayStage(연주 화면 골격) · PlayHud(HUD game/sheet) · Countdown(카운트인 숫자) · GuideSlot(안내·코칭 칸, 구령+보조 두 줄) · CoachHandChip(코칭 손 대상 칩) · coachDisplay(밀집 구간 유예·구령만 판단) · useCoachLine·coachLineTimer(코칭 문구 3초 표시, 유예 지원) · HitReadout(최근 타격 표시, stack/row) · 컴포넌트별 CSS
├─ store/      zustand — settingsStore(영속) · liveStore(실시간) · shellStore(셸 제목·전체 화면·Dock 패널, 영속 안 함) · presetStore · localPresetSource · authStore(로그인 상태, 영속 안 함) · recommendationConsentStore(맞춤 곡 추천 학습 동의 상태, 서버 원본·영속 안 함) · songStore(곡 목록·상세·`loadChart`) · chartJobStore(음원 업로드·채보 생성 작업 폴링, 활성 작업 1개 영속) · songEditStore(곡 정보·커버·삭제 1회 실행) · adminSongStore(관리자 공용 곡 목록·등록·행별 반주 업로드) · adminBulkStore(CSV 일괄 추가 순차 실행·줄별 결과) · reconnectStore(스틱 재연결 상태 기계 idle·trying(n/3)·failed·reconnected와 자동·수동 액션, 실제 동작은 `app/bootstrap`이 끼운다)
├─ api/        BE 호출 — http(공통 래퍼·ApiError) · auth(access 토큰·refresh·logout) · users(me·signup-consent·recommendation-consent) · songs·charts(곡·채보 조회, BE 96) · presets(프리셋 CRUD, BE 90 — PresetSource 서버 구현) · plays(플레이 로그 요약 업로드, BE 98) · reports(리포트 조회·화면 타입 변환, BE 157) · adminSongs(관리자 공용 곡 목록·MIDI 등록·반주 업로드, BE 156·262)
├─ input/      입력 소스와 매퍼 (인스턴스는 만들지 않는다 → app/sensorRegistry · app/sources)
│   ├─ InputSource         공통 인터페이스 · ClockSync
│   ├─ deviceState         기기별 상태(role 0~3 네 칸: 시계·SYNC 대기·연결·배터리/설정 전 보류). 이벤트는 손(0·1)은 status·hit·pose, 발(2·3)은 pedalStatus·hit(foot)·pedal
│   ├─ SourceDescriptor    입력 소스 디스크립터 타입 (id·라벨·설정 항목·동작 버튼 선언)
│   ├─ KeyboardPadSource   키 코드 타격 (항상 켜짐)
│   ├─ PointerStickSource  마우스 위치 → 자세, 키/클릭 → 타격 (모의 IMU) + 디스크립터
│   ├─ BleStickSource      Web Bluetooth GATT + 디스크립터
│   ├─ WebSocketStickSource  허브 · PC 브리지 + 디스크립터
│   ├─ WebSerialStickSource  USB 직결·동글(Web Serial) + 디스크립터. LINK 네 비트(손 2 + 발 2)·STATUS 비트 5 처리, 페달(role 2·3) 수신, reopen, 재장착(connect 이벤트) 자동 재열기
│   ├─ serialFraming       직결 프레이밍(SOF·LEN·CRC8) 인코더·디코더
│   ├─ stickProtocol       BLE/WS 공용 바이너리 패킷(v0.8.1: PEDAL 0x08, role 2·3 해석)
│   ├─ padMapper           키 매퍼(keyMap) · 자세 매퍼(손별 앵커에서 유도한 판정 프로필)
│   └─ InputManager        소스 합성 → 매퍼 → ResolvedHit 발행
├─ engine/     HitCapture(2타 보정) · SnareRealign(스네어 재정렬) · RhythmSession(일시정지 포함) · playLog · playRecorder(타격·MISS 처리 순번) · telemetry
├─ coach/      실시간 코칭(COACH-001) 규칙 모듈 — live/(config · window · rules · policy · LiveCoach · copy(화면 문구 표)). 순수 TypeScript, domain만 import
├─ media/      coverImage(이미지 → 가운데 정사각형 512 JPEG, 캔버스) · downloadFile(Blob 내려받기)
├─ audio/      AudioEngine · soundSets(사운드 세트) · kitConfig(kit-config.json 스키마)
├─ domain/     순수 타입·함수. React·브라우저 API 의존 없음 (단위 테스트 대상)
│   pads · kitLayout · drumKit(연주 화면 킷 고정 배치·상태 상수) · preset · events · keyMap · calibration · kitMapping · chart · songCatalog(곡 타입·난이도 정렬) · songCover(커버 파일 검사·정사각형 자르기 계산·커버 오류 재조회 간격) · songEdit(곡 정보 검증·바뀐 필드·오류 문구·상태별 ⋯ 메뉴) · songAvailability(연주 기록의 곡 삭제 판정) · playLogView(날짜·모드 표기·기록 모드 필터·페이지 계산) · timingHistogram(결과 타이밍 분포·평균 Δ) · bestRecord(내장 개발 소스 로컬 최고 기록) · serverBestRecord(서버 최고 기록 → 모드별 곡·채보 최고값) · highwayLanes(하이웨이 9레인 순서, 하이햇 페달 맨 왼쪽) · chartMapping(BE 채보 → Chart) · judgement · hitStats · auth · signupTerms(가입 약관 문구·판·동의 규칙) · signupGate(가입 필요 판단·라우트 결정) · dataConsent(연주 기록 활용 동의 판 일치·이관·업로드 consent 규칙) · playUpload(로그 → 업로드 본문) · report(리포트 화면 타입) · pedalStatus(페달 연결·배터리 표시 문구, 페달 필수 기기 판정) · adminSong(관리자 공용 곡 타입·입력 검사·첫 박 시각·반주 파일 검사·오류 문구) · adminBulk(CSV 파싱·인코딩 판별·양식·파일 짝 맞추기·줄별 판정)
└─ styles/     tokens.css(디자인 토큰·모션 토큰·폰트·텍스트 유틸) · motion.css(공통 키프레임·역할 클래스) · global.css(전역·셸 레이아웃)

public/
├─ fonts/      Space Grotesk · Bebas Neue 로컬 폰트(OFL 라이선스 파일 동봉)
└─ sounds/     사운드 세트
```

예약 폴더(첫 파일이 생길 때 만든다): `hooks/` 페이지 공유 훅, `assets/` 이미지·샘플.

### 의존 방향

위에서 아래로만 import한다. 같은 줄끼리는 import하지 않는다.

| 층 | 폴더 | import 허용 |
| --- | --- | --- |
| 조립 | `app`, `main.tsx` | 전부 |
| 화면 | `pages` | hooks · components · store · engine · audio · coach · domain · monitor · app(인스턴스·언락) |
| 공용 UI | `components`, `hooks` | store · engine · audio · domain (+ `app/sensorRegistry` 조회만: AppShell · SensorOptionsPanel) |
| 상태 | `store` | domain · api |
| 코어 | `input`, `engine`, `audio`, `api`, `coach` | domain |
| 모니터 | `monitor` | input · domain (판정 경로와 분리. `pages/monitor`만 읽는다) |
| 도메인 | `domain` | 없음 |

- **공용 UI 안의 세분(설계 TECH-MODE-SETUP-figma-ui 2-6):** `components/ui/`는 props만 받고 store·domain·api를 import하지 않는다. 도메인 공유 폴더(`song/`·`drum/`·`play/`·`shell/`)는 domain을 쓰고, 화면 전용 폴더(`setup/`·`studio/`·`report/` 등)는 공유 폴더를 쓰되 반대 방향과 화면 폴더끼리는 import하지 않는다. 두 화면 이상에서 쓰는 부품은 공유 폴더로 올리고, 파일 이름은 Figma 컴포넌트 이름을 따른다. 부품 CSS는 옆 파일(클래스 접두사 = 폴더, 예 `ui-btn`)로 두고 `global.css`에 새 규칙을 추가하지 않는다. 폴더별 `index.ts`는 두지 않는다.
- store 내부: `presetStore` → `settingsStore` 단방향은 허용한다(같은 줄끼리 import 금지의 예외). `localPresetSource`도 `settingsStore`를 읽는다.

- `types/`·`utils/`는 두지 않는다. 타입은 쓰는 도메인 파일 옆에 둔다(`domain/keyMap.ts`, `domain/events.ts`). 전용 타입 폴더는 "어디 있는지 찾기"와 순환 import를 만들고, 범용 유틸은 아직 없다.
- 경로 별칭 `@/` = `src/` (`tsconfig.app.json` · `vite.config.ts` · `vitest.config.ts`에 같이 설정). 다른 폴더는 `@/`, 같은 폴더는 `./`로 가져온다.
- `inputManager`·키보드 소스는 `app/sources.ts`에서, 센서 소스 인스턴스는 `app/sensorRegistry.ts`가 디스크립터의 `create`로 만든다. 화면은 `input/` 클래스를 직접 new 하거나 소스 id 문자열을 비교하지 않고, 레지스트리의 디스크립터(라벨·가용성·설정 항목)를 읽는다.
- BE는 `api/http`의 `apiFetch`로만 부른다. 화면·store는 401을 직접 처리하지 않는다(아래 [로그인](#로그인)). `api/` 안에서 `http`가 `auth`를 쓰고 `auth`는 `fetch`를 직접 쓴다 — 순환 없음. 로그인 시작·복귀 경로 같은 브라우저 동작은 `store/authStore`의 액션으로 두어 화면이 `api/`를 모른다.

## 디자인 토큰

Figma 01 Design System의 변수·텍스트 스타일을 `src/styles/tokens.css`에 옮겼다(`global.css`가 맨 위에서 `@import`한다).

- **새 화면 코드는 새 이름만 쓴다:** `--bg-canvas·base`, `--surface-1..3`, `--line`·`--line-strong`, `--text-1..3`, `--brand`·`--brand-text`·`--brand-on`·`--brand-sub`, `--perfect`·`--good`·`--miss`, `--radius-control·panel·dock`, `--space-xs·s·m·l·xl`, `--font`·`--font-num`·`--font-display`. 손 색은 `--left`(sub)·`--right`(brand).
- **옛 이름**(`--stage`·`--brass`·`--ink`·`--sm-*`·`--surface`·`--radius` 등)의 임시 별칭은 삭제했다. CSS와 Canvas 색 읽기(`readColors`·모니터 `cssVar`) 모두 `tokens.css`의 이름만 쓴다.
- **텍스트 유틸 클래스 7종:** `.t-display-64`(Bebas Neue)·`.t-display-20`(Space Grotesk, 숫자)·`.t-title-24`·`.t-title-20`·`.t-body-16`·`.t-body-14`·`.t-caption-12`(Pretendard).
- **폰트:** Pretendard는 `index.html`의 CDN 링크, Space Grotesk·Bebas Neue는 `public/fonts/`의 로컬 파일(OFL, 라이선스 파일 동봉)을 `tokens.css`의 `@font-face`로 불러온다.
- **모션 토큰·역할 클래스:** 시간·이징은 `tokens.css`의 `--motion-press`(80ms)·`--motion-fast`(120ms)·`--motion-base`(200ms)·`--ease-out`·`--ease-in-out`과, 용도별 별칭 `--motion-move`(이동·확대·회전)·`--motion-fade`(투명도)만 쓰고 규칙에 ms·s·`ease`를 직접 쓰지 않는다. `styles/motion.css`는 키프레임 4종(`motion-fade-in`·`pop-in`·`drop-in`·`rise-in`)과 역할 이름 클래스 `.motion-overlay`(배경 페이드)·`.motion-dialog`(페이드+확대)·`.motion-menu`(페이드+아래로 드롭)·`.motion-toast`(페이드+위로 라이즈)·`.motion-lift`(hover 시 2px 떠오름, hover 가능한 기기만)를 둔다. 화면 코드는 효과가 아니라 역할 클래스만 붙인다. 진입 애니메이션만 있고 퇴장은 없다. 전역 `button`·`.btn-*`·`.sm-btn`은 hover 색(`--motion-fast`)·눌림 `scale(0.98)`(`--motion-press`)·키보드 포커스 외곽선을 공통으로 따른다.
- **모션 줄이기(`prefers-reduced-motion: reduce`):** `tokens.css`가 `--motion-press`·`--motion-fast`·`--motion-move`를 0ms로 다시 정의해 이동·확대·회전은 즉시 적용하고 투명도 페이드(`--motion-fade`)만 남긴다. 새 규칙은 토큰만 쓰면 자동으로 따른다. 토큰으로 끌 수 없는 무한 반복 애니메이션(스피너·단계 점 펄스 등)은 규칙마다 `animation: none`을 둔다. 옛 전역 `* { transition: none !important }`는 없다.

## 앱 셸

`components/AppShell`이 사이드바 + workarea(TopBar + 본문)를 짜고, Dock·StickStatus·아바타는 셸 루트에 `fixed`로 한 인스턴스만 둔다(전체 화면 전환 때 언마운트되지 않는다).

- **Sidebar:** 펼침 240px · 접힘 80px(아이콘만, `title` 툴팁). 실제 접힘 = 설정 `sidebarCollapsed` 또는 태블릿 폭(≤1024px, `useSidebarCollapsed`)이라 ≤1024에서는 강제로 접히고 펼치기 버튼이 없다. 본문 여백은 40, 태블릿은 24. 접을 때는 라벨·로고 글자(`SSAPLASH`↔`S`)가 먼저 사라지고(opacity) 폭이 200ms 줄며, 펼칠 때는 폭이 먼저 늘고 라벨이 뒤따른다(라벨·글자는 항상 렌더하고 `aria-hidden`). 토글 아이콘(`SidebarToggleIcon`)은 하나이고 화살표만 접힘에서 오른쪽을 가리키도록 180° 회전한다. 하단에는 설정만 있고 로그아웃은 프로필 메뉴에 있다. Dock은 `left` 대신 `transform`으로 본문 가운데를 따라간다.
- **TopBar:** 높이 56. 제목은 페이지가 알린 값, 없으면 `defaultTitles`의 라우트별 기본값(예: `/studio` "내 곡", `/setup` "드럼 세팅").
- **라우트 전환:** 본문(`<Outlet/>`)은 `key={pathname}`의 `.route-view.route-fade` 래퍼 안에서 160ms(`--motion-route`) 페이드 인한다(쿼리만 바뀌면 그대로, 나가는 화면 연출 없음). 같은 화면 안 단계 전환도 `StageFade`(`.stage-fade`, 같은 페이드·토큰)로 감싼다 — 리듬 게임·악보 연습의 로딩·곡 선택·준비는 페이드, 준비 → 연주(immersive)는 즉시. 사이드바 현재 위치 표시는 `layoutId="side-active"` `m.span` 하나가 활성 항목으로 200ms ease-out 미끄러진다(motion 기능 도착 전에는 제자리에 바로 보이고, 모션 줄이기에서는 즉시 이동). 연주 화면도 같은 래퍼이고 immersive 전환(사이드바·TopBar 언마운트)은 즉시다. 경로가 바뀐 뒤에는 스크롤을 맨 위로 올리고 포커스를 옮긴다 — 셸 화면은 TopBar 제목 `h1`, immersive 화면은 본문 래퍼(둘 다 `tabIndex={-1}`, 외곽선 없음). 첫 로드에는 옮기지 않는다.
- **GlassDock:** 상단 가운데 글래스 Dock(음량 토글·메트로놈 칩·BPM ±·프리셋 이름). 모드는 `shell`(일반) / `play`(전체 화면 연주, 일시정지 버튼 추가) × 접힘 여부 4변이다. 칩 본체를 누르면 `MetronomePanel`(Dock 아래 오른쪽 360, `shellStore.dockPanel`)이 열린다. 스틱 연결이 필요한 센서인데 한 손이라도 끊기면 프리셋 칩이 「● L ● R 준비 필요」(amber)로 바뀐다(`domain/dockChip`, 키보드 전용·포인터 모의 IMU는 제외).
- **StickStatusIndicator·ProfileMenu:** 오른쪽 위 고정.
- **페이지 선언:** 페이지는 `useShell({ title, immersive })`로 제목과 전체 화면 여부를 알린다. `immersive`면 Sidebar·TopBar가 사라지고 본문이 전폭이 된다. 언마운트하면 자기가 바꾼 필드만 기본값으로 돌아간다. 이 상태는 `store/shellStore`에 있고 영속하지 않는다(현재 `/settings`·`/history`가 사용, 나머지 화면은 아직 기본 제목).
- **영속 설정 키:** `sidebarCollapsed`·`dockCollapsed`. 같은 settings v12에 `liveCoach`(실시간 코칭, 기본 켬)도 추가됐다. v12의 `statsConsent`(브라우저 저장 동의)는 v14에서 삭제했다 — 연주 기록 활용 동의는 가입 때 필수라 서버 값만 쓴다.

## 드럼 컴포넌트

- **`components/drum/DrumKit`:** 연주 화면용 드럼 킷 SVG. 배치는 `domain/drumKit`의 **고정 8패드**(`DRUM_KIT_PADS`, 760×300 × `scale`, 하이햇 페달 제외)다. `fitWidth`면 부모 폭에 맞춰 `scale`까지 줄인다. 패드별 `states`(`idle`·`hit`·`perfect`·`good`·`miss`)와 `badges`(+`highlight`)를 받고 `labels`·`onPadClick`을 쓴다. 세팅 편집기의 `KitCanvas`(사용자 배치를 Canvas로 그리고 드래그)와 역할이 다르다 — 판정 배치(`kitLayout`)와 무관한 표시 전용이다.
- **드럼 모양:** 설정 › 연주의 "드럼 모양"(실물 `acoustic` / 전자 `electronic` / 네온 `neon`)을 `DrumKit`의 `skin`이 받는다. 값은 설정 스토어 `kitSkin`에 기기별로 로컬 저장하고 서버 동기화 대상이 아니다. `hitSeq`는 패드별 타격 모션 재생용이다. `onPadDown`이 있으면 킷이 터치 표면이 되어 `touch-action: none`을 쓰고 포인터 모의 IMU는 이 킷을 무시한다(`data-no-pointer-strike`).
- **타격 이펙트 테마:** 설정 › 연주의 "타격 이펙트"(기본 `auto` / 전기 `electric` / 물 `water` / 불 `fire`)를 설정 스토어 `hitFxTheme`에 기기별로 로컬 저장한다(settings v20). `DrumKit`에 `effects`가 있으면 SVG 위에 캔버스(`components/fx/FxCanvas`)를 겹쳐 그린다. 타격은 liveStore를 직접 구독해 React 렌더 없이 파티클 엔진(`fxEngine`, 동시 200개 상한, 비면 rAF 정지)에 들어간다. 테마 정의·생성 함수·세기 변환은 순수 함수(`domain/hitFx/`)다. 패드 흔들림은 테마와 무관하게 세기 100 이상 드럼·킥에서 동작한다. 잉크 `ink`·픽셀 `pixel`은 랩 전용이다.
- **판정별 이펙트 차등·타이밍 막대:** 리듬 게임·악보 연습에서는 페이지의 `onHit`이 `judgedFxEvent`로 판정(PERFECT·GOOD)·헛침·비판정 이벤트를 만들어 패드·하이웨이(또는 악보) emitter에 보내고, 놓친 노트(MISS)는 `onJudgement`에서 하이웨이·악보로만 보낸다. 패드 이펙트는 판정 배율(PERFECT 크고 하늘색 링, GOOD 작고 초록 링, 헛침은 회색 퍼짐)을, 하이웨이는 판정선 흡수 폭발과 놓친 노트 깨짐을, 악보는 노트 머리 고리·파편과 친 위치 눈금을 받는다. 판정 색은 `--perfect`·`--good`·`--miss` 토큰이고 판정 이펙트는 테마와 무관하다(`domain/hitFx/judgeFx`). 설정 › 연주의 "타이밍 막대"(`timingBar`, 기본 켬)는 게임 판정선 아래·악보 영역 아래에 최근 20타의 빠름/늦음을 눈금과 최근 10타 평균 삼각형으로 보인다.
- **FX 랩(개발 전용):** 개발 서버에서 `/dev/fx`. 테마 A/B 비교, 판정 선택(PERFECT·GOOD 빠름/늦음·헛침·섞기)·깨짐 미리보기, 자동 연주 패턴(8비트·16분 필인·크래시 연타·스트레스), 세기 고정, 발광 끄기·모션 줄이기 강제, 이펙트 처리 시간(평균·p95)·파티클 수 표시. 콘솔에서 `window.__fxLab`으로 같은 조작·측정을 할 수 있다. 콤보 미리보기(2 → 10 → 50 → MISS 순서, 위치 A/B 선택)·축하 미리보기 버튼과 `window.__fxLab.playCombo(seq)`·`celebrate()`도 있다(축하 캔버스의 처리 시간은 합계에 들어간다). 프로덕션 빌드에는 라우트·코드가 들어가지 않는다.
- **점수·판정 스탬프·콤보·결과 축하(MODE-001, 설계 `.claude/plans/MODE-001-score-combo-fx.md`):** 게임 HUD 점수는 `PlayHud.ScoreValue`가 `MotionValue`로 240ms 카운트업하며 DOM 텍스트만 바꾼다(판정 1회 = React 렌더 1회, 올라갈 때 브랜드색 번쩍). 하이웨이 판정 팝업은 캔버스 안에서 네온 `--fx-*` 색으로 그린다(PERFECT 스케일 오버슈트, GOOD 작은 스탬프+±ms, MISS 좌우 흔들림, 글로우는 `shadowBlur` 없이 굵은 반투명 stroke, 동시 16개; 시간 곡선은 순수 함수 `components/popupLook`). 콤보는 하이웨이 상단 `play/ComboDisplay`(≥2 두 줄, 10배수 pulse, 50·100·이후 50배수 burst, 10 이상 MISS면 흔든 뒤 숨김)가 `domain/comboFx.comboStage` 결과대로 재생한다 — 위치 A(상단 중앙 상시)가 기본이고 `placement="stage"`(클래스 `combo-display--stage`)로 B(단계 때만)로 바꾼다. 악보 모드는 콤보 연출이 없다. 결과는 연주 시작 시점의 치기 전 최고값(로컬 로그 + 준비 화면 서버 스냅샷)을 `navigate` state `prevBest`로 받아 `domain/bestRecord.bestRecordDelta`로 비교해 "첫 기록"·"최고 기록 갱신 · 이전 → 현재" 칩을 보이고, 갱신이면 숫자 카운트업(900ms)과 `result/CelebrationFx`(1단계 FX 엔진 재사용, 고리+점 3회)를 도착 때 한 번만 낸다. 새로고침·기록 화면에서 연 결과는 이 판보다 먼저 친 로컬 로그로 칩만 다시 계산한다. 모션 줄이기(OS)에서는 카운트업 즉시 반영, 스탬프·pulse·burst·흔들림·폭발 없이 색·칩만 나온다.
- **`usePadStates(session?)`:** `liveStore.hitSeq`마다 해당 패드를 hit으로 220ms(`HIT_MS`) 켜고, `RhythmSession` 판정마다 perfect/good/miss를 400ms(`JUDGE_MS`) 보인다(판정이 hit보다 우선). 타이머 규칙은 순수 모듈 `padStateMachine`이 맡는다.
- **`components/play`:** `GuideSlot`(드럼 영역 왼쪽 안내·코칭 칸)·`HitReadout`(최근 타격, 연주용 `stack`·자유 연습용 `row`).

## 패드

패드 enum은 `domain/pads.ts`의 `PadId` 9개(공통 명세서 5장·미결 #9 결정)다. 스틱 7개(`CRASH`·`HIHAT`·`SNARE`·`SMALL_TOM`·`MID_TOM`·`FLOOR_TOM`·`RIDE`)와 페달 2개(`KICK`·`HIHAT_PEDAL`). 목록은 용도별로 세 가지다.

| 목록 | 개수 | 쓰는 곳 |
| --- | --- | --- |
| `ALL_PADS` | 9 | 저장·enum 검증·통계·악보 줄 |
| `LANE_PADS` | 9 | 노트 레인·킷 보기·칩 목록. 레인 순서는 크래시 · 하이햇 페달 · 하이햇 · 스네어 · 스몰탐 · 미드탐 · 플로어탐 · 라이드 · 킥(페달은 하이햇 왼쪽). 킷 보기는 이 순서가 아니라 배치 좌표로 그린다. 레인에 없는 패드 노트는 노트 하이웨이에 그리지 않는다 |
| `STICK_PADS` | 7 | 캘리브레이션·스틱 패드 테이블(`stick: true`) |

페달 두 패드는 센서 모드에서 동글에 붙은 페달 보드로 들어온다. 키보드 Space(킥)·B(하이햇 페달)는 키보드 전용 모드(`sensorKind === 'none'`)의 입력이고 개발·시연용으로 센서 모드에서도 눌리지만, 페달 보드와 동시에 쓰면 두 타격이 된다.

| 패드 | 센서 입력(동글, 프로토콜 v0.8.1) | 키보드 |
| --- | --- | --- |
| `KICK` | role 3(오른발) `HIT` pad 7 | Space |
| `HIHAT_PEDAL` | role 2(왼발) `HIT` pad 8, 같은 순간 `0x08 PEDAL` state 1 | B |

페달 타격은 자세 매퍼·채보 후보 보정을 거치지 않고 패킷의 pad·velocity(100) 그대로 `judgedBy: 'stick'`으로 나간다. 손이 아니므로 `ResolvedHit.stickId`는 `null`이고 `foot: 2 | 3`이 기기를 나타낸다(`0 | 1`이던 `stickId` 타입이 `StickId | null`로 넓어졌다). 타격 시각에는 스틱과 같은 `sensorOffsetMs`를 더한다(페달 전용 보정값은 통합 테스트 실측 뒤 정한다).

옛 이름(`HI_TOM` → `SMALL_TOM`)은 `normalizePadId`·`normalizePadKeys`가 한 곳에서 변환한다. 서버 채보(`chartMapping`)·서버 프리셋(`api/presets`)·설정 마이그레이션(v10)·플레이 로그 로드가 이 함수를 거치므로 BE·AI 데이터가 옛 이름이어도 깨지지 않는다. 부족한 패드 배치는 `kitLayout.fillLayout`이 기본값으로 채운다. 프로토콜 패드 번호(0~8, EMB v0.7)는 화면 순서와 별개로 `input/stickProtocol`에 둔다(`PAD_CODE`·`padFromCode`, 0xFF·9 이상은 null).

## 입력 구조

- **소스**는 "어느 스틱이 언제 얼마나 세게 어떤 자세로 쳤는가"만 낸다. 어느 패드인지는 모른다.
- **매퍼**가 패드를 정한다. 키보드 타격은 키 매퍼(고정 키), 센서 타격은 자세 매퍼(**손별** 판정 프로필 — 왼손 타격은 왼손 앵커, 오른손 타격은 오른손 앵커. `InputManager.setProfiles`·`profileFor`).
- **키보드는 항상 켜져 있고**, 센서 소스는 세팅에서 하나만 고른다(없음 / 레지스트리에 등록된 소스: 포인터 모의 IMU · BLE · WebSocket · Web Serial). 센서를 켜도 Space 킥과 키보드 타격은 그대로 동작한다.
- **터치 입력(`TouchPadSource`, `kind: 'touch'`)**: 자유 연습의 드럼 킷만 켠다(`DrumKit`의 `onPadDown`). 패드를 누르는 즉시(pointerdown) `strike(pad)`가 이벤트를 내고, 자세 매퍼가 이벤트의 `pad`를 그대로 쓴다. 세기는 100 고정, `stickId`는 0·1 교대다. 키보드처럼 항상 붙어 있다.
- **센서 판정은 `domain/events`의 `isSensorSource`로만 한다**: keyboard·preview·touch는 센서가 아니다. `source !== 'keyboard'`처럼 직접 비교하지 않는다(센서 시각 오프셋·드리프트 보정·센서 통계가 오염된다). `'touch'`는 `sensorRegistry` 예약어다.
- **프로토콜(v0.7)**: HIT는 20바이트이고 시각은 µs(`timestampUs`)다. 스틱이 판정한 패드가 `pad` 필드로 오며, `decodePacket`이 전체 필드를, `parsePacket`이 `StickEvent`(시각 ms)로 좁힌 값을 낸다. 명령 0x14~0x17·파라미터 표(`STICK_PARAMS`)도 같은 파일에 있다.
- **페달 타격**: role 2·3 HIT는 `InputManager`의 별도 경로(`handleFootHit`)로 매퍼를 건너뛰고 `ResolvedHit`이 된다([패드](#패드)). 플레이 로그·업로드 본문(`stickId: null`)·텔레메트리·이펙트(`hand` null)에는 손 없음으로 남고, 녹음은 `stickId` 키 자체를 생략한다(서버가 null을 400으로 거부).
- **타격 진동(PLAY-006)**: 스틱이 패드를 판정한 순간 직접 울린다(펌웨어 로컬 트리거, 패드 밖 타격은 진동 없음). FE는 타격마다 HAPTIC을 보내지 않는다 — 브라우저를 거친 명령이 늦게 도착해 펌웨어 진동을 끊고 한 타격에 두 번 울렸다. `InputManager.haptic`은 모니터 진동 테스트에만 쓴다.
- **스틱 판정 우선 규칙**: HIT `pad`가 있으면 자세 매퍼보다 우선해 그 패드로 재생한다(`judgedBy: 'stick'`). `pad`가 0xFF면 자세 매퍼(`'pose'`).
  채보 후보가 있고 `pad`가 후보 밖일 때만, 스틱이 애매하다고 했거나(`ambiguous`) `marginDeg`가 `AMBIGUOUS_MARGIN_DEG`(10°) 미만이면 가장 가까운 후보로 보정한다(`'chart'`). 확신 있는 오타는 그대로 두어 리듬 세션이 MISS 처리한다.
  세기는 스틱 `velocity`를 그대로 쓰고(펌웨어 곡선), 없을 때만 FE 가속도 곡선을 쓴다. 판정 출처는 `ResolvedHit.judgedBy`·텔레메트리에 남는다.
- **Web Serial(USB 직결)**: 921600 8N1, 프레이밍은 `input/serialFraming`(SOF 0xA5 · LEN · payload · CRC8). 직결 CRC·재동기 통계는 모니터가 표시한다.
- **`packetTap`**: 소스가 프레이밍을 벗긴 payload를 파싱 직전(수신)·송신 직후에 `input/packetTap`으로 publish한다. 모니터가 구독할 예정이며, 구독자가 없으면 아무 비용도 들지 않는다.
- **패드 테이블 동기화**(`input/padTableSync`, 손별): 손이 연결되거나 그 손의 판정 프로필(앵커·튜닝)이 바뀌면 그 손에만(`push(profile, { stickId })`, ROUTE로 감싸 패킷당 2개) `SET_PAD_TABLE`(지우고 시작)을 보낸다. 해시는 손별이라 같은 표는 다시 보내지 않고, `sendCommand`가 없는 소스(키보드·포인터)는 무동작이다. 2타 보정을 시작할 때는 `clear(stickId)`로 지우기 전용 패킷(`[0x15, 0x80]`)을 보내 보정 중 HIT의 `pad`가 0xFF가 되게 한다(PLAY-004 D6).
- 확인은 `PARAM_ACK_PAD_TABLE`(0x20, value = 적용 개수)을 손별 500ms 창 안에 받아 `acked`로 남긴다(패킷 role 또는 BLE 레코드의 손으로 가른다). 연결이 끊기거나 소스를 바꾸면 기록을 지운다.
- 표시: 손별 상태(`[PadTableStatus | null, PadTableStatus | null]`)를 bootstrap이 `liveStore.padTable`로 옮기고, 세팅 화면 "스틱 연결" 카드가 "스틱 패드 표 · 왼손 7개 적용됨 · 오른손 7개 적용됨"처럼 보인다. input은 store를 import하지 않으므로 `onStatus` 콜백으로 주입한다.
- **방위각 드리프트 보정**(`input/yawDriftMonitor`): 스틱 방위각은 자이로 적분이라 시간이 지나면 밀린다. 센서 타격(`pad` 있음, `judgedBy`가 `stick`·`chart`이거나 `pose`이고 반경 안, 앵커 있음)의 `wrap180(pose.yaw − 앵커.yaw)`를 스틱별 링 12개에 모은다.
- 8개 이상이고 중앙값 절대값 ≥ 6°, 중앙절대편차 ≤ 5°이면 `SET_YAW_OFFSET(적용값 − 중앙값)`(절대값 설정)을 보내고 링을 비운다. 송신 뒤 10초는 재송신하지 않고 `PARAM_ACK_YAW_OFFSET`(0x21)으로 적용값을 확인한다. 임계값은 `domain/tuning`(실측 뒤 조정).
- 연결 직후엔 `SET_YAW_OFFSET(0)`을 보내 기억을 맞추고, `inputManager.resetPose()`(펌웨어가 오프셋을 0으로 되돌림) 때는 FE 상태도 0으로 비운다. 상태(`YawDriftStatus`)는 `liveStore.yawDrift`로 옮겨 세팅 화면 "스틱 연결" 카드에 보인다.
- 보정·재정렬 중에는 `pause()`로 감시를 멈추고(그 타격은 샘플이 아니다) 끝나면 `resume()`(링 비움). 스네어 재정렬은 `correct(stickId, d)`로 쿨다운 없이 `SET_YAW_OFFSET(적용값 − d)`를 바로 보낸다.
- **스틱 USER 버튼 보정(0x22)**: FE가 `RESET_POSE`를 보낸 뒤 1초 안에 온 `PARAM_ACK 0x22`는 그 응답, 밖에서 온 것은 버튼 보정으로 보고 `InputManager.onResetPose('button', stickId)`로 알린다. 보정 중이면 처음부터, 아니면 그 손이 "재정렬 필요"가 된다.

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

## 드럼 위치 보정(2타)·스네어 재정렬 (PLAY-004)

판정은 **손별 앵커**(`settingsStore.stickAnchors` = 적용 중 프리셋의 앵커 사본, 기기 로컬)가 맡는다. 앵커는 프리셋마다 `settingsStore.presetAnchors[프리셋 id]`에 기기 로컬로 저장되고(UX-64 D2, 서버 프리셋 스키마에는 없다) `presetStore.apply`가 사본을 갈아끼운다. 시스템 기본 프리셋(`SYSTEM_PRESET_ID = 'system'`)은 사본이 비어 3D 모델 기본 앵커로 판정한다. 앵커 = 한 손이 한 패드를 칠 때의 스틱 방향(고도 `pitch`·방위 `yaw`)의 중심과 판정 반경 `radius`. 손별 앵커 7개가 곧 그 손에 보내는 `SET_PAD_TABLE` 한 장이고 FE 판정 프로필(`domain/kitJudge.anchorsToProfile`)도 같은 값이다. 거리·평균은 방향 벡터(대원 각도, `domain/calibration.angleBetween`·`meanPose`)로 계산해 방위각 ±180° 끊김이 없다. 보정 안 한 손은 3D 드럼셋 모델(`domain/kitModel`: 패드 위치·손 출발점 미터 좌표, 수치는 가정값)에서 유도한 기본 앵커를 쓴다. 반경 = 같은 손의 가장 가까운 다른 앵커까지 각도 × `radiusFactor`를 `[minRadiusDeg, maxRadiusDeg]`로 자른 값(기본 0.6 · 15° · 35°, EMB 실측).

- **2타 보정**(드럼 배치 카드, `app/calibrationSession.startCapture({ target, pads? })`): 연결된 스틱 전부 `RESET_POSE` → 드리프트 감시 pause → 손마다 표 지우기(`padTableSync.clear`) → 공용 소리 끄기. 그 뒤 `engine/HitCapture`가 스네어→하이햇→스몰탐→미드탐→플로어탐→크래시→라이드 순으로 연결된 손마다 2타를 받는다(2타 각도 차 > 8°면 그 손의 그 패드만 다시). **패드가 차면 자동으로 넘어가지 않고 확인 대기(`padDone`)에서 [다음](`next()`)을 기다린다**(UX-64 D3). [다시]는 `redo(현재 패드)`. 마지막 패드의 [저장]이 `finish()`다. 보정 중 센서 타격은 bootstrap 타격 핸들러 맨 앞의 `calibrationSession.intercept(hit)`가 가로채 소리는 "지금 치라고 한 패드"로 내고 판정·텔레메트리에는 넣지 않는다(키보드·페달은 정상 경로). 대상이 둘이다(UX-64 D4): `target: 'active'`(사용자 프리셋의 [전체 보정]·[이 드럼 다시 치기])는 `finish()`가 손별 앵커·시각을 사본과 `presetAnchors[적용 id]`에 저장 → 손별 프로필·표 전송(`applySettings`) → 앵커에서 유도한 배치를 `kitLayout`에 써서 프리셋 `layout`으로 저장될 값으로 둠(배치는 표시 전용) → 감시 resume → 소리 켜기. `target: 'new'`([추가하기])는 `finish()`가 초안 `CaptureDraft`(앵커·기본 배치에서 유도한 배치·시각)를 돌려주고 세션을 접을 뿐 설정을 바꾸지 않는다 — 화면이 이름 창을 열어 `presetStore.saveAs(name, draft)`로 새 프리셋을 만들고 앵커를 기록한 뒤 적용한다. 취소·끊김·초안 버림 때는 적용 프리셋의 표를 다시 보내고 소리를 켠다. 시스템 기본이 적용 중이면 `'active'` 보정은 열리지 않는다. 한 손만 연결이면 그 손만 보정하고, 다른 손이 붙으면 ②가 다시 "보정 필요"가 된다(`domain/readiness.calibrationReady`).
- **판정 반경 슬라이더**(UX-64 D9): 보정 카드와 선택 패드 카드의 「반지름」은 그 패드의 판정 반경(°, 고급 설정 하한~상한)이다. 보정 중에는 `calibrationSession.setRadiusOverride(pad, deg)`가 세션에 두었다가 저장 때 양손 앵커의 `radiusOverride`가 되고, 일반 편집은 `settingsStore.setRadiusOverride`가 사본·프리셋 기록에 바로 쓴다. `computeBoundaries`는 `radiusOverride`가 있으면 자동값 대신 그 값을 하한·상한으로 잘라 `radius`에 넣으므로 스틱 표에도 같이 간다. 영역이 이웃과 겹치면 더 가까운 패드가 이긴다(`resolvePad`). 표시 반지름 `layout.r`은 건드리지 않는다.
- **화면**(`components/calibration/CalibrationStage` + `CapturePanel`, Figma 보정 무대 766:34637·정보 영역 765:33506): 킷 위 큰 안내 「하이햇을 2번 타격하세요」(40px, `calibrationText.captureHeadline`), `DrumKit`은 전체를 어둡게(`dimAll`, 0.18) 두고 지금 칠 패드만 원래 밝기 + 브랜드색 글로우(`lit`). 손별 2타를 채우면 그 패드가 실제 친 위치(`placement`, 앵커 평균 방향 → `layoutToKitPoint`)로 옮겨진다. 오른쪽 카드(폭 264): 「보정 중」/「하이햇 2회 타격 (1/7)」/구분선/타격 「왼 1/2 · 오 2/2」/위치 X·Y·Z(cm, `domain/kitModel.padPointOf` — 스틱은 거리를 모르므로 3D 모델의 손→패드 거리를 가정값으로 쓴다)/반지름(`RadiusSlider`: 이름·값 행 + 4px 트랙 + 범위 15°·35°)/[다시][다음|저장]. 퍼짐 경고, 2초 넘게 타격이 없는데 스틱이 움직이면 "조금 세게 쳐 보세요". 끝난 드럼을 누르면 그 드럼만 다시(`redo`). 유령(`ghost`)·숨김(`hidden`)·나타남(`appear`)은 재정렬 화면과 옛 흐름용으로 남아 있다.
- **스네어 재정렬**(`engine/SnareRealign`, `startRealign()`): 스틱이 다시 켜져 방위각 기준이 사라진 손(STATUS 비트 5 재연결 또는 버튼 보정 0x22를 받았고 앵커가 있는 손 = `liveStore.realignNeeded`)은 전체 보정 대신 스네어를 한 번 친다. `d = wrap180(친 방위각 − 저장 스네어 방위각)`를 `yawDriftMonitor.correct(stickId, d)`로 `SET_YAW_OFFSET(적용값 − d)` 전송. 고도각·저장 표는 그대로다. 대상이 아닌 손의 타격은 정상 판정이다(자유 연습에서 다른 손은 계속 친다).
- **재정렬 진입점 네 곳**이 같은 `RealignPrompt`(손 점 L·R + 문구 + [건너뛰기], variant card/row/band)와 훅 `components/useRealign(enabled)`을 쓴다: 세팅 ② 카드, 연주 준비 기기 준비 카드의 「보정」 행, 곡 연주 끊김 복귀 카드(「재연결 성공!」 뒤 재정렬이 걸려 있으면 `useReconnectResume`이 `realigning`으로 카운트다운을 미루고, 치거나 건너뛰면 3·2·1 → 자동 재개), 자유 연습 띠. 준비 조건(`readiness`)은 막지 않는다. [건너뛰기]는 동글만 다시 꽂아 방향이 안 바뀐 경우를 위한 것이다.
- **패드 단위 재보정**(후속 T9, UX "디폴트에서 옮겨서 저장"): 사용자 프리셋에서 패드를 고르고 [이 드럼 다시 치기]를 누르면 `startCapture({ target: 'active', pads: [pad] })`로 그 패드만 연결된 손마다 2타를 받는다(바로 [저장]). 완료하면 그 손들의 그 패드 앵커·배치만 바뀌고 나머지는 유지된다(반경은 합친 집합으로 다시 계산). 표 지우기·소리·완료 부작용은 전체 보정과 같고, 화면에는 세션 밖 패드가 현재 자리에 그대로 보인다.
- 화면 기본 배치 `DEFAULT_KIT_LAYOUT`은 사람이 디자인한 고정값(후속 T8)이고, 3D 모델은 보정 전 판정 앵커에만 쓴다.
- **시작 위치 잡기**(② 카드, `calibrationSession.resetPose()`, UX-64 D7): 스틱을 정면으로 든 채 누르면 연결된 스틱 전부 `RESET_POSE`, `referenceSetAt` 갱신, 재정렬 필요 표시 해제. 앵커는 "정면 기준" 값이라 그대로 유효하다.
- 세션 스냅샷은 `liveStore.calibration`(`mode: 'idle' | 'capture' | 'realign'`, `target: 'new' | 'active' | null`)이고 화면은 이것만 읽는다. `liveStore.referenceSetAt`은 마지막 보정·재정렬·시작 위치 잡기 시각이다. `/calibration`은 `/setup`으로 이동한다.

## 통합 설정(프리셋·캘리브레이션)

`/setup` 한 페이지에서 연결·보정·프리셋·배치를 끝낸다. 위에서 아래로 (연주 준비에서 왔을 때만) 복귀 띠 → 머리("연주 환경 설정 · 2단계 중 n단계 완료") → 단계 카드 2장(스틱 연결·시작 위치 보정) → 드럼 배치 카드(프리셋 칩 줄 + 배치/보정 무대 + 선택 패드 + 타격 확인) → 접힌 고급 설정 → 하단 고정 바 순이다(UX-64: ③ 프리셋 카드는 드럼 배치 카드의 칩 줄로 합쳐졌다). 순서를 강제하지 않아 어느 영역이든 언제나 조작할 수 있다.

- **상태 타일**(`components/setup/StatusTile`, Figma Setup / StatusTile 505:2449, UX-44·UX-64) — 2열 타일(높이 118). 점 + 제목 20 + › 아이콘(`public/icons/chevron-next.svg`), 상태 한 단어(「연결됨」「보정됨」/「연결 안 됨」「보정 필요」/「필요 없음」), 한 줄 요약. on(완료)=초록 테두리 + 10% 초록 글로우, off=회색, 복귀 띠가 떠 있는 필요 단계=빨강. 타일 전체가 버튼이고 누르면 그 줄 아래로 본문이 펼쳐진다(펼친 타일은 두 열을 차지, › 가 90° 돈다). 판정·요약 문구는 `domain/setupSteps.setupSteps()`가 `readiness()`의 `missing`에서 유도한다(규칙 중복 없음). `StepCard`는 더 쓰지 않는다(컴포넌트·테스트는 남아 있다).
  - ① **스틱 연결** — 왼손·오른손 `StickCard` 2장(연결 점·배터리), 입력 소스 선택, 소스 옵션 패널, 패드 표·방위각 문구. 센서를 쓰면 **양손이 모두 연결**돼야 완료다. 연결이 끊겼다 돌아오면(`referenceStale`) 시작 위치를 다시 맞추라는 안내만 낸다. 스틱은 버튼으로 켜면 동글에 자동으로 붙고, 동글↔브라우저는 한 번 허락한 포트를 페이지를 열 때 자동으로 다시 연다. 센서가 Web Serial이면 두 손 카드 아래에 페달 줄이 붙고("페달 연결됨 · 82%" / "페달 연결 안 됨 · 페달을 켰다면 동글을 다시 꽂아 주세요") 페달도 완료 조건이다. Web Serial이면 맨 위에 동글 줄을 둔다: 포트가 안 열렸으면 [동글 연결](처음 한 번 포트 선택), 열렸으면 "동글이 연결됐어요"(스틱 0개면 "스틱 버튼을 눌러 켜 주세요")와 [다른 동글 연결], LINK가 3초 넘게 끊기면 "동글 응답이 없어요". 키보드만 쓰면 "필요 없음"이지만 [변경]으로 펼쳐 센서를 고를 수 있다.
  - ② **시작 위치 보정**(UX-64 D7) — 기준 자세(정면)와 스네어 재정렬을 맡는다. 상태: 키보드만("필요 없음") / 보정 필요(사용자 프리셋인데 연결된 손의 앵커가 없음: "드럼 위치를 아직 잡지 않았어요 · 드럼 배치에서 보정하세요", 본문은 [시작 위치 잡기] + 드럼 배치 카드 안내) / 재정렬 중("오른손 스틱이 다시 켜졌어요 · 스네어를 한 번 쳐 주세요", 스네어 유령 킷 + 프롬프트 + [처음부터 보정]) / 완료("HH:MM에 보정했어요", 시스템 기본이고 시각이 없으면 "시스템 기본 배치 · 보정 없이 바로 칠 수 있어요"). 완료 조건은 `domain/readiness.calibrationReady`: 재정렬이 필요한 손이 없고, 시스템 기본이거나 연결된 손마다 앵커가 있는 것. 2타 보정은 여기서 하지 않고 드럼 배치 카드에서 한다.
- **펼침 규칙**(`domain/setupExpand`) — 펼침 = 사용자가 연 단계 ∪ 모자란 첫 단계. 모자란 첫 단계가 바뀌면 그 단계를 새로 펼치고, 자동으로 펼친 단계는 끝나면 접힌다. 진입 때 한 번만 모자란 첫 단계 카드로 스크롤한다. 다 끝났으면 아무것도 펼치지 않는다.
- **드럼 배치 카드** — 맨 위 **프리셋 칩 줄**(`components/setup/PresetChips`, UX-64): [시스템 기본 · 고정] + 저장 프리셋 칩(누르면 `presetStore.apply`) + [+ 추가하기](센서 모드, 슬롯 5개가 차면 비활성 「슬롯이 다 찼어요…」) | 오른쪽 완료 시각 pill(「완료 14:02」, 사용자 프리셋인데 앵커가 없으면 「보정 필요」, 키보드만이면 「키보드만」) + [전체 보정](사용자 프리셋만). 보정 중엔 「새 프리셋 · 보정 중」 칩(추가하기) 또는 적용 칩 유지 + 「보정 중 n / 7」 pill + [보정 취소]. [추가하기] → 패드별 2타 → 마지막 [저장] → **프리셋 슬롯 창**(`PresetSlotDialog`, Figma 772:33828·Setup / PresetSlot 505:2501: 0번 시스템 + 저장 슬롯 5개, 초안 모드라 빈 슬롯만 활성, 하단 바 「보정 완료 · 빈 슬롯을 눌러 저장해요」) → 빈 슬롯 → 이름 창(`PresetNameDialog`, 기본값 「새 프리셋 k」, 바 「보정 완료 · 슬롯 k에 저장할 이름을 정해요」) → `saveAs(name, draft)`로 새 프리셋이 적용된다. 슬롯 창의 [닫기]·이름 창 [취소]는 초안을 버린다. 그 아래 보정 중이면 `CalibrationStage`, 아니면 표시 전용 `KitCanvas`(폭 720, 비율은 배치 좌표계와 같은 16:10, 오른쪽 카드 264와 32 간격으로 가운데 정렬): 배치는 보정에서 친 자리가 정하고(PLAY-004 D2), 드래그 편집·넓게/좁게 칩은 없다. 마우스는 패드 고르기만(소리·타격 기록 없음, 포인터 모의 IMU의 클릭 타격도 `data-no-pointer-strike`로 막음), 캔버스가 포인터 기준면 `bindSensorSurface`. 점선 원은 손별 판정 범위(파랑 왼손·주황 오른손, `anchorSets`). 시스템 기본이면 킷 아래 「고정 배치예요. 그 자리를 찾아 치세요…」 안내. 오른쪽 선택 패드 카드(Figma 정보 영역 765:33431, UX-62: 캡션 「선택 패드」/패드 이름 16 Bold/구분선/위치 X·Y 행/보정된 패드면 `RadiusSlider`/[이 드럼 다시 치기]/[기본 배치로] — 시스템 기본이면 둘 다 비활성). 사운드 세트 선택 UI는 없고 값은 `ssaplash` 고정이다. **타격 확인**(`HitLog`) — 최근 5행(패드·손·세기·경과 시각, 새 타격이 위, 손은 센서 타격만), 구독은 `components/drum/useRecentHits(n)`. 연결이 끊기면 "스틱 입력 중단".
- **고급 설정**(카드 + [펼치기], 접힘이 기본) — 판정 반경 하한·상한·판정 폭·노트 낙하·카운트인·메트로놈(볼륨·오디오 오프셋은 설정 화면에 있다). 설정 스토어에 즉시 저장되므로 미저장 판정 대상이 아니다.
- **하단 고정 바** — 4상태 + 보정 중(`domain/setupSteps.setupBarView`): 변경 없음 「이름」 사용 중 + [저장] 비활성(시스템 기본은 항상 이 상태) / 변경 있음 노랑 점 + "「이름」 변경 있음 · 저장하지 않으면 다음에 사라져요" + [저장] / 적용 프리셋이 목록에 없음 "아직 프리셋으로 저장하지 않았어요" + [새 프리셋으로 저장] / 변경이 있는 채로 나가려 해 이탈 확인이 열린 동안 빨강 "저장하지 않은 변경 사항이 있어요…" / 보정 중 「새 프리셋 보정 중 · 7개 중 n번째」(또는 「「이름」 보정 중 …」) + [저장] 비활성. 화면 아래에 sticky로 붙는다.

[설정 완료] 버튼은 없다. 센서를 쓰는 화면에서 준비 조건이 처음 갖춰지면 `firstSetupDone = true`로 기록하고, 복귀 띠로 돌아갈 때도 켠다.

**복귀 규칙**: 홈·곡 연주 준비의 바로가기는 `navigate('/setup', { state: { returnTo, returnLabel? } })`로 들어온다(`returnLabel`은 "악보 연습 · 곡 제목" 같은 띠용 이름, 없으면 경로로 짓는다). `returnTo`가 있으면 상단에 복귀 띠가 고정되고, 남은 조건 한 줄과 [연주 준비로 돌아가기]가 보인다. 조건이 모두 채워지면 버튼이 활성이 되고 Enter로도 돌아간다(입력 칸·버튼 포커스, 대화상자 열림, 보정 중에는 무시). 이동은 `sanitizeReturnTo`를 거친다. `returnTo` 없이 메뉴로 들어오면 띠 없이 같은 단계 카드가 보인다.

**이탈 확인**: 변경사항이 저장되지 않았고(`selectDirty`) 보정 중이 아닐 때 복귀 버튼·메뉴 이동·뒤로 가기를 하면 `UnsavedLeaveDialog`가 뜬다. [취소]는 머물고, [저장 안 함]은 적용 프리셋의 배치·사운드로 되돌린 뒤 이동한다(적용 프리셋이 없으면 편집값을 둔 채 이동). [저장하고 나가기]는 적용 프리셋이 있으면 변경을 저장한 뒤 이동하고(실패하면 창 안에 오류 문구를 띄우고 머문다), 없으면 이름 창을 열어 저장 성공 후 이동한다. `beforeunload`(새로고침·탭 닫기 경고)는 쓰지 않는다. `useBlocker`는 데이터 라우터에서만 동작하므로 `main.tsx`는 `createBrowserRouter`로 `App`을 splat 라우트 아래에 둔다.

## 준비 조건

**스틱 연결·배터리 판정(Web Serial 동글, 프로토콜 v0.8):** 동글 하나(포트 하나)에 두 스틱이 붙고 `flags` role(0 왼손·1 오른손)로 가른다. 손별 연결은 동글이 1초마다·바뀔 때 보내는 `0x07 LINK` 마스크가 기준이고, LINK를 한 번 받은 뒤엔 STATUS는 배터리만 바꾼다(첫 LINK 전 = 예전 동글 펌웨어는 STATUS가 오면 연결). LINK가 3초 넘게 안 오면 동글 문제(`liveStore.dongle = 'stale'`)로 보고 양손을 끊김으로 둔다. 배터리는 STATUS(5초) 최근 3개 평균이고 20% 이하 주황, 10% 이하 빨강·"곧 꺼짐"(`domain/stickStatus`). 시계 동기화는 손별(스틱마다 시계가 다름), 한 손용 명령(방위각 보정·진동·패드 표 재전송)은 LINK 확인 뒤 동글 `0x70 ROUTE`로 감싼다(감싼 SET_PAD_TABLE은 패킷당 패드 2개). 기기별 상태는 `input/deviceState`의 role 0~3 네 칸이고, role 2·3(발)도 같은 네 칸을 쓰며 이벤트는 `pedalStatus`·`pedal`로 낸다(아래 "페달 보드").

**페달 보드(PLAY-002, 설계 `.claude/plans/PLAY-002-pedal-input.md`, 프로토콜 v0.8.1):** 킥·하이햇 페달은 동글에 붙은 페달 보드 하나지만 프로토콜이 role 2(왼발 하이햇)·3(오른발 킥) 두 기기처럼 보내므로 FE도 두 칸으로 둔다. `0x07 LINK` 마스크는 bit0~1 손, bit2 왼발, bit3 오른발이고, role 2·3 STATUS는 배터리만 싣는다(비트 5 없음 — 발은 설정 재전송 대상이 아니고 시계 초기화만 한다). SYNC_ACK는 role별로 와서 각 칸 시계가 따로 맞는다(LINK 0→1 때 그 칸 시계 초기화 + SYNC 5회는 손과 같다). `0x08 PEDAL`(state 0 뗌·1 밟음)은 하이햇(role 2)만 오고 시각을 그 칸 시계로 환산해 `pedal` 이벤트로 낸다. 상태는 `liveStore.pedal { connected: [왼발, 오른발], battery, hihatClosed }`에 둔다(배터리는 최근 3개 평균, 왼발이 끊기면 `hihatClosed`는 true로 되돌린다).

- **필수 기기:** 페달은 동글(`webserial`) 소스에서만 필수다(`domain/pedalStatus.pedalRequired`). 페달 보드가 동글로만 붙으므로 포인터·BLE·WebSocket 소스는 요구하지 않는다(올 수 없어 영구 미준비가 된다). 키보드 전용도 면제다.
- **준비 조건:** 동글 소스는 손 둘에 더해 두 발이 모두 붙어야 하고(`pedalConnected`), 빠지면 `readiness.missing`에 `'pedal'`("페달을 연결하세요")이 들어간다.
- **끊김:** 센서 모드에서 발이 연결→끊김이 되면 손과 같이 자동 일시정지(`usePauseTriggers.pedalDropped`)·자동 재연결이 시작되고, 손·발 네 칸이 모두 돌아와야 `settle()`한다.
- **동글 탐색 제약:** 동글은 첫 기기가 붙은 뒤 10초만 새 기기를 찾는다(EMB 231). 페달을 나중에 켜면 붙지 않으므로 페달 끊김 상태의 세팅 화면이 "동글을 다시 꽂아 주세요"로 안내한다.
- **화면:** 셸 칩 오른쪽에 "페달 ● 82%"(동글 소스면 항상, 끊김은 빨간 점, `StickStatusIndicator`), 세팅 ① 카드의 두 손 카드 아래 페달 줄(`pedalSetupLine`), 연주 준비 패널의 P 점(`ReadyPanel`, 문구 "왼손·오른손·페달 연결됨"), 끊김 카드(`DisconnectNotice`)·자유 연습 띠(`DisconnectBand`)의 P 점과 "페달 연결이 끊겼어요" 제목. 왼발·오른발을 따로 보이지 않고 "페달" 하나로 묶는다. 실기기 확인은 11/6 통합 테스트(239).

**재연결·설정 재전송(S15P31A307-281, 설계 `.claude/plans/PLAY-002-stick-reconnect.md`):** 설정 원본은 웹 하나이고 스틱 플래시에 저장하지 않는다. 재부팅한 스틱은 STATUS `flags` 비트 5(설정 전)를 보내고, FE는 그 손에만 ROUTE로 패드 표를 강제 재전송(같은 표여도)하고 방위각 오프셋을 0으로 맞춘다(비트 5가 1인 STATUS마다, 손별 1초 쿨다운). 동글 순서상 비트 5 STATUS가 LINK보다 먼저 오므로 안 붙은 손의 배터리·비트 5는 보류했다가 LINK로 붙는 순간 함께 올린다. LINK 비트 0→1이거나 비트 5를 본 기기는 시계 보정(`ClockSync`)을 초기화하고 SYNC를 50ms 간격 5회 보낸다(2초 안 중복은 건너뜀) — 재부팅한 스틱은 시계가 0부터라 옛 offset을 쓰면 안 된다. 비트 5 = 0인 재연결(잠깐 끊김)은 시계만 초기화하고 패드 표·오프셋은 보내지 않는다. SET_PARAM은 게임 화면이 보내지 않으므로 재전송 대상이 아니다.

연주 중 한 손이 끊기면(리듬 게임·악보 연습은 자동 일시정지, 자유 연주는 띠) `app/bootstrap`이 `reconnectStore.start()`로 자동 재연결을 시작한다. 시도 하나 = 웹 쪽 재연결 동작 + 기기 복귀 3초 대기(`app/reconnectPolicy`, 손 둘, 동글이면 발 둘까지 네 칸): Web Serial 동글은 포트를 닫고 다시 열고(`reopen`), 포트가 닫혔으면 허락된 포트를 다시 열고(`autoConnect`), BLE 직결은 보관한 기기에 `gatt.connect()`, WS는 재접속한다. 모두 사용자 제스처가 필요 없는 동작이다. 최대 3회(약 10초) 뒤 `failed`가 되고 끊김 카드는 소스별 안내(`hint`: 동글 "동글을 뺐다 다시 꽂아 주세요")와 [드럼 세팅에서 연결하기]를 보인다. 시도 중 [다시 연결]을 누르면 대기를 끊고 다음 시도로 간다. 동글을 뺐다 꽂으면 `navigator.serial`의 `connect` 이벤트로 클릭 없이 포트를 다시 연다. 필요한 기기가 모두 돌아오면 `settle()` → `reconnected`(약 1초, 카드에 「재연결 성공!」·「3초 뒤 이어서 연주해요」) → 리듬 게임·악보 연습은 카운트다운 3·2·1·시작! 뒤 자동으로 이어 연주한다(사용자 클릭 없음). 실기기 확인은 11/6 통합 테스트(239)에서 한다.

연주 전 준비 조건은 두 가지다: 스틱 연결(`connected[0] && connected[1]`, 왼손·오른손 모두, 동글 소스는 두 발 `pedal.connected`도), 최초 설정 완료(`settings.firstSetupDone` + 적용 프리셋 기준 보정 완료 `calibrationReady`). 프리셋은 조건이 아니다 — 시스템 기본(`'system'`)이 항상 적용돼 있다(UX-64 D1). 판정은 `domain/readiness.ts`의 `readiness()`가 하고, 키보드 전용(`sensorKind === 'none'`)은 면제라 안내가 뜨지 않는다. 홈은 `ReadinessNotice`로 미비 항목과 "설정으로" 버튼만 보여주고 진입은 막지 않는다. 리듬 게임·악보 연습은 곡을 고른 준비 단계에서 같은 안내를 보여주고 조건이 모자라면 시작 버튼과 Enter를 막는다. "설정으로"는 `returnTo`를 넘겨 복귀 띠로 그 화면으로 돌아온다(곡 선택이 URL에 있어 같은 곡의 준비 화면으로 돌아온다).

## 곡·채보 조회

- **출처:** 기본은 BE(`/api/v1/songs`·`charts`·`chart-versions`). `VITE_SONGS_SOURCE=builtin`으로 빌드하면 BE 없이 내장 3곡(`BUILTIN_CHARTS`)만 쓰고 SongPicker의 "라이브러리" 탭은 숨는다. 내장 소스의 곡·채보 id는 둘 다 `-(인덱스+1)`(음수)이고 `chartVersionId`는 null이다.
- **곡 선택은 URL:** `/play?song=12&chart=34`, `/sheet?song=…&chart=…`. SongPicker에서 난이도 칩을 누르면 `useChartParam.select`가 URL을 바꾸고, 페이지는 쿼리가 있으면 `loading` 단계에서 `loadChart`로 채보를 읽은 뒤 준비 화면으로 간다. 쿼리만으로 준비 화면이 복원되므로 통합 설정에 다녀와도 곡이 유지된다(`ReadinessNotice`의 `returnTo`는 `pathname + search`). 로드 실패는 `ApiError.detail`을 보이고 "곡 선택으로"가 쿼리를 지운다. `?scope=MINE`이면 "라이브러리" 탭에서 시작하고, `?scope=MINE&song={id}`면 그 곡(READY일 때)을 펼친 채 연다. "라이브러리" 탭에서 READY가 아닌 곡은 상태 배지와 함께 흐려지고 눌리지 않으며, 아래에 "라이브러리" 안내가 붙는다.
- **곡 난이도·플레이 후보:** SongPicker는 목록을 `playableOnly=true`로 읽어 READY이면서 곡 난이도(`songLevel`)가 있는 곡만 받는다. 그래서 "라이브러리" 탭의 처리 중·실패 곡은 목록에 없고, 라이브러리 탭에 고를 곡이 0곡일 때만 표 본문에 「처리 중·실패한 곡은 라이브러리에서 확인하세요.」를 보인다. 0곡이면 표 머리글과 「총 0곡」은 그대로 두고 본문 자리에 안내를 둔다(`SongTable` `emptyState`, 난이도로 비면 「이 난이도의 곡이 없어요」). 칩·검색·탭은 둘러보기라 사용자가 고른 곡은 목록에서 빠져도 선택한 곡 패널에 남고 [준비]가 된다(표에는 강조 행 없음). 패널은 [프리셋 · 준비] 한 줄이고 스틱 연결 문구는 두지 않는다(상단 바 스틱 상태로 확인). 검색창 옆 칩(전체·입문·중급·고급, `ui/Chip`)은 서버 쿼리 `songLevel`로 거르고, 표의 「곡 난이도」 열(폭 74)과 선택한 곡 패널 메타 줄(「BPM 120 · 3:24 · 입문」)에 표기한다(`null`은 표 「—」, 패널은 생략). 곡 난이도는 연습 단계(EASY·NORM·HARD)와 다른 값이라 `LevelBadge`를 쓰지 않는다. 내 곡(`/studio`)은 조건 없이 읽는다. 내장 소스(`VITE_SONGS_SOURCE=builtin`)는 난이도가 없어 `playableOnly`를 무시한다. **배포 순서:** 운영 DB의 기존 곡 backfill(BE 269) 전에 배포하면 곡 선택 목록이 빈다.
- **곡 선택 추천 — [AI 추천곡] 탭·라벨·비슷한 곡(COACH-004):** `VITE_SONGS_SOURCE`가 `builtin`이 아니고 로그인 상태(`authenticated`)이면 SongPicker 탭이 [기본 곡][라이브러리][AI 추천곡]이 된다(아니면 탭 2개·추천 없음). 곡 선택에 들어올 때 탭과 무관하게 `GET /api/v1/songs/recommendations`(`context=SONG_PICKER`, `mode`는 `/play`=RHYTHM·`/sheet`=SHEET, `size=10`)를 한 번만 부르고(`store/recommendationStore`가 키당 1회), 탭·검색·칩을 바꿔도 다시 부르지 않는다. 연주 뒤 곡 선택으로 돌아오면(재마운트) 새로 부른다. **AI 추천곡 탭:** 곡 목록 API를 부르지 않고 받은 추천을 BE 순서 그대로 표에 보인다. 검색·곡 난이도 칩은 `domain/recommendation.filterRecommended`로 FE에서 거른다(제목·아티스트 부분 일치, `songLevel` 일치). 불러오는 중은 스피너, 빈 결과·오류·5초 시간 초과는 표 틀 안에 「아직 추천할 곡이 없어요 / 연주 기록을 모아서 실력에 맞는 곡을 추천해 드릴게요.」다. 추천 이유 문구는 보이지 않는다. 이 탭에서 고른 곡(처음 자동 선택된 곡 포함)의 [준비]·더블클릭·Enter는 추천 `chartId`(곡 상세에 없으면 기본 채보)로 가고 `POST /api/v1/recommendations/{requestId}/clicks`를 기다리지 않고 보낸다(실패 무시). **기본 곡 탭 라벨:** 추천 결과가 있으면 그 곡 행의 제목 옆에 「✦ AI 추천」(`SongTable` `isRecommended`, 12px `--brand-text`, 간격 8, 제목만 말줄임)을 붙인다. 라벨 곡의 [준비]는 기본 채보이고 클릭 기록이 없다. 라이브러리·AI 추천곡 탭과 추천 실패 때는 라벨이 없다. **선택한 곡 패널 비슷한 곡:** 선택이 300ms 그대로이면 그 곡으로 `GET /api/v1/songs/{songId}/similar`(`size=3`, `difficulty`는 상세를 읽었으면 기본 채보 단계)를 한 번 부르고(키 `SONG_PICKER:SIMILAR:${songId}` — 연주 준비의 `SIMILAR:${songId}`와 나눈다), 선택한 곡이 아닌 첫 항목을 [준비] 줄 아래 구분선과 「✦ 이 곡과 비슷한 곡 · 제목 · 아티스트 · 곡 난이도 · 비슷한 이유」 + [이 곡 보기]로 보인다(`SongDetailPane` `similar`). 결과가 없거나 실패면 구분선까지 없다. [이 곡 보기]는 클릭을 기록하고 탭·검색·칩은 그대로 둔 채 그 곡을 선택한 곡으로 바꾸며(목록에 없으면 강조 행 없이 패널만), 그 곡의 [준비]는 기본 채보다. 화면을 떠나면 추천 키와 읽은 비슷한 곡 키를 `clear`한다. 필터 아래 추천 카드 줄(`RecommendRow`)은 곡 선택에서 쓰지 않는다(연주 준비·리포트는 그대로). 테스트: `SongPicker.interaction.test.tsx`(탭·라벨·거르기·빈 상태·[준비] 채보·클릭·비슷한 곡 300ms·[이 곡 보기]·builtin·비로그인), `play/SongTable.test.tsx`, `play/SongDetailPane*.test.tsx`, `domain/recommendation.test.ts`.
- **리포트 하단 추천·비슷한 곡(COACH-004):** 리포트(`/result/:playId/report`) 맨 아래에 "AI 추천 연습곡" 카드가 붙는다. 리포트 요약을 처음 성공으로 받은 직후 `GET /api/v1/songs/recommendations`(`context=REPORT`, `mode`=리포트 모드(`SHEET`만 SHEET, 그 밖은 RHYTHM), `playId`, `size=5`)를 부르고, 키 `REPORT:${playId}`당 1회만 나간다 — store `load`는 키가 없거나 idle일 때만 요청하므로 [다시 시도] 재마운트·PENDING 폴링·StrictMode에도 1회이고, 키는 바깥 `ReportPage`가 `playId` 변경·언마운트 때 `clear`한다. 분석이 PENDING·FAILED여도 보이지만 리포트 로드가 실패하면 요청이 없다. **보이는 조건:** 내장 곡 빌드(`VITE_SONGS_SOURCE=builtin`)가 아니고 로그인 상태이며 결과가 1개 이상일 때만이다(빈 결과·오류·404·5초 초과는 줄만 숨는다). 카드를 누르면 클릭 기록을 기다리지 않고 보낸 뒤 `recommendationPathOf`로 `/play?song=&chart=`(SHEET 리포트는 `/sheet`)로 이동한다. 결과 화면에는 붙이지 않는다. **"방금 친 곡과 비슷한 곡"**은 리포트 응답의 선택 필드 `songId`(`api/reports`가 없으면 null)가 있을 때만 추천 카드 아래 별도 카드로 보인다 — `GET /api/v1/songs/{songId}/similar?difficulty=&size=5`(difficulty 없으면 쿼리 생략, 서버 기본 NORMAL). 필드가 없으면(BE 반영 전) 요청도 줄도 없다.
- **연주 준비 "이 곡과 비슷한 곡"(COACH-004):** `/play`·`/sheet`의 연주 준비 패널 아래(`ReadyPanel` `footer`, 두 열 아래 전체 폭)에 가로 카드 줄이 붙는다. 준비 단계에 들어올 때 곡당 1회 `GET /api/v1/songs/{songId}/similar`(`difficulty`=그때 선택된 채보 난이도, `size=5`, 키 `SIMILAR:${songId}`)를 부르고(`components/play/useSimilarSongs`), 연습 단계를 바꿔도 다시 부르지 않는다. 곡이 바뀌거나 곡 선택으로 돌아가면 키를 `clear`한다. 카드 배지는 서버가 응답한 난이도를 표시하고 클릭하면 기록을 기다리지 않고 전송한 뒤 응답 `chartId`로 이동한다. `matchedOn` 첫 코드의 문구(`domain/recommendation.MATCHED_ON_COPY`)만 보이고 모르는 코드면 문구 없이 카드만, `similarity`는 보이지 않는다. 숨김 조건은 추천 곡과 같다(내장 곡·비로그인·빈 결과·404·오류·5초 초과). 곡 선택 화면의 비슷한 곡은 패널 한 줄로 따로 읽는다(위 항목). 테스트: `pages/ReportPage.interaction.test.tsx`(리포트 추천·비슷한 곡), `components/play/useSimilarSongs.test.tsx`(곡당 1회·서버 단계 유지·클릭), `store/recommendationStore.test.ts`, `api/similarSongs.test.ts`, `domain/recommendation.test.ts`.
- **변환:** `domain/chartMapping.chartFromDetail`이 BE 채보를 `Chart`로 바꾼다. 알 수 없는 pad는 버리고 경고 1회, `timeMs`에 `offsetMs`를 더하지 않으며, `durationMs`가 null이면 마지막 노트 + 1마디, `tempoMap`·`timeSignatureMap`이 둘 이상이면 `variableTempo`로 표시한다. `tempoMap`이 둘 이상이고 `ppq`가 있으면 `domain/tempo.tempoSegmentsFrom`이 tick을 곡 시각으로 바꿔 `Chart.tempoSegments`(빠르기 구간)를 채운다. 식은 BE `ChartDocumentReader.milliseconds`와 같다(tick 0 = `offsetMs`).
- **버전 고정:** 곡 선택 직후 `getChartLatest`는 한 번만 부른다. 이후(재시작·자산 갱신)는 `chart.chartVersionId`로 `getChartVersion`·`getChartAssets`를 부른다. store는 채보를 캐시하지 않는다.
- **assets:** `loadChart`가 채보와 함께 `getChartAssets`를 부른다. 실패해도 채보는 돌려주고 `assets`가 null이다. `accompanimentUrl`이 있으면 `chart.hasAccompaniment = true`. 서명 URL은 메모리에만 둔다(반주 재생은 아래 "반주 재생" 절).
- **플레이 로그:** `chartVersionId`·`songNumericId`·`chartId`(다시 하기 URL용)·`presetId`가 같이 저장된다. 내장 곡은 null. 채보 노트의 `noteId`와 BE 전체 노트 수(`sourceNoteCount`)도 남긴다(업로드용).

## 곡 작업실(음원 업로드·채보 생성)

- **화면:** `/studio`(상단 메뉴·제목 "라이브러리"). 본문은 라이브러리 목록(`songStore` MINE)이고, 카드 보기에서는 오른쪽에 300 폭 "어떻게 되나요" 안내 패널이 붙는다(목록 보기·로딩·오류는 본문 전체 폭, 폰 폭에서는 패널이 아래로). 제목 오른쪽 [곡 올리기](primary md)가 **업로드 창**(모달)을 열고, 제목 아래에 요약 "곡 n개 · 생성 중 n"이 있다. 창에는 탭 "음원"(기본)·"MIDI"가 있고 마지막에 고른 탭을 다시 열 때 유지한다. 음원 탭은 MP3·WAV·M4A·OPUS(50 MiB·10분 이내, `POST /api/v1/songs/audio` 202 `{jobId, songId, status}`)이고 회원당 활성 작업은 하나다(초과 시 429 `AUDIO_BUSY`). 업로드 중에는 탭 전환·닫기·Esc·배경 클릭이 잠긴다. 음원 202를 받으면 창이 닫히고 목록을 다시 읽는다.
- **MIDI·MusicXML 업로드:** MIDI·MusicXML 탭은 파일(MIDI `.mid`·`.midi` 1 MiB 이하, 드럼 MusicXML `.musicxml`·`.xml`·`.mxl` 5 MiB 이하)·제목(파일명 기본값)·아티스트로 `POST /api/v1/songs/midi` 또는 `POST /api/v1/songs/musicxml`(293, 확장자로 가름. 둘 다 multipart `title`·`artist`(비면 생략)·`file`)를 한 번 보낸다. 작업(job) 없이 동기 처리라 음원 생성 중에도 올릴 수 있다(그동안 음원 탭은 "「제목」 생성이 끝나면 올릴 수 있어요" 안내). 중복 방지 키가 없어 자동 재시도하지 않는다. 사전 검사는 빈 파일·크기 초과만 하고 내용 판별은 BE에 맡긴다(`domain/midiUpload`). 201이면 창을 닫고 이동 없이 목록을 다시 읽어 새 곡 행을 2초 강조한다. 오류는 400 `MIDI_INVALID`·413 `MIDI_TOO_LARGE`·422 `MIDI_UNSUPPORTED`(BE `detail`)·422 `MIDI_NO_DRUM_NOTES` 문구를 창 안에 보이고, 네트워크·5xx는 "업로드 결과를 확인하지 못했습니다" 안내와 함께 목록을 다시 읽는다([다시 시도] 없음, 목록을 보고 직접 다시 올린다). MIDI 곡은 카드의 배지 행에 "MIDI" 칩, MusicXML 곡(`source=MUSICXML`)은 "MusicXML" 칩이 붙는다(목록 행에는 없다). MusicXML 오류는 `MUSICXML_*` 코드(`domain/midiUpload`의 문구 표. `MUSICXML_UNSUPPORTED`는 BE `detail` = AI 변환기 메시지, 503 `MUSICXML_UNAVAILABLE`은 곡이 안 생긴 것이 확실해 "변환 서버에 연결할 수 없어요" 고정 문구). 모르는 확장자·크기 초과는 보내기 전에 거절한다. 반주는 BE가 드럼 외 트랙으로 비동기 합성한다(아래 "반주 상태"). 상태는 `midiUploadStore`(`idle`·`uploading`·`done`·`failed`).
- **반주 상태:** 곡 목록·상세·MIDI 업로드 201의 `accompanimentStatus`(`GENERATING`·`READY`·`FAILED`·`NONE`)를 `SongSummary.accompanimentStatus`로 읽는다. 필드가 없거나 모르는 값이면 `hasAccompaniment`로 `READY`/`NONE`을 정한다(`domain/songCatalog.accompanimentStatusOf`). 채보 `READY` 곡 중 `GENERATING`은 "반주 생성 중", `FAILED`는 "반주 생성 실패" 배지를 상태 배지 옆에 붙인다(`AccompanimentBadge`, Figma `SongStatusBadge`의 processing·failed 모양). 내 곡 화면은 생성 중 곡만 3초 간격·화면 진입당 최대 20회 곡 상세를 한 곡씩 다시 읽어 상태 필드만 반영한다(`useAccompanimentPolling` → `AccompanimentPoller`, `songStore.patchItem`, 목록 스켈레톤 없음). 탭이 숨겨지면 멈추고 보이면 남은 횟수로 이어가며, 404 곡은 빼고 다른 실패는 그 회차만 건너뛴다. 상한 뒤에도 생성 중이면 배지를 두고 재진입·새로고침 때 다시 읽는다. 악보 연습 준비 화면의 "반주 재생" 줄은 반주를 못 쓰면 `GENERATING`이면 "(반주 생성 중)", 나머지는 "(반주 없음)"이다.
- **목록 행:** 처리 중 → 실패 → 완료 순, 같은 상태 안에서는 최신순. 활성 작업은 202 직후 목록에 아직 없어도 맨 위 `ActiveJobCard`(커버·제목·4칸 단계 띠·경과 시간, 한 줄 전체 폭)로 보이고 카드·행 목록에서는 빠진다. 완료 행은 [악보 연습](`/sheet?scope=MINE&song=`)·[플레이](`/play?scope=MINE&song=`), 실패 행은 [다시 올리기]. 목록 보기 행에도 ⋯ 메뉴가 있다(기능 스위치 켜짐일 때). 활성 작업이 도는 동안에도 [+ 곡 올리기]는 켜 두고 창의 음원 탭만 안내로 바뀐다. 곡도 작업도 없으면(첫 방문) 버튼 없이 본문에 같은 탭 양식(큰 드롭 영역)과 가로 4단계 안내만 보인다.
- **완료 시 이동:** `chartJobStore.doneSource`로 갈린다. 이 화면에서 폴링하다 완료를 보면(`live`) `/sheet?scope=MINE&song={id}`로 이동한다. 복원(`resume`·429 복원) 뒤 **첫 조회**에서 완료를 보면(`restored`) 이동하지 않고 목록을 다시 읽어 그 행을 2초 강조한다. 곡 생성 실패(`JOB_FAILED`)는 목록을 다시 읽어 실패 행으로 보이고, 업로드 단계 실패·404는 창의 음원 탭 안에 오류가 보인다.
- **실패 재업로드:** 실패 행의 [다시 올리기]는 업로드 창을 음원 탭으로 열고 제목·아티스트를 미리 채운다(파일만 다시 고른다). 양식 위 "「제목」 다시 올리기" 줄의 [취소]로 되돌린다.
- **사전 검사:** `domain/chartJob.precheckAudio`가 빈 파일·크기 초과·확장자(MIME)를 전송 전에 거른다. 제목 기본값은 파일명(확장자 제거, 100자).
- **멱등 키:** 파일·제목·아티스트 조합마다 UUID 하나를 `Idempotency-Key` 헤더로 보낸다. 네트워크·503 실패의 **다시 시도**는 같은 키, 내용이 바뀌면 새 키. 같은 키에 다른 내용(409)은 새 키로 한 번 자동 재전송한다.
- **진행 표시:** 작업 ID가 있으면 `GET /api/v1/jobs/{jobId}`의 단계·진행률과 revision을 폴링한다. revision이 증가한 응답만 반영하며 재시도로 진행률이 낮아질 수 있다. 복원에서 작업 ID를 모르면 `GET /api/v1/songs/{id}`를 쓰고 분리·생성 두 칸을 함께 표시한다. 폴링 간격은 30초까지 3초, 10분까지 5초, 그 뒤 15초이며 탭이 숨겨지면 멈추고 다시 보이면 즉시 조회한다. 404·인증 오류는 중단하고 안내하며 일시 오류는 기존 표시를 유지한다. WebSocket은 사용하지 않는다.
- **복원:** 활성 작업 하나를 `localStorage`(`ssaplash.chartJob.v1`)에 두고 새로고침·재방문 때 이어서 폴링한다. 429인데 기록이 없으면(다른 브라우저) 라이브러리의 PROCESSING 곡으로 복원한다. 끝난 작업 기록은 이 화면이 `clear`로 지운다.
- **카드 보기·목록 보기:** 목록 위 오른쪽 [카드 | 목록] 토글로 바꾸고(기본 카드) 고른 값은 `localStorage`(`airdrum.studio.view`)에 기억한다(접근이 막히면 기본값). 카드는 큰 정사각 커버 아래 제목(굵게, 1줄 말줄임)·아티스트(흐리게), 그 아래 한 줄에 상태 배지·MIDI 칩, 맨 아래 동작(완료 [악보 연습], 실패 사유 한 줄(BE 실패 코드를 사용자 문구로 변환하며, 사유가 없거나 알 수 없으면 "채보를 만들지 못했어요")과 [다시 올리기])이다. 카드에는 날짜가 없다(목록 보기에만). 완료 곡의 리듬 게임은 커버 오른쪽 아래 둥근 ▶(`aria-label` "「제목」 리듬 게임", `/play`)로, 마우스 기기는 카드 hover·`focus-within` 때, 터치 기기(`@media (hover: none)`)는 항상 보인다. 그리드는 `repeat(auto-fill, minmax(240px, 1fr))`이라 데스크톱 3열·태블릿(안내 패널 옆) 2열·폰 1열이다. 실패 카드는 커버가 흐리다. 커버(`SongSummary.coverUrl`, 서명 URL 1시간)가 없거나 불러오지 못하면 모든 곡에 같은 CD 기본 커버(`SongCover`의 SVG)를 그린다. 직접 올린 커버만 이미지로 보인다. 커버 이미지를 못 불러오면(서명 URL 만료) 목록을 다시 읽어 새 URL을 받는다(카드 여럿이 실패해도 1분에 한 번, `songCover.coverRefreshDue`). 목록 보기는 한 패널 안의 64 높이 행(커버 44·제목·보조 줄·상태 배지·날짜·동작·⋯)이다. 로딩은 스켈레톤 카드, 목록 오류는 안내 카드와 [다시 시도]다. 스타일은 `components/studio/studio.css`에 있다.
- **내 곡 편집(기능 스위치 `VITE_SONG_EDIT`, 기본 켜짐, `false`로 빌드하면 숨김):** 켜져 있으면 카드 커버 오른쪽 위(목록 보기는 행 끝)에 ⋯ 메뉴(`aria-haspopup="menu"`, Esc·바깥 클릭으로 닫힘)가 생긴다. 완료 곡 = [커버 변경] [곡 정보 수정] [곡 삭제], 실패 곡 = [곡 삭제]만, 처리 중 곡은 메뉴가 없다(`songEdit.menuKinds`, BE는 처리 중 곡의 커버 변경을 허용하지만 FE는 열지 않는다). `VITE_SONG_EDIT=false`면 카드 보기·기본 커버만 나가고 메뉴는 없다(BE 187 배포 전에는 404 방지로 기본 꺼짐이었다). 항목마다 작은 창(머리에 제목과 ✕)이 따로 열리고 저장·삭제 중에는 입력·✕·Esc·배경 클릭이 잠긴다. 오류는 창 안 문구로 보인다.
  - **커버 변경:** 지금 커버(없으면 기본 커버) 미리보기 · [이미지 고르기](JPG·PNG·WebP, 원본 10 MiB 이하) · [커버 지우기](기본 커버일 때 비활성) · [취소] [저장]. 고르면 가운데를 정사각형으로 잘라 512×512 JPEG(품질 0.85)로 줄여 미리본다(`media/coverImage`, 크기 계산은 `songCover.centerSquareCrop`). 바뀐 게 없으면 저장이 꺼진다.
  - **곡 정보 수정:** 제목(1~100자, trim 후)·아티스트(0~100자), 칸 아래 글자 수 안내. 바뀐 필드만 PATCH로 보내고 아티스트를 비우면 `""`를 보낸다(`domain/songEdit`).
  - **곡 삭제:** "「제목」을 삭제할까요?" + "채보·반주·커버가 함께 지워지고 되돌릴 수 없습니다. 연주 기록과 결과는 남아요." 확인 후 [삭제](위험 버튼, 진행 중 "삭제 중…"). 끝나면 화면 아래 알림 "「제목」을 삭제했습니다."(3초, `StudioToast`, `role="status"`)를 띄우고 목록을 다시 읽는다. 지운 곡이 `chartJobStore`의 활성 작업이면 그 기록도 `clear`한다.
  - **삭제된 곡의 기록:** BE는 곡을 소프트 삭제해 연주·리포트를 남기고, 지운 곡의 상세는 404 `SONG_NOT_FOUND`다. 결과 화면은 BE 곡 로그면 곡 상세를 한 번 조회해 404일 때만 제목 옆에 "삭제된 곡"을 붙이고 [다시 하기]·Enter를 숨긴다([다른 곡]·[자유 연습]·상세 분석은 그대로). 다른 실패(네트워크·5xx·401)는 삭제로 보지 않는다(`api/songs.checkSongAvailability`, `domain/songAvailability`).
  - **성공 후:** 창 닫기 → `songEditStore.reset` → 목록 다시 읽기 → 편집한 카드 2초 강조(삭제는 강조 없음). 403 `SONG_FORBIDDEN`·409 `SONG_BUSY`·400·413·415·503 `COVER_UNAVAILABLE`(저장소 장애)는 창 안에 문구, 404 `SONG_NOT_FOUND`는 문구와 함께 목록을 다시 읽고, 네트워크·5xx·알 수 없는 코드는 "결과를 확인하지 못했습니다. 목록을 확인해 주세요."와 함께 목록을 다시 읽는다. 상태는 `songEditStore`(`idle`·`saving`·`done`·`failed`, 실행 중 재호출 무시).
  - **API(BE 187 합의, develop-BE 병합·운영 반영 전. 반영되면 스위치를 켠다):** `PATCH /api/v1/songs/{id}` JSON `{title?, artist?}` → 200 상세 · `PUT /api/v1/songs/{id}/cover` multipart `file`(≤ 2 MiB) → 200 `{coverUrl}` · `DELETE /api/v1/songs/{id}/cover` → 204 · `DELETE /api/v1/songs/{id}` → 204. 오류 코드는 `SONG_INVALID`·`SONG_FORBIDDEN`·`SONG_NOT_FOUND`·`SONG_BUSY`·`COVER_INVALID`·`COVER_TOO_LARGE`·`COVER_UNSUPPORTED`·`COVER_UNAVAILABLE`. 목록·상세 응답에는 `coverUrl: string | null`(서명 URL, 1시간)이 더해진다. 커버는 2 MiB·4096px·400만 픽셀 이하. 곡 삭제는 소프트 삭제다.
- **제외(후속):** 곡 선택 창의 커버 표시, 진행 WebSocket(BE 161).

## 내 악보 보관·보기 (CHART-001, 278번)

회원이 드럼 악보(이미지·PDF)를 올려 두고 라이브러리에서 골라 본다. 음원 없이 악보만 보관해 합주실·연습실에서 꺼내 보는 것이 주 용도다. BE 155 `/api/v1/sheets`(`api/sheets`), 도메인은 `domain/sheetMusic`.

- **기능 스위치:**
  - `VITE_SHEET_ARCHIVE`(`SHEET_ARCHIVE_ENABLED`): 기본 켜짐, `false`로 빌드하면 [악보] 섹션·악보 항목을 숨기고 뷰어 주소는 `/studio`로 보낸다.
  - `VITE_SHEET_SONG_LINK`(`SHEET_SONG_LINK_ENABLED`): 기본 꺼짐, `true`일 때만 곡 연결을 쓴다. 지금 BE는 `files`·`title`·`source` 외 파트를 400으로 거절하므로, BE가 곡 연결(`songId`·`sheetId`)을 배포한 뒤 켠다.
- **올리기:** 헤더 [올리기] 창 맨 위 [음원·MIDI | 악보] 전환(마지막 섹션은 localStorage `airdrum.studio.uploadSection`). [악보]는 이미지(JPG·PNG·WEBP) 1~20장 또는 PDF 1개 + 제목(1~100자). 고른 순서가 쪽 순서다. 섞음·21장 이상·형식·크기(이미지 10 MiB, PDF 20 MiB)는 요청 전에 `validateSheetFiles`로 막고, 화소 상한·한도(100개·500 MiB)는 BE 응답 문구를 보인다(`sheetErrorText`). 헤더에서는 곡 없이 올린다. 첫 방문(곡·악보 없음)에는 본문에 음원·MIDI 패널이 있으므로 헤더 [올리기]가 [악보] 섹션으로만 열린다.
- **라이브러리 악보 항목:** 곡에 연결되지 않은 악보는 카드·목록 보기에 곡과 섞여 한 항목으로 보인다(`mergeLibraryItems`, 정렬은 내 곡 규칙의 「그 밖」 그룹). 썸네일(이미지 1쪽, PDF는 자리표시) · 「악보 · 이미지 n쪽」/「악보 · PDF」 · 「악보만」 칩 · [악보 보기]. 리듬 게임·악보 연습은 비활성이고 「음원이 있어야 할 수 있어요」를 단다. ⋯ = [제목 수정 | 악보 삭제]. 악보 목록만 실패하면 곡은 그대로 두고 「악보를 불러오지 못했어요 [다시 시도]」 한 줄. 곡 고르기(리듬 게임·악보 연습)는 곡 API만 읽으므로 악보 항목이 나오지 않는다.
- **곡 연결(링크 스위치 켜짐):** 완료 곡 ⋯ 메뉴에 `sheetId`가 있으면 [악보 보기], 없으면 [악보 올리기](창이 [악보] 섹션으로 열리고 `songId`를 보낸다). 409 `SHEET_ALREADY_LINKED`·404 `SONG_NOT_FOUND`는 창 안 문구. 링크가 켜져 있으면 곡에 붙은 악보는 따로 항목으로 보이지 않는다.
- **뷰어 `/studio/sheets/:id`(`pages/SheetViewerPage`, `components/sheet`):** 셸을 숨긴 전체 화면. 이미지는 한 쪽씩(← → 키, 좌우 밀기, 좌우 25% 가장자리 탭, 다음 쪽 미리 받기), PDF는 `PdfPages`가 쪽을 화면 폭에 맞춰 세로로 그리고 화면 근처 쪽만 그린다. 바에 n/m, 가운데 탭으로 몰입 모드(바 숨김, n/m 칩만). ⋯로 제목 수정·삭제(삭제 뒤 `/studio`로 가며 토스트). 600px 이하에서는 뒤로 아이콘만 남기고 좌우 버튼·종류 배지를 숨긴다.
- **서명 URL(1시간):** 만료 2분 전에 상세를 다시 읽어 URL만 바꾼다(보던 쪽 유지, 최소 30초 간격). 그림·PDF 읽기 실패는 상세를 1회 다시 읽고 또 실패하면 [다시 시도]. 404 `SHEET_NOT_FOUND`는 「지워졌거나 주소가 틀렸어요」 + [라이브러리로]. URL·파일은 메모리에만 둔다.

## 결과·연주 기록

- **결과(`/result/:playId`, Figma 112:1194):** 로컬 로그(`engine/playLog.getPlayLog`)를 읽어 요약 카드(`result/ResultSummaryCard` — 왼쪽 제목·메타, 오른쪽 지표 묶음 [점수/최고 콤보 | 세로선 | 정확도 64], 간격 48·아래 정렬) → 상세 분석 진입(`ReportEntry`) → 판정 분포(`JudgeBars`)·타이밍 분포(`TimingHistogram`, 계산 `domain/timingHistogram`) → 피드백 카드 최대 3장(`FeedbackCard`, 악보 모드 + 업로드 대상 아님만)·약점 마디 미니 악보 → 패드별 표(`PadSummaryTable`, 모든 모드) → 버튼 행 순으로 그린다. 악보 모드는 요약 카드에 점수 블록과 세로선이 없다. 패드별 표의 정확도·평균 세기는 `domain/feedback.summarizeByPad`가 계산하고(평균 세기 = 판정된 노트에 매칭된 타격 velocity 평균 → 0~100, 로그에 hits가 없으면 「—」), 평균 타이밍 열은 ≤1024px에서 숨긴다. 기록이 없는 id는 `ui/EmptyState`로 안내한다. 삭제된 곡이면 제목 옆에 `song/DeletedSongChip`을 붙이고 [다시 하기]·Enter를 숨긴다.
- **연주 기록(`/history`):** 로그인 사용자는 `GET /api/v1/plays`의 모든 페이지를 읽고 이 계정의 로컬 전용 기록과 `playId`로 중복 없이 합친다. 모드·제목 검색·정렬은 전체 합친 목록에 적용하고 10행씩 표시한다. 서버에 리포트가 있으면 `/result/:playId/report`로 바로 열며, 로컬에만 있는 기록은 기존 결과 화면을 연다. 리포트도 로컬 기록도 없으면 진입 링크가 없다. 서버가 접근 불가로 반환한 곡은 제목 대신 안내하며, 로컬 기록은 기존 곡 삭제 검사를 쓴다. 조회 실패는 빈 목록과 구분하고 재시도할 수 있다. 비로그인 개발 모드는 이전처럼 로컬 기록만 쓴다. 계정 변경 시 진행 중인 이전 요청은 중단하고 결과를 버린다.

## 연주 녹음·녹음 보관함 (REC-001, `src/components/recording`)

- **기능 스위치 `VITE_RECORDING`:** 기본 켜짐. `false`로 빌드하면 Dock 녹음 버튼·저장 창·토스트·연주 기록의 [녹음] 탭을 숨긴다(`app/features.RECORDING_ENABLED`). 꺼져 있으면 Dock·AppShell·연주 기록 마크업은 녹음 기능 이전과 같다. UI 완료·로컬 BE 검증 뒤 11/4에 켜짐으로 전환했다(설계 U6).
- **녹음이란:** 타격 시퀀스(`tMs`·`pad`·`velocity`·`stickId`)만 저장한다. 소리·화면 녹화가 아니고 재생은 FE가 드럼 소리로 다시 연주한다. 타입·본문 조립·기본 제목(`{곡 제목} · {M월 D일 HH:mm}`, 자유 연습은 `자유 연습 · …`, 100자 자르기)은 `domain/recording`, 화면 문구(모드명·요약·경과·타격 수)는 `domain/recordingView`.
- **Dock 녹음 버튼(`recording/RecordButton`, Figma Navigation / DockRecord 523:31016):** `/free`·`/play`·`/sheet`에서만 [BPM +] 오른쪽에 보인다(`recordButtonRoute.recordButtonVisible`). 자유 연습은 누를 때마다 시작·정지(`녹음 중 · mm:ss` 경과 표시), 리듬 게임·악보 연습은 연주 전에 켜 두는 스위치(`녹음 켬`)로 연주 단계(카운트인 포함)에는 잠긴다(`locked-on` "녹음 중" / `locked-off` 흐림). 저장 창이 열린 동안도 잠긴다. 점은 모든 상태에서 같은 빨간 원이고 상태는 글자·테두리·흐림으로만 구분한다. 접힘 Dock은 녹음 중일 때만 BPM 점 옆에 작은 빨간 점. 상태 기계(idle → armed/recording → pendingSave → saving → idle/failed)는 `app/recordingStore`.
- **저장 흐름:** 자유 연습은 정지 때, 게임·악보는 곡이 끝난 뒤 플레이 로그 타격(`PlayRecorder.hits`의 `tSongMs`)에서 본문을 만들어 결과 화면 위에 저장 창(`recording/SaveRecordingDialog`, AppShell에 한 번 마운트, 폭 560, Esc·배경 클릭으로 닫히지 않음)이 뜬다. 제목 입력칸은 기본 제목이 전체 선택된 채 열리고, 비우면 기본 제목. [저장] → `POST /api/v1/recordings`(`app/recordingSync`: 503은 같은 본문·같은 `clientKey`로 1·2·4초 최대 3회 자동 재시도, 네트워크·5xx·401은 [다시 시도], 409·400·404·413은 [닫기]만, 코드 없는 Nginx 413은 "너무 길어 저장하지 못했어요"). 게임·악보는 플레이 로그 업로드가 `DONE`일 때만 `playId`를 싣는다. 타격 0개면 저장 창 대신 토스트. 자유 연습은 50,000타·2시간에 닿으면 자동 정지. 저장 완료 토스트(`recording/RecordingToast`, 하단 중앙 4초)의 [보관함]은 `/history?tab=recordings`로 간다. 미전송 녹음은 메모리에만 있어 새로고침하면 사라진다(설계 U4).
- **녹음 보관함(연주 기록 [녹음] 탭, `recording/RecordingList`, Figma 524:32144):** `GET /api/v1/recordings`를 모드 토글(전체·자유·게임·악보)·제목 검색(300ms 디바운스)·정렬(최신·오래된)로 20건씩 받고 [더 보기]로 이어 붙인다(`useRecordingList`). 행(Figma Recording / RecordingRow 523:31333)은 [재생]·제목(곡 녹음은 아래에 곡 제목 + 난이도 배지)·모드·녹음 시각·길이·타격·⋯. [재생]은 그때 상세(`GET /recordings/{id}`)를 받아 `engine/recordingPlayer`가 100ms 창 look-ahead로 드럼 소리를 예약해 재연주하고 진행 바를 그린다(`useRecordingPlayback`, 한 번에 한 행, 정지는 0.1초 안). ⋯ 메뉴(`ui/MoreMenu`, Figma Studio / MoreMenu `kind=recording` 799:37487)는 [MIDI로 내보내기](타격 0개면 숨김, 아래 항목)·[제목 변경](`RecordingTitleDialog`, 1~100자, `PATCH`)·[삭제](`RecordingDeleteDialog`, 확인 창, `DELETE`). 404 `RECORDING_NOT_FOUND`면 "이미 지워진 녹음이에요" 토스트 뒤 목록을 다시 받는다. 보관함은 계정당 200개(저장 413 `RECORDING_QUOTA_EXCEEDED`).
- **MIDI 내보내기 (REC-002):** ⋯ → [MIDI로 내보내기]를 누르면 상세(`GET /recordings/{id}`)를 받아 `domain/recordingMidi.recordingToMidi`가 SMF Type 0(트랙 1개, 트랙 이름 "Drums", 채널 10)을 만들고 `media/downloadFile.downloadBlob`이 `{제목}.mid`로 내려받는다(파일명은 `\ / : * ? " < > |`·제어 문자를 빼고 80자, 비면 `recording-{id}.mid`). 바이트 쓰기는 `domain/midiFile.writeMidiFile`, 외부 라이브러리는 쓰지 않는다. 노트는 패드마다 GM 번호 하나(BE 시드의 대표 피치): KICK 36 · SNARE 38 · HIHAT 42 · HIHAT_PEDAL 44 · SMALL_TOM 50 · MID_TOM 47 · FLOOR_TOM 43 · CRASH 49 · RIDE 51. 친 시각은 퀀타이즈하지 않는다. 게임·악보 녹음은 상세 `timing`(녹음 당시 채보 버전)의 `ppq`·`tempoMap`·`timeSignatureMap`을 넣고 `offsetMs`를 1마디 1박에 맞추며, 그보다 앞에 친 타격이 있으면 첫 박자표 길이로 앞 마디를 덧붙인다(tick 0에 첫 템포·박자표도 둔다). `timing`이 없거나 값이 이상하면(자유·박자 모드 포함) 120 BPM · 4/4 · ppq 480 · 원점 0ms이고, 곡 녹음이 이렇게 나가면 "곡 빠르기 정보가 없어 120 BPM으로 내보냈어요" 토스트가 뜬다. 분모가 2의 거듭제곱이 아닌 박자표는 4/4 하나로 바꾼다(템포는 유지). 세기는 1~127(0은 note-off로 읽혀 1로 올림), 노트 길이는 `ppq/8`이되 같은 노트의 다음 타격 1 tick 전에 끝내고, 같은 tick 같은 노트는 하나로 합친다(세기는 큰 쪽). 같은 녹음을 내보내는 중에는 다시 눌러도 조회하지 않는다. 테스트: `domain/midiFile.test.ts`, `domain/recordingMidi.test.ts`, `recording/RecordingList.midi.interaction.test.tsx`.
- **로컬 확인:** BE(256·257 포함)를 띄운 뒤, 자유 연습에서 녹음 → 저장(201) → 연주 기록 [녹음] 탭에서 목록·재생·MIDI 내보내기·제목 변경·삭제를 확인한다.

## 플레이 기록 업로드·상세 분석

- **흐름:** 연주 종료 → 로컬 저장 → 결과 화면(로컬 값, 기다리지 않음). 동시에 `app/playSync.startPlaySync`가 `POST /api/v1/plays`(ACCT-002 요약)를 보낸다. 성공하면 리포트 요약과 노트 첫 페이지를 미리 받아 두고 결과 화면의 **상세 분석 보기**가 `/result/:playId/report`로 열린다.
- **playId:** 연주마다 UUID(`newPlayId`). 이전 로그(`play-…`)는 업로드하지 않는다.
- **seq:** `engine/playRecorder`가 활성 타격과 MISS 판정에 처리 순서대로 번호를 매긴다. 서버가 seq 순서로 maxCombo를 다시 계산하므로 이 순서가 어긋나면 400이다.
- **본문 조립:** `domain/playUpload.buildUploadBody`. 판정 타격 `tMs` = 노트 시각 + Δ, MISS `tMs` = 노트 시각, 정확도는 `score / 전체 노트 수` 백분율 소수 둘째 자리 HALF_UP. 입력은 실제 스틱(ble·webserial·websocket)만 `STICK`, 키보드·포인터는 `KEYBOARD`(센서 필드 null). `consent`는 플레이 시작 시점에 로그에 저장해 둔 값(`PlayLog.consent`)을 `domain/dataConsent.logConsent`로 싣는다. 필드가 없는 옛 로그는 `false`.
- **업로드하지 않는 경우(SKIPPED):** 내장 곡, 이전 로그, 변환에서 버린 노트가 있는 채보, 자유 연주, 50,000행 초과. 결과 화면 버튼에 사유가 나온다.
- **실패·재전송:** 상태는 로그의 `upload`(UPLOADING·DONE·FAILED·SKIPPED)에 저장한다. 처음 조립한 본문을 보관해 같은 playId로 그대로 다시 보낸다(같은 UUID에 다른 내용은 409). 네트워크·5xx·401·`PLAY_STATE_CHANGED`는 재시도 가능, 400·404·그 밖의 409·413은 불가. 결과 화면에 들어올 때 한 번 자동 재전송하고 이후는 **다시 시도** 버튼.
- **상세 분석:** 서버 데이터만 쓴다. `api/reports`가 정확도(0~100 → 0~1)·패드 옛 이름·null을 변환하고, 노트는 `limit` 1000으로 `nextAfterSeq`가 null일 때까지 받아 시간순으로 정렬한다(seq는 시간순이 아니다).
- **AI 약점 구간(COACH-003, `components/report/WeakSegments`):** 리포트의 `weakSegments`를 `api/reports.toWeakSegments`가 화면 타입으로 바꾼다. 배열이 아니면 null(미분석·실패), `[]`는 "약점 없음". `description`은 서버 한국어 문장을 그대로 보여 주고 `pattern`으로 분기하지 않는다(모르는 패턴·`metrics` 키는 통과). 카드는 서버 순서 그대로 `scope: WHOLE`("연주 전체") 그룹을 위에, `SEGMENT`를 아래에 두고, 구간 머리 줄 왼쪽은 초가 아니라 **마디**(로그에 bpm·박자가 있으면 게임·악보 모두 `segmentBars`로 환산, 없으면 없음)이고, 이어서 심각도 뱃지와 패드 칩(`ui/Chip`)이 온다. 심각도 단계는 `segmentLevel`이 `severityLevel`(`LOW`/`MEDIUM`/`HIGH`)을 쓰고 없으면 `severity ≥ 0.7`을 HIGH로 폴백하며, HIGH는 「주의」(miss 빨강), MEDIUM은 「보통」(`--warn` 노랑), LOW는 뱃지 없이 강조선 색(`level-*`)만 다르다. 「연주 전체」도 머리 줄을 그리되 칩은 없다. 카드는 좌우로 나뉘어 왼쪽에 설명(`description`)·상세(`detail`, 선택)·「연습 방법」(`tip`, 선택)을, 오른쪽에 구간 재생 패널을 두며(≤1024px는 위아래), 선택 필드는 없으면 그 줄을 그리지 않고 문구는 가공하지 않는다. **총평 카드**(`CoachSummaryCard`)는 리포트 머리 아래·요약 위에 「코치의 한마디」·레벨 뱃지(`summaryBadge`, 모르는 값은 뱃지 없음)·「AI가 작성했어요」·본문을 보이며 `coachSummary`가 null이면 그리지 않는다. **구간 재생**은 서버 소리가 아니라 리포트 노트(`GET /report/notes`, 다른 기기에서 열어도 동작)를 `planSegment`로 구간 일정으로 바꿔 `SegmentPlayer`가 `AudioEngine` 합성음으로 예약하고, 채보 자산의 반주 URL(`getChartAssets`, 내장 곡·실패면 없음)이 있으면 `Accompaniment`로 같은 구간 반주를 함께 재생한다. 「느리게 0.75×」(합성음 일정 연장 + 반주 `playbackRate`)와 「반복」(구간 끝 300ms 뒤 재시작)은 다음 재생부터 적용되고, 한 번에 한 구간만 재생하며(`useSegmentPlayer`가 페이지당 플레이어 하나) 페이지를 떠나면 멈춘다. 노트가 로딩·실패면 재생 버튼은 비활성이다. 상태별 안내: `PENDING`은 "분석 중" + 재조회, `DONE`+`[]`는 판정 수 합이 20 미만이면 "곡이 짧아 분석하지 않았어요"(`isTooShortForAnalysis`, 분모는 PERFECT+GOOD+MISS로 AI와 합의. BE가 사유를 저장하지 않아 FE가 추정) 아니면 "뚜렷한 약점 없음", `FAILED`는 실패 안내(나머지 리포트는 정상), `NOT_REQUESTED`는 "분석 대상이 아니에요". 추천 연습(`recommendedDrills`)은 아직 해석하지 않는다.
- **PENDING 재조회:** 리포트 페이지가 `app/analysisPoller`로 2초 간격 최대 5회 `GET /report`만 다시 받는다(`playSync.refreshReport`, 프리패치 캐시의 리포트만 교체하고 노트는 유지). 5회 뒤에도 PENDING이면 "잠시 뒤 다시 확인" 안내와 **새로고침** 버튼(5회 재시작). 결과 화면은 재조회하지 않는다.
- **결과 화면 분석 일원화:** 플레이마다 분석 생성기는 하나다. 업로드 대상 플레이(`domain/report.isUploadTarget`: 서버 형식 로그이고 SKIPPED·재시도 불가 FAILED가 아님)는 결과 화면에 로컬 피드백 카드·미니 악보·패드 요약 표를 보이지 않고, **상세 분석 보기** 버튼 설명이 프리패치 리포트의 분석 상태를 보여 준다(`domain/report.analysisTeaser`: "분석 중" / "AI가 약점 n곳을 찾았어요" / "뚜렷한 약점 없음" / "분석 실패"). 업로드가 생략되거나 재시도 불가로 실패한 플레이만 "간단 피드백" 제목으로 로컬 카드를 보여 준다.

## 실시간 코칭 (COACH-001, `src/coach/live`)

플레이 중 최근 판정 흐름에서 경향(계속 늦음, 한쪽 손 약함 등)을 뽑아 짧은 문구로 알리는 **규칙 모듈**이다. 서버를 거치지 않고 브라우저에서만 동작한다. 모듈은 판정 한 건을 받아 문구 후보(`tag`+대상)를 돌려주고, 리듬 게임(`PlayPage`)과 악보 연습(`SheetPage`)이 이를 받아 연주 안내 칸(`GuideSlot`)에 띄우고 플레이 로그에 남긴다. 규칙·문구·표시 정책은 두 모드 공통이고 로그는 업로드 본문 `mode`(`RHYTHM`/`SHEET`)로 가른다. 모듈 폴더(`coach/`)는 FE가 관리하고, 고치면 AI 파트에 알린다.

- **쓰는 법:** `new LiveCoach({ goodMs, enabled? })`로 만들고, 판정(`onJudgement`)마다 `push({songTimeMs, noteTimeMs, judgement, deltaMs, pad, stickId, velocity})`를 부른다. 문구를 띄울 때만 `{tag, text, severity, tMs, displayMs, target, repeat}`를 돌려주고 아니면 `null`이다. `events()`는 업로드 본문 `liveCoachEvents[]`에 그대로 담을 `{tMs, tag, text}` 목록이다. 재시작(다시 하기)에서 `reset()`. 일시정지 중에는 `push`를 부르지 않는다. 코칭 오류로 플레이가 멈추지 않도록 `push`는 예외를 던지지 않는다.
- **연결(`PlayPage`·`SheetPage`):** `new LiveCoach({ goodMs: settings.timing.goodMs, enabled: settings.liveCoach })`를 만들어 설정값을 고정한다(도중 설정 변경은 다음 플레이부터). 리듬 게임은 곡 선택 시점, 악보 연습은 준비 세션을 `useMemo`로 만들어 곡 선택 시점이 따로 없으므로 연주 시작(`begin`) 시점에 만든다. 안내 칸 기본 문구(리듬 게임 「노트에 맞춰 연주」, 악보 연습 「악보 연습」)로 돌아오는 규칙은 같다. `onJudgement`에서 기록·팝업·HUD 갱신 뒤에 `push`하고, 문구가 나오면 `coachCopy`로 화면 문구를 만들어 `useCoachLine`(`components/play`, 타이머 규칙은 순수 모듈 `coachLineTimer`)에 `displayMs`(3초) 동안 올린다. 다시 하기에서 `reset()`과 문구 비움, 종료 시 `events()`를 `buildPlayLog`의 `liveCoachEvents`로 넘긴다. 변환·표시는 try/catch로 감싸 코칭 오류가 플레이를 막지 않는다.
- **화면 문구(`coach/live/copy.ts`):** 모듈의 `text`는 로그 전용이고 화면은 `coachCopy(message)`가 돌려주는 짧은 제목(지적 ≤10자, 칭찬 ≤13자)·보조(≤16자)·모드를 쓴다. 같은 태그가 다시 뜨면 `message.repeat` 순서로 제목을 돌려 쓴다. 대상이 있는 태그는 `message.target`(패드 또는 손)으로 "{패드}만 늦어요"·"{왼손/오른손}이 약해요"를 만든다. `GuideSlot` 모드는 태그로 정한다 — `LIVE_MISS_STREAK`만 `coach-warn`, 나머지는 `coach-info`(`severity`는 아직 화면에 쓰지 않는다). 안내 칸(220×51)은 코칭 모드에서 라벨("실시간 코칭")+제목 두 줄만 보인다 — 보조까지 세 줄이면 넘친다. 문구·톤은 이 파일에서만 고친다.
- **손·세기:** `RhythmSession`의 `JudgementEvent`에 `stickId`·`velocity`가 있다. `handleHit`이 `ResolvedHit`에서 채우고, MISS(`tick`)와 키보드 타격(`source === 'keyboard'`, 손이 자리값이고 세기가 고정이라 뜻이 없음)은 둘 다 null이다. 손 정보가 없으면 손별 규칙만 제외된다.
- **패드 규칙 대상:** `STICK_PADS`(스틱 7개)만 평가한다. 킥·하이햇 페달은 평가하지 않는다(COACH-001 D5). 페달 판정은 손·세기가 null이라 손별 규칙에서도 자연히 빠진다.
- **패드 이름(`coach/live/padName.ts`):** 코칭은 화면 키트와 같은 이름(탐1, 탐2)을 쓴다. 패드 놓침의 보조 문구는 키보드면 키(`E·I`), 스틱이면 위치(왼쪽 탐)를 알려 준다.
- **세팅 안내**(`setupHints.ts`): 연주가 아니라 세팅이 원인으로 보일 때 안내한다. `LIVE_SETUP_OFFSET`(최근 16개가 모두 유효 타격이고 평균 |오차| 45ms 이상, 표준편차 20ms 미만, 같은 부호 90% 이상), `LIVE_SETUP_PADS`(최근 16개 중 MISS 50% 이상이고 채보 밖 타격이 MISS의 절반 이상). 스틱 입력(`ble`, `websocket`)에서만, 태그별 한 번, 지적보다 먼저 뜬다. 결과 화면의 `SetupHintCard`가 설정의 타격음 지연 보정이나 `/setup`으로 보낸다.
- **규칙 6종**(`rules.ts`): `LIVE_PAD_MISS`(최근 16개에서 전체 놓침 4개 이상, 한 패드가 3개 이상이고 놓침의 60% 이상이며 그 패드 노트의 50% 이상을 놓침. 스틱 패드만, 전체 놓침보다 먼저 뜬다) · `LIVE_MISS_STREAK`(연속 3번 또는 최근 6개 중 4개 놓침) · `LIVE_LATE`/`LIVE_EARLY`(최근 12개 평균이 `0.3 × goodMs` 이상이고 같은 부호가 75% 이상) · `LIVE_PAD_LATE`/`LIVE_PAD_EARLY`(한 패드가 나머지 패드보다 `0.45 × goodMs` 이상 늦거나 빠름) · `LIVE_HAND_WEAK`(한 손 평균 세기가 다른 손의 70% 미만) · `LIVE_UNSTEADY`(편차가 `0.5 × goodMs` 이상).
- **표시 정책**(`policy.ts`): 판정 8개 전에는 띄우지 않고, 지적 사이 4초, 같은 키는 10초, 한 번에 하나(놓침 > 늦음·빠름 > 패드 > 손 > 박자 > 칭찬). 플레이당 상한은 없다. 띄운 뒤 거두는 문턱(예: 늦음 평균 `0.15 × goodMs` 미만)을 만족하면 쿨다운 없이 다시 띄울 수 있다. 거둔 것은 로그에 `LIVE_RECOVERED`로만 남는다.
- **칭찬**(`rules.ts`의 `evaluatePraise`, `policy.ts`): 지적 후보가 없을 때만 뜬다. `LIVE_GOOD_RECOVERED`(지적한 경향이 사라지고 연주가 안정됨, 직전 문구에서 4초) · `LIVE_GOOD_STEADY`(창에 놓침 없고 평균·표준편차가 거두는 문턱 안) · `LIVE_GOOD_KEEP`(창의 놓침 2개 이하). 뒤의 둘은 직전 문구에서 6초 뒤에 뜬다. 창의 놓침이 3개 이상이거나, 활성 지적이 지금도 조건을 만족하거나 쿨다운 안이면 칭찬하지 않는다. 칭찬은 지적을 늦추지 않아서, 칭찬이 떠 있어도 지적이 바로 대신 뜬다. 화면 모드는 `coach-good`이다.
- **로그 태그:** 위 규칙 태그 + 칭찬 태그(`isPraiseTag`로 구분, 효과 평가와 방식 비교에서는 뺀다) + `LIVE_RECOVERED` + `LIVE_OFF`(코칭을 끈 플레이에 시작 시각 0으로 한 건. 효과 평가에서 "코칭 없음" 대조군을 가른다). BE는 `tMs`(유한 수)·`tag`(≤ 64자)·`text`(≤ 2048자)·최대 1,000개를 검증한다. `PlayLog.liveCoachEvents`(`engine/playLog`의 `LiveCoachEvent`, `coach`를 import하지 않는 구조적 타입)에 저장되고 업로드 본문(`domain/playUpload`)에는 `log.liveCoachEvents ?? []`로 실린다 — 기능 도입 전 로그는 빈 배열이라 "코칭 켬·문구 0개"와 구분되지 않으니 효과 평가는 `clientMeta.appVersion`·업로드 날짜로 거른다(AI에 회신함).
- **수치 고치는 곳:** 모든 임계값은 `coach/live/config.ts` 한 곳에 있다. 판정 폭에 비례하는 값은 `goodMs`에 곱하는 계수라서 사용자가 판정 폭(30~150ms)을 바꿔도 같은 비율로 따라간다. 수치는 가정값이므로 직접 플레이해 보며 여기서 고친다.
- **검증:** `npm test`(합성 플레이 시험·문구 표·타이머 규칙 포함: 계속 늦음에서 `LIVE_LATE`, 경향 없는 100플레이에서 지적 평균 0.5개 이하, 간격 준수, 거짓 칭찬 방지, 계산 시간 중앙값 0.2ms 이하).

## 반주 재생

- **버퍼 재생:** `audio/Accompaniment`가 서명 URL을 fetch해 `decodeAudioData`로 전부 디코드하고 `AudioBufferSourceNode`로 예약 재생한다. 소스는 전용 `accBus` 게인(`AudioEngine.accompanimentBus`, `master` 직결, 패드 음소거와 무관)에 연결한다. 같은 URL이면 다시 받지 않는다. 일시정지는 소스를 멈추고 위치를 기억하며 재개는 새 소스를 그 위치에서 예약한다(위치 계산은 `domain/accompanimentClock`).
- **시각 변환:** `AudioEngine.perfToContextTime`·`contextToPerfTime`이 `getOutputTimestamp` 기반으로 performance.now ↔ AudioContext 시각을 바꾼다(`trigger`·`click`도 같은 메서드를 쓴다).
- **PlayClock:** `engine/sessionClock.PlayClock`이 `RhythmSession`·반주·박 클릭 예약을 묶는다(클릭·반주는 주입). `begin()`은 반주 0초 = `now + lead(300ms) + max(0, 카운트인 − offsetMs)`로 `RhythmSession.start(at)`과 `accompaniment.start(at, 0)`을 같이 부른다. `start(at)`의 `at`은 곡 0ms가 울리는 performance.now 시각이다. 카운트인 클릭은 격자 원점 `offsetMs`(1마디 1박) 직전 1마디에 놓이고 곡 중 박 클릭도 `offsetMs + k·박`에 난다(`RhythmSession.originMs`). `offsetMs = 0`(내장 곡·MIDI)이면 전부 종전과 같고, `offsetMs`가 카운트인보다 길면 반주(인트로)가 먼저 시작돼 1마디 직전에만 클릭이 난다. `pause(reason)`·`resume()`·`restart()`·`stop()`·`onFrame(now)`·`songTime(now)`·`state`·`sync`를 제공한다. 재개는 예약 여유 50ms를 두고 세션 시계도 같은 만큼 뒤로 맞춘다.
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

Shift를 같이 누르면 악센트. 킥·하이햇 페달의 센서 입력은 페달 보드다([패드](#패드)). 사용자가 바꿀 수 없는 고정 매핑이며 `domain/keyMap.ts`의 `KEY_MAP` 상수로만 정의한다.

자유 연습(`/free`)은 치면 바로 울린다. 화면은 반주 바 → 캔버스 카드(`DrumKit` `fitWidth` 최대 1.25, ≤1024는 1.1) → 정보 띠(최근 타격 패드·손·세기 · 세션 통계 타격 수·평균 세기) 순이다.

- **반주 바**(`components/free/AccompanimentBar`, `S15P31A307-201`)는 없음·불러오는 중·재생 중·일시정지·오류 5변이다. [반주 고르기]는 선택 창(`AccompanimentPicker`)을 열고, 고르면 불러오는 즉시 처음부터 재생한다. 보조 줄은 모든 곡이 「드럼 뺀 반주」다.
  - **재생기**는 자유 연습 페이지가 하나 들고(`useFreeAccompaniment`) 떠나면 `unload`한다. 새로고침하면 없음으로 시작하고, 화면이 숨겨지면(`visibilitychange`) 일시정지하며 돌아와도 자동 재개하지 않는다. 곡이 끝나면 처음 위치에서 일시정지한다. 반주 URL은 곡 단위 API(`getSongAccompaniment`)로 받는다. `VITE_SONGS_SOURCE=builtin` 빌드에서는 [반주 고르기]가 비활성이다.
  - **진행 막대**(`SeekBar`)는 네이티브 range다. 누르기·끌기(손을 뗄 때 한 번 적용)·←/→ 5초·Home·End로 탐색하고, 일시정지 중 탐색한 위치는 [재생] 때 시작 위치가 된다. 문자·숫자 키(드럼 연주 키)는 막대가 쓰지 않는다.
  - **선택 창**은 공용 곡·내 곡 섹션을 같은 검색어(300ms 디바운스, 100자)로 따로 받고 섹션별 [더 보기]가 있다. 목록은 전역 곡 스토어를 쓰지 않고 `listSongs`(`withAccompaniment=true`)를 직접 부른다. 반주 없음·실패 곡은 거르고, 만드는 중인 곡은 흐리게 보여 줄 뿐 고를 수 없다. BE가 필터를 반영하기 전에는 FE가 거른 뒤 비면 다음 페이지를 이어 받는다(최대 3페이지).
  - 반주 오류 문구: 반주 파일 없음 / 곡 없음·삭제됨 / 곡 준비 중(409) / 그 밖 「반주를 불러오지 못했어요」. 오류여도 연주는 계속된다.
- **화면 상태**는 `domain/freeStage`가 정한다: 스틱 센서 + 양손 미연결이면 흐린 킷 위 빈 상태 카드와 [드럼 세팅에서 연결하기](복귀 띠로 돌아옴), 한 손만 끊기면 캔버스 위 `DisconnectBand`(연주 계속, [다시 연결]은 `reconnectStore`). 키보드 전용·포인터 모의 IMU는 항상 연주 상태다.
- 준비 안내(`ReadinessNotice`)는 이 화면에 두지 않는다 — 빈 상태·끊김 띠가 대신한다.
- 앵커 거리·패드별 횟수 같은 실측 표는 모니터 빌드의 「자유 연습 실측」 섹션(`pages/monitor/sections/FreeMeasureSection`)으로 옮겼다.

리듬 게임(`/play`)은 곡 선택(`SongPicker`) → 연주 준비(`play/ReadyPanel`, 연습 단계 EASY·NORM·HARD 선택·기기 준비 확인) → Enter로 시작 → 카운트다운(`play/Countdown`, 카운트인 마디의 남은 박 수를 화면 가운데 숫자로, 끝나면 「시작!」 0.4초) → 연주 순이다. 연주 중(`play` 단계)은 셸(사이드바·TopBar)을 숨긴 전체 화면이고 `PlayStage`(HUD·하이웨이·미니 킷)로 그린다. 일시정지는 Esc·스틱 연결 끊김·메뉴 요청(Dock ‖) 3종이고(`PauseOverlay`, 악보 연주와 같은 정책, HUD에는 일시정지 버튼이 없다) 그동안 노트가 멈추며 재개·처음부터·나가기(준비 화면)를 고른다. 곡이 끝나면 결과 화면으로 가며 플레이 로그는 localStorage에 계정별 최근 20건 남는다. 결과에서 Enter는 같은 곡 다시 하기.

**키보드 규칙(리듬 게임·악보 연습·결과):** 전역 keydown 핸들러(`PlayPage`·`SheetPage`·`ResultPage`·`KeyboardPadSource`)는 포커스된 조작 요소가 소유한 키를 가로채지 않고, `preventDefault`는 실제로 처리했을 때만 한다. 소유 판정은 `domain/keyTarget.isKeyOwnedByTarget(target, code)` 하나로 통일한다 — 입력 칸·`[role=dialog]` 안은 모든 키, button·a·`role=button|tab|link`는 Enter·NumpadEnter·Space만 소유하고 Esc 같은 그 밖의 키는 전역이 받는다. 새 전역 핸들러는 `e.isComposing`·`e.defaultPrevented`·이 함수를 먼저 확인한다. 연주 중(일시정지 아님)에는 포커스가 `body`여야 Space(킥)가 버튼 클릭으로 새지 않는다. 일시정지 다이얼로그(`PauseOverlay`)는 `components/ui/useDialogFocus`로 열릴 때 [재개]에 초점을 주고 Tab·Shift+Tab을 다이얼로그 안에서 순환시키며(계산은 `components/ui/focusCycle`) Esc는 재개이고 Enter·Space는 포커스된 버튼의 기본 동작이다. 닫힐 때는 이전 요소로 복원하지 않고 `body`로 보낸다(`returnFocus: 'blur'`, 기본값은 `'restore'`). 새 다이얼로그는 `components/ui/Dialog`로 감싼다(이 훅이 들어 있다). 내장 곡 결과의 [다시 하기]는 로그에 id가 없어도 `domain/playRetry.retryPathOf`가 `songId`로 내장 음수 id를 복구해 같은 곡 준비 화면으로 보낸다.

연주 화면은 항상 노트 하이웨이 + 미니 킷이다. `gameView` 설정값과 `KitPlayView`(킷 위 연주)는 코드로 남아 있지만 고르는 화면이 없다(설계 D5).

악보 연주(`/sheet`, 상단 "악보 연습")는 반주에 맞춰 마디가 고정된 5선 악보를 커서가 지나가는 것을 보며 치는 모드다. 점수·콤보는 화면에 없고 판정은 리듬 게임과 같은 `RhythmSession`이 한다.

화면은 Figma 05 악보 연습 흐름을 리듬 게임과 같은 공유 부품으로 조립한다(`SheetPage`가 `PlayPage` 구조를 따른다). 곡 선택은 `SongPicker mode="sheet"`(제목·최고 정확도), 준비는 `play/ReadyPanel`(`modeLabel="악보 연습"`·`staffLegend`로 「악보 읽는 법」 카드와 킷 연동, `options` 슬롯에 `play/PlayOptions`의 「연주 중 옵션」 카드), 연주는 `PlayStage variant="sheet"`(`PlayHud sheet`·`SheetPager`·`DrumKit`)다. 준비 화면에는 악보 미리보기가 없다(악보 읽는 법 카드가 대신한다). 연주 중은 셸을 숨긴 전체 화면이다. 악보 Canvas의 색은 `readColors(canvas)`가 `tokens.css`의 글자·브랜드·판정 토큰을 읽는다. 준비 화면 최고 정확도는 서버 최고 기록 API의 SHEET·선택 chartId에서 읽는다(273번, 아래 참고).

- **URL·단계:** `/sheet?song=&chart=`. 단계는 `select`(곡 선택) → `loading`(채보 + 반주 디코드, 반주는 `VITE_ACCOMPANIMENT_OVERRIDE ?? assets.accompanimentUrl`) → `ready`(곡 메타·준비 안내·시작) → `play`(+ 일시정지). 단계는 URL 파라미터·세션에서 렌더 중 파생한다. 반주 로드가 실패하면 "반주 없이 계속"(클릭만)과 "곡 선택으로"를 고른다. 변박 곡은 준비 화면에 "고정 템포로 표시" 안내가 뜬다.
- **반주·시계:** `PlayClock`이 세션·반주·박 클릭을 묶는다(`begin`에서 메트로놈 잠금, 종료·나가기·언마운트에서 해제). 반주 0초 = 세션 0ms이고 카운트인은 격자 원점 `offsetMs`에서 끝난다. 박 i의 시각은 `domain/tempo.beatTimeMs`로 구해 빠르기 구간이 있는 곡은 구간마다 그 BPM으로 클릭한다(카운트인은 첫 구간 BPM). 리듬 게임 마디선(`NoteHighway`)도 `offsetMs`부터 같은 함수로 그린다. 악보 화면은 고정 BPM 그대로다. 준비 화면 칩은 `offsetMs`가 1박 이상이면 "첫 박 n.n초"를 덧붙여 인트로 동안 커서가 서 있는 이유를 알린다.
- **화면(연주 중):** `PlayStage`가 위에서부터 HUD(`PlayHud sheet` — PERFECT·GOOD·MISS 수·경과/길이·연습 단계·BPM), 악보(`SheetPager`, 높이 420·전폭), 드럼 영역(안내 `GuideSlot`·`DrumKit` 0.7배·최근 타격 `HitReadout`)을 놓는다. 판정 색은 `noteStates` 배열을 판정마다 새 배열로 갱신해 `SheetPager`에 넘기고, 패드 위 다음 박 배지는 `play/useNextBeatLabels`가 `RhythmSession.notes`를 매 프레임 읽어 `DrumKit badges`로 낸다. 카운트인은 `Countdown` 숫자(남은 박 수, 끝나면 「시작!」 0.4초)다.
- **일시정지 3종(`components/PauseOverlay`):** Esc(`user`), 스틱·페달 연결 끊김(`disconnected` — `liveStore.connected`에서 어느 한 손, 또는 `liveStore.pedal.connected`의 어느 한 발이 true→false가 되고 센서 모드일 때만), `liveStore.pauseRequested === 'menu'`(E0 사이드바가 올리는 자리. 페이지가 일시정지 후 `null`로 되돌림). 재개는 준비 조건이 충족될 때만 활성(미충족이면 `ReadinessNotice`), 처음부터는 카운트인부터 다시(메트로놈 잠금 유지), 나가기는 기록 없이 준비 화면으로 돌아간다. 오버레이가 열린 동안 타격은 소리만 나고 세션에는 들어가지 않는다.
- **종료:** 곡이 끝나면 `mode: 'SHEET'` 로그(`chartVersionId`·`presetId` 포함)를 저장하고 `/result/:playId`로 이동한다. 결과 페이지는 SHEET 로그에서 점수·콤보 대신 정확도·판정 분포를 앞에 두고, 업로드가 생략된 플레이(내장 곡 등)에 한해 규칙 기반 "간단 피드백" 카드(최대 3개)와 패드별 요약을 보여 준다(업로드 대상 플레이는 리포트의 AI 약점 분석으로 일원화 — 위 "플레이 기록 업로드·상세 분석" 절). "같은 곡 다시"(Enter)는 `/sheet?song=&chart=`로 간다.

피드백 규칙과 임계값 상수는 `src/domain/feedback.ts`에 있다. 서버 AI 분석이 붙은 뒤로는 업로드가 안 되는 플레이의 폴백으로만 쓴다. 패드 Δ 표준편차 규칙의 기준은 35ms 고정이 아니라 `0.5 × goodMs`(goodMs 50이면 25ms)다 — 오차가 판정 폭 안에 갇혀 있어 고르게 흩어져도 표준편차가 약 0.58×goodMs라 고정값은 거의 걸리지 않았다(AI 쪽과 같은 수정). 로그에 BPM·박자가 없어 결과 페이지는 채보 없이 피드백을 만들므로 마디 범위가 필요한 규칙은 나오지 않는다.
악보 렌더(`components/SheetPager`)는 클라이언트 Canvas 5선이며 마디가 화면에 고정되고 커서가 왼쪽에서 오른쪽으로 곡 시각에 맞춰 지나간다. 한 페이지는 악보 영역 폭 900px 미만이면 2마디, 이상이면 4마디이고, 커서가 지나간 슬롯은 1박 뒤 다음 페이지의 마디로 흐리게 바뀌어 항상 앞을 읽을 수 있다(커서가 다음 페이지로 넘어가면 모두 정상으로 돌아온다). 연주 화면 아래의 드럼 킷(`DrumKit` + `useNextBeatLabels`)은 패드 위에 그 패드를 칠 다음 박 라벨(`1`·`1e`·`1&`·`1a`)을 보인다. 그 음이 판정(Perfect·Good·Miss)되면 다음 라벨로 바뀌고, 음표가 커서에 닿는 순간 해당 패드에 "지금" 링이 뜬다. 라벨은 준비 화면 "연주 중 옵션"(설정 `sheetPadCount`)에서 끌 수 있고, `prefers-reduced-motion`이면 커서가 박 단위로 이동한다. 계산은 순수 함수로 분리했다: 박 라벨 `domain/sheet.countLabel`, 패드 큐 `domain/padCue.padCues`, 페이지·슬롯·커서 `components/sheetPagerMath`.

**격자 원점(`offsetMs`):** BE 채보의 `notes[].timeMs`는 반주 0ms 기준 절대값이고 BE는 양자화하지 않는다. FE는 `timeMs − offsetMs`(격자 시각)로 16분 칸·마디 번호·커서·박 라벨·마디 수를 계산한다(`domain/sheet`의 `gridOriginMs`·`gridTimeOf`·`stepIndexOf`·`barCountOf`, `SheetModel.originMs`). 음원 곡만 `offsetMs`가 0이 아니다(MIDI·내장 곡은 0이라 결과가 같다). 격자 시각이 0보다 작은 동안(카운트인·인트로) 커서는 첫 슬롯 왼쪽에 서고 박 라벨은 남은 박 수를 센다. 가장 가까운 칸 중심에서 `stepMs / 4`(32분음의 절반, BE 솎기 허용 오차와 같음)보다 먼 노트는 `offGrid`로 표시해 라벨은 가장 가까운 칸을 쓰되 패드 배지 오른쪽 위와 악보 머리 옆에 작은 점을 찍는다(라벨을 끄면 점도 없다). 원점보다 앞선 노트는 0마디 0칸에 모으고 `offGrid`다(못갖춘마디 표시는 AI의 `offsetMs` 정의 회신 뒤 후속). 판정·업로드는 원본 `timeMs`를 그대로 써 점수에는 영향이 없다. 변박 곡(`variableTempo`)은 지원하지 않고 안내만 한다. 플레이 업로드 본문에 `padCountGuide`는 넣지 않는다(서버가 400으로 거부, `playUpload.test.ts`로 고정). 마디 그리기는 `drawSheet`를 슬롯마다 clip해 한 번씩 호출해 재사용하고, 패드 그리기는 리듬 게임 킷 뷰와 같은 `components/kitPadPaint`를 쓴다. 글리프 배치(보표 위치·머리·빔)는 `domain/sheet.layoutBar`다.
결과 페이지(로컬 카드가 보이는 경우)는 피드백 카드(`result/FeedbackCard`)가 가리키는 약점 마디를 `components/SheetSnippet`(정지 Canvas, 마디 폭 180~320px)으로 보여 준다. 그리기는 `components/sheetStripDraw`의 `drawSheet`를 `SheetPager`와 공유하고, 채보는 다시 조회하지 않고 로그에서 `domain/feedback.chartFromLog`로 만든다(`bpm`이 없는 이전 로그는 스니펫 없음). 플레이 로그에는 `offsetMs`가 남아 약점 마디 번호(`buildFeedback`)와 미니 악보가 악보 화면과 같은 격자 원점을 쓴다(`offsetMs`가 없는 이전 로그는 0). 카드를 누르면 구간이 바뀐다.

포인터 모의 IMU를 켜면 마우스 위치가 스틱 자세가 되고, F(왼손)/J(오른손) 또는 좌/우클릭이 타격이다. 이 두 키는 그동안 고정 키에서 제외된다. 방향키로도 자세를 움직일 수 있다.

## 로그인

자체 가입은 없고 소셜 로그인(Google·SSAFY)만 있다. 계약은 BE README "소셜 로그인"·"인증과 토큰" 절과 같다.

- **시작:** `/login`의 버튼이 `GET /api/auth/{provider}/login`으로 브라우저를 통째로 보낸다(fetch 아님). BE가 제공자 동의 화면으로 302한다. 돌아올 경로는 `sessionStorage`(`ssaplash.auth.returnTo`)에 두며 앱 안의 절대 경로만 허용한다(`domain/auth.ts` `sanitizeReturnTo`).
- **콜백:** 제공자 → BE 콜백 → BE가 refresh 쿠키(`refresh_token`, HttpOnly, `Path=/api/auth`, 14일)를 심고 `/auth/callback`으로 302. 이 화면은 앱 시작 복원을 기다렸다가 저장해 둔 경로로 간다. 토큰은 주소에 실리지 않는다.
- **복원:** 앱이 뜰 때마다 `authBootstrap`이 `POST /api/auth/refresh` → `GET /api/users/me`로 로그인을 복원한다(`authStore.restore`). access 토큰(30분)은 `api/auth` 모듈 메모리에만 있고 localStorage·sessionStorage에 쓰지 않는다. 복원 결과(`authenticated`/`anonymous`)에 따라 `app/presetBootstrap`이 프리셋 저장소를 서버/로컬로 맞춘다([프리셋](#프리셋)).
- **만료:** 보호 API가 401이면 `apiFetch`가 refresh를 한 번 하고 같은 요청을 다시 보낸다. 동시에 여러 401이 나도 refresh는 한 번이다. refresh가 401이면 300ms 뒤 한 번 더 시도하고(두 탭이 동시에 회전하면 진 탭이 이긴 탭의 새 쿠키로 성공한다), 그래도 401이면 `authStore`가 `anonymous`가 되고 `RequireAuth`가 `/login?error=session_expired`로 보낸다.
- **로그아웃:** 상단바 아바타 메뉴의 "로그아웃" → `POST /api/auth/logout`(204) → 메모리 토큰·활성 채보 작업 기록 폐기 → `/login`.
- **설정(`/settings`, 옛 마이페이지 `/me`는 여기로 이동):** 2열 카드. 왼쪽 계정(아바타·닉네임·로그인 제공자·[로그아웃])·기기(스틱 L·R 점과 연결 문구, 프리셋·보정 요약과 [드럼 세팅 열기] → `/setup`, 복귀 띠 「설정」)·오디오(전체 음량·드럼 음량(0~200%)·노래 음량(0~100%)·타격음 지연 보정 슬라이더, 값은 `settingsStore.volume`·`drumVolume`·`songVolume`·`audioOffsetMs`에 바로 저장. 안내 문구는 메트로놈만 Dock에서도 바꿀 수 있다고 적는다 — Dock에 음량 슬라이더는 없다), **데이터 활용**(계정 카드 아래, COACH-004 — 아래 항목), 오른쪽 연주(실시간 코칭 `liveCoach`, 기본 켬 — 리듬 게임·악보 연습 공통. 각 플레이 시작 시점 값으로 고정한다)·회원 탈퇴. 최근 플레이는 연주 기록(`/history`)이 맡는다. 라이브러리 요약은 두지 않는다.
- **플레이 기록은 계정별이다:** 로컬 플레이 로그 키는 로그인 계정마다 `ssaplash.playlogs.u{userId}`, 비로그인(인증 끔 개발 모드)은 `ssaplash.playlogs`. `app/authBootstrap`이 로그인 상태에 맞춰 `engine/playLog`의 주인을 바꾼다. 다른 계정의 기록은 최근 플레이·결과·악보 기록에 보이지 않는다. 계정 키가 생기기 전 기존 키의 기록은 계정으로 옮기지 않는다(누구 것인지 알 수 없다).
- **맞춤 곡 추천 학습 활용 동의(COACH-004):** `VITE_RECOMMENDATION_CONSENT_ENABLED=true`일 때만 신규 동의를 수집한다. 기본은 비활성이다. 공개 전 문구 확정과 BE 허용 판 반영이 필요하다. 동의 여부와 R1·R2는 독립이다. 서버의 GET/PUT이 원본이고 PUT은 항상 현재 판을 보낸다. 해당 판이 허용 목록에 없으면 422이며 기존 상태를 유지한다.
  - **설정 "데이터 활용" 카드:** 기존 동의자는 수집 비활성 중에도 상태 조회와 철회가 가능하다. 읽기 실패는 미동의로 표시하지 않고 재시도를 제공한다. 이전 판에 동의한 상태는 켜진 토글과 판 갱신 필요 안내로 표시한다. 공개된 수집에서 새 동의는 본문을 확인한 뒤 명시적으로 수행한다.
  - **기존 사용자 1회 안내:** 수집 공개 시 이 항목 이전에 가입해 한 번도 답하지 않은 사용자(`version === null`)에게 `components/shell/RecommendationConsentDialog`를 띄운다. `AppShell`이 로그인 복원(`authenticated`, `signupCompleted !== false`) 뒤 `load()`하고, 아래 억제 조건에 걸리지 않으면 마운트한다. 제목 「맞춤 곡 추천 학습에 연주 기록을 쓸까요?」, 본문은 가입 항목 요약(목적·항목·처리·철회·거절해도 기능 동일). [동의하고 사용] → `set(true)`, [괜찮아요]·Esc·배경 클릭 → `set(false)` — 둘 다 서버에 "답했음"(`version` 채움)이 남아 어느 기기에서도 다시 뜨지 않는다. 기본은 미동의라 초기 초점은 [괜찮아요]에 둔다. **억제:** `/signup` 경로, 연주 중(`immersive`)에는 띄우지 않고 벗어난 뒤 다음 렌더에 띄운다. 비로그인·`VITE_AUTH_REQUIRED=false`(status가 `authenticated` 아님)·가입 전 회원은 읽지도 띄우지도 않는다. PUT이 실패하면 `dismissForSession()` 뒤 닫고 이번 세션에는 다시 띄우지 않는다(다음 접속에 다시 뜬다). 테스트: `RecommendationConsentDialog.interaction.test.tsx`.
- **회원 탈퇴:** 설정 화면의 "회원 탈퇴" 카드 → 확인 대화상자(`components/shell/WithdrawDialog`) → `DELETE /api/users/me`(204, BE가 refresh 쿠키를 지운다) → 메모리 토큰·활성 채보 작업 기록(`ssaplash.chartJob.v1`, 로그아웃 때도 지운다)·그 계정의 로컬 플레이 로그 폐기 → `/login?error=withdrawn`. 안내 문구: 학습 활용에 동의한 플레이 기록만 식별 정보를 제거해 보관(BE 153). 204만 탈퇴로 본다. 401은 탈퇴 근거가 아니라 인증 만료로 처리한다 — 토큰을 비우고 `/login?error=session_expired`로 가며 로컬 기록은 지우지 않는다. 네트워크·5xx는 대화상자에 문구를 보이고 다시 시도할 수 있다. 되돌릴 수 없고 같은 소셜 계정으로 다시 로그인하면 새 회원이다.
- **오류 코드(`/login?error=`):** BE가 붙이는 `access_denied`(동의 취소)·`oauth_failed`, FE가 붙이는 `no_session`(콜백 뒤 refresh 실패)·`session_expired`·`network`(서버 연결 실패)·`withdrawn`(탈퇴 완료 안내, 오류 색 없이 표시). 문구는 `domain/auth.ts`에 있다.
- **보호 라우트:** `/login`·`/auth/callback`·`/signup`을 뺀 모든 화면은 `RequireAuth` 아래다. 로그인했어도 `domain/signupGate.needsSignup`이 true인 회원은 `/signup`으로 보낸다(원래 경로는 `state.from`). `VITE_AUTH_REQUIRED=false`면 검사 없이 통과한다([실행](#실행)).
- **주의:** BE `.env`에 그 제공자의 키가 없으면 버튼을 눌렀을 때 BE의 404(problem+json)가 그대로 보인다 — 브라우저 이동이라 FE가 가로챌 수 없다. Safari는 `http://localhost`의 Secure 쿠키를 거부할 수 있어 로컬에서는 Chrome·Firefox로 확인한다.
- **화면:** `/login`·`/signup`·`/auth/callback`은 `components/shell/PublicLayout` 아래 셸(nav·메트로놈·연결 상태) 없는 전체 화면이다. 로그인 화면은 2분할 카드이고, 제공자 버튼은 Figma 로그인 카드대로 로고 + 「Google로 계속하기」·「SSAFY로 계속하기」(둘 다 `ui/Button` secondary, 카드 폭)이며 가입·로그인 버튼을 나누지 않는다. `VITE_LOGIN_PROVIDERS`(쉼표 구분, 예 `google`)로 거른다. 미설정이면 google·ssafy 전부 보이므로 BE에 키가 없는 제공자는 빼 둔다. 게스트·둘러보기 진입은 없다.
- **가입 동의(`/signup`):** 세 필수 항목과 수집 공개 시에만 나타나는 선택 추천 학습 동의로 구성한다. 필수 일괄 동의는 선택 항목을 바꾸지 않는다. 문구와 판은 `domain/signupTerms`에서 관리하며 추천 문구는 검토 전 초안이다.
  - **분기:** 가입 게이트는 필수 약관만 검사한다. 공개 중 재동의로 진입한 기존 회원은 추천 동의 상태를 읽고 현재 판 동의만 미리 선택한다. 조회 실패 시 재시도를 제공하고 추천 항목을 생략해 기존 응답을 덮어쓰지 않는다.
  - **제출:** `POST /api/users/me/signup-consent`에 필수 동의를 보내며, 추천 항목이 공개된 경우에만 선택 여부와 판을 함께 보낸다. 비공개 또는 기존 상태 읽기 실패 시 선택 항목을 생략해 기존 서버 응답을 보존한다.
  - **403 `SIGNUP_INCOMPLETE`:** 동의 전 회원이 다른 API를 부르면 `api/http`가 알리고(`subscribeSignupIncomplete`), `app/signupGate`가 `authStore.refreshMe`로 `/me`를 한 번 다시 읽어 `signupCompleted=false`가 되면 `RequireAuth`가 `/signup`으로 보낸다. 이미 가입이 필요한 상태면 무시하고 `/me`가 실패해도 한 번으로 끝난다.
  - **전환기 규칙:** `/me`에 `signupCompleted` 필드가 없으면(BE 가입 동의 단계 미병합) 가입 완료로 보고 아무것도 검사하지 않는다. 필드가 있고 false일 때만 막는다.
  - `VITE_AUTH_REQUIRED=false`면 세 곳(콜백·보호 라우트·`/signup`) 모두 검사하지 않고, 제출하면 `/`로만 간다. 가입 취소 버튼은 없다 — 동의 없이 떠난 계정은 BE가 7일 뒤 삭제한다.
- **연주 기록 활용 동의(ACCT-002·ACCT-001 회신 2):** 가입 때 **필수** 동의로 확정됐고 철회는 회원 탈퇴로만 한다. 설정 화면에 토글이 없고 FE는 `PUT /api/users/me/data-consent`를 부르지 않는다. 동의의 진실은 `GET /api/users/me`의 `dataConsent { agreed, version, updatedAt }`(답한 적 없으면 셋 다 null)이고, 플레이 시작(`begin`·`restart`·악보 `resetRun`)에서 `app/dataConsent.readCurrentConsent()`가 `agreed === true && version === domain/signupTerms.dataConsentVersion()`을 읽어 `PlayLog.consent`에 저장하며 업로드 `consent`가 그 값이다(비로그인·null·판 불일치·필드 없는 옛 로그는 false). 동의 저장과 판이 바뀐 회원의 재동의는 가입 동의 화면(2단계-B, `POST /api/users/me/signup-consent`)이 맡는다. 연주 기록 활용 본문의 「동의 철회는 회원 탈퇴로 할 수 있어요.」는 배포 전에 넣어 판은 그대로다.
- **프로필:** 상단바 우측 아바타(`components/shell/ProfileMenu`)를 누르면 닉네임·제공자 배지·설정·로그아웃 메뉴가 열린다. 프로필 이미지가 없으면 닉네임 첫 글자를 보인다. 바깥 클릭·Esc로 닫힌다(`ui/Menu`, Esc면 아바타로 초점을 돌려준다).

## 디버그

플레이 중 `` ` `` 키를 누르면 타격별 수신·판정·오디오 구간 지연을 보여주는 디버그 창이 열린다.

### 튜닝 (디버그 창)

디버그 창의 "튜닝" 구역(접힘이 기본)에서 센서 판정·세기 파라미터 10개를 플레이 중에 바꾼다. 바꾼 값은 다음 타격부터 반영되고 localStorage(설정 `tuning`)에 저장된다. 재캘리브레이션은 필요 없다 — 반경은 저장된 손별 앵커에 현재 튜닝을 적용해 매번 다시 계산한다(`anchorsToProfile`). 앵커별 반경 줄은 왼손·오른손이 다르면 "왼/오"로 보인다.

| 값 | 기본값 | 범위 | 의미 |
| --- | --- | --- | --- |
| `radiusFactor` | 0.6 | 0.30~0.80 | 앵커 반경 = 같은 손의 가장 가까운 다른 앵커까지 각도 × 계수 |
| `minRadiusDeg` | 15 | 8~30 | 반경 하한(°). 세팅 화면의 "판정 반경 하한"과 같은 값 |
| `maxRadiusDeg` | 35 | 8~45 | 반경 상한(°). 세팅 화면의 "판정 반경 상한"과 같은 값 |
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
5. 하드웨어가 없으면 모니터 상단 바의 **모의 스틱** 토글로 가짜 패킷을 흘려 화면을 확인한다(`monitor/mockStick`). 모의 스틱은 `dongle` 옵션으로 LINK(1초 + 변화 시)를 흉내 내고, `dropHand`·`restoreHand`·`reboot`로 한 손 끊김→복귀·재부팅(STATUS 비트 5 + 시계 0부터, SET_PAD_TABLE을 받으면 비트 5 해제)을 흉내 낸다. ROUTE로 감싼 명령은 마스크의 손에만 적용한다. 페달 패킷(role 2·3 HIT·STATUS, `0x08 PEDAL`, LINK bit2·3)은 빌더(`buildPedal` 등)로 만들어 단위 테스트에서 쓴다 — 모의 스틱이 흘리는 것은 손뿐이다. 단위 테스트가 이 빌더·시나리오를 쓴다.

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

배치·사운드를 이름 붙여 저장한 것이 프리셋이다(최대 10개 — 드럼 세팅 칩 줄은 슬롯 5개(`PRESET_SLOTS`)까지 추가 허용, 이름 1~50자·중복 불가, 기본 프리셋 1개). 목록에 없는 예약 프리셋 **시스템 기본**(`SYSTEM_PRESET_ID = 'system'`, 표시 이름 `SYSTEM_PRESET_NAME`)이 항상 있어 `activePresetId`는 `null`이 되지 않는다(v18): 고정 배치 `DEFAULT_KIT_LAYOUT` + 3D 모델 기본 앵커, 편집·저장 불가, `selectDirty`는 항상 false. 프리셋별 판정 앵커는 서버가 아니라 기기 로컬 `settingsStore.presetAnchors[id]`에 두고 `apply`가 사본(`stickAnchors`)을 갈아끼운다(다른 기기에서 만든 프리셋은 앵커가 없어 모델 기본으로 판정, 세팅 ②가 "보정 필요"). `remove`는 그 기록도 지우고 적용 중이었으면 시스템 기본으로 돌아간다. 저장소는 `domain/preset`의 `PresetSource` 인터페이스(`list`·`create`·`update`·`remove`·`setDefault`, 오류는 `PresetError.code`) 뒤에 있고 구현이 둘이다.

- **서버(`api/presets`의 `ServerPresetSource`)** — 로그인 상태에서 쓴다. BE README "키트 프리셋" API(`/api/presets`)를 `apiFetch`로 부른다. 응답 `id`(숫자)는 문자열로, `sounds.soundSetId`는 `soundSetId`로 올리고 모르는 세트 id는 `ssaplash`로 보정한다. 본문은 `name`·`layout`·`sounds`·`schemaVersion`뿐이며 `calibration`은 보내지도 읽지도 않는다(공통 명세서 미결 #23, 10/22: 캘리브레이션은 기기·세션 값). 오류는 `PRESET_NAME_DUPLICATE → NAME_DUPLICATE`, `PRESET_LIMIT_EXCEEDED → LIMIT_EXCEEDED`, `PRESET_NOT_FOUND → NOT_FOUND`, `PRESET_CONFLICT → CONFLICT`, 그 밖(네트워크·5xx·다른 4xx) → `NETWORK`.
- **로컬(`store/localPresetSource`)** — `settingsStore.presets[]`(localStorage). 익명 상태에서만 쓴다. 운영 빌드는 `/setup`이 로그인 뒤라 사실상 `VITE_AUTH_REQUIRED=false` 개발 빌드 전용이다. 로그인해도 로컬 프리셋을 서버로 옮기지 않는다(10/23 합의).

어느 저장소를 쓸지는 `app/presetBootstrap`이 `authStore.status`를 구독해 정한다. `authenticated`면 서버, `anonymous`면 로컬, 복원 중(`unknown`·`restoring`)이면 기다린다. 저장소를 바꾸면 목록을 다시 읽고 적용 프리셋(`activePresetId`)을 맞춘다 — 시스템 기본이거나 목록에 있으면 유지, 없으면 기본 프리셋 적용, 기본도 없으면 시스템 기본. 읽기에 실패하면 `status = 'error'`만 남기고 적용 프리셋은 두지 않는다. 전환은 순서대로 처리되고 같은 상태가 다시 와도 다시 읽지 않는다. 로그아웃·세션 만료로 `anonymous`가 되면 서버 목록은 비워지고 로컬로 돌아간다.

화면은 `presetStore`(`items`·`status`·`error`, 액션 `refresh`·`apply`·`saveChanges`·`saveAs(name, draft?)`·`setDefault`·`remove`)만 부르며(`draft`는 추가하기 보정 결과 — 초안의 배치로 만들고 앵커를 새 프리셋에 기록한 뒤 적용), 실패하면 `status = 'error'`·`error = 코드`만 바꾸고 편집 중인 `kitLayout`·`soundSetId`는 건드리지 않는다. 서버는 첫 프리셋도 기본으로 만들지 않으므로 `saveAs`가 생성 뒤 `setDefault`를 한 번 더 부른다. 변경 여부(`dirty`)는 상태가 아니라 `selectDirty(settings, presets)`로 현재 편집값과 적용 프리셋을 비교해 얻으며, 적용 프리셋이 없으면 저장할 것이 있는 것으로 보아 true다.

## 사운드 세트

패드 소리는 사운드 세트가 정한다. 세팅 화면의 "사운드 세트"에서 `SSAPLASH 키트`(샘플)와 `합성음(임시)`을 고르며 선택은 설정(`soundSetId`)에 저장된다.

- 샘플 세트는 `public/sounds/<id>/kit-config.json`과 `audio/*.wav`를 읽는다. 패드별 게인·재생 속도는 코드가 아니라 이 JSON이 정한다. 키트를 교체하려면 파일과 JSON만 바꾼다. 키트 항목 → 패드 매핑표는 `src/audio/kitConfig.ts`에 있다(`high`=스몰탐, `mid`=미드탐). 샘플이 없는 패드는 `audio/soundSets`의 폴백표를 따라 다른 패드 샘플을 작게 쓴다(하이햇 페달 → 하이햇 0.7배), 폴백도 없으면 합성음. 출처·라이선스는 키트 폴더의 `SOURCE.md`에 있다(스네어·탐 3개는 CC BY 3.0이라 출처 표기가 필요하다).
- **하이햇 세 소리:** 키트 항목 `hihat`은 페달을 밟은 상태의 닫힌 타격(`HIHAT`), `hihat_pedal`은 페달을 밟는 소리 chick(`HIHAT_PEDAL`), `hihat_open`은 페달을 뗀 상태의 열린 타격(아래 열림/닫힘)이다. 기본 키트(minorr, 2026-11-04 교체)는 세 항목이 모두 있어 `HIHAT_PEDAL`도 폴백 없이 자기 샘플을 쓴다. `hihat_pedal`이 없는 키트만 위 폴백을 탄다.
- **하이햇 열림/닫힘:** 왼발 페달이 연결돼 있고 뗀 상태(`liveStore.pedal.connected[0] && !hihatClosed`)면 스틱 `HIHAT` 타격이 열림 소리다. 페달이 없거나 끊기면 닫힘(지금 소리)이다. `bootstrap`이 `pedal` 이벤트·연결 변화마다 `AudioEngine.setHihatOpen(open)`으로 알리고, 다음 `HIHAT` 타격부터 반영된다(울리는 열림 소리를 끊는 초크는 없다). 열림 소리는 `kit-config.json`의 선택 항목 `pads.hihat_open`(`file`·`gain`·`playbackRate`, 패드 항목과 같은 형식)이 있으면 그 샘플(`SoundSet.variants.HIHAT_OPEN`), 없으면 합성 열림 보이스(대역 노이즈, 감쇠를 길게)다. 샘플이 없어도 `missing`에 넣지 않는다. 기본 키트는 `hihat_open` 샘플(약 2초 울림)이 있다.
- 첫 소리(오디오 언락) 이후에 샘플을 불러온다. 불러오는 동안과 파일 하나가 실패한 패드는 합성음으로 울린다. 한 번 불러온 세트는 다시 고를 때 재다운로드하지 않는다.
- 세기는 게인으로 반영한다(`패드 게인 × 키트 masterVolume × v^1.4`). 그 뒤 버스·마스터 게인이 곱해진다.
- **음량 3단 구조(설정 화면 오디오 카드, 11/4 hotfix 294):** 타격 게인 → 패드 버스(`soundOn ? drumVolume : 0`, 드럼 음량 0~2) → 마스터(`volume`, 전체 음량) → 소프트 리미터 → 출력. 반주는 반주 버스(`songVolume`, 노래 음량 0~1) → 마스터. 메트로놈 클릭은 마스터 직결이라 전체 음량과 `metronomeVolume`만 받는다. `bootstrap.applySettings`가 설정 변경마다 `AudioEngine.setVolume / setDrumVolume / setSongVolume`을 부르고, 버스 게인이라 울리는 소리에도 즉시 반영된다. 패드 소리 끄기를 풀면 1이 아니라 `drumVolume`으로 돌아온다. 세팅 화면 톡 치기도 패드 버스를 지나므로 드럼 음량 시험에 쓸 수 있다. 저장 설정 v15에서 두 필드가 추가됐고(기본 1) 이전 설정은 마이그레이션이 채운다.
- **키트 gain 재조정(11/4):** minorr 키트 교체 때 샘플이 이전 키트보다 패드마다 5~13dB 작아지고 패드별 gain도 1.0으로 리셋돼 드럼이 작게 들렸다. 첫 100ms RMS를 재서 이전 키트의 실효 음량에 맞춘 gain(킥 1.8·하이햇 2.4·라이드 5 등)을 `kit-config.json`에 넣었다. 출력단 리미터가 있어 gain이 1을 넘어도 클리핑은 나지 않는다. 키트를 바꿀 때는 샘플 크기를 재서 gain을 같이 맞춘다.
- 세팅 화면에서 패드를 톡 치면(이동 6px 이내) 소리와 타격 이펙트가 나온다. 이 타격(`source: 'preview'`)은 텔레메트리·통계에 남지 않는다.

## 메트로놈·사운드 토글

> 셸 개편으로 칩·BPM 조작은 상단 GlassDock으로, 옛 팝오버는 Dock 칩을 누르면 열리는 `components/shell/MetronomePanel`(Figma 228:5712)로 옮겼다. 패널: 켜기 토글 · BPM −/+ · 박자(4/4·3/4, 엔진이 지원하는 것만) · 탭 템포 · 메트로놈 음량(0~100%, 설정 `metronomeVolume`, 클릭 게인에 곱함). 바깥 클릭·Esc로 닫히고(Esc면 칩으로 초점 복귀) Dock 접기·라우트 이동 때도 닫힌다. 연주는 멈추지 않는다. 아래 「칩」·「팝오버」는 각각 Dock 칩·패널로 읽는다(슬라이더 BPM 조절은 없음).

상단 바에 전역 메트로놈 칩(비트 점 · BPM · 재생/정지)과 "패드 소리" 스위치가 있다. 스케줄러는 `engine/Metronome` 싱글턴이고, 칩(`components/shell/Metronome`)은 `liveStore.metronome`을 읽고 엔진 메서드만 부른다.

- 칩의 ▶/■는 재생·정지, 칩 본체를 누르면 팝오버가 열린다(바깥 클릭·Esc로 닫힘). 팝오버: BPM 슬라이더(40~240)·`-5/+5`·박자(4/4 · 3/4)·탭 템포.
- 탭 템포는 버튼을 누를 때마다 최근 최대 8번의 평균으로 BPM을 정한다(2번째 탭부터 반영). 2초 이상 쉬면 새로 센다. 첫 박은 악센트(높은 음, 점 색 다름).
- 재생 중 페이지를 이동해도 유지된다(엔진이 React 밖 싱글턴, 칩은 `AppShell`에 있음). 새로고침 후에는 정지 상태로 시작한다.
- 리듬 게임·악보 연습에서 세션을 시작하면 메트로놈이 곡에 잠긴다(`Metronome.lock`): 칩이 곡 BPM·박자와 "곡" 배지를 보이고 슬라이더·박자·탭 템포는 비활성이며, 점은 세션이 `pulse`로 알리는 박에 깜빡이고 ▶/■는 세션 클릭(`settings.metronome`)을 켜고 끈다.
- 세션이 끝나거나 나가면 `unlock`으로 사용자 BPM·박자(정지 상태)로 돌아온다. 잠금 중 값은 설정에 저장되지 않는다.
- 사운드 토글은 패드 소리만 음소거한다. 메트로놈 클릭은 계속 난다.
- 설정 `metronomeBpm`·`metronomeBeatsPerBar`·`metronomeVolume`·`soundOn`이 localStorage에 저장된다.
- 개발 모드에서는 콘솔에서 `window.__metronome.stats`(`scheduled`·`late`·`maxDriftMs`)로 예약 지터를 읽을 수 있다.

## 키보드 입력(임시)

키보드는 스틱이 오기 전까지의 임시 입력이다. 키 매핑 카드는 10/22에 제거했고 매핑은 `domain/keyMap.ts` 상수 하나다. 환경변수 `VITE_KEYBOARD_INPUT=false`로 빌드하면 키 안내와 키보드 소스 등록이 함께 빠진다(기본은 켜짐, 예시는 `.env.example`). 안정화 후에는 `keyboardSource`·`domain/keyMap.ts`를 지운다.

## 곡 선택·연주 준비 최고 기록 (273번)

- 로그인한 API 곡 소스는 GET /api/v1/plays/best-records?songIds=…를 사용한다. 곡 선택 표·상세는 해당 모드의 전체 연습 단계 중 최고값(리듬: 점수, 악보: 정확도), 두 준비 화면은 선택 chartId의 최고 정확도를 표시한다. 여러 채보 버전은 서버에서 집계하며 COMPLETED만 포함한다. 이전 로컬 계산과 중도 종료 포함 여부가 달라 값이 낮아질 수 있다.
- 서버 정확도 0~100을 domain/serverBestRecord에서 0~1로 한 번 변환한다. 0은 유효한 기록이고 null·생략된 기록은 —다. API 실패를 로컬 기록으로 대체하지 않는다.
- app/useBestRecords는 현재 목록 ID를 중복 제거해 100개씩 순차 조회하고 모든 묶음 성공 후 표시한다. 빈 목록은 요청하지 않는다. 계정·곡 변경의 이전 응답을 무시하고 이탈 시 취소한다. 준비 화면의 단계 변경은 이미 받은 같은 곡 결과를 재사용한다.
- 조회 중 안내와 실패 시 다시 시도를 제공하되 최고 기록 때문에 준비·연주 시작을 막지 않는다. 화면 진입 및 플레이 업로드 DONE 변화 시 조회한다. 다른 기기·탭에서 바뀐 기록은 화면 재진입 시 반영한다.
- VITE_SONGS_SOURCE=builtin 개발 소스는 기존 로컬 기록 계산을 유지한다. 서버의 기본 곡(BUILTIN) 탭은 API 소스이므로 서버 기록을 사용한다.


## 추천 화면과 학습 동의 공개 조건

- 곡 선택은 기본 곡 탭이 처음 보일 때 추천을 요청하며, 비슷한 곡은 서버가 고른 난이도와 채보로 이동한다. 리포트의 `songId`, `chartId`, `difficulty`는 선택 필드이며 서버가 곡 ID를 주지 않으면 비슷한 곡을 요청하지 않는다. 서버 필드와 SHEET 추천 필터 변경은 BE `feat/COACH-recommend-sheet-report`에 구현됐으며 develop-BE 병합과 배포를 기다린다.
- `VITE_RECOMMENDATION_CONSENT_ENABLED=true`일 때만 신규 추천 학습 동의를 수집한다. 기본값은 비활성이며, 확정된 문구와 BE 허용 판을 배포하기 전에는 켜지 않는다. 비활성일 때 가입 요청은 추천 동의 필드를 생략한다. 기존 동의 조회·철회는 유지한다.
- 철회도 현재 설정된 동의 판으로 PUT한다. 해당 판이 BE 허용 목록에 없으면 서버가 422를 반환하고 기존 동의 상태를 유지한다. 허용 판 배포는 FE만으로 보장할 수 없다.
