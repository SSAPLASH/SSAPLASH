// 구간 재생 상태 컨트롤러 (COACH-003 설계 D8). 훅은 컨트롤러를 구독만 하므로 컨트롤러를 가짜 플레이어로 검사한다.
import { describe, expect, it, vi } from 'vitest';
import type { SegmentPlan } from '@/features/result/domain/segmentPlayback';
import { SegmentPlaybackController, type SegmentPlayerPort } from './useSegmentPlayer';

const plan: SegmentPlan = { events: [], lengthMs: 1000, fromMs: 0, toMs: 1000 };

function setup() {
  const player: SegmentPlayerPort = { play: vi.fn(), stop: vi.fn(), onEnd: null };
  const c = new SegmentPlaybackController(player);
  return { player, c };
}

describe('SegmentPlaybackController', () => {
  it('play는 플레이어를 시작하고 playingKey를 정한다', () => {
    const { player, c } = setup();
    c.play('a', plan, 'http://acc');
    expect(player.play).toHaveBeenCalledWith(plan, { rate: 1, loop: false, accompanimentUrl: 'http://acc' });
    expect(c.getSnapshot().playingKey).toBe('a');
  });
  it('다른 카드를 누르면 키가 바뀐다(이전 재생은 플레이어가 멈춘다)', () => {
    const { c } = setup();
    c.play('a', plan, null);
    c.play('b', plan, null);
    expect(c.getSnapshot().playingKey).toBe('b');
  });
  it('onEnd에서 playingKey가 null', () => {
    const { player, c } = setup();
    c.play('a', plan, null);
    player.onEnd?.();
    expect(c.getSnapshot().playingKey).toBeNull();
  });
  it('stop은 플레이어를 멈추고 null', () => {
    const { player, c } = setup();
    c.play('a', plan, null);
    c.stop();
    expect(player.stop).toHaveBeenCalled();
    expect(c.getSnapshot().playingKey).toBeNull();
  });
  it('토글은 다음 재생부터 적용되고 재생 중인 것은 그대로 둔다', () => {
    const { player, c } = setup();
    c.play('a', plan, null);
    c.toggleRate();
    c.toggleLoop();
    expect(player.stop).not.toHaveBeenCalled();
    expect(c.getSnapshot()).toMatchObject({ playingKey: 'a', rate: 0.75, loop: true });
    c.play('a', plan, null);
    expect(player.play).toHaveBeenLastCalledWith(plan, { rate: 0.75, loop: true, accompanimentUrl: null });
    c.toggleRate();
    expect(c.getSnapshot().rate).toBe(1);
  });
  it('구독자에게 변경을 알리고 해제할 수 있다', () => {
    const { c } = setup();
    const fn = vi.fn();
    const off = c.subscribe(fn);
    c.toggleLoop();
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    c.toggleLoop();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
