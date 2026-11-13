# FE CLAUDE.md

`FE/`에서 작업할 때 지키는 규칙이다. 저장소 루트 `CLAUDE.md`의 규칙(커밋·브랜치·Jira·시크릿)을 함께 따른다. 자세한 설명과 폴더별 파일 목록은 `FE/README.md`의 「폴더 구조」 절에 있다. 이 문서와 README가 어긋나면 README를 기준으로 하고, 어긋난 곳을 사용자에게 알린다.

## 작업 전에

- 파일을 만들거나 옮기기 전에 `FE/README.md`의 「어디에 둘까」 「의존 방향」을 읽는다.
- 구조는 Jira 364(설계 `TECH-fe-feature-scaffolding`)에서 정했다. 「공유는 층으로, 기능은 한 폴더로」 나눈다.
- `src/pages/`는 없다. 옛 브랜치나 문서에 `pages/`·`components/Xxx.tsx`가 보이면 옛 구조다. 새 경로는 `git log --follow --name-status -- <새 경로>`로 찾는다.

## 폴더 구조 요약

| 폴더 | 두는 것 |
| --- | --- |
| `app/` | 라우터·지연 로드 표(`routeModules`)·bootstrap·프로바이더·AppShell. 전부를 import할 수 있는 유일한 층 |
| `config/` | 빌드 스위치·`AUTH_REQUIRED`·지연값처럼 값과 순수 함수. 다른 config 파일만 import한다 |
| `features/<기능>/` | 한 기능만 쓰는 화면(`XxxPage.tsx`)과 `components/`·`store/`·`api/`·`domain/`. 기능: play·setup·free·studio·result·history·lesson·settings·landing·admin·monitor·dev |
| `components/<묶음>/` | 여러 기능·app이 쓰는 UI와 디자인 시스템. `ui/`(디자인 시스템)·`shell/`·`song/`·`drum/`·`fx/`·`stick/`·`calibration/`·`recording/`·`lesson/`·`sheetmusic/` |
| `runtime/` | 앱에 하나뿐인 인스턴스·세션(입력 소스·센서 세션·쿼리 캐시·녹음·업로드·보정·오디오 켜기·`useApiQuery`) |
| `store/` | 공유 zustand 상태 |
| `api/`(account·kit·song·play)·`input/`·`engine/`·`audio/`·`coach/`·`telemetry/` | 코어. domain·config만 import한다 |
| `domain/` | 공유 순수 타입·함수. 바로 아래에는 `events`만, 나머지는 `kit/`·`song/`·`time/`·`play/`·`account/`·`hitFx/` |
| `styles/`·`test/` | 전역 CSS 토큰, 구조 테스트와 테스트 보조 |

`features/play/components/`는 흐름 단계로 나뉜다. `picker/`(곡 선택, 안내 줄은 `guide/`), `start/`(시작 확인 창), `stage/`(연주 화면), `pause/`(일시정지), `diag/`(진단 자동 연주). `picker/lesson/`은 입문 코스, `stage/` 아래 highway/·sheet/·kit/·coach/는 화면 부품이다. `play.css`는 루트에 둔다. 공유 셸은 nav/·dock/·account/, 디자인 시스템은 action/·feedback/·form/·layout/·overlay/로 나눈다.

## 새 파일을 둘 자리

다음 순서로 정한다.

1. 쓰는 기능이 하나면 `features/<기능>/` 안에 둔다. 미리 공유 층에 두지 않는다.
2. 두 번째 기능이 쓰게 되면 그때 공유 층으로 옮긴다. 옮기는 커밋은 기능 변경 커밋과 따로 만든다.
3. 공유 층 안에서는 성격으로 고른다.
   - React·브라우저 API 없는 순수 로직은 `domain/`에 둔다. 기능 하나만 쓰면 `features/<기능>/domain/`에 둔다.
   - 앱에 하나뿐인 인스턴스·세션은 `runtime/`에 둔다. 라우트 표나 기능 폴더를 알아야 하면 `app/`에 둔다.
   - 값·순수 함수 스위치는 `config/`에 둔다.
4. 새 화면은 `features/<기능>/XxxPage.tsx`로 만들고 `app/routeModules`와 `app/App.tsx`에 연결한다. 새 기능 폴더는 자기 라우트가 있을 때만 만든다.
5. 모든 소스 폴더에서 바로 아래 프로덕션 `.ts`·`.tsx` 파일이 15개를 넘으면 응집도에 따라 하위 폴더 분리를 검토한다. 테스트·CSS는 세지 않으며 CI 강제 규칙은 아니다.
6. `domain/` 바로 아래에는 `events`만, `api/` 바로 아래에는 `http`·`error`만 둔다. 둘 다 같은 개념 이름(`account`·`kit`·`song`·`play` 등)의 하위 폴더로 묶는다. 새 파일은 맞는 하위 폴더에 두고, 맞는 폴더가 없을 때만 새 하위 폴더를 만든다.
7. 공유 층에서도 기능 전용 코드는 기능 폴더에 둔다. 단, 여러 계층의 공용 계약은 현재 소비 기능 수만으로 이동하지 않고 재사용성과 의존 방향을 함께 판단한다.

## 의존 규칙 (구조 테스트가 검사한다)

`src/test/architecture.test.ts`가 아래 규칙을 어기면 실패한다. `npm test`에 포함된다.

