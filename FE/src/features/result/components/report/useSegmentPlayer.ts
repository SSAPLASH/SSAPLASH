// 약점 구간 재생 상태 (COACH-003 설계 3-3·D8). 페이지 하나에 플레이어 하나 — 한 번에 한 구간만 재생한다.
// React 밖에서도 테스트할 수 있게 상태 로직은 SegmentPlaybackController에 두고, 훅은 이를 구독만 한다.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Accompaniment } from '@/audio/Accompaniment';
import type { AudioEngine } from '@/audio/AudioEngine';
import { SegmentPlayer, type SegmentPlayerOptions } from '@/features/result/audio/SegmentPlayer';
import type { SegmentPlan } from '@/features/result/domain/segmentPlayback';

/** SegmentPlayer 중 컨트롤러가 쓰는 부분(테스트에서 가짜로 바꾼다) */
export interface SegmentPlayerPort {
  play(plan: SegmentPlan, opts: SegmentPlayerOptions): Promise<void> | void;
  stop(): void;
  onEnd: (() => void) | null;
}

export interface SegmentPlayerSnapshot {
  /** 재생 중인 카드 키. 없으면 null */
  playingKey: string | null;
  rate: 1 | 0.75;
  loop: boolean;
}

export class SegmentPlaybackController {
  private snap: SegmentPlayerSnapshot = { playingKey: null, rate: 1, loop: false };
  private listeners = new Set<() => void>();

  private readonly player: SegmentPlayerPort;

  constructor(player: SegmentPlayerPort) {
    this.player = player;
    this.player.onEnd = () => this.update({ playingKey: null });
  }

  getSnapshot = (): SegmentPlayerSnapshot => this.snap;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  /** 이전 재생은 플레이어가 멈추고 새로 시작한다. 배속·반복은 이 호출 시점 값을 쓴다 */
  play = (key: string, plan: SegmentPlan, accompanimentUrl: string | null): void => {
    void this.player.play(plan, { rate: this.snap.rate, loop: this.snap.loop, accompanimentUrl });
    this.update({ playingKey: key });
  };

  stop = (): void => {
    this.player.stop();
    this.update({ playingKey: null });
  };

  /** 재생 중이면 현재 재생은 그대로 두고 다음 재생부터 적용한다 */
  toggleRate = (): void => this.update({ rate: this.snap.rate === 1 ? 0.75 : 1 });

  toggleLoop = (): void => this.update({ loop: !this.snap.loop });

  private update(patch: Partial<SegmentPlayerSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((fn) => fn());
  }
}

export interface SegmentPlayerDeps {
  createPlayer?: (engine: AudioEngine) => SegmentPlayerPort;
}

export interface UseSegmentPlayer extends SegmentPlayerSnapshot {
  play: (key: string, plan: SegmentPlan, accompanimentUrl: string | null) => void;
  stop: () => void;
  toggleRate: () => void;
  toggleLoop: () => void;
}

export function useSegmentPlayer(engine: AudioEngine, deps: SegmentPlayerDeps = {}): UseSegmentPlayer {
  const ref = useRef<SegmentPlaybackController | null>(null);
  if (ref.current === null) {
    const create = deps.createPlayer ?? ((e: AudioEngine) => new SegmentPlayer(e, new Accompaniment(e)));
    ref.current = new SegmentPlaybackController(create(engine));
  }
  const c = ref.current;
  const snap = useSyncExternalStore(c.subscribe, c.getSnapshot, c.getSnapshot);
  // 페이지를 떠나면 멈춘다(D8)
  useEffect(() => () => c.stop(), [c]);
  return { ...snap, play: c.play, stop: c.stop, toggleRate: c.toggleRate, toggleLoop: c.toggleLoop };
}
