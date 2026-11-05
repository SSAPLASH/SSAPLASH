import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReadinessMissing } from '@/domain/readiness';
import { ReadyPanel, type ReadyPanelProps } from './ReadyPanel';

const noop = () => {};
const baseProps: ReadyPanelProps = {
  song: { title: '별빛 산책', artist: '아티스트', coverUrl: null, bpm: 120, durationSec: 185 },
  modeLabel: '리듬 게임',
  charts: [
    { id: 1, difficulty: 'EASY' },
    { id: 2, difficulty: 'NORMAL' },
    { id: 3, difficulty: 'HARD' },
  ],
  selectedChartId: 2,
  ready: true,
  missing: [],
  connected: [true, true],
  presetName: '기본 프리셋',
  countInBars: 1,
  onBack: noop,
  onSelectChart: noop,
  onSetup: noop,
  onStart: noop,
};

const render = (over: Partial<ReadyPanelProps> = {}) => renderToStaticMarkup(<ReadyPanel {...baseProps} {...over} />);
const need = (missing: ReadinessMissing[], over: Partial<ReadyPanelProps> = {}) => render({ ready: false, missing, ...over });

describe('ReadyPanel 준비 상태', () => {
  it('준비 완료: 상태 문구·시작 버튼 활성·카운트인 안내', () => {
    const html = render();
    expect(html).toContain('준비 완료');
    expect(html).not.toContain('준비가 필요해요');
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>시작/);
    expect(html).toContain('시작하면 1마디 카운트인 뒤 노트가 내려와요.');
    expect(html).not.toContain('드럼 세팅에서 준비하기');
  });

  it('준비 필요: 상태 문구·시작 버튼 비활성·안내·세팅 버튼', () => {
    const html = need(['stick', 'firstSetup', 'preset'], { connected: [false, false], presetName: null });
    expect(html).toContain('준비가 필요해요');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>시작/);
    expect(html).toContain('기기 준비가 끝나면 시작할 수 있어요.');
    expect(html).toContain('드럼 세팅에서 준비하기');
    expect(html).toContain('왼손·오른손 연결 안 됨');
    expect(html).toContain('적용 필요');
  });

  it('한 손만 끊긴 문구', () => {
    expect(need(['stick'], { connected: [false, true] })).toContain('왼손 연결 안 됨');
    expect(need(['stick'], { connected: [true, false] })).toContain('오른손 연결 안 됨');
  });

  it('키보드 입력이면 연결 점을 숨기고 키보드 문구', () => {
    const html = render({ keyboardOnly: true });
    expect(html).toContain('키보드 입력');
    expect(html).not.toContain('play-rp-hand-dot');
  });
});

describe('ReadyPanel 페달', () => {
  // 인수 조건: pedal이 undefined면 P 점·"페달" 문구가 없다(동글이 아닌 소스)
  it('pedal이 없으면 P 점과 페달 문구가 없다', () => {
    const html = render();
    expect(html).not.toContain('play-rp-hand-dot p');
    expect(html).not.toContain('페달');
    expect(html).toContain('왼손·오른손 연결됨');
  });

  // 인수 조건: 손 둘 + 페달이 모두 붙으면 "왼손·오른손·페달 연결됨"과 켜진 P 점
  it('모두 연결이면 한 문구와 켜진 P 점', () => {
    const html = render({ pedal: true });
    expect(html).toContain('왼손·오른손·페달 연결됨');
    expect(html).toContain('play-rp-hand-dot p on');
  });

  // 인수 조건: 페달만 빠지면 "페달 연결 안 됨"과 꺼진 P 점, missing 'pedal'이면 need 스타일
  it('페달만 끊기면 "페달 연결 안 됨"이고 need 스타일', () => {
    const html = need(['pedal'], { pedal: false });
    expect(html).toContain('페달 연결 안 됨');
    expect(html).not.toContain('왼손·페달');
    expect(html).toContain('play-rp-hand-dot p"');
    expect(html).toContain('<span class="need">페달 연결 안 됨</span>');
    expect(html).toContain('play-rp-dot need');
  });

  // 인수 조건: 왼손과 페달이 빠지면 "왼손·페달 연결 안 됨"
  it('왼손과 페달이 끊기면 둘을 함께 짚는다', () => {
    const html = need(['stick', 'pedal'], { connected: [false, true], pedal: false });
    expect(html).toContain('왼손·페달 연결 안 됨');
  });

  // 인수 조건: 키보드 전용이면 "키보드 입력", 점 없음
  it('키보드 전용이면 페달이 있어도 "키보드 입력"', () => {
    const html = render({ keyboardOnly: true, pedal: false });
    expect(html).toContain('키보드 입력');
    expect(html).not.toContain('play-rp-hand-dot');
  });
});

