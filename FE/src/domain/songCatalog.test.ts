import { describe, expect, it } from 'vitest';
import type { Difficulty } from './chart';
import {
  artistLabel,
  UNKNOWN_ARTIST,
  accompanimentOptionText,
  chartFallback,
  defaultChartId,
  type ChartSummary,
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

describe('sheetId 변환', () => {
  const base = { id: 1, title: '곡', source: 'AUDIO', status: 'READY' };

  it('없거나 null이면 null', () => {
    expect(songFromDto(base).sheetId).toBeNull();
    expect(songFromDto({ ...base, sheetId: null }).sheetId).toBeNull();
  });

  it('숫자면 그대로, 상세도 같다', () => {
    expect(songFromDto({ ...base, sheetId: 12 }).sheetId).toBe(12);
    expect(songDetailFromDto({ ...base, sheetId: 12, charts: [] }).sheetId).toBe(12);
  });

  it('정수가 아니면 거부한다', () => {
    expect(() => songFromDto({ ...base, sheetId: 'x' })).toThrow();
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
    sheetId: null,
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

// 260번: BE가 노트가 NORMAL과 같은 HARD·EASY를 곡 응답에서 뺀다. 기본 연습 단계와 URL 보정은 응답 목록만 본다.
function chartOf(id: number, difficulty: Difficulty): ChartSummary {
  return { id, difficulty, chartVersionId: id * 10, version: 1, noteCount: 1, notationStatus: 'PENDING' };
}

describe('defaultChartId', () => {
  it('NORMAL을 고른다(응답 순서와 상관없이)', () => {
    expect(defaultChartId({ charts: [chartOf(3, 'HARD'), chartOf(1, 'EASY'), chartOf(2, 'NORMAL')] })).toBe(2);
  });

  it('NORMAL이 없으면 쉬운 순서로 첫 채보를 고른다', () => {
    expect(defaultChartId({ charts: [chartOf(3, 'HARD'), chartOf(1, 'EASY')] })).toBe(1);
  });

  it('채보가 없으면 null이다', () => {
    expect(defaultChartId({ charts: [] })).toBeNull();
  });
});

describe('chartFallback', () => {
  const detail = { charts: [chartOf(1, 'EASY'), chartOf(2, 'NORMAL')] };

  it('URL 채보가 목록에 있으면 바꾸지 않는다(null)', () => {
    expect(chartFallback(detail, 1)).toBeNull();
    expect(chartFallback(detail, 2)).toBeNull();
  });

  it('숨긴 채보(목록에 없는 id)면 기본 채보로 바꾼다', () => {
    expect(chartFallback(detail, 3)).toBe(2);
  });

  it('목록이 비어 있으면 바꾸지 않는다', () => {
    expect(chartFallback({ charts: [] }, 3)).toBeNull();
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


describe('채보 실패 사유 변환', () => {
  const base = { id: 1, title: '곡', source: 'AUDIO', status: 'FAILED' };

  it('목록과 상세에 코드만 담고 서버 메시지는 버린다', () => {
    const dto = { ...base, chartFailure: { code: 'MODEL_FAILED', message: 'internal details' } };
    expect(songFromDto(dto).chartFailure).toEqual({ code: 'MODEL_FAILED' });
    expect(songDetailFromDto({ ...dto, charts: [] }).chartFailure).toEqual({ code: 'MODEL_FAILED' });
  });

  it('사유가 없거나 객체 또는 문자열 코드가 아니면 null이다', () => {
    for (const value of [undefined, null, 'MODEL_FAILED', [], 12, {}, { code: null }, { code: 123 }]) {
      expect(songFromDto({ ...base, chartFailure: value }).chartFailure).toBeNull();
    }
  });
});

describe('artistLabel', () => {
  it('가수가 비어 있거나 공백뿐이면 「알 수 없음」', () => {
    expect(UNKNOWN_ARTIST).toBe('알 수 없음');
    expect(artistLabel('')).toBe('알 수 없음');
    expect(artistLabel('   ')).toBe('알 수 없음');
    expect(artistLabel(null)).toBe('알 수 없음');
    expect(artistLabel(undefined)).toBe('알 수 없음');
  });

  it('가수가 있으면 앞뒤 공백만 뗀다', () => {
    expect(artistLabel(' 파란물결 ')).toBe('파란물결');
  });
});
