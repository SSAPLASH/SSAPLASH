import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UserMe } from '@/domain/auth';
import { useAuth } from '@/store/authStore';
import { useLive } from '@/store/liveStore';
import { usePresets } from '@/store/presetStore';
import { useRecommendationConsent } from '@/store/recommendationConsentStore';
import { useSettings } from '@/store/settingsStore';
import { recommendationVersion } from '@/domain/signupTerms';
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
    activePresetId: 'system',
    volume: 0.8,
    audioOffsetMs: 0,
    liveCoach: true,
  });
  put(useLive, { connected: [false, false], referenceSetAt: null });
  put(usePresets, { items: [] });
});

describe('SettingsPage 계정 카드', () => {
  it('로그인 사용자: 닉네임·제공자·로그아웃·회원 탈퇴 카드', () => {
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

  it('사용자 없음: 로그인 링크만, 탈퇴 카드 없음', () => {
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

describe('SettingsPage 드럼 모양', () => {
  it('연주 카드에 드럼 모양 행과 캐러셀이 실시간 코칭 위에 있다', () => {
    const html = render();
    expect(html).toContain('드럼 모양');
    expect(html).toContain('aria-roledescription="carousel"');
    expect(html.indexOf('드럼 모양')).toBeLessThan(html.indexOf('실시간 코칭'));
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

describe('SettingsPage 기기 행', () => {
  it('키보드 전용', () => {
    expect(render()).toContain('키보드 전용');
  });

  it('센서 양손 연결됨', () => {
    put(useSettings, { sensorKind: 'ble' });
    put(useLive, { connected: [true, true] });
    expect(render()).toContain('>왼손·오른손 연결됨<');
  });

  it('동글 소스는 페달을 포함해 빠진 기기를 말한다(E4)', () => {
    put(useSettings, { sensorKind: 'webserial' });
    put(useLive, { connected: [true, true], pedal: { connected: [false, false], battery: null } });
    const html = render();
    expect(html).toContain('페달 연결 안 됨');
    expect(html).toContain('스틱·페달 연결');
  });

  it('센서 한 손만', () => {
    put(useSettings, { sensorKind: 'ble' });
    put(useLive, { connected: [true, false] });
    expect(render()).toContain('오른손 연결 안 됨');
  });

  it('센서 미연결', () => {
    put(useSettings, { sensorKind: 'ble' });
    put(useLive, { connected: [false, false] });
    expect(render()).toContain('연결 안 됨');
  });

  it('프리셋 값: 보정 필요·보정 완료·시스템 기본(UX-64)', () => {
    put(usePresets, { items: [{ id: 'p1', name: '내 세팅' } as never] });
    put(useSettings, { sensorKind: 'ble', activePresetId: 'p1' });
    put(useLive, { referenceSetAt: null });
    expect(render()).toContain('내 세팅 · 보정 필요');
    put(useLive, { referenceSetAt: 123 });
    expect(render()).toContain('내 세팅 · 보정 완료');
    put(useSettings, { activePresetId: 'system' });
    expect(render()).toContain('시스템 기본 · 보정 완료');
    put(useSettings, { sensorKind: 'none' });
    expect(render()).toContain('>시스템 기본<');
  });
});

describe('SettingsPage 데이터 활용 카드', () => {
  const V = recommendationVersion();
  const toggleTag = (html: string) => new RegExp(`<button[^>]*aria-label="맞춤 곡 추천 학습 활용"[^>]*>`).exec(html)?.[0] ?? '';

  it('계정 카드 아래에 머리 한 줄·행·도움말이 보인다', () => {
    const html = render();
    expect(html).toContain('데이터 활용');
    expect(html.indexOf('데이터 활용')).toBeGreaterThan(html.indexOf('드러머곰'));
    expect(html.indexOf('데이터 활용')).toBeLessThan(html.indexOf('>기기<'));
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
