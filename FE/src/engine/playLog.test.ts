import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPlayLog, clearPlayLogs, getPlayLog, loadPlayLogs, savePlayLog, setPlayLogOwner, updatePlayLog, type PlayLog } from './playLog';

afterEach(() => {
  vi.unstubAllGlobals();
  setPlayLogOwner(null);
});

/** node 환경에는 localStorage가 없어 메모리 스텁을 끼운다 */
function stubStorage(value: unknown) {
  const data: Record<string, string> = value === null ? {} : { 'ssaplash.playlogs': JSON.stringify(value) };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
    removeItem: (k: string) => {
      delete data[k];
    },
  });
  return data;
}

describe('loadPlayLogs 패드 이름 변환', () => {
  it('HI_TOM 노트·타격을 SMALL_TOM으로 읽고 알 수 없는 노트는 버린다', () => {
    stubStorage([
      {
        playId: 'p1',
        notes: [
          { index: 0, timeMs: 0, pad: 'HI_TOM', judgement: null, deltaMs: null },
          { index: 1, timeMs: 100, pad: 'SNARE', judgement: null, deltaMs: null },
          { index: 2, timeMs: 200, pad: 'UNKNOWN', judgement: null, deltaMs: null },
        ],
        hits: [
          { hitId: 1, pad: 'HI_TOM' },
          { hitId: 2, pad: null },
          { hitId: 3, pad: 'UNKNOWN' },
        ],
      },
    ]);
    const [log] = loadPlayLogs();
    expect(log.notes.map((n) => n.pad)).toEqual(['SMALL_TOM', 'SNARE']);
    expect(log.hits.map((h) => h.pad)).toEqual(['SMALL_TOM', null, null]);
  });

  it('저장분이 없으면 빈 목록', () => {
    stubStorage(null);
    expect(loadPlayLogs()).toEqual([]);
  });
});

/** 저장·조회 확인용 최소 로그. 패드 이름 변환을 거치도록 notes·hits는 빈 배열 */
const logOf = (playId: string) => ({ playId, notes: [], hits: [] }) as unknown as PlayLog;

describe('계정별 저장', () => {
  it('주인이 없으면 기존 키, 있으면 계정 키에 저장한다', () => {
    const data = stubStorage(null);
    savePlayLog(logOf('guest'));
    setPlayLogOwner(7);
    savePlayLog(logOf('a'));
    expect(Object.keys(data).sort()).toEqual(['ssaplash.playlogs', 'ssaplash.playlogs.u7']);
    expect(loadPlayLogs().map((l) => l.playId)).toEqual(['a']);
  });

  it('다른 계정의 로그는 목록·단건 조회·수정에서 보이지 않는다', () => {
    stubStorage(null);
    setPlayLogOwner(7);
    savePlayLog(logOf('a'));
    setPlayLogOwner(8);
    expect(loadPlayLogs()).toEqual([]);
    expect(getPlayLog('a')).toBeNull();
    expect(updatePlayLog('a', (l) => l)).toBeNull();
    setPlayLogOwner(7);
    expect(getPlayLog('a')?.playId).toBe('a');
  });

  it('clearPlayLogs는 그 계정 키만 지운다', () => {
    const data = stubStorage(null);
    setPlayLogOwner(7);
    savePlayLog(logOf('a'));
    setPlayLogOwner(8);
    savePlayLog(logOf('b'));
    clearPlayLogs(7);
    expect(Object.keys(data)).toEqual(['ssaplash.playlogs.u8']);
  });
});

describe('buildPlayLog 실시간 코칭 기록', () => {
  const base = {
    snapshot: { score: 0, maxScore: 0, maxCombo: 0, counts: { PERFECT: 0, GOOD: 0, MISS: 0 }, strayHits: 0, songTimeMs: 0 },
    notes: [],
    hits: [],
    chart: { songId: 's', title: 't', difficulty: 'EASY', durationMs: 1000, bpm: 120, beatsPerBar: 4 },
    inputSource: 'keyboard',
    timing: { perfectMs: 25, goodMs: 60 },
    startedAt: new Date(0),
    chartVersionId: null,
    songNumericId: null,
    chartId: null,
    presetId: null,
  } as unknown as Parameters<typeof buildPlayLog>[0];

  it('넘긴 liveCoachEvents를 그대로 싣고, 안 넘기면 필드가 없다', () => {
    const events = [{ tMs: 1000, tag: 'LIVE_LATE', text: '늦어요' }];
    expect(buildPlayLog({ ...base, liveCoachEvents: events }).liveCoachEvents).toEqual(events);
    expect('liveCoachEvents' in buildPlayLog(base)).toBe(false);
  });
});
