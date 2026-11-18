// 랜딩 페이지 문구·모드 목록. 화면 문구는 여기서만 고친다.
export type LandingModeKey = 'free' | 'sheet' | 'game';

export interface LandingMode {
  key: LandingModeKey;
  name: string;
  en: string;
  /** 히어로 모드 카드의 한 줄 설명 */
  heroDesc: string;
  /** 모드 섹션 카드의 설명 */
  cardDesc: string;
  image: string;
  shortcut: string;
}

// 순서: 자유 · 악보 · 게임 (단축키 1·2·3과 같다)
export const LANDING_MODES: readonly LandingMode[] = [
  {
    key: 'free',
    name: '자유',
    en: 'FREE PLAY',
    heroDesc: '채보 없이 치는 대로',
    cardDesc: '채보 없이 치는 대로 바로 소리가 납니다. 스틱과 친해지는 가장 쉬운 방법.',
    image: '/landing/free.jpg',
    shortcut: '1',
  },
  {
    key: 'sheet',
    name: '악보',
    en: 'SHEET',
    heroDesc: '악보를 보며 연습',
    cardDesc: '가로로 흐르는 악보를 보며 연주합니다. 점수 대신 정확도와 판정으로 연습을 돌아봅니다.',
    image: '/landing/sheet.jpg',
    shortcut: '2',
  },
  {
    key: 'game',
    name: '게임',
    en: 'GAME',
    heroDesc: '점수와 콤보 도전',
    cardDesc: '떨어지는 노트에 맞춰 치고 점수와 콤보를 쌓습니다.',
    image: '/landing/game.jpg',
    shortcut: '3',
  },
];

export const HERO_PHOTO = '/landing/hero.jpg';

export const HERO_COPY = {
  eyebrow: '에어드럼 리듬 게임',
  title: 'SSAPLASH',
  slogan: '드럼 없이 시작하는 나의 첫 드럼',
  sub: '센서 스틱 두 개면 충분합니다.',
};

export const CUE_LABEL = {
  desktop: '스크롤해서 더 알아보기',
  touch: '밀어 올려 더 알아보기',
  aria: '아래로 스크롤해서 더 알아보기',
};

// 헤더 앵커. id는 각 장면 section의 id와 같다.
export const NAV_LINKS = [
  { id: 'statement', label: '소개' },
  { id: 'stick', label: '센서 스틱' },
  { id: 'ai', label: '채보' },
  { id: 'modes', label: '모드' },
] as const;

export const STATEMENT_LINES = ['드럼이 없어도,', '드럼을 칠 수 있다면.'] as const;

export const STICK_COPY = {
  kicker: '센서 스틱',
  title: ['스틱이', '모든 걸 알아챕니다.'],
  steps: [
    { title: '휘두르는 순간을 측정합니다.', desc: '스틱 안의 IMU 센서가 스윙의 방향과 세기를 계속 측정합니다.' },
    { title: '어느 패드를 쳤는지 판별합니다.', desc: '스틱이 향한 방향으로 스네어인지, 하이햇인지, 탐인지 가려냅니다.' },
    { title: '바로 소리로 돌아옵니다.', desc: '블루투스로 브라우저에 곧장 전달되어 치는 순간 소리가 나고, 손에 진동으로도 느껴집니다.' },
  ],
};

export const CHART_COPY = {
  kicker: '자동 채보',
  title: ['듣고 싶은 곡이,', '곧 칠 수 있는 곡이 됩니다.'],
  sub: 'AI가 음원에서 드럼 소리만 골라내 채보를 만듭니다. 드럼 악보 파일(MusicXML)이 있으면 그대로 채보로 바꿉니다.',
  tabs: ['음원', '드럼만 분리', '채보'],
  labels: { mix: '곡 전체 음원', drum: '드럼 소리만', chart: '채보' },
};

export const MODES_COPY = {
  bgWord: 'PLAY YOUR WAY',
  head: '원하는 방식으로, 원하는 만큼.',
};

export const RESULT_COPY = {
  kicker: '연주 결과',
  title: ['틀린 마디는,', '악보로 다시.'],
  sub: '악보 연주가 끝나면 정확도와 판정 분포, 가장 많이 놓친 마디를 악보로 보여 줍니다.',
  sheetTitle: '가장 많이 놓친 마디',
  sheetNote: '예시 화면',
};

// 결과 지표. cls는 CSS 색 변수(.lp-stat.acc 등)와 짝이다.
export const RESULT_STATS = [
  { cls: 'acc', key: '정확도', value: '한눈에' },
  { cls: 'dist', key: '판정 분포', value: '빠름 · 늦음' },
  { cls: 'weak', key: '약점 마디', value: '악보로 표시' },
] as const;

export const CTA_COPY = {
  title: ['지금,', '스틱을 들어 보세요.'],
  button: '로그인하고 시작하기',
  more: '더 알아보기 ›',
};

export const FOOTER_COPY = ['SSAPLASH · SSAFY 15기 자율 프로젝트 A307', '사진: Unsplash'];
