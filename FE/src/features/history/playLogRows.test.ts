// 플레이 기록 행에 보일 값 만들기 (설계 COACH-연주-기록-화면-개편 1·4)
import { describe, expect, it } from 'vitest';
import type { PlaySummary } from '@/api/play/plays';
import type { PlayLog, PlayUploadState } from '@/domain/play/playLog';
import { localRowView, serverRowView } from './playLogRows';

const play = (over: Partial<PlaySummary> = {}): PlaySummary => ({
  playId: 'p1', startedAt: '2026-11-12T05:00:00Z', endedAt: '2026-11-12T05:01:04Z', mode: 'RHYTHM', inputSource: 'STICK', songId: 1, songTitle: '별빛 산책',
  chartVersionId: 2, chartId: 3, difficulty: 'HARD', endReason: 'COMPLETED', songAccessible: true, score: 141250, accuracy: 74.1, maxCombo: 10, hasReport: true, ...over,
});
const log = (over: Partial<PlayLog> = {}): PlayLog =>
  ({
    playId: 'l1', songId: 's', title: '기본 8비트', difficulty: 'NORMAL', mode: 'RHYTHM', startedAt: '2026-11-12T05:00:00Z', endedAt: '2026-11-12T05:01:04Z',
    durationMs: 64000, songNumericId: 7, summary: { score: 82300, maxScore: 96000, accuracy: 0.852, maxCombo: 3, counts: { PERFECT: 0, GOOD: 0, MISS: 0 }, strayHits: 0 }, ...over,
  }) as PlayLog;
const up = (status: PlayUploadState['status'], retryable = false): PlayUploadState => ({ status, reason: null, retryable, attempts: 1, updatedAt: '' });

describe('serverRowView', () => {
  it('서버 기록: 제목·난이도·종료 시각·연주 길이·정확도·점수와 리포트 링크', () => {
    expect(serverRowView(play(), false)).toEqual({
      playId: 'p1', title: '별빛 산책', titleMuted: false, mode: 'RHYTHM', level: 'HARD', at: '2026-11-12T05:01:04Z', durationMs: 64000,
      accuracy: 74.1, score: 141250, wideGoodMs: null, rate: null, chips: [], save: null, link: { kind: 'REPORT', to: '/result/p1/report' },
    });
  });

  it('악보 연습은 점수를 비우고, 끝까지 치지 않았으면 「중단」을 붙인다', () => {
    const row = serverRowView(play({ mode: 'SHEET', difficulty: 'NORMAL', score: 0, endReason: 'ABORTED' }), false);
    expect(row.score).toBeNull();
    expect(row.level).toBe('NORMAL');
    expect(row.chips).toEqual(['ABORTED']);
    expect(serverRowView(play({ endReason: null }), false).chips).toEqual([]);
  });

  it('접근할 수 없는 곡은 제목을 흐리게 하고 칩을 붙인다. 제목이 없으면 대신 쓸 제목', () => {
    const row = serverRowView(play({ songTitle: null, songAccessible: false, accuracy: null, score: null }), false);
    expect(row).toMatchObject({ title: '제목 없는 연주', titleMuted: true, chips: ['UNAVAILABLE'], accuracy: null, score: null });
    // 곡 없이 친 기록(songId null)은 접근 불가가 아니다
    expect(serverRowView(play({ songId: null, songAccessible: false }), false).chips).toEqual([]);
  });

  it('리포트가 없으면 이 브라우저에 로그가 있을 때만 결과로 간다', () => {
    expect(serverRowView(play({ hasReport: false }), true).link).toEqual({ kind: 'RESULT', to: '/result/p1' });
    expect(serverRowView(play({ hasReport: false }), false).link).toBeNull();
  });
});

describe('연습 속도 표시(rate)', () => {
  it('서버 기록은 응답의 playbackRate, 이 브라우저의 기록은 로그의 playbackRate를 쓴다. 원래 빠르기·필드 없음은 null', () => {
    expect(serverRowView(play({ playbackRate: 0.7 }), false).rate).toBe(0.7);
    expect(serverRowView(play({ playbackRate: 1 }), false).rate).toBeNull();
    expect(serverRowView(play(), false).rate).toBeNull();
    expect(localRowView(log({ playbackRate: 0.85 }), { deleted: false, upload: undefined, showSave: false }).rate).toBe(0.85);
    expect(localRowView(log(), { deleted: false, upload: undefined, showSave: false }).rate).toBeNull();
  });
});

describe('판정 폭 표시(wideGoodMs)', () => {
  const timed = (goodMs: number) => ({ timing: { perfectMs: 25, goodMs } });
  it('서버 기록은 이 브라우저에 로그가 남은 것만 넓힌 폭을 안다', () => {
    expect(serverRowView(play(), true, timed(90)).wideGoodMs).toBe(90);
    expect(serverRowView(play(), false).wideGoodMs).toBeNull();
    expect(serverRowView(play(), true, timed(60)).wideGoodMs).toBeNull();
  });
  it('로컬 기록은 로그의 판정 폭을 쓴다', () => {
    const o = { deleted: false, upload: undefined, showSave: false } as unknown as Parameters<typeof localRowView>[1];
    expect(localRowView(log(timed(90)), o).wideGoodMs).toBe(90);
    expect(localRowView(log(timed(60)), o).wideGoodMs).toBeNull();
  });
});

describe('localRowView', () => {
  it('서버에 없는 기록: 정확도는 백분율로, 결과 링크, 저장 상태', () => {
    expect(localRowView(log(), { deleted: false, upload: up('FAILED', true), showSave: true })).toEqual({
      playId: 'l1', title: '기본 8비트', titleMuted: false, mode: 'RHYTHM', level: 'NORMAL', at: '2026-11-12T05:01:04Z', durationMs: 64000,
      accuracy: 85.2, score: 82300, wideGoodMs: null, rate: null, chips: [], save: 'FAILED', link: { kind: 'RESULT', to: '/result/l1' },
    });
  });

  it('종료 시각이 없는 옛 로그는 시작 시각을 쓰고, 악보 연습은 점수를 비운다', () => {
    const row = localRowView(log({ endedAt: undefined, mode: 'SHEET' }), { deleted: false, upload: undefined, showSave: true });
    expect(row.at).toBe('2026-11-12T05:00:00Z');
    expect(row.score).toBeNull();
    expect(row.save).toBe('UNSAVED');
  });

  it('삭제된 곡은 제목을 흐리게 하고 칩을 붙인다. 로그인 없는 빌드는 저장 상태를 보이지 않는다', () => {
    const row = localRowView(log(), { deleted: true, upload: up('UPLOADING'), showSave: false });
    expect(row).toMatchObject({ titleMuted: true, chips: ['DELETED'], save: null });
  });
});
