// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { buildGuideScript, GAME_GUIDE_OPTIONS, holdStartOf, stateAt, type GuideState } from '@/features/play/domain/guideScript';
import type { PadId } from '@/domain/kit/pads';
import { GameGuideScene } from './GameGuideScene';

afterEach(cleanup);

const script = buildGuideScript(undefined, undefined, GAME_GUIDE_OPTIONS);
/** 칸 i가 판정선에 닿아 멈춘 장면 */
const holdState = (i: number): GuideState => stateAt(script, holdStartOf(script, i) + 1);
const scene = (state: GuideState, hoverPad?: PadId | null) => render(<GameGuideScene state={state} hoverPad={hoverPad} />).container;
const note = (c: HTMLElement, pad: string, col?: number) => c.querySelectorAll(`[data-note="${pad}"]`)[col ?? 0] as SVGRectElement;
const kitState = (c: HTMLElement, pad: string) => c.querySelector(`.drum-pad[data-pad="${pad}"]`)?.getAttribute('data-state');

describe('GameGuideScene', () => {
  it('9레인 머리는 레인 순서대로 약어(HP·HH·CR·SN·ST·KK·MT·FT·RD)다', () => {
    const c = scene(holdState(0));
    expect([...c.querySelectorAll('.guide-lane-tag')].map((t) => t.textContent)).toEqual(['HP', 'HH', 'CR', 'SN', 'ST', 'KK', 'MT', 'FT', 'RD']);
  });

  it('페달 칸은 떼어 두 구간의 띠와 두 구간의 판정선을 그린다', () => {
    const c = scene(holdState(0));
    expect(c.querySelectorAll('.guide-strip-bg')).toHaveLength(2);
    expect(c.querySelectorAll('.guide-judge')).toHaveLength(2);
    const [pedal, main] = [...c.querySelectorAll('.guide-strip-bg')].map((r) => Number(r.getAttribute('x')));
    const w = Number(c.querySelector('.guide-strip-bg')!.getAttribute('width'));
    expect(main - (pedal + w)).toBe(16);
  });

  it('킷은 네온 8패드이고 글자는 PAD_META(스몰탐·미드탐)다', () => {
    const c = scene(holdState(0));
    expect(c.querySelectorAll('.drum-pad[data-skin="neon"]')).toHaveLength(8);
    const labels = [...c.querySelectorAll('.drum-pad-label')].map((t) => t.textContent);
    expect(labels).toContain('스몰탐');
    expect(labels).toContain('미드탐');
    expect(labels).not.toContain('탐1');
    const tags = [...c.querySelectorAll('.drum-pad-tag')].map((t) => t.textContent);
    expect(tags).toContain('ST');
    expect(tags).toContain('MT');
  });

  it('첫 칸(크래시+킥): 두 레인이 빛나고 두 패드가 hit, 점선 둘, 노트는 판정선에 붙는다', () => {
    const c = scene(holdState(0));
    expect(c.querySelectorAll('.guide-lane-flash.on')).toHaveLength(2);
    expect(c.querySelector('[data-lane="CRASH"] .guide-lane-flash.on')).not.toBeNull();
    expect(c.querySelector('[data-lane="KICK"] .guide-lane-flash.on')).not.toBeNull();
    expect(kitState(c, 'CRASH')).toBe('hit');
    expect(kitState(c, 'KICK')).toBe('hit');
    expect(kitState(c, 'SNARE')).toBe('idle');
    expect(c.querySelectorAll('.guide-link')).toHaveLength(2);
    const on = c.querySelectorAll('.guide-gnote.on');
    expect(on).toHaveLength(2);
    // 판정선(160)에 붙는다: y = 160 − 6
    expect(Number(note(c, 'CRASH').getAttribute('y'))).toBe(154);
  });

  it('노트·점선 색은 네온 3색이다(심벌 골드·킥 마젠타)', () => {
    const c = scene(holdState(0));
    expect(note(c, 'CRASH').style.getPropertyValue('--c')).toBe('#ffc24a');
    expect(note(c, 'KICK').style.getPropertyValue('--c')).toBe('#ff3ec8');
    const strokes = [...c.querySelectorAll('.guide-link')].map((p) => p.getAttribute('stroke'));
    expect(strokes.sort()).toEqual(['#ff3ec8', '#ffc24a']);
    expect(note(c, 'SNARE').style.getPropertyValue('--c')).toBe('#22e4ff');
  });

  it('아직 닿지 않은 노트는 판정선 위에서 떨어지는 중이다(칸이 클수록 더 위)', () => {
    const c = scene(holdState(0));
    const y1 = Number(note(c, 'HIHAT', 0).getAttribute('y')); // 칸 1
    const y3 = Number(note(c, 'HIHAT', 2).getAttribute('y')); // 칸 3
    expect(y1).toBeLessThan(154);
    expect(y3).toBeLessThan(y1);
  });

  it('친 칸의 노트는 사라지고 닿는 칸은 판정선에 붙는다', () => {
    const c = scene(holdState(3));
    // 칸 0(크래시)·칸 1·2는 이미 침
    expect(note(c, 'CRASH').style.opacity).toBe('0');
    expect(note(c, 'HIHAT', 0).style.opacity).toBe('0');
    expect(note(c, 'HIHAT', 3).style.opacity).toBe('1');
    expect(c.querySelectorAll('.guide-gnote.on')).toHaveLength(1);
  });

  it('hover 패드는 레인 예고(hov)와 킷 armed로 강조한다. 쳐야 할 레인은 hov가 아니다', () => {
    const c = scene(holdState(0), 'SNARE');
    expect(c.querySelector('[data-lane="SNARE"] .guide-lane-flash.hov')).not.toBeNull();
    expect(c.querySelector('[data-lane="SNARE"] .guide-lane-tag.on')).not.toBeNull();
    expect(kitState(c, 'SNARE')).toBe('armed');
    const c2 = scene(holdState(0), 'KICK');
    expect(c2.querySelector('[data-lane="KICK"] .guide-lane-flash.hov')).toBeNull();
    expect(kitState(c2, 'KICK')).toBe('hit');
  });

  it('hover 하이햇 페달은 킷 하이햇 패드를 armed로 한다', () => {
    const c = scene(holdState(0), 'HIHAT_PEDAL');
    expect(kitState(c, 'HIHAT')).toBe('armed');
    expect(c.querySelector('[data-lane="HIHAT_PEDAL"] .guide-lane-flash.hov')).not.toBeNull();
  });

  it('치는 칸이 없으면 레인·패드·점선이 모두 꺼져 있다', () => {
    const c = scene(stateAt(script, 0));
    expect(c.querySelectorAll('.guide-lane-flash.on')).toHaveLength(0);
    expect(c.querySelectorAll('.guide-link')).toHaveLength(0);
    expect(c.querySelectorAll('.drum-pad[data-state="hit"]')).toHaveLength(0);
  });
});
