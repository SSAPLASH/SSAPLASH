// 제목 흐름 계산 (설계 CHART-003 라이브러리 재생바 3절)
import { describe, expect, it } from 'vitest';
import { MARQUEE_MIN_SEC, marqueeDurationSec, marqueeOverflows } from './marquee';

describe('marqueeOverflows', () => {
  it('칸보다 긴 제목만 참', () => {
    expect(marqueeOverflows(236, 400)).toBe(true);
    expect(marqueeOverflows(236, 237)).toBe(true);
  });

  it('칸에 들어가는 제목은 거짓(짧은 제목은 흐르지 않는다)', () => {
    expect(marqueeOverflows(236, 40)).toBe(false);
    expect(marqueeOverflows(236, 236)).toBe(false);
  });

  it('측정값이 없거나 이상하면 거짓', () => {
    expect(marqueeOverflows(0, 60)).toBe(false);
    expect(marqueeOverflows(236, 0)).toBe(false);
    expect(marqueeOverflows(Number.NaN, 60)).toBe(false);
    expect(marqueeOverflows(236, -5)).toBe(false);
  });
});

describe('marqueeDurationSec', () => {
  it('묶음 너비에 비례한다(초당 40px)', () => {
    expect(marqueeDurationSec(400)).toBe(10);
    expect(marqueeDurationSec(800)).toBe(20);
  });

  it('너무 짧거나 측정값이 없으면 최소 시간', () => {
    expect(marqueeDurationSec(40)).toBe(MARQUEE_MIN_SEC);
    expect(marqueeDurationSec(0)).toBe(MARQUEE_MIN_SEC);
    expect(marqueeDurationSec(Number.NaN)).toBe(MARQUEE_MIN_SEC);
  });
});