describe('ReadyPanel 연습 단계', () => {
  it('채보마다 LevelBadge 버튼, 선택만 aria-pressed', () => {
    const html = render();
    expect(html.match(/<button[^>]*song-level/g)).toHaveLength(3);
    for (const l of ['EASY', 'NORM', 'HARD']) expect(html).toContain(`>${l}</button>`);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/song-level-normal"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/song-level-easy song-level-dim"[^>]*aria-pressed="false"/);
  });
});

describe('ReadyPanel 동의 카드 없음(U19)', () => {
  it('동의 문구가 없다', () => {
    const html = render();
    expect(html).not.toContain('동의');
    expect(html).not.toContain('checkbox');
  });
});

describe('ReadyPanel 재연결', () => {
  it('onReconnect가 없으면 [다시 연결]이 없다', () => {
    expect(render()).not.toContain('다시 연결');
  });
  it('onReconnect가 있으면 [다시 연결]', () => {
    expect(render({ onReconnect: noop })).toContain('다시 연결');
  });
});

describe('ReadyPanel 최고 정확도', () => {
  it('값이 있으면 퍼센트로 표시', () => {
    expect(render({ bestAccuracy: 0.9876 })).toContain('최고 정확도 98.8%');
  });
  it('없으면 "—"', () => {
    expect(render()).toContain('최고 정확도 —');
  });
  it('메타 줄에 모드·BPM·길이', () => {
    expect(render()).toContain('리듬 게임 · BPM 120 · 3:05');
  });
});

describe('ReadyPanel 슬롯·악보 읽는 법', () => {
  const opt = <div className="test-options">옵션슬롯</div>;

  it('options 슬롯은 기기 준비 아래, 시작 줄 위에 그려진다', () => {
    const html = render({ options: opt });
    const i = html.indexOf('기기 준비</h3>');
    const j = html.indexOf('test-options');
    const k = html.indexOf('play-rp-start"');
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(k).toBeGreaterThan(j);
  });

  it('options가 없으면 슬롯 마크업이 없다', () => {
    expect(render()).not.toContain('test-options');
  });

  it('staffLegend면 오른쪽 열에서 StaffLegend가 미리 쳐 보기보다 먼저', () => {
    const html = render({ staffLegend: true });
    const side = html.indexOf('play-rp-side');
    const legend = html.indexOf('악보 읽는 법</h3>');
    const preview = html.indexOf('미리 쳐 보기');
    expect(side).toBeGreaterThan(-1);
    expect(legend).toBeGreaterThan(side);
    expect(preview).toBeGreaterThan(legend);
  });

  it('staffLegend가 꺼져 있으면 악보 읽는 법 카드가 없다', () => {
    const html = render();
    expect(html).not.toContain('악보 읽는 법');
    expect(html).toContain('미리 쳐 보기');
  });
});

describe('ReadyPanel footer 슬롯', () => {
  it('footer는 두 열 아래(body 뒤)에 그대로 들어가고, 없으면 아무것도 없다', () => {
    const html = render({ footer: <div className="x-footer">비슷한 곡</div> });
    expect(html).toContain('x-footer');
    expect(html.indexOf('x-footer')).toBeGreaterThan(html.indexOf('play-rp-side'));
    expect(render()).not.toContain('x-footer');
  });
});
