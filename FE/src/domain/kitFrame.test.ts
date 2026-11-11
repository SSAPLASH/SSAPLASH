// 드럼 세팅 자유 틀 검증: 원근 자리 → 스킨 그림 자리·크기·눌림.
import { describe, expect, it } from 'vitest';
import { PAD_HEAD_CENTER } from './drumKit';
import { frameOf, framePad, kitFrame } from './kitFrame';
import { DEFAULT_KIT_LAYOUT } from './kitLayout';
import { kitShapes, makeCamera } from './kitPerspective';
import { ALL_PADS, STICK_PADS } from './pads';

const BOX = { w: 1000, h: 625 };
const figs = kitShapes(DEFAULT_KIT_LAYOUT, makeCamera(BOX));
const fig = (pad: string) => figs.find((f) => f.pad === pad)!;

describe('framePad', () => {
  it('실물 스킨: 헤드 중심이 원근 윗면 중심에 오고 누르지 않는다', () => {
    const f = fig('SNARE');
    const p = framePad(f, 'acoustic');
    const s = p.w / 160;
    expect(p.shape).toBe('drum');
    expect(p.left + PAD_HEAD_CENTER.drum.x * s).toBeCloseTo(f.cx, 6);
    expect(p.top + PAD_HEAD_CENTER.drum.y * s).toBeCloseTo(f.cy, 6);
    // 그림의 헤드 테두리(반지름 79)가 원근 가로 반지름과 같다
    expect(79 * s).toBeCloseTo(f.rx, 6);
    expect(p.tilt).toBeUndefined();
  });

  it('전자·네온: 원 중심 (80,80)이 윗면 중심에 오고 원근 타원 비율만큼 누른다', () => {
    for (const skin of ['electronic', 'neon'] as const) {
      const f = fig('CRASH');
      const p = framePad(f, skin);
      const s = p.w / 160;
      expect(p.left + 80 * s).toBeCloseTo(f.cx, 6);
      expect(p.top + 80 * s).toBeCloseTo(f.cy, 6);
      expect(p.tilt).toBeCloseTo(f.ry / f.rx, 6);
    }
  });

  it('킥은 세워져 있어 어느 스킨에서도 누르지 않는다', () => {
    expect(framePad(fig('KICK'), 'electronic').tilt).toBeUndefined();
    expect(framePad(fig('KICK'), 'acoustic').shape).toBe('kick');
  });

  it('하이햇 페달은 pedal 모양으로 그린다', () => {
    const p = framePad(fig('HIHAT_PEDAL'), 'acoustic');
    expect(p.shape).toBe('pedal');
    expect(p.label).toBe('페달');
  });

  it('먼 패드가 가까운 같은 종류 패드보다 작지 않게, 크기는 원근 반지름에 비례한다', () => {
    const a = framePad(fig('SMALL_TOM'), 'acoustic');
    const b = framePad(fig('SNARE'), 'acoustic');
    expect(a.w / b.w).toBeCloseTo(fig('SMALL_TOM').rx / fig('SNARE').rx, 6);
  });
});

describe('frameOf · kitFrame', () => {
  it('틀 크기는 그림 영역 크기, 패드 순서는 먼 것부터 그대로다', () => {
    const frame = frameOf(figs, BOX, 'acoustic');
    expect(frame.w).toBe(1000);
    expect(frame.h).toBe(625);
    expect(frame.pads.map((p) => p.pad)).toEqual(figs.map((f) => f.pad));
  });

  it('kitFrame은 9패드 전부를 주고, pads를 주면 그 패드만 준다', () => {
    expect(kitFrame(DEFAULT_KIT_LAYOUT, BOX, 'neon').pads.map((p) => p.pad).sort()).toEqual([...ALL_PADS].sort());
    expect(kitFrame(DEFAULT_KIT_LAYOUT, BOX, 'neon', undefined, STICK_PADS).pads.map((p) => p.pad).sort()).toEqual([...STICK_PADS].sort());
  });

  it('편집 화면(frameOf)과 보정 화면(kitFrame)이 같은 배치에서 같은 틀을 낸다', () => {
    expect(kitFrame(DEFAULT_KIT_LAYOUT, BOX, 'electronic')).toEqual(frameOf(figs, BOX, 'electronic'));
  });
});