- R1: 기능 폴더끼리 import하지 않는다. `features/dev`만 예외다.
- R2: 공유 층(components·runtime·store·코어·domain·config)은 `features/`와 `app/`을 import하지 않는다.
- R3: domain은 domain 파일만 import한다. 패키지도 import하지 않는다. 기능 domain은 공유 domain과 자기 기능의 domain만 import한다.
- R4: `components/ui`는 store·domain·api·engine·input·audio를 모른다.
- R5: config는 config 파일만 import한다.
- R6: runtime은 components를 import하지 않는다.
- R7: store·코어·domain은 runtime을 import하지 않는다.
- R8: 기능은 app을 import하지 않는다. 기능이 app의 기능을 써야 하면 app이 props나 콜백으로 넘긴다(예: Sidebar의 `onPrefetch`).
- 공유 화면 컴포넌트와 engine·audio·coach의 값 구현을 전이 경로로 추적해 한 기능만 소비하면 실패한다. app 소비, 다른 공유 계층이 쓰는 코어 구현과 `components/ui` 기본 부품은 공용으로 보고 dev 진단 화면은 기능 수에서 제외한다. domain·api와 타입 전용 계약은 이 검사에서 제외한다.
- `pages/`나 `components/` 바로 아래에 파일이 생기면 실패한다.
- `domain/` 바로 아래에 `events`, `api/` 바로 아래에 `http`·`error` 말고 다른 파일이 생기면 실패한다.

예외 목록 `ALLOWED`는 지금 0건이다. 규칙을 피하려고 예외를 추가하지 않는다. 코드를 맞는 층으로 옮기거나 의존을 뒤집는다. 정말 막을 수 없을 때만 이유를 주석으로 적어 추가하고, 사용자에게 알린다.

구조 테스트가 통과하는데 import를 하나도 찾지 못하는 상태는 없어야 한다. 테스트를 고칠 때는 경로를 `node:path/posix`로 다룬다. Windows 경로 구분자 때문에 검사가 비어 통과한 적이 있다(4bf2d576).

## 금지

- `index.ts` 배럴과 재수출을 두지 않는다. 쓰는 쪽이 원래 파일을 직접 import한다.
- `common/`·`utils/`·`types/` 폴더를 만들지 않는다. 타입은 쓰는 파일 옆에 둔다.
- 다른 폴더는 `@/`로, 같은 폴더는 `./`로 가져온다. `../`로 다른 층을 가리키지 않는다.
- 공유 부품의 CSS를 기능 CSS 파일에 넣지 않는다. 부품 옆에 둔다. CSS 클래스 접두사(`play-`·`studio-` 등)는 폴더를 옮겨도 바꾸지 않는다.
- BE는 `api/http`의 `apiFetch`로만 부른다. 화면은 `input/` 클래스를 직접 new 하지 않고 `runtime/sensorRegistry`를 읽는다.

## 파일을 옮길 때

- `git mv`로 옮겨 이력을 남긴다. 이동 커밋에서는 import 경로와 경로를 적은 주석만 바꾸고 내용을 고치지 않는다.
- 테스트 파일도 함께 옮기고, `vi.mock('@/...')` 경로와 `?raw` import 경로를 같이 고친다.
- 옮긴 뒤 `README.md`의 구조도와 「폴더별 구성(상세)」를 고친다. README 변경은 별도 커밋으로 둔다.
- 경로를 많이 바꾸면 빌드 청크 수가 전과 같은지 `npm run build` 출력으로 확인한다.

## 검증 (커밋 전 모두 통과)

```bash
npx tsc -b
npm run lint
VITE_AUTH_REQUIRED=true VITE_SONGS_SOURCE=api npm test
npm run build
```

- 환경변수 없이 `npm test`를 돌리면 로그인·곡 소스 관련 테스트 일부가 실패한다.
- Node 22 이상에서 localStorage 테스트가 깨지면 `NODE_OPTIONS=--no-experimental-webstorage`를 붙인다.
- lint 경고가 늘었으면 커밋 전에 원인을 본다. 오류는 0건이어야 한다.

## 옛 구조에서 만든 브랜치를 이어 갈 때

- 최신 `develop-FE` 위로 옮긴다. 커밋마다 새 경로가 반영되게 한다(마지막에 경로 수정 커밋 하나를 몰아 두지 않는다).
- 고친 파일이 옮겨진 파일뿐이면 `git rebase origin/develop-FE`로 충분하다. 새 파일이 옛 폴더에 생겼거나 옮겨진 모듈을 새로 import하면 아래 순서로 한다.
  1. `git format-patch -k -o <임시 폴더> <기준점>..<브랜치>`로 커밋을 패치로 뽑는다. `-k`가 없으면 제목의 `[S15P31A307-N]`이 지워진다.
  2. 패치 안의 파일 경로(`FE/src/pages/…` → `FE/src/features/<기능>/…` 등)와 import 경로(`@/domain/x` → `@/domain/<하위 폴더>/x` 등)를 새 구조로 바꾼다. 옛 파일의 새 경로는 `git log --follow --name-status`나 `find`로 찾고, 새 파일은 「새 파일을 둘 자리」대로 정한다.
  3. `git am -k -3 --committer-date-is-author-date <임시 폴더>/*.patch`로 적용한다. 작성자와 작성 시각은 그대로 남는다.
  4. 충돌은 develop-FE 쪽의 새 경로를 살리고 팀원이 바꾼 내용만 얹는다.
- 원본과 같은 파일 수·줄 수가 들어갔는지 `git diff --stat`으로 비교하고, 구조 테스트를 포함한 검증을 모두 돌린다.
- README의 옛 경로 수정은 팀원 커밋에 섞지 않고 docs 커밋 하나로 따로 둔다.
- 팀원의 원격 브랜치에 강제 push하기 전에는 사용자에게 확인한다.
