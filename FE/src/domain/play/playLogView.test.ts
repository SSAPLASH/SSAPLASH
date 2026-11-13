import { describe, expect, it } from 'vitest';
import {
  accuracyTier,
  filterPlayLogs,
  formatPlayClock,
  formatPlayDate,
  groupByDay,
  historyRowLevel,
  historyRowLink,
  inPeriod,
  mergeUnsaved,
  periodRange,
  playDayLabel,
  playModeName,
  saveStatusOf,
  searchPlayLogs,
  unsavedLogs,
} from './playLogView';
import type { PlayUploadState } from './playLog';

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
  it('리듬 게임·악보 연습·자유 연습, 모르는 모드는 값 그대로', () => {
    expect(playModeName('RHYTHM')).toBe('리듬 게임');
    expect(playModeName('SHEET')).toBe('악보 연습');
    expect(playModeName('FREE')).toBe('자유 연습');
    expect(playModeName('TEMPO')).toBe('TEMPO');
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

describe('historyRowLevel', () => {
  it('리듬 게임·악보 연습 행 모두 난이도를 보인다(338 개편), 그 밖의 모드는 null', () => {
    expect(historyRowLevel({ mode: 'RHYTHM', difficulty: 'EASY' })).toBe('EASY');
    expect(historyRowLevel({ mode: 'RHYTHM', difficulty: 'HARD' })).toBe('HARD');
    expect(historyRowLevel({ mode: 'SHEET', difficulty: 'NORMAL' })).toBe('NORMAL');
    expect(historyRowLevel({ mode: 'FREE', difficulty: 'EASY' })).toBeNull();
  });

  it('EASY·NORMAL·HARD가 아니면 null', () => {
    expect(historyRowLevel({ mode: 'RHYTHM', difficulty: 'weird' })).toBeNull();
    expect(historyRowLevel({ mode: 'RHYTHM', difficulty: '' })).toBeNull();
  });
});

describe('날짜 묶음', () => {
  const now = new Date(2026, 10, 12, 15, 0); // 로컬 11월 12일(목)
  const at = (day: number, h: number, m = 0, month = 10, year = 2026) => new Date(year, month, day, h, m).toISOString();

  it('오늘·어제는 앞에 붙이고, 그 밖은 날짜와 요일만', () => {
    expect(playDayLabel(at(12, 0, 5), now)).toBe('오늘 · 11월 12일 (목)');
    expect(playDayLabel(at(11, 23, 59), now)).toBe('어제 · 11월 11일 (수)');
    expect(playDayLabel(at(3, 9), now)).toBe('11월 3일 (화)');
  });

  it('해가 다르면 연도를 붙이고, 못 읽는 시각은 "-"', () => {
    expect(playDayLabel(at(31, 9, 0, 11, 2025), now)).toBe('2025년 12월 31일 (수)');
    expect(playDayLabel('nope', now)).toBe('-');
  });

  it('행 순서를 지키며 같은 날끼리 묶는다', () => {
    const rows = [
      { id: 1, at: at(12, 14) },
      { id: 2, at: at(12, 9) },
      { id: 3, at: at(11, 22) },
      { id: 4, at: at(3, 8) },
    ];
    const groups = groupByDay(rows, (r) => r.at, now);
    expect(groups.map((g) => [g.label, g.items.map((r) => r.id)])).toEqual([
      ['오늘 · 11월 12일 (목)', [1, 2]],
      ['어제 · 11월 11일 (수)', [3]],
      ['11월 3일 (화)', [4]],
    ]);
    expect(new Set(groups.map((g) => g.key)).size).toBe(3);
  });

  it('formatPlayClock: 오전·오후 h:mm', () => {
    expect(formatPlayClock(at(12, 0, 5))).toBe('오전 12:05');
    expect(formatPlayClock(at(12, 9, 30))).toBe('오전 9:30');
    expect(formatPlayClock(at(12, 12, 0))).toBe('오후 12:00');
    expect(formatPlayClock(at(12, 23, 59))).toBe('오후 11:59');
    expect(formatPlayClock('nope')).toBe('-');
  });
});

describe('기간 → 서버 날짜(한국 시간)', () => {
  // 한국 시간 11월 13일 01:00 (UTC로는 12일 16:00)
  const now = new Date(Date.UTC(2026, 10, 12, 16, 0));

  it('전체 기간은 비우고, 7일·30일은 오늘을 포함해 센다', () => {
    expect(periodRange('ALL', now)).toEqual({});
    expect(periodRange('7D', now)).toEqual({ from: '2026-11-07', to: '2026-11-13' });
    expect(periodRange('30D', now)).toEqual({ from: '2026-10-15', to: '2026-11-13' });
  });

  it('inPeriod는 한국 시간 날짜로 양 끝을 포함해 본다', () => {
    const range = periodRange('7D', now);
    expect(inPeriod('2026-11-06T15:00:00Z', range)).toBe(true); // 한국 시간 7일 00:00
    expect(inPeriod('2026-11-06T14:59:59Z', range)).toBe(false); // 한국 시간 6일 23:59
    expect(inPeriod('2026-11-13T14:59:59Z', range)).toBe(true); // 한국 시간 13일 23:59
    expect(inPeriod('2026-11-13T15:00:00Z', range)).toBe(false);
    expect(inPeriod('2020-01-01T00:00:00Z', {})).toBe(true);
    expect(inPeriod('nope', range)).toBe(false);
    // 전체 기간이면 날짜를 못 읽는 로그도 거르지 않는다(목록에서 사라지지 않게)
    expect(inPeriod('nope', {})).toBe(true);
  });
});

describe('저장 상태', () => {
  const up = (status: PlayUploadState['status'], retryable = false): PlayUploadState => ({ status, reason: null, retryable, attempts: 1, updatedAt: '' });

  it('올리는 중은 SAVING, 다시 보낼 수 있는 실패는 FAILED, 그 밖은 UNSAVED, 끝났으면 null', () => {
    expect(saveStatusOf(up('UPLOADING'))).toBe('SAVING');
    expect(saveStatusOf(up('FAILED', true))).toBe('FAILED');
    expect(saveStatusOf(up('FAILED', false))).toBe('UNSAVED');
    expect(saveStatusOf(up('SKIPPED'))).toBe('UNSAVED');
    expect(saveStatusOf(undefined)).toBe('UNSAVED');
    expect(saveStatusOf(up('DONE'))).toBeNull();
  });

  it('unsavedLogs: 받은 서버 목록에 있거나 저장이 끝난 로그는 뺀다', () => {
    const logs = [
      { playId: 'a', upload: up('UPLOADING') },
      { playId: 'b', upload: up('DONE') }, // 서버에 있다(아직 받지 않은 쪽일 수 있다)
      { playId: 'c', upload: up('FAILED', true) },
      { playId: 'd' }, // 옛 로그
      { playId: 'e', upload: up('FAILED', true) }, // 받은 서버 쪽에 이미 있다
    ];
    expect(unsavedLogs(logs, new Set(['e']), {}).map((l) => l.playId)).toEqual(['a', 'c', 'd']);
  });

  it('unsavedLogs: 이번 접속의 상태가 저장된 값보다 먼저다', () => {
    const logs = [
      { playId: 'a', upload: up('UPLOADING') },
      { playId: 'c', upload: up('FAILED', true) },
    ];
    expect(unsavedLogs(logs, new Set(), { a: up('DONE') }).map((l) => l.playId)).toEqual(['c']);
  });
});

describe('mergeUnsaved', () => {
  const t = (h: number) => new Date(2026, 10, 12, h).toISOString();
  const server = [{ id: 's1', at: t(20) }, { id: 's2', at: t(15) }, { id: 's3', at: t(10) }];
  const local = [{ id: 'l1', at: t(22) }, { id: 'l2', at: t(12) }, { id: 'l3', at: t(5) }];
  type Row = { id: string; at: string };
  const opts = { serverTime: (r: Row) => r.at, localTime: (r: Row) => r.at };
  const ids = (rows: Row[]) => rows.map((r) => r.id);

  it('다음 쪽이 없으면 전부 시각 순서로 섞는다', () => {
    expect(ids(mergeUnsaved(server, local, { ...opts, sort: 'NEWEST', hasNext: false }))).toEqual(['l1', 's1', 's2', 'l2', 's3', 'l3']);
  });

  it('다음 쪽이 있으면 받은 범위 안의 것만 섞는다(최신순: 마지막 서버 행보다 오래된 것은 뺀다)', () => {
    expect(ids(mergeUnsaved(server, local, { ...opts, sort: 'NEWEST', hasNext: true }))).toEqual(['l1', 's1', 's2', 'l2', 's3']);
  });

  it('오래된순은 방향이 반대다', () => {
    const asc = [...server].reverse();
    expect(ids(mergeUnsaved(asc, local, { ...opts, sort: 'OLDEST', hasNext: true }))).toEqual(['l3', 's3', 'l2', 's2', 's1']);
    expect(ids(mergeUnsaved(asc, local, { ...opts, sort: 'OLDEST', hasNext: false }))).toEqual(['l3', 's3', 'l2', 's2', 's1', 'l1']);
  });

  it('서버 행이 없으면 서버에 없는 기록만, 같은 시각이면 서버 행이 먼저', () => {
    expect(ids(mergeUnsaved([], local, { ...opts, sort: 'NEWEST', hasNext: false }))).toEqual(['l1', 'l2', 'l3']);
    expect(ids(mergeUnsaved([{ id: 's', at: t(12) }], [{ id: 'l', at: t(12) }], { ...opts, sort: 'NEWEST', hasNext: false }))).toEqual(['s', 'l']);
  });
});

describe('accuracyTier', () => {
  it('90 이상 PERFECT, 70 이상 GOOD, 그 아래 MISS(판정 색과 같은 뜻)', () => {
    expect(accuracyTier(100)).toBe('PERFECT');
    expect(accuracyTier(90)).toBe('PERFECT');
    expect(accuracyTier(89.99)).toBe('GOOD');
    expect(accuracyTier(70)).toBe('GOOD');
    expect(accuracyTier(69.99)).toBe('MISS');
    expect(accuracyTier(0)).toBe('MISS');
  });
});

describe('historyRowLink', () => {
  it('리포트가 있으면 리포트, 없고 이 브라우저에 로그가 있으면 결과, 둘 다 없으면 null', () => {
    expect(historyRowLink({ playId: 'p1', hasReport: true, hasLocal: false })).toEqual({ kind: 'REPORT', to: '/result/p1/report' });
    expect(historyRowLink({ playId: 'p1', hasReport: true, hasLocal: true })).toEqual({ kind: 'REPORT', to: '/result/p1/report' });
    expect(historyRowLink({ playId: 'p1', hasReport: false, hasLocal: true })).toEqual({ kind: 'RESULT', to: '/result/p1' });
    expect(historyRowLink({ playId: 'p1', hasReport: false, hasLocal: false })).toBeNull();
  });
});
