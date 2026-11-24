import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserMe } from '@/domain/account/auth';
import { useAuth } from '@/store/authStore';
import { parseRecords, serializeRecords, type MiniRecord } from '@/features/mini/domain/miniRecord';
import { useMiniRecords } from './miniRecordStore';

const BASE_KEY = 'ssaplash.mini.v1';
const AT = '2026-11-23T10:00:00.000Z';

let data: Record<string, string>;

/** node 환경에는 localStorage가 없어 메모리 스텁을 끼운다 */
function stubStorage() {
  data = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
    removeItem: (k: string) => {
      delete data[k];
    },
  });
}

function rec(score: number, variant?: string): MiniRecord {
  const base = { gameId: 'speed' as const, score, at: AT, detail: { perSecond: [score, 0, 0, 0, 0, 0, 0, 0, 0, 0] } };
  return variant === undefined ? base : { ...base, variant };
}

function login(id: number | null) {
  useAuth.setState({ user: id === null ? null : ({ id } as UserMe) });
}

function stored(key: string) {
  return parseRecords(data[key]);
}

beforeEach(() => {
  stubStorage();
  login(null);
  useMiniRecords.getState().reload();
});

afterEach(() => {
  vi.unstubAllGlobals();
  login(null);
  useMiniRecords.setState({ owner: null, records: {} });
});

describe('계정별 저장 키', () => {
  it('로그인 계정이 없으면 기본 키에 쓴다', () => {
    useMiniRecords.getState().submit(rec(10));
    expect(stored(BASE_KEY).speed?.score).toBe(10);
    expect(Object.keys(data)).toEqual([BASE_KEY]);
  });

  it('로그인 계정이 있으면 `.u{userId}` 키에 쓴다', () => {
    login(7);
    useMiniRecords.getState().submit(rec(20));
    expect(Object.keys(data)).toEqual([`${BASE_KEY}.u7`]);
    expect(stored(`${BASE_KEY}.u7`).speed?.score).toBe(20);
  });

  it('계정을 바꾸면 그 계정의 키에서 다시 읽고 다른 계정의 기록은 보이지 않는다', () => {
    data[`${BASE_KEY}.u1`] = serializeRecords({ speed: rec(11) });
    data[`${BASE_KEY}.u2`] = serializeRecords({ speed: rec(22) });

    login(1);
    expect(useMiniRecords.getState().best('speed')?.score).toBe(11);
    login(2);
    expect(useMiniRecords.getState().best('speed')?.score).toBe(22);
    login(3);
    expect(useMiniRecords.getState().best('speed')).toBeNull();
    login(null);
    expect(useMiniRecords.getState().best('speed')).toBeNull();
  });

  it('바꾼 계정으로 기록하면 그 계정의 키에만 쓴다', () => {
    login(1);
    useMiniRecords.getState().submit(rec(11));
    login(2);
    useMiniRecords.getState().submit(rec(22));
    expect(stored(`${BASE_KEY}.u1`).speed?.score).toBe(11);
    expect(stored(`${BASE_KEY}.u2`).speed?.score).toBe(22);
  });
});

describe('submit', () => {
  it('첫 기록은 갱신이고 이전 기록은 null이며 저장된다', () => {
    const result = useMiniRecords.getState().submit(rec(30));
    expect(result).toEqual({ updated: true, previous: null });
    expect(useMiniRecords.getState().best('speed')?.score).toBe(30);
    expect(stored(BASE_KEY).speed?.score).toBe(30);
  });

  it('더 좋은 기록은 갱신하고 previous는 이전 기록이다', () => {
    useMiniRecords.getState().submit(rec(30));
    const result = useMiniRecords.getState().submit(rec(40));
    expect(result.updated).toBe(true);
    expect(result.previous?.score).toBe(30);
    expect(useMiniRecords.getState().best('speed')?.score).toBe(40);
    expect(stored(BASE_KEY).speed?.score).toBe(40);
  });

  it('동점은 갱신이 아니고 저장 값도 바뀌지 않는다', () => {
    useMiniRecords.getState().submit(rec(30));
    const before = data[BASE_KEY];
    const result = useMiniRecords.getState().submit({ ...rec(30), at: '2026-11-24T00:00:00.000Z' });
    expect(result.updated).toBe(false);
    expect(result.previous?.score).toBe(30);
    expect(data[BASE_KEY]).toBe(before);
    expect(useMiniRecords.getState().best('speed')?.at).toBe(AT);
  });

  it('못 미치면 그대로 둔다', () => {
    useMiniRecords.getState().submit(rec(30));
    const before = data[BASE_KEY];
    const result = useMiniRecords.getState().submit(rec(20));
    expect(result.updated).toBe(false);
    expect(result.previous?.score).toBe(30);
    expect(data[BASE_KEY]).toBe(before);
    expect(useMiniRecords.getState().best('speed')?.score).toBe(30);
  });

  it('갈래별로 따로 견준다', () => {
    useMiniRecords.getState().submit(rec(50));
    const a = useMiniRecords.getState().submit(rec(10, 'a'));
    expect(a).toEqual({ updated: true, previous: null });
    const lower = useMiniRecords.getState().submit(rec(5, 'a'));
    expect(lower.updated).toBe(false);
    expect(useMiniRecords.getState().best('speed')?.score).toBe(50);
    expect(useMiniRecords.getState().best('speed', 'a')?.score).toBe(10);
    expect(useMiniRecords.getState().best('speed', 'b')).toBeNull();
    expect(stored(BASE_KEY)).toMatchObject({ speed: { score: 50 }, 'speed:a': { score: 10 } });
  });
});

describe('저장소 실패', () => {
  it('setItem이 던져도 submit은 던지지 않고 메모리의 새 기록을 돌려준다', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    });
    let result: ReturnType<ReturnType<typeof useMiniRecords.getState>['submit']> | undefined;
    expect(() => {
      result = useMiniRecords.getState().submit(rec(33));
    }).not.toThrow();
    expect(result).toEqual({ updated: true, previous: null });
    expect(useMiniRecords.getState().best('speed')?.score).toBe(33);
  });

  it('getItem이 던져도 기록 없음으로 본다', () => {
    useMiniRecords.getState().submit(rec(33));
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {},
      removeItem: () => {},
    });
    expect(() => useMiniRecords.getState().reload()).not.toThrow();
    expect(useMiniRecords.getState().best('speed')).toBeNull();
  });
});

describe('reload', () => {
  it('저장소 값이 밖에서 바뀐 뒤 부르면 반영된다', () => {
    expect(useMiniRecords.getState().best('speed')).toBeNull();
    data[BASE_KEY] = serializeRecords({ speed: rec(77) });
    expect(useMiniRecords.getState().best('speed')).toBeNull();
    useMiniRecords.getState().reload();
    expect(useMiniRecords.getState().best('speed')?.score).toBe(77);
  });

  it('깨진 저장 값은 기록 없음으로 본다', () => {
    data[BASE_KEY] = '{깨짐';
    useMiniRecords.getState().reload();
    expect(useMiniRecords.getState().best('speed')).toBeNull();
  });
});
