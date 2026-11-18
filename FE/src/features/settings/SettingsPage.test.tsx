import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('메트로놈 구역에 메트로놈 박 분할(자동·4분음표·8분음표)이 있고 설정 값을 따른다', () => {
    const html = render();
    const group = /<div role="radiogroup" aria-label="메트로놈 박 분할".*?<\/div>/.exec(html)?.[0] ?? '';
    expect(group).toMatch(/aria-checked="true"[^>]*>자동</);
    expect(group).toContain('4분음표');
    expect(group).toContain('8분음표');
    expect(html).toContain('자동은 BPM 90 미만에서 8분음표로 울려요.');
  });

  it('음량 % 표시', () => {
    put(useSettings, { volume: 0.65 });
    expect(render()).toContain('65%');
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

  it('안내 문구는 메트로놈 음량·빠르기가 Dock에 있다고 말한다', () => {
    const html = render();
    expect(html).toContain('메트로놈 음량과 빠르기는 연주 화면 상단 Dock에서 바꿀 수 있어요.');
  });
});

describe('SettingsPage 설정 순서', () => {
  it('소리·메트로놈·판정·진행·화면 표시·꾸미기·계정·데이터 순으로 표시하고 기기 카드와 프리셋 요약은 없다', () => {
    const html = render();
    const headings = ['소리', '메트로놈', '판정·진행', '화면 표시', '꾸미기', '계정', '데이터 활용'].map((name) => html.indexOf(`>${name}</h3>`));
    expect(headings.every((index) => index >= 0)).toBe(true);
    expect(headings).toEqual([...headings].sort((a, b) => a - b));
    expect(html).not.toContain('>기기</h3>');
    expect(html).not.toContain('드럼 세팅 열기');
    expect(html).not.toContain('프리셋 · 보정');
  });

  it('비로그인에서는 데이터 구역을 두지 않는다', () => {
    put(useAuth, { status: 'anonymous', user: null });
    const html = render();
    expect(html).toContain('class="settings-grid"');
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

describe('SettingsPage 드럼 세팅에서 옮겨 온 값', () => {
  it('플레이 중 메트로놈·카운트다운 토글이 store 값을 따른다', () => {
    put(useSettings, { metronome: true, countInBars: 0 });
    const html = render();
    expect(switchChecked(html, '플레이 중 메트로놈')).toBe('true');
    expect(switchChecked(html, '카운트다운')).toBe('false');
  });

  it('판정 폭 Perfect·Good과 노트 낙하 시간이 기존 범위·단위로 보인다', () => {
    put(useSettings, { timing: { perfectMs: 30, goodMs: 80 }, scrollMs: 1500 });
    const html = render();
    expect(html).toContain('±30ms');
    expect(html).toContain('±80ms');
    expect(html).toContain('1500ms');
    expect(html).toMatch(/min="10"[^>]*max="60"|max="60"[^>]*min="10"/);
    expect(html).toMatch(/min="30"[^>]*max="150"|max="150"[^>]*min="30"/);
    expect(html).toMatch(/min="600"[^>]*max="3000"|max="3000"[^>]*min="600"/);
  });
});

describe('SettingsPage 박자 맞추기·판정 타이밍은 드럼 세팅으로 옮겼다', () => {
  it('박자 맞추기 버튼·기록과 스틱·킥 판정 타이밍이 없고 드럼 세팅 링크가 있다', () => {
    put(useSettings, {
      sensorKind: 'serial',
      timingCal: { measuredAt: new Date(2026, 10, 11).getTime(), medianMs: -66, madMs: 8, pairs: 12, input: 'sensor', outputLatencyMs: 40 },
      audioOffsetMs: -65,
    });
    const html = render();
    expect(html).not.toContain('스틱 판정 타이밍');
    expect(html).not.toContain('킥 판정 타이밍');
    expect(html).not.toContain('다시 맞추기');
    expect(html).not.toContain('맞췄어요');
    expect(html).not.toContain('min="-250"');
    expect(html).toContain('href="/setup"');
  });
});

describe('SettingsPage 타격 진동 방식(PLAY-006, 모니터 빌드 전용)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('일반 빌드에는 줄이 없다', () => {
    vi.stubEnv('VITE_MONITOR', 'false');
    expect(render()).not.toContain('타격 진동 방식');
  });

  it('모니터 빌드에는 두 선택지가 보이고 store 값이 선택돼 있다', () => {
    vi.stubEnv('VITE_MONITOR', 'true');
    put(useSettings, { playHaptic: 'local' });
    const html = render();
    expect(html).toContain('타격 진동 방식');
    expect(html).toContain('연주 중 진동을 판정 결과로 낼지 스틱이 치는 즉시 낼지 고릅니다.');
    expect(html).toMatch(/aria-checked="false"[^>]*data-value="judgement"[^>]*>판정 진동/);
    expect(html).toMatch(/aria-checked="true"[^>]*data-value="local"[^>]*>스틱 즉시 진동/);
  });
});
