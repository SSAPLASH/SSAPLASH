import { describe, expect, it } from 'vitest';
import { landingDialog, modeForRoute, modeRoute } from './landingRoute';

describe('landingRoute', () => {
  it('모드 키를 앱 경로로 바꾼다', () => {
    expect(modeRoute('free')).toBe('/free');
    expect(modeRoute('sheet')).toBe('/sheet');
    expect(modeRoute('game')).toBe('/play');
  });

  it('경로에서 모드를 되찾고, 모드 경로가 아니면 null', () => {
    expect(modeForRoute('/free')).toBe('free');
    expect(modeForRoute('/sheet')).toBe('sheet');
    expect(modeForRoute('/play')).toBe('game');
    expect(modeForRoute('/')).toBeNull();
    expect(modeForRoute('/settings')).toBeNull();
    expect(modeForRoute('/sheet?x=1')).toBeNull();
  });

  it('주소로 팝업 종류를 정한다', () => {
    expect(landingDialog('/login')).toBe('login');
    expect(landingDialog('/signup')).toBe('signup');
    expect(landingDialog('/')).toBe('none');
    expect(landingDialog('/welcome')).toBe('none');
    expect(landingDialog('/login/x')).toBe('none');
  });
});
