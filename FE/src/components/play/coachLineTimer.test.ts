import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCoachLineTimer } from './coachLineTimer';

// 훅(useCoachLine)의 타이머·상태 규칙은 이 순수 모듈에 있으므로 fake timers로 검증한다
function setup() {
  const seen: (string | null)[] = [];
  const timer = createCoachLineTimer<string>((line) => seen.push(line));
  return { seen, timer };
}

describe('coachLineTimer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('show 뒤 displayMs가 지나면 null로 비운다', () => {
    const { seen, timer } = setup();
    timer.show('조금씩 늦어요', 3000);
    expect(seen).toEqual(['조금씩 늦어요']);
    vi.advanceTimersByTime(2999);
    expect(seen).toEqual(['조금씩 늦어요']);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual(['조금씩 늦어요', null]);
  });

  it('표시 중 다시 show하면 이전 타이머를 지우고 새 문구 기준으로 센다', () => {
    const { seen, timer } = setup();
    timer.show('첫째', 3000);
    vi.advanceTimersByTime(2000);
    timer.show('둘째', 3000);
    vi.advanceTimersByTime(1000); // 첫째의 3초 시점 — 비우지 않아야 한다
    expect(seen).toEqual(['첫째', '둘째']);
    vi.advanceTimersByTime(2000);
    expect(seen).toEqual(['첫째', '둘째', null]);
  });

  it('clear는 바로 비우고 타이머를 정리한다', () => {
    const { seen, timer } = setup();
    timer.show('문구', 3000);
    timer.clear();
    expect(seen).toEqual(['문구', null]);
    vi.advanceTimersByTime(5000);
    expect(seen).toEqual(['문구', null]); // 타이머가 남아 있었다면 null이 한 번 더 들어온다
  });

  it('dispose는 onChange 없이 타이머만 정리한다(언마운트)', () => {
    const { seen, timer } = setup();
    timer.show('문구', 3000);
    timer.dispose();
    vi.advanceTimersByTime(5000);
    expect(seen).toEqual(['문구']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('아무것도 띄우지 않은 상태의 clear·dispose는 안전하다', () => {
    const { seen, timer } = setup();
    timer.dispose();
    timer.clear();
    expect(seen).toEqual([null]);
  });
});
