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
│   ├─ sources.ts         키보드 소스 · inputManager 단일 인스턴스
│   ├─ sensorRegistry.ts  센서 소스 디스크립터 등록·조회, 인스턴스 지연 생성
│   ├─ sensors.ts         센서 소스 등록 한 줄씩 (새 소스는 여기에 추가)
│   └─ bootstrap.ts       설정 ↔ 소스 ↔ 스토어 ↔ 오디오 접착, 표면 연결(bindSensorSurface), 오디오 언락
├─ pages/      라우트 단위 화면 — Home · Setup · Calibration · Play · FreePlay · Result
├─ components/ 공용 UI — AppShell · SensorOptionsPanel · KitCanvas · NoteHighway · DebugOverlay
├─ store/      zustand — settingsStore(영속) · liveStore(실시간)
├─ input/      입력 소스와 매퍼 (인스턴스는 만들지 않는다 → app/sensorRegistry · app/sources)
│   ├─ InputSource         공통 인터페이스 · ClockSync
│   ├─ SourceDescriptor    입력 소스 디스크립터 타입 (id·라벨·설정 항목·동작 버튼 선언)
│   ├─ KeyboardPadSource   키 코드 타격 (항상 켜짐)
│   ├─ PointerStickSource  마우스 위치 → 자세, 키/클릭 → 타격 (모의 IMU) + 디스크립터
│   ├─ BleStickSource      Web Bluetooth GATT + 디스크립터
│   ├─ WebSocketStickSource  허브 · PC 브리지 + 디스크립터
│   ├─ stickProtocol       BLE/WS 공용 바이너리 패킷
│   ├─ padMapper           키 매퍼(keyMap) · 자세 매퍼(캘리브레이션 프로필)
│   └─ InputManager        소스 합성 → 매퍼 → ResolvedHit 발행
├─ engine/     CalibrationSession · RhythmSession(일시정지 포함) · playLog · telemetry
├─ audio/      AudioEngine · soundSets(사운드 세트) · kitConfig(kit-config.json 스키마)
├─ domain/     순수 타입·함수. React·브라우저 API 의존 없음 (단위 테스트 대상)
│   pads · kitLayout · events · keyMap · calibration · kitMapping · chart · judgement · hitStats
└─ styles/     전역 CSS
```

예약 폴더(첫 파일이 생길 때 만든다): `api/` BE 클라이언트, `hooks/` 페이지 공유 훅, `assets/` 이미지·샘플.

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

- `types/`·`utils/`는 두지 않는다. 타입은 쓰는 도메인 파일 옆에 둔다(`domain/keyMap.ts`, `domain/events.ts`). 전용 타입 폴더는 "어디 있는지 찾기"와 순환 import를 만들고, 범용 유틸은 아직 없다.
- 경로 별칭 `@/` = `src/` (`tsconfig.app.json` · `vite.config.ts` · `vitest.config.ts`에 같이 설정). 다른 폴더는 `@/`, 같은 폴더는 `./`로 가져온다.
- `inputManager`·키보드 소스는 `app/sources.ts`에서, 센서 소스 인스턴스는 `app/sensorRegistry.ts`가 디스크립터의 `create`로 만든다. 화면은 `input/` 클래스를 직접 new 하거나 소스 id 문자열을 비교하지 않고, 레지스트리의 디스크립터(라벨·가용성·설정 항목)를 읽는다.

## 입력 구조

- **소스**는 "어느 스틱이 언제 얼마나 세게 어떤 자세로 쳤는가"만 낸다. 어느 패드인지는 모른다.
- **매퍼**가 패드를 정한다. 키보드 타격은 키 매퍼(키 매핑), 센서 타격은 자세 매퍼(캘리브레이션 프로필).
- **키보드는 항상 켜져 있고**, 센서 소스는 세팅에서 하나만 고른다(없음 / 레지스트리에 등록된 소스: 포인터 모의 IMU · BLE · WebSocket). 센서를 켜도 Space 킥과 키보드 타격은 그대로 동작한다.
- 하드웨어가 오면 BLE 소스 연결을 검증하고 캘리브레이션으로 프로필을 채우면 된다. 키 매핑·소리·게임 코드는 바뀌지 않는다.

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
| `note` · `usageGuide(값)` | 선택 | 설정 패널 아래 안내 문구 · 자유 연주·캘리브레이션 화면의 조작 안내 |

소스 클래스가 `setSurface(el)`을 구현하면(포인터처럼 화면 좌표를 쓰는 소스) 자유 연주·캘리브레이션의 캔버스가 `bindSensorSurface`를 통해 자동으로 연결된다. 소스를 지우거나 이름을 바꿀 때도 이 두 곳만 고친다. 저장된 `sensorKind`가 등록되지 않은 id면 앱 시작 때 `none`으로 되돌아간다.

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

게임 뷰는 곡 선택 화면에서 고른다(설정에 저장). **노트 하이웨이**는 노트가 레인을 따라 판정선으로 떨어지는 기본 뷰, **킷 위 연주**는 세팅한 킷 배치의 패드 위로 링이 줄어들어 판정 시각에 패드 테두리에 닿는 뷰다. 두 뷰 모두 같은 `RhythmSession`을 읽으므로 판정·점수·결과 저장은 같다.

포인터 모의 IMU를 켜면 마우스 위치가 스틱 자세가 되고, F(왼손)/J(오른손) 또는 좌/우클릭이 타격이다. 이 두 키는 그동안 키보드 매핑에서 제외된다. 방향키로도 자세를 움직일 수 있다.

## 디버그

플레이 중 `` ` `` 키를 누르면 타격별 수신·판정·오디오 구간 지연을 보여주는 디버그 창이 열린다.

