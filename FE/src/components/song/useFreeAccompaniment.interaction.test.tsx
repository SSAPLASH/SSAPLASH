// @vitest-environment happy-dom
// 자유 연습 반주 훅 (설계 MODE-002 4-1~4-3, D9·D11). 재생기·API·시계를 가짜로 주입한다.
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/error';
import type { AccompanimentPick } from '@/domain/song/freeAccompaniment';
import { POLL_MS, useFreeAccompaniment, type AccompanimentPlayerPort } from './useFreeAccompaniment';

class FakePlayer implements AccompanimentPlayerPort {
  state: AccompanimentPlayerPort['state'] = 'idle';
  durationMs = 200_000;
  url: string | null = null;
  pos = 0;
  starts: number[] = [];
  unloads = 0;
  loadGate: ((v: void) => void) | null = null;
  loadFails = false;
  async load(url: string): Promise<void> {
    this.state = 'loading';
    if (this.loadGate === null && !this.manual) {
      this.finish(url);
      return;
    }
    await new Promise<void>((r) => (this.loadGate = r));
    this.finish(url);
  }
  manual = false;
  private finish(url: string) {
    if (this.loadFails) {
      this.state = 'error';
      throw new Error('decode');
    }
    this.url = url;
    this.state = 'ready';
  }
  start(_at: number, from = 0) {
    this.starts.push(from);
    this.pos = from;
    this.state = 'playing';
  }
  pause() {
    this.state = 'paused';
    return this.pos;
  }
  stop() {
    this.state = 'ready';
  }
  unload() {
    this.unloads += 1;
    this.url = null;
    this.state = 'idle';
  }
  positionAt() {
    return this.pos;
  }
}

const A: AccompanimentPick = { songId: 1, title: 'A', artist: '가수', coverUrl: null };
const B: AccompanimentPick = { songId: 2, title: 'B', artist: null, coverUrl: null };

let player: FakePlayer;
const fetchAcc = vi.fn();
const unlock = vi.fn(async () => {});

