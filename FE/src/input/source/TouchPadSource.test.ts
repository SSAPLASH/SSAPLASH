// TouchPadSource: 이벤트 모양과 InputManager 연결(센서 시각 오프셋 없음).
import { describe, expect, it } from 'vitest';
import { InputManager } from '@/input/InputManager';
import { TouchPadSource } from './TouchPadSource';
import type { ResolvedHit, StickEvent, StickHitEvent } from '@/domain/events';

function collect(src: TouchPadSource): StickHitEvent[] {
  const out: StickHitEvent[] = [];
  src.subscribe((e: StickEvent) => {
    if (e.kind === 'hit') out.push(e);
  });
  return out;
}

describe('TouchPadSource', () => {
  it('kind·label', () => {
    const s = new TouchPadSource();
    expect(s.kind).toBe('touch');
    expect(s.label).toBe('화면 터치');
  });

  it('strike: pad를 실은 hit 하나, 세기 100·모사 가속도', () => {
    const s = new TouchPadSource();
    const hits = collect(s);
    s.strike('SNARE');
    expect(hits).toHaveLength(1);
    const e = hits[0];
    expect(e).toMatchObject({ kind: 'hit', pad: 'SNARE', velocity: 100, peakAccel: 6.3, pitch: 0, yaw: 0 });
    expect(e.timestamp).toBe(e.recvTime);
  });

  it('stickId는 0·1을 번갈아 쓴다', () => {
    const s = new TouchPadSource();
    const hits = collect(s);
    for (let i = 0; i < 4; i++) s.strike('KICK');
    expect(hits.map((h) => h.stickId)).toEqual([0, 1, 0, 1]);
  });
});

describe('InputManager + TouchPadSource', () => {
  it("pad·source='touch' 그대로, tHit에 센서 오프셋을 더하지 않는다", async () => {
    const im = new InputManager();
    im.setSensorOffsetMs(50);
    const s = new TouchPadSource();
    await im.attach(s);
    const hits: ResolvedHit[] = [];
    im.onHit((h) => hits.push(h));
    const raw = collect(s);
    s.strike('HIHAT');
    expect(hits).toHaveLength(1);
    expect(hits[0].pad).toBe('HIHAT');
    expect(hits[0].source).toBe('touch');
    expect(hits[0].velocity).toBe(100);
    expect(hits[0].tHit).toBe(raw[0].timestamp);
    expect(hits[0].firmwarePad).toBeUndefined();
    expect(hits[0].clockOffsetMs).toBeUndefined();
  });
});
