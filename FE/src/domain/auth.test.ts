import { describe, expect, it } from 'vitest';
import { LOGIN_PROVIDERS, SIGNUP_CONSENT_VERSION_INVALID, enabledProviders, loginErrorMessage, sanitizeReturnTo, signupErrorMessage } from './auth';

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
    expect(LOGIN_PROVIDERS.map((p) => p.label)).toEqual(['Google로 계속하기', 'SSAFY로 계속하기']);
  });
});

describe('enabledProviders', () => {
  const keys = (raw: string | undefined) => enabledProviders(raw).map((p) => p.key);

  it('미설정·빈 문자열이면 전부', () => {
    expect(enabledProviders(undefined)).toBe(LOGIN_PROVIDERS);
    expect(keys('')).toEqual(['google', 'ssafy']);
    expect(keys('  ')).toEqual(['google', 'ssafy']);
  });

  it('google만 지정하면 Google만', () => {
    expect(keys('google')).toEqual(['google']);
  });

  it('지정 순서와 무관하게 LOGIN_PROVIDERS 순서를 지키고 공백·대소문자를 무시한다', () => {
    expect(keys('ssafy, google')).toEqual(['google', 'ssafy']);
    expect(keys(' SSAFY ')).toEqual(['ssafy']);
  });

  it('모르는 키는 무시하고, 전부 모르면 전부 반환', () => {
    expect(keys('google,kakao')).toEqual(['google']);
    expect(keys('kakao')).toEqual(['google', 'ssafy']);
  });
});

describe('signupErrorMessage', () => {
  // ApiError와 같은 구조(code·detail)를 가진 Error
  const apiError = (code: string, detail = ''): Error => Object.assign(new Error(detail || code), { code, detail });

  it('판 불일치(422)는 서버 detail 대신 새로고침 안내를 보인다', () => {
    expect(signupErrorMessage(apiError(SIGNUP_CONSENT_VERSION_INVALID, 'termsVersion'))).toBe(
      '약관이 갱신되었어요. 새로고침한 뒤 다시 동의해 주세요.',
    );
  });

  it('네트워크 오류는 로그인과 같은 연결 안내를 보인다', () => {
    expect(signupErrorMessage(apiError('NETWORK'))).toBe(loginErrorMessage('network'));
  });

  it('그 밖의 오류는 서버 detail, 없으면 기본 문구', () => {
    expect(signupErrorMessage(apiError('HTTP_ERROR', '잘못된 요청입니다.'))).toBe('잘못된 요청입니다.');
    expect(signupErrorMessage(apiError('HTTP_ERROR'))).toBe('동의를 저장하지 못했습니다. 다시 시도해 주세요.');
    expect(signupErrorMessage('문자열 오류')).toBe('동의를 저장하지 못했습니다. 다시 시도해 주세요.');
  });
});
