import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UserMe } from '@/domain/account/auth';
import { useAuth } from '@/store/authStore';
import { useRecommendationConsent } from '@/store/recommendationConsentStore';
import { useSettings } from '@/store/settingsStore';
import { recommendationVersion } from '@/domain/account/signupTerms';
import { SettingsPage } from './SettingsPage';

const user: UserMe = {
  id: 1,
  provider: 'GOOGLE',
  nickname: '드러머곰',
  profileImageUrl: null,
  role: 'USER',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  dataConsent: { agreed: null, version: null, updatedAt: null },
  signupCompleted: true,
  consents: { terms: null, privacy: null },
};

function render(): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
}

/** aria-label을 가진 스위치의 aria-checked 값 */
function switchChecked(html: string, label: string): string | undefined {
  const tag = new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`).exec(html)?.[0];
  return tag && /aria-checked="(true|false)"/.exec(tag)?.[1];
}

// zustand v5는 서버 렌더에서 getInitialState()를 읽으므로(setState가 반영되지 않는다) 초기 상태 객체에도 값을 넣고 끝나면 되돌린다
type Patchable = { setState: (p: object) => void; getInitialState: () => object };
const restores: Array<() => void> = [];
function put(store: Patchable, patch: object): void {
  const initial = store.getInitialState() as Record<string, unknown>;
  for (const key of Object.keys(patch)) {
    const had = Object.prototype.hasOwnProperty.call(initial, key);
    const prev = initial[key];
    restores.push(() => {
      if (had) initial[key] = prev;
      else delete initial[key];
    });
  }
  Object.assign(initial, patch);
  store.setState(patch);
}
afterEach(() => {
  while (restores.length) restores.pop()?.();
});

beforeEach(() => {
  put(useAuth, { status: 'authenticated', user });
  put(useSettings, {
    sensorKind: 'none',
    volume: 0.8,
    audioOffsetMs: 0,
    kickOffsetMs: null,
    timingCal: null,
    liveCoach: true,
  });
});

describe('SettingsPage 계정 카드', () => {
  it('로그인 사용자: 닉네임·제공자·로그아웃·회원 탈퇴 버튼', () => {
    const html = render();
    expect(html).toContain('드러머곰');
    expect(html).toContain('Google 계정으로 로그인');
    expect(html).toContain('로그아웃');
    expect(html).toContain('회원 탈퇴');
  });

  it('SSAFY 제공자 문구', () => {
    put(useAuth, { user: { ...user, provider: 'SSAFY' } });
    expect(render()).toContain('SSAFY 계정으로 로그인');
  });

  it('사용자 없음: 로그인 링크만, 탈퇴 버튼 없음', () => {
    put(useAuth, { status: 'anonymous', user: null });
    const html = render();
    expect(html).toContain('href="/login"');
    expect(html).not.toContain('로그아웃');
    expect(html).not.toContain('회원 탈퇴');
  });
});

describe('SettingsPage 토글·슬라이더 바인딩', () => {
  it('토글 aria-checked가 store 값을 따른다', () => {
    let html = render();
    expect(switchChecked(html, '실시간 코칭')).toBe('true');
    put(useSettings, { liveCoach: false });
    html = render();
    expect(switchChecked(html, '실시간 코칭')).toBe('false');
  });

  it('음량 %와 지연 보정 표시', () => {
    put(useSettings, { volume: 0.65, audioOffsetMs: 20 });
    expect(render()).toContain('65%');
    expect(render()).toContain('+20ms');
    put(useSettings, { audioOffsetMs: 0 });
    expect(render()).toContain('>0ms<');
    put(useSettings, { audioOffsetMs: -10 });
    expect(render()).toContain('-10ms');
  });
});

describe('SettingsPage 연주 구역 줄', () => {
  it('스위치 두 줄 사이에 안내 문단이 끼지 않는다(줄마다 구분선이 고르게 나온다)', () => {
    const html = render();
    const from = html.indexOf('실시간 코칭');
    const to = html.indexOf('드럼 모양');
    expect(html.slice(from, to)).not.toContain('settings-note');
  });

  it('스위치 줄 설명은 한 문장이다', () => {
    const html = render();
    for (const text of ['연주 중 늦음·빠름·연속 MISS를 드럼 옆에 알려 줘요.', '최근 타격이 빠른지 늦은지를 눈금으로 보여 줘요.']) {
      expect(html).toContain(text);
    }
  });

  it('패드 위치 자동 보정 스위치는 없다(항상 동작한다)', () => {
    expect(render()).not.toContain('패드 위치 자동 보정');
  });
});

describe('SettingsPage 드럼 모양', () => {
  it('연주 토글 다음에 드럼 모양·타격 이펙트 캐러셀이 나온다', () => {
    const html = render();
    expect(html).toContain('드럼 모양');
    expect(html).toContain('aria-roledescription="carousel"');
    expect(html.indexOf('실시간 코칭')).toBeLessThan(html.indexOf('타이밍 막대'));
    expect(html.indexOf('타이밍 막대')).toBeLessThan(html.indexOf('드럼 모양'));
    expect(html.indexOf('드럼 모양')).toBeLessThan(html.indexOf('타격 이펙트'));
  });
});

describe('SettingsPage 드럼·노래 음량', () => {
  it('슬라이더 두 개와 도움말을 렌더한다', () => {
    const html = render();
    expect(html).toContain('드럼 음량');
    expect(html).toContain('노래 음량');
    expect(html).toContain('패드 소리만. 100%가 기본');
    expect(html).toContain('게임·악보 반주만');
  });

  it('값 표시는 퍼센트로, 드럼은 200%까지', () => {
    put(useSettings, { drumVolume: 1.5, songVolume: 0.4 });
    const html = render();
    expect(html).toContain('150%');
    expect(html).toContain('40%');
    expect(html).toContain('max="2"');
  });

  it('안내 문구는 메트로놈만 Dock에 있다고 말한다', () => {
    const html = render();
    expect(html).toContain('메트로놈은 연주 화면 상단 Dock에서도 바꿀 수 있어요.');
    expect(html).not.toContain('음량과 메트로놈은');
  });
});

describe('SettingsPage 설정 순서', () => {
  it('오디오·연주·계정·데이터 순으로 표시하고 기기 카드와 프리셋 요약은 없다', () => {
    const html = render();
    const headings = ['오디오', '연주', '계정', '데이터 활용'].map((name) => html.indexOf(`>${name}</h3>`));
    expect(headings.every((index) => index >= 0)).toBe(true);
    expect(headings).toEqual([...headings].sort((a, b) => a - b));
    expect(html).not.toContain('>기기</h3>');
    expect(html).not.toContain('드럼 세팅 열기');
    expect(html).not.toContain('프리셋 · 보정');
    expect(html).toContain('settings-grid has-data');
  });

  it('비로그인에서는 데이터 구역과 그리드 예약 행을 두지 않는다', () => {
    put(useAuth, { status: 'anonymous', user: null });
    const html = render();
    expect(html).toContain('class="settings-grid"');
    expect(html).not.toContain('settings-grid has-data');
    expect(html).not.toContain('settings-data');
    expect(html).not.toContain('회원 탈퇴');
  });
});

describe('SettingsPage 데이터 활용 카드', () => {
  const V = recommendationVersion();
  const toggleTag = (html: string) => new RegExp(`<button[^>]*aria-label="맞춤 곡 추천 학습 활용"[^>]*>`).exec(html)?.[0] ?? '';

  it('계정 카드 아래에 머리 한 줄·행·도움말이 보인다', () => {
    const html = render();
    expect(html).toContain('데이터 활용');
    expect(html.indexOf('데이터 활용')).toBeGreaterThan(html.indexOf('드러머곰'));
    expect(html.indexOf('데이터 활용')).toBeGreaterThan(html.indexOf('>계정</h3>'));
    expect(html).toContain('연주 기록 활용 동의(필수)는 회원 탈퇴로만 철회돼요');
    expect(html).not.toContain('맞춤 곡 추천 학습 활용');
  });

  it('동의함: 토글 켜짐, 상태 줄에 판·변경일', () => {
    put(useRecommendationConsent, { status: 'ready', consent: { agreed: true, version: V, updatedAt: '2026-11-05T12:00:00Z' } });
    const html = render();
    expect(switchChecked(html, '맞춤 곡 추천 학습 활용')).toBe('true');
    expect(toggleTag(html)).not.toContain('disabled');
    expect(html).toContain(`동의함 · ${V} 판 · 11/05 변경`);
  });

  it('미동의: 비공개 상태에서 토글을 숨긴다', () => {
    put(useRecommendationConsent, { status: 'ready', consent: { agreed: false, version: V, updatedAt: '2026-11-05T12:00:00Z' } });
    const html = render();
    expect(switchChecked(html, '맞춤 곡 추천 학습 활용')).toBeUndefined();
    expect(html).toContain('>미동의<');
    expect(html).not.toContain('약관이 바뀌었어요');
  });

  it('판 불일치: 이전 동의와 새 판 필요를 표시', () => {
    put(useRecommendationConsent, { status: 'ready', consent: { agreed: true, version: '2026-01-01', updatedAt: '2026-01-02T12:00:00Z' } });
    const html = render();
    expect(switchChecked(html, '맞춤 곡 추천 학습 활용')).toBe('true');
    expect(html).toContain('이전 판에 동의함 · 2026-01-01 판 · 새 동의 내용 확인 필요');
  });

  it('읽기 실패: 미동의로 단정하지 않고 재시도를 표시', () => {
    put(useRecommendationConsent, { status: 'error', consent: null });
    const html = render();
    expect(switchChecked(html, '맞춤 곡 추천 학습 활용')).toBeUndefined();
    expect(html).not.toContain('>미동의<');
    expect(html).toContain('동의 상태를 불러오지 못했어요');
    expect(html).toContain('다시 시도');
  });

  it('아직 읽는 중이어도 토글은 잠겨 있고 오류 문구는 없다', () => {
    put(useRecommendationConsent, { status: 'loading', consent: null });
    const html = render();
    expect(toggleTag(html)).toBe('');
    expect(html).not.toContain('상태를 불러오지 못했어요');
  });

  it('로그인하지 않았으면 카드가 없다', () => {
    put(useAuth, { status: 'anonymous', user: null });
    expect(render()).not.toContain('데이터 활용');
  });
});

describe('SettingsPage 박자 맞추기', () => {
  const rec = { measuredAt: new Date(2026, 10, 11).getTime(), medianMs: -66, madMs: 8, pairs: 12, input: 'sensor', outputLatencyMs: 40 };

  it('맞춘 적이 없으면 안내와 [맞추기] 버튼', () => {
    const html = render();
    expect(html).toContain('아직 박자를 맞추지 않았어요');
    expect(html).toMatch(/<button[^>]*>맞추기<\/button>/);
    expect(html).not.toContain('다시 맞추기');
  });

  it('맞춘 뒤에는 날짜·입력과 [다시 맞추기]', () => {
    put(useSettings, { sensorKind: 'serial', timingCal: rec, audioOffsetMs: -65 });
    const html = render();
    expect(html).toContain('11월 11일에 스틱으로 맞췄어요');
    expect(html).toContain('다시 맞추기');
    expect(html).toContain('-65ms');
    expect(html).not.toContain('다시 맞춰 주세요');
  });

  it('킥 기록이 있으면 박자 맞추기 기록 줄에 킥 값도 보인다', () => {
    put(useSettings, { sensorKind: 'serial', timingCal: { ...rec, kick: { medianMs: -41, madMs: 5, pairs: 12 } } });
    expect(render()).toContain('11월 11일에 스틱으로 맞췄어요 · 킥 -40ms');
  });

  it('킥 값이 없으면 킥 슬라이더는 스틱 값을 보여 주고, 있으면 킥 값을 보인다', () => {
    put(useSettings, { audioOffsetMs: -65, kickOffsetMs: null });
    const html = render();
    expect(html.match(/-65ms/g)).toHaveLength(2);
    put(useSettings, { audioOffsetMs: -65, kickOffsetMs: -40 });
    const html2 = render();
    expect(html2.match(/-65ms/g)).toHaveLength(1);
    expect(html2).toContain('-40ms');
  });

  it('스틱으로 맞췄는데 지금 키보드만이면 다시 맞추라고 안내한다', () => {
    put(useSettings, { sensorKind: 'none', timingCal: rec });
    expect(render()).toContain('스틱으로 맞춘 값이에요. 키보드로 칠 때는 다시 맞춰 주세요.');
  });

  it('수동 칸은 스틱·킥 판정 타이밍이고 범위 −250~+100, 5ms 단위다', () => {
    const html = render();
    expect(html).toContain('스틱 판정 타이밍');
    expect(html).toContain('킥 판정 타이밍');
    expect(html).toContain('킥 페달 판정만 따로 맞춰요.');
    expect(html.match(/min="-250"/g)).toHaveLength(2);
    expect(html).toContain('판정이 빠르게 나오면 내리고, 늦게 나오면 올리세요');
    expect(html).not.toContain('타격음 지연 보정');
    expect(html).toMatch(/min="-250"/);
    expect(html).toMatch(/max="100"/);
    expect(html).toMatch(/step="5"/);
  });
});
