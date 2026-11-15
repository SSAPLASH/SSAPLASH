import { beforeEach, describe, expect, it } from 'vitest';
import { practiceRateKey, rateFor, usePracticeRate } from './practiceRate';

beforeEach(() => usePracticeRate.setState({ key: null, rate: 1 }));

describe('고른 연습 속도 보관', () => {
  it('곡·채보 id를 모르면 키가 없고 배율은 1이다', () => {
    expect(practiceRateKey(null, 3)).toBeNull();
    expect(practiceRateKey(1, null)).toBeNull();
    expect(rateFor(usePracticeRate.getState(), null)).toBe(1);
  });

  it('같은 채보에서만 고른 값이 읽히고 다른 채보에서는 100 %다', () => {
    const key = practiceRateKey(1, 12)!;
    usePracticeRate.getState().setRate(key, 0.7);
    expect(rateFor(usePracticeRate.getState(), key)).toBe(0.7);
    expect(rateFor(usePracticeRate.getState(), practiceRateKey(1, 13))).toBe(1);
    expect(rateFor(usePracticeRate.getState(), practiceRateKey(2, 12))).toBe(1);
  });

  it('범위 밖·5 % 단위가 아닌 값은 100 %로 넣는다', () => {
    const key = practiceRateKey(1, 12)!;
    usePracticeRate.getState().setRate(key, 0.33);
    expect(rateFor(usePracticeRate.getState(), key)).toBe(1);
  });
});
