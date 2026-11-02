import { describe, expect, it } from 'vitest';
import { dateLabel } from './dateLabel';

// 기준 시각: 2026-10-29 15:00 (로컬)
const now = new Date(2026, 9, 29, 15, 0, 0).getTime();
const at = (y: number, m: number, d: number, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi).toISOString();

describe('dateLabel', () => {
  it('1분 미만은 방금(미래 시각 포함)', () => {
    expect(dateLabel(new Date(now - 59_000).toISOString(), now)).toBe('방금');
    expect(dateLabel(new Date(now).toISOString(), now)).toBe('방금');
    expect(dateLabel(new Date(now + 30_000).toISOString(), now)).toBe('방금');
  });

  it('오늘 안에서 1분부터 n분 전, 1시간부터 n시간 전', () => {
    expect(dateLabel(new Date(now - 60_000).toISOString(), now)).toBe('1분 전');
    expect(dateLabel(new Date(now - 59 * 60_000).toISOString(), now)).toBe('59분 전');
    expect(dateLabel(new Date(now - 60 * 60_000).toISOString(), now)).toBe('1시간 전');
    expect(dateLabel(at(2026, 10, 29, 3, 0), now)).toBe('12시간 전');
  });

  it('어제 날짜면 시각과 관계없이 어제', () => {
    expect(dateLabel(at(2026, 10, 28, 0, 0), now)).toBe('어제');
    expect(dateLabel(at(2026, 10, 28, 23, 59), now)).toBe('어제');
  });

  it('그제부터 올해는 「n월 n일」', () => {
    expect(dateLabel(at(2026, 10, 27, 12), now)).toBe('10월 27일');
    expect(dateLabel(at(2026, 1, 5), now)).toBe('1월 5일');
  });

  it('월 경계에서도 어제 계산이 맞다', () => {
    const first = new Date(2026, 10, 1, 9, 0).getTime();
    expect(dateLabel(at(2026, 10, 31), first)).toBe('어제');
  });

  it('작년 이전은 「n년 n월 n일」', () => {
    expect(dateLabel(at(2025, 12, 31), now)).toBe('2025년 12월 31일');
  });

  it('해가 바뀐 직후 12월 31일은 어제', () => {
    expect(dateLabel(at(2026, 12, 31), new Date(2027, 0, 1, 10).getTime())).toBe('어제');
  });

  it('잘못된 날짜는 빈 문자열', () => {
    expect(dateLabel('not-a-date', now)).toBe('');
  });
});