function setup() {
  return renderHook(() => useFreeAccompaniment({ createPlayer: () => player, fetchAccompaniment: fetchAcc, unlock, now: () => 1000, available: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
  player = new FakePlayer();
  fetchAcc.mockReset().mockImplementation(async (id: number) => ({ url: `https://s/${id}.mp3`, expiresAt: null }));
  unlock.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const playFirst = async (h: ReturnType<typeof setup>) => {
  act(() => h.result.current.pick(A));
  await flush();
};

describe('useFreeAccompaniment', () => {
  it('처음에는 none이고 builtin 빌드면 available이 false', () => {
    const h = setup();
    expect(h.result.current.view.phase).toBe('none');
    const off = renderHook(() => useFreeAccompaniment({ createPlayer: () => player, available: false }));
    expect(off.result.current.available).toBe(false);
  });

  it('고르면 loading → 불러온 뒤 처음부터 재생(playing)', async () => {
    const h = setup();
    act(() => h.result.current.pick(A));
    expect(h.result.current.view.phase).toBe('loading');
    expect(h.result.current.view.pick).toBe(A);
    await flush();
    expect(unlock).toHaveBeenCalled();
    expect(player.url).toBe('https://s/1.mp3');
    expect(player.starts).toEqual([0]);
    expect(h.result.current.view.phase).toBe('playing');
  });

  it('곡을 바꾸면 이전 반주를 해제하고, 늦게 온 이전 응답은 무시한다', async () => {
    let resolveA!: (v: { url: string; expiresAt: null }) => void;
    fetchAcc.mockImplementationOnce(() => new Promise((r) => (resolveA = r)));
    const h = setup();
    act(() => h.result.current.pick(A));
    const unloadsBefore = player.unloads;
    act(() => h.result.current.pick(B));
    expect(player.unloads).toBeGreaterThan(unloadsBefore);
    await flush();
    expect(player.url).toBe('https://s/2.mp3');
    expect(player.starts).toEqual([0]);
    // A 응답이 뒤늦게 와도 재생되지 않는다
    await act(async () => {
      resolveA({ url: 'https://s/1.mp3', expiresAt: null });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(player.url).toBe('https://s/2.mp3');
    expect(player.starts).toEqual([0]);
    expect(h.result.current.view.pick).toBe(B);
  });

  it('불러오는 중에 바꾸면 마지막에 고른 곡만 울린다', async () => {
    player.manual = true;
    const h = setup();
    act(() => h.result.current.pick(A));
    await flush();
    const gateA = player.loadGate;
    act(() => h.result.current.pick(B));
    await flush();
    await act(async () => {
      gateA?.();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(player.starts).toEqual([]);
    await act(async () => {
      player.loadGate?.();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(player.starts).toEqual([0]);
    expect(player.url).toBe('https://s/2.mp3');
  });

  it('URL이 null이면 error(반주 파일 없음)', async () => {
    fetchAcc.mockResolvedValueOnce({ url: null, expiresAt: null });
    const h = setup();
    await playFirst(h);
    expect(h.result.current.view).toMatchObject({ phase: 'error', errorText: '이 곡은 반주 파일이 없어요' });
  });

  it('API 오류·디코드 오류는 문구로 바뀌고, 다시 시도로 복구된다', async () => {
    fetchAcc.mockRejectedValueOnce(new ApiError(409, 'X', 'x'));
    const h = setup();
    await playFirst(h);
    expect(h.result.current.view).toMatchObject({ phase: 'error', errorText: '곡이 아직 준비 중이에요' });
    await act(async () => {
      h.result.current.retry();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.result.current.view.phase).toBe('playing');

    player.loadFails = true;
    act(() => h.result.current.pick(B));
    await flush();
    expect(h.result.current.view).toMatchObject({ phase: 'error', errorText: '반주를 불러오지 못했어요' });
  });

  it('일시정지 → 재생은 멈춘 위치부터', async () => {
    const h = setup();
    await playFirst(h);
    player.pos = 42_000;
    act(() => h.result.current.pause());
    expect(h.result.current.view).toMatchObject({ phase: 'paused', positionMs: 42_000 });
    act(() => h.result.current.resume());
    expect(player.starts.at(-1)).toBe(42_000);
    expect(h.result.current.view.phase).toBe('playing');
  });

  it('재생 중 탐색은 바로 그 위치부터 다시 튼다(끝은 250ms 앞으로 자른다)', async () => {
    const h = setup();
    await playFirst(h);
    act(() => h.result.current.seek(60_000));
    expect(player.starts.at(-1)).toBe(60_000);
    act(() => h.result.current.seek(999_999));
    expect(player.starts.at(-1)).toBe(199_750);
  });

  it('일시정지 중 탐색은 위치만 바꾸고 재생 때 그 위치에서 시작한다', async () => {
    const h = setup();
    await playFirst(h);
    act(() => h.result.current.pause());
    const n = player.starts.length;
    act(() => h.result.current.seek(90_000));
    expect(player.starts).toHaveLength(n);
    expect(h.result.current.view).toMatchObject({ phase: 'paused', positionMs: 90_000 });
    act(() => h.result.current.resume());
    expect(player.starts.at(-1)).toBe(90_000);
  });

  it('곡이 끝나면(ready) 일시정지·위치 0, 재생은 처음부터', async () => {
    const h = setup();
    await playFirst(h);
    act(() => h.result.current.seek(100_000));
    player.state = 'ready';
    act(() => {
      vi.advanceTimersByTime(POLL_MS);
    });
    expect(h.result.current.view).toMatchObject({ phase: 'paused', positionMs: 0 });
    act(() => h.result.current.resume());
    expect(player.starts.at(-1)).toBe(0);
  });

  it('재생 중에는 250ms마다 위치를 읽는다', async () => {
    const h = setup();
    await playFirst(h);
    player.pos = 5000;
    act(() => {
      vi.advanceTimersByTime(POLL_MS);
    });
    expect(h.result.current.view.positionMs).toBe(5000);
  });

  it('화면이 숨겨지면 일시정지하고 돌아와도 재개하지 않는다', async () => {
    const h = setup();
    await playFirst(h);
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(h.result.current.view.phase).toBe('paused');
    spy.mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(h.result.current.view.phase).toBe('paused');
    spy.mockRestore();
  });

  it('불러오는 사이 화면이 숨겨졌으면 재생을 시작하지 않고 처음 위치에서 일시정지로 둔다', async () => {
    const h = setup();
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await playFirst(h);
    expect(player.starts).toEqual([]);
    expect(h.result.current.view.phase).toBe('paused');
    expect(h.result.current.view.positionMs).toBe(0);
    spy.mockRestore();
    act(() => h.result.current.resume());
    expect(player.starts).toEqual([0]);
    expect(h.result.current.view.phase).toBe('playing');
  });

  it('끄면 해제하고 none, 이후 늦은 응답도 무시한다', async () => {
    let resolve!: (v: { url: string; expiresAt: null }) => void;
    fetchAcc.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const h = setup();
    act(() => h.result.current.pick(A));
    act(() => h.result.current.off());
    expect(h.result.current.view.phase).toBe('none');
    await act(async () => {
      resolve({ url: 'https://s/1.mp3', expiresAt: null });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(player.starts).toEqual([]);
    expect(h.result.current.view.phase).toBe('none');
  });

  it('언마운트하면 unload', async () => {
    const h = setup();
    await playFirst(h);
    const n = player.unloads;
    h.unmount();
    expect(player.unloads).toBeGreaterThan(n);
    expect(player.state).toBe('idle');
  });
});
