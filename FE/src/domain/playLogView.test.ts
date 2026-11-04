import { describe, expect, it } from 'vitest';
import { filterPlayLogs, formatPlayDate, HISTORY_PAGE_SIZE, pageInfo, playModeName, searchPlayLogs, sortPlayLogs } from './playLogView';

describe('formatPlayDate', () => {
  it('YYYY.MM.DD HH:mm 형식(로컬 시간, 0 채움)', () => {
    const d = new Date(2026, 0, 5, 3, 7); // 로컬 시각으로 만들어 시간대와 무관하게 비교
    expect(formatPlayDate(d.toISOString())).toBe('2026.01.05 03:07');
  });

  it('두 자리 월·일·시·분은 그대로', () => {
    const d = new Date(2026, 10, 21, 23, 59);
    expect(formatPlayDate(d.toISOString())).toBe('2026.11.21 23:59');
  });

  it('잘못된 날짜는 "-"', () => {
    expect(formatPlayDate('not-a-date')).toBe('-');
    expect(formatPlayDate('')).toBe('-');
  });
});

describe('playModeName', () => {
  it('RHYTHM=게임, SHEET=악보, 그 밖은 값 그대로', () => {
    expect(playModeName('RHYTHM')).toBe('게임');
    expect(playModeName('SHEET')).toBe('악보');
    expect(playModeName('FREE')).toBe('FREE');
  });
});

describe('filterPlayLogs', () => {
  const logs = [
    { id: 1, mode: 'RHYTHM' as const },
    { id: 2, mode: 'SHEET' as const },
    { id: 3, mode: 'FREE' as const },
    { id: 4, mode: 'RHYTHM' as const },
  ];

  it('전체는 모든 모드(자유 연습 포함)를 돌려주고 원본 배열과 다른 사본이다', () => {
    const r = filterPlayLogs(logs, 'ALL');
    expect(r.map((l) => l.id)).toEqual([1, 2, 3, 4]);
    expect(r).not.toBe(logs);
  });

  it('게임은 RHYTHM만', () => {
    expect(filterPlayLogs(logs, 'RHYTHM').map((l) => l.id)).toEqual([1, 4]);
  });

  it('악보는 SHEET만', () => {
    expect(filterPlayLogs(logs, 'SHEET').map((l) => l.id)).toEqual([2]);
  });

  it('다른 모드(FREE)는 전체에서만 보인다', () => {
    expect(filterPlayLogs(logs, 'RHYTHM').some((l) => l.mode === 'FREE')).toBe(false);
    expect(filterPlayLogs(logs, 'SHEET').some((l) => l.mode === 'FREE')).toBe(false);
    expect(filterPlayLogs(logs, 'ALL').some((l) => l.mode === 'FREE')).toBe(true);
  });
});

describe('pageInfo', () => {
  it('0건: 1쪽, 범위 0~0', () => {
    expect(pageInfo(0, 0)).toEqual({ page: 0, pageCount: 1, from: 0, to: 0 });
  });

  it('10건: 1쪽, 1~10', () => {
    expect(pageInfo(10, 0)).toEqual({ page: 0, pageCount: 1, from: 1, to: 10 });
  });

  it('13건: 2쪽, 1쪽 1~10, 2쪽 11~13', () => {
    expect(pageInfo(13, 0)).toEqual({ page: 0, pageCount: 2, from: 1, to: 10 });
    expect(pageInfo(13, 1)).toEqual({ page: 1, pageCount: 2, from: 11, to: 13 });
  });

  it('범위 밖 페이지는 보정한다(너무 크면 마지막, 음수면 0)', () => {
    expect(pageInfo(13, 5).page).toBe(1);
    expect(pageInfo(13, 5).from).toBe(11);
    expect(pageInfo(13, -3).page).toBe(0);
    expect(pageInfo(0, 4)).toEqual({ page: 0, pageCount: 1, from: 0, to: 0 });
  });

  it('쪽 크기 기본값은 HISTORY_PAGE_SIZE(10), 직접 지정도 된다', () => {
    expect(HISTORY_PAGE_SIZE).toBe(10);
    expect(pageInfo(20, 1)).toEqual({ page: 1, pageCount: 2, from: 11, to: 20 });
    expect(pageInfo(7, 1, 3)).toEqual({ page: 1, pageCount: 3, from: 4, to: 6 });
  });
});

describe('searchPlayLogs', () => {
  const logs = [{ title: 'Hello World' }, { title: '봄날' }, { title: 'hello' }];

  it('대소문자를 무시하고 부분 일치한다', () => {
    expect(searchPlayLogs(logs, 'HELLO').map((l) => l.title)).toEqual(['Hello World', 'hello']);
  });

  it('앞뒤 공백은 지운다', () => {
    expect(searchPlayLogs(logs, '  봄 ').map((l) => l.title)).toEqual(['봄날']);
  });

  it('빈 검색어는 전체 사본', () => {
    const r = searchPlayLogs(logs, '   ');
    expect(r).toEqual(logs);
    expect(r).not.toBe(logs);
  });

  it('일치가 없으면 빈 배열', () => {
    expect(searchPlayLogs(logs, 'zzz')).toEqual([]);
  });
});

describe('sortPlayLogs', () => {
  const at = (m: number) => new Date(2026, 10, 1, 9, m).toISOString();
  const logs = [
    { id: 1, startedAt: at(5) },
    { id: 2, startedAt: at(1) },
    { id: 3, startedAt: at(5) },
    { id: 4, startedAt: at(9) },
  ];

  it('NEWEST는 최신 먼저, 같은 시각은 원래 순서', () => {
    expect(sortPlayLogs(logs, 'NEWEST').map((l) => l.id)).toEqual([4, 1, 3, 2]);
  });

  it('OLDEST는 오래된 것 먼저, 같은 시각은 원래 순서', () => {
    expect(sortPlayLogs(logs, 'OLDEST').map((l) => l.id)).toEqual([2, 1, 3, 4]);
  });

  it('원본은 바뀌지 않는다', () => {
    sortPlayLogs(logs, 'OLDEST');
    expect(logs.map((l) => l.id)).toEqual([1, 2, 3, 4]);
  });
});
