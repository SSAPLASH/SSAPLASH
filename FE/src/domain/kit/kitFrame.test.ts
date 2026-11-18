// 드럼 세팅 자유 틀 검증: 원근 자리 → 스킨 그림 자리·크기·눌림.
import { describe, expect, it } from 'vitest';
import { KIT_ART_PERSP, kitArtPad } from './kitArt';
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
    const head = kitArtPad(KIT_ART_PERSP, 'SNARE')!.head;
    expect(p.shape).toBe('drum');
    expect(p.art?.head).toBe(head);
    expect(p.left + head.cx * s).toBeCloseTo(f.cx, 6);
    expect(p.top + head.cy * s).toBeCloseTo(f.cy, 6);
    // 그림의 헤드 가로 반지름이 원근 가로 반지름과 같다
    expect(head.rx * s).toBeCloseTo(f.rx, 6);
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
    // 조각 상자 폭은 패드마다 달라, 화면에서의 헤드 반지름으로 견준다
    const headRx = (pad: 'SMALL_TOM' | 'SNARE') => (framePad(fig(pad), 'acoustic').w * kitArtPad(KIT_ART_PERSP, pad)!.head.rx) / 160;
    expect(headRx('SMALL_TOM') / headRx('SNARE')).toBeCloseTo(fig('SMALL_TOM').rx / fig('SNARE').rx, 6);
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

describe('하이햇 페달 조각', () => {
  it.each([DEFAULT_KIT_LAYOUT, { ...DEFAULT_KIT_LAYOUT, HIHAT: { ...DEFAULT_KIT_LAYOUT.HIHAT, x: 0.6, y: 0.25 } }])(
    '자유 틀에서도 받침 그림의 페달 자리에 꼭 맞는다(고정 배치와 같은 상대 자리·크기) %#',
    (layout) => {
      const pads = kitFrame(layout, BOX, 'acoustic').pads;
      const hh = pads.find((p) => p.pad === 'HIHAT')!;
      const pedal = pads.find((p) => p.pad === 'HIHAT_PEDAL')!;
      const artHh = kitArtPad(KIT_ART_PERSP, 'HIHAT')!.kit;
      const artPedal = kitArtPad(KIT_ART_PERSP, 'HIHAT_PEDAL')!.kit;
      // 하이햇 상자 폭을 1로 본 상대 자리
      expect((pedal.left - hh.left) / hh.w).toBeCloseTo((artPedal.left - artHh.left) / artHh.w, 6);
      expect((pedal.top - hh.top) / hh.w).toBeCloseTo((artPedal.top - artHh.top) / artHh.w, 6);
      expect(pedal.w / hh.w).toBeCloseTo(artPedal.w / artHh.w, 6);
    },
  );
});

describe('가로로 넓은 판에서 실물 킷이 잘리지 않는다', () => {
  // 드럼 세팅 판의 그림 영역. 그림은 판 안쪽 여백(setup.css --setup-panel-pad 16px)까지 넘어갈 수 있다.
  // 여백이 고정 px라 판이 클수록 빠듯하다: 낮은 판(338), 노트북 창(468), 1920×1080(648), 가장 큰 판(700)을 본다
  const BOXES = [
    { w: 1040, h: 338 },
    { w: 1004, h: 468 },
    { w: 1080, h: 648 },
    { w: 1128, h: 700 },
  ];
  const PANEL_PAD = 16;
  /** 심벌 셋을 배치가 허용하는 위쪽 끝(y 0.05)에 올린 배치 */
  const HIGH = { ...DEFAULT_KIT_LAYOUT };
  for (const pad of ['CRASH', 'RIDE', 'HIHAT'] as const) HIGH[pad] = { ...DEFAULT_KIT_LAYOUT[pad], y: 0.05 };

  /** 실물 그림 상자들의 위·아래 끝(틀 px) */
  const extent = (layout: typeof DEFAULT_KIT_LAYOUT, box: { w: number; h: number }) => {
    const pads = kitFrame(layout, box, 'acoustic').pads;
    return {
      top: Math.min(...pads.map((p) => p.top)),
      bottom: Math.max(...pads.map((p) => p.top + (p.art!.boxH * p.w) / 160)),
    };
  };

  it.each(BOXES)('기본 배치: 위아래 모두 판 안에 든다 %o', (box) => {
    const e = extent(DEFAULT_KIT_LAYOUT, box);
    expect(e.top).toBeGreaterThanOrEqual(-PANEL_PAD);
    expect(e.bottom).toBeLessThanOrEqual(box.h + PANEL_PAD);
  });

  it.each(BOXES)('심벌을 위쪽 끝에 올려도 위아래 모두 판 안에 든다 %o', (box) => {
    const e = extent(HIGH, box);
    expect(e.top).toBeGreaterThanOrEqual(-PANEL_PAD);
    expect(e.bottom).toBeLessThanOrEqual(box.h + PANEL_PAD);
  });
});
