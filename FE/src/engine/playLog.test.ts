import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPlayLogs } from './playLog';

afterEach(() => vi.unstubAllGlobals());

/** node 환경에는 localStorage가 없어 메모리 스텁을 끼운다 */
function stubStorage(value: unknown) {
  const data: Record<string, string> = value === null ? {} : { 'ssaplash.playlogs': JSON.stringify(value) };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  });
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