### 튜닝 (디버그 창)

디버그 창의 "튜닝" 구역(접힘이 기본)에서 센서 판정·세기 파라미터 7개를 플레이 중에 바꾼다. 바꾼 값은 다음 타격부터 반영되고 localStorage(설정 `tuning`)에 저장된다. 재캘리브레이션은 필요 없다 — 프로필에는 앵커 중심만 두고 반경은 현재 튜닝으로 매번 다시 계산한다.

| 값 | 기본값 | 범위 | 의미 |
| --- | --- | --- | --- |
| `radiusFactor` | 0.55 | 0.30~0.80 | 앵커 반경 = 가장 가까운 앵커 거리 × 계수 |
| `maxRadiusDeg` | 22 | 8~40 | 반경 상한(°). 세팅 화면의 "판정 반경 상한"과 같은 값 |
| `velocity.minAccelG` | 0.8 | 0.2~4 | 이 가속도(g) 이하는 벨로시티 1 |
| `velocity.maxAccelG` | 8 | 2~32 | 이 가속도(g) 이상은 127. min 이하로 내리면 min + 0.5 |
| `velocity.gamma` | 0.8 | 0.3~2 | 곡선 모양. 1 미만이면 약한 타격이 더 크게 |
| `sensorOffsetMs` | 0 | -150~150 | 센서 타격 시각에 더하는 값. 키보드 타격에는 적용 안 됨 |
| `outsidePolicy` | `mute` | `mute` / `nearest` | 앵커 반경 밖 센서 타격: 무음 / 가장 가까운 패드 |

- 기본값과 슬라이더 범위는 `src/domain/tuning.ts`(`DEFAULT_SENSOR_TUNING`, `TUNING_RANGES`)에만 있다. 실측값을 찾으면 여기만 고친다. 이미 저장된 값은 자동으로 덮어쓰지 않으므로 "기본값으로" 버튼으로 받는다.
- 기본값은 모두 **하드웨어(스틱) 도착 전 초안**이다. 포인터 모의 IMU로 동작만 확인했고 실측 전이다.
- 튜닝 값은 키 프리셋에 포함되지 않는다(기기·펌웨어별 값).

## 사운드 세트

패드 소리는 사운드 세트가 정한다. 세팅 화면의 "사운드 세트"에서 `SSAPLASH 키트`(샘플)와 `합성음(임시)`을 고르며 선택은 설정(`soundSetId`)에 저장된다.

- 샘플 세트는 `public/sounds/<id>/kit-config.json`과 `audio/*.wav`를 읽는다. 패드별 게인·재생 속도는 코드가 아니라 이 JSON이 정한다. 키트를 교체하려면 파일과 JSON만 바꾼다. `kit-config.json`의 `mid`처럼 대응하는 패드가 없는 항목은 무시한다(매핑표: `src/audio/kitConfig.ts`).
- 첫 소리(오디오 언락) 이후에 샘플을 불러온다. 불러오는 동안과 파일 하나가 실패한 패드는 합성음으로 울린다. 한 번 불러온 세트는 다시 고를 때 재다운로드하지 않는다.
- 세기는 게인으로 반영한다(`패드 게인 × 키트 masterVolume × v^1.4`). 사용자 볼륨 슬라이더는 마스터 게인에 따로 곱해진다.
- 세팅 화면에서 패드를 톡 치면(이동 6px 이내) 소리와 타격 이펙트가 나온다. 이 타격(`source: 'preview'`)은 텔레메트리·통계에 남지 않는다.

## 키보드 입력(임시)

키보드는 스틱이 오기 전까지의 임시 입력이다. 키 매핑 카드(`components/KeyboardMappingCard`)에 "임시 입력 (개발용)" 라벨을 달아 격리했다. 환경변수 `VITE_KEYBOARD_INPUT=false`로 빌드하면 카드와 키보드 소스 등록이 함께 빠진다(기본은 켜짐, 예시는 `.env.example`). 안정화 후에는 `keyboardSource`·`keyMap` 필드·`domain/keyMap.ts`를 지우고 설정 마이그레이션으로 필드를 버린다.
