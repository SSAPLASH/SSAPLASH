// 플레이 기록 목록 조회의 순수 부분 (설계 COACH-연주-기록-화면-개편 3-1·4)
import { describe, expect, it } from 'vitest';
import type { PlaySummary } from '@/api/play/plays';
import type { PageResponse } from '@/api/play/recordings';
import { appendPlayPage, buildPlayParams, PLAY_LIST_EMPTY } from './usePlayLogList';

// 한국 시간 11월 12일 15:00
const now = new Date(Date.UTC(2026, 10, 12, 6, 0));
const play = (playId: string): PlaySummary => ({
  playId, startedAt: '2026-11-12T05:00:00Z', endedAt: '2026-11-12T05:01:00Z', mode: 'RHYTHM', inputSource: 'KEYBOARD', songId: 1, songTitle: '곡',
  chartVersionId: 1, chartId: 1, difficulty: 'NORMAL', endReason: 'COMPLETED', songAccessible: true, score: 100, accuracy: 50, maxCombo: 1, hasReport: true,
});
const page = (n: number, ids: string[], hasNext: boolean, total = 5): PageResponse<PlaySummary> => ({
  items: ids.map(play), page: n, size: 20, totalElements: total, totalPages: 2, hasNext,
});

describe('buildPlayParams', () => {
  it('기본 조건은 정렬과 size 20만 보낸다', () => {
    expect(buildPlayParams({ mode: 'ALL', period: 'ALL', sort: 'NEWEST', q: '' }, now)).toEqual({
      q: undefined, from: undefined, to: undefined, mode: undefined, sort: 'NEWEST', page: 0, size: 20,
    });
  });

  it('모드·기간(한국 시간)·정렬·검색어(앞뒤 공백 제거)·쪽을 담는다', () => {
    expect(buildPlayParams({ mode: 'SHEET', period: '7D', sort: 'OLDEST', q: '  별빛 ' }, now, 3)).toEqual({
      q: '별빛', from: '2026-11-06', to: '2026-11-12', mode: 'SHEET', sort: 'OLDEST', page: 3, size: 20,
    });
  });

  it('공백뿐인 검색어는 생략', () => {
    expect(buildPlayParams({ mode: 'ALL', period: 'ALL', sort: 'NEWEST', q: '   ' }, now).q).toBeUndefined();
  });
});

describe('appendPlayPage', () => {
  it('page 0은 교체하고 total·hasNext를 따른다', () => {
    const prev = { items: [play('x')], total: 9, hasNext: false };
    expect(appendPlayPage(prev, page(0, ['a', 'b'], true))).toEqual({ items: [play('a'), play('b')], total: 5, hasNext: true });
  });

  it('다음 쪽은 뒤에 이어 붙이고, 이미 있는 playId는 건너뛴다', () => {
    const first = appendPlayPage(PLAY_LIST_EMPTY, page(0, ['a', 'b'], true));
    const next = appendPlayPage(first, page(1, ['b', 'c'], false));
    expect(next.items.map((p) => p.playId)).toEqual(['a', 'b', 'c']);
    expect(next.hasNext).toBe(false);
  });
});
