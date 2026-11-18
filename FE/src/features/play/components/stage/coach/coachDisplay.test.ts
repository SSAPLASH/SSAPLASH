import { describe, expect, it } from 'vitest';
import { MAX_DELAY_MS, planCoachDisplay } from './coachDisplay';

describe('planCoachDisplay', () => {
  it('SHEET는 노트가 아무리 몰려도 바로 설명까지 띄운다', () => {
    const dense = Array.from({ length: 20 }, (_, i) => 1000 + i * 50);
    expect(planCoachDisplay(1000, dense, 'SHEET')).toEqual({ delayMs: 0, compact: false });
  });

  it('직후 1초 노트가 4개 미만이면 바로 띄운다', () => {
    expect(planCoachDisplay(1000, [1200, 1500, 1900, 2000], 'RHYTHM')).toEqual({ delayMs: 0, compact: false });
    expect(planCoachDisplay(1000, [], 'RHYTHM')).toEqual({ delayMs: 0, compact: false });
  });

  it('4개 이상이면 1초 노트 수가 4 미만이 되는 가장 이른 100ms 단위 지연으로 미룬다', () => {
    // [1000,2000)에 4개(1000·1300·1600·1900). 지연 100이면 [1100,2100)에 3개
    expect(planCoachDisplay(1000, [1000, 1300, 1600, 1900], 'RHYTHM')).toEqual({ delayMs: 100, compact: false });
    // 앞쪽이 몰려 있으면 지나간 뒤에 띄운다: 1000~1400 다섯 개, 이후는 3초 뒤
    expect(planCoachDisplay(1000, [1000, 1100, 1200, 1300, 1400, 4000], 'RHYTHM')).toEqual({ delayMs: 200, compact: false });
  });

  it('1.5초까지 계속 바쁘면 1.5초 미루고 구령만 띄운다', () => {
    const dense = Array.from({ length: 80 }, (_, i) => 1000 + i * 100);
    expect(planCoachDisplay(1000, dense, 'RHYTHM')).toEqual({ delayMs: MAX_DELAY_MS, compact: true });
  });

  it('결정 시각 이전 노트는 세지 않는다', () => {
    expect(planCoachDisplay(5000, [100, 200, 300, 400, 500], 'RHYTHM')).toEqual({ delayMs: 0, compact: false });
  });
});
