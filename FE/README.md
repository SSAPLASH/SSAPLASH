# FE — SSAPLASH 웹 클라이언트

에어드럼 리듬 게임의 브라우저 클라이언트. 센서(IMU 스틱)가 오기 전에는 키보드와 포인터 모의 IMU로 세팅·캘리브레이션·게임 흐름을 개발한다.

## 스택

| 항목 | 선택 |
| --- | --- |
| 프레임워크 | React 19 + TypeScript, Vite |
| 상태 | zustand (설정은 localStorage에 영속) |
| 화면 | Canvas 2D (키트·노트 레인), Web Audio (발음) |
| 센서 연결 | Web Bluetooth (BLE 직접), WebSocket (브리지 대안) |
| 검사 | oxlint, vitest |

Node 20 이상, npm 사용.

## 실행

```bash
npm install
npm run dev        # http://localhost:5173
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
├─ main.tsx     Vite 엔트리. app/bootstrap을 부르고 렌더
├─ app/        앱 조립 — 아래 전부를 알아도 되는 유일한 곳
│   ├─ App.tsx       라우터
│   ├─ sources.ts    입력 소스 4종 · inputManager 단일 인스턴스
│   └─ bootstrap.ts  설정 ↔ 소스 ↔ 스토어 ↔ 오디오 접착, 오디오 언락
├─ pages/      라우트 단위 화면 — Home · Setup · Calibration · Play · FreePlay · Result
├─ components/ 공용 UI — AppShell · KitCanvas · NoteHighway · DebugOverlay
├─ store/      zustand — settingsStore(영속) · liveStore(실시간)
├─ input/      입력 소스와 매퍼 (인스턴스는 만들지 않는다 → app/sources)
│   ├─ InputSource         공통 인터페이스 · ClockSync
│   ├─ KeyboardPadSource   키 코드 타격 (항상 켜짐)
│   ├─ PointerStickSource  마우스 위치 → 자세, 키/클릭 → 타격 (모의 IMU)
│   ├─ BleStickSource      Web Bluetooth GATT
│   ├─ WebSocketStickSource  허브 · PC 브리지
│   ├─ stickProtocol       BLE/WS 공용 바이너리 패킷
│   ├─ padMapper           키 매퍼(keyMap) · 자세 매퍼(캘리브레이션 프로필)
│   └─ InputManager        소스 합성 → 매퍼 → ResolvedHit 발행
├─ engine/     CalibrationSession · RhythmSession(일시정지 포함) · playLog · telemetry
├─ audio/      AudioEngine
├─ domain/     순수 타입·함수. React·브라우저 API 의존 없음 (단위 테스트 대상)
│   pads · events · keyMap · calibration · kitMapping · chart · judgement · hitStats
└─ styles/     전역 CSS
```

예약 폴더(첫 파일이 생길 때 만든다): `api/` BE 클라이언트, `hooks/` 페이지 공유 훅, `assets/` 이미지·샘플.

### 의존 방향

위에서 아래로만 import한다. 같은 줄끼리는 import하지 않는다.

| 층 | 폴더 | import 허용 |
| --- | --- | --- |
| 조립 | `app`, `main.tsx` | 전부 |
| 화면 | `pages` | hooks · components · store · engine · audio · domain · app(인스턴스·언락) |
| 공용 UI | `components`, `hooks` | store · engine · audio · domain |
| 상태 | `store` | domain · api |
| 코어 | `input`, `engine`, `audio`, `api` | domain |
| 도메인 | `domain` | 없음 |

- `types/`·`utils/`는 두지 않는다. 타입은 쓰는 도메인 파일 옆에 둔다(`domain/keyMap.ts`, `domain/events.ts`). 전용 타입 폴더는 "어디 있는지 찾기"와 순환 import를 만들고, 범용 유틸은 아직 없다.
- 경로 별칭 `@/` = `src/` (`tsconfig.app.json` · `vite.config.ts` · `vitest.config.ts`에 같이 설정). 다른 폴더는 `@/`, 같은 폴더는 `./`로 가져온다.
- 입력 소스·`inputManager` 인스턴스는 `app/sources.ts`에서만 만든다. 화면은 거기서 가져다 쓰고, `input/` 클래스를 직접 new 하지 않는다.

## 입력 구조

- **소스**는 "어느 스틱이 언제 얼마나 세게 어떤 자세로 쳤는가"만 낸다. 어느 패드인지는 모른다.
- **매퍼**가 패드를 정한다. 키보드 타격은 키 매퍼(키 매핑), 센서 타격은 자세 매퍼(캘리브레이션 프로필).
- **키보드는 항상 켜져 있고**, 센서 소스는 세팅에서 하나만 고른다(없음 / 포인터 모의 IMU / BLE / WebSocket). 센서를 켜도 Space 킥과 키보드 타격은 그대로 동작한다.
- 하드웨어가 오면 BLE 소스 연결을 검증하고 캘리브레이션으로 프로필을 채우면 된다. 키 매핑·소리·게임 코드는 바뀌지 않는다.

## 기본 키 매핑

| 패드 | 왼손 (스틱 0) | 오른손 (스틱 1) |
| --- | --- | --- |
| 스네어 | F | J |
| 하이햇 | D | K |
| 하이탐 | E | I |
| 플로어탐 | C | M |
| 크래시 | R | U |
| 라이드 | T | Y |
| 킥 | — | Space |

Shift를 같이 누르면 악센트. 세팅 화면에서 바꿀 수 있고 localStorage에 저장된다.

자유 연주 화면은 치면 바로 울리고 최근 타격과 패드별 횟수를 보여준다. 캘리브레이션 결과를 확인하는 화면이기도 하다.

캘리브레이션은 센서(포인터 모의 IMU 포함)가 켜져 있어야 한다. Enter로 기준 자세를 잡고 크래시 → 하이햇 → 스네어 → 하이탐 → 플로어탐 → 라이드 순으로 패드 위에 스틱을 2초 멈추면(또는 2타) 앵커가 잡힌다. Enter 즉시 확정, Backspace 직전 다시, Tab 건너뛰기, Esc 나가기 팝업. 확인 단계에서 테스트 타격으로 판정을 보고 저장하면 그때부터 센서 타격이 그 프로필로 판정된다. 키보드 매핑 키는 캘리브레이션 중 무시된다.

리듬 게임은 내장 채보 3곡을 고른 뒤 Enter로 시작한다(1마디 카운트인). Esc는 중단 확인 팝업을 띄우고 그동안 노트가 멈춘다. 곡이 끝나면 결과 화면으로 가며 플레이 로그는 localStorage에 최근 20건 남는다. 결과에서 Enter는 같은 곡 다시 하기.

포인터 모의 IMU를 켜면 마우스 위치가 스틱 자세가 되고, F(왼손)/J(오른손) 또는 좌/우클릭이 타격이다. 이 두 키는 그동안 키보드 매핑에서 제외된다. 방향키로도 자세를 움직일 수 있다.

## 디버그

플레이 중 `` ` `` 키를 누르면 타격별 수신·판정·오디오 구간 지연을 보여주는 디버그 창이 열린다.
