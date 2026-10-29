import { describe, expect, it } from 'vitest';
import { isPlayableStatus, songDetailFromDto, songFromDto, songStatusView, sortMineSongs, summarizeMineSongs, type SongSummary } from './songCatalog';

describe('coverUrl 변환', () => {
  const base = { id: 1, title: '곡', source: 'AUDIO', status: 'READY' };

  it('문자열이면 그대로 담는다', () => {
    expect(songFromDto({ ...base, coverUrl: 'https://x/c.jpg' }).coverUrl).toBe('https://x/c.jpg');
  });

  it('없거나 null·빈 문자열·문자열이 아니면 null', () => {
    expect(songFromDto(base).coverUrl).toBeNull();
    expect(songFromDto({ ...base, coverUrl: null }).coverUrl).toBeNull();
    expect(songFromDto({ ...base, coverUrl: '' }).coverUrl).toBeNull();
    expect(songFromDto({ ...base, coverUrl: 123 }).coverUrl).toBeNull();
  });

  it('상세에도 담긴다', () => {
    expect(songDetailFromDto({ ...base, coverUrl: 'https://x/c.jpg', charts: [] }).coverUrl).toBe('https://x/c.jpg');
  });
});

function song(id: number, status: string, createdAt: string): SongSummary {
  return {
    id,
    title: `곡${id}`,
    artist: '',
    source: 'AUDIO',
    status,
    bpm: 0,
    timeSignature: '4/4',
    durationMs: null,
    hasAccompaniment: false,
    difficulties: [],
    createdAt,
    coverUrl: null,
  };
}

describe('songStatusView', () => {
  it('BE 곡 상태를 화면 문구와 색으로 바꾼다', () => {
    expect(songStatusView('READY')).toEqual({ label: '완료', tone: 'default' });
    expect(songStatusView('PROCESSING')).toEqual({ label: '채보 생성 중', tone: 'active' });
    expect(songStatusView('FAILED')).toEqual({ label: '생성 실패', tone: 'danger' });
  });

  it('모르는 상태는 원문 그대로 둔다', () => {
    expect(songStatusView('ARCHIVED')).toEqual({ label: 'ARCHIVED', tone: 'default' });
  });
});

describe('isPlayableStatus', () => {
  it('READY만 true', () => {
    expect(isPlayableStatus('READY')).toBe(true);
    expect(isPlayableStatus('PROCESSING')).toBe(false);
    expect(isPlayableStatus('FAILED')).toBe(false);
    expect(isPlayableStatus('ARCHIVED')).toBe(false);
  });
});

describe('sortMineSongs', () => {
  const items = [
    song(1, 'READY', '2026-10-01T00:00:00Z'),
    song(2, 'FAILED', '2026-10-02T00:00:00Z'),
    song(3, 'PROCESSING', '2026-10-03T00:00:00Z'),
    song(4, 'READY', '2026-10-05T00:00:00Z'),
    song(5, 'PROCESSING', '2026-10-04T00:00:00Z'),
    song(6, 'FAILED', '2026-10-06T00:00:00Z'),
  ];

  it('처리 중 → 실패 → 그 밖 순, 그룹 안에서는 최신순', () => {
    expect(sortMineSongs(items).map((s) => s.id)).toEqual([5, 3, 6, 2, 4, 1]);
  });

  it('원본은 건드리지 않는다', () => {
    const copy = [...items];
    sortMineSongs(items);
    expect(items).toEqual(copy);
  });
});

describe('summarizeMineSongs', () => {
  it('상태별 개수를 센다', () => {
    const items = [song(1, 'READY', ''), song(2, 'READY', ''), song(3, 'PROCESSING', ''), song(4, 'FAILED', '')];
    expect(summarizeMineSongs(items)).toEqual({ total: 4, ready: 2, processing: 1, failed: 1 });
  });

  it('모르는 상태는 total에만 센다', () => {
    expect(summarizeMineSongs([song(1, 'ARCHIVED', '')])).toEqual({ total: 1, ready: 0, processing: 0, failed: 0 });
  });

  it('빈 목록', () => {
    expect(summarizeMineSongs([])).toEqual({ total: 0, ready: 0, processing: 0, failed: 0 });
  });
});
