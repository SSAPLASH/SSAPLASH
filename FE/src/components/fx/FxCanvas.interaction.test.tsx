// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Profiler, createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { LazyMotion, MotionGlobalConfig, domMax } from 'motion/react';
import type { ResolvedHit } from '@/domain/events';
import type { PadId } from '@/domain/kit/pads';
import { useLive } from '@/store/liveStore';
import { DrumKit } from '@/components/drum/DrumKit';
import { kitBoxFor } from '@/domain/kit/drumKit';
import { FxCanvas } from './FxCanvas';
import type { FxEngine } from './fxEngine';
import { createFxEmitter } from './fxSource';

afterEach(cleanup);
beforeEach(() => {
  MotionGlobalConfig.skipAnimations = true;
  useLive.setState({ lastHit: null, hitSeq: 0 });
});

function fire(pad: PadId | null, velocity = 100) {
  act(() => {
    useLive.setState((s) => ({ lastHit: { id: s.hitSeq + 1, pad, velocity } as ResolvedHit, hitSeq: s.hitSeq + 1 }));
  });
}

const wrap = (ui: React.ReactNode) => <LazyMotion features={domMax} strict>{ui}</LazyMotion>;

describe('FxCanvas', () => {
  it('liveStore 타격을 직접 받아 엔진에 넣는다(하이햇 페달 → 하이햇, 패드 없는 타격 무시)', () => {
    const engineRef = createRef<FxEngine>() as { current: FxEngine | null };
    render(wrap(<FxCanvas skin="acoustic" theme="auto" engineRef={engineRef} />));
    expect(engineRef.current?.stats().alive).toBe(0);
    fire('SNARE');
    expect(engineRef.current?.stats().alive).toBe(1);
    fire('CRASH');
    expect(engineRef.current?.stats().alive).toBe(1 + 9);
    fire('HIHAT_PEDAL');
    expect(engineRef.current?.stats().alive).toBe(1 + 9 + 9); // 하이햇(심벌) = 링 + 스파크 8
    fire(null);
    expect(engineRef.current?.stats().alive).toBe(19);
  });

  it('source를 넘기면 liveStore 타격이 섞이지 않는다', () => {
    const emitter = createFxEmitter();
    const engineRef = createRef<FxEngine>() as { current: FxEngine | null };
    render(wrap(<FxCanvas skin="acoustic" theme="auto" source={emitter.source} engineRef={engineRef} />));
    fire('SNARE');
    expect(engineRef.current?.stats().alive).toBe(0);
    emitter.emit({ seq: 1, pad: 'SNARE', velocity: 90, mode: 'preview', judgement: null, deltaMs: null, combo: null });
    expect(engineRef.current?.stats().alive).toBe(1);
  });

  it('theme 속성이 바뀌면 다음 타격부터 그 테마로 만든다', () => {
    const engineRef = createRef<FxEngine>() as { current: FxEngine | null };
    const { rerender } = render(wrap(<FxCanvas skin="acoustic" theme="auto" engineRef={engineRef} />));
    rerender(wrap(<FxCanvas skin="acoustic" theme="electric" engineRef={engineRef} />));
    fire('SNARE');
    expect(engineRef.current!.stats().alive).toBeGreaterThan(3);
  });

  it('언마운트하면 구독을 해제한다', () => {
    const emitter = createFxEmitter();
    const { unmount } = render(wrap(<FxCanvas skin="acoustic" theme="auto" source={emitter.source} />));
    unmount();
    expect(() => emitter.emit({ seq: 1, pad: 'SNARE', velocity: 90, mode: 'lab', judgement: null, deltaMs: null, combo: null })).not.toThrow();
  });

  it('캔버스는 포인터 이벤트를 받지 않는다(CSS 규칙)', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/drum/drum.css'), 'utf8');
    expect(css).toMatch(/\.fx-canvas\s*\{[^}]*pointer-events:\s*none/);
  });
});

describe('FxCanvas 위쪽 여백', () => {
  const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  beforeEach(() => {
    // happy-dom은 레이아웃이 없어 폭이 0이다 — 킷 폭 760(배율 1)으로 둔다
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 760 });
  });
  afterEach(() => {
    if (desc) Object.defineProperty(HTMLElement.prototype, 'clientWidth', desc);
    else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  });

  const canvasOf = (ui: React.ReactNode) => render(wrap(<div>{ui}</div>)).container.querySelector('canvas') as HTMLCanvasElement;

  it('위쪽만 테마의 bleedTop(물 0.4), 좌우·아래는 기존 bleed 0.12', () => {
    const h = kitBoxFor('acoustic', 'persp').h;
    const c = canvasOf(<FxCanvas skin="acoustic" theme="water" />);
    const top = Math.round(h * 0.4);
    const bottom = Math.round(h * 0.12);
    const side = Math.round(760 * 0.12);
    expect(c.style.top).toBe(`${-top}px`);
    expect(c.style.left).toBe(`${-side}px`);
    expect(c.style.width).toBe(`${760 + side * 2}px`);
    expect(c.style.height).toBe(`${h + top + bottom}px`);
  });

  it('bleedTop prop이 테마 값보다 우선하고, 그림이 없는 테마는 0.12', () => {
    const h = kitBoxFor('acoustic', 'persp').h;
    expect(canvasOf(<FxCanvas skin="acoustic" theme="water" bleedTop={0.2} />).style.top).toBe(`${-Math.round(h * 0.2)}px`);
    cleanup();
    expect(canvasOf(<FxCanvas skin="acoustic" theme="auto" />).style.top).toBe(`${-Math.round(h * 0.12)}px`);
  });
});

describe('DrumKit + FxCanvas', () => {
  it('effects 킷에 캔버스가 생기고 SVG 위 래퍼 안에 있다', () => {
    const { container } = render(wrap(<DrumKit effects />));
    const canvas = container.querySelector('canvas.fx-canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.parentElement?.className).toBe('drum-kit-fx');
    expect(canvas?.previousElementSibling?.tagName.toLowerCase()).toBe('svg');
    // 예전 SVG 이펙트 레이어는 없다
    expect(container.querySelector('g.hit-effects')).toBeNull();
  });

  it('effects가 꺼진 킷은 캔버스·래퍼가 없다', () => {
    const { container } = render(wrap(<DrumKit />));
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('.drum-kit-fx')).toBeNull();
  });

  it('타격(세기 60)으로 DrumKit이 다시 렌더되지 않는다', () => {
    let commits = 0;
    render(
      wrap(
        <Profiler id="kit" onRender={() => commits++}>
          <DrumKit effects />
        </Profiler>,
      ),
    );
    const before = commits;
    for (const pad of ['SNARE', 'CRASH', 'KICK'] as const) fire(pad, 60);
    expect(commits).toBe(before);
  });

  it('fxSource가 있는 킷은 실제 타격에 패드 흔들림도 반응하지 않는다', () => {
    const emitter = createFxEmitter();
    const { container } = render(wrap(<DrumKit effects fxSource={emitter.source} />));
    fire('SNARE', 120);
    expect(container.querySelector('g.pad-shake[data-shake]')).toBeNull();
  });
});
