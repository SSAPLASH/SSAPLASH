import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPlayLog, clearPlayLogs, getPlayLog, loadPlayLogs, savePlayLog, setPlayLogOwner, updatePlayLog } from './playLog';
import type { PlayLog } from '@/domain/play/playLog';

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

  it('열린 HIHAT와 측정 완전성을 로컬 로그에 보존한다', () => {
    const notes = [
      { index: 0, note: { pad: 'HIHAT', timeMs: 0, hihatOpen: true }, judgement: null, deltaMs: null },
      { index: 1, note: { pad: 'SNARE', timeMs: 1, hihatOpen: true }, judgement: null, deltaMs: null },
    ] as Parameters<typeof buildPlayLog>[0]['notes'];
    const log = buildPlayLog({ ...base, notes, hihatPedalCoverage: 'COMPLETE' });
    expect(log.hihatPedalCoverage).toBe('COMPLETE');
    expect(log.notes.map((n) => n.hihatOpen)).toEqual([true, undefined]);
    expect(buildPlayLog(base).hihatPedalCoverage).toBeUndefined();
  });

  it('넘긴 kickOffsetMs를 싣고, 안 넘기면 필드가 없다', () => {
    const log = buildPlayLog({ ...base, audioOffsetMs: -65, kickOffsetMs: -40 });
    expect(log).toMatchObject({ audioOffsetMs: -65, kickOffsetMs: -40 });
    const old = buildPlayLog({ ...base, audioOffsetMs: -65 });
    expect(old.audioOffsetMs).toBe(-65);
    expect('kickOffsetMs' in old).toBe(false);
  });

  it('넘긴 liveCoachEvents를 그대로 싣고, 안 넘기면 필드가 없다', () => {
    const events = [{ tMs: 1000, tag: 'LIVE_LATE', text: '늦어요' }];
    expect(buildPlayLog({ ...base, liveCoachEvents: events }).liveCoachEvents).toEqual(events);
    expect('liveCoachEvents' in buildPlayLog(base)).toBe(false);
  });

  it('연습 속도(늘린 채보): 위치 값은 곡 시각으로 되돌리고 오차·경과 시간은 실제 값 그대로 남긴다', () => {
    const notes = [
      // 원래 1000ms·7000ms 노트를 0.5배속으로 늘린 채보(2000ms·14000ms)
      { index: 0, note: { pad: 'SNARE', timeMs: 2000, sourceTimeMs: 1000, noteId: 'a' }, judgement: 'GOOD', deltaMs: 30 },
      { index: 1, note: { pad: 'KICK', timeMs: 14000, sourceTimeMs: 7000, noteId: 'b' }, judgement: 'MISS', deltaMs: null },
    ] as Parameters<typeof buildPlayLog>[0]['notes'];
    const log = buildPlayLog({
      ...base,
      notes,
      hits: [{ hitId: 1, stickId: 1, pad: 'SNARE', velocity: 90, tHit: 0, tRecv: 0, tResolved: 0, tSongMs: 2030, deltaMs: 30 }] as Parameters<typeof buildPlayLog>[0]['hits'],
      snapshot: { ...base.snapshot, songTimeMs: 16000 },
      countInMs: 9000,
      chart: { ...base.chart, durationMs: 16000, bpm: 60, offsetMs: 1000, playbackRate: 0.5, sourceTiming: { durationMs: 8000, bpm: 120, offsetMs: 500 } },
      liveCoachEvents: [{ tMs: 4000, tag: 'LATE', text: '스틱을 낮게' }],
    });
    expect(log.playbackRate).toBe(0.5);
    expect(log).toMatchObject({ durationMs: 8000, bpm: 120, offsetMs: 500 });
    expect(log.notes.map((n) => n.timeMs)).toEqual([1000, 7000]);
    expect(log.notes[0].deltaMs).toBe(30);
    expect(log.hits[0]).toMatchObject({ tSongMs: 1015, deltaMs: 30 });
    expect(log.liveCoachEvents).toEqual([{ tMs: 2000, tag: 'LATE', text: '스틱을 낮게' }]);
    expect(log.lastSongTimeMs).toBe(8000);
    // 경과 시간은 실제 시간(늘린 축의 곡 시각 + 리드인)
    expect(log.elapsedActiveMs).toBe(25000);
  });

  it('원래 빠르기면 배율 필드가 없고 값이 그대로다', () => {
    const log = buildPlayLog({ ...base, liveCoachEvents: [{ tMs: 4000, tag: 'x', text: 'y' }] });
    expect('playbackRate' in log).toBe(false);
    expect(log).toMatchObject({ durationMs: 1000, bpm: 120, offsetMs: 0 });
    expect(log.liveCoachEvents?.[0].tMs).toBe(4000);
  });
});
