import { describe, expect, it } from 'vitest';
import {
  accompanimentOptionText,
  accompanimentStatusOf,
  accompanimentView,
  isAccompanimentPending,
  isPlayableStatus,
  songDetailFromDto,
  songFromDto,
  songLevelLabel,
  songLevelOf,
  songStatusView,
  sortMineSongs,
  summarizeMineSongs,
  type SongSummary,
} from './songCatalog';

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
    accompanimentStatus: 'NONE',
    songLevel: null,
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

describe('반주 상태 변환', () => {
  const base = { id: 1, title: '곡', source: 'MIDI', status: 'READY' };

  it('4값은 그대로 담는다', () => {
    for (const v of ['GENERATING', 'READY', 'FAILED', 'NONE'] as const) {
      expect(accompanimentStatusOf({ ...base, accompanimentStatus: v })).toBe(v);
    }
  });

  it('필드가 없거나 모르는 값이면 hasAccompaniment로 READY·NONE을 정한다', () => {
    expect(accompanimentStatusOf({ ...base, hasAccompaniment: true })).toBe('READY');
    expect(accompanimentStatusOf({ ...base, hasAccompaniment: false })).toBe('NONE');
    expect(accompanimentStatusOf(base)).toBe('NONE');
    expect(accompanimentStatusOf({ ...base, accompanimentStatus: 'QUEUED', hasAccompaniment: true })).toBe('READY');
    expect(accompanimentStatusOf({ ...base, accompanimentStatus: null })).toBe('NONE');
  });

  it('목록·상세 변환에 담긴다', () => {
    expect(songFromDto({ ...base, accompanimentStatus: 'GENERATING' }).accompanimentStatus).toBe('GENERATING');
    expect(songDetailFromDto({ ...base, accompanimentStatus: 'FAILED', charts: [] }).accompanimentStatus).toBe('FAILED');
  });
});

describe('accompanimentView', () => {
  it('채보 READY 곡의 생성 중·실패만 배지를 만든다', () => {
    expect(accompanimentView('READY', 'GENERATING')).toEqual({ label: '반주 생성 중', tone: 'active' });
    expect(accompanimentView('READY', 'FAILED')).toEqual({ label: '반주 생성 실패', tone: 'danger' });
    expect(accompanimentView('READY', 'READY')).toBeNull();
    expect(accompanimentView('READY', 'NONE')).toBeNull();
  });

  it('채보 생성 중·실패 곡에는 반주 배지를 만들지 않는다', () => {
    expect(accompanimentView('PROCESSING', 'GENERATING')).toBeNull();
    expect(accompanimentView('FAILED', 'FAILED')).toBeNull();
  });
});

describe('accompanimentOptionText', () => {
  it('반주가 있으면 빈 문자열, 생성 중이면 생성 중, 나머지는 반주 없음', () => {
    expect(accompanimentOptionText('READY')).toBe('');
    expect(accompanimentOptionText('GENERATING')).toBe('반주 생성 중');
    expect(accompanimentOptionText('FAILED')).toBe('반주 없음');
    expect(accompanimentOptionText('NONE')).toBe('반주 없음');
    expect(accompanimentOptionText(null)).toBe('반주 없음');
    expect(accompanimentOptionText(undefined)).toBe('반주 없음');
  });
});

describe('isAccompanimentPending', () => {
  it('채보 READY이고 반주 GENERATING일 때만 true', () => {
    expect(isAccompanimentPending({ status: 'READY', accompanimentStatus: 'GENERATING' })).toBe(true);
    expect(isAccompanimentPending({ status: 'PROCESSING', accompanimentStatus: 'GENERATING' })).toBe(false);
    expect(isAccompanimentPending({ status: 'READY', accompanimentStatus: 'READY' })).toBe(false);
    expect(isAccompanimentPending({ status: 'READY', accompanimentStatus: 'FAILED' })).toBe(false);
  });
});

describe('곡 난이도 변환', () => {
  const base = { id: 1, title: '곡', source: 'AUDIO', status: 'READY' };

  it('세 값은 그대로 담는다', () => {
    for (const v of ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const) expect(songFromDto({ ...base, songLevel: v }).songLevel).toBe(v);
  });

  it('없거나 null·모르는 값이면 null', () => {
    expect(songFromDto(base).songLevel).toBeNull();
    expect(songLevelOf(null)).toBeNull();
    expect(songLevelOf('EASY')).toBeNull();
    expect(songLevelOf('beginner')).toBeNull();
    expect(songLevelOf(1)).toBeNull();
  });

  it('상세(MIDI 201 포함)에도 담긴다', () => {
    expect(songDetailFromDto({ ...base, songLevel: 'ADVANCED', charts: [] }).songLevel).toBe('ADVANCED');
  });

  it('표기: 입문/중급/고급, 없으면 「—」', () => {
    expect(songLevelLabel('BEGINNER')).toBe('입문');
    expect(songLevelLabel('INTERMEDIATE')).toBe('중급');
    expect(songLevelLabel('ADVANCED')).toBe('고급');
    expect(songLevelLabel(null)).toBe('—');
  });
});
