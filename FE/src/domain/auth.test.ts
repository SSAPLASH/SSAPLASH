import { describe, expect, it } from 'vitest';
import { LOGIN_PROVIDERS, loginErrorMessage, sanitizeReturnTo } from './auth';

describe('sanitizeReturnTo', () => {
  it('앱 안의 경로는 그대로 돌려준다', () => {
    expect(sanitizeReturnTo('/setup')).toBe('/setup');
    expect(sanitizeReturnTo('/play?song=basic-1')).toBe('/play?song=basic-1');
    expect(sanitizeReturnTo('/result/abc')).toBe('/result/abc');
  });

  it('없거나 비면 홈', () => {
    expect(sanitizeReturnTo(null)).toBe('/');
    expect(sanitizeReturnTo('')).toBe('/');
  });

  it('외부 URL·프로토콜 상대 경로·역슬래시는 홈으로 (오픈 리다이렉트 방지)', () => {
    expect(sanitizeReturnTo('https://evil.example')).toBe('/');
    expect(sanitizeReturnTo('//evil.example/x')).toBe('/');
    expect(sanitizeReturnTo('/\\evil.example')).toBe('/');
    expect(sanitizeReturnTo('setup')).toBe('/');
  });

  it('로그인·콜백 화면으로는 돌아가지 않는다 (로그인 루프 방지)', () => {
    expect(sanitizeReturnTo('/login')).toBe('/');
    expect(sanitizeReturnTo('/login?error=oauth_failed')).toBe('/');
    expect(sanitizeReturnTo('/auth/callback')).toBe('/');
  });
});

describe('loginErrorMessage', () => {
  it('BE·FE 오류 코드마다 한국어 문구가 있다', () => {
    for (const code of ['access_denied', 'oauth_failed', 'no_session', 'session_expired', 'network']) {
      const msg = loginErrorMessage(code);
      expect(msg, code).toBeTruthy();
    }
  });

  it('취소와 실패 문구는 다르다', () => {
    expect(loginErrorMessage('access_denied')).not.toBe(loginErrorMessage('oauth_failed'));
  });

  it('모르는 코드·null은 null', () => {
    expect(loginErrorMessage(null)).toBeNull();
    expect(loginErrorMessage('')).toBeNull();
    expect(loginErrorMessage('something_else')).toBeNull();
  });
});

describe('LOGIN_PROVIDERS', () => {
  it('google, ssafy 순서로 BE 경로 값과 라벨을 가진다', () => {
    expect(LOGIN_PROVIDERS.map((p) => p.key)).toEqual(['google', 'ssafy']);
    for (const p of LOGIN_PROVIDERS) expect(p.label.length).toBeGreaterThan(0);
  });
});
