// 박 분할 예시 소리 검증. 가짜 시계·타이머·sink만 쓴다.
import { describe, expect, it } from 'vitest';
import { MetronomePreview, type PreviewSnapshot } from './metronomePreview';
import { LOOKAHEAD_MS, START_LEAD_MS, TICK_MS } from '@/engine/Metronome';
import type { ClickLevel } from '@/domain/time/metronome';

function setup(opts: { busy?: () => boolean } = {}) {
  let now = 1000;
  let intervalFn: (() => void) | null = null;
  const timeouts: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const clicks: { atMs: number; level: ClickLevel }[] = [];
  const p = new MetronomePreview();
  p.bind({
    click: (atMs, level) => {
      clicks.push({ atMs, level });
      return atMs;
    },
    ensureAudio: () => Promise.resolve(),
    busy: opts.busy ?? (() => false),
    now: () => now,
    setInterval: (fn) => {
      intervalFn = fn;
      return 1;
    },
    clearInterval: () => {
      intervalFn = null;
    },
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timeouts.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimeout: (id) => {
      const i = timeouts.findIndex((t) => t.id === id);
      if (i >= 0) timeouts.splice(i, 1);
    },
  });
  const seen: PreviewSnapshot[] = [];
  p.subscribe(() => seen.push(p.getSnapshot()));
  return {
    p,
    clicks,
    seen,
    /** 시각을 ms만큼 25ms 틱 단위로 흘리며 타이머를 돌린다 */
    advance(ms: number) {
      for (let t = 0; t < ms; t += TICK_MS) {
        now += TICK_MS;
        for (const due of timeouts.filter((x) => x.at <= now)) {
          timeouts.splice(timeouts.indexOf(due), 1);
          due.fn();
        }
        intervalFn?.();
      }
    },
    ticking: () => intervalFn !== null,
  };
}

const FIRST = 1000 + START_LEAD_MS;

describe('MetronomePreview', () => {
  it('4분: 두 박을 강세·정박으로 내고 끝나면 꺼진다', async () => {
    const t = setup();
    await t.p.play('song', 120, 1);
    expect(t.p.getSnapshot()).toEqual({ place: 'song', beat: -1 });
    t.advance(1200);
    expect(t.clicks).toEqual([
      { atMs: FIRST, level: 'accent' },
      { atMs: FIRST + 500, level: 'beat' },
    ]);
    expect(t.seen.map((s) => s.beat)).toEqual([-1, 0, 1, -1]);
    expect(t.p.getSnapshot()).toEqual({ place: null, beat: -1 });
    expect(t.ticking()).toBe(false);
  });

  it('8분: 네 번 울리고 사이 박은 정박 가운데, 점은 정박에만 켜진다', async () => {
    const t = setup();
    await t.p.play('dock', 120, 2);
    t.advance(1200);
    expect(t.clicks.map((c) => c.atMs - FIRST)).toEqual([0, 250, 500, 750]);
    expect(t.clicks.map((c) => c.level)).toEqual(['accent', 'sub', 'beat', 'sub']);
    expect(t.seen.map((s) => s.beat)).toEqual([-1, 0, 1, -1]);
  });

  it('클릭은 예약 창 안에서만 미리 예약한다', async () => {
    const t = setup();
    await t.p.play('song', 60, 1); // 박 1000ms
    expect(t.clicks).toHaveLength(1); // 둘째 박은 창(100ms) 밖
    t.advance(1000 + START_LEAD_MS - LOOKAHEAD_MS - TICK_MS);
    expect(t.clicks).toHaveLength(1);
    t.advance(TICK_MS * 2);
    expect(t.clicks).toHaveLength(2);
  });

  it('다시 고르면 앞의 예시를 끊고 새로 낸다', async () => {
    const t = setup();
    await t.p.play('song', 60, 1);
    t.advance(300);
    await t.p.play('song', 120, 2);
    t.advance(1500);
    // 앞 예시의 둘째 박(FIRST + 1000)은 나지 않는다
    expect(t.clicks.some((c) => c.atMs === FIRST + 1000)).toBe(false);
    expect(t.clicks.slice(1).map((c) => c.level)).toEqual(['accent', 'sub', 'beat', 'sub']);
  });

  it('stop은 남은 틱을 내지 않고 점을 끈다', async () => {
    const t = setup();
    await t.p.play('song', 60, 1);
    t.p.stop();
    t.advance(2000);
    expect(t.clicks).toHaveLength(1);
    expect(t.p.getSnapshot()).toEqual({ place: null, beat: -1 });
  });

  it('메트로놈이 울리는 중(busy)이면 내지 않는다', async () => {
    const t = setup({ busy: () => true });
    await t.p.play('dock', 120, 2);
    t.advance(1000);
    expect(t.clicks).toHaveLength(0);
    expect(t.seen).toHaveLength(0);
  });

  it('bind 전이나 BPM이 이상하면 아무 일도 없다', async () => {
    await new MetronomePreview().play('song', 120, 1);
    const t = setup();
    await t.p.play('song', NaN, 1);
    expect(t.clicks).toHaveLength(0);
  });
});
