import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UserMe } from '@/domain/auth';
import { dataConsentVersion } from '@/domain/signupTerms';
import { useAuth } from '@/store/authStore';
import { useLive } from '@/store/liveStore';
import { usePresets } from '@/store/presetStore';
import { useSettings } from '@/store/settingsStore';
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
    activePresetId: null,
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
    expect(switchChecked(html, '연주 기록 활용')).toBe('false');
    put(useSettings, { liveCoach: false });
    html = render();
    expect(switchChecked(html, '실시간 코칭')).toBe('false');
  });

  it('연주 기록 활용 토글은 서버 dataConsent와 판을 따른다', () => {
    // 답한 적 없음 → 꺼짐
    expect(switchChecked(render(), '연주 기록 활용')).toBe('false');
    // 동의 + 현재 판 → 켜짐
    const agreed = { agreed: true, version: dataConsentVersion(), updatedAt: '2026-11-02T00:00:00Z' };
    put(useAuth, { user: { ...user, dataConsent: agreed } });
    const on = render();
    expect(switchChecked(on, '연주 기록 활용')).toBe('true');
    expect(on).not.toContain('동의 문구가 바뀌어 다시 켜야 해요.');
    // 동의했지만 판 불일치 → 꺼짐 + 안내
    put(useAuth, { user: { ...user, dataConsent: { ...agreed, version: '1999-01-01' } } });
    const stale = render();
    expect(switchChecked(stale, '연주 기록 활용')).toBe('false');
    expect(stale).toContain('동의 문구가 바뀌어 다시 켜야 해요.');
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

describe('SettingsPage 기기 행', () => {
  it('키보드 전용', () => {
    expect(render()).toContain('키보드 전용');
  });

  it('센서 양손 연결됨', () => {
    put(useSettings, { sensorKind: 'ble' });
    put(useLive, { connected: [true, true] });
    expect(render()).toContain('>연결됨<');
  });

  it('센서 한 손만', () => {
    put(useSettings, { sensorKind: 'ble' });
    put(useLive, { connected: [true, false] });
    expect(render()).toContain('한 손만 연결됨');
  });

  it('센서 미연결', () => {
    put(useSettings, { sensorKind: 'ble' });
    put(useLive, { connected: [false, false] });
    expect(render()).toContain('연결 안 됨');
  });

  it('프리셋 값: 보정 필요·보정 완료·프리셋 없음', () => {
    put(usePresets, { items: [{ id: 'p1', name: '내 세팅' } as never] });
    put(useSettings, { sensorKind: 'ble', activePresetId: 'p1' });
    put(useLive, { referenceSetAt: null });
    expect(render()).toContain('내 세팅 · 보정 필요');
    put(useLive, { referenceSetAt: 123 });
    expect(render()).toContain('내 세팅 · 보정 완료');
    put(useSettings, { activePresetId: null });
    expect(render()).toContain('프리셋 없음 · 보정 완료');
    put(useSettings, { sensorKind: 'none' });
    expect(render()).toContain('>프리셋 없음<');
  });
});
